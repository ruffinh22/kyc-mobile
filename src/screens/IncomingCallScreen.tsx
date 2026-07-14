/**
 * IncomingCallScreen.tsx — KYC Mobile V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Appel vidéo entrant : halos pulsants verts, badges MTN, accepter / refuser.
 * Fonctionne même si l'app est en background (CallKeep full-screen intent).
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, Vibration,
} from 'react-native';
import Sound from 'react-native-sound';
import { notificationService } from '../services/NotificationService';
import { signalingService }     from '../services/SignalingService';
import { useCallStore }          from '../store/callStore';
import { C, R, T } from '../theme/tokens';

Sound.setCategory('Playback', true);

const VIBRATION_PATTERN = [0, 600, 350, 600, 350, 600];
const CALL_TIMEOUT_MS   = 45_000;

export function IncomingCallScreen({ route, navigation }: any) {
  const { numeroMtn, callUuid } = route.params ?? {};
  const callStore = useCallStore();

  const halo1    = useRef(new Animated.Value(1)).current;
  const halo2    = useRef(new Animated.Value(1)).current;
  const halo3    = useRef(new Animated.Value(1)).current;
  const haloOp1  = useRef(new Animated.Value(0.55)).current;
  const haloOp2  = useRef(new Animated.Value(0.35)).current;
  const haloOp3  = useRef(new Animated.Value(0.18)).current;
  const ringAnim = useRef(new Animated.Value(0)).current;

  const ringtoneRef    = useRef<Sound | null>(null);
  const vibTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const missedTimerRef = useRef<ReturnType<typeof setTimeout>  | null>(null);

  // ── Halos ────────────────────────────────────────────────────────────────
  const animHalo = (scale: Animated.Value, op: Animated.Value, delay: number, initOp: number) =>
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.22, duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(op,    { toValue: 0,    duration: 1800, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1,      duration: 0, useNativeDriver: true }),
          Animated.timing(op,    { toValue: initOp, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();

  // ── Sonnerie icône rotation ───────────────────────────────────────────────
  const startBellAnim = () =>
    Animated.loop(
      Animated.sequence([
        Animated.timing(ringAnim, { toValue: 1, duration: 200, useNativeDriver: true }),
        Animated.timing(ringAnim, { toValue: -1, duration: 200, useNativeDriver: true }),
        Animated.timing(ringAnim, { toValue: 0.5, duration: 150, useNativeDriver: true }),
        Animated.timing(ringAnim, { toValue: 0, duration: 150, useNativeDriver: true }),
        Animated.delay(1200),
      ])
    ).start();

  const bellRotate = ringAnim.interpolate({ inputRange: [-1, 1], outputRange: ['-18deg', '18deg'] });

  // ── Sonnerie audio ────────────────────────────────────────────────────────
  const startRingtone = () => {
    const sound = new Sound('ringtone.mp3', Sound.MAIN_BUNDLE, (err) => {
      if (err) return;
      sound.setNumberOfLoops(-1);
      sound.setVolume(1.0);
      sound.play();
      ringtoneRef.current = sound;
    });
  };

  const stopAll = () => {
    ringtoneRef.current?.stop();
    ringtoneRef.current?.release();
    ringtoneRef.current = null;
    Vibration.cancel();
    if (vibTimerRef.current)    clearInterval(vibTimerRef.current);
    if (missedTimerRef.current) clearTimeout(missedTimerRef.current);
  };

  useEffect(() => {
    animHalo(halo1, haloOp1, 0,    0.55);
    animHalo(halo2, haloOp2, 500,  0.35);
    animHalo(halo3, haloOp3, 1000, 0.18);
    startBellAnim();
    startRingtone();
    Vibration.vibrate(VIBRATION_PATTERN, true);
    vibTimerRef.current = setInterval(() => Vibration.vibrate(VIBRATION_PATTERN, true), 3500);
    missedTimerRef.current = setTimeout(() => {
      stopAll();
      notificationService.endNativeCall(callUuid);
      signalingService.refuseCall();
      callStore.resetCall();
      navigation.replace('Idle');
    }, CALL_TIMEOUT_MS);
    return () => stopAll();
  }, []);

  const handleAccept = async () => {
    stopAll();
    notificationService.endNativeCall(callUuid);
    callStore.setConnecting();
    try {
      await signalingService.acceptCall();
      navigation.replace('Call', { callUuid, numeroMtn });
    } catch {
      signalingService.refuseCall();
      callStore.resetCall();
      navigation.replace('Idle');
    }
  };

  const handleDecline = () => {
    stopAll();
    notificationService.endNativeCall(callUuid);
    signalingService.refuseCall();
    callStore.resetCall();
    navigation.replace('Idle');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} translucent />

      {/* ── Header ──────────────────────────────────────────────────────── */}
      <View style={s.top}>
        <View style={s.topBadge}>
          <View style={s.topDot} />
          <Text style={s.topLabel}>APPEL VIDÉO ENTRANT</Text>
        </View>
        <Text style={s.topSub}>Certification KYC MTN Congo</Text>
      </View>

      {/* ── Avatar animé ───────────────────────────────────────────────── */}
      <View style={s.center}>
        <View style={s.haloWrap}>
          <Animated.View style={[s.halo, s.haloOuter, { transform: [{ scale: halo3 }], opacity: haloOp3 }]} />
          <Animated.View style={[s.halo, s.haloMid,   { transform: [{ scale: halo2 }], opacity: haloOp2 }]} />
          <Animated.View style={[s.halo, s.haloInner, { transform: [{ scale: halo1 }], opacity: haloOp1 }]} />

          {/* Icône sonnerie animée */}
          <View style={s.iconCircle}>
            <Animated.Text style={[s.iconTxt, { transform: [{ rotate: bellRotate }] }]}>
              🔔
            </Animated.Text>
          </View>
        </View>

        {/* Caller info */}
        <View style={s.callerBlock}>
          {/* Badge MTN */}
          <View style={s.mtnTag}>
            <View style={s.mtnTagDot} />
            <Text style={s.mtnTagTxt}>Centre de Certification MTN</Text>
          </View>
          <Text style={s.callerName}>Vérification en cours</Text>
          <Text style={s.callerSub}>Numéro à certifier</Text>
        </View>

        {/* Numéro MTN */}
        <View style={s.numCard}>
          <Text style={s.numCardLabel}>NUMÉRO MTN</Text>
          <Text style={s.numCardVal}>{numeroMtn}</Text>
        </View>
      </View>

      {/* ── Boutons ─────────────────────────────────────────────────────── */}
      <View style={s.actions}>
        {/* Refuser */}
        <View style={s.actionCol}>
          <TouchableOpacity style={[s.actionBtn, s.btnDecline]} onPress={handleDecline} activeOpacity={0.85}>
            <Text style={s.actionIcon}>✕</Text>
          </TouchableOpacity>
          <Text style={s.actionLabel}>Refuser</Text>
        </View>

        {/* Accepter */}
        <View style={s.actionCol}>
          <TouchableOpacity style={[s.actionBtn, s.btnAccept]} onPress={handleAccept} activeOpacity={0.85}>
            <Text style={s.actionIcon}>📹</Text>
          </TouchableOpacity>
          <Text style={[s.actionLabel, { color: C.successText }]}>Accepter</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0, justifyContent: 'space-between', paddingVertical: 56 },

  // ── Top ──
  top: { alignItems: 'center', paddingTop: 8 },
  topBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 7,
    backgroundColor: C.successSoft,
    borderWidth: 1, borderColor: C.successBorder,
    borderRadius: R.pill, paddingVertical: 6, paddingHorizontal: 14,
    marginBottom: 8,
  },
  topDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  topLabel: { fontSize: T.xs, fontWeight: '700', color: C.success, letterSpacing: 1.5 },
  topSub:   { fontSize: T.xs, color: C.ink3 },

  // ── Centre ──
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  haloWrap: { width: 260, height: 260, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  halo: {
    position: 'absolute', borderRadius: 999,
    borderWidth: 1.5, borderColor: 'rgba(0,135,90,0.45)',
  },
  haloInner: { width: 150, height: 150 },
  haloMid:   { width: 200, height: 200 },
  haloOuter: { width: 255, height: 255 },

  iconCircle: {
    width: 110, height: 110, borderRadius: 55,
    backgroundColor: C.success,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,204,0,0.30)',
    shadowColor: C.success, shadowOpacity: 0.50, shadowRadius: 28, elevation: 18,
  },
  iconTxt: { fontSize: 44 },

  callerBlock: { alignItems: 'center', gap: 6, marginBottom: 20 },
  mtnTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: C.blueLight,
    borderWidth: 1, borderColor: C.blueBorder,
    borderRadius: R.pill, paddingVertical: 5, paddingHorizontal: 12,
  },
  mtnTagDot: { width: 5, height: 5, borderRadius: 3, backgroundColor: C.yellow },
  mtnTagTxt: { fontSize: T.xs, fontWeight: '700', color: C.ink2 },
  callerName: { fontSize: T.xl, fontWeight: '900', color: C.ink, letterSpacing: -0.4 },
  callerSub:  { fontSize: T.sm, color: C.ink3 },

  numCard: {
    backgroundColor: C.bg1,
    borderWidth: 1.5, borderColor: C.yellowBorder,
    borderRadius: R.lg, paddingVertical: 14, paddingHorizontal: 28,
    alignItems: 'center',
  },
  numCardLabel: { fontSize: T.xs, fontWeight: '700', color: C.ink3, letterSpacing: 1.5, marginBottom: 4 },
  numCardVal:   { fontSize: T['2xl'], fontWeight: '900', color: C.yellow, fontVariant: ['tabular-nums'] },

  // ── Actions ──
  actions: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 48, paddingBottom: 8,
  },
  actionCol: { alignItems: 'center', gap: 10 },
  actionBtn: { width: 80, height: 80, borderRadius: 40, alignItems: 'center', justifyContent: 'center' },
  btnDecline: {
    backgroundColor: C.danger,
    shadowColor: C.danger, shadowOpacity: 0.55, shadowRadius: 20, elevation: 12,
  },
  btnAccept: {
    backgroundColor: C.success,
    shadowColor: C.success, shadowOpacity: 0.55, shadowRadius: 20, elevation: 12,
  },
  actionIcon:  { fontSize: 30, color: '#fff' },
  actionLabel: { fontSize: T.sm, fontWeight: '600', color: C.ink3 },
});