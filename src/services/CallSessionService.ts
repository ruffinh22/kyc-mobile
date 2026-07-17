import { Vibration, Platform } from 'react-native';

/**
 * CallSessionService.ts
 * ─────────────────────────────────────────────────────────────────────────────
 * MIGRATION (v2) : la sonnerie n'est plus jouée ici en JS via react-native-sound.
 * Elle est maintenant jouée nativement par KycForegroundCallService (Android),
 * démarrée dès NativeModules.KycCallModule.startForeground() — c'est-à-dire dès
 * que le push arrive, indépendamment de l'état du moteur JS. Ça règle 2 problèmes
 * de l'ancienne version :
 *   1. La sonnerie dépendait d'un fichier .wav chargé via le bridge JS, en échec
 *      silencieux si l'asset n'était pas correctement bundlé côté natif.
 *   2. Sur le tout premier appel app fermée, le JS "headless" devait d'abord finir
 *      d'initialiser CallKeep avant de pouvoir jouer un son — ratant la fenêtre.
 * La vibration JS ci-dessous est conservée uniquement comme repli quand l'app est
 * déjà au premier plan (écran IncomingCallScreen monté) ; sur Android, la
 * vibration native du foreground service est déjà active en parallèle — appeler
 * Vibration.vibrate() par-dessus ne double pas l'effet grâce à Vibration.cancel()
 * qui réinitialise le pattern à chaque appel.
 */
const VIBRATION_PATTERN = [0, 700, 400, 700, 400, 900];

class CallSessionService {
  private vibrationTimer: ReturnType<typeof setInterval> | null = null;
  private isActive = false;

  startIncomingCallExperience(): void {
    if (this.isActive) return;
    this.isActive = true;
    // Sur Android, la sonnerie ET la vibration sont déjà gérées nativement par
    // KycForegroundCallService (voir NotificationService.showIncomingCall).
    // On ne relance la vibration JS que sur iOS, qui n'a pas cette migration.
    if (Platform.OS === 'ios') {
      this.startVibration();
    }
  }

  stopIncomingCallExperience(): void {
    if (!this.isActive && !this.vibrationTimer) return;
    this.isActive = false;
    this.stopVibration();
  }

  private startVibration(): void {
    if (this.vibrationTimer) return;
    Vibration.cancel();
    Vibration.vibrate(VIBRATION_PATTERN, true);
    this.vibrationTimer = setInterval(() => {
      Vibration.vibrate(VIBRATION_PATTERN, true);
    }, 2200);
  }

  private stopVibration(): void {
    Vibration.cancel();
    if (this.vibrationTimer) {
      clearInterval(this.vibrationTimer);
      this.vibrationTimer = null;
    }
  }
}

export const callSessionService = new CallSessionService();