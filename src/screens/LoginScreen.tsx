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
  const [numeroFocused,  setNumeroFocused]  = useState(false);
  const [serverFocused,  setServerFocused]  = useState(false);

  const shakeAnim = useRef(new Animated.Value(0)).current;
  const enterOpacity = useRef(new Animated.Value(0)).current;
  const enterOffset  = useRef(new Animated.Value(22)).current;
  const btnScale     = useRef(new Animated.Value(1)).current;

  const setAgent = useAgentStore(s => s.setAgent);

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

  useEffect(() => {
    Animated.parallel([
      Animated.timing(enterOpacity, { toValue: 1, duration: 480, useNativeDriver: true }),
      Animated.timing(enterOffset,  { toValue: 0, duration: 480, useNativeDriver: true }),
    ]).start();
  }, []);

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -8, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 8,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 55, useNativeDriver: true }),
    ]).start();

  const pressIn  = () => Animated.spring(btnScale, { toValue: 0.97, useNativeDriver: true, speed: 40, bounciness: 6 }).start();
  const pressOut = () => Animated.spring(btnScale, { toValue: 1,    useNativeDriver: true, speed: 40, bounciness: 6 }).start();

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
      <AppHeader title="Connexion" subtitle="Profil agent" />

      {/* ── Orbes décoratives ── */}
      <View style={s.orb1} pointerEvents="none" />
      <View style={s.orb1Ring} pointerEvents="none" />
      <View style={s.orb2} pointerEvents="none" />
      <View style={s.orb2Ring} pointerEvents="none" />
      <View style={s.orb3} pointerEvents="none" />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
        <ScrollView contentContainerStyle={s.scroll} keyboardShouldPersistTaps="handled">

          {/* ── Hero ── */}
          <Animated.View style={[s.hero, { opacity: enterOpacity, transform: [{ translateY: enterOffset }] }]}>
            

            <View style={s.eyebrowRow}>
              <View style={s.eyebrowDot} />
              <Text style={s.eyebrow} numberOfLines={1} adjustsFontSizeToFit>
                PROFIL AGENT TERRAIN
              </Text>
              <View style={s.eyebrowDot} />
            </View>

            <Text
              style={s.title}
              numberOfLines={1}
              adjustsFontSizeToFit
              minimumFontScale={0.6}
            >
              Créer / retrouver mon accès
            </Text>

            <Text style={s.subtitle}>
              Ces informations sont saisies une seule fois. Ensuite, chaque dossier ne demandera que le numéro MTN et les photos.
            </Text>

            <View style={s.timeChip}>
              <Text style={s.timeChipIcon}>⏱</Text>
              <Text style={s.timeChipTxt}>Environ 30 secondes</Text>
            </View>
          </Animated.View>

          {/* ── Formulaire ── */}
          <Animated.View
            style={[
              s.card,
              {
                opacity: enterOpacity,
                transform: [
                  { translateY: enterOffset },
                  { translateX: shakeAnim },
                ],
              },
            ]}
          >
            <View style={s.cardAccentTrack}>
              <View style={s.cardAccentFill} />
            </View>

            <View style={s.cardBody}>

              {/* Section 1 — Identité agent */}
              <View style={s.sectionHeader}>
                <View style={s.sectionNumRing}>
                  <View style={s.sectionNum}><Text style={s.sectionNumTxt}>1</Text></View>
                </View>
                <View>
                  <Text style={s.sectionTitle}>Votre identité</Text>
                  <Text style={s.sectionCaption}>Pays, numéro et rôle terrain</Text>
                </View>
              </View>

              <Text style={s.fieldLabel}>Pays</Text>
              <CountryPicker selectedCountry={countryCode} onSelect={setCountryCode} />

              <Text style={[s.fieldLabel, { marginTop: 18 }]}>Numéro WhatsApp</Text>
              <View
                style={[
                  s.inputWrap,
                  numeroFocused && s.inputWrapFocused,
                  numero.length > 0 && !valid.isValid && s.inputWrapError,
                ]}
              >
                <View style={s.inputIconWrap}>
                  <Text style={s.inputIcon}>📱</Text>
                </View>
                <TextInput
                  style={s.input}
                  value={numero}
                  onFocus={() => setNumeroFocused(true)}
                  onBlur={() => setNumeroFocused(false)}
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
                  <View style={[s.validPill, { backgroundColor: valid.isValid ? C.success : C.danger }]}>
                    <Text style={s.validPillTxt}>{valid.isValid ? '✓' : '!'}</Text>
                  </View>
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

              <View style={s.divider}>
                <View style={s.dividerLine} />
                <View style={s.dividerDot} />
                <View style={s.dividerLine} />
              </View>

              {/* Section 2 — Serveur */}
              <View style={s.sectionHeader}>
                <View style={s.sectionNumRing}>
                  <View style={s.sectionNum}><Text style={s.sectionNumTxt}>2</Text></View>
                </View>
                <View>
                  <Text style={s.sectionTitle}>Connexion serveur</Text>
                  <Text style={s.sectionCaption}>Adresse de votre backend KYC</Text>
                </View>
              </View>

              <Text style={s.fieldLabel}>URL serveur</Text>
              <View style={[s.inputWrap, serverFocused && s.inputWrapFocused]}>
                <View style={s.inputIconWrap}>
                  <Text style={s.inputIcon}>🌐</Text>
                </View>
                <TextInput
                  style={[s.input, { fontSize: T.sm, letterSpacing: 0 }]}
                  value={serverUrl}
                  onFocus={() => setServerFocused(true)}
                  onBlur={() => setServerFocused(false)}
                  onChangeText={setServerUrl}
                  placeholder="https://kyc.example.com"
                  placeholderTextColor={C.ink3}
                  keyboardType="url"
                  autoCapitalize="none"
                  returnKeyType="done"
                  onSubmitEditing={handleConnect}
                />
              </View>

              {!!error && (
                <View style={s.errBox}>
                  <View style={s.errIconWrap}>
                    <Text style={s.errIcon}>⚠</Text>
                  </View>
                  <Text style={s.errTxt}>{error}</Text>
                </View>
              )}

              <Animated.View style={{ transform: [{ scale: btnScale }], marginTop: 22 }}>
                <TouchableOpacity
                  style={[s.btn, !canSubmit && s.btnOff]}
                  onPress={handleConnect}
                  onPressIn={pressIn}
                  onPressOut={pressOut}
                  disabled={!canSubmit || loading}
                  activeOpacity={0.9}
                  accessibilityRole="button"
                  accessibilityLabel="Créer mon accès"
                  accessibilityState={{ disabled: !canSubmit || loading }}
                >
                  <View style={s.btnSheen} pointerEvents="none" />
                  {loading
                    ? <ActivityIndicator color={C.blue} />
                    : (
                      <View style={s.btnContent}>
                        <Text style={s.btnTxt}>Créer mon accès</Text>
                        <View style={s.btnArrowWrap}>
                          <Text style={s.btnArrow}>→</Text>
                        </View>
                      </View>
                    )
                  }
                </TouchableOpacity>
              </Animated.View>
            </View>
          </Animated.View>

          <View style={s.footerRow}>
            <Text style={s.footerLock}>🔒</Text>
            <Text style={s.footer}>Media Contact · The offshore company</Text>
          </View>
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },
  kav:  { flex: 1 },
  scroll: {
    flexGrow: 1, justifyContent: 'flex-start', alignItems: 'center',
    paddingHorizontal: 18, paddingTop: 12, paddingBottom: 32,
  },

  // ── Orbes décoratives (halo premium multi-couches) ──
  orb1: {
    position: 'absolute', top: -110, right: -100,
    width: 360, height: 360, borderRadius: 180,
    backgroundColor: 'rgba(0,48,135,0.10)',
  },
  orb1Ring: {
    position: 'absolute', top: -70, right: -60,
    width: 240, height: 240, borderRadius: 120,
    borderWidth: 1, borderColor: 'rgba(0,48,135,0.14)',
  },
  orb2: {
    position: 'absolute', bottom: -110, left: -90,
    width: 300, height: 300, borderRadius: 150,
    backgroundColor: 'rgba(255,204,0,0.14)',
  },
  orb2Ring: {
    position: 'absolute', bottom: -60, left: -40,
    width: 190, height: 190, borderRadius: 95,
    borderWidth: 1, borderColor: 'rgba(255,204,0,0.22)',
  },
  orb3: {
    position: 'absolute', top: '38%', right: -60,
    width: 140, height: 140, borderRadius: 70,
    backgroundColor: 'rgba(0,48,135,0.05)',
  },

  // ── Hero ──
  hero: { alignItems: 'center', marginBottom: 20, width: '100%', maxWidth: 420 },

  secureBadge: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1, borderColor: 'rgba(0,48,135,0.14)',
    borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12,
    marginBottom: 16,
    shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 10, shadowOffset: { width: 0, height: 4 },
    elevation: 2,
  },
  secureBadgeDotWrap: {
    width: 14, height: 14, borderRadius: 7,
    backgroundColor: 'rgba(46,196,120,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  secureBadgeDot: { width: 6, height: 6, borderRadius: 3, backgroundColor: C.success },
  secureBadgeTxt: { fontSize: T.xs, fontWeight: '700', color: C.blue, letterSpacing: 0.2 },

  eyebrowRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  eyebrowDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.yellow },
  eyebrow: {
    fontSize: T.xs, fontWeight: '800', color: C.blue,
    letterSpacing: 2.4, textTransform: 'uppercase',
  },
  title: {
    width: '100%',
    fontSize: T['2xl'], fontWeight: '900', color: C.ink,
    letterSpacing: -0.8, textAlign: 'center', lineHeight: 38,
  },
  subtitle: {
    fontSize: T.base, color: C.ink2, textAlign: 'center',
    marginTop: 10, lineHeight: 22, maxWidth: 340,
  },

  timeChip: {
    flexDirection: 'row', alignItems: 'center', gap: 6,
    marginTop: 16,
    backgroundColor: 'rgba(0,48,135,0.06)',
    borderRadius: 999, paddingVertical: 5, paddingHorizontal: 12,
  },
  timeChipIcon: { fontSize: T.xs },
  timeChipTxt: { fontSize: T.xs, fontWeight: '700', color: C.blue, letterSpacing: 0.2 },

  // ── Card ──
  card: {
    width: '100%', maxWidth: 420,
    backgroundColor: 'rgba(255,255,255,0.98)',
    borderRadius: R.xl,
    borderWidth: 1, borderColor: 'rgba(15,23,42,0.07)',
    overflow: 'hidden',
    shadowColor: '#0F1720',
    shadowOpacity: 0.18, shadowRadius: 36, shadowOffset: { width: 0, height: 20 },
    elevation: 14,
  },
  cardAccentTrack: { height: 4, backgroundColor: 'rgba(0,48,135,0.08)' },
  cardAccentFill:  { height: 4, width: '42%', backgroundColor: C.yellow, borderTopRightRadius: 4, borderBottomRightRadius: 4 },
  cardBody: { padding: 26 },

  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 18 },
  sectionNumRing: {
    width: 34, height: 34, borderRadius: 17,
    backgroundColor: 'rgba(255,204,0,0.18)',
    alignItems: 'center', justifyContent: 'center',
  },
  sectionNum: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center',
    shadowColor: C.shadowYellow, shadowOpacity: 0.4, shadowRadius: 6, elevation: 3,
  },
  sectionNumTxt: { fontSize: T.xs, fontWeight: '900', color: C.blue },
  sectionTitle:  { fontSize: T.base, fontWeight: '800', color: C.ink, letterSpacing: -0.2 },
  sectionCaption:{ fontSize: T.xs, fontWeight: '500', color: C.ink3, marginTop: 1 },

  fieldLabel: {
    fontSize: T.xs, fontWeight: '700', color: C.ink2,
    textTransform: 'uppercase', letterSpacing: 0.8, marginBottom: 8,
  },

  inputWrap: {
    flexDirection: 'row', alignItems: 'center',
    backgroundColor: C.bg2,
    borderWidth: 1.5, borderColor: C.bgBorder,
    borderRadius: R.md,
    paddingHorizontal: 6,
  },
  inputWrapFocused: {
    borderColor: C.blue,
    backgroundColor: 'rgba(0,48,135,0.03)',
    shadowColor: C.blue, shadowOpacity: 0.12, shadowRadius: 10, shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  inputWrapError: { borderColor: C.danger },
  inputIconWrap: {
    width: 32, height: 32, borderRadius: R.sm,
    alignItems: 'center', justifyContent: 'center',
  },
  inputIcon: { fontSize: 15 },
  input: {
    flex: 1,
    paddingVertical: 12, paddingRight: 12,
    fontSize: T.md, fontWeight: '700', color: C.ink,
    letterSpacing: 1, fontVariant: ['tabular-nums'],
  },
  validPill: {
    width: 22, height: 22, borderRadius: 11,
    alignItems: 'center', justifyContent: 'center',
    marginRight: 8,
  },
  validPillTxt: { fontSize: 12, fontWeight: '900', color: '#fff' },
  hint: { fontSize: T.xs, marginTop: 6, fontWeight: '600' },

  divider: { flexDirection: 'row', alignItems: 'center', gap: 10, marginVertical: 24 },
  dividerLine: { flex: 1, height: 1, backgroundColor: C.bgBorder },
  dividerDot: { width: 5, height: 5, borderRadius: 2.5, backgroundColor: C.yellow },

  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    marginTop: 16, padding: 12,
    backgroundColor: C.dangerSoft,
    borderWidth: 1, borderColor: C.dangerBorder,
    borderRadius: R.md,
  },
  errIconWrap: {
    width: 24, height: 24, borderRadius: 12,
    backgroundColor: 'rgba(220,38,38,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  errIcon: { fontSize: T.sm, color: C.dangerText },
  errTxt:  { fontSize: T.sm, color: C.dangerText, flex: 1 },

  btn: {
    position: 'relative', overflow: 'hidden',
    paddingVertical: 17,
    backgroundColor: C.yellow,
    borderRadius: R.lg, alignItems: 'center',
    shadowColor: C.shadowYellow, shadowOpacity: 0.36, shadowRadius: 18, shadowOffset: { width: 0, height: 8 }, elevation: 8,
  },
  btnOff: { opacity: 0.45 },
  btnSheen: {
    position: 'absolute', top: 0, left: 0, right: 0, height: '50%',
    backgroundColor: 'rgba(255,255,255,0.25)',
  },
  btnContent: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  btnTxt: { fontSize: T.md, fontWeight: '800', color: C.blue, letterSpacing: -0.2 },
  btnArrowWrap: {
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: 'rgba(0,48,135,0.14)',
    alignItems: 'center', justifyContent: 'center',
  },
  btnArrow: { fontSize: 13, fontWeight: '900', color: C.blue },

  footerRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 30 },
  footerLock: { fontSize: 10 },
  footer: { fontSize: T.xs, color: C.ink3, textAlign: 'center' },
});