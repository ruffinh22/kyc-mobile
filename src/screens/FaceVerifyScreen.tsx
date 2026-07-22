/**
 * FaceVerifyScreen.tsx — Vérification Face Liveness via WebView mobile
 * ─────────────────────────────────────────────────────────────────────────────
 * Suite directe d'AcquisitionScreenPro : même charte "kyc-modern" (tokens
 * C/R/T), même grammaire visuelle plein écran sombre que l'étape caméra
 * (header overlay + point de statut + pastille dossier), pour que le passage
 * capture CNI → preuve de vivacité soit ressenti comme une seule expérience
 * continue plutôt que deux écrans différents.
 *
 * Cet écran charge la page web `/liveness-check?dossierId=...` dans une
 * WebView. La page web gère le flux AWS Amplify Liveness et renvoie le
 * résultat au parent via `window.ReactNativeWebView.postMessage(...)`.
 */

import React, { useMemo, useState, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  Animated,
  Platform,
} from 'react-native';
import WebView from 'react-native-webview';
import { useAgentStore } from '../store/callStore';
import { C, R, T } from '../theme/tokens';

type FaceVerifyParams = {
  dossierId: string;
  serverUrl: string;
  rectoPath?: string;
  versoPath?: string;
  numeroMtn?: string;
  waAgent?: string;
  country?: string;
  fonctionAgent?: string;
  zoneAgent?: string;
};

type FaceVerifyScreenProps = {
  route: { params: FaceVerifyParams };
  navigation: {
    goBack: () => void;
    navigate: (screen: string, params?: object) => void;
    replace: (screen: string, params?: object) => void;
  };
};

// ── Étapes du flux (miroir visuel du stepper d'AcquisitionScreenPro) ───────
const STAGES = [
  { id: 1, label: 'Connexion' },
  { id: 2, label: 'Scan facial' },
  { id: 3, label: 'Résultat' },
] as const;

export function FaceVerifyScreen({ route, navigation }: FaceVerifyScreenProps) {
  const {
    dossierId,
    serverUrl: routeServerUrl,
    numeroMtn,
  } = route.params;
  const agentServerUrl = useAgentStore((s) => s.serverUrl);

  const [status, setStatus] = useState<'loading' | 'ready' | 'done' | 'error'>('loading');
  const [message, setMessage] = useState<string>('Préparation de la vérification…');
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const shake = useCallback(() => {
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0, duration: 55, useNativeDriver: true }),
    ]).start();
  }, [shakeAnim]);

  // Petit pouls sur le point de statut pendant l'analyse — signal discret
  // que le flux est bien en cours (rassurant sur un réseau terrain lent).
  React.useEffect(() => {
    if (status !== 'loading' && status !== 'ready') return;
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(pulseAnim, { toValue: 1.6, duration: 650, useNativeDriver: true }),
        Animated.timing(pulseAnim, { toValue: 1, duration: 650, useNativeDriver: true }),
      ]),
    );
    loop.start();
    return () => loop.stop();
  }, [status, pulseAnim]);

  const baseServerUrl = useMemo(() => {
    const url = (routeServerUrl || agentServerUrl || '').trim();
    if (!url) return null;
    return url.startsWith('http') ? url.replace(/\/$/, '') : `http://${url.replace(/\/$/, '')}`;
  }, [agentServerUrl, routeServerUrl]);

  const livenessUrl = useMemo(() => {
    if (!baseServerUrl || !dossierId) return null;
    return `${baseServerUrl}/liveness-check?dossierId=${encodeURIComponent(dossierId)}`;
  }, [baseServerUrl, dossierId]);

  const handleWebMessage = useCallback((event: any) => {
    try {
      const payload = JSON.parse(event.nativeEvent.data);
      if (payload?.type === 'liveness-result') {
        setMessage(payload.message || 'Vérification terminée');
        if (payload.success) {
          setStatus('done');
          setTimeout(() => navigation.navigate('Idle'), 1800);
        } else {
          setError(payload.message || 'Vérification non concluante');
          setStatus('error');
          shake();
        }
        return;
      }
      if (payload?.type === 'liveness-error') {
        setError(payload.error || 'Erreur Face Liveness');
        setStatus('error');
        shake();
      }
    } catch (err) {
      setError('Réponse WebView invalide');
      setStatus('error');
      shake();
    }
  }, [navigation, shake]);

  const handleWebError = useCallback((syntheticEvent: any) => {
    const nativeEvent = syntheticEvent.nativeEvent;
    setError(nativeEvent.description || 'Erreur WebView');
    setStatus('error');
    shake();
  }, [shake]);

  const retry = useCallback(() => {
    setError(null);
    setStatus('loading');
    setMessage('Préparation de la vérification…');
    setReloadKey((k) => k + 1);
  }, []);

  const activeStage = status === 'loading' ? 1 : status === 'ready' ? 2 : 3;
  const dossierShort = dossierId ? `#${dossierId.slice(-6).toUpperCase()}` : null;

  // ── Serveur / dossier introuvable ──────────────────────────────────────
  if (!livenessUrl) {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#05070C" />
        <SafeAreaView style={s.centerBox}>
          <View style={s.errorIconRing}>
            <Text style={s.errorIconTxt}>⚠</Text>
          </View>
          <Text style={s.centerTitle}>Serveur introuvable</Text>
          <Text style={s.centerSub}>Le serveur ou l’identifiant du dossier est manquant. Reviens en arrière et relance la soumission.</Text>
          <TouchableOpacity style={s.primaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.88}>
            <Text style={s.primaryBtnTxt}>Retour</Text>
          </TouchableOpacity>
        </SafeAreaView>
      </View>
    );
  }

  // ── Résultat : succès ────────────────────────────────────────────────────
  if (status === 'done') {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#05070C" />
        <SafeAreaView style={s.centerBox}>
          <View style={s.successIconRing}>
            <Text style={s.successIconTxt}>✓</Text>
          </View>
          <Text style={s.centerTitle}>Identité vérifiée</Text>
          <Text style={s.centerSub}>{message}</Text>
          {dossierShort && <View style={s.dossierPill}><Text style={s.dossierPillTxt}>Dossier {dossierShort}</Text></View>}
          <View style={s.redirectRow}>
            <ActivityIndicator size="small" color={C.yellow} />
            <Text style={s.redirectTxt}>Redirection en cours…</Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Résultat : erreur ─────────────────────────────────────────────────────
  if (status === 'error') {
    return (
      <View style={s.root}>
        <StatusBar barStyle="light-content" backgroundColor="#05070C" />
        <SafeAreaView style={s.centerBox}>
          <Animated.View style={{ transform: [{ translateX: shakeAnim }], alignItems: 'center' }}>
            <View style={s.errorIconRing}>
              <Text style={s.errorIconTxt}>✕</Text>
            </View>
            <Text style={s.centerTitle}>Vérification échouée</Text>
            <Text style={s.centerSub}>{error || message}</Text>
          </Animated.View>
          {dossierShort && <View style={s.dossierPill}><Text style={s.dossierPillTxt}>Dossier {dossierShort}</Text></View>}
          <View style={s.errorActions}>
            <TouchableOpacity style={s.secondaryBtn} onPress={() => navigation.goBack()} activeOpacity={0.85}>
              <Text style={s.secondaryBtnTxt}>Retour</Text>
            </TouchableOpacity>
            <TouchableOpacity style={s.primaryBtn} onPress={retry} activeOpacity={0.88}>
              <Text style={s.primaryBtnTxt}>↺ Réessayer</Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ── Flux principal : connexion / scan en cours ─────────────────────────
  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="light-content" backgroundColor="#05070C" />

      <View style={s.header}>
        <TouchableOpacity style={s.closeBtn} onPress={() => navigation.goBack()} accessibilityRole="button" accessibilityLabel="Fermer la vérification">
          <Text style={s.closeTxt}>✕</Text>
        </TouchableOpacity>
        <View style={s.titleWrap}>
          <View style={s.titleTopRow}>
            <Animated.View style={[s.statusDot, { transform: [{ scale: pulseAnim }] }]} />
            <Text style={s.title}>Vérification faciale</Text>
          </View>
          <Text style={s.subtitle}>
            {dossierShort ? `Dossier ${dossierShort}` : 'Preuve de vivacité'}
            {numeroMtn ? ` · ${numeroMtn}` : ''}
          </Text>
        </View>
        <View style={s.headerSpacer} />
      </View>

      {/* ── Mini-stepper : Connexion → Scan facial → Résultat ──────────── */}
      <View style={s.stepper}>
        {STAGES.map((stage, i) => {
          const done = activeStage > stage.id;
          const active = activeStage === stage.id;
          return (
            <React.Fragment key={stage.id}>
              <View style={s.stepItem}>
                <View style={[s.stepDot, done && s.stepDotDone, active && s.stepDotActive]}>
                  {done ? <Text style={s.stepDotCheck}>✓</Text> : <Text style={[s.stepDotNum, active && s.stepDotNumActive]}>{stage.id}</Text>}
                </View>
                <Text style={[s.stepLabel, active && s.stepLabelActive]}>{stage.label}</Text>
              </View>
              {i < STAGES.length - 1 && <View style={[s.stepLine, done && s.stepLineDone]} />}
            </React.Fragment>
          );
        })}
      </View>

      <View style={s.webviewCard}>
        <WebView
          key={reloadKey}
          source={{ uri: livenessUrl }}
          style={s.webview}
          onLoadStart={() => { setStatus('loading'); setMessage('Connexion à la vérification…'); }}
          onLoadEnd={() => setStatus((prev) => (prev === 'loading' ? 'ready' : prev))}
          onMessage={handleWebMessage}
          onError={handleWebError}
          javaScriptEnabled
          domStorageEnabled
          startInLoadingState
        />
        {status === 'loading' && (
          <View style={s.loadingOverlay}>
            <View style={s.loadingRing}>
              <ActivityIndicator size="large" color={C.yellow} />
            </View>
            <Text style={s.loadingText}>{message}</Text>
          </View>
        )}
      </View>

      <View style={s.footer}>
        <Text style={s.footerHint}>
          {status === 'ready'
            ? 'Centre ton visage dans le cadre et suis les instructions à l’écran'
            : 'Ne quitte pas cette page pendant le chargement'}
        </Text>
      </View>
    </SafeAreaView>
  );
}

// ── Styles ───────────────────────────────────────────────────────────────
// Palette volontairement sombre (comme le mode caméra d'AcquisitionScreenPro)
// pour rester cohérent avec l'étape précédente du parcours et ne pas
// distraire l'agent pendant la capture live du visage.
const s = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: '#05070C',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 12) : 0,
    paddingBottom: Platform.OS === 'android' ? 8 : 0,
  },

  // Header overlay
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: 'rgba(15,23,32,0.72)',
    borderBottomWidth: 1,
    borderBottomColor: 'rgba(255,255,255,0.06)',
  },
  closeBtn: {
    width: 42, height: 42, borderRadius: 21,
    backgroundColor: 'rgba(255,255,255,0.10)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeTxt: { fontSize: 18, color: '#fff', fontWeight: '700' },
  headerSpacer: { width: 42 },
  titleWrap: { flex: 1, alignItems: 'center' },
  titleTopRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  statusDot: { width: 7, height: 7, borderRadius: 3.5, backgroundColor: C.yellow },
  title: { fontSize: T.md, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  subtitle: { fontSize: T.xs, color: 'rgba(255,255,255,0.55)', marginTop: 2, fontVariant: ['tabular-nums'] },

  // Stepper
  stepper: {
    flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center',
    paddingVertical: 16, paddingHorizontal: 28,
  },
  stepItem: { alignItems: 'center', gap: 6, width: 74 },
  stepDot: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  stepDotActive: { backgroundColor: C.blue, borderColor: C.yellow },
  stepDotDone: { backgroundColor: 'rgba(34,197,94,0.18)', borderColor: C.success },
  stepDotNum: { fontSize: T.xs, fontWeight: '700', color: 'rgba(255,255,255,0.5)' },
  stepDotNumActive: { color: '#fff' },
  stepDotCheck: { fontSize: T.xs, fontWeight: '800', color: C.success },
  stepLabel: { fontSize: 10, fontWeight: '700', color: 'rgba(255,255,255,0.4)', textAlign: 'center' },
  stepLabelActive: { color: '#fff' },
  stepLine: { flex: 1, height: 1.5, backgroundColor: 'rgba(255,255,255,0.14)', marginTop: 13, marginHorizontal: -6 },
  stepLineDone: { backgroundColor: C.success },

  // Carte WebView
  webviewCard: {
    flex: 1,
    marginHorizontal: 14,
    marginBottom: 12,
    borderRadius: R.xl,
    overflow: 'hidden',
    backgroundColor: '#000',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.10)',
    minHeight: 260,
    marginTop: 8,
  },
  webview: { flex: 1, backgroundColor: '#000' },

  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(5,7,12,0.92)',
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 24,
    gap: 14,
  },
  loadingRing: {
    width: 84, height: 84, borderRadius: 42,
    borderWidth: 1.5, borderColor: 'rgba(255,204,0,0.35)',
    alignItems: 'center', justifyContent: 'center',
  },
  loadingText: {
    color: 'rgba(255,255,255,0.85)',
    fontSize: T.sm,
    fontWeight: '600',
    textAlign: 'center',
  },

  footer: {
    paddingHorizontal: 24, paddingBottom: 18, paddingTop: 2,
    alignItems: 'center',
  },
  footerHint: {
    fontSize: T.xs,
    color: 'rgba(255,255,255,0.45)',
    textAlign: 'center',
  },

  // États plein écran (succès / erreur / serveur introuvable)
  centerBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    gap: 6,
  },
  successIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(34,197,94,0.14)',
    borderWidth: 1.5, borderColor: C.success,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  successIconTxt: { fontSize: 40, color: C.success, fontWeight: '800' },
  errorIconRing: {
    width: 88, height: 88, borderRadius: 44,
    backgroundColor: 'rgba(248,113,113,0.14)',
    borderWidth: 1.5, borderColor: C.danger,
    alignItems: 'center', justifyContent: 'center',
    marginBottom: 18,
  },
  errorIconTxt: { fontSize: 36, color: C.dangerText || '#f87171', fontWeight: '800' },
  centerTitle: {
    fontSize: T.xl, fontWeight: '900', color: '#fff',
    textAlign: 'center', letterSpacing: -0.3, marginBottom: 8,
  },
  centerSub: {
    fontSize: T.sm, color: 'rgba(255,255,255,0.62)',
    textAlign: 'center', lineHeight: 20, marginBottom: 6,
  },
  dossierPill: {
    marginTop: 8,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.14)',
    borderRadius: R.pill, paddingVertical: 6, paddingHorizontal: 14,
  },
  dossierPillTxt: { fontSize: T.xs, fontWeight: '700', color: 'rgba(255,255,255,0.7)', fontVariant: ['tabular-nums'] },

  redirectRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 22 },
  redirectTxt: { fontSize: T.xs, color: 'rgba(255,255,255,0.5)', fontWeight: '600' },

  errorActions: { flexDirection: 'row', gap: 10, marginTop: 26, width: '100%' },
  primaryBtn: {
    flex: 1,
    backgroundColor: C.yellow,
    borderRadius: R.lg,
    paddingVertical: 15,
    alignItems: 'center',
    shadowColor: C.shadowYellow, shadowOpacity: 0.3, shadowRadius: 14, elevation: 8,
    marginTop: 22,
  },
  primaryBtnTxt: { fontSize: T.base, fontWeight: '800', color: C.blue },
  secondaryBtn: {
    flex: 1,
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderWidth: 1.5, borderColor: 'rgba(255,255,255,0.18)',
    borderRadius: R.lg,
    paddingVertical: 15,
    alignItems: 'center',
  },
  secondaryBtnTxt: { fontSize: T.base, fontWeight: '700', color: '#fff' },
});