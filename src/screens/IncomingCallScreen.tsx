/**
 * IncomingCallScreen.tsx — KYC Mobile V5
 * ─────────────────────────────────────────────────────────────────────────────
 * Appel vidéo entrant : identité institutionnelle sobre (navy + accent MTN
 * discret), icônes vectorielles, anneau de compte à rebours, retour tactile.
 * Fonctionne même si l'app est en background (CallKeep full-screen intent).
 */
import React, { useEffect, useRef } from 'react';
import {
  View, Text, Pressable, StyleSheet,
  Animated, Easing, StatusBar,
} from 'react-native';
import { notificationService } from '../services/NotificationService';
import { signalingService }     from '../services/SignalingService';
import { callSessionService }   from '../services/CallSessionService';
import { useCallStore }          from '../store/callStore';
import { C, R, T } from '../theme/tokens';
import { callHistoryService } from '../services/CallHistoryService';

const CALL_TIMEOUT_MS = 45_000;

// ── Palette institutionnelle (navy profond, accent MTN discret) ────────────
const INK        = '#0B1220';
const INK_2      = '#101A2E';
const HAIRLINE   = 'rgba(255,255,255,0.09)';
const PANEL      = 'rgba(255,255,255,0.05)';
const TEXT_MUTED = 'rgba(226,232,240,0.62)';
const TEXT_SOFT  = 'rgba(226,232,240,0.82)';
const GOLD       = C.yellow ?? '#FFCC00';

// ── Icônes 100% React Native (View/StyleSheet) ──────────────────────────────
// Aucune dépendance externe : pas de require conditionnel, pas de module
// natif à lier. Fonctionne tel quel dans n'importe quel projet RN pur.
type IconProps = { size?: number; color?: string; off?: boolean };

function IconVideo({ size = 22, color = '#fff' }: IconProps) {
  const bw = size * 0.60, bh = size * 0.42;
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: bw, height: bh, borderRadius: 3, borderWidth: 1.8, borderColor: color }} />
      <View style={{
        position: 'absolute', left: size * 0.5 + bw * 0.5 - 1,
        width: 0, height: 0,
        borderTopWidth: bh * 0.28, borderBottomWidth: bh * 0.28, borderLeftWidth: bh * 0.34,
        borderTopColor: 'transparent', borderBottomColor: 'transparent', borderLeftColor: color,
      }} />
    </View>
  );
}

function IconCheck({ size = 26, color = '#fff' }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.32, height: 2.6, backgroundColor: color, borderRadius: 2, position: 'absolute', left: size * 0.18, top: size * 0.5, transform: [{ rotate: '45deg' }] }} />
      <View style={{ width: size * 0.54, height: 2.6, backgroundColor: color, borderRadius: 2, position: 'absolute', left: size * 0.30, top: size * 0.42, transform: [{ rotate: '-48deg' }] }} />
    </View>
  );
}

function IconClose({ size = 26, color = '#fff' }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.6, height: 2.6, backgroundColor: color, borderRadius: 2, position: 'absolute', transform: [{ rotate: '45deg' }] }} />
      <View style={{ width: size * 0.6, height: 2.6, backgroundColor: color, borderRadius: 2, position: 'absolute', transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

function IconShield({ size = 13, color = '#fff' }: IconProps) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.78, height: size * 0.78, borderWidth: 1.4, borderColor: color, borderRadius: size * 0.16, position: 'absolute' }} />
      <View style={{ width: size * 0.32, height: size * 0.22, borderBottomWidth: 1.6, borderLeftWidth: 1.6, borderColor: color, transform: [{ rotate: '-45deg' }], position: 'absolute', top: size * 0.28, left: size * 0.26 }} />
    </View>
  );
}

function IconBadgeCheck({ size = 12, color = '#fff' }: IconProps) {
  return (
    <View style={{ width: size + 2, height: size + 2, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size + 2, height: size + 2, borderRadius: (size + 2) / 2, borderWidth: 1, borderColor: color, position: 'absolute' }} />
      <View style={{ width: size * 0.35, height: size * 0.12, backgroundColor: color, position: 'absolute', top: size * 0.56, left: size * 0.24, transform: [{ rotate: '-45deg' }] }} />
      <View style={{ width: size * 0.54, height: size * 0.12, backgroundColor: color, position: 'absolute', top: size * 0.48, left: size * 0.34, transform: [{ rotate: '45deg' }] }} />
    </View>
  );
}

// ── Bouton d'action circulaire avec retour d'appui (scale) ─────────────────
function ActionButton({
  icon, label, tone, onPress,
}: { icon: 'check' | 'close'; label: string; tone: 'decline' | 'accept'; onPress: () => void }) {
  const scale = useRef(new Animated.Value(1)).current;
  const press = (to: number) =>
    Animated.spring(scale, { toValue: to, useNativeDriver: true, speed: 30, bounciness: 6 }).start();

  const isAccept = tone === 'accept';
  const Icon = icon === 'check' ? IconCheck : IconClose;

  return (
    <View style={s.actionCol}>
      <Pressable
        onPressIn={() => press(0.92)}
        onPressOut={() => press(1)}
        onPress={onPress}
        hitSlop={10}
        accessibilityRole="button"
        accessibilityLabel={label}
      >
        <Animated.View
          style={[
            s.actionBtn,
            isAccept ? s.btnAccept : s.btnDecline,
            { transform: [{ scale }] },
          ]}
        >
          <Icon size={26} color={isAccept ? '#06371F' : '#FFFFFF'} />
        </Animated.View>
      </Pressable>
      <Text style={[s.actionLabel, isAccept && { color: C.successText }]}>{label}</Text>
    </View>
  );
}

export function IncomingCallScreen({ route, navigation }: any) {
  const { numeroMtn, callUuid } = route.params ?? {};
  const callStore = useCallStore();

  // Anneau de présence unique, retenu — pas de "carnaval" de halos.
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.45)).current;
  // Anneau de compte à rebours (0 → 1 sur CALL_TIMEOUT_MS)
  const countdown = useRef(new Animated.Value(0)).current;

  const missedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const animRing = () =>
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale,   { toValue: 1.14, duration: 1900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0,     duration: 1900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale,   { toValue: 1,    duration: 0, useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0.45, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();

  const stopAll = () => {
    callSessionService.stopIncomingCallExperience();
    if (missedTimerRef.current) clearTimeout(missedTimerRef.current);
    missedTimerRef.current = null;
  };

  useEffect(() => {
    animRing();
    Animated.timing(countdown, {
      toValue: 1,
      duration: CALL_TIMEOUT_MS,
      easing: Easing.linear,
      useNativeDriver: false,
    }).start();

    callSessionService.startIncomingCallExperience();

    missedTimerRef.current = setTimeout(() => {
      stopAll();
      notificationService.endNativeCall(callUuid);
      signalingService.refuseCall();
      void callHistoryService.upsert({ callUuid, numeroMtn, status: 'missed' });
      callStore.resetCall();
      navigation.replace('Idle');
    }, CALL_TIMEOUT_MS);

    return () => stopAll();
  }, []);

  // Filet de sécurité : si l'appel est accepté/terminé par un autre chemin
  // (ex. réponse depuis l'écran natif verrouillé pendant que cet écran JS
  // sonne encore), on coupe sonnerie/vibration sans dupliquer la navigation.
  useEffect(() => {
    if (callStore.status !== 'incoming') stopAll();
  }, [callStore.status]);

  const handleAccept = async () => {
    stopAll();
    notificationService.answerNativeCall(callUuid);
    callStore.setConnecting();
    try {
      // acceptCall() ouvre la caméra/micro ici, avant même que CallScreen ne
      // soit monté. C'est volontaire (démarrage perçu plus rapide) et sans
      // danger : SignalingService rejoue l'état (local/remote/phase) à tout
      // abonné qui arrive après coup, donc CallScreen ne perd aucun événement
      // même si la négociation WebRTC se termine avant qu'il ne soit monté.
      await signalingService.acceptCall();
      void callHistoryService.upsert({ callUuid, numeroMtn, status: 'accepted' });
      navigation.replace('Call', { callUuid, numeroMtn });
    } catch (e) {
      console.warn('[IncomingCall] acceptCall a échoué, repli sur refus :', e);
      notificationService.endNativeCall(callUuid);
      signalingService.refuseCall();
      callStore.resetCall();
      navigation.replace('Idle');
    }
  };

  const handleDecline = () => {
    stopAll();
    notificationService.endNativeCall(callUuid);
    signalingService.refuseCall();
    void callHistoryService.upsert({ callUuid, numeroMtn, status: 'declined' });
    callStore.resetCall();
    navigation.replace('Idle');
  };

  const countdownWidth = countdown.interpolate({ inputRange: [0, 1], outputRange: ['0%', '100%'] });

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />

      <View style={s.vignette} pointerEvents="none" />

      {/* ── Bandeau institutionnel ─────────────────────────────────────── */}
      <View style={s.top}>
        <View style={s.trustRow}>
          <IconShield size={13} color={GOLD} />
          <Text style={s.trustTxt}>CONNEXION CHIFFRÉE</Text>
        </View>
        <View style={s.topBadge}>
          <View style={s.topDot} />
          <Text style={s.topLabel}>Appel vidéo entrant</Text>
        </View>
        <Text style={s.topSub}>Centre de certification KYC · MTN Congo</Text>
      </View>

      {/* ── Centre ─────────────────────────────────────────────────────── */}
      <View style={s.center}>
        <View style={s.ringWrap}>
          <Animated.View style={[s.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
          <View style={s.iconCircle}>
            <IconVideo size={38} color={INK} />
          </View>
        </View>

        <View style={s.callerBlock}>
          <View style={s.mtnTag}>
            <IconBadgeCheck size={12} color={GOLD} />
            <Text style={s.mtnTagTxt}>Agent MTN vérifié</Text>
          </View>
          <Text style={s.callerName}>Vérification d'identité</Text>
          <Text style={s.callerSub}>Session vidéo sécurisée en cours d'ouverture</Text>
        </View>

        <View style={s.numCard}>
          <Text style={s.numCardLabel}>Numéro client</Text>
          <Text style={s.numCardVal}>{numeroMtn}</Text>
          <View style={s.countdownTrack}>
            <Animated.View style={[s.countdownFill, { width: countdownWidth }]} />
          </View>
        </View>
      </View>

      {/* ── Actions ────────────────────────────────────────────────────── */}
      <View style={s.actions}>
        <ActionButton icon="close" label="Refuser" tone="decline" onPress={handleDecline} />
        <ActionButton icon="check" label="Accepter" tone="accept" onPress={handleAccept} />
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: INK,
    justifyContent: 'space-between',
    paddingVertical: 58,
  },
  vignette: {
    position: 'absolute', top: 0, left: 0, right: 0, height: 280,
    backgroundColor: INK_2,
    opacity: 0.6,
  },

  // ── Top ──
  top: { alignItems: 'center', paddingTop: 6, zIndex: 2, gap: 10 },
  trustRow: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginBottom: 2,
  },
  trustTxt: {
    fontSize: 10, fontWeight: '700', color: GOLD,
    letterSpacing: 1.6,
  },
  topBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: PANEL,
    borderWidth: 1, borderColor: HAIRLINE,
    borderRadius: R.pill, paddingVertical: 7, paddingHorizontal: 15,
  },
  topDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  topLabel: { fontSize: T.sm, fontWeight: '600', color: '#F1F5F9' },
  topSub:   { fontSize: T.xs, color: TEXT_MUTED, letterSpacing: 0.2 },

  // ── Centre ──
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },

  ringWrap: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  ring: {
    position: 'absolute', width: 190, height: 190, borderRadius: 95,
    borderWidth: 1.5, borderColor: 'rgba(255,204,0,0.35)',
  },
  iconCircle: {
    width: 104, height: 104, borderRadius: 52,
    backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: GOLD, shadowOpacity: 0.30, shadowRadius: 26, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },

  callerBlock: { alignItems: 'center', gap: 7, marginBottom: 26, zIndex: 2 },
  mtnTag: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: PANEL,
    borderWidth: 1, borderColor: HAIRLINE,
    borderRadius: R.pill, paddingVertical: 5, paddingHorizontal: 12,
  },
  mtnTagTxt: { fontSize: T.xs, fontWeight: '600', color: TEXT_SOFT },
  callerName: { fontSize: T.xl, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.3 },
  callerSub:  { fontSize: T.sm, color: TEXT_MUTED, textAlign: 'center', maxWidth: 260, lineHeight: 19 },

  numCard: {
    backgroundColor: PANEL,
    borderWidth: 1, borderColor: HAIRLINE,
    borderRadius: R.lg, paddingVertical: 16, paddingHorizontal: 30,
    alignItems: 'center', minWidth: 220,
  },
  numCardLabel: { fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 5 },
  numCardVal:   { fontSize: T['2xl'], fontWeight: '800', color: '#F8FAFC', fontVariant: ['tabular-nums'], letterSpacing: 0.4 },
  countdownTrack: {
    marginTop: 12, width: '100%', height: 3, borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.10)', overflow: 'hidden',
  },
  countdownFill: { height: '100%', backgroundColor: GOLD, opacity: 0.65 },

  // ── Actions ──
  actions: {
    flexDirection: 'row', justifyContent: 'space-around',
    paddingHorizontal: 56, paddingBottom: 4,
  },
  actionCol: { alignItems: 'center', gap: 12 },
  actionBtn: {
    width: 72, height: 72, borderRadius: 36,
    alignItems: 'center', justifyContent: 'center',
  },
  btnDecline: {
    backgroundColor: C.danger,
    shadowColor: C.danger, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  btnAccept: {
    backgroundColor: C.success,
    shadowColor: C.success, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  actionLabel: { fontSize: T.xs, fontWeight: '600', color: TEXT_MUTED, letterSpacing: 0.2 },
});