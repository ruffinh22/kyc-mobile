/**
 * IdleScreen.tsx — KYC Mobile V7
 * ─────────────────────────────────────────────────────────────────────────────
 * Écran d'attente : sceau MTN (anneaux + médaillon), carte de session
 * institutionnelle (statut / durée / agent), nav vers acquisition via CTA
 * héros unique + bottom tab bar.
 * Séquence d'init : FCM → WS register (token FCM transmis au serveur).
 *
 * Changements de modernisation (v7 — compact, responsive, une ligne) :
 *  - Tout le contenu tient désormais dans la hauteur visible d'un seul tenant
 *    (espacements resserrés, aucune ligne redondante) au lieu de nécessiter
 *    un défilement dans la majorité des cas ; le ScrollView est conservé en
 *    filet de sécurité pour les très petits écrans, mais n'apparaît plus en
 *    usage normal.
 *  - Tous les libellés (titre, sous-titre, carte de session, CTA, note de
 *    pied de page) sont forcés en une seule ligne (`numberOfLines={1}` +
 *    `adjustsFontSizeToFit` là où le texte est variable), avec des copies
 *    raccourcies pour ne jamais avoir besoin de réduire la police à
 *    l'excès.
 *  - Bandeau d'en-tête habillé d'un fond gris-bleu discret et professionnel
 *    (léger changement de nuance par rapport au fond de l'écran, avec une
 *    ligne de séparation fine) plutôt qu'un fond neutre confondu avec le
 *    contenu.
 *  - Mise à l'échelle responsive : une échelle dérivée de la plus petite
 *    dimension de l'écran (largeur ou hauteur) pilote les tailles du sceau,
 *    les polices et les espacements, pour un rendu visuellement cohérent
 *    qu'on soit sur un petit téléphone ou un grand écran / en paysage.
 *  - Aucune logique métier modifiée : mêmes hooks, mêmes effets, mêmes
 *    animations sous-jacentes (r1/r2/r3, o1/o2/o3), seul l'habillage change.
 */
import React, { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet,
  Animated, Easing, StatusBar, ScrollView, useWindowDimensions,
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

// ── Échelle responsive ──────────────────────────────────────────────────
// Dérivée du plus petit côté de l'écran (portrait ou paysage) pour que le
// rendu reste visuellement proportionnel quelle que soit la taille/l'
// orientation de l'appareil, sans jamais partir dans des extrêmes.
function useResponsiveScale() {
  const { width, height } = useWindowDimensions();
  const shortSide = Math.min(width, height);
  return Math.min(Math.max(shortSide / 360, 0.82), 1.18);
}

export function IdleScreen({ navigation }: IdleScreenProps) {
  useEffect(() => {
    keepAwake.activate();
    return () => keepAwake.deactivate();
  }, []);

  const { numeroAgent, serverUrl, setConnected, isConnected } = useAgentStore();
  const callStore = useCallStore();
  const errorMessage = useCallStore((s) => s.errorMessage);

  const scale = useResponsiveScale();
  const s = useMemo(() => createStyles(scale), [scale]);

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

  const pulse = (scaleV: Animated.Value, opacity: Animated.Value, delay: number) =>
    Animated.loop(
      Animated.sequence([
        Animated.delay(delay),
        Animated.parallel([
          Animated.timing(scaleV,  { toValue: 1.20, duration: 1600, easing: Easing.inOut(Easing.ease), useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0,    duration: 1600, easing: Easing.out(Easing.ease),   useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scaleV,  { toValue: 1, duration: 0, useNativeDriver: true }),
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
    console.log('[Idle] navigation vers IncomingCall', { callUuid, numeroMtn });
    callStore.setIncomingCall(numeroMtn, callUuid);
    setTimeout(() => {
      navigation.navigate('IncomingCall', { numeroMtn, callUuid });
    }, 120);
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
        onIncomingCall: (numeroMtn, serverCallUuid) => {
          console.log('[Idle] onIncomingCall callback reçu', { numeroMtn, serverCallUuid, status: callStore.status });
          // Réutilise le callUuid émis par le serveur quand il est présent
          // (voir public-dossiers.ts) : c'est le MÊME identifiant que celui
          // que le push FCM utilisera pour cet appel, donc on ignore les doublons
          // si le même appel est déjà traité.
          const uuid = serverCallUuid || `ws-${Date.now()}`;
          // Le serveur peut émettre plusieurs 'incoming-call' avec des uuid
          // DIFFÉRENTS pour le même appel logique (redial back-office pendant
          // que ça sonne déjà) — la seule dédup fiable est : un appel est-il
          // déjà en cours de traitement, peu importe son uuid ?
          if (callStore.status !== 'idle') {
            console.log('[Idle] appel déjà en cours, navigation IncomingCall ignorée', { statut: callStore.status, callUuid: uuid, numeroMtn });
            return;
          }
          console.log('[Idle] traitement incoming-call : showIncomingCall', { callUuid: uuid, numeroMtn });
          callStore.setIncomingCall(numeroMtn, uuid);
          void callHistoryService.upsert({ callUuid: uuid, numeroMtn, status: 'incoming' });
          notificationService.showIncomingCall(uuid, numeroMtn);
          // Pas de navigation.navigate ici : App.tsx observe callStore.status
          // et force seul l'ouverture de IncomingCall/Call. Avant, ce handler
          // ET App.tsx (chemin push/CallKeep) naviguaient chacun de leur
          // côté pour le même appel — deux autorités concurrentes qui se
          // marchaient dessus selon l'ordre d'arrivée des événements.
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

      {/* ── Centre : sceau + statut + carte de session ─────────────────── */}
      <ScrollView
        style={s.centerScroll}
        contentContainerStyle={s.center}
        showsVerticalScrollIndicator={false}
        bounces={false}
      >
        <Text style={s.eyebrow} numberOfLines={1} allowFontScaling={false}>
          ESPACE AGENT · KYC MOBILE
        </Text>

        <View style={s.sealWrap}>
          <Animated.View style={[s.ring, s.ring3, { transform: [{ scale: r3 }], opacity: o3 }]} />
          <Animated.View style={[s.ring, s.ring2, { transform: [{ scale: r2 }], opacity: o2 }]} />
          <Animated.View style={[s.ring, s.ring1, { transform: [{ scale: r1 }], opacity: o1 }]} />
          <View style={s.sealOuter}>
            <View style={s.sealInner}>
              <Text style={s.iconTxt}>📡</Text>
            </View>
          </View>
        </View>

        <Text style={s.waitTitle} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
          En attente d'un appel
        </Text>
        <Text style={s.waitSub} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
          Vous serez notifié à l'arrivée d'un appel
        </Text>

        {/* Carte de session — statut, durée et agent au même endroit */}
        <View style={s.sessionCard}>
          <View style={s.sessionField}>
            <Text style={s.sessionLabel} numberOfLines={1} allowFontScaling={false}>Statut</Text>
            <View style={s.sessionStatusRow}>
              <View style={[s.statusDot, { backgroundColor: isConnected ? C.success : C.dangerText }]} />
              <Text
                style={[s.sessionValueSm, { color: isConnected ? C.success : C.dangerText }]}
                numberOfLines={1}
                adjustsFontSizeToFit
                allowFontScaling={false}
              >
                {isConnected ? 'Connecté' : 'En cours…'}
              </Text>
            </View>
          </View>

          <View style={s.sessionSep} />

          <View style={s.sessionField}>
            <Text style={s.sessionLabel} numberOfLines={1} allowFontScaling={false}>Durée</Text>
            <Text style={s.sessionValue} numberOfLines={1} allowFontScaling={false}>
              {formatElapsed(elapsed)}
            </Text>
          </View>

          <View style={s.sessionSep} />

          <View style={s.sessionField}>
            <Text style={s.sessionLabel} numberOfLines={1} allowFontScaling={false}>Agent</Text>
            <Text
              style={s.sessionValue}
              numberOfLines={1}
              adjustsFontSizeToFit
              allowFontScaling={false}
              ellipsizeMode="tail"
            >
              {numeroAgent}
            </Text>
          </View>
        </View>

        {errorMessage ? (
          <View style={s.alertBanner} accessibilityRole="alert" accessibilityLiveRegion="polite">
            <Text style={s.alertIcon}>⚠️</Text>
            <Text
              style={s.alertText}
              numberOfLines={1}
              adjustsFontSizeToFit
              allowFontScaling={false}
            >
              {errorMessage}
            </Text>
          </View>
        ) : null}
      </ScrollView>

      {/* ── Action principale unique ─────────────────────────────────────── */}
      <View style={s.footer}>
        <TouchableOpacity
          style={s.ctaPrimary}
          activeOpacity={0.88}
          onPress={() => navigation.navigate('Acquisition')}
        >
          <View style={s.ctaIconWrap}>
            <Text style={s.ctaIcon}>📱</Text>
          </View>
          <View style={s.ctaTextWrap}>
            <Text style={s.ctaPrimaryTxt} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
              Soumettre un dossier
            </Text>
            <Text style={s.ctaPrimarySub} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
              Ouverture de compte KYC
            </Text>
          </View>
        </TouchableOpacity>

        <Text style={s.footerNote} numberOfLines={1} adjustsFontSizeToFit allowFontScaling={false}>
          Plateforme sécurisée · Identité vérifiée
        </Text>
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

// ── Styles pilotés par l'échelle responsive ──────────────────────────────
// `scale` (~0.82 à 1.18) est dérivée du plus petit côté de l'écran : tout ce
// qui a une empreinte visuelle forte (sceau, polices, espacements) en dépend,
// pour un rendu proportionnellement identique sur petit ou grand écran, en
// portrait comme en paysage.
function createStyles(scale: number) {
  const RING_BASE = 62 * scale;

  return StyleSheet.create({
    root: { flex: 1, backgroundColor: C.bg0 },

    // ── Centre (scrollable, ne peut jamais chevaucher le footer) ──
    centerScroll: { flex: 1 },
    center: {
      flexGrow: 1,
      alignItems: 'center', justifyContent: 'center',
      paddingHorizontal: 22, paddingVertical: 8 * scale,
    },

    eyebrow: {
      fontSize: 10.5 * scale,
      fontWeight: '800',
      color: C.blue,
      letterSpacing: 1.4,
      textTransform: 'uppercase',
      marginBottom: 10 * scale,
      opacity: 0.7,
    },

    // ── Sceau central (double anneau navy / or) ──
    sealWrap: {
      width: RING_BASE * 2.8, height: RING_BASE * 2.8,
      alignItems: 'center', justifyContent: 'center',
      marginBottom: 14 * scale,
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
    sealOuter: {
      width: 90 * scale, height: 90 * scale, borderRadius: 45 * scale,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: C.yellow,
      backgroundColor: 'rgba(255,255,255,0.9)',
      shadowColor: C.blue, shadowOpacity: 0.28, shadowRadius: 18, elevation: 12,
    },
    sealInner: {
      width: 72 * scale, height: 72 * scale, borderRadius: 36 * scale,
      backgroundColor: C.blue,
      alignItems: 'center', justifyContent: 'center',
      borderWidth: 2, borderColor: 'rgba(255,204,0,0.35)',
    },
    iconTxt: { fontSize: 28 * scale },

    waitTitle: {
      fontSize: T.xl * scale, fontWeight: '900', color: C.ink,
      letterSpacing: -0.5, textAlign: 'center',
      maxWidth: '100%',
    },
    waitSub: {
      fontSize: T.sm * scale, color: C.ink2, textAlign: 'center',
      marginTop: 5 * scale, maxWidth: '100%',
    },

    // ── Carte de session : statut / durée / agent, façon document officiel ──
    sessionCard: {
      flexDirection: 'row', alignItems: 'stretch',
      marginTop: 16 * scale, width: '100%', maxWidth: 360,
      backgroundColor: 'rgba(255,255,255,0.96)',
      borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)',
      borderRadius: R.lg, paddingVertical: 10 * scale, paddingHorizontal: 8,
      shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
      elevation: 3,
    },
    sessionField: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 4 },
    sessionSep: { width: 1, backgroundColor: 'rgba(15,23,42,0.10)', marginVertical: 2 },
    sessionLabel: {
      fontSize: 9.5 * scale, fontWeight: '700', color: C.ink2,
      letterSpacing: 0.6, textTransform: 'uppercase', marginBottom: 4 * scale,
    },
    sessionStatusRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    statusDot: { width: 6, height: 6, borderRadius: 3 },
    sessionValueSm: { fontSize: T.xs * scale, fontWeight: '800', letterSpacing: 0.1 },
    sessionValue: {
      fontSize: T.md * scale, fontWeight: '800', color: C.ink,
      fontVariant: ['tabular-nums'], letterSpacing: 0.1,
    },

    alertBanner: {
      flexDirection: 'row', alignItems: 'center', gap: 6,
      marginTop: 12 * scale,
      backgroundColor: 'rgba(217,45,32,0.10)',
      borderWidth: 1, borderColor: 'rgba(217,45,32,0.24)',
      borderRadius: R.md,
      paddingVertical: 6 * scale, paddingHorizontal: 10,
      maxWidth: 320, width: '100%',
    },
    alertIcon: { fontSize: 12 * scale },
    alertText: { fontSize: T.xs * scale, color: C.dangerText, fontWeight: '700', flex: 1 },

    // ── Footer : CTA institutionnel + mention de conformité ──
    footer: { paddingHorizontal: 20, paddingBottom: 12 * scale },
    ctaPrimary: {
      flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 10 * scale,
      paddingVertical: 12 * scale, paddingHorizontal: 16, borderRadius: R.lg,
      backgroundColor: C.yellow,
      shadowColor: C.shadowYellow, shadowOpacity: 0.32, shadowRadius: 14, shadowOffset: { width: 0, height: 6 },
      elevation: 8,
    },
    ctaIconWrap: {
      width: 34 * scale, height: 34 * scale, borderRadius: 17 * scale,
      alignItems: 'center', justifyContent: 'center',
      backgroundColor: 'rgba(0,48,135,0.10)',
    },
    ctaIcon: { fontSize: 15 * scale },
    ctaTextWrap: { alignItems: 'flex-start', flexShrink: 1 },
    ctaPrimaryTxt: { fontSize: T.md * scale, fontWeight: '800', color: C.blue, letterSpacing: 0.1 },
    ctaPrimarySub: { fontSize: 10.5 * scale, fontWeight: '600', color: C.blue, opacity: 0.65, marginTop: 1 },
    footerNote: {
      fontSize: 10 * scale, fontWeight: '600', color: C.ink2,
      textAlign: 'center', marginTop: 8 * scale, letterSpacing: 0.1, opacity: 0.85,
    },
  });
}