/**
 * CallScreen.tsx — KYC Mobile V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Vidéo WebRTC plein écran · PiP local · topbar MTN · contrôles glassmorphism
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  StatusBar, Platform, Animated, Easing, NativeModules,
} from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { keepAwake } from '../utils/keepAwake';
import { signalingService }    from '../services/SignalingService';
import { notificationService } from '../services/NotificationService';
import { useCallStore }         from '../store/callStore';
import { C, R, T } from '../theme/tokens';

export function CallScreen({ route, navigation }: any) {
  useEffect(() => {
    keepAwake.activate();
    return () => keepAwake.deactivate();
  }, []);

  const { callUuid, numeroMtn } = route.params ?? {};
  const RTCView = useMemo(() => {
    // Delay loading heavy native WebRTC code until the call screen is actually rendered.
    return require('react-native-webrtc').RTCView;
  }, []);
  const callStore = useCallStore();

  const [localStream,  setLocalStream]  = useState<MediaStream | null>(null);
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(null);
  const [isMicOn,      setIsMicOn]      = useState(true);
  const [isCameraOn,   setIsCameraOn]   = useState(true);
  const [statusTxt,    setStatusTxt]    = useState('Connexion…');
  const [timerSec,     setTimerSec]     = useState(0);
  const [hasRemote,    setHasRemote]    = useState(false);
  const [controlsVis,  setControlsVis]  = useState(true);
  const [reconnecting, setReconnecting] = useState(false);

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim    = useRef(new Animated.Value(1)).current;

  // ── Foreground service natif (notification persistante + wake lock) ──────
  // Sans cet appel, KycForegroundCallService n'est jamais démarré : pas de
  // notification "appel en cours", pas de wake lock, et Android peut tuer
  // l'appel dès que l'app passe en arrière-plan.
  useEffect(() => {
    if (Platform.OS === 'android' && NativeModules.KycCallModule?.startForeground) {
      try { NativeModules.KycCallModule.startForeground(numeroMtn || ''); }
      catch (e) { console.warn('[CallScreen] startForeground natif indisponible:', e); }
    }
    return () => {
      if (Platform.OS === 'android' && NativeModules.KycCallModule?.stopForeground) {
        try { NativeModules.KycCallModule.stopForeground(); }
        catch (e) { console.warn('[CallScreen] stopForeground natif indisponible:', e); }
      }
    };
  }, []);

  // ── Abonnement streams ────────────────────────────────────────────────────
  useEffect(() => {
    const unsub = signalingService.addStreamListener((event) => {
      switch (event.type) {
        case 'local':
          setLocalStream(event.stream); break;
        case 'remote':
          setRemoteStream(event.stream);
          setHasRemote(true);
          setStatusTxt('Connecté');
          notificationService.setCallConnected(callUuid);
          startTimer();
          break;
        case 'reconnecting':
          setReconnecting(true);
          setStatusTxt('Reconnexion…');
          break;
        case 'reconnected':
          setReconnecting(false);
          setStatusTxt('Connecté');
          break;
        case 'ended':
          handleEndCall(false); break;
      }
    });
    return () => { unsub(); stopTimer(); };
  }, []);

  // ── Contrôles auto-hide ───────────────────────────────────────────────────
  const showControls = () => {
    if (hideTimeout.current) clearTimeout(hideTimeout.current);
    setControlsVis(true);
    Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    hideTimeout.current = setTimeout(() => {
      Animated.timing(fadeAnim, { toValue: 0, duration: 400, useNativeDriver: true }).start(
        () => setControlsVis(false)
      );
    }, 4000);
  };

  useEffect(() => { if (hasRemote) showControls(); }, [hasRemote]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const startTimer = () => {
    setTimerSec(0);
    timerRef.current = setInterval(() => setTimerSec(s => s + 1), 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const fmt = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(sec % 60).padStart(2,'0')}`;

  // ── Raccrocher ────────────────────────────────────────────────────────────
  const handleEndCall = useCallback((notify = true) => {
    stopTimer();
    notificationService.endNativeCall(callUuid);
    if (notify) signalingService.hangUp();
    callStore.resetCall();
    navigation.replace('Idle');
  }, [callUuid, navigation, callStore]);

  const handleToggleMic    = () => { const on = signalingService.toggleMic();    setIsMicOn(on);    callStore.setMicOn(on);    showControls(); };
  const handleToggleCamera = () => { const on = signalingService.toggleCamera(); setIsCameraOn(on); callStore.setCameraOn(on); showControls(); };
  const handleSwitchCamera = async () => { try { await signalingService.switchCamera(); } catch {} showControls(); };

  const dotColor = reconnecting ? C.warn : hasRemote ? C.success : C.warn;

  // Pendant une reconnexion, on garde les contrôles visibles (l'utilisateur
  // doit pouvoir raccrocher facilement s'il le souhaite).
  useEffect(() => {
    if (reconnecting) {
      if (hideTimeout.current) clearTimeout(hideTimeout.current);
      setControlsVis(true);
      Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
    }
  }, [reconnecting]);

  return (
    <View style={s.root}>
      <StatusBar hidden />

      {/* ── Vidéo distante plein écran ────────────────────────────────────── */}
      {remoteStream ? (
        <RTCView streamURL={remoteStream.toURL()} style={s.remoteVideo} objectFit="cover" mirror={false} />
      ) : (
        <View style={s.placeholder}>
          <Animated.View style={[s.placeholderRing, {
            transform: [{ scale: useRef(new Animated.Value(1)).current }],
          }]} />
          <Text style={s.placeholderIcon}>📹</Text>
          <Text style={s.placeholderTxt}>Connexion vidéo en cours…</Text>
        </View>
      )}

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <Animated.View style={[s.topbar, { opacity: fadeAnim }]} pointerEvents={controlsVis ? 'auto' : 'none'}>
        {/* Status */}
        <View style={s.statusRow}>
          <View style={[s.dot, { backgroundColor: dotColor }]} />
          <Text style={s.statusTxt}>{statusTxt}</Text>
        </View>

        {/* Numéro MTN centré */}
        <View style={s.numTag}>
          <Text style={s.numTagLabel}>MTN</Text>
          <Text style={s.numTagVal}>{numeroMtn}</Text>
        </View>

        {/* Timer */}
        <View style={s.timerWrap}>
          <Text style={s.timerTxt}>{fmt(timerSec)}</Text>
        </View>
      </Animated.View>

      {/* ── Bandeau de reconnexion ───────────────────────────────────────── */}
      {reconnecting && (
        <View style={s.reconnectBanner} pointerEvents="none">
          <View style={s.reconnectDotWrap}>
            <View style={s.reconnectDot} />
          </View>
          <Text style={s.reconnectTxt}>Connexion instable — reconnexion en cours…</Text>
        </View>
      )}

      {/* ── PiP local ─────────────────────────────────────────────────────── */}
      {localStream && (
        <RTCView
          streamURL={localStream.toURL()}
          style={s.pip}
          objectFit="cover"
          mirror
          zOrder={1}
        />
      )}

      {/* ── Contrôles ────────────────────────────────────────────────────── */}
      <Animated.View style={[s.controls, { opacity: fadeAnim }]} pointerEvents={controlsVis ? 'auto' : 'none'}>
        {/* Micro */}
        <TouchableOpacity style={s.ctrl} onPress={handleToggleMic}>
          <View style={[s.ctrlCircle, !isMicOn && s.ctrlActive]}>
            <Text style={s.ctrlIcon}>{isMicOn ? '🎤' : '🔇'}</Text>
          </View>
          <Text style={s.ctrlLabel}>{isMicOn ? 'Micro' : 'Coupé'}</Text>
        </TouchableOpacity>

        {/* Raccrocher — plus grand, rouge */}
        <TouchableOpacity style={s.ctrl} onPress={() => handleEndCall(true)}>
          <View style={[s.ctrlCircle, s.ctrlHangup]}>
            <Text style={s.ctrlIcon}>📵</Text>
          </View>
          <Text style={[s.ctrlLabel, { color: C.dangerText }]}>Raccrocher</Text>
        </TouchableOpacity>

        {/* Caméra */}
        <TouchableOpacity style={s.ctrl} onPress={handleToggleCamera}>
          <View style={[s.ctrlCircle, !isCameraOn && s.ctrlActive]}>
            <Text style={s.ctrlIcon}>{isCameraOn ? '📷' : '🚫'}</Text>
          </View>
          <Text style={s.ctrlLabel}>{isCameraOn ? 'Caméra' : 'Coupée'}</Text>
        </TouchableOpacity>

        {/* Retourner */}
        <TouchableOpacity style={s.ctrl} onPress={handleSwitchCamera}>
          <View style={s.ctrlCircle}>
            <Text style={s.ctrlIcon}>🔄</Text>
          </View>
          <Text style={s.ctrlLabel}>Retourner</Text>
        </TouchableOpacity>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#050508' },

  // ── Vidéo ──
  remoteVideo: { position: 'absolute', top: 0, left: 0, right: 0, bottom: 0 },

  placeholder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#070914',
  },
  placeholderRing: {
    position: 'absolute',
    width: 200, height: 200, borderRadius: 100,
    borderWidth: 1.5, borderColor: 'rgba(0,48,135,0.30)',
  },
  placeholderIcon: { fontSize: 52, opacity: 0.25 },
  placeholderTxt:  { fontSize: T.sm, color: C.ink3, marginTop: 12 },

  // ── Topbar ──
  topbar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 54 : 32,
    paddingHorizontal: 16, paddingBottom: 14,
    backgroundColor: 'rgba(4,8,18,0.88)',
    borderBottomWidth: 1, borderBottomColor: 'rgba(255,255,255,0.12)',
  },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 6, flex: 1 },
  dot:       { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: T.xs, fontWeight: '600', color: '#F8FAFC' },

  numTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(0,48,135,0.70)',
    borderWidth: 1, borderColor: 'rgba(255,204,0,0.35)',
    borderRadius: R.pill, paddingVertical: 6, paddingHorizontal: 12,
  },
  numTagLabel: { fontSize: T.xs, fontWeight: '800', color: C.yellow },
  numTagVal:   { fontSize: T.sm, fontWeight: '700', color: '#F8FAFC', fontVariant: ['tabular-nums'] },

  timerWrap: { flex: 1, alignItems: 'flex-end' },
  timerTxt:  { fontSize: T.sm, fontWeight: '700', color: 'rgba(255,255,255,0.75)', fontVariant: ['tabular-nums'] },

  // ── Bandeau reconnexion ──
  reconnectBanner: {
    position: 'absolute', top: Platform.OS === 'ios' ? 108 : 84, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(245,158,11,0.16)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.45)',
    borderRadius: R.pill, paddingVertical: 8, paddingHorizontal: 14,
    alignSelf: 'center',
  },
  reconnectDotWrap: { width: 8, height: 8 },
  reconnectDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: C.warn },
  reconnectTxt: { fontSize: T.xs, fontWeight: '600', color: '#FDE68A' },

  // ── PiP ──
  pip: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 148 : 126,
    right: 14,
    width: 96, height: 136,
    borderRadius: R.lg,
    borderWidth: 2, borderColor: 'rgba(255,204,0,0.22)',
    overflow: 'hidden',
  },

  // ── Contrôles ──
  controls: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'center',
    paddingTop: 24,
    paddingBottom: Platform.OS === 'ios' ? 48 : 28,
    paddingHorizontal: 16,
    backgroundColor: 'rgba(6,13,31,0.97)',
    borderTopWidth: 1, borderTopColor: 'rgba(255,255,255,0.12)',
  },
  ctrl:       { alignItems: 'center', gap: 7 },
  ctrlCircle: {
    width: 58, height: 58, borderRadius: 29,
    backgroundColor: 'rgba(255,255,255,0.13)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  ctrlActive: {
    backgroundColor: C.dangerSoft,
    borderColor: C.dangerBorder,
  },
  ctrlHangup: {
    width: 66, height: 66, borderRadius: 33,
    backgroundColor: C.danger,
    borderColor: 'transparent',
    shadowColor: C.danger, shadowOpacity: 0.60, shadowRadius: 18, elevation: 12,
  },
  ctrlIcon:  { fontSize: 22 },
  ctrlLabel: { fontSize: T.xs, fontWeight: '500', color: 'rgba(255,255,255,0.55)' },
});