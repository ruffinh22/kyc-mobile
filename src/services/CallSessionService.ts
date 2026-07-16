import { Vibration, Platform } from 'react-native';
import Sound from 'react-native-sound';

const VIBRATION_PATTERN = [0, 700, 400, 700, 400, 900];

class CallSessionService {
  private ringtoneRef: Sound | null = null;
  private vibrationTimer: ReturnType<typeof setInterval> | null = null;
  private isActive = false;

  startIncomingCallExperience(): void {
    if (this.isActive) return;
    this.isActive = true;
    this.startRingtone();
    this.startVibration();
  }

  stopIncomingCallExperience(): void {
    if (!this.isActive && !this.ringtoneRef && !this.vibrationTimer) return;
    this.isActive = false;
    this.stopRingtone();
    this.stopVibration();
  }

  private startRingtone(): void {
    if (this.ringtoneRef) return;
    Sound.setCategory('Playback', true);
    const sound = new Sound('ringtone.wav', Sound.MAIN_BUNDLE, (err) => {
      if (err || !this.isActive) {
        if (sound) sound.release();
        return;
      }
      sound.setNumberOfLoops(-1);
      sound.setVolume(Platform.OS === 'ios' ? 0.9 : 1.0);
      sound.play();
      this.ringtoneRef = sound;
    });
  }

  private stopRingtone(): void {
    if (this.ringtoneRef) {
      this.ringtoneRef.stop();
      this.ringtoneRef.release();
      this.ringtoneRef = null;
    }
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
