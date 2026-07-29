/**
 * NotificationService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Firebase Cloud Messaging (FCM) — push même app fermée / écran verrouillé
 * 2. CallKeep — écran d'appel natif Android (Telecom API)
 * 3. Lien FCM payload → CallKeep → navigation
 */

import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import CallKeep from 'react-native-callkeep';
import { Platform, PermissionsAndroid, NativeModules } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { callSessionService } from './CallSessionService';

// ── Typage du module natif Android (KycCallModule.java/.kt) ─────────────────
// Toutes les méthodes sont optionnelles côté JS : sur iOS ce module n'existe
// pas, et selon la version native déployée certaines méthodes peuvent manquer
// (ex : startForegroundWithCallData ajoutée après startForeground). On centralise
// le typage ici plutôt que de disperser des `as any` à chaque appel.
interface KycCallNativeModule {
  isIgnoringBatteryOptimizations?: () => Promise<boolean>;
  requestIgnoreBatteryOptimizations?: () => void;
  canUseFullScreenIntent?: () => boolean;
  requestFullScreenIntentPermission?: () => void;
  startForegroundWithCallData?: (numeroMtn: string, callUuid: string) => void;
  startForeground?: (numeroMtn: string) => void;
  answerCall?: () => void;
  stopForeground?: () => void;
}
const KycCallModule = (): KycCallNativeModule | undefined =>
  (NativeModules as unknown as { KycCallModule?: KycCallNativeModule }).KycCallModule;

// ── Config CallKeep ──────────────────────────────────────────────────────────
const CALLKEEP_OPTIONS = {
  ios: {
    appName:                 'KYC Congo',
    supportsVideo:           true,
    maximumCallGroups:       '1',
    maximumCallsPerCallGroup:'1',
  },
  android: {
    alertTitle:          'Appel vidéo entrant',
    alertDescription:    "Cette application a besoin d'accéder à vos comptes téléphoniques",
    cancelButton:        'Annuler',
    okButton:            'OK',
    imageName:           'phone_account_icon',
    additionalPermissions: [PermissionsAndroid.PERMISSIONS.READ_CALL_LOG],
    // selfManaged: true → l'app gère elle-même l'UI d'appel (notre IncomingCallScreen +
    // écran natif CallKeep en verrouillé) au lieu de déléguer à l'UI Telecom par défaut
    // du téléphone. C'est le mode utilisé par WhatsApp/Messenger : sans lui, certains
    // constructeurs (Samsung, Xiaomi) affichent une UI Telecom générique à la place de
    // la tienne, ou refusent l'appel entrant si aucun compte téléphonique SIM n'existe.
    selfManaged: true,
    foregroundService: {
      channelId:         'kyc_call_channel',
      channelName:       'Appels KYC',
      notificationTitle: 'Appel vidéo KYC en cours',
      notificationIcon:  'ic_launcher',
    },
  },
};

// ── Callbacks vers l'app ─────────────────────────────────────────────────────
export type NotifCallbacks = {
  onIncomingCall: (callUuid: string, numeroMtn: string) => void;
  onCallAccepted: (callUuid: string) => void;
  onCallDeclined: (callUuid: string) => void;
  onCallEnded:    (callUuid: string) => void;
  onTokenRefresh?: (newToken: string) => void;
};

// ─────────────────────────────────────────────────────────────────────────────
class NotificationService {
  private callbacks: NotifCallbacks | null = null;
  private activeCallUuid: string | null = null;
  private displayedCallUuid: string | null = null;
  private recentCallUuids = new Map<string, number>();
  private pendingCallUuid: string | null = null;
  private fcmToken: string | null = null;
  private readonly MAX_PUSH_AGE_MS = 60_000; // ignore delayed FCM pushes after the ring timeout
  private readonly MAX_PUSH_AGE_MS = 48_000; // ignore delayed call pushes after the ring window
  private listenersBound = false;
  private initialized = false;
  private callKeepConfigured = false;
  private fcmConfigured = false;

  // ── Initialisation ──────────────────────────────────────────────────────────
  async init (cbs: NotifCallbacks): Promise<void> {
    this.callbacks = cbs;
    if (this.initialized) return;

    this.initialized = true;
    await this.registerBackgroundHandlers();
    await this.ensureFullScreenIntentPermission();
  }

  async registerBackgroundHandlers (): Promise<void> {
    await this.requestNotificationPermission();
    await this.setupCallKeep();
    await this.setupFCM();
    // Comme WhatsApp au premier lancement : on demande l'exemption Doze une
    // fois pour toutes, en fire-and-forget pour ne jamais bloquer/retarder
    // l'enregistrement FCM ci-dessus (voir avertissement en tête de
    // index.js sur la criticité du chemin headless). Sans cette exemption,
    // certains constructeurs (Samsung/Xiaomi/Oppo) peuvent retarder ou tuer
    // le processus avant qu'un push d'appel entrant ne soit traité, même
    // avec un foreground service et un FCM haute priorité corrects — c'est
    // la cause n°1 des appels qui ne réveillent pas le téléphone verrouillé.
    this.requestBatteryExemptionOnce().catch((e) =>
      console.warn('[Notif] Demande exemption batterie (best-effort) échouée:', e)
    );
  }

  // ── Ne redemander qu'une seule fois par installation, pas à chaque
  // (re)lancement de l'app, pour ne pas harceler l'utilisateur avec la boîte
  // système si celui-ci a déjà refusé une fois.
  private async requestBatteryExemptionOnce (): Promise<void> {
    if (Platform.OS !== 'android') return;
    const alreadyAsked = await AsyncStorage.getItem('battery_exemption_requested');
    if (alreadyAsked) return;
    await this.ensureBatteryOptimizationExemption();
  }

  // ── Exemption d'optimisation batterie (Doze) ─────────────────────────────
  // C'est LA cause n°1 des appels manqués app-fermée sur Samsung/Xiaomi/Oppo :
  // même avec un foreground service et un FCM haute priorité correctement
  // configurés, le système peut retarder de plusieurs minutes (voire tuer)
  // le processus si l'app n'est pas exemptée de Doze. WhatsApp demande cette
  // exemption au premier lancement — on fait pareil ici, une seule fois.
  async ensureBatteryOptimizationExemption (): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      const isIgnoring = await KycCallModule()?.isIgnoringBatteryOptimizations?.();
      if (isIgnoring) return true;

      await AsyncStorage.setItem('battery_exemption_requested', '1');
      KycCallModule()?.requestIgnoreBatteryOptimizations?.();
      return false; // la demande est lancée, l'utilisateur doit valider dans la boîte système
    } catch (e) {
      console.warn('[Notif] Vérification exemption batterie indisponible:', e);
      return false;
    }
  }

  async ensureFullScreenIntentPermission (): Promise<boolean> {
    if (Platform.OS !== 'android' || Platform.Version < 34) return true;
    try {
      const canUse = KycCallModule()?.canUseFullScreenIntent?.();
      if (canUse) return true;

      KycCallModule()?.requestFullScreenIntentPermission?.();
      return false;
    } catch (e) {
      console.warn('[Notif] Vérification full screen intent impossible:', e);
      return true;
    }
  }

  // ── Permission notifications (Android 13+ / POST_NOTIFICATIONS) ─────────
  private async requestNotificationPermission (): Promise<void> {
    if (Platform.OS !== 'android' || Platform.Version < 33) return;
    // Cast nécessaire : POST_NOTIFICATIONS (API 33+) manque encore des
    // typings PermissionsAndroid.PERMISSIONS de plusieurs versions de RN.
    const POST_NOTIFICATIONS = 'android.permission.POST_NOTIFICATIONS' as unknown as Parameters<typeof PermissionsAndroid.request>[0];
    try {
      await PermissionsAndroid.request(
        POST_NOTIFICATIONS,
        {
          title:                 'Notifications d\'appel',
          message:               'Nécessaire pour vous alerter des appels vidéo entrants, même écran verrouillé.',
          buttonPositive:        'Autoriser',
          buttonNegative:        'Refuser',
        }
      );
    } catch (e) {
      console.warn('[Notif] Permission POST_NOTIFICATIONS refusée ou indisponible:', e);
    }
  }

  // ── Token FCM (sync après init) ──────────────────────────────────────────
  getFCMToken (): string | null {
    return this.fcmToken;
  }

  async ensureFCMToken (): Promise<string | null> {
    if (this.fcmToken) return this.fcmToken;

    this.fcmToken = await this.fetchFCMTokenWithRetry(3);
    if (this.fcmToken) {
      await AsyncStorage.setItem('fcm_token', this.fcmToken);
      this.callbacks?.onTokenRefresh?.(this.fcmToken);
      console.log('[FCM] Token prêt pour la signalisation', this.fcmToken.slice(0, 20));
    }
    return this.fcmToken;
  }

  // ── Setup CallKeep ───────────────────────────────────────────────────────
  private async setupCallKeep (): Promise<void> {
    if (this.callKeepConfigured) return;

    try {
      await CallKeep.setup(CALLKEEP_OPTIONS);
      CallKeep.setAvailable(true);
      this.bindCallKeepEvents();
      this.callKeepConfigured = true;
      console.log('[CallKeep] Setup successful');
    } catch (e) {
      console.warn('[CallKeep] Setup failed:', e);
    }
  }

  // ── Branchement des événements natifs CallKeep vers les callbacks JS ────
  // C'est ce lien qui manquait : sans lui, accepter/refuser un appel depuis
  // l'écran d'appel natif (verrouillé ou app fermée) ne remontait jamais à l'app.
  private bindCallKeepEvents (): void {
    if (this.listenersBound) return;
    this.listenersBound = true;

    CallKeep.addEventListener('answerCall', ({ callUUID }: { callUUID: string }) => {
      console.log('[CallKeep] answerCall', callUUID);
      const id = callUUID || this.activeCallUuid || '';
      // Décroché depuis l'écran verrouillé natif : on arrête la sonnerie sans
      // tuer le service foreground (voir answerNativeCall ci-dessous).
      this.answerNativeCall(id);
      this.callbacks?.onCallAccepted(id);
    });

    CallKeep.addEventListener('endCall', ({ callUUID }: { callUUID: string }) => {
      console.log('[CallKeep] endCall', callUUID);
      const id = callUUID || this.activeCallUuid || '';
      // CallKeep ne distingue pas "raccrocher pendant l'appel" de "refuser avant
      // décroché" : on laisse le store / l'écran actif faire la distinction via
      // onCallDeclined, qui déclenche un refus signalé au serveur si l'appel
      // n'était pas encore actif (le SignalingService applique la bonne action).
      this.callbacks?.onCallDeclined(id);
      if (id === this.activeCallUuid) this.activeCallUuid = null;
    });

    CallKeep.addEventListener('didPerformSetMutedCallAction', ({ muted }: { muted: boolean }) => {
      console.log('[CallKeep] mute natif:', muted);
    });

    CallKeep.addEventListener('didActivateAudioSession', () => {
      console.log('[CallKeep] Session audio activée');
    });
  }

  // ── Setup Firebase Messaging ─────────────────────────────────────────────
  // IMPORTANT : setBackgroundMessageHandler N'EST PLUS enregistré ici.
  // Cette méthode ne tourne que lorsque App.tsx a monté (via init() appelé
  // depuis un useEffect) — c'est-à-dire seulement si l'utilisateur (ou l'OS)
  // a déjà lancé un contexte JS complet. Si l'app a été tuée et n'a JAMAIS
  // été rouverte, ce useEffect ne s'exécute jamais, et un enregistrement du
  // handler ici arriverait de toute façon trop tard : sur Android, FCM lance
  // un contexte JS "headless" séparé rien que pour exécuter le handler, et il
  // exige que celui-ci soit déjà enregistré de façon SYNCHRONE dès le chargement
  // du bundle — donc dans index.js, avant AppRegistry.registerComponent, pas ici.
  // Voir handleHeadlessMessage() plus bas + index.js.
  private async setupFCM (): Promise<void> {
    if (this.fcmConfigured) return;
    this.fcmConfigured = true;

    // Permission iOS
    if (Platform.OS === 'ios') {
      const status = await messaging().requestPermission();
      const granted =
        status === messaging.AuthorizationStatus.AUTHORIZED ||
        status === messaging.AuthorizationStatus.PROVISIONAL;
      if (!granted) return;
    }

    // Token FCM — mis en cache mémoire + AsyncStorage, avec quelques tentatives
    // avant de se rabattre sur le cache (réseau instable au premier lancement).
    this.fcmToken = await this.fetchFCMTokenWithRetry(3);
    if (this.fcmToken) {
      await AsyncStorage.setItem('fcm_token', this.fcmToken);
      this.callbacks?.onTokenRefresh?.(this.fcmToken);
    }

    // Refresh du token — le serveur doit être resynchronisé (sinon push mort)
    messaging().onTokenRefresh(async (newToken) => {
      this.fcmToken = newToken;
      await AsyncStorage.setItem('fcm_token', newToken);
      this.callbacks?.onTokenRefresh?.(newToken);
    });

    // App en foreground
    messaging().onMessage(async (msg) => {
      console.log('[FCM] message reçu en foreground', msg.data);
      this.handlePushPayload(msg);
    });

    // App en background (pas tuée, juste minimisée) — tap sur notification
    messaging().onNotificationOpenedApp((msg) => {
      console.log('[FCM] notification ouverte depuis background', msg.data);
      this.handlePushPayload(msg);
    });

    // App ouverte depuis une notification (cold start déclenché par un tap,
    // différent du cold start headless géré par handleHeadlessMessage)
    const initial = await messaging().getInitialNotification();
    if (initial) this.handlePushPayload(initial);
  }

  // ── Handler headless — appelé depuis index.js, PAS depuis App.tsx ───────
  // C'est le chemin qui manquait pour un comportement "façon WhatsApp" : un
  // appel doit sonner même si l'app n'a pas été ouverte une seule fois depuis
  // le dernier redémarrage du téléphone. Dans ce cas, App.tsx ne monte jamais
  // — donc aucun état initialisé par init()/registerBackgroundHandlers() ne
  // peut être supposé prêt. Cette méthode est donc volontairement
  // autosuffisante : elle configure CallKeep elle-même (idempotent via
  // callKeepConfigured) avant d'afficher l'appel, sans dépendre de callbacks.
  async handleHeadlessMessage (msg: FirebaseMessagingTypes.RemoteMessage): Promise<void> {
    console.log('[FCM] headless background message', msg.data);
    try {
      await this.setupCallKeep();
    } catch (e) {
      console.warn('[Notif] setupCallKeep (headless) failed:', e);
    }
    await this.handlePushPayload(msg);
  }

  // ── Récupération du token FCM avec tentatives successives ────────────────
  private async fetchFCMTokenWithRetry (attempts: number): Promise<string | null> {
    for (let i = 0; i < attempts; i++) {
      try {
        const token = await messaging().getToken();
        await AsyncStorage.setItem('fcm_token', token);
        console.log('[FCM] Token enregistré');
        return token;
      } catch (e) {
        console.warn(`[FCM] Tentative ${i + 1}/${attempts} échouée:`, e);
        if (i < attempts - 1) {
          await new Promise(r => setTimeout(r, 1500 * (i + 1)));
        }
      }
    }
    console.warn('[FCM] Abandon — utilisation du token en cache');
    return AsyncStorage.getItem('fcm_token');
  }

  // ── Traitement payload FCM ──────────────────────────────────────────────
  private async handlePushPayload (msg: FirebaseMessagingTypes.RemoteMessage): Promise<void> {
    const data = msg.data;
    if (!data || data.type !== 'incoming-call') return;

    const numeroMtn = String(data.numeroMtn ?? '');
    // Utilise le callUuid fourni par le serveur, ou en génère un local
    const callUuid  = String(data.callUuid ?? `fcm-${Date.now()}`);

    const sentAtRaw = data.sentAt ?? data.sent_at ?? data.sent_at_ms ?? '';
    const sentAt = Number(sentAtRaw || 0);
    if (sentAt > 0) {
      const age = Date.now() - sentAt;
      if (age > this.MAX_PUSH_AGE_MS) {
        console.log('[Notif] incoming-call stale ignoré', { callUuid, age, maxAge: this.MAX_PUSH_AGE_MS });
        return;
      }
    }

    // Un appel est déjà affiché/en cours de traitement : le serveur génère un
    // callUuid DIFFÉRENT à chaque tentative (redial back-office, retry...),
    // donc comparer les uuid ne suffit pas — s'il y a déjà un activeCallUuid
    // (quel qu'il soit), c'est presque toujours un doublon du même appel
    // logique. On ignore avant même de toucher activeCallUuid, sinon on
    // écrase la référence qui sert justement à détecter ce doublon.
    if (this.activeCallUuid && this.activeCallUuid !== callUuid) {
      console.log('[Notif] appel déjà actif, push ignoré', { active: this.activeCallUuid, incoming: callUuid });
      return;
    }

    const now = Date.now();
    const lastSeenAt = this.recentCallUuids.get(callUuid);
    if (lastSeenAt && now - lastSeenAt < 4_000) {
      console.log('[Notif] doublon incoming-call ignoré', callUuid);
      return;
    }
    this.recentCallUuids.set(callUuid, now);
    this.recentCallUuids.forEach((seenAt, uuid) => {
      if (now - seenAt > 30_000) this.recentCallUuids.delete(uuid);
    });

    this.pendingCallUuid = callUuid;
    await this.persistPendingIncomingCall(callUuid, numeroMtn);
    // showIncomingCall() est responsable de poser activeCallUuid/displayedCallUuid
    // — c'est la seule fonction qui doit le faire, pour que son propre garde-fou
    // (ligne "un autre appel est déjà affiché") reste efficace.
    this.showIncomingCall(callUuid, numeroMtn);
    setTimeout(() => {
      this.callbacks?.onIncomingCall(callUuid, numeroMtn);
    }, 100);
  }

  private async persistPendingIncomingCall (callUuid: string, numeroMtn: string): Promise<void> {
    try {
      await AsyncStorage.setItem('pending_incoming_call', JSON.stringify({ callUuid, numeroMtn }));
    } catch (e) {
      console.warn('[Notif] impossible d’enregistrer l’appel entrant en attente', e);
    }
  }

  private async clearPendingIncomingCall (): Promise<void> {
    try {
      await AsyncStorage.removeItem('pending_incoming_call');
    } catch (e) {
      console.warn('[Notif] impossible de nettoyer l’appel entrant en attente', e);
    }
  }

  // ── Lecture de l'appel actif (pour dédupliquer WS et push) ──────────────
  getActiveCallUuid (): string | null {
    return this.activeCallUuid;
  }

  // ── Afficher l'écran d'appel natif ──────────────────────────────────────
  // Idempotent : si le même callUuid est déjà affiché (ex. le WS et le push
  // FCM arrivent tous les deux pour le même appel, ce qui est le comportement
  // NORMAL et voulu — voir sendIncomingCallPush côté serveur, envoyé en
  // parallèle du WS pour la fiabilité), on ignore le second déclenchement au
  // lieu de relancer une 2e fois la sonnerie/CallKeep pour le même appel.
  showIncomingCall (callUuid: string, numeroMtn: string): void {
    if (this.activeCallUuid && this.activeCallUuid !== callUuid) {
      console.log('[Notif] un autre appel est déjà affiché, nouvel appel ignoré', { active: this.activeCallUuid, incoming: callUuid });
      return;
    }
    if (this.displayedCallUuid === callUuid) {
      console.log('[Notif] showIncomingCall ignoré (déjà affiché) :', callUuid);
      return;
    }

    this.activeCallUuid = callUuid;
    this.displayedCallUuid = callUuid;
    callSessionService.startIncomingCallExperience();

    try {
      const nativeCallModule = KycCallModule();
      // Sur Android, démarre le service foreground natif qui joue lui-même
      // la sonnerie (sonneriekyc.mp3 ou repli système) + vibration, en boucle,
      // indépendamment de l'état du moteur JS — voir KycForegroundCallService.
      if (nativeCallModule?.startForegroundWithCallData) {
        nativeCallModule.startForegroundWithCallData(numeroMtn, callUuid);
      } else {
        nativeCallModule?.startForeground?.(numeroMtn);
      }
    } catch (e) {
      console.warn('[Notif] startForeground failed:', e);
    }

    CallKeep.displayIncomingCall(
      callUuid,
      numeroMtn,
      `KYC — ${numeroMtn}`,
      'number',
      true,   // supportsVideo
    );
  }

  // ── Décrocher l'appel : arrête sonnerie/vibration natives SANS tuer le
  // service foreground (notification + wake lock restent actifs pour toute
  // la durée de l'appel). À appeler à la place de endNativeCall() quand
  // l'utilisateur accepte — endNativeCall() reste réservé au refus/raccroché/
  // timeout, qui doivent eux arrêter le service complètement.
  async answerNativeCall (callUuid?: string): Promise<void> {
    const id = callUuid ?? this.activeCallUuid;
    if (id) {
      CallKeep.setCurrentCallActive(id);
    }
    this.displayedCallUuid = null;
    await this.clearPendingIncomingCall();
    try {
      KycCallModule()?.answerCall?.();
    } catch (e) {
      console.warn('[Notif] answerCall natif indisponible:', e);
    }
  }

  // ── Terminer l'appel natif ─────────────────────────────────────────────
  async endNativeCall (callUuid?: string): Promise<void> {
    const id = callUuid ?? this.activeCallUuid;
    if (id) {
      CallKeep.endCall(id);
      if (id === this.activeCallUuid) this.activeCallUuid = null;
    }
    this.displayedCallUuid = null;
    this.pendingCallUuid = null;
    await this.clearPendingIncomingCall();

    callSessionService.stopIncomingCallExperience();

    try {
      KycCallModule()?.stopForeground?.();
    } catch (e) {
      console.warn('[Notif] stopForeground failed:', e);
    }
  }

  // ── Marquer l'appel comme connecté (démarre le timer CallKeep) ──────────
  setCallConnected (callUuid: string): void {
    CallKeep.setCurrentCallActive(callUuid);
  }

  // ── Nettoyage ────────────────────────────────────────────────────────────
  destroy (): void {
    CallKeep.removeEventListener('answerCall');
    CallKeep.removeEventListener('endCall');
    CallKeep.removeEventListener('didPerformSetMutedCallAction');
    CallKeep.removeEventListener('didActivateAudioSession');
    this.listenersBound = false;
    this.initialized = false;
  }
}

export const notificationService = new NotificationService();