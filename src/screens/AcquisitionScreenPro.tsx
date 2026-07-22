/**
 * AcquisitionScreenPro.tsx — KYC Mobile V4 "Pro"
 * ─────────────────────────────────────────────────────────────────────────────
 * Formulaire hybride : expo-camera + fallback natif · Charte MTN kyc-modern-light
 * Le profil agent (pays, whatsapp, fonction, zone) vient du Login — il n'est
 * plus jamais redemandé ici. Seuls le numéro MTN et les 2 photos sont saisis
 * à chaque dossier.
 */
import React, { useState, useRef, useEffect, useMemo } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform,
  KeyboardAvoidingView, ScrollView, ActivityIndicator, Image,
  StatusBar, SafeAreaView, Animated,
  Modal, FlatList, Alert,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import CountryPicker, { Country, CountryCode } from 'react-native-country-picker-modal';
import { useAgentStore }  from '../store/callStore';
import { validatePhoneNumber, getPhoneRule } from '../config/CountryPhoneRules';
import { C, R, T } from '../theme/tokens'; // Design tokens
import { AppHeader } from '../components/AppHeader';

interface Photo { uri: string; type: 'recto' | 'verso'; }

// ── Étapes formulaire ──────────────────────────────────────────────────────
const STEPS = [
  { id: 1, label: 'Numéro à certifier', icon: '📱' },
  { id: 2, label: 'Documents CNI', icon: '🪪' },
  { id: 3, label: 'Identité', icon: '🛡️' },
  { id: 4, label: 'Filiation & infos', icon: '🧾' },
];

// Champs issus de la lecture OCR de la CNI. Une fois validés, ils deviennent
// non modifiables pour réduire les risques de fraude et garantir une
// traçabilité claire de l'identité du titulaire.
const OCR_LOCKED_FIELDS = ['nomTitulaire', 'prenomTitulaire', 'dateNaissance', 'lieuNaissance', 'numeroCni', 'sexe', 'nationalite'] as const;
type OcrLockedField = typeof OCR_LOCKED_FIELDS[number];

export type AcquisitionScreenProProps = {
  navigation: {
    navigate: (screen: string, params?: object) => void;
    goBack: () => void;
  };
};

export function AcquisitionScreenPro({ navigation }: AcquisitionScreenProProps) {
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
  const [cameraReady, setCameraReady] = useState(false);
  const [pendingPhoto, setPendingPhoto] = useState<Photo | null>(null);
  const cameraRef = useRef<any>(null);
  const [loading, setLoading]         = useState(false);
  const [progress, setProgress]       = useState(0);
  const [error, setError]             = useState('');
  const [success, setSuccess]         = useState(false);
  const [activeStep, setActiveStep]   = useState(1);
  const [nationalityPickerVisible, setNationalityPickerVisible] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode>('CG');
  const [countryName, setCountryName] = useState('Congo (Brazzaville)');
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const cameraOverlayAnim = useRef(new Animated.Value(1)).current;

  // ── Infos titulaire (pré-remplies par OCR sur le recto + saisie agent) ────
  // nomTitulaire / prenomTitulaire / dateNaissance / lieuNaissance : lus par
  // OCR sur le recto de la CNI (voir runOcr), toujours modifiables ensuite.
  // autreNumero / nomPere / nomMere / adresseComplete / numeroCni / sexe /
  // nationalite / profession : jamais issus de l'OCR, saisis par l'agent
  // terrain et préremplis si le service OCR les retourne.
  const [idInfo, setIdInfo] = useState({
    nomTitulaire: '', prenomTitulaire: '', dateNaissance: '', lieuNaissance: '',
    autreNumero: '', nomPere: '', nomMere: '', adresseComplete: '', numeroCni: '',
    sexe: '', nationalite: '', profession: '',
  });
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'loading' | 'success' | 'failed'>('idle');
  // Champs OCR déverrouillés manuellement après confirmation explicite de l'agent
  // (ex. erreur de lecture) — conservé pour audit et envoyé au serveur.
  const [manualOverride, setManualOverride] = useState<Record<string, boolean>>({});
  const setIdField = (key: keyof typeof idInfo, value: string) =>
    setIdInfo(prev => ({ ...prev, [key]: value }));

  // Un champ OCR est verrouillé s'il a été rempli avec succès par la lecture
  // automatique et que l'agent n'a pas explicitement demandé/confirmé une correction.
  const isFieldLocked = (key: OcrLockedField) =>
    ocrStatus === 'success' && !!idInfo[key].trim() && !manualOverride[key];

  const requestUnlock = (key: OcrLockedField, label: string) => {
    Alert.alert(
      'Corriger une donnée vérifiée',
      `« ${label} » provient de la lecture automatique de la CNI. Le modifier sera enregistré et signalé pour contrôle qualité. Continuer ?`,
      [
        { text: 'Annuler', style: 'cancel' },
        { text: 'Modifier quand même', style: 'destructive', onPress: () => setManualOverride(prev => ({ ...prev, [key]: true })) },
      ],
    );
  };

  useEffect(() => {
    if (preferredCamera === 'front' || preferredCamera === 'back') {
      setSelectedCamera(preferredCamera);
    }
  }, [preferredCamera]);

  useEffect(() => {
    if (agent.country) {
      const code = agent.country.toUpperCase();
      setSelectedCountryCode(code as CountryCode);
      setCountryName(code === 'BJ' ? 'Bénin' : code === 'CI' ? 'Côte d’Ivoire' : 'Congo (Brazzaville)');
    }
  }, [agent.country]);

  // NOTE : on utilise Camera.requestCameraPermissionsAsync() (expo-camera),
  // la même API que le composant <Camera> ci-dessous utilise réellement.
  // L'ancienne version ne demandait la permission système que sur Android
  // (via PermissionsAndroid) et laissait passer iOS sans jamais afficher
  // la boîte de dialogue native — la caméra live y échouait donc toujours.
  // Elle dépendait aussi d'un module natif custom (NativeModules.CameraModule)
  // qui, s'il n'est pas enregistré dans le build, forçait systématiquement
  // camPerm à false même quand la caméra du téléphone fonctionnait très bien.
  const requestCameraAccess = async () => {
    try {
      const permission = await Camera.requestCameraPermissionsAsync();
      setCamPerm(permission.granted === true);
    } catch (e) {
      console.warn('[Acquisition] Vérification permission caméra échouée :', e);
      setCamPerm(false);
    }
  };

  useEffect(() => {
    void requestCameraAccess();
  }, []);

  const shake = () =>
    Animated.sequence([
      Animated.timing(shakeAnim, { toValue: 9,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: -9, duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 9,  duration: 55, useNativeDriver: true }),
      Animated.timing(shakeAnim, { toValue: 0,  duration: 55, useNativeDriver: true }),
    ]).start();

  const capturePhoto = async (type: 'recto'|'verso') => {
    if (!cameraRef.current || !cameraReady) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: false });
      const uri = photo?.uri;
      if (!uri) throw new Error('Aucun fichier photo renvoyé');

      // On s'arrête sur un aperçu (Reprendre / Valider) plutôt que de
      // committer directement — comme sur AcquisitionPage.tsx (web).
      setPendingPhoto({ uri, type });
      setError('');
    } catch (err: any) {
      console.warn('[Acquisition] capturePhoto a échoué :', err);
      setError(`Erreur caméra: ${err.message || 'inconnue'}`);
      shake();
    }
  };

  const retakePendingPhoto = () => {
    setPendingPhoto(null);
    setCameraReady(false);
  };

  const validatePendingPhoto = () => {
    if (!pendingPhoto) return;
    const { uri, type } = pendingPhoto;
    setPhotos(p => ({ ...p, [type]: { uri, type } }));
    setPendingPhoto(null);
    setCameraMode(null); setCameraReady(false); setError('');
    if (type === 'recto') {
      setActiveStep(2);
      void runOcr(uri);
    }
  };

  // ── OCR du recto CNI (auto-remplissage nom/prénom/naissance) ──────────────
  // Endpoint attendu côté serveur : POST /api/ocr/id-card — contrat détaillé
  // dans SERVER_SPEC.md. Tant que l'endpoint n'existe pas côté back, cet
  // appel échoue silencieusement (404/erreur réseau) et l'agent bascule sur
  // la saisie manuelle — le formulaire reste utilisable dans tous les cas.
  const runOcr = async (uri: string) => {
    setOcrStatus('loading');
    try {
      const cleanUrl = agent.serverUrl?.replace(/\/$/, '') || '';
      const base = cleanUrl.startsWith('http') ? cleanUrl : `http://${cleanUrl}`;
      const fd = new FormData();
      fd.append('country', agent.country);
      fd.append('photo_recto', { uri, type: 'image/jpeg', name: 'recto.jpg' } as any);

      const ctrl = new AbortController();
      const tid = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(`${base}/api/ocr/id-card`, { method: 'POST', body: fd, signal: ctrl.signal });
      clearTimeout(tid);

      if (!res.ok) throw new Error(`OCR HTTP ${res.status}`);
      const data = await res.json();
      if (!data?.success) throw new Error(data?.error || 'OCR sans résultat');

      // On ne complète que les champs encore vides, pour ne jamais écraser
      // une correction déjà saisie par l'agent (ex. relance OCR après reprise photo).
      setIdInfo(prev => ({
        ...prev,
        nomTitulaire:    prev.nomTitulaire    || data.nom || '',
        prenomTitulaire: prev.prenomTitulaire || data.prenom || '',
        dateNaissance:   prev.dateNaissance   || data.date_naissance || '',
        lieuNaissance:   prev.lieuNaissance   || data.lieu_naissance || '',
        adresseComplete: prev.adresseComplete || data.adresse_complete || '',
        numeroCni:       prev.numeroCni       || data.numero_cni || '',
        sexe:            prev.sexe            || data.sexe || '',
        nationalite:     prev.nationalite     || data.nationalite || '',
        profession:      prev.profession      || data.profession || '',
      }));
      setOcrStatus('success');
      setActiveStep(3);
    } catch (err) {
      console.warn('[Acquisition] OCR indisponible, saisie manuelle requise :', err);
      setOcrStatus('failed');
      setActiveStep(3);
    }
  };

  const validate = (): string|null => {
    if (!agent.numeroAgent || !agent.country) return 'Profil agent introuvable — reconnecte-toi.';
    if (!numeroMtn) return 'Saisissez le numéro MTN';
    const v = validatePhoneNumber(numeroMtn, agent.country);
    if (!v.valid) return `Numéro invalide : ${v.error}`;
    if (!photos.recto) return 'Capturez le recto du CNI';
    if (!photos.verso) return 'Capturez le verso du CNI';
    // Infos titulaire requises pour l'enregistrement SIM (réglementation KYC)
    if (!idInfo.nomTitulaire.trim())    return 'Renseignez le nom du titulaire';
    if (!idInfo.prenomTitulaire.trim()) return 'Renseignez le prénom du titulaire';
    if (!idInfo.dateNaissance.trim())   return 'Renseignez la date de naissance';
    if (!idInfo.lieuNaissance.trim())   return 'Renseignez le lieu de naissance';
    if (!idInfo.numeroCni.trim())       return 'Renseignez le numéro de la pièce d’identité';
    if (!idInfo.sexe.trim())            return 'Renseignez le sexe';
    if (!idInfo.nationalite.trim())    return 'Renseignez la nationalité';
    if (!idInfo.profession.trim())     return 'Renseignez la profession';
    if (!idInfo.adresseComplete.trim()) return 'Renseignez l’adresse complète';
    if (!idInfo.nomPere.trim())         return 'Renseignez le nom du père';
    if (!idInfo.nomMere.trim())         return 'Renseignez le nom de la mère';
    return null;
  };

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); shake(); return; }
    setActiveStep(4);
    setLoading(true); setError(''); setProgress(0);
    try {
      const fd = new FormData();
      fd.append('numero_mtn', numeroMtn);
      fd.append('country', agent.country);
      fd.append('wa_agent', agent.numeroAgent);
      fd.append('username_agent', agent.numeroAgent || '');
      fd.append('fonction_agent', agent.fonctionAgent);
      fd.append('zone_agent', agent.zoneAgent);
      // ── Infos titulaire pour l'enregistrement SIM (voir SERVER_SPEC.md) ──
      fd.append('nom_titulaire', idInfo.nomTitulaire.trim());
      fd.append('prenom_titulaire', idInfo.prenomTitulaire.trim());
      fd.append('date_naissance', idInfo.dateNaissance.trim());
      fd.append('lieu_naissance', idInfo.lieuNaissance.trim());
      fd.append('autre_numero', idInfo.autreNumero.trim());
      fd.append('nom_pere', idInfo.nomPere.trim());
      fd.append('nom_mere', idInfo.nomMere.trim());
      fd.append('adresse_complete', idInfo.adresseComplete.trim());
      fd.append('numero_cni', idInfo.numeroCni.trim());
      fd.append('sexe', idInfo.sexe.trim());
      fd.append('nationalite', idInfo.nationalite.trim());
      fd.append('profession', idInfo.profession.trim());
      // Audit anti-fraude : liste des champs OCR corrigés manuellement par l'agent
      const overriddenFields = OCR_LOCKED_FIELDS.filter(k => manualOverride[k]);
      if (overriddenFields.length) fd.append('ocr_overrides', overriddenFields.join(','));
      if (photos.recto?.uri) fd.append('photo_recto', { uri: photos.recto.uri, type: 'image/jpeg', name: 'recto.jpg' } as any);
      if (photos.verso?.uri) fd.append('photo_verso', { uri: photos.verso.uri, type: 'image/jpeg', name: 'verso.jpg' } as any);

      const xhr = new XMLHttpRequest();
      xhr.timeout = 30_000; // réseau terrain instable : ne pas rester bloqué indéfiniment
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
            console.warn('[Acquisition] Réponse serveur inattendue :', err);
            setError(err.message || 'Erreur: ID du dossier invalide');
            shake();
            setLoading(false);
          }
        } else {
          try { setError(JSON.parse(xhr.responseText)?.error || `Erreur ${xhr.status}`); } catch { setError(`Erreur ${xhr.status}`); }
          console.warn('[Acquisition] Upload refusé par le serveur, statut', xhr.status, xhr.responseText);
          shake();
          setLoading(false);
        }
      });
      xhr.addEventListener('error', () => {
        console.warn('[Acquisition] Upload échoué : erreur réseau');
        setError('Erreur réseau');
        shake();
        setLoading(false);
      });
      xhr.addEventListener('timeout', () => {
        console.warn('[Acquisition] Upload échoué : délai dépassé (30s)');
        setError('Le serveur met trop de temps à répondre. Vérifie ta connexion et réessaie.');
        shake();
        setLoading(false);
      });
      const cleanUrl = agent.serverUrl?.replace(/\/$/, '') || '';
      const base = cleanUrl.startsWith('http') ? cleanUrl : `http://${cleanUrl}`;
      xhr.open('POST', `${base}/api/public/dossiers`);
      xhr.send(fd);
    } catch (e: any) {
      console.warn('[Acquisition] handleSubmit a échoué :', e);
      setError(e.message || 'Erreur');
      shake();
      setLoading(false);
    }
  };

  // ── Écran caméra ──────────────────────────────────────────────────────────
  if (cameraMode) {
    const sideLabel = cameraMode === 'recto' ? 'RECTO' : 'VERSO';

    if (pendingPhoto) {
      return (
        <View style={cs.root}>
          <SafeAreaView style={cs.previewWrap}>
            <Text style={cs.previewTitle}>
              {pendingPhoto.type === 'recto' ? 'Vérifiez le recto CNI' : 'Vérifiez le verso CNI'}
            </Text>
            <Image source={{ uri: pendingPhoto.uri }} style={cs.previewImg} resizeMode="cover" />
            <View style={cs.previewActions}>
              <TouchableOpacity style={cs.previewRetakeBtn} onPress={retakePendingPhoto}>
                <Text style={cs.previewRetakeTxt}>↺ Reprendre</Text>
              </TouchableOpacity>
              <TouchableOpacity style={cs.previewValidateBtn} onPress={validatePendingPhoto}>
                <Text style={cs.previewValidateTxt}>✓ Valider</Text>
              </TouchableOpacity>
            </View>
          </SafeAreaView>
        </View>
      );
    }

    return (
      <SafeAreaView style={cs.root}>
        <StatusBar barStyle="light-content" backgroundColor="#05070C" />
        {camPerm !== false ? (
          <View style={cs.camera}>
            <Camera
              ref={cameraRef}
              style={StyleSheet.absoluteFill}
              type={selectedCamera === 'front' ? CameraType.front : CameraType.back}
              onCameraReady={() => setCameraReady(true)}
            />

            <SafeAreaView style={cs.camHeader}>
              <TouchableOpacity style={cs.closeBtn} onPress={() => { setCameraMode(null); setCameraReady(false); }}>
                <Text style={cs.closeTxt}>✕</Text>
              </TouchableOpacity>
              <View style={cs.camTitleWrap}>
                <View style={cs.camDot} />
                <Text style={cs.camTitle}>{sideLabel} — CNI</Text>
              </View>
              <View style={{ width: 44 }} />
            </SafeAreaView>

            <View style={cs.frameOuter} pointerEvents="none">
              <View style={cs.frame}>
                {(['TL','TR','BL','BR'] as const).map(pos => (
                  <View key={pos} style={[cs.corner, cs[`corner${pos}`]]} />
                ))}
                <Text style={cs.frameLabel}>{cameraReady ? 'Placez le document dans le cadre' : 'Préparation caméra…'}</Text>
              </View>
            </View>

            <View style={cs.camFooter}>
              <View style={cs.footerSpacer} />
              <TouchableOpacity
                style={cs.captureBtn}
                onPress={() => capturePhoto(cameraMode!)}
                disabled={!cameraReady}
                accessibilityRole="button"
                accessibilityLabel={cameraReady ? 'Capturer la photo' : 'Préparation caméra'}
              >
                <View style={[cs.captureRing, !cameraReady && { opacity: 0.4 }]}>
                  <View style={cs.captureCore} />
                </View>
              </TouchableOpacity>
              <TouchableOpacity
                style={cs.switchCameraBtn}
                onPress={() => {
                  const nextCamera = selectedCamera === 'front' ? 'back' : 'front';
                  setCameraReady(false);
                  setSelectedCamera(nextCamera);
                  setPreferredCamera(nextCamera);
                }}
                accessibilityRole="button"
                accessibilityLabel={selectedCamera === 'front' ? 'Basculer vers la caméra arrière' : 'Basculer vers la caméra avant'}
              >
                <Text style={cs.switchCameraTxt}>{selectedCamera === 'front' ? '📸' : '📷'}</Text>
              </TouchableOpacity>
            </View>
          </View>
        ) : (
          <View style={cs.permBox}>
            <Text style={cs.permTitle}>Accès caméra requis</Text>
            <Text style={cs.permSub}>La permission caméra a été refusée. Autorise-la pour continuer.</Text>
            <TouchableOpacity style={cs.permBtn} onPress={() => void requestCameraAccess()}>
              <Text style={cs.permBtnTxt}>Autoriser la caméra</Text>
            </TouchableOpacity>
            <TouchableOpacity style={cs.permBtnSecondary} onPress={() => setCameraMode(null)}>
              <Text style={cs.permBtnTxtSecondary}>Annuler</Text>
            </TouchableOpacity>
          </View>
        )}
      </SafeAreaView>
    );
  }

  const phoneRule = getPhoneRule(agent.country);
  const phoneVal  = validatePhoneNumber(numeroMtn, agent.country);

  // ── Champ identité vérifiable : verrouillé après OCR, éditable sinon ──────
  const renderVerifiableField = (
    key: OcrLockedField,
    label: string,
    placeholder: string,
    extraInputProps: Partial<React.ComponentProps<typeof TextInput>> = {},
  ) => {
    const locked = isFieldLocked(key);
    if (locked) {
      return (
        <View style={s.lockedField}>
          <View style={s.lockedFieldTop}>
            <Text style={s.lockedFieldLabel}>{label}</Text>
            <TouchableOpacity onPress={() => requestUnlock(key, label)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Text style={s.lockedFieldEdit}>Corriger</Text>
            </TouchableOpacity>
          </View>
          <View style={s.lockedFieldRow}>
            <Text style={s.lockedFieldIcon}>🔒</Text>
            <Text style={s.lockedFieldValue}>{idInfo[key]}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={s.field}>
        <View style={s.lockedFieldTop}>
          <Text style={s.fieldLabel}>{label} <Text style={s.req}>*</Text></Text>
          {manualOverride[key] && <Text style={s.overrideTag}>Correction signalée</Text>}
        </View>
        <TextInput
          style={[s.input, locked && s.inputLocked]}
          value={idInfo[key]}
          onChangeText={(v) => setIdField(key, v)}
          placeholder={placeholder}
          placeholderTextColor={C.ink3}
          editable={!loading}
          {...extraInputProps}
        />
      </View>
    );
  };

  const renderNationalityField = () => {
    const locked = isFieldLocked('nationalite');
    return (
      <View style={s.field}>
        <View style={s.lockedFieldTop}>
          <Text style={s.fieldLabel}>Nationalité <Text style={s.req}>*</Text></Text>
          {manualOverride.nationalite && <Text style={s.overrideTag}>Correction signalée</Text>}
        </View>
        <TouchableOpacity
          style={[s.input, s.selectInput, locked && s.inputLocked]}
          onPress={() => !loading && !locked && setNationalityPickerVisible(true)}
          disabled={loading || locked}
          accessibilityRole="button"
          accessibilityLabel="Sélectionner la nationalité"
          accessibilityHint="Ouvre la liste des pays avec recherche"
        >
          <Text style={[s.selectInputText, !idInfo.nationalite && s.selectInputPlaceholder]}>
            {idInfo.nationalite || 'Sélectionner'}
          </Text>
        </TouchableOpacity>
      </View>
    );
  };

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
                style={[s.input, s.inputCompact, numeroMtn && phoneVal.valid && s.inputValid]}
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
                        <Text style={s.photoEmptyHint}>Appuyer pour capturer la photo</Text>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 3 — Identité vérifiée (lecture automatique de la CNI)
              Ces champs proviennent de l'OCR et sont verrouillés dès qu'ils
              sont lus avec succès, pour empêcher toute altération frauduleuse
              de l'identité entre la capture et l'envoi du dossier.
          ═══════════════════════════════════════════════════════════════ */}
          <View style={[s.section, s.sectionIdentity]}>
            <View style={s.sectionHeader}>
              <View style={[s.sectionNum, s.sectionNumIdentity, { borderWidth: 1, borderColor: C.yellowBorder }]}><Text style={s.sectionNumTxt}>3</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>Identité</Text>
                <Text style={s.sectionSubtitle}>Lecture CNI</Text>
              </View>
              {ocrStatus === 'success' && (
                <View style={s.shieldBadge}><Text style={s.shieldBadgeTxt}>🛡️</Text></View>
              )}
            </View>

            {ocrStatus === 'loading' && (
              <View style={s.ocrBanner}>
                <ActivityIndicator color={C.blue} size="small" />
                <Text style={s.ocrBannerTxt}>Lecture automatique du recto en cours…</Text>
              </View>
            )}
            {ocrStatus === 'success' && (
              <View style={[s.ocrBanner, s.ocrBannerOk]}>
                <Text style={s.ocrBannerIcon}>✓</Text>
                <Text style={[s.ocrBannerTxt, { color: C.successText }]}>Champs verrouillés depuis le recto — vérifiez avant envoi</Text>
              </View>
            )}
            {ocrStatus === 'failed' && (
              <View style={[s.ocrBanner, s.ocrBannerWarn]}>
                <Text style={s.ocrBannerIcon}>⚠</Text>
                <Text style={[s.ocrBannerTxt, { color: C.dangerText }]}>Lecture automatique indisponible — saisie manuelle requise</Text>
              </View>
            )}
            {ocrStatus === 'idle' && (
              <View style={s.ocrBanner}>
                <Text style={s.ocrBannerIcon}>🪪</Text>
                <Text style={s.ocrBannerTxt}>Capturer le recto pour remplir</Text>
              </View>
            )}

            {renderVerifiableField('nomTitulaire', 'Nom', "Nom tel qu'il figure sur la CNI", { autoCapitalize: 'characters' })}
            {renderVerifiableField('prenomTitulaire', 'Prénom(s)', 'Prénom(s)', { autoCapitalize: 'words' })}

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>{renderVerifiableField('dateNaissance', 'Date de naissance', 'JJ/MM/AAAA')}</View>
              <View style={{ flex: 1 }}>{renderVerifiableField('lieuNaissance', 'Lieu de naissance', 'Ville')}</View>
            </View>

            {renderVerifiableField('numeroCni', 'Numéro de pièce', 'Numéro de pièce d’identité')}
            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={{ flex: 1 }}>{renderVerifiableField('sexe', 'Sexe', 'M / F', { autoCapitalize: 'words' })}</View>
              <View style={{ flex: 1 }}>{renderNationalityField()}</View>
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 4 — Filiation & informations complémentaires
          ═══════════════════════════════════════════════════════════════ */}
          <View style={s.section}>
            <View style={s.sectionHeader}>
              <View style={s.sectionNum}><Text style={s.sectionNumTxt}>4</Text></View>
              <View style={{ flex: 1 }}>
                <Text style={s.sectionTitle}>Filiation & infos</Text>
                <Text style={s.sectionSubtitle}>Infos obligatoires</Text>
              </View>
              <View style={s.requiredPill}><Text style={s.requiredPillTxt}>Obligatoire</Text></View>
            </View>

            <View style={s.field}>
              <Text style={s.fieldLabel}>Nom du père <Text style={s.req}>*</Text></Text>
              <TextInput
                style={s.input}
                value={idInfo.nomPere}
                onChangeText={(v) => setIdField('nomPere', v)}
                placeholder="Nom complet du père"
                placeholderTextColor={C.ink3}
                autoCapitalize="words"
                editable={!loading}
              />
            </View>

            <View style={s.field}>
              <Text style={s.fieldLabel}>Nom de la mère <Text style={s.req}>*</Text></Text>
              <TextInput
                style={s.input}
                value={idInfo.nomMere}
                onChangeText={(v) => setIdField('nomMere', v)}
                placeholder="Nom complet de la mère"
                placeholderTextColor={C.ink3}
                autoCapitalize="words"
                editable={!loading}
              />
            </View>

            <View style={{ flexDirection: 'row', gap: 12 }}>
              <View style={[s.field, { flex: 1 }]}> 
                <Text style={s.fieldLabel}>Autres contact <Text style={s.req}>*</Text></Text>
                <TextInput
                  style={s.input}
                  value={idInfo.autreNumero}
                  onChangeText={(v) => setIdField('autreNumero', v.replace(/\D/g, ''))}
                  placeholder="Numéro secondaire"
                  placeholderTextColor={C.ink3}
                  keyboardType="numeric"
                  editable={!loading}
                />
              </View>

              <View style={[s.field, { flex: 1 }]}> 
                <Text style={s.fieldLabel}>Profession <Text style={s.req}>*</Text></Text>
                <TextInput
                  style={s.input}
                  value={idInfo.profession}
                  onChangeText={(v) => setIdField('profession', v)}
                  placeholder="Profession"
                  placeholderTextColor={C.ink3}
                  autoCapitalize="words"
                  editable={!loading}
                />
              </View>
            </View>

            <View style={s.field}>
              <Text style={s.fieldLabel}>Adresse complète <Text style={s.req}>*</Text></Text>
              <TextInput
                style={[s.input, { minHeight: 84, textAlignVertical: 'top' }]}
                value={idInfo.adresseComplete}
                onChangeText={(v) => setIdField('adresseComplete', v)}
                placeholder="Adresse complète du titulaire"
                placeholderTextColor={C.ink3}
                multiline
                editable={!loading}
              />
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
            accessibilityRole="button"
            accessibilityLabel="Soumettre le dossier"
            accessibilityState={{ disabled: loading, busy: loading }}
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

      <CountryPicker
        visible={nationalityPickerVisible}
        onClose={() => setNationalityPickerVisible(false)}
        onSelect={(country: Country) => {
          const countryNameValue = (() => {
            const rawName = country.name;
            if (typeof rawName === 'string') return rawName;
            if (typeof rawName === 'object' && rawName !== null) {
              const nameRecord = rawName as { common?: string; official?: string } | undefined;
              const candidate = nameRecord?.common;
              if (typeof candidate === 'string' && candidate.trim()) return candidate;
              const alt = nameRecord?.official;
              if (typeof alt === 'string' && alt.trim()) return alt;
            }
            return 'Pays';
          })();
          setSelectedCountryCode(country.cca2 as CountryCode);
          setCountryName(countryNameValue);
          setIdField('nationalite', countryNameValue);
          setNationalityPickerVisible(false);
        }}
        countryCode={selectedCountryCode}
        withEmoji
        withFilter
        withAlphaFilter
        withCallingCode={false}
        theme={{
          backgroundColor: '#fff',
          primaryColor: C.blue,
          onBackgroundTextColor: C.ink,
          filterPlaceholderTextColor: C.ink3,
        }}
      />
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
  sectionSubtitle: { fontSize: T.xs, color: C.ink3, marginTop: 2 },

  // Section identité vérifiée (accent visuel distinct — carte "officielle")
  sectionIdentity: { borderColor: C.blueBorder, borderWidth: 1.5 },
  sectionNumIdentity: { backgroundColor: C.yellow },
  shieldBadge: {
    width: 30, height: 30, borderRadius: 15,
    backgroundColor: C.successSoft, borderWidth: 1, borderColor: C.successBorder,
    alignItems: 'center', justifyContent: 'center',
  },
  shieldBadgeTxt: { fontSize: T.sm },

  // Pastilles obligatoire / optionnel
  requiredPill: {
    backgroundColor: C.dangerSoft, borderWidth: 1, borderColor: C.dangerBorder,
    borderRadius: R.pill, paddingVertical: 4, paddingHorizontal: 10,
  },
  requiredPillTxt: { fontSize: T.xs, fontWeight: '800', color: C.dangerText },
  optionalPill: {
    backgroundColor: C.bg2, borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.pill, paddingVertical: 4, paddingHorizontal: 10,
  },
  optionalPillTxt: { fontSize: T.xs, fontWeight: '800', color: C.ink3 },

  // Champ verrouillé (OCR vérifié)
  lockedField: {
    backgroundColor: C.successSoft, borderWidth: 1, borderColor: C.successBorder,
    borderRadius: R.md, padding: 14, marginBottom: 14,
  },
  lockedFieldTop: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  lockedFieldLabel: { fontSize: T.xs, fontWeight: '700', color: C.ink2, textTransform: 'uppercase', letterSpacing: 0.7 },
  lockedFieldEdit: { fontSize: T.xs, fontWeight: '800', color: C.blue, textDecorationLine: 'underline' },
  lockedFieldRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  lockedFieldIcon: { fontSize: T.sm },
  lockedFieldValue: { fontSize: T.base, fontWeight: '800', color: C.ink },
  overrideTag: { fontSize: T.xs, fontWeight: '800', color: C.dangerText },

  // Bannière OCR
  ocrBanner: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: 'rgba(0,75,147,0.08)', borderWidth: 1, borderColor: 'rgba(0,75,147,0.16)',
    borderRadius: R.md, padding: 12, marginBottom: 14,
  },
  ocrBannerOk:   { backgroundColor: C.successSoft, borderColor: C.successBorder },
  ocrBannerWarn: { backgroundColor: C.dangerSoft, borderColor: C.dangerBorder },
  ocrBannerIcon: { fontSize: T.base },
  ocrBannerTxt:  { fontSize: T.xs, fontWeight: '700', color: C.ink2, flex: 1 },

  // Champs
  field:      { marginBottom: 14 },
  fieldLabel: { fontSize: T.xs, fontWeight: '700', color: C.ink2, textTransform: 'uppercase', letterSpacing: 0.7, marginBottom: 6 },
  req:        { color: C.danger },
  hint:       { fontSize: T.xs, color: C.ink3, marginBottom: 6 },
  hintDynamic:{ fontSize: T.xs, fontWeight: '600', marginTop: 4 },

  inputRow: { position: 'relative', justifyContent: 'center' },
  checkIcon: { position: 'absolute', right: 14, fontSize: T.base, color: C.successText },
  selectInput: { justifyContent: 'center', minHeight: 40 },
  selectInputText: { color: C.ink, fontSize: T.sm, fontWeight: '600' },
  selectInputPlaceholder: { color: C.ink3 },
  modalBackdrop: { flex: 1, backgroundColor: 'rgba(15,23,42,0.58)', justifyContent: 'center', padding: 16 },
  modalCard: { backgroundColor: '#fff', borderRadius: 16, padding: 16, maxHeight: '70%' },
  modalHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  modalTitle: { color: C.ink, fontSize: 16, fontWeight: '800' },
  closeBtnModal: { width: 32, height: 32, borderRadius: 16, backgroundColor: C.bg2, alignItems: 'center', justifyContent: 'center' },
  closeBtnText: { color: C.ink, fontWeight: '800' },
  searchInput: {
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: C.bgBorder,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    color: C.ink,
    marginBottom: 10,
  },
  loadingCountries: { alignItems: 'center', justifyContent: 'center', paddingVertical: 20 },
  loadingCountriesText: { marginTop: 8, color: C.ink3, fontSize: T.sm },
  optionList: { maxHeight: 320 },
  optionListContent: { gap: 8, paddingBottom: 6 },
  optionItem: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 10,
    backgroundColor: C.bg2,
    borderWidth: 1,
    borderColor: 'rgba(15,23,42,0.06)',
    gap: 10,
  },
  optionItemActive: { backgroundColor: C.blue, borderColor: C.blue },
  flagText: { fontSize: 18 },
  optionText: { color: C.ink, fontSize: T.sm, fontWeight: '600' },
  optionTextActive: { color: '#fff' },

  input: {
    backgroundColor: C.bg2,
    borderWidth: 1, borderColor: C.bgBorder,
    borderRadius: R.md, paddingVertical: 12, paddingHorizontal: 14,
    fontSize: T.base, color: C.ink,
  },
  inputValid: { borderColor: C.success },
  inputLocked: {
    backgroundColor: C.successSoft,
    borderColor: C.successBorder,
    color: C.ink,
  },
  inputCompact: {
    fontSize: T.lg,
    fontWeight: '700',
    textAlign: 'center',
    letterSpacing: 1.5,
    paddingVertical: 10,
    paddingHorizontal: 10,
    fontVariant: ['tabular-nums'],
  },

  // Photos
  photosGrid: { flexDirection: 'row', gap: 12 },
  photoBox: {
    flex: 1, aspectRatio: 0.72,
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
  root: {
    flex: 1,
    backgroundColor: '#05070C',
    paddingTop: Platform.OS === 'android' ? (StatusBar.currentHeight || 12) : 0,
    paddingBottom: Platform.OS === 'android' ? 10 : 0,
  },
  camera: { flex: 1, backgroundColor: '#000' },

  camHeader: {
    position: 'absolute', top: 0, left: 0, right: 0,
    zIndex: 2,
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingTop: 12, paddingBottom: 12,
    backgroundColor: 'rgba(15,23,32,0.72)',
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

  frameOuter: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingTop: 96,
    paddingBottom: 112,
    paddingHorizontal: 24,
  },
  cameraSelectOverlay: {
    display: 'none',
  },
  footerSpacer: { width: 56 },
  switchCameraBtn: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: 'rgba(255,255,255,0.14)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.20)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  switchCameraTxt: {
    fontSize: 22,
    color: '#fff',
  },
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
    position: 'absolute', bottom: 0, left: 0, right: 0,
    zIndex: 2,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: 20,
    paddingHorizontal: 18,
    backgroundColor: 'rgba(15,23,32,0.72)',
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

  previewWrap: {
    flex: 1, padding: 20, gap: 16,
    alignItems: 'center', justifyContent: 'center',
  },
  previewTitle: { fontSize: T.md, fontWeight: '800', color: '#fff', textAlign: 'center' },
  previewImg: {
    width: '100%', flex: 1, maxHeight: '68%',
    borderRadius: R.lg, borderWidth: 1, borderColor: 'rgba(255,255,255,0.15)',
  },
  previewActions: { flexDirection: 'row', gap: 10, width: '100%' },
  previewRetakeBtn: {
    flex: 1, backgroundColor: 'rgba(255,255,255,0.12)', borderWidth: 1.5,
    borderColor: 'rgba(255,255,255,0.3)', borderRadius: R.lg,
    paddingVertical: 14, alignItems: 'center',
  },
  previewRetakeTxt: { color: '#fff', fontSize: T.base, fontWeight: '700' },
  previewValidateBtn: {
    flex: 1, backgroundColor: C.success, borderRadius: R.lg,
    paddingVertical: 14, alignItems: 'center',
  },
  previewValidateTxt: { color: '#fff', fontSize: T.base, fontWeight: '800' },

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