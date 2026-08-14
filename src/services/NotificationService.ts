/**
 * NotificationService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Firebase Cloud Messaging (FCM) — push même app fermée / écran verrouillé
 * 2. CallKeep — écran d'appel natif Android (Telecom API)
 * 3. Lien FCM payload → CallKeep → navigation
 */

import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import CallKeep from 'react-native-callkeep';
import { Platform, PermissionsAndroid, NativeModules, AppState } from 'react-native';
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
  openAutoStartSettings?: () => void;
  canUseFullScreenIntent?: () => boolean;
  requestFullScreenIntentPermission?: () => void;
  startForegroundWithCallData?: (numeroMtn: string, callUuid: string) => void;
  startForeground?: (numeroMtn: string) => void;
  answerCall?: () => void;
  stopForeground?: () => void;
}
const KycCallModule = (): KycCallNativeModule | undefined =>
  (NativeModules as unknown as { KycCallModule?: KycCallNativeModule }).KycCallModule;

// Constructeurs connus pour tuer agressivement les apps en arrière-plan
// au-delà de la simple gestion Doze standard d'Android (voir openAutoStartSettings
// côté natif). Sans leur écran "autostart" propre, un appel peut ne jamais
// sonner sur ces marques même avec l'exemption Doze acceptée.
const AGGRESSIVE_OEMS = [
  'xiaomi', 'redmi', 'poco', 'oppo', 'oneplus', 'realme', 'vivo', 'iqoo', 'huawei', 'honor',
  // Transsion (Infinix/Tecno/Itel) — très répandues en Afrique/marché MTN, tout aussi
  // agressives que Xiaomi/Oppo sur le kill des process en arrière-plan (HiOS/XOS).
  'infinix', 'tecno', 'itel',
];
const getManufacturer = (): string => {
  try {
    const raw = (NativeModules as unknown as { KycCallModule?: { MANUFACTURER?: string } }).KycCallModule?.MANUFACTURER;
    return (raw ?? '').toLowerCase();
  } catch {
    return '';
  }
};

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
    additionalPermissions: [PermissionsAndroid.PERMISSIONS.READ_CALL_LOG, PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS],
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
  private readonly MAX_PUSH_AGE_MS = 10 * 60_000; // voir handlePushPayload : marge large pour tolérer un décalage d'horloge appareil/serveur
  private listenersBound = false;
  private initialized = false;
  private callKeepConfigured = false;
  private fcmConfigured = false;
  // Dernier état connu du PhoneAccount CallKeep (voir checkPhoneAccountEnabled
  // ci-dessous). Rafraîchi à chaque appel entrant — c'est un compte système
  // (Réglages > Comptes d'appel) qui peut être désactivé par l'utilisateur ou
  // le constructeur à tout moment après le setup initial, donc on ne peut pas
  // se fier une fois pour toutes à l'état constaté lors du premier setup().
  private phoneAccountEnabled = false;

  // ── Filet de sécurité contre un verrou d'appel qui resterait bloqué ──────
  // activeCallUuid est le verrou central qui empêche un doublon d'écraser un
  // appel en cours (voir showIncomingCall/handlePushPayload). Son revers :
  // s'il n'est JAMAIS nettoyé (un appelant oublie d'appeler endNativeCall()
  // sur un des multiples chemins de fin d'appel — raccroché in-app, refusé,
  // distant a raccroché, timeout, CallKeep natif...), TOUS les appels
  // suivants sont silencieusement ignorés pour toujours. Ce watchdog est un
  // filet de sécurité qui force le nettoyage si personne ne l'a fait, sans
  // dépendre d'un seul chemin d'appel externe pour rester fiable.
  private watchdogTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly RING_WATCHDOG_MS = 65_000;              // légèrement > le timeout serveur de 45s
  private readonly MAX_CALL_DURATION_MS = 3 * 60 * 60 * 1000; // filet de sécurité ultime une fois décroché

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
    // Comme WhatsApp : on vérifie l'exemption Doze à CHAQUE lancement, en
    // fire-and-forget pour ne jamais bloquer/retarder l'enregistrement FCM
    // ci-dessus. Sans cette exemption, certains constructeurs (Samsung/
    // Xiaomi/Oppo) peuvent retarder ou tuer le processus avant qu'un push
    // d'appel entrant ne soit traité — c'est la cause n°1 des appels qui ne
    // réveillent pas le téléphone verrouillé.
    //
    // CORRECTIF IMPORTANT : l'ancienne version posait un flag AsyncStorage
    // permanent dès la PREMIÈRE tentative, qu'elle ait abouti ou non — un
    // agent qui refusait (ou fermait) la boîte système une seule fois ne se
    // voyait alors PLUS JAMAIS reproposer l'exemption, pour toute la durée
    // de vie de l'app. Concrètement : appels silencieux à vie sur ce
    // téléphone, sans aucun moyen de rattraper l'erreur autrement qu'en
    // réinstallant l'app. On vérifie maintenant l'état RÉEL de la permission
    // à chaque lancement (isIgnoringBatteryOptimizations), et on ne
    // considère jamais qu'une demande passée = un problème résolu.
    this.ensureCallReliabilityPermissions().catch((e) =>
      console.warn('[Notif] Vérification fiabilité appels (best-effort) échouée:', e)
    );
  }

  // ── Fiabilité maximale : Doze + autostart constructeur ──────────────────
  // Regroupe les deux vérifications dont dépend la réception d'un appel app
  // fermée. Rappel à chaque lancement tant que ce n'est pas acquis — on
  // n'accepte pas un simple "refusé une fois" comme état final, car un appel
  // manqué en KYC terrain a un coût métier direct.
  private async ensureCallReliabilityPermissions (): Promise<void> {
    if (Platform.OS !== 'android') return;

    const batteryOk = await this.ensureBatteryOptimizationExemption();

    // L'écran autostart constructeur est plus intrusif (sort de l'app vers un
    // écran système propriétaire) : on le limite aux marques connues pour
    // tuer agressivement les process en arrière-plan, et on espace les
    // relances (24h) pour ne pas harceler l'agent à chaque ouverture une fois
    // qu'il l'a déjà vu — mais on ne l'abandonne JAMAIS tant que ce n'est pas
    // confirmé résolu, contrairement à l'ancien comportement sur la batterie.
    const manufacturer = getManufacturer();
    const isAggressiveOem = AGGRESSIVE_OEMS.some((m) => manufacturer.includes(m));
    if (!isAggressiveOem) return;

    const lastPromptRaw = await AsyncStorage.getItem('autostart_last_prompt_at');
    const lastPrompt = lastPromptRaw ? Number(lastPromptRaw) : 0;
    const dayMs = 24 * 60 * 60 * 1000;
    if (Date.now() - lastPrompt < dayMs) return;

    // Pas de vérification d'état fiable possible ici (pas d'API standard pour
    // lire si l'autostart est déjà autorisé sur ces OEM) — on se contente
    // d'espacer les relances dans le temps. batteryOk sert uniquement à ne
    // pas empiler deux boîtes de dialogue système d'un coup : si la boîte
    // Doze vient de s'ouvrir, on attend le prochain lancement pour proposer
    // l'autostart plutôt que d'enchaîner deux écrans immédiatement.
    if (!batteryOk) return;

    await AsyncStorage.setItem('autostart_last_prompt_at', String(Date.now()));
    try {
      KycCallModule()?.openAutoStartSettings?.();
    } catch (e) {
      console.warn('[Notif] Ouverture écran autostart échouée:', e);
    }
  }

  // ── Exemption d'optimisation batterie (Doze) ─────────────────────────────
  // C'est LA cause n°1 des appels manqués app-fermée sur Samsung/Xiaomi/Oppo :
  // même avec un foreground service et un FCM haute priorité correctement
  // configurés, le système peut retarder de plusieurs minutes (voire tuer)
  // le processus si l'app n'est pas exemptée de Doze.
  //
  // Vérifie l'état RÉEL à chaque appel (pas de flag "déjà demandé" qui
  // bloquerait les tentatives suivantes) — voir ensureCallReliabilityPermissions
  // ci-dessus pour le contexte du correctif.
  async ensureBatteryOptimizationExemption (): Promise<boolean> {
    if (Platform.OS !== 'android') return true;
    try {
      const isIgnoring = await KycCallModule()?.isIgnoringBatteryOptimizations?.();
      if (isIgnoring) return true;

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
      // Demande runtime de READ_PHONE_NUMBERS pour éviter que la librairie
      // CallKeep déclenche une SecurityException côté Telecom (getPhoneAccount)
      if (Platform.OS === 'android') {
        try {
          const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.READ_PHONE_NUMBERS, {
            title: 'Accès numéro de téléphone',
            message: 'Nécessaire pour initialiser correctement l\'intégration CallKeep sur certains appareils',
            buttonPositive: 'Autoriser',
            buttonNegative: 'Refuser',
          });
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            console.warn('[CallKeep] Permission READ_PHONE_NUMBERS non accordée — CallKeep peut se comporter de façon dégradée');
          }
        } catch (permErr) {
          console.warn('[CallKeep] Erreur demande permission READ_PHONE_NUMBERS:', permErr);
        }
      }
      await CallKeep.setup(CALLKEEP_OPTIONS);
      CallKeep.setAvailable(true);
      this.bindCallKeepEvents();
      this.callKeepConfigured = true;
      console.log('[CallKeep] Setup successful');

      // ── Vérification PhoneAccount ────────────────────────────────────────
      // CallKeep.setup() qui résout SANS erreur ne garantit PAS que le
      // PhoneAccount système est activé. Sur beaucoup d'appareils (surtout
      // les OEM listés dans AGGRESSIVE_OEMS), l'utilisateur doit l'activer
      // une fois manuellement dans Réglages > Comptes d'appel. Tant que ce
      // n'est pas fait, TOUT appel à CallKeep.displayIncomingCall() plante le
      // process natif : TelecomManager.addNewIncomingCall() ne crée jamais de
      // Connection, et VoiceConnectionService (react-native-callkeep) appelle
      // quand même setRinging() dessus → NullPointerException →
      // "Process has crashed too many times, killing!" côté ActivityManager.
      // On vérifie ICI, au setup, pour logguer/agir avant qu'un appel réel
      // n'arrive plutôt que de le découvrir pendant un crash-loop en prod.
      await this.checkPhoneAccountEnabled();
    } catch (e) {
      console.warn('[CallKeep] Setup failed:', e);
    }
  }

  // ── Vérifie si le PhoneAccount Telecom de l'app est activé côté système ─
  // Rafraîchit this.phoneAccountEnabled et le retourne. Ne lève jamais —
  // en cas d'erreur/API absente sur cette version de react-native-callkeep,
  // on considère prudemment "non activé" pour forcer le repli sur le
  // foreground service natif plutôt que de risquer le crash.
  async checkPhoneAccountEnabled (): Promise<boolean> {
    if (Platform.OS !== 'android') {
      this.phoneAccountEnabled = true;
      return true;
    }
    try {
      const enabled = await (CallKeep as unknown as {
        checkPhoneAccountEnabled?: () => Promise<boolean>;
      }).checkPhoneAccountEnabled?.();
      this.phoneAccountEnabled = enabled === true;
      if (!this.phoneAccountEnabled) {
        console.warn('[CallKeep] PhoneAccount NON activé — displayIncomingCall sera sauté pour éviter le crash natif (setRinging sur null)');
      }
      return this.phoneAccountEnabled;
    } catch (e) {
      console.warn('[CallKeep] checkPhoneAccountEnabled indisponible, on suppose non activé par prudence:', e);
      this.phoneAccountEnabled = false;
      return false;
    }
  }

  // ── Ouvre l'écran système "Comptes d'appel" pour que l'agent active
  // manuellement le compte KYC — throttlé (24h) comme openAutoStartSettings,
  // pour ne pas rouvrir cet écran système à chaque appel entrant tant que
  // l'agent n'a pas eu l'occasion de le faire.
  // force=true bypasse le throttle : réservé à l'appel explicite depuis
  // l'onboarding (ensurePhoneAccountEnabled ci-dessous), où on VEUT rouvrir
  // l'écran à chaque tentative tant que le compte n'est pas activé.
  private async promptEnablePhoneAccount (force = false): Promise<void> {
    try {
      if (!force) {
        const lastPromptRaw = await AsyncStorage.getItem('phone_account_last_prompt_at');
        const lastPrompt = lastPromptRaw ? Number(lastPromptRaw) : 0;
        const dayMs = 24 * 60 * 60 * 1000;
        if (Date.now() - lastPrompt < dayMs) return;
        await AsyncStorage.setItem('phone_account_last_prompt_at', String(Date.now()));
      }
      (CallKeep as unknown as { openPhoneAccounts?: () => void }).openPhoneAccounts?.();
    } catch (e) {
      console.warn('[CallKeep] Ouverture écran comptes d\'appel échouée:', e);
    }
  }

  // ── Étape d'onboarding : à appeler depuis l'écran de login/connexion
  // agent, AVANT de le laisser passer "en ligne" — pas seulement de manière
  // réactive au moment d'un appel raté. Ouvre l'écran système sans throttle
  // si nécessaire, puis se réabonne à AppState pour revérifier dès que
  // l'agent revient des Réglages (sans attendre un appel entrant).
  //
  // Retourne true si le compte est activé. Retourne false après 60s sans
  // action (l'app reste utilisable via le foreground service natif, mais
  // sans écran d'appel Telecom natif — voir showIncomingCall) : à afficher
  // comme bandeau "config incomplète" non bloquant plutôt que d'empêcher
  // l'agent de travailler.
  async ensurePhoneAccountEnabled (): Promise<boolean> {
    if (Platform.OS !== 'android') return true;

    const enabled = await this.checkPhoneAccountEnabled();
    if (enabled) return true;

    void this.promptEnablePhoneAccount(true);

    return new Promise<boolean>((resolve) => {
      let settled = false;
      const finish = (result: boolean) => {
        if (settled) return;
        settled = true;
        sub.remove();
        clearTimeout(timeoutId);
        resolve(result);
      };
      const sub = AppState.addEventListener('change', (state) => {
        if (state !== 'active') return;
        this.checkPhoneAccountEnabled().then(finish).catch(() => finish(false));
      });
      const timeoutId = setTimeout(() => finish(this.phoneAccountEnabled), 60000);
    });
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
      if (id === this.displayedCallUuid) this.displayedCallUuid = null;
      if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); this.watchdogTimer = null; }
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

  // ── Point d'entrée UNIQUE pour un appel entrant, quel que soit le canal ──
  // (push FCM OU message WebSocket). AVANT : IdleScreen.tsx (canal WS)
  // touchait callStore.setIncomingCall() directement et n'alimentait jamais
  // recentCallUuids/activeCallUuid — ce dédup ne vivait que dans
  // handlePushPayload (canal FCM). Résultat observé en prod : quand le
  // serveur envoie le même appel sur WS ET FCM en parallèle (comportement
  // voulu, pour la fiabilité — voir SignalingService.ts), le second canal à
  // arriver ne voyait AUCUNE trace du premier et redéclenchait sonnerie/
  // affichage natif pour le même appel (2x startForegroundWithCallData dans
  // les logs). Maintenant : IdleScreen.tsx (WS) appelle CETTE méthode au lieu
  // de toucher callStore/showIncomingCall lui-même — un seul chemin peut
  // enregistrer un appel entrant, peu importe le canal qui l'a livré en premier.
  registerIncomingCall (callUuid: string, numeroMtn: string): void {
    if (this.activeCallUuid && this.activeCallUuid !== callUuid) {
      console.log('[Notif] appel déjà actif, incoming-call ignoré', { active: this.activeCallUuid, incoming: callUuid });
      return;
    }

    const now = Date.now();
    const lastSeenAt = this.recentCallUuids.get(callUuid);
    if (lastSeenAt && now - lastSeenAt < 4_000) {
      console.log('[Notif] doublon incoming-call ignoré (canal croisé WS/FCM)', callUuid);
      return;
    }
    this.recentCallUuids.set(callUuid, now);
    this.recentCallUuids.forEach((seenAt, uuid) => {
      if (now - seenAt > 30_000) this.recentCallUuids.delete(uuid);
    });

    this.pendingCallUuid = callUuid;
    void this.persistPendingIncomingCall(callUuid, numeroMtn);
    // showIncomingCall() est responsable de poser activeCallUuid/displayedCallUuid
    // — c'est la seule fonction qui doit le faire, pour que son propre garde-fou
    // (ligne "un autre appel est déjà affiché") reste efficace.
    this.showIncomingCall(callUuid, numeroMtn);
    // callbacks.onIncomingCall (câblé dans App.tsx) pose callStore.setIncomingCall
    // via openIncomingCallRoute — qui a lui-même son propre garde-fou
    // (status !== 'idle') — c'est donc bien la SEULE fonction qui touche le
    // store, quel que soit le canal d'origine (WS ou FCM).
    setTimeout(() => {
      this.callbacks?.onIncomingCall(callUuid, numeroMtn);
    }, 100);
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
    // ── Filtre anti-push-obsolète — TOLÉRANT AU DÉCALAGE D'HORLOGE ─────────
    // `sentAt` est estampillé par l'horloge du SERVEUR ; `Date.now()` ici est
    // l'horloge du TÉLÉPHONE. Ce ne sont PAS la même horloge, et on ne peut
    // pas garantir qu'elles sont synchronisées sur du matériel terrain (heure
    // automatique/réseau désactivée, fuseau mal configuré, etc.) — un écart
    // de plusieurs minutes est possible sans qu'aucun message ne soit
    // réellement resté en attente ce temps-là.
    //
    // On distingue donc deux choses :
    //   1. Un âge ÉNORME (> MAX_PUSH_AGE_MS, 10 min) → très probablement un
    //      vrai push resté en attente pendant une longue mise en veille
    //      Doze : on l'ignore, l'appel a de toute façon expiré côté serveur.
    //   2. Un âge modéré mais suspect (négatif, ou incohérent) → signe d'un
    //      décalage d'horloge, PAS d'un push périmé : on log un avertissement
    //      exploitable (pour repérer les appareils mal réglés) mais on NE
    //      BLOQUE PAS l'appel. Un faux "stale" ignoré à tort est bien pire
    //      qu'un affichage redondant : c'est un appel qui ne sonne jamais.
    if (sentAt > 0) {
      const age = Date.now() - sentAt;
      if (age > this.MAX_PUSH_AGE_MS) {
        console.log('[Notif] incoming-call stale ignoré', { callUuid, age, maxAge: this.MAX_PUSH_AGE_MS });
        return;
      }
      if (age < -30_000 || age > 30_000) {
        console.warn('[Notif] écart horloge appareil/serveur détecté (push traité quand même)', {
          callUuid, age, hint: 'vérifier la date/heure automatique du téléphone',
        });
      }
    }

    // Dédup + affichage : voir registerIncomingCall() ci-dessus, désormais
    // partagé avec le canal WS (IdleScreen.tsx).
    this.registerIncomingCall(callUuid, numeroMtn);
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

  // ── Watchdog : force le nettoyage si personne n'a explicitement terminé
  // l'appel dans le délai attendu (voir commentaire sur watchdogTimer plus haut).
  private armWatchdog (callUuid: string, delayMs: number): void {
    if (this.watchdogTimer) clearTimeout(this.watchdogTimer);
    this.watchdogTimer = setTimeout(() => {
      this.watchdogTimer = null;
      if (this.activeCallUuid === callUuid) {
        console.warn('[Notif] watchdog : appel jamais nettoyé explicitement, forçage endNativeCall', { callUuid, delayMs });
        this.endNativeCall(callUuid);
      }
    }, delayMs);
  }

  // ── Afficher l'écran d'appel natif ──────────────────────────────────────
  // Idempotent : si le même callUuid est déjà affiché (ex. le WS et le push
  // FCM arrivent tous les deux pour le même appel, ce qui est le comportement
  // NORMAL et voulu — voir sendIncomingCallPush côté serveur, envoyé en
  // parallèle du WS pour la fiabilité), on ignore le second déclenchement au
  // lieu de relancer une 2e fois la sonnerie/CallKeep pour le même appel.
  showIncomingCall (callUuid: string, numeroMtn: string): void {
    console.log('[Notif] showIncomingCall appelé', { callUuid, numeroMtn, activeCallUuid: this.activeCallUuid, displayedCallUuid: this.displayedCallUuid });
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
    // Filet de sécurité "sonnerie jamais résolue" : si rien (ni acceptation,
    // ni refus, ni timeout ailleurs dans l'app) ne libère ce verrou avant
    // RING_WATCHDOG_MS, on le force nous-même — sans ça un seul chemin de fin
    // d'appel oublié bloquerait tous les appels suivants indéfiniment.
    this.armWatchdog(callUuid, this.RING_WATCHDOG_MS);

    try {
      const nativeCallModule = KycCallModule();
      // Sur Android, démarre le service foreground natif qui joue lui-même
      // la sonnerie (sonneriekyc.mp3 ou repli système) + vibration, en boucle,
      // indépendamment de l'état du moteur JS — voir KycForegroundCallService.
      // C'EST CE CHEMIN, et lui seul, qui réveille fiablement le téléphone :
      // il pose son propre wake lock + full-screen intent vers MainActivity
      // (voir applyLockScreenWakeFlags), sans dépendre de CallKeep/Telecom.
      if (nativeCallModule?.startForegroundWithCallData) {
        nativeCallModule.startForegroundWithCallData(numeroMtn, callUuid);
      } else {
        nativeCallModule?.startForeground?.(numeroMtn);
      }
    } catch (e) {
      console.warn('[Notif] startForeground failed:', e);
    }

    // ── CallKeep : uniquement si le PhoneAccount est bien activé ────────────
    // Ne JAMAIS appeler displayIncomingCall() à l'aveugle : si le compte
    // n'est pas activé côté système, ça plante nativement (NPE dans
    // VoiceConnectionService.setRinging(), non interceptable par un try/catch
    // JS car l'erreur survient dans un callback Telecom asynchrone hors pile
    // JS) — et c'est exactement l'origine du crash-loop qui tue l'app à
    // chaque appel entrant. Le foreground service natif démarré ci-dessus
    // suffit à lui seul à faire sonner/vibrer/réveiller l'écran ; CallKeep
    // n'est qu'un "plus" (écran d'appel Telecom natif) quand disponible.
    this.checkPhoneAccountEnabled()
      .then((enabled) => {
        // Un autre appel a pu entre-temps changer/nettoyer l'appel affiché
        // (fin d'appel très rapide, doublon WS/FCM) — on ne relance pas
        // CallKeep pour un callUuid qui n'est plus l'appel courant affiché.
        if (this.displayedCallUuid !== callUuid) return;

        if (!enabled) {
          void this.promptEnablePhoneAccount();
          return;
        }

        try {
          CallKeep.displayIncomingCall(
            callUuid,
            numeroMtn,
            `KYC — ${numeroMtn}`,
            'number',
            true,   // supportsVideo
          );
        } catch (e) {
          console.warn('[CallKeep] displayIncomingCall failed:', e);
        }
      })
      .catch((e) => console.warn('[CallKeep] checkPhoneAccountEnabled a échoué, CallKeep sauté:', e));
  }

  // ── Décrocher l'appel : arrête sonnerie/vibration natives SANS tuer le
  // service foreground (notification + wake lock restent actifs pour toute
  // la durée de l'appel). À appeler à la place de endNativeCall() quand
  // l'utilisateur accepte — endNativeCall() reste réservé au refus/raccroché/
  // timeout, qui doivent eux arrêter le service complètement.
  async answerNativeCall (callUuid?: string): Promise<void> {
    const id = callUuid ?? this.activeCallUuid;
    if (id) {
      // CallKeep n'est touché que si le PhoneAccount est activé — sinon
      // l'appel entrant a été géré uniquement par le foreground service
      // natif (voir showIncomingCall) et il n'y a pas de Connection Telecom
      // sur laquelle agir ; appeler setCurrentCallActive() dessus planterait.
      if (this.phoneAccountEnabled) {
        try {
          CallKeep.setCurrentCallActive(id);
        } catch (e) {
          console.warn('[CallKeep] setCurrentCallActive failed:', e);
        }
      }
      // On décroche : le watchdog "sonnerie non résolue" (65s) n'a plus lieu
      // d'être. On le remplace par un filet de sécurité beaucoup plus long
      // (durée max d'appel raisonnable), qui ne gênera jamais un appel KYC
      // normal mais empêchera quand même un verrou bloqué à vie si aucun
      // chemin de fin d'appel n'est jamais rappelé explicitement. Ceci
      // s'applique que CallKeep soit actif ou non.
      this.armWatchdog(id, this.MAX_CALL_DURATION_MS);
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
    if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); this.watchdogTimer = null; }
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
    if (this.watchdogTimer) { clearTimeout(this.watchdogTimer); this.watchdogTimer = null; }
    this.listenersBound = false;
    this.initialized = false;
  }
}

export const notificationService = new NotificationService();