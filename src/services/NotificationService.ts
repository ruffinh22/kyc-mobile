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
  private fcmToken: string | null = null;
  private listenersBound = false;
  private initialized = false;

  // ── Initialisation ──────────────────────────────────────────────────────────
  async init (cbs: NotifCallbacks): Promise<void> {
    this.callbacks = cbs;
    if (this.initialized) return;

    this.initialized = true;
    await this.requestNotificationPermission();
    await this.setupCallKeep();
    await this.setupFCM();
  }

  // ── Permission notifications (Android 13+ / POST_NOTIFICATIONS) ─────────
  private async requestNotificationPermission (): Promise<void> {
    if (Platform.OS !== 'android' || Platform.Version < 33) return;
    try {
      await PermissionsAndroid.request(
        'android.permission.POST_NOTIFICATIONS' as any,
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
    try {
      await CallKeep.setup(CALLKEEP_OPTIONS);
      CallKeep.setAvailable(true);
      this.bindCallKeepEvents();
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
      this.callbacks?.onCallAccepted(callUUID || this.activeCallUuid || '');
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
  private async setupFCM (): Promise<void> {
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
    messaging().onMessage(async (msg) => this.handlePushPayload(msg));

    // App en background — tap sur notification
    messaging().onNotificationOpenedApp((msg) => this.handlePushPayload(msg));

    // App terminée — message data-only HIGH_PRIORITY
    messaging().setBackgroundMessageHandler(async (msg) => this.handlePushPayload(msg));

    // App ouverte depuis une notification
    const initial = await messaging().getInitialNotification();
    if (initial) this.handlePushPayload(initial);
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
  private handlePushPayload (msg: FirebaseMessagingTypes.RemoteMessage): void {
    const data = msg.data;
    if (!data || data.type !== 'incoming-call') return;

    const numeroMtn = String(data.numeroMtn ?? '');
    // Utilise le callUuid fourni par le serveur, ou en génère un local
    const callUuid  = String(data.callUuid ?? `fcm-${Date.now()}`);

    this.activeCallUuid = callUuid;
    this.showIncomingCall(callUuid, numeroMtn);
    this.callbacks?.onIncomingCall(callUuid, numeroMtn);
  }

  // ── Afficher l'écran d'appel natif ──────────────────────────────────────
  showIncomingCall (callUuid: string, numeroMtn: string): void {
    this.activeCallUuid = callUuid;
    callSessionService.startIncomingCallExperience();

    try {
      const nativeCallModule = (NativeModules.KycCallModule as any);
      nativeCallModule?.startForeground?.(numeroMtn);
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

  // ── Terminer l'appel natif ─────────────────────────────────────────────
  endNativeCall (callUuid?: string): void {
    const id = callUuid ?? this.activeCallUuid;
    if (id) {
      CallKeep.endCall(id);
      if (id === this.activeCallUuid) this.activeCallUuid = null;
    }

    callSessionService.stopIncomingCallExperience();

    try {
      const nativeCallModule = (NativeModules.KycCallModule as any);
      nativeCallModule?.stopForeground?.();
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
