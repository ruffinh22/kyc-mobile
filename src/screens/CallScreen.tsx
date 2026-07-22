/**
 * CallScreen.tsx — KYC Mobile V5
 * ─────────────────────────────────────────────────────────────────────────────
 * Vidéo WebRTC plein écran · PiP local · topbar institutionnelle sobre ·
 * contrôles vectoriels avec retour tactile.
 */
import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import type { ComponentType } from 'react';
import {
  View, Text, Pressable, StyleSheet,
  StatusBar, Platform, Animated, Easing,
} from 'react-native';
import type { MediaStream } from 'react-native-webrtc';
import { keepAwake } from '../utils/keepAwake';
import { signalingService }    from '../services/SignalingService';
import { notificationService } from '../services/NotificationService';
import { useCallStore }         from '../store/callStore';
import { callHistoryService } from '../services/CallHistoryService';
import { C, R, T } from '../theme/tokens';

// ── Palette institutionnelle (cohérente avec IncomingCallScreen) ───────────
const INK        = '#050810';
const PLACEHOLDER = '#0B111E';
const HAIRLINE   = 'rgba(255,255,255,0.10)';
const PANEL      = 'rgba(255,255,255,0.06)';
const TEXT_MUTED = 'rgba(226,232,240,0.60)';
const TEXT_SOFT  = 'rgba(226,232,240,0.85)';
const GOLD       = C.yellow ?? '#FFCC00';

type IconName = 'mic' | 'mic-off' | 'phone-off' | 'video' | 'video-off' | 'refresh-cw' | 'clock' | 'wifi-off' | 'rotate-cw';

// ── Icônes simples sans dépendance native SVG ─────────────────────────────
const iconMap: Record<IconName, ComponentType<{ size?: number; color?: string }>> = {
  mic: (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>🎤</Text>) as ComponentType<{ size?: number; color?: string }>,
  'mic-off': (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>🔇</Text>) as ComponentType<{ size?: number; color?: string }>,
  'phone-off': (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>📞</Text>) as ComponentType<{ size?: number; color?: string }>,
  video: (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>📹</Text>) as ComponentType<{ size?: number; color?: string }>,
  'video-off': (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>🚫📹</Text>) as ComponentType<{ size?: number; color?: string }>,
  'refresh-cw': (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>↻</Text>) as ComponentType<{ size?: number; color?: string }>,
  clock: (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>🕒</Text>) as ComponentType<{ size?: number; color?: string }>,
  'wifi-off': (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>📡</Text>) as ComponentType<{ size?: number; color?: string }>,
  'rotate-cw': (({ size = 20, color = '#fff' }) => <Text style={{ fontSize: size, color }}>🔄</Text>) as ComponentType<{ size?: number; color?: string }>,
};

// ── Bouton de contrôle circulaire avec retour d'appui ───────────────────────
function CtrlButton({
  icon, label, active, danger, big, onPress,
}: {
  icon: IconName;
  label: string;
  active?: boolean;
  danger?: boolean;
  big?: boolean;
  onPress: () => void;
}) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 6 }).start();
  const Icon = iconMap[icon];

  return (
    <View style={s.ctrl}>
      <Pressable
        onPressIn={() => press(0.90)}
        onPressOut={() => press(1)}
        onPress={onPress}
        hitSlop={8}
        accessibilityRole="button"
        accessibilityLabel={label}
        accessibilityState={{ selected: !!active }}
      >
        <Animated.View
          style={[
            s.ctrlCircle,
            big && s.ctrlCircleBig,
            active && s.ctrlActive,
            danger && s.ctrlHangup,
            { transform: [{ scale }] },
          ]}
        >
          <Icon
            size={big ? 27 : 22}
            color={danger ? '#FFFFFF' : active ? GOLD : TEXT_SOFT}
          />
        </Animated.View>
      </Pressable>
      <Text style={[s.ctrlLabel, active && { color: GOLD }, danger && { color: C.dangerText }]}>{label}</Text>
    </View>
  );
}

type CallScreenParams = { callUuid: string; numeroMtn: string };
type CallScreenProps = {
  route: { params: CallScreenParams };
  navigation: { replace: (screen: string, params?: object) => void };
};

export function CallScreen({ route, navigation }: CallScreenProps) {
  useEffect(() => {
    keepAwake.activate();
    return () => keepAwake.deactivate();
  }, []);

  const callStore = useCallStore();
  const { callUuid: routeCallUuid, numeroMtn } = route.params ?? {};
  const callUuid = routeCallUuid || callStore.callUuid;
  const RTCView = useMemo(() => {
    // Delay loading heavy native WebRTC code until the call screen is actually rendered.
    return require('react-native-webrtc').RTCView;
  }, []);

  // Initialisés depuis l'état déjà connu du service : si l'offer/answer/ICE
  // s'est terminé pendant que l'agent voyait encore IncomingCallScreen (aucun
  // écran n'écoutait alors), on ne part pas d'un écran vide qui attendrait un
  // événement qui ne se reproduira jamais.
  const [localStream,  setLocalStream]  = useState<MediaStream | null>(() => signalingService.getLocalStream());
  const [remoteStream, setRemoteStream] = useState<MediaStream | null>(() => signalingService.getRemoteStream());
  const [isMicOn,      setIsMicOn]      = useState(true);
  const [isCameraOn,   setIsCameraOn]   = useState(true);
  const initialRemote = signalingService.getRemoteStream();
  const [statusTxt,    setStatusTxt]    = useState(initialRemote ? 'Connecté' : 'Connexion…');
  const [callReady,    setCallReady]    = useState(!!initialRemote);
  const [timerSec,     setTimerSec]     = useState(0);
  const [hasRemote,    setHasRemote]    = useState(!!initialRemote);
  const [controlsVis,  setControlsVis]  = useState(true);
  const [reconnecting, setReconnecting] = useState(false);
  const [lowNetwork, setLowNetwork] = useState(false);
  const [retryCount, setRetryCount] = useState(0);
  const [connectionPhase, setConnectionPhase] = useState<'connecting' | 'reconnecting' | 'fallback' | 'connected' | 'paused'>(initialRemote ? 'connected' : 'connecting');

  const timerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const callStartAt = useRef<number | null>(null);
  const hideTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fallbackTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fadeAnim    = useRef(new Animated.Value(1)).current;
  const progressAnim = useRef(new Animated.Value(0.2)).current;
  const pulseScale  = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.35)).current;

  // ── Foreground service natif ──────────────────────────────────────────
  // Le service tourne déjà en continu depuis IncomingCallScreen.handleAccept()
  // (answerNativeCall → ACTION_ANSWER, sonnerie arrêtée, service+notification
  // maintenus). On NE rappelle PAS startForeground ici : sur Android, cette
  // méthode déclenche maintenant l'action "sonner" côté natif (voir
  // KycForegroundCallService) — la relancer ici referait sonner l'appareil
  // en pleine conversation. L'arrêt se fait via notificationService.endNativeCall()
  // dans handleEndCall, pas ici.

  // ── Abonnement streams ────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;

    const startCallFlow = async () => {
      try {
        await signalingService.acceptCall();
        if (!cancelled) setStatusTxt('Connexion vidéo…');
      } catch (e) {
        console.warn('[CallScreen] acceptCall failed', e);
        if (!cancelled) setStatusTxt('Connexion impossible');
      }
    };

    startCallFlow();

    const unsub = signalingService.addStreamListener((event) => {
      switch (event.type) {
        case 'local':
          setLocalStream(event.stream); break;
        case 'remote':
          setRemoteStream(event.stream);
          setHasRemote(true);
          setCallReady(true);
          setConnectionPhase('connected');
          setStatusTxt('Connecté');
          notificationService.setCallConnected(callUuid);
          startTimer();
          break;
        case 'reconnecting':
          setReconnecting(true);
          setLowNetwork(true);
          setConnectionPhase('reconnecting');
          setStatusTxt('Reconnexion…');
          break;
        case 'reconnected':
          setReconnecting(false);
          setLowNetwork(false);
          setConnectionPhase('connected');
          setStatusTxt('Connecté');
          break;
        case 'ended':
          handleEndCall(false); break;
      }
    });
    return () => { cancelled = true; unsub(); stopTimer(); };
  }, []);

  useEffect(() => {
    const target = connectionPhase === 'connected' ? 1 : connectionPhase === 'reconnecting' || connectionPhase === 'paused' ? 0.72 : connectionPhase === 'fallback' ? 0.45 : 0.2;
    Animated.timing(progressAnim, { toValue: target, duration: 500, easing: Easing.out(Easing.ease), useNativeDriver: false }).start();
  }, [connectionPhase, progressAnim]);

  useEffect(() => {
    const pulseLoop = Animated.loop(
      Animated.parallel([
        Animated.sequence([
          Animated.timing(pulseScale, { toValue: 1.07, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseScale, { toValue: 1, duration: 1400, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(pulseOpacity, { toValue: 0.6, duration: 1400, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(pulseOpacity, { toValue: 0.2, duration: 1400, easing: Easing.in(Easing.ease), useNativeDriver: true }),
        ]),
      ])
    );
    pulseLoop.start();
    return () => pulseLoop.stop();
  }, [pulseOpacity, pulseScale]);

  useEffect(() => {
    if (remoteStream) {
      if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
      return;
    }
    if (reconnecting || lowNetwork) {
      if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
      return;
    }
    if (fallbackTimerRef.current) clearTimeout(fallbackTimerRef.current);
    fallbackTimerRef.current = setTimeout(() => {
      setConnectionPhase('fallback');
      setStatusTxt('Flux distant indisponible');
    }, 8000);
    return () => {
      if (fallbackTimerRef.current) { clearTimeout(fallbackTimerRef.current); fallbackTimerRef.current = null; }
    };
  }, [remoteStream, reconnecting]);

  // ── Contrôles auto-hide ───────────────────────────────────────────────────
  const showControls = useCallback(() => {
    if (hideTimeout.current) {
      clearTimeout(hideTimeout.current);
      hideTimeout.current = null;
    }
    setControlsVis(true);
    Animated.timing(fadeAnim, { toValue: 1, duration: 180, useNativeDriver: true }).start();
  }, [fadeAnim]);

  useEffect(() => {
    if (remoteStream || hasRemote || callReady) {
      showControls();
    }
  }, [remoteStream, hasRemote, callReady, showControls]);

  // ── Timer ─────────────────────────────────────────────────────────────────
  const startTimer = () => {
    callStartAt.current = Date.now();
    setTimerSec(0);
    callStore.setCallDuration(0);
    timerRef.current = setInterval(() => {
      setTimerSec(s => {
        const next = s + 1;
        callStore.setCallDuration(next);
        return next;
      });
    }, 1000);
  };
  const stopTimer = () => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
  };
  const fmt = (sec: number) =>
    `${String(Math.floor(sec / 60)).padStart(2,'0')}:${String(sec % 60).padStart(2,'0')}`;

  // ── Raccrocher ────────────────────────────────────────────────────────────
  const handleEndCall = useCallback((notify = true) => {
    stopTimer();
    const finalDuration = callStartAt.current ? Math.max(0, Math.round((Date.now() - callStartAt.current) / 1000)) : timerSec || callStore.callDuration;
    notificationService.endNativeCall(callUuid);
    if (notify) signalingService.hangUp();
    if (callUuid) {
      void callHistoryService.upsert({ callUuid, numeroMtn, durationSec: finalDuration });
    }
    callStore.resetCall();
    navigation.replace('Idle');
  }, [callUuid, numeroMtn, navigation, callStore, timerSec]);

  const handleToggleMic    = () => { const on = signalingService.toggleMic();    setIsMicOn(on);    callStore.setMicOn(on);    showControls(); };
  const handleToggleCamera = () => { const on = signalingService.toggleCamera(); setIsCameraOn(on); callStore.setCameraOn(on); showControls(); };
  const handleSwitchCamera = async () => { try { await signalingService.switchCamera(); } catch {} showControls(); };
  const handleRetryConnection = async () => {
    setRetryCount(c => c + 1);
    setConnectionPhase('connecting');
    setLowNetwork(false);
    setReconnecting(false);
    setStatusTxt('Nouvelle tentative…');
    try {
      await signalingService.acceptCall();
      setStatusTxt('Connexion vidéo…');
    } catch {
      setConnectionPhase('paused');
      setStatusTxt('Réessai impossible');
    }
  };

  const dotColor = connectionPhase === 'connected' ? C.success : C.warn;
  const phaseTitle = connectionPhase === 'connected'
    ? 'Appel établi'
    : connectionPhase === 'reconnecting'
      ? 'Reconnexion'
      : connectionPhase === 'paused'
        ? 'Appel en pause'
        : connectionPhase === 'fallback'
          ? 'Attente du flux distant'
          : 'Connexion en cours';
  const phaseSubtitle = connectionPhase === 'connected'
    ? 'Le flux vidéo est prêt et stable.'
    : connectionPhase === 'reconnecting'
      ? 'Le réseau est instable, la reprise est en cours.'
      : connectionPhase === 'paused'
        ? 'Le flux a été mis en pause temporairement. Réessayez quand la qualité réseau le permettra.'
        : connectionPhase === 'fallback'
          ? 'Le flux distant n\u2019est pas encore visible. Vérifiez votre connectivité.'
          : 'Négociation du canal vidéo en cours…';
  const progressWidth = progressAnim.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

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
        <Pressable style={s.remoteVideoContainer} onPress={showControls}>
          <RTCView
            key={remoteStream.toURL()}
            streamURL={remoteStream.toURL()}
            style={s.remoteVideo}
            objectFit="contain"
            mirror={false}
          />
        </Pressable>
      ) : (
        <Pressable style={s.placeholder} onPress={showControls}>
          <Animated.View style={[s.placeholderRing, {
            transform: [{ scale: pulseScale }],
            opacity: pulseOpacity,
          }]} />
          <View style={s.placeholderPanel}>
            <View style={s.badgeRow}>
              <View style={[s.badgeDot, { backgroundColor: dotColor }]} />
              <Text style={s.badgeText}>{phaseTitle}</Text>
            </View>
            <Text style={s.placeholderTitle}>{callReady ? 'Flux prêt' : 'Connexion vidéo en cours…'}</Text>
            <Text style={s.placeholderSubtitle}>{phaseSubtitle}</Text>
            <View style={s.progressTrack}>
              <Animated.View style={[s.progressFill, { width: progressWidth }]} />
            </View>
            {(connectionPhase === 'paused' || connectionPhase === 'fallback') && (
              <Pressable style={s.retryButton} onPress={handleRetryConnection}>
                <Text style={{ fontSize: 14, color: GOLD, marginRight: 6 }}>↻</Text>
                <Text style={s.retryText}>Reprendre l'appel</Text>
              </Pressable>
            )}
          </View>
        </Pressable>
      )}

      {/* ── Topbar ───────────────────────────────────────────────────────── */}
      <Animated.View style={[s.topbar, { opacity: fadeAnim }]} pointerEvents={controlsVis ? 'auto' : 'none'}>
        <View style={s.topbarRow}>
          <View style={s.statusRow}>
            <View style={[s.dot, { backgroundColor: dotColor }]} />
            <Text style={s.statusTxt}>{statusTxt}</Text>
          </View>
          <View style={s.timerWrap}>
            <Text style={s.timerLabel}>Durée</Text>
            <Text style={s.timerTxt}>{fmt(timerSec)}</Text>
          </View>
        </View>

        <View style={s.identityRow}>
          <View style={s.numTag}>
            <Text style={s.numTagLabel}>MTN</Text>
            <View style={s.numTagDivider} />
            <Text style={s.numTagVal}>{numeroMtn}</Text>
          </View>
          {(lowNetwork || reconnecting || connectionPhase === 'paused') && (
            <View style={s.networkBadge}>
              <Text style={{ fontSize: 11, color: '#FDE68A' }}>📡</Text>
              <Text style={s.networkBadgeText}>Réseau faible</Text>
            </View>
          )}
        </View>
      </Animated.View>

      {/* ── Bandeau de reconnexion ───────────────────────────────────────── */}
      {reconnecting && (
        <View style={s.reconnectBanner} pointerEvents="none">
          <Text style={{ fontSize: 13, color: '#FDE68A' }}>🔄</Text>
          <Text style={s.reconnectTxt}>Connexion instable — reconnexion en cours…</Text>
        </View>
      )}

      {/* ── PiP local ─────────────────────────────────────────────────────── */}
      {localStream && (
        <View style={s.pipWrap}>
          <RTCView
            streamURL={localStream.toURL()}
            style={s.pip}
            objectFit="cover"
            mirror
            zOrder={1}
          />
          {!isMicOn && (
            <View style={s.pipMuteBadge}>
              <Text style={{ fontSize: 11, color: '#FFFFFF' }}>🔇</Text>
            </View>
          )}
        </View>
      )}

      {/* ── Contrôles ────────────────────────────────────────────────────── */}
      <Animated.View style={[s.controls, { opacity: fadeAnim }]} pointerEvents={controlsVis ? 'auto' : 'none'}>
        <View style={s.controlsHandle} />
        <View style={s.controlsRow}>
          <CtrlButton
            icon={isMicOn ? 'mic' : 'mic-off'}
            label={isMicOn ? 'Micro' : 'Coupé'}
            active={!isMicOn}
            onPress={handleToggleMic}
          />
          <CtrlButton
            icon="phone-off"
            label="Raccrocher"
            danger
            big
            onPress={() => handleEndCall(true)}
          />
          <CtrlButton
            icon={isCameraOn ? 'video' : 'video-off'}
            label={isCameraOn ? 'Caméra' : 'Coupée'}
            active={!isCameraOn}
            onPress={handleToggleCamera}
          />
          <CtrlButton
            icon="refresh-cw"
            label="Retourner"
            onPress={handleSwitchCamera}
          />
        </View>
      </Animated.View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK },

  // ── Vidéo ──
  remoteVideoContainer: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    backgroundColor: INK,
    overflow: 'hidden',
  },
  remoteVideo: {
    flex: 1,
    width: '100%',
    height: '100%',
    backgroundColor: INK,
  },

  placeholder: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center',
    backgroundColor: PLACEHOLDER,
  },
  placeholderRing: {
    position: 'absolute',
    width: 210, height: 210, borderRadius: 105,
    borderWidth: 1.5, borderColor: 'rgba(255,204,0,0.25)',
  },
  placeholderPanel: {
    width: '82%',
    maxWidth: 360,
    padding: 22,
    borderRadius: R.lg,
    backgroundColor: PANEL,
    borderWidth: 1,
    borderColor: HAIRLINE,
    alignItems: 'center',
  },
  badgeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 12,
  },
  badgeDot: { width: 7, height: 7, borderRadius: 4 },
  badgeText: {
    color: TEXT_SOFT,
    fontSize: T.xs,
    fontWeight: '700',
    letterSpacing: 1.2,
    textTransform: 'uppercase',
  },
  placeholderTitle: {
    fontSize: T.lg,
    fontWeight: '800',
    color: '#F8FAFC',
    textAlign: 'center',
    marginBottom: 6,
  },
  placeholderSubtitle: {
    fontSize: T.sm,
    color: TEXT_MUTED,
    textAlign: 'center',
    marginBottom: 16,
    lineHeight: 20,
  },
  progressTrack: {
    width: '100%',
    height: 4,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.10)',
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 999,
    backgroundColor: GOLD,
    opacity: 0.75,
  },
  retryButton: {
    marginTop: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 999,
    backgroundColor: 'rgba(255,204,0,0.10)',
    borderWidth: 1,
    borderColor: 'rgba(255,204,0,0.28)',
  },
  retryText: {
    fontSize: T.sm,
    fontWeight: '700',
    color: GOLD,
  },

  // ── Topbar ──
  topbar: {
    position: 'absolute', top: 0, left: 0, right: 0,
    paddingTop: Platform.OS === 'ios' ? 54 : 32,
    paddingHorizontal: 18, paddingBottom: 14,
    backgroundColor: 'rgba(5,8,16,0.90)',
    borderBottomWidth: 1, borderBottomColor: HAIRLINE,
    gap: 10,
  },
  topbarRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  statusRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  dot:       { width: 6, height: 6, borderRadius: 3 },
  statusTxt: { fontSize: T.xs, fontWeight: '600', color: TEXT_SOFT, letterSpacing: 0.2 },
  timerWrap: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    paddingVertical: 5, paddingHorizontal: 10,
    borderRadius: 999, backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
  },
  timerLabel: { fontSize: 10, fontWeight: '700', color: TEXT_SOFT, letterSpacing: 0.3, textTransform: 'uppercase' },
  timerTxt:  { fontSize: T.xs, fontWeight: '700', color: '#F8FAFC', fontVariant: ['tabular-nums'] },

  identityRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  numTag: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: PANEL,
    borderWidth: 1, borderColor: HAIRLINE,
    borderRadius: R.pill, paddingVertical: 6, paddingHorizontal: 12,
  },
  numTagLabel: { fontSize: 10, fontWeight: '800', color: GOLD, letterSpacing: 1 },
  numTagDivider: { width: 1, height: 11, backgroundColor: HAIRLINE },
  numTagVal:   { fontSize: T.sm, fontWeight: '700', color: '#F8FAFC', fontVariant: ['tabular-nums'] },

  networkBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingVertical: 5,
    paddingHorizontal: 10,
    borderRadius: 999,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1,
    borderColor: 'rgba(245,158,11,0.32)',
  },
  networkBadgeText: {
    fontSize: 10,
    fontWeight: '700',
    color: '#FDE68A',
    letterSpacing: 0.3,
  },

  // ── Bandeau reconnexion ──
  reconnectBanner: {
    position: 'absolute', top: Platform.OS === 'ios' ? 132 : 108, left: 16, right: 16,
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(245,158,11,0.12)',
    borderWidth: 1, borderColor: 'rgba(245,158,11,0.35)',
    borderRadius: R.pill, paddingVertical: 8, paddingHorizontal: 14,
    alignSelf: 'center',
  },
  reconnectTxt: { fontSize: T.xs, fontWeight: '600', color: '#FDE68A' },

  // ── PiP ──
  pipWrap: {
    position: 'absolute',
    bottom: Platform.OS === 'ios' ? 132 : 112,
    right: 12,
    width: 84, height: 118,
  },
  pip: {
    width: '100%', height: '100%',
    borderRadius: R.lg,
    borderWidth: 1, borderColor: HAIRLINE,
    overflow: 'hidden',
  },
  pipMuteBadge: {
    position: 'absolute', bottom: 6, right: 6,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,0,0,0.55)',
    alignItems: 'center', justifyContent: 'center',
  },

  // ── Contrôles ──
  controlsHandle: {
    alignSelf: 'center',
    width: 36, height: 4, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.16)',
    marginBottom: 16,
  },
  controls: {
    position: 'absolute', left: 0, right: 0, bottom: 0,
    alignItems: 'center',
    paddingTop: 14,
    paddingBottom: Platform.OS === 'ios' ? 28 : 18,
    paddingHorizontal: 20,
    backgroundColor: 'rgba(6,9,18,0.96)',
    borderTopLeftRadius: 28, borderTopRightRadius: 28,
    borderTopWidth: 1, borderColor: HAIRLINE,
    shadowColor: '#000', shadowOpacity: 0.4, shadowRadius: 20, shadowOffset: { width: 0, height: -8 }, elevation: 16,
  },
  controlsRow: {
    flexDirection: 'row', justifyContent: 'space-around', alignItems: 'flex-start',
    width: '100%',
  },
  ctrl:       { alignItems: 'center', gap: 9, width: 76 },
  ctrlCircle: {
    width: 56, height: 56, borderRadius: 28,
    backgroundColor: PANEL,
    borderWidth: 1, borderColor: HAIRLINE,
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#000', shadowOpacity: 0.25, shadowRadius: 8, shadowOffset: { width: 0, height: 3 }, elevation: 4,
  },
  ctrlCircleBig: { width: 68, height: 68, borderRadius: 34 },
  ctrlActive: {
    backgroundColor: 'rgba(255,204,0,0.14)',
    borderColor: 'rgba(255,204,0,0.40)',
  },
  ctrlHangup: {
    backgroundColor: C.danger,
    borderColor: 'transparent',
    shadowColor: C.danger, shadowOpacity: 0.5, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 12,
  },
  ctrlLabel: { fontSize: 11.5, fontWeight: '600', color: TEXT_MUTED, letterSpacing: 0.2 },
});