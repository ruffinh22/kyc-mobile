/**
 * IdleScreen.tsx — KYC Mobile V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Écran d'attente : anneaux pulsants MTN, statut de connexion temps réel,
 * chrono d'attente, nav vers acquisition via CTA unique + bottom tab bar.
 * Séquence d'init : FCM → WS register (token FCM transmis au serveur).
 *
 * Changements de modernisation (v5) :
 *  - Suppression du doublon de navigation : l'ancienne grille de 4 IconTile
 *    (Soumettre / Dossiers / Appels / Compte) faisait doublon avec la
 *    BottomTabBar. "Soumettre" devient un CTA héros unique (action
 *    principale de l'écran) ; la BottomTabBar gère Accueil / Dossiers /
 *    Appels / Compte — chaque destination n'a donc plus qu'un seul point
 *    d'entrée.
 *  - `isConnected` (récupéré du store mais jamais utilisé) alimente
 *    désormais un badge de statut de connexion en direct.
 *  - Ajout d'un chrono "en attente depuis" pour un feedback temps réel.
 *  - Nettoyage des styles morts (topbar/agentPill/avatar/statusBadge/
 *    btnGhost…) qui ne correspondaient plus à aucun JSX.
 */
import React, { useEffect, useRef, useCallback, useState } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { keepAwake } from '../utils/keepAwake';
import { useAgentStore, useCallStore } from '../store/callStore';
import { signalingService }   from '../services/SignalingService';
import { notificationService } from '../services/NotificationService';
import { callHistoryService } from '../services/CallHistoryService';
import { C, R, T } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { BottomTabBar } from '../components/BottomTabBar';

type IdleScreenProps = {
  navigation: {
    navigate: (screen: string, params?: object) => void;
    replace: (screen: string, params?: object) => void;
  };
};

function formatElapsed(totalSeconds: number): string {
  const m = Math.floor(totalSeconds / 60).toString().padStart(2, '0');
  const s = (totalSeconds % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export function IdleScreen({ navigation }: IdleScreenProps) {
  useEffect(() => {
    keepAwake.activate();
    return () => keepAwake.deactivate();
  }, []);

  const { numeroAgent, serverUrl, setConnected, isConnected } = useAgentStore();
  const callStore = useCallStore();
  const errorMessage = useCallStore((s) => s.errorMessage);

  // ── Chrono "en attente depuis" ──────────────────────────────────────────
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setElapsed((v) => v + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // ── Anneaux pulsants (3 déphasés) ──────────────────────────────────────
  const r1 = useRef(new Animated.Value(1)).current;
  const r2 = useRef(new Animated.Value(1)).current;
  const r3 = useRef(new Animated.Value(1)).current;
  const o1 = useRef(new Animated.Value(0.5)).current;
  const o2 = useRef(new Animated.Value(0.3)).current;
  const o3 = useRef(new Animated.Value(0.15)).current;

  const pulse = (scale: Animated.Value, opacity: Animated.Value, delay: number) =>
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1.20, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0,    duration: 1600, easing: Easing.out(Easing.ease),   useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale,   { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: delay === 0 ? 0.5 : delay === 400 ? 0.3 : 0.15, duration: 0, useNativeDriver: true }),
        ]),
      ])
    ).start();

  useEffect(() => {
    pulse(r1, o1, 0);
    pulse(r2, o2, 400);
    pulse(r3, o3, 800);
  }, []);

  // ── Appel entrant ───────────────────────────────────────────────────────
  const handleIncomingCall = useCallback((callUuid: string, numeroMtn: string) => {
    callStore.setIncomingCall(numeroMtn, callUuid);
    navigation.navigate('IncomingCall', { numeroMtn, callUuid });
  }, [navigation, callStore]);

  // ── Exemption batterie (une seule fois, dès que l'app est au premier plan) ──
  // Doit se faire ici (écran monté, Activity disponible) et pas dans le chemin
  // headless de registerBackgroundHandlers, qui n'a pas d'Activity pour afficher
  // la boîte de dialogue système.
  useEffect(() => {
    (async () => {
      const alreadyAsked = await AsyncStorage.getItem('battery_exemption_requested');
      if (!alreadyAsked) {
        await notificationService.ensureBatteryOptimizationExemption();
      }
    })();
  }, []);

  const registerFcmTokenWithBackend = useCallback(async (token: string) => {
    if (!serverUrl || !numeroAgent || !token) return;

    const base = serverUrl.replace(/\/$/, '');
    const apiBase = base.startsWith('http') ? base : `http://${base}`;

    try {
      const res = await fetch(`${apiBase}/api/device/register-fcm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ numero: numeroAgent, token }),
      });

      if (!res.ok) {
        const text = await res.text();
        console.warn('[Idle] FCM registration failed', res.status, text);
      }
    } catch (err) {
      console.warn('[Idle] FCM registration error', err);
    }
  }, [numeroAgent, serverUrl]);

  // ── Init FCM → WS ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fcmToken = (await notificationService.ensureFCMToken()) ?? '';
      if (cancelled) return;
      await registerFcmTokenWithBackend(fcmToken);
      signalingService.init(serverUrl, numeroAgent, fcmToken, {
        onConnected:    () => setConnected(true),
        onDisconnected: () => setConnected(false),
        onIncomingCall: (numeroMtn) => {
          const uuid = `ws-${Date.now()}`;
          callStore.setIncomingCall(numeroMtn, uuid);
          void callHistoryService.upsert({ callUuid: uuid, numeroMtn, status: 'incoming' });
          notificationService.showIncomingCall(uuid, numeroMtn);
          if (!cancelled) navigation.navigate('IncomingCall', { numeroMtn, callUuid: uuid });
        },
        onCallEnded: () => { if (!cancelled) navigation.replace('Idle'); },
        onError:     (msg) => console.warn('[Signal]', msg),
        onMediaError:(msg) => { console.warn('[Signal] Média:', msg); callStore.setFailed(msg); },
      });
    })();
    return () => { cancelled = true; };
  }, [serverUrl, numeroAgent]);

  const handleAccount = () => {
    navigation.navigate('Account');
  };

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} translucent />

      <AppHeader title="Accueil" subtitle={numeroAgent || 'Agent KYC'} rightIcon="🔔" onRightPress={() => {}} />

      {/* ── Centre : anneaux + icône + statut ───────────────────────────── */}
      <View style={s.center}>
        <View style={s.ringWrap}>
          <Animated.View style={[s.ring, s.ring3, { transform: [{ scale: r3 }], opacity: o3 }]} />
          <Animated.View style={[s.ring, s.ring2, { transform: [{ scale: r2 }], opacity: o2 }]} />
          <Animated.View style={[s.ring, s.ring1, { transform: [{ scale: r1 }], opacity: o1 }]} />
          <View style={s.iconCircle}>
            <Text style={s.iconTxt}>📡</Text>
          </View>
        </View>

        <Text style={s.waitTitle}>En attente d'un appel</Text>
        <Text style={s.waitSub}>Vous serez notifié dès qu'un client vous contacte.</Text>

        {/* Badge de statut de connexion — reflète l'état réel du socket */}
        <View style={s.statusPill}>
          <View style={[s.statusDotLive, { backgroundColor: isConnected ? C.success : C.dangerText }]} />
          <Text style={[s.statusPillTxt, { color: isConnected ? C.success : C.dangerText }]}>
            {isConnected ? 'Connecté' : 'Connexion en cours…'}
          </Text>
          <View style={s.statusSep} />
          <Text style={s.statusTimer}>{formatElapsed(elapsed)}</Text>
        </View>

        {errorMessage ? (
          <View style={s.alertBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={s.alertText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Badge numéro agent */}
        <View style={s.numBadge}>
          <View style={s.numDot} />
          <Text style={s.numLabel}>Agent </Text>
          <Text style={s.numVal}>{numeroAgent}</Text>
        </View>
      </View>

      {/* ── Action principale unique : plus de doublon avec la tab bar ──── */}
      <View style={s.footer}>
        <TouchableOpacity
          style={s.ctaPrimary}
          activeOpacity={0.85}
          onPress={() => navigation.navigate('Acquisition')}
        >
          <Text style={s.ctaIcon}>📱</Text>
          <Text style={s.ctaPrimaryTxt}>Soumettre un dossier</Text>
        </TouchableOpacity>
      </View>

      <BottomTabBar
        tabs={[
          { key: 'home',     label: 'Accueil',  icon: '🏠' },
          { key: 'dossiers', label: 'Dossiers', icon: '🗂️' },
          { key: 'calls',    label: 'Appels',   icon: '📞' },
          { key: 'account',  label: 'Compte',   icon: '👤' },
        ]}
        activeKey="home"
        onChange={(key) => {
          if (key === 'dossiers') navigation.navigate('DossierList');
          if (key === 'calls') navigation.navigate('CallHistory');
          if (key === 'account') handleAccount();
          if (key === 'home') navigation.navigate('Idle');
        }}
      />
    </View>
  );
}

const RING_BASE = 90;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },

  // ── Centre ──
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 20, paddingHorizontal: 24 },

  ringWrap: {
    width: RING_BASE * 2.8, height: RING_BASE * 2.8,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 32,
  },
  ring: {
    position: 'absolute', borderRadius: 999,
    borderWidth: 1.5,
  },
  ring1: {
    width:  RING_BASE * 1.3 * 2, height: RING_BASE * 1.3 * 2,
    borderColor: 'rgba(0,48,135,0.50)',
  },
  ring2: {
    width:  RING_BASE * 1.9 * 1.4, height: RING_BASE * 1.9 * 1.4,
    borderColor: 'rgba(0,48,135,0.30)',
  },
  ring3: {
    width:  RING_BASE * 2.6 * 1.1, height: RING_BASE * 2.6 * 1.1,
    borderColor: 'rgba(0,48,135,0.15)',
  },
  iconCircle: {
    width: 96, height: 96, borderRadius: 48,
    backgroundColor: C.blue,
    alignItems: 'center', justifyContent: 'center',
    borderWidth: 3, borderColor: 'rgba(255,204,0,0.28)',
    shadowColor: C.blue, shadowOpacity: 0.55, shadowRadius: 24, elevation: 16,
  },
  iconTxt: { fontSize: 40 },

  waitTitle: {
    fontSize: T.xl, fontWeight: '900', color: C.ink,
    letterSpacing: -0.5, textAlign: 'center',
  },
  waitSub: {
    fontSize: T.sm, color: C.ink2, textAlign: 'center',
    marginTop: 8, lineHeight: 20, maxWidth: 280,
  },

  // ── Statut de connexion + chrono ──
  statusPill: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 18,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
    borderRadius: R.pill, paddingVertical: 8, paddingHorizontal: 14,
    shadowColor: '#0F1720', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statusDotLive: { width: 7, height: 7, borderRadius: 4 },
  statusPillTxt: { fontSize: T.xs, fontWeight: '700', letterSpacing: 0.3 },
  statusSep: { width: 1, height: 12, backgroundColor: 'rgba(15,23,42,0.10)', marginHorizontal: 2 },
  statusTimer: {
    fontSize: T.xs, fontWeight: '700', color: C.ink2,
    fontVariant: ['tabular-nums'], letterSpacing: 0.4,
  },

  alertBanner: {
    marginTop: 16,
    backgroundColor: 'rgba(217,45,32,0.10)',
    borderWidth: 1, borderColor: 'rgba(217,45,32,0.24)',
    borderRadius: R.md,
    paddingVertical: 8, paddingHorizontal: 12,
    maxWidth: 320,
  },
  alertText: { fontSize: T.xs, color: C.dangerText, fontWeight: '700', textAlign: 'center' },

  numBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: C.blueBorder,
    borderRadius: R.pill, paddingVertical: 10, paddingHorizontal: 20,
    shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  numDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.yellow },
  numLabel: { fontSize: T.xs, color: C.ink2, fontWeight: '600' },
  numVal:   { fontSize: T.md, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },

  // ── Footer : CTA unique ──
  footer: { paddingHorizontal: 20, paddingBottom: 16 },
  ctaPrimary: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10,
    paddingVertical: 17, borderRadius: R.lg,
    backgroundColor: C.yellow,
    shadowColor: C.shadowYellow, shadowOpacity: 0.32, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 8,
  },
  ctaIcon: { fontSize: 18 },
  ctaPrimaryTxt: { fontSize: T.md, fontWeight: '800', color: C.blue, letterSpacing: 0.2 },
});