/**
 * NotificationService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * 1. Firebase Cloud Messaging (FCM) — push même app fermée / écran verrouillé
 * 2. CallKeep — écran d'appel natif Android (Telecom API)
 * 3. Lien FCM payload → CallKeep → navigation
 */

import messaging, { FirebaseMessagingTypes } from '@react-native-firebase/messaging';
import CallKeep from 'react-native-callkeep';
import { Platform, PermissionsAndroid } from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
};

// ─────────────────────────────────────────────────────────────────────────────
class NotificationService {
  private callbacks: NotifCallbacks | null = null;
  private activeCallUuid: string | null = null;
  private fcmToken: string | null = null;

  // ── Initialisation ──────────────────────────────────────────────────────────
  async init (cbs: NotifCallbacks): Promise<void> {
    this.callbacks = cbs;
    await this.setupCallKeep();
    await this.setupFCM();
  }

  // ── Token FCM (sync après init) ──────────────────────────────────────────
  getFCMToken (): string | null {
    return this.fcmToken;
  }

  // ── Setup CallKeep ───────────────────────────────────────────────────────
  private async setupCallKeep (): Promise<void> {
    try {
      await CallKeep.setup(CALLKEEP_OPTIONS);
      CallKeep.setAvailable(true);
      console.log('[CallKeep] Setup successful');
    } catch (e) {
      console.warn('[CallKeep] Setup failed:', e);
    }
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

    // Token FCM — mis en cache mémoire + AsyncStorage
    try {
      const token = await messaging().getToken();
      this.fcmToken = token;
      await AsyncStorage.setItem('fcm_token', token);
      console.log('[FCM] Token enregistré');
    } catch (e) {
      console.warn('[FCM] Impossible d\'obtenir le token:', e);
      // Tente de lire le cache
      this.fcmToken = await AsyncStorage.getItem('fcm_token');
    }

    // Refresh du token
    messaging().onTokenRefresh(async (newToken) => {
      this.fcmToken = newToken;
      await AsyncStorage.setItem('fcm_token', newToken);
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
  }

  // ── Marquer l'appel comme connecté (démarre le timer CallKeep) ──────────
  setCallConnected (callUuid: string): void {
    CallKeep.setCurrentCallActive(callUuid);
  }

  // ── Nettoyage ────────────────────────────────────────────────────────────
  destroy (): void {
    CallKeep.removeEventListener('answerCall');
    CallKeep.removeEventListener('endCall');
    CallKeep.removeEventListener('hangupCall');
  }
}

export const notificationService = new NotificationService();
