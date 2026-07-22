/**
 * OutgoingCallScreen.tsx — KYC Mobile V5
 * ─────────────────────────────────────────────────────────────────────────────
 * Appel SORTANT : l'agent terrain a lui-même initié l'appel (bouton "Nouvel
 * appel" depuis CallHistoryScreen). Sonnerie visuelle pendant que le serveur
 * relaie la demande, puis bascule automatiquement vers CallScreen dès que la
 * cible décroche (le back-office reste l'offerer SDP, comme pour l'appel
 * entrant classique — voir SignalingService.ts).
 *
 * NÉCESSITE le support serveur 'call-request' décrit dans SERVER_SPEC.md.
 * Sans ce support, l'appel reste bloqué sur "Sonnerie…" jusqu'au timeout
 * local (OUTGOING_TIMEOUT_MS) puis affiche une erreur claire.
 */
import React, { useEffect, useRef, useState } from 'react';
import {
  View, Text, Pressable, StyleSheet,
  Animated, Easing, StatusBar,
} from 'react-native';
import { signalingService } from '../services/SignalingService';
import { useCallStore } from '../store/callStore';
import { callHistoryService } from '../services/CallHistoryService';
import { C, R, T } from '../theme/tokens';

const OUTGOING_TIMEOUT_MS = 45_000;

const INK        = '#0B1220';
const INK_2      = '#101A2E';
const HAIRLINE   = 'rgba(255,255,255,0.09)';
const PANEL      = 'rgba(255,255,255,0.05)';
const TEXT_MUTED = 'rgba(226,232,240,0.62)';
const TEXT_SOFT  = 'rgba(226,232,240,0.82)';
const GOLD       = C.yellow ?? '#FFCC00';

type Phase = 'ringing' | 'accepted' | 'rejected' | 'unavailable' | 'timeout' | 'cancelled';

function IconPhone({ size = 38, color = INK }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{
        width: size * 0.5, height: size * 0.72, borderRadius: size * 0.14,
        borderWidth: 2, borderColor: color, transform: [{ rotate: '135deg' }],
      }} />
    </View>
  );
}

function IconClose({ size = 26, color = '#fff' }: { size?: number; color?: string }) {
  return (
    <View style={{ width: size, height: size, alignItems: 'center', justifyContent: 'center' }}>
      <View style={{ width: size * 0.6, height: 2.6, backgroundColor: color, borderRadius: 2, position: 'absolute', transform: [{ rotate: '45deg' }] }} />
      <View style={{ width: size * 0.6, height: 2.6, backgroundColor: color, borderRadius: 2, position: 'absolute', transform: [{ rotate: '-45deg' }] }} />
    </View>
  );
}

const PHASE_LABEL: Record<Phase, string> = {
  ringing:      'Sonnerie en cours…',
  accepted:     'Décroché — connexion…',
  rejected:     'Appel refusé',
  unavailable:  'Numéro injoignable',
  timeout:      "Pas de réponse",
  cancelled:    'Appel annulé',
};

export function OutgoingCallScreen({ route, navigation }: any) {
  const { numeroMtn } = route.params ?? {};
  const callStore = useCallStore();

  const [phase, setPhase] = useState<Phase>('ringing');
  const [reason, setReason] = useState<string | null>(null);

  const ringScale   = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.45)).current;
  const timeoutRef  = useRef<ReturnType<typeof setTimeout> | null>(null);
  const unsubRef    = useRef<() => void>();

  const animRing = () =>
    Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(ringScale,   { toValue: 1.14, duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0,     duration: 1200, easing: Easing.out(Easing.ease), useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(ringScale,   { toValue: 1,    duration: 0, useNativeDriver: true }),
          Animated.timing(ringOpacity, { toValue: 0.45, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();

  const goBackHome = (delay = 1600) => {
    setTimeout(() => navigation.replace('Idle'), delay);
  };

  useEffect(() => {
    animRing();
    callStore.setOutgoingCall(numeroMtn);
    void callHistoryService.upsert({ numeroMtn, status: 'outgoing' });

    signalingService.startOutgoingCall(numeroMtn);

    timeoutRef.current = setTimeout(() => {
      setPhase('timeout');
      signalingService.cancelOutgoingCall();
      void callHistoryService.upsert({ numeroMtn, status: 'outgoing-rejected' });
      callStore.resetCall();
      goBackHome(2200);
    }, OUTGOING_TIMEOUT_MS);

    unsubRef.current = signalingService.addOutgoingCallListener((event) => {
      switch (event.type) {
        case 'ringing':
          setPhase('ringing');
          break;

        case 'accepted':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPhase('accepted');
          void callHistoryService.upsert({ numeroMtn, status: 'outgoing-accepted' });
          // Même chemin que l'appel entrant : on ouvre caméra/micro dès
          // maintenant, l'answer partira avec le média prêt dès que l'offer
          // du back-office arrivera (SignalingService.handleOffer).
          callStore.setConnecting();
          signalingService.acceptCall()
            .then(() => navigation.replace('Call', { numeroMtn, callUuid: callStore.callUuid }))
            .catch(() => {
              setPhase('unavailable');
              setReason('Caméra/micro indisponible');
              callStore.resetCall();
              goBackHome();
            });
          break;

        case 'rejected':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPhase('rejected');
          void callHistoryService.upsert({ numeroMtn, status: 'outgoing-rejected' });
          callStore.resetCall();
          goBackHome();
          break;

        case 'unavailable':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPhase('unavailable');
          setReason(event.reason ?? null);
          void callHistoryService.upsert({ numeroMtn, status: 'outgoing-unavailable' });
          callStore.resetCall();
          goBackHome();
          break;

        case 'cancelled':
          if (timeoutRef.current) clearTimeout(timeoutRef.current);
          setPhase('cancelled');
          void callHistoryService.upsert({ numeroMtn, status: 'outgoing-cancelled' });
          callStore.resetCall();
          goBackHome(400);
          break;
      }
    });

    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
      unsubRef.current?.();
    };
  }, []);

  const handleCancel = () => {
    if (phase !== 'ringing') { navigation.replace('Idle'); return; }
    signalingService.cancelOutgoingCall();
  };

  const isTerminal = phase === 'rejected' || phase === 'unavailable' || phase === 'timeout' || phase === 'cancelled';
  const isAccepted = phase === 'accepted';

  return (
    <View style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="transparent" translucent />
      <View style={s.vignette} pointerEvents="none" />

      <View style={s.top}>
        <View style={s.topBadge}>
          <View style={[s.topDot, isTerminal && { backgroundColor: C.danger }]} />
          <Text style={s.topLabel}>Appel sortant</Text>
        </View>
        <Text style={s.topSub}>Centre de certification KYC · MTN Congo</Text>
      </View>

      <View style={s.center}>
        <View style={s.ringWrap}>
          {!isTerminal && (
            <Animated.View style={[s.ring, { transform: [{ scale: ringScale }], opacity: ringOpacity }]} />
          )}
          <View style={[s.iconCircle, isTerminal ? { backgroundColor: 'rgba(255,255,255,0.14)' } : isAccepted ? { backgroundColor: C.success } : null]}>
            <IconPhone size={36} color={isTerminal ? '#fff' : INK} />
          </View>
        </View>

        <View style={s.callerBlock}>
          <Text style={s.callerName}>{PHASE_LABEL[phase]}</Text>
          {reason ? <Text style={s.callerSub}>{reason}</Text> : null}
        </View>

        <View style={s.numCard}>
          <Text style={s.numCardLabel}>Numéro appelé</Text>
          <Text style={s.numCardVal}>{numeroMtn}</Text>
        </View>
      </View>

      <View style={s.actions}>
        <View style={s.actionCol}>
          <Pressable onPress={handleCancel} hitSlop={10} accessibilityRole="button" accessibilityLabel="Annuler l'appel">
            <View style={[s.actionBtn, s.btnDecline]}>
              <IconClose size={26} color="#FFFFFF" />
            </View>
          </Pressable>
          <Text style={s.actionLabel}>{phase === 'ringing' ? 'Annuler' : 'Fermer'}</Text>
        </View>
      </View>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: INK, justifyContent: 'space-between', paddingVertical: 58 },
  vignette: { position: 'absolute', top: 0, left: 0, right: 0, height: 280, backgroundColor: INK_2, opacity: 0.6 },

  top: { alignItems: 'center', paddingTop: 6, zIndex: 2, gap: 10 },
  topBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: PANEL, borderWidth: 1, borderColor: HAIRLINE,
    borderRadius: R.pill, paddingVertical: 7, paddingHorizontal: 15,
  },
  topDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.yellow },
  topLabel: { fontSize: T.sm, fontWeight: '600', color: '#F1F5F9' },
  topSub:   { fontSize: T.xs, color: TEXT_MUTED, letterSpacing: 0.2 },

  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  ringWrap: { width: 190, height: 190, alignItems: 'center', justifyContent: 'center', marginBottom: 32 },
  ring: {
    position: 'absolute', width: 190, height: 190, borderRadius: 95,
    borderWidth: 1.5, borderColor: 'rgba(255,204,0,0.35)',
  },
  iconCircle: {
    width: 104, height: 104, borderRadius: 52, backgroundColor: GOLD,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.25)',
    shadowColor: GOLD, shadowOpacity: 0.30, shadowRadius: 26, shadowOffset: { width: 0, height: 8 }, elevation: 10,
  },

  callerBlock: { alignItems: 'center', gap: 7, marginBottom: 26, zIndex: 2 },
  callerName: { fontSize: T.xl, fontWeight: '800', color: '#F8FAFC', letterSpacing: -0.3, textAlign: 'center' },
  callerSub:  { fontSize: T.sm, color: TEXT_MUTED, textAlign: 'center', maxWidth: 260, lineHeight: 19 },

  numCard: {
    backgroundColor: PANEL, borderWidth: 1, borderColor: HAIRLINE,
    borderRadius: R.lg, paddingVertical: 16, paddingHorizontal: 30,
    alignItems: 'center', minWidth: 220,
  },
  numCardLabel: { fontSize: 10, fontWeight: '700', color: TEXT_MUTED, letterSpacing: 1.4, textTransform: 'uppercase', marginBottom: 5 },
  numCardVal:   { fontSize: T['2xl'], fontWeight: '800', color: '#F8FAFC', fontVariant: ['tabular-nums'], letterSpacing: 0.4 },

  actions: { flexDirection: 'row', justifyContent: 'center', paddingHorizontal: 56, paddingBottom: 4 },
  actionCol: { alignItems: 'center', gap: 12 },
  actionBtn: { width: 72, height: 72, borderRadius: 36, alignItems: 'center', justifyContent: 'center' },
  btnDecline: {
    backgroundColor: C.danger,
    shadowColor: C.danger, shadowOpacity: 0.35, shadowRadius: 16, shadowOffset: { width: 0, height: 6 }, elevation: 8,
  },
  actionLabel: { fontSize: T.xs, fontWeight: '600', color: TEXT_MUTED, letterSpacing: 0.2 },
});