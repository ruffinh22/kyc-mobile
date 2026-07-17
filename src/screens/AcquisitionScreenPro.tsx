/**
 * AcquisitionScreenPro.tsx — KYC Mobile V4 "Pro"
 * ─────────────────────────────────────────────────────────────────────────────
 * Formulaire hybride : expo-camera + fallback natif · Charte MTN kyc-modern-light
 * Le profil agent (pays, whatsapp, fonction, zone) vient du Login — il n'est
 * plus jamais redemandé ici. Seuls le numéro MTN et les 2 photos sont saisis
 * à chaque dossier.
 */
import React, { useState, useRef, useEffect } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform,
  KeyboardAvoidingView, ScrollView, ActivityIndicator, Image,
  StatusBar, SafeAreaView, Animated, PermissionsAndroid,
} from 'react-native';
import { launchCamera, CameraOptions } from 'react-native-image-picker';
import { NativeModules } from 'react-native';
import { useAgentStore }  from '../store/callStore';
import { validatePhoneNumber, getPhoneRule } from '../config/CountryPhoneRules';
import { C, R, T } from '../theme/tokens'; // Design tokens
import { AppHeader } from '../components/AppHeader';

interface Photo { uri: string; type: 'recto' | 'verso'; }

// ── Étapes formulaire ──────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Numéro à certifier', icon: '📱' },
  { id: 2, label: 'Documents CNI', icon: '🪪' },
];

export function AcquisitionScreenPro({ navigation }: any) {
  const agent = useAgentStore(s => ({
    numeroAgent: s.numeroAgent, country: s.country,
    fonctionAgent: s.fonctionAgent, zoneAgent: s.zoneAgent, serverUrl: s.serverUrl,
  }));
  const preferredCamera = useAgentStore(s => s.preferredCamera);
  const setPreferredCamera = useAgentStore(s => s.setPreferredCamera);

  const [numeroMtn, setNumeroMtn]     = useState('');
  const [photos, setPhotos]           = useState<{ recto: Photo|null; verso: Photo|null }>({ recto: null, verso: null });
  const [cameraMode, setCameraMode]   = useState<'recto'|'verso'|null>(null);
  const [camPerm, setCamPerm]         = useState<boolean|null>(null);
  const [selectedCamera, setSelectedCamera] = useState<'front'|'back'>(preferredCamera === 'front' ? 'front' : 'back');
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);
  const [activeStep, setActiveStep]   = useState(1);
  const shakeAnim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    if (preferredCamera === 'front' || preferredCamera === 'back') {
      setSelectedCamera(preferredCamera);
    }
  }, [preferredCamera]);

  useEffect(() => {
    (async () => {
      try {
        if (Platform.OS === 'android') {
          const cameraModule = NativeModules.CameraModule as any;
          const result = cameraModule?.checkCameraAvailability
            ? await cameraModule.checkCameraAvailability()
            : null;

          const nativeAvailable = result?.available === true;
          const granted = nativeAvailable
            ? PermissionsAndroid.RESULTS.GRANTED
            : PermissionsAndroid.RESULTS.DENIED;

          if (nativeAvailable) {
            const permission = await PermissionsAndroid.request(
              PermissionsAndroid.PERMISSIONS.CAMERA,
              {
                title: 'Permission caméra',
                message: 'L’application a besoin d’accéder à la caméra pour capturer les documents.',
                buttonPositive: 'Autoriser',
                buttonNegative: 'Refuser',
              }
            );
            setCamPerm(permission === PermissionsAndroid.RESULTS.GRANTED);
          } else {
            setCamPerm(false);
          }
        } else {
          setCamPerm(true);
        }
      } catch (e) {
        setCamPerm(false);
      }
    })();
  }, []);

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 9,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 9,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 55, useNativeDriver: true }),
    ]).start();

  const capturePhoto = async (type: 'recto'|'verso') => {
    try {
      const options: CameraOptions = {
        mediaType: 'photo',
        cameraType: selectedCamera,
        quality: 0.8,
        saveToPhotos: false,
      };

      const result = await launchCamera(options);
      if (result.didCancel) return;
      if (result.errorCode) {
        throw new Error(result.errorMessage || `Erreur caméra (${result.errorCode})`);
      }

      const uri = result.assets?.[0]?.uri;
      if (!uri) throw new Error('Aucun fichier photo renvoyé');

      setPhotos(p => ({ ...p, [type]: { uri, type } }));
      setCameraMode(null); setError('');
      if (type === 'recto') setActiveStep(2);
    } catch (err: any) {
      setError(`Erreur caméra: ${err.message || 'inconnue'}`);
      shake();
    }
  };

  const validate = (): string|null => {
    if (!agent.numeroAgent || !agent.country) return 'Profil agent introuvable — reconnecte-toi.';
    if (!numeroMtn) return 'Saisissez le numéro MTN';
    const v = validatePhoneNumber(numeroMtn, agent.country);
    if (!v.valid) return `Numéro invalide : ${v.error}`;
    if (!photos.recto) return 'Capturez le recto du CNI';
    if (!photos.verso) return 'Capturez le verso du CNI';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); shake(); return; }
    setLoading(true); setError(''); setProgress(0);
    try {
      const fd = new FormData();
      fd.append('numero_mtn', numeroMtn);
      fd.append('country', agent.country);
      fd.append('wa_agent', agent.numeroAgent);
      fd.append('username_agent', agent.numeroAgent || '');
      fd.append('fonction_agent', agent.fonctionAgent);
      fd.append('zone_agent', agent.zoneAgent);
      if (photos.recto?.uri) fd.append('photo_recto', { uri: photos.recto.uri, type: 'image/jpeg', name: 'recto.jpg' } as any);
      if (photos.verso?.uri) fd.append('photo_verso', { uri: photos.verso.uri, type: 'image/jpeg', name: 'verso.jpg' } as any);

      const xhr = new XMLHttpRequest();
      xhr.upload.addEventListener('progress', (e) => {
        if (e.lengthComputable) setProgress(Math.round((e.loaded / e.total) * 100));
      });
      xhr.addEventListener('load', () => {
        if (xhr.status === 200 || xhr.status === 201) {
          try {
            const response = JSON.parse(xhr.responseText);
            const dossierId = response.id || response.dossier_id;
            const rectoPath = response.recto_path || '';
            const versoPath = response.verso_path || '';
            
            if (!dossierId) throw new Error('ID du dossier non reçu');
            
            setSuccess(true);
            setTimeout(() => {
              navigation.navigate('FaceVerifyScreen', {
                dossierId,
                serverUrl: agent.serverUrl,
                rectoPath,
                versoPath,
                numeroMtn,
                waAgent: agent.numeroAgent,
                country: agent.country,
                fonctionAgent: agent.fonctionAgent,
                zoneAgent: agent.zoneAgent,
              });
            }, 2200);
          } catch (err: any) {
            setError(err.message || 'Erreur: ID du dossier invalide');
            shake();
            setLoading(false);
          }
        } else {
          try { setError(JSON.parse(xhr.responseText)?.error || `Erreur ${xhr.status}`); } catch { setError(`Erreur ${xhr.status}`); }
          shake();
          setLoading(false);
        }
      });
      xhr.addEventListener('error', () => { setError('Erreur réseau'); shake(); setLoading(false); });
      const cleanUrl = agent.serverUrl?.replace(/\/$/, '') || '';
      const base = cleanUrl.startsWith('http') ? cleanUrl : `http://${cleanUrl}`;
      xhr.open('POST', `${base}/api/public/dossiers`);
      xhr.send(fd);
    } catch (e: any) { setError(e.message || 'Erreur'); shake(); setLoading(false); }
  };

  // ── Écran caméra ──────────────────────────────────────────────────────────
  if (cameraMode) {
    const sideLabel = cameraMode === 'recto' ? 'RECTO' : 'VERSO';
    return (
      <View style={cs.root}>
        {camPerm ? (
          <View style={cs.camera}>
            <SafeAreaView style={cs.camHeader}>
              <TouchableOpacity style={cs.closeBtn} onPress={() => setCameraMode(null)}>
                <Text style={cs.closeTxt}>✕</Text>
              </TouchableOpacity>
              <View style={cs.camTitleWrap}>
                <View style={cs.camDot} />
                <Text style={cs.camTitle}>{sideLabel} — CNI</Text>
              </View>
              <View style={{ width: 44 }} />
            </SafeAreaView>

            <View style={cs.cameraSelectorRow}>
              <TouchableOpacity
                style={[cs.cameraOption, selectedCamera === 'back' && cs.cameraOptionActive]}
                onPress={() => {
                  setSelectedCamera('back');
                  setPreferredCamera('back');
                }}
              >
                <Text style={[cs.cameraOptionTxt, selectedCamera === 'back' && cs.cameraOptionTxtActive]}>Arrière</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[cs.cameraOption, selectedCamera === 'front' && cs.cameraOptionActive]}
                onPress={() => {
                  setSelectedCamera('front');
                  setPreferredCamera('front');
                }}
              >
                <Text style={[cs.cameraOptionTxt, selectedCamera === 'front' && cs.cameraOptionTxtActive]}>Avant</Text>
              </TouchableOpacity>
            </View>

            <View style={cs.frameOuter}>
              <View style={cs.frame}>
                {(['TL','TR','BL','BR'] as const).map(pos => (
                  <View key={pos} style={[cs.corner, cs[`corner${pos}`]]} />
                ))}
                <Text style={cs.frameLabel}>Placez le document dans le cadre</Text>
              </View>
            </View>

            <View style={cs.camFooter}>
              <TouchableOpacity style={cs.captureBtn} onPress={() => capturePhoto(cameraMode!)}>
                <View style={cs.captureRing}>
                  <View style={cs.captureCore} />
                </View>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={cs.permBox}>
            <Text style={cs.permTitle}>Accès caméra requis</Text>
            <Text style={cs.permSub}>La permission caméra a été refusée.</Text>
            <TouchableOpacity style={cs.permBtn} onPress={() => capturePhoto(cameraMode!)}>
              <Text style={cs.permBtnTxt}>Ouvrir la caméra</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cs.permBtnSecondary} onPress={() => setCameraMode(null)}>
              <Text style={cs.permBtnTxtSecondary}>Annuler</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    );
  }

  const phoneRule = getPhoneRule(agent.country);
  const phoneVal  = validatePhoneNumber(numeroMtn, agent.country);

  // ── Formulaire principal ──────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
        <ScrollView style={s.scroll} contentContainerStyle={s.scrollContent}>

          <AppHeader title="Acquisition" subtitle="Soumettre un numéro MTN" rightIcon="⬅️" onRightPress={() => navigation.goBack()} />

          {/* ── Agent (lecture seule) ──────────────────────────────────── */}
          <View style={s.agentCard}>
            <View style={s.agentAvatar}>
              <Text style={s.agentAvatarTxt}>{agent.numeroAgent?.substring(0,2).toUpperCase() || '—'}</Text>
            </View>
            <View style={{ flex: 1 }}>
              <Text style={s.agentName}>{agent.numeroAgent || 'Agent'} · {agent.country}</Text>
              <Text style={s.agentMeta}>{agent.fonctionAgent || '—'} · {agent.zoneAgent || '—'}</Text>
            </View>
          </View>

          {/* ── Stepper ─────────────────────────────────────────────────── */}
          <View style={s.stepper}>
            {STEPS.map((step, i) => {
              const done   = activeStep > step.id;
              const active = activeStep === step.id;
              return (
                <React.Fragment key={step.id}>
                  <TouchableOpacity style={s.stepItem} onPress={() => done && setActiveStep(step.id)}>
                    <View style={[
                      s.stepCircle,
                      done   && s.stepCircleDone,
                      active && s.stepCircleActive,
                    ]}>
                      <Text style={[s.stepNum, (done || active) && s.stepNumActive]}>
                        {done ? '✓' : step.id}
                      </Text>
                    </View>
                    <Text style={[s.stepLabel, active && s.stepLabelActive]}>{step.icon}</Text>
                  </TouchableOpacity>
                  {i < STEPS.length - 1 && (
                    <View style={[s.stepLine, done && s.stepLineDone]} />
                  )}
                </React.Fragment>
              );
            })}
          </View>

          {/* ── Succès ──────────────────────────────────────────────────── */}
          {success && (
            <View style={s.successBox}>
              <Text style={s.successIcon}>✓</Text>
              <View>
                <Text style={s.successTitle}>Dossier soumis avec succès</Text>
                <Text style={s.successSub}>Redirection en cours…</Text>
              </View>
            </View>
          )}

          {/* ── Erreur ──────────────────────────────────────────────────── */}
          {!!error && (
            <Animated.View style={[s.errBox, { transform: [{ translateX: shakeAnim }] }]}>
              <Text style={s.errIcon}>⚠</Text>
              <Text style={s.errTxt}>{error}</Text>
            </Animated.View>
          )}

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 1 — Numéro MTN
          ═══════════════════════════════════════════════════════════════ */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionNum}><Text style={s.sectionNumTxt}>1</Text></View>
              <Text style={s.sectionTitle}>Numéro à certifier</Text>
            </View>

            <View style={s.field}>
              <Text style={s.fieldLabel}>Numéro MTN <Text style={s.req}>*</Text></Text>
              {phoneRule && (
                <Text style={s.hint}>
                  {phoneRule.digitCount} chiffres · Commence par {phoneRule.validPrefixes?.join(', ')}
                </Text>
              )}
              <TextInput
                style={[s.input, s.inputLarge, numeroMtn && phoneVal.valid && s.inputValid]}
                placeholder={agent.country === 'BJ' ? '01XXXXXXXX' : `${phoneRule?.digitCount || 9} chiffres`}
                placeholderTextColor={C.ink3}
                value={numeroMtn}
                onChangeText={v => {
                  const clean = v.replace(/\D/g,'');
                  const maxLen = agent.country === 'BJ' ? 10 : (phoneRule?.digitCount || 10);
                  if (!phoneRule || clean.length <= maxLen) {
                    setNumeroMtn(clean);
                  }
                }}
                keyboardType="numeric"
                maxLength={agent.country === 'BJ' ? 10 : (phoneRule?.digitCount || 10)}
                editable={!loading}
                autoFocus
              />
              {numeroMtn.length > 0 && (
                <Text style={[s.hintDynamic, { color: phoneVal.valid ? C.successText : C.dangerText }]}>
                  {phoneVal.valid ? `✓ Format valide — ${agent.country}` : phoneVal.error}
                </Text>
              )}
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 2 — Photos CNI
          ═══════════════════════════════════════════════════════════════ */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionNum}><Text style={s.sectionNumTxt}>2</Text></View>
              <Text style={s.sectionTitle}>Documents CNI</Text>
            </View>

            <View style={s.photosGrid}>
              {(['recto','verso'] as const).map(side => {
                const photo = photos[side];
                return (
                  <TouchableOpacity
                    key={side}
                    style={[s.photoBox, photo && s.photoBoxDone]}
                    onPress={() => setCameraMode(side)}
                    disabled={loading}
                  >
                    {photo ? (
                      <>
                        <Image source={{ uri: photo.uri }} style={s.photoImg} />
                        <View style={s.photoOverlay}>
                          <Text style={s.photoOverlayTxt}>Reprendre</Text>
                        </View>
                        <View style={s.photoBadge}>
                          <Text style={s.photoBadgeTxt}>✓</Text>
                        </View>
                      </>
                    ) : (
                      <View style={s.photoEmpty}>
                        <Text style={s.photoEmptyIcon}>📸</Text>
                        <Text style={s.photoEmptyLabel}>{side === 'recto' ? 'RECTO' : 'VERSO'}</Text>
                        <Text style={s.photoEmptyHint}>Appuyez pour capturer</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ── Progress upload ───────────────────────────────────────────── */}
          {loading && progress > 0 && (
            <View style={s.progressBox}>
              <View style={s.progressBarTrack}>
                <Animated.View style={[s.progressBarFill, { width: `${progress}%` as any }]} />
              </View>
              <Text style={s.progressTxt}>Envoi en cours… {progress}%</Text>
            </View>
          )}

          {/* ── Bouton soumettre ─────────────────────────────────────────── */}
          <TouchableOpacity
            style={[s.submitBtn, loading && s.submitBtnOff]}
            onPress={handleSubmit}
            disabled={loading}
            activeOpacity={0.88}
          >
            {loading
              ? <ActivityIndicator color={C.blue} />
              : <Text style={s.submitBtnTxt}>
                  {progress > 0 ? 'Envoi en cours…' : 'Soumettre le dossier →'}
                </Text>
            }
          </TouchableOpacity>

          <View style={{ height: 48 }} />
        </ScrollView>
      </KeyboardAvoidingView>
    </View>
  );
}

// ── Styles formulaire ──────────────────────────────────────────────────────
const s = StyleSheet.create({
  root:          { flex: 1, backgroundColor: C.bg0 },
  kav:           { flex: 1 },
  scroll:        { flex: 1 },
  scrollContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 28 },

  // Header
  header: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    paddingVertical: 10, paddingHorizontal: 4, marginBottom: 16,
  },
  backBtn: {
    width: 40, height: 40, borderRadius: R.md,
    backgroundColor: C.bg1, borderWidth: 1, borderColor: C.bgBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  backIcon:    { fontSize: 26, color: C.blue, fontWeight: '700', lineHeight: 32 },
  headerMeta:  { flex: 1 },
  headerTitle: { fontSize: T.xl, fontWeight: '900', color: C.ink, letterSpacing: -0.4 },
  headerSub:   { fontSize: T.xs, color: C.ink3, marginTop: 2 },
  mtnBadge: {
    backgroundColor: C.blue, borderRadius: R.sm,
    paddingVertical: 5, paddingHorizontal: 10,
    borderWidth: 1, borderColor: C.yellowBorder,
  },
  mtnBadgeTxt: { fontSize: T.sm, fontWeight: '900', color: C.yellow, letterSpacing: -0.3 },

  // Agent (lecture seule)
  agentCard: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: 'rgba(255,255,255,0.94)',
    borderWidth: 1, borderColor: C.blueBorder,
    borderRadius: R.lg, padding: 14, marginBottom: 18,
    shadowColor: '#0F1720', shadowOpacity: 0.08, shadowRadius: 14, shadowOffset: { width: 0, height: 8 },
    elevation: 4,
  },
  agentAvatar: {
    width: 36, height: 36, borderRadius: 18,
    backgroundColor: C.blue, alignItems: 'center', justifyContent: 'center',
  },
  agentAvatarTxt: { fontSize: T.xs, fontWeight: '900', color: C.yellow },
  agentName: { fontSize: T.sm, fontWeight: '800', color: C.ink },
  agentMeta: { fontSize: T.xs, color: C.ink2, marginTop: 1 },

  // Stepper
  stepper: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    marginBottom: 24, paddingHorizontal: 16,
  },
  stepItem:   { alignItems: 'center', gap: 4 },
  stepCircle: {
    width: 32, height: 32, borderRadius: 16,
    backgroundColor: C.bg2, borderWidth: 1.5, borderColor: C.bgBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  stepCircleActive: { backgroundColor: C.blue, borderColor: C.yellow },
  stepCircleDone:   { backgroundColor: C.successSoft, borderColor: C.success },
  stepNum:          { fontSize: T.sm, fontWeight: '700', color: C.ink3 },
  stepNumActive:    { color: '#fff' },
  stepLabel:        { fontSize: T.lg },
  stepLabelActive:  {},
  stepLine:         { flex: 1, height: 2, backgroundColor: C.bgBorder, marginHorizontal: 6, marginBottom: 18 },
  stepLineDone:     { backgroundColor: C.success },

  // Feedback
  successBox: {
    flexDirection: 'row', alignItems: 'center', gap: 12,
    backgroundColor: C.successSoft, borderWidth: 1, borderColor: C.successBorder,
    borderRadius: R.lg, padding: 16, marginBottom: 16,
  },
  successIcon:  { fontSize: 28, color: C.success },
  successTitle: { fontSize: T.base, fontWeight: '700', color: C.successText },
  successSub:   { fontSize: T.xs, color: C.ink3, marginTop: 2 },

  errBox: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    backgroundColor: C.dangerSoft, borderWidth: 1, borderColor: C.dangerBorder,
    borderRadius: R.lg, padding: 14, marginBottom: 14,
  },
  errIcon: { fontSize: T.base, color: C.dangerText },
  errTxt:  { fontSize: T.sm, color: C.dangerText, flex: 1 },

  // Section
  section: {
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderRadius: R.xl, borderWidth: 1, borderColor: 'rgba(15,23,42,0.06)',
    padding: 18, marginBottom: 14,
    shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 18, shadowOffset: { width: 0, height: 10 },
    elevation: 3,
  },
  sectionHeader: { flexDirection: 'row', alignItems: 'center', gap: 10, marginBottom: 18 },
  sectionNum: {
    width: 26, height: 26, borderRadius: 13,
    backgroundColor: C.yellow, alignItems: 'center', justifyContent: 'center',
  },
  sectionNumTxt: { fontSize: T.sm, fontWeight: '900', color: C.blue },
  sectionTitle:  { fontSize: T.base, fontWeight: '800', color: C.ink, letterSpacing: -0.2 },

  // Champs
  field:      { marginBottom: 14 },
  fieldLabel: { fontSize: T.xs, fontWeight: '700', color: C.ink2, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 8 },
  req:        { color: C.danger },
  hint:       { fontSize: T.xs, color: C.ink3, marginBottom: 8 },
  hintDynamic:{ fontSize: T.xs, fontWeight: '600', marginTop: 6 },

  inputRow: { position: 'relative', justifyContent: 'center' },
  checkIcon: { position: 'absolute', right: 14, fontSize: T.base, color: C.successText },

  input: {
    backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.md, paddingVertical: 14, paddingHorizontal: 16,
    fontSize: T.base, color: C.ink,
  },
  inputValid: { borderColor: C.success },
  inputLarge: {
    fontSize: T['2xl'], fontWeight: '800', textAlign: 'center',
    letterSpacing: 6, paddingVertical: 18,
    fontVariant: ['tabular-nums'],
  },

  // Photos
  photosGrid: { flexDirection: 'row', gap: 12 },
  photoBox: {
    flex: 1, aspectRatio: 0.65,
    borderRadius: R.lg, overflow: 'hidden',
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.yellowBorder,
    backgroundColor: C.yellowSoft,
  },
  photoBoxDone: { borderStyle: 'solid', borderColor: C.success },
  photoImg:     { width: '100%', height: '100%' },
  photoOverlay: {
    position: 'absolute', bottom: 0, left: 0, right: 0,
    backgroundColor: 'rgba(15,23,32,0.65)', paddingVertical: 8,
    alignItems: 'center',
  },
  photoOverlayTxt: { fontSize: T.xs, fontWeight: '700', color: '#fff' },
  photoBadge: {
    position: 'absolute', top: 8, right: 8,
    width: 22, height: 22, borderRadius: 11,
    backgroundColor: C.success, alignItems: 'center', justifyContent: 'center',
  },
  photoBadgeTxt: { fontSize: T.xs, color: '#fff', fontWeight: '700' },
  photoEmpty:    { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 6 },
  photoEmptyIcon:  { fontSize: 32 },
  photoEmptyLabel: { fontSize: T.xs, fontWeight: '800', color: C.blue, letterSpacing: 1.5 },
  photoEmptyHint:  { fontSize: T.xs, color: C.ink3 },

  // Progress
  progressBox: {
    backgroundColor: 'rgba(255,204,0,0.16)', borderWidth: 1, borderColor: C.yellowBorder,
    borderRadius: R.lg, padding: 14, marginBottom: 14,
  },
  progressBarTrack: {
    height: 6, backgroundColor: C.bg2,
    borderRadius: 3, overflow: 'hidden', marginBottom: 8,
  },
  progressBarFill: { height: '100%', backgroundColor: C.yellow, borderRadius: 3 },
  progressTxt:     { fontSize: T.xs, color: C.ink3, textAlign: 'center' },

  // Submit
  submitBtn: {
    backgroundColor: C.yellow, paddingVertical: 18,
    borderRadius: R.lg, alignItems: 'center', marginTop: 8,
    shadowColor: C.shadowYellow, shadowOpacity: 0.30, shadowRadius: 14, elevation: 8,
  },
  submitBtnOff: { opacity: 0.50 },
  submitBtnTxt: { fontSize: T.md, fontWeight: '800', color: C.blue, letterSpacing: -0.2 },
});

// ── Styles caméra (plein écran, reste sombre pour le viseur) ───────────────
const cs = StyleSheet.create({
  root:   { flex: 1, backgroundColor: '#000' },
  camera: { flex: 1 },

  camHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
    backgroundColor: 'rgba(15,23,32,0.60)',
  },
  closeBtn: {
    width: 44, height: 44, borderRadius: 22,
    backgroundColor: 'rgba(255,255,255,0.12)',
    alignItems: 'center', justifyContent: 'center',
  },
  closeTxt:     { fontSize: T.xl, color: '#fff', fontWeight: '700' },
  camTitleWrap: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  camDot:       { width: 6, height: 6, borderRadius: 3, backgroundColor: C.yellow },
  camTitle:     { fontSize: T.md, fontWeight: '800', color: '#fff', letterSpacing: -0.2 },
  cameraSelectorRow: { flexDirection: 'row', justifyContent: 'center', gap: 10, paddingTop: 10, paddingBottom: 4 },
  cameraOption: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.86)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.14)',
  },
  cameraOptionActive: { backgroundColor: C.blue, borderColor: C.blue },
  cameraOptionTxt: { color: C.ink, fontWeight: '700' },
  cameraOptionTxtActive: { color: '#fff' },

  frameOuter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  frame: {
    width: '80%', aspectRatio: 1.6,
    alignItems: 'center', justifyContent: 'center',
  },
  corner: {
    position: 'absolute', width: 28, height: 28,
    borderWidth: 3, borderColor: C.yellow,
  },
  cornerTL: { top: 0, left: 0,   borderRightWidth: 0, borderBottomWidth: 0, borderTopLeftRadius: 4 },
  cornerTR: { top: 0, right: 0,  borderLeftWidth: 0,  borderBottomWidth: 0, borderTopRightRadius: 4 },
  cornerBL: { bottom: 0, left: 0,  borderRightWidth: 0, borderTopWidth: 0, borderBottomLeftRadius: 4 },
  cornerBR: { bottom: 0, right: 0, borderLeftWidth: 0,  borderTopWidth: 0, borderBottomRightRadius: 4 },
  frameLabel: { fontSize: T.xs, color: 'rgba(255,255,255,0.6)', textAlign: 'center' },

  camFooter: {
    paddingVertical: 24, alignItems: 'center',
    backgroundColor: 'rgba(15,23,32,0.60)',
  },
  captureBtn:  {},
  captureRing: {
    width: 78, height: 78, borderRadius: 39,
    borderWidth: 3, borderColor: C.yellow,
    alignItems: 'center', justifyContent: 'center',
  },
  captureCore: {
    width: 62, height: 62, borderRadius: 31,
    backgroundColor: '#fff',
  },

  permBox: {
    flex: 1, alignItems: 'center', justifyContent: 'center', padding: 32,
    backgroundColor: '#111',
  },
  permTitle:          { fontSize: T.xl, fontWeight: '800', color: '#fff', marginBottom: 8 },
  permSub:            { fontSize: T.sm, color: 'rgba(255,255,255,0.6)', marginBottom: 28, textAlign: 'center' },
  permBtn:            { backgroundColor: C.yellow, paddingVertical: 14, paddingHorizontal: 28, borderRadius: R.lg, marginBottom: 12 },
  permBtnTxt:         { fontSize: T.base, fontWeight: '700', color: C.blue },
  permBtnSecondary:   { borderWidth: 1, borderColor: 'rgba(255,255,255,0.3)', paddingVertical: 14, paddingHorizontal: 28, borderRadius: R.lg },
  permBtnTxtSecondary:{ fontSize: T.base, fontWeight: '600', color: '#fff' },
});
