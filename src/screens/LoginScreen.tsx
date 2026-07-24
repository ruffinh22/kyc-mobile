/**
 * LoginScreen.tsx — KYC Mobile V4 "Pro"
 * ─────────────────────────────────────────────────────────────────────────────
 * Charte MTN kyc-modern-light : fond blanc, accents Jaune #FFCC00 · Bleu #003087
 * Capture UNE FOIS le profil complet de l'agent : pays, WhatsApp, fonction,
 * zone, URL serveur. Le profil est stocké (store + AsyncStorage + DB via API).
 * L'écran Acquisition n'aura ensuite plus qu'à demander le numéro MTN + photos.
 */
import React, { useEffect, useState, useRef } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet,
  KeyboardAvoidingView, Platform, ScrollView,
  ActivityIndicator, Animated, StatusBar,
} from 'react-native';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { useAgentStore } from '../store/callStore';
import { CountryPicker } from '../components/CountryPicker';
import { SimpleSelect }  from '../components/SimpleSelect';
import { validatePhoneNumber, getCountryConfig } from '../utils/phoneValidator';
import { normalizeServerUrl } from '../utils/serverUrl';
import { C, R, T } from '../theme/tokens';
import { AppHeader } from '../components/AppHeader';

const DEFAULT_SERVER  = 'https://kyc.palladiumafrica.com';
const DEFAULT_COUNTRY = 'CG';

const FONCTIONS = ['Agent Acquisition', 'Agent EBU', 'Agent Frontoffice', 'Autre'];
const ZONES     = ['Brazzaville', 'Pointe-Noire', 'Hinterland Nord', 'Hinterland Sud', 'Autre'];

function buildProbeUrls(serverUrl: string): string[] {
  const candidates = new Set<string>();
  const normalized = serverUrl.replace(/\/$/, '');

  const add = (value: string) => {
    const clean = value.replace(/\/$/, '');
    if (clean) candidates.add(clean);
  };

  add(normalized);
  add('http://localhost:3001');
  add('http://127.0.0.1:3001');
  add('http://10.0.2.2:3001');

  const urls: string[] = [];
  candidates.forEach(candidate => {
    const base = candidate.replace(/\/api\/health$/i, '').replace(/\/health$/i, '');
    add(`${base}/api/health`);
    add(`${base}/health`);
  });

  candidates.forEach(candidate => {
    if (candidate.endsWith('/api/health') || candidate.endsWith('/health')) {
      urls.push(candidate);
    }
  });

  return urls;
}

// Enregistre le profil agent côté serveur (DB). Adapter la route si besoin.
async function registerAgentProfile(baseUrl: string, profile: {
  numero_agent: string; country: string; fonction_agent: string; zone_agent: string;
}) {
  const ctrl = new AbortController();
  const tid = setTimeout(() => ctrl.abort(), 6000);
  try {
    const res = await fetch(`${baseUrl}/api/public/agents/register`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(profile),
      signal: ctrl.signal,
    });
    if (!res.ok) {
      console.warn('[Login] Enregistrement du profil agent refusé par le serveur :', res.status);
    }
  } catch (e) {
    // Non bloquant : si l'enregistrement DB échoue, l'agent reste utilisable
    // en local ; le prochain login/submit pourra retenter. On logue quand
    // même pour ne pas perdre ce signal en support/debug.
    console.warn('[Login] Enregistrement du profil agent échoué (non bloquant) :', e);
  } finally {
    clearTimeout(tid);
  }
}

type LoginScreenProps = { navigation: { replace: (screen: string, params?: object) => void } };

export function LoginScreen({ navigation }: LoginScreenProps) {
  const [countryCode,    setCountryCode]    = useState(DEFAULT_COUNTRY);
  const [numero,         setNumero]         = useState('');
  const [fonctionAgent,  setFonctionAgent]  = useState('');
  const [zoneAgent,      setZoneAgent]      = useState('');
  const [serverUrl,      setServerUrl]      = useState(DEFAULT_SERVER);
  const [loading,        setLoading]        = useState(false);
  const [error,          setError]          = useState('');
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const setAgent  = useAgentStore(s => s.setAgent);

  useEffect(() => {
    let mounted = true;
    (async () => {
      try {
        const savedServer = await AsyncStorage.getItem('kyc_server');
        if (!mounted || !savedServer) return;
        const normalized = normalizeServerUrl(savedServer);
        if (normalized) {
          setServerUrl(normalized);
        }
      } catch {
        // Ignorer les erreurs de lecture locale ; on garde la valeur par défaut.
      }
    })();
    return () => { mounted = false; };
  }, []);

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 55, useNativeDriver: true }),
    ]).start();

  const handleConnect = async () => {
    const v = validatePhoneNumber(numero, countryCode);
    if (!v.isValid)                 { setError(v.error || 'Numéro invalide'); shake(); return; }
    if (!fonctionAgent)             { setError('Sélectionnez votre fonction'); shake(); return; }
    if (!zoneAgent)                 { setError('Sélectionnez votre zone'); shake(); return; }
    if (!serverUrl.startsWith('http')) { setError('URL serveur invalide'); shake(); return; }

    const normalizedServerUrl = normalizeServerUrl(serverUrl);
    setServerUrl(normalizedServerUrl);
    setLoading(true); setError('');
    const urls = buildProbeUrls(normalizedServerUrl);
    const ctrl = new AbortController();
    const tid = setTimeout(() => ctrl.abort(), 5000);
    let res: Response | null = null;
    let resolvedServer = normalizedServerUrl.replace(/\/$/, '');
    try {
      for (const url of urls) {
        try {
          res = await fetch(url, { signal: ctrl.signal });
          if (res.ok) {
            resolvedServer = url.replace(/\/api\/health$/i, '').replace(/\/health$/i, '');
            break;
          }
        } catch (e) {
          console.warn(`[Login] Sonde serveur injoignable, tentative suivante : ${url}`, e);
        }
      }
      clearTimeout(tid);
      if (!res || !res.ok) throw new Error('Aucune URL de sonde n\'a répondu OK');
    } catch (e) {
      console.warn('[Login] Impossible de joindre un serveur KYC :', e);
      setError('Impossible de joindre le serveur. Vérifie l\'IP de ton PC ou utilise adb reverse.');
      shake(); setLoading(false); return;
    }

    const clean = numero.replace(/\D/g, '');

    // Persistance locale (redémarrage app)
    await AsyncStorage.multiSet([
      ['kyc_numero',    clean],
      ['kyc_server',    resolvedServer],
      ['kyc_country',   countryCode],
      ['kyc_fonction',  fonctionAgent],
      ['kyc_zone',      zoneAgent],
    ]);

    // Store global — dispo immédiatement pour Idle / Acquisition
    setAgent({
      numeroAgent:   clean,
      country:       countryCode,
      fonctionAgent,
      zoneAgent,
      serverUrl:     resolvedServer,
    });

    // Enregistrement côté DB (non bloquant)
    registerAgentProfile(resolvedServer, {
      numero_agent: clean, country: countryCode,
      fonction_agent: fonctionAgent, zone_agent: zoneAgent,
    });

    setLoading(false);
    navigation.replace('Idle');
  };

  const cfg       = getCountryConfig(countryCode);
  const valid     = validatePhoneNumber(numero, countryCode);
  const canSubmit = numero.length > 0 && valid.isValid && !!fonctionAgent && !!zoneAgent;

  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />

      {/* ── Orbes décoratives ── */}
      <View style={s.orb1} pointerEvents="none" />
      <View style={s.orb2} pointerEvents="none" />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Hero ── */}
          <View style={s.hero}>
            <View style={s.mtnBadge}>
              <View style={s.mtnBadgeInner}>
                <Text style={s.mtnBadgeTxt}>MTN</Text>
              </View>
              <View style={s.mtnBadgeMeta}>
                <Text style={s.mtnBadgeLabel}>KYC Congo</Text>
                <Text style={s.mtnBadgeSub}>Plateforme Agent — V4</Text>
              </View>
            </View>

            <View style={s.eyebrowRow}>
              <View style={s.eyebrowDot} />
              <Text style={s.eyebrow}>PROFIL AGENT TERRAIN</Text>
            </View>
            <Text style={s.title}>Créer / retrouver{'\n'}mon accès</Text>
            <Text style={s.subtitle}>
              Ces informations sont saisies une seule fois.{'\n'}
              Ensuite, chaque dossier ne demandera que{'\n'}le numéro MTN et les photos.
            </Text>
          </View>

          {/* ── Formulaire ── */}
          <Animated.View style={[s.card, { transform: [{ translateX: shakeAnim }] }]}>
            <View style={s.cardAccent} />

            <View style={s.cardBody}>

              {/* Section 1 — Identité agent */}
              <View style={s.sectionHeader}>
                <View style={s.sectionNum}><Text style={s.sectionNumTxt}>1</Text></View>
                <Text style={s.sectionTitle}>Votre identité</Text>
              </View>

              <Text style={s.fieldLabel}>Pays</Text>
              <CountryPicker selectedCountry={countryCode} onSelect={setCountryCode} />

              <Text style={[s.fieldLabel, { marginTop: 18 }]}>Numéro WhatsApp</Text>
              <View style={s.inputWrap}>
                <TextInput
                  style={s.input}
                  value={numero}
                  onChangeText={v => {
                    const digits = v.replace(/\D/g, '');
                    const maxLen = countryCode === 'BJ' ? 10 : (cfg?.maxLength || 10);
                    const nextValue = countryCode === 'BJ' ? digits.slice(0, maxLen) : digits;
                    setNumero(nextValue);
                    setError('');
                  }}
                  placeholder={countryCode === 'BJ' ? '01XXXXXXXX' : (cfg?.placeholder || 'XXXXXXXX')}
                  placeholderTextColor={C.ink3}
                  keyboardType="numeric"
                  maxLength={countryCode === 'BJ' ? 10 : (cfg?.maxLength || 10)}
                  returnKeyType="next"
                />
                {numero.length > 0 && (
                  <View style={[s.validDot, { backgroundColor: valid.isValid ? C.success : C.danger }]} />
                )}
              </View>
              {numero.length > 0 && (
                <Text style={[s.hint, { color: valid.isValid ? C.successText : C.dangerText }]}>
                  {valid.isValid ? '✓ Format valide' : valid.error}
                </Text>
              )}

              <View style={{ marginTop: 18 }}>
                <SimpleSelect label="Fonction" value={fonctionAgent} options={FONCTIONS} onSelect={setFonctionAgent} />
              </View>
              <View style={{ marginTop: 14 }}>
                <SimpleSelect label="Zone" value={zoneAgent} options={ZONES} onSelect={setZoneAgent} />
              </View>

              <View style={s.divider} />

              {/* Section 2 — Serveur */}
              <View style={s.sectionHeader}>
                <View style={s.sectionNum}><Text style={s.sectionNumTxt}>2</Text></View>
                <Text style={s.sectionTitle}>Connexion serveur</Text>
              </View>

              <Text style={s.fieldLabel}>URL serveur</Text>
              <TextInput
                style={[s.input, { fontSize: T.sm, letterSpacing: 0 }]}
                value={serverUrl}
                onChangeText={setServerUrl}
                placeholder="https://kyc.example.com"
                placeholderTextColor={C.ink3}
                keyboardType="url"
                autoCapitalize="none"
                returnKeyType="done"
                onSubmitEditing={handleConnect}
              />

              {!!error && (
                <View style={s.errBox}>
                  <Text style={s.errIcon}>⚠</Text>
                  <Text style={s.errTxt}>{error}</Text>
                </View>
              )}

              <TouchableOpacity
                style={[s.btn, !canSubmit && s.btnOff]}
                onPress={handleConnect}
                disabled={!canSubmit || loading}
                activeOpacity={0.88}
                accessibilityRole="button"
                accessibilityLabel="Créer mon accès"
                accessibilityState={{ disabled: !canSubmit || loading }}
              >
                {loading
                  ? <ActivityIndicator color={C.blue} />
                  : <Text style={s.btnTxt}>Créer mon accès →</Text>
                }
              </TouchableOpacity>
            </View>
          </Animated.View>

          <Text style={s.footer}>Media Contact · The offshore company</Text>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },
  kav:  { flex: 1 },
  scroll: {
    flexGrow: 1, justifyContent: 'center', alignItems: 'center',
    paddingHorizontal: 18, paddingVertical: 32,
  },

  orb1: {
    position: 'absolute', top: -90, right: -80,
    width: 320, height: 320, borderRadius: 160,
    backgroundColor: 'rgba(0,48,135,0.12)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    opacity: 0.95,
  },
  orb2: {
    position: 'absolute', bottom: -90, left: -70,
    width: 260, height: 260, borderRadius: 130,
    backgroundColor: 'rgba(255,204,0,0.16)',
    borderWidth: 1, borderColor: 'rgba(255,255,255,0.45)',
    opacity: 0.95,
  },

  // ── Hero ──
  hero: { alignItems: 'center', marginBottom: 24, width: '100%', maxWidth: 420 },

  mtnBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1, borderColor: 'rgba(0,48,135,0.16)',
    borderRadius: R.lg, paddingVertical: 10, paddingHorizontal: 16,
    marginBottom: 24,
    alignSelf: 'flex-start',
    shadowColor: '#0F1720', shadowOpacity: 0.08, shadowRadius: 16, shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  mtnBadgeInner: {
    backgroundColor: C.blue, borderRadius: R.sm,
    paddingVertical: 4, paddingHorizontal: 10,
  },
  mtnBadgeMeta: { flexDirection: 'column', justifyContent: 'center' },
  mtnBadgeTxt:   { fontSize: T.md, fontWeight: '900', color: C.yellow, letterSpacing: -0.5 },
  mtnBadgeLabel: { fontSize: T.base, fontWeight: '800', color: C.ink, letterSpacing: -0.2 },
  mtnBadgeSub:   { fontSize: T.xs, color: C.ink3, marginTop: 1 },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 10 },
  eyebrowDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.yellow },
  eyebrow: {
    fontSize: T.xs, fontWeight: '700', color: C.blue,
    letterSpacing: 2, textTransform: 'uppercase',
  },
  title: {
    fontSize: T['3xl'], fontWeight: '900', color: C.ink,
    letterSpacing: -0.9, textAlign: 'center',
  },
  subtitle: {
    fontSize: T.sm, color: C.ink2, textAlign: 'center',
    marginTop: 10, lineHeight: 20,
  },

  // ── Card ──
  card: {
    width: '100%', maxWidth: 420,
    backgroundColor: 'rgba(255,255,255,0.96)',
    borderRadius: R.xl,
    borderWidth: 1, borderColor: 'rgba(15,23,42,0.08)',
    overflow: 'hidden',
    shadowColor: '#0F1720',
    shadowOpacity: 0.16, shadowRadius: 32, shadowOffset: { width: 0, height: 18 },
    elevation: 12,
  },
  cardAccent: { height: 3, backgroundColor: C.yellow },
  cardBody:   { padding: 24 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 16 },
  sectionNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center',
  },
  sectionNumTxt: { fontSize: T.xs, fontWeight: '900', color: C.blue },
  sectionTitle:  { fontSize: T.base, fontWeight: '800', color: C.ink, letterSpacing: -0.2 },

  fieldLabel: {
    fontSize: T.xs, fontWeight: '700', color: C.ink2,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },

  inputWrap: { position: 'relative', justifyContent: 'center' },
  input: {
    backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.md,
    paddingVertical: 14, paddingHorizontal: 16,
    fontSize: T.lg, fontWeight: '700', color: C.ink,
    letterSpacing: 2, fontVariant: ['tabular-nums'],
  },
  validDot: { position: 'absolute', right: 14, width: 8, height: 8, borderRadius: 4 },
  hint: { fontSize: T.xs, marginTop: 6, fontWeight: '600' },

  divider: { height: 1, backgroundColor: C.bgBorder, marginVertical: 22 },

  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    marginTop: 16, padding: 12,
    backgroundColor: C.dangerSoft,
    borderWidth: 1, borderColor: C.dangerBorder,
    borderRadius: R.md,
  },
  errIcon: { fontSize: T.base, color: C.dangerText },
  errTxt:  { fontSize: T.sm, color: C.dangerText, flex: 1 },

  btn: {
    marginTop: 22, paddingVertical: 16,
    backgroundColor: C.yellow,
    borderRadius: R.lg, alignItems: 'center',
    shadowColor: C.shadowYellow, shadowOpacity: 0.32, shadowRadius: 16, elevation: 8,
  },
  btnOff: { opacity: 0.45 },
  btnTxt: { fontSize: T.md, fontWeight: '800', color: C.blue, letterSpacing: -0.2 },

  footer: { fontSize: T.xs, color: C.ink3, marginTop: 28, textAlign: 'center' },
});