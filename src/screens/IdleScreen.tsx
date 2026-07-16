/**
 * IdleScreen.tsx — KYC Mobile V4
 * ─────────────────────────────────────────────────────────────────────────────
 * Écran d'attente : anneaux pulsants MTN, topbar status, nav vers acquisition.
 * Séquence d'init : FCM → WS register (token FCM transmis au serveur).
 */
import React, { useEffect, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { keepAwake } from '../utils/keepAwake';
import { useAgentStore, useCallStore } from '../store/callStore';
import { signalingService }   from '../services/SignalingService';
import { notificationService } from '../services/NotificationService';
import { C, R, T } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';
import { StatCard } from '../components/StatCard';
import { IconTile } from '../components/IconTile';
import { BottomTabBar } from '../components/BottomTabBar';

export function IdleScreen({ navigation }: any) {
  useEffect(() => {
    keepAwake.activate();
    return () => keepAwake.deactivate();
  }, []);

  const { numeroAgent, serverUrl, setConnected, isConnected, logout } = useAgentStore();
  const callStore = useCallStore();
  const errorMessage = useCallStore((s) => s.errorMessage);

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

  // ── Init FCM → WS ────────────────────────────────────────────────────────
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const fcmToken = (await notificationService.ensureFCMToken()) ?? '';
      if (cancelled) return;
      signalingService.init(serverUrl, numeroAgent, fcmToken, {
        onConnected:    () => setConnected(true),
        onDisconnected: () => setConnected(false),
        onIncomingCall: (numeroMtn) => {
          const uuid = `ws-${Date.now()}`;
          callStore.setIncomingCall(numeroMtn, uuid);
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

  const handleLogout = async () => {
    signalingService.destroy();
    await AsyncStorage.multiRemove(['kyc_numero', 'kyc_server']);
    logout();
    navigation.replace('Login');
  };

  const handleAccount = () => {
    navigation.navigate('Account');
  };

  const initials   = numeroAgent.substring(0, 2).toUpperCase();
  const onlineColor = isConnected ? C.success : C.danger;

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} translucent />

      <AppHeader title="Accueil" subtitle={numeroAgent || 'Agent KYC'} rightIcon="🔔" onRightPress={() => {}} />

      {/* ── Centre : anneaux + icône ─────────────────────────────────────── */}
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

        {errorMessage ? (
          <View style={s.alertBanner}>
            <Text style={s.alertText}>{errorMessage}</Text>
          </View>
        ) : null}

        {/* Badge numéro */}
        <View style={s.numBadge}>
          <View style={s.numDot} />
          <Text style={s.numLabel}>Agent </Text>
          <Text style={s.numVal}>{numeroAgent}</Text>
        </View>
      </View>

      <View style={s.footer}>
        <View style={s.grid}>
          <IconTile icon="📱" label="Soumettre" color={C.blue} onPress={() => navigation.navigate('Acquisition')} />
          <IconTile icon="🗂️" label="Dossiers" color={C.yellow} onPress={() => navigation.navigate('DossierList')} />
          <IconTile icon="🔐" label="Compte" color={C.success} onPress={handleAccount} />
          <IconTile icon="📞" label="Appels" color={C.blueMid} onPress={() => navigation.navigate('IncomingCall', { numeroMtn: '000', callUuid: 'demo' })} />
        </View>
      </View>

      <BottomTabBar tabs={[{key:'home',label:'Accueil',icon:'🏠'},{key:'submit',label:'Soumettre',icon:'📱'},{key:'dossiers',label:'Dossiers',icon:'🗂️'},{key:'account',label:'Compte',icon:'👤'}]} activeKey="home" onChange={(key) => {
        if (key === 'submit') navigation.navigate('Acquisition');
        if (key === 'dossiers') navigation.navigate('DossierList');
        if (key === 'account') handleAccount();
      }} />
    </View>
  );
}

const RING_BASE = 90;
const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },

  // ── Topbar ──
  topbar: {
    flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center',
    paddingTop: 56, paddingHorizontal: 20, paddingBottom: 16,
  },
  agentPill: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: 'rgba(0,48,135,0.16)',
    borderRadius: R.pill, paddingVertical: 8, paddingHorizontal: 14,
    shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
    elevation: 3,
  },
  avatar: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.blue,
    alignItems: 'center', justifyContent: 'center',
  },
  avatarTxt: { fontSize: T.xs, fontWeight: '900', color: C.yellow },
  agentNum:  { fontSize: T.sm, fontWeight: '700', color: C.ink, fontVariant: ['tabular-nums'] },

  statusBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1, borderRadius: R.pill,
    paddingVertical: 6, paddingHorizontal: 12,
    shadowColor: '#0F1720', shadowOpacity: 0.05, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  statusDot: { width: 7, height: 7, borderRadius: 4 },
  statusTxt: { fontSize: T.xs, fontWeight: '700', letterSpacing: 0.6 },

  // ── Centre ──
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingBottom: 20 },

  ringWrap: {
    width: RING_BASE * 2.8, height: RING_BASE * 2.8,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 36,
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
    borderWidth: 3, borderColor: 'rgba(255,204,0,0.25)',
    shadowColor: C.blue, shadowOpacity: 0.55, shadowRadius: 24, elevation: 16,
  },
  iconTxt: { fontSize: 40 },

  waitTitle: {
    fontSize: T.xl, fontWeight: '900', color: C.ink,
    letterSpacing: -0.5, textAlign: 'center',
  },
  waitSub: {
    fontSize: T.sm, color: C.ink2, textAlign: 'center',
    marginTop: 10, lineHeight: 22,
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
    marginTop: 22,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: C.blueBorder,
    borderRadius: R.pill, paddingVertical: 10, paddingHorizontal: 20,
    shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 3,
  },
  numDot:   { width: 6, height: 6, borderRadius: 3, backgroundColor: C.yellow },
  numLabel: { fontSize: T.xs, color: C.ink2, fontWeight: '600' },
  numVal:   { fontSize: T.md, fontWeight: '800', color: C.ink, fontVariant: ['tabular-nums'] },

  // ── Footer ──
  footer: { paddingHorizontal: 20, paddingBottom: 40, gap: 10 },
  grid: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    width: '100%',
  },
  btnPrimary: {
    paddingVertical: 16, borderRadius: R.lg,
    backgroundColor: C.yellow,
    alignItems: 'center',
    shadowColor: C.shadowYellow, shadowOpacity: 0.30, shadowRadius: 14, elevation: 7,
  },
  btnPrimaryTxt: { fontSize: T.md, fontWeight: '800', color: C.blue },
  btnSecondary: {
    paddingVertical: 16, borderRadius: R.lg,
    backgroundColor: 'rgba(255,255,255,0.95)',
    alignItems: 'center',
    borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
    shadowColor: '#0F1720', shadowOpacity: 0.05, shadowRadius: 10, shadowOffset: { width: 0, height: 6 },
    elevation: 2,
  },
  btnSecondaryTxt: { fontSize: T.md, fontWeight: '800', color: C.ink },
  btnGhost: {
    paddingVertical: 14, borderRadius: R.lg,
    backgroundColor: 'rgba(255,255,255,0.92)',
    borderWidth: 1, borderColor: C.bgBorder,
    alignItems: 'center',
    shadowColor: '#0F1720', shadowOpacity: 0.04, shadowRadius: 8, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  btnGhostTxt: { fontSize: T.base, fontWeight: '600', color: C.ink2 },
});