/**
 * AcquisitionScreenPro.tsx — KYC Mobile V4 "Pro"
 * ─────────────────────────────────────────────────────────────────────────────
 * Formulaire hybride : expo-camera + fallback natif · Charte MTN kyc-modern-light
 * Le profil agent (pays, whatsapp, fonction, zone) vient du Login — il n'est
 * plus jamais redemandé ici. Seuls le numéro MTN et les 2 photos sont saisis
 * à chaque dossier.
 */
import React, { useState, useRef, useEffect, useMemo, useCallback } from 'react';
import {
  View, Text, TextInput, TouchableOpacity, StyleSheet, Platform,
  KeyboardAvoidingView, ScrollView, ActivityIndicator, Image,
  StatusBar, SafeAreaView, Animated,
  Modal, FlatList, Alert, PanResponder,
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import * as FileSystem from 'expo-file-system';
import ViewShot from 'react-native-view-shot';
// Typings for this project's version of react-native-view-shot are incompatible
// with our usage of children in JSX. Cast to `any` to avoid the TS error.
const ViewShotAny: any = ViewShot;
import Svg, { Rect, Path } from 'react-native-svg';
import DateTimePicker, { DateTimePickerEvent } from '@react-native-community/datetimepicker';
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

// Options du select "Sexe" — évite la saisie libre pour un champ à valeurs finies.
const SEXE_OPTIONS = [
  { label: 'Masculin', value: 'M' },
  { label: 'Féminin',  value: 'F' },
];

// Champs issus de la lecture OCR de la CNI. Une fois validés, ils deviennent
// non modifiables pour réduire les risques de fraude et garantir une
// traçabilité claire de l'identité du titulaire.
const OCR_LOCKED_FIELDS = ['nomTitulaire', 'prenomTitulaire', 'dateNaissance', 'lieuNaissance', 'numeroCni', 'sexe', 'nationalite', 'dateExpiration'] as const;
type OcrLockedField = typeof OCR_LOCKED_FIELDS[number];

// Signature du titulaire : 'dessin' si le titulaire sait signer (idéalement
// en reproduisant sa signature de la pièce), 'empreinte' sinon — son
// empreinte digitale apposée sur le pad tient alors lieu de signature.
// Même contrat serveur que la version web (signature_mode / photo_signature,
// voir public-dossiers.ts).
type SignatureMode = 'dessin' | 'empreinte';

// Types de pièce pris en charge. Les pièces "officielles" ont un format
// d'État structuré (numéro, dates, expiration) : on exige une extraction/
// saisie complète, y compris la date d'expiration. Une carte scolaire ou un
// autre justificatif n'a pas ce niveau de structuration standardisée — les
// champs secondaires peuvent légitimement manquer, on ne les exige donc pas.
// Ce choix doit se faire AVANT la capture, pour que l'OCR sache quels champs
// chercher (voir runOcr) et que le formulaire n'exige pas des infos absentes
// du document (voir validate).
const DOCUMENT_TYPES = [
  { value: 'CNI',            label: 'CNI',                official: true },
  { value: 'CEDEAO',         label: 'Carte CEDEAO',       official: true },
  { value: 'PASSPORT',       label: 'Passeport',          official: true },
  { value: 'CIP',            label: 'CIP',                official: true },
  { value: 'PERMIS',         label: 'Permis de conduire', official: true },
  { value: 'CARTE_SCOLAIRE', label: 'Carte scolaire',     official: false },
  { value: 'CARTE_ETUDIANT', label: 'Carte étudiant',     official: false },
  { value: 'AUTRE',          label: 'Autre',              official: false },
] as const;
type DocumentTypeValue = typeof DOCUMENT_TYPES[number]['value'];
const isOfficialDoc = (v: string) => DOCUMENT_TYPES.find(d => d.value === v)?.official ?? false;

// Profession suggérée automatiquement selon le type de pièce non officiel
// présenté — l'agent n'a pas à la retaper à chaque fois pour un cas évident
// (un élève muni d'une carte scolaire est un élève), tout en restant libre
// de corriger si la situation réelle diffère (ex. adulte scolarisé tardif).
// Pas de suggestion pour une pièce officielle ou "Autre" : la profession n'y
// est pas déductible du seul type de document.
const DEFAULT_PROFESSION_BY_TYPE: Partial<Record<DocumentTypeValue, string>> = {
  CARTE_SCOLAIRE: 'Élève',
  CARTE_ETUDIANT: 'Étudiant',
};

type SignaturePoint = { x: number; y: number };

type NativeSignaturePadProps = {
  mode: SignatureMode;
  resetKey: number;
  onChange: (dataUri: string) => void;
  disabled?: boolean;
  // Notifie le parent qu'un tracé est en cours, pour désactiver le scroll de
  // la page pendant la signature (voir onInteractionChange plus bas) — sans
  // ça, un ScrollView englobant peut intercepter le geste comme un scroll
  // au lieu de le laisser au pad, surtout au tout premier mouvement.
  onInteractionChange?: (interacting: boolean) => void;
};

function NativeSignaturePad({ mode, resetKey, onChange, disabled, onInteractionChange }: NativeSignaturePadProps) {
  const [strokes, setStrokes] = useState<SignaturePoint[][]>([]);
  const [currentStroke, setCurrentStroke] = useState<SignaturePoint[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 320, height: 220 });
  const viewShotRef = useRef<any>(null);
  const strokesRef = useRef<SignaturePoint[][]>([]);
  const currentStrokeRef = useRef<SignaturePoint[]>([]);

  useEffect(() => {
    strokesRef.current = [];
    currentStrokeRef.current = [];
    setStrokes([]);
    setCurrentStroke([]);
    onChange('');
  }, [resetKey, onChange]);

  const captureSignature = useCallback(async (nextStrokes: SignaturePoint[][]) => {
    try {
      const uri = await viewShotRef.current?.capture?.();
      if (typeof uri === 'string' && uri.length > 0) {
        onChange(uri);
      } else if (nextStrokes.length === 0) {
        onChange('');
      }
    } catch {
      if (nextStrokes.length === 0) {
        onChange('');
      }
    }
  }, [onChange]);

  const finalizeStroke = useCallback((nextStrokes: SignaturePoint[][]) => {
    strokesRef.current = nextStrokes;
    setStrokes(nextStrokes);
    currentStrokeRef.current = [];
    setCurrentStroke([]);
    void captureSignature(nextStrokes);
  }, [captureSignature]);

  const panResponder = useMemo(() => PanResponder.create({
    // Capture dès le "should set" — pas seulement au niveau bulle — pour que
    // le pad revendique le geste avant le ScrollView englobant. Sans les
    // variantes *Capture, un ScrollView parent (ou tout ancêtre qui essaie
    // lui-même d'intercepter le toucher) peut voler le premier mouvement et
    // le pad ne reçoit alors jamais rien.
    onStartShouldSetPanResponder: () => !disabled,
    onStartShouldSetPanResponderCapture: () => !disabled,
    onMoveShouldSetPanResponder: () => !disabled,
    onMoveShouldSetPanResponderCapture: () => !disabled,
    onPanResponderTerminationRequest: () => false,
    onPanResponderGrant: (evt) => {
      onInteractionChange?.(true);
      const point = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
      currentStrokeRef.current = [point];
      setCurrentStroke([point]);
    },
    onPanResponderMove: (evt) => {
      const point = { x: evt.nativeEvent.locationX, y: evt.nativeEvent.locationY };
      const next = [...currentStrokeRef.current, point];
      currentStrokeRef.current = next;
      setCurrentStroke(next);
    },
    onPanResponderRelease: () => {
      const nextStrokes = currentStrokeRef.current.length > 0
        ? [...strokesRef.current, currentStrokeRef.current]
        : strokesRef.current;
      finalizeStroke(nextStrokes);
      onInteractionChange?.(false);
    },
    onPanResponderTerminate: () => {
      const nextStrokes = currentStrokeRef.current.length > 0
        ? [...strokesRef.current, currentStrokeRef.current]
        : strokesRef.current;
      finalizeStroke(nextStrokes);
      onInteractionChange?.(false);
    },
  }), [disabled, finalizeStroke, onInteractionChange]);

  const buildPath = (points: SignaturePoint[]) => {
    if (points.length === 0) return '';
    const [first, ...rest] = points;
    let d = `M ${first.x.toFixed(2)} ${first.y.toFixed(2)}`;
    for (const point of rest) {
      d += ` L ${point.x.toFixed(2)} ${point.y.toFixed(2)}`;
    }
    return d;
  };

  const strokeColor = mode === 'empreinte' ? 'rgba(0,48,135,0.78)' : '#0F1720';
  const strokeWidth = mode === 'empreinte' ? 12 : 2.4;

  return (
    <ViewShotAny
      ref={viewShotRef as any}
      options={{ format: 'png', quality: 1 }}
      style={{ flex: 1, backgroundColor: mode === 'empreinte' ? '#F1F5F9' : '#FFFFFF' }}
      onLayout={(e) => setCanvasSize({ width: e.nativeEvent.layout.width || 320, height: e.nativeEvent.layout.height || 220 })}
    >
      <View style={{ flex: 1 }} {...panResponder.panHandlers}>
        <Svg width="100%" height="100%" viewBox={`0 0 ${canvasSize.width} ${canvasSize.height}`}>
          <Rect x={0} y={0} width={canvasSize.width} height={canvasSize.height} fill="transparent" />
          {strokes.map((stroke, index) => (
            <Path key={`stroke-${index}`} d={buildPath(stroke)} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          ))}
          {currentStroke.length > 0 && (
            <Path d={buildPath(currentStroke)} fill="none" stroke={strokeColor} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" />
          )}
        </Svg>
      </View>
    </ViewShotAny>
  );
}

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
  const [signatureInteracting, setSignatureInteracting] = useState(false);
  const [activeStep, setActiveStep]   = useState(1);
  const [nationalityPickerVisible, setNationalityPickerVisible] = useState(false);
  const [selectedCountryCode, setSelectedCountryCode] = useState<CountryCode>('CG');
  const [countryName, setCountryName] = useState('Congo (Brazzaville)');
  const shakeAnim = useRef(new Animated.Value(0)).current;
  const cameraOverlayAnim = useRef(new Animated.Value(1)).current;
  const scrollViewRef = useRef<ScrollView | null>(null);

  // ── Infos titulaire (pré-remplies par OCR sur le recto + saisie agent) ────
  // nomTitulaire / prenomTitulaire / dateNaissance / lieuNaissance : lus par
  // OCR sur le recto de la CNI (voir runOcr), toujours modifiables ensuite.
  // autreNumero / nomPere / nomMere / adresseComplete / numeroCni / sexe /
  // nationalite / profession : jamais issus de l'OCR, saisis par l'agent
  // terrain et préremplis si le service OCR les retourne.
  // Type de pièce choisi AVANT toute capture — conditionne à la fois ce que
  // l'OCR va chercher (voir runOcr) et les champs exigés par le formulaire
  // (voir validate) : complet + date d'expiration pour une pièce officielle,
  // nom/prénom seulement pour une carte scolaire ou un justificatif "autre".
  const [typePiece, setTypePiece] = useState<DocumentTypeValue | ''>('');

  const [idInfo, setIdInfo] = useState({
    nomTitulaire: '', prenomTitulaire: '', dateNaissance: '', lieuNaissance: '',
    autreNumero: '', nomPere: '', nomMere: '', adresseComplete: '', numeroCni: '',
    sexe: '', nationalite: '', profession: '', dateExpiration: '',
  });
  const [ocrStatus, setOcrStatus] = useState<'idle' | 'loading' | 'success' | 'failed'>('idle');
  // Champs OCR déverrouillés manuellement après confirmation explicite de l'agent
  // (ex. erreur de lecture) — conservé pour audit et envoyé au serveur.
  const [manualOverride, setManualOverride] = useState<Record<string, boolean>>({});
  const setIdField = (key: keyof typeof idInfo, value: string) =>
    setIdInfo(prev => ({ ...prev, [key]: value }));

  // ── Signature titulaire (dessin ou empreinte digitale) ────────────────────
  // Le pad ne s'affiche qu'une fois le recto capturé (voir rendu plus bas),
  // comme les champs d'identité juste au-dessus : avant ça, il n'y a encore
  // aucun titulaire identifié à faire signer.
  const [signatureMode, setSignatureMode] = useState<SignatureMode>('dessin');
  const [signatureData, setSignatureData] = useState('');      // PNG base64 (data URI)
  const [signaturePadKey, setSignaturePadKey] = useState(0);   // force le remount du pad à l'effacement/changement de mode

  const clearSignature = () => {
    setSignatureData('');
    setSignaturePadKey(k => k + 1);
  };

  // Changer de mode efface le tracé en cours : un trait de signature et une
  // empreinte n'ont pas la même épaisseur/couleur, mieux vaut recommencer
  // proprement que de garder un tracé incohérent avec le mode affiché.
  const switchSignatureMode = (mode: SignatureMode) => {
    if (mode === signatureMode) return;
    setSignatureMode(mode);
    clearSignature();
  };

  // ── Select générique (options fermées, ex. Sexe) ──────────────────────────
  const [optionPicker, setOptionPicker] = useState<{ key: OcrLockedField; label: string; options: { label: string; value: string }[] } | null>(null);
  const openOptionPicker = (key: OcrLockedField, label: string, options: { label: string; value: string }[]) =>
    setOptionPicker({ key, label, options });

  // ── Sélecteur de date natif (calendrier) — remplace la saisie manuelle ────
  // dateFieldTarget indique quel champ idInfo la roue/le dialogue modifie :
  // 'dateNaissance' (toujours) ou 'dateExpiration' (pièces officielles).
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [dateFieldTarget, setDateFieldTarget] = useState<'dateNaissance' | 'dateExpiration'>('dateNaissance');
  const [tempDate, setTempDate] = useState<Date>(new Date(2000, 0, 1));
  const [docTypePickerVisible, setDocTypePickerVisible] = useState(false);

  const parseDateFR = (str: string): Date | null => {
    const m = str.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (!m) return null;
    const d = new Date(Number(m[3]), Number(m[2]) - 1, Number(m[1]));
    return Number.isNaN(d.getTime()) ? null : d;
  };

  const formatDateFR = (d: Date): string => {
    const dd = String(d.getDate()).padStart(2, '0');
    const mm = String(d.getMonth() + 1).padStart(2, '0');
    return `${dd}/${mm}/${d.getFullYear()}`;
  };

  const openDatePicker = (field: 'dateNaissance' | 'dateExpiration' = 'dateNaissance') => {
    setDateFieldTarget(field);
    // Pour l'expiration on repart d'aujourd'hui (une pièce non expirée est
    // toujours dans le futur) plutôt que de l'an 2000, plus pertinent pour
    // guider l'agent qui doit choisir une date d'expiration.
    const fallback = field === 'dateExpiration' ? new Date() : new Date(2000, 0, 1);
    setTempDate(parseDateFR(idInfo[field]) || fallback);
    setShowDatePicker(true);
  };

  const handleTypePieceChange = (value: DocumentTypeValue) => {
    if (typePiece === value) return;
    setTypePiece(value);
    // Le document change : les champs déjà lus/saisis ne sont plus fiables
    // pour ce nouveau type de pièce.
    if (ocrStatus !== 'idle') {
      setOcrStatus('idle');
      setManualOverride({});
    }
    // Suggestion de profession (élève/étudiant) : on ne remplace jamais une
    // valeur déjà saisie par l'agent, seulement la précédente auto-suggestion
    // ou un champ vide.
    const suggestion = DEFAULT_PROFESSION_BY_TYPE[value];
    if (suggestion) {
      setIdInfo(prev => {
        const prevWasSuggestion = Object.values(DEFAULT_PROFESSION_BY_TYPE).includes(prev.profession);
        if (prev.profession && !prevWasSuggestion) return prev;
        return { ...prev, profession: suggestion };
      });
    }
  };

  // Android : le dialogue natif se ferme et renvoie directement la date choisie
  // (tout est automatique — pas de bouton "Valider" séparé).
  // iOS : la roue reste ouverte dans une modale tant que l'agent n'a pas
  // confirmé, pour éviter une validation accidentelle en faisant défiler.
  const onNativeDateChange = (event: DateTimePickerEvent, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
      if (event.type === 'set' && selectedDate) {
        setIdField(dateFieldTarget, formatDateFR(selectedDate));
      }
      return;
    }
    if (selectedDate) setTempDate(selectedDate);
  };

  const confirmIosDate = () => {
    setIdField(dateFieldTarget, formatDateFR(tempDate));
    setShowDatePicker(false);
  };

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

  // Une CNI n'a besoin d'aucune définition supérieure à ~1600px de large pour
  // rester parfaitement lisible (OCR + relecture humaine) : au-delà, on ne
  // paie que du poids réseau inutile. Le redimensionnement + réencodage
  // natif (expo-image-manipulator) est quasi instantané (<300ms) et réduit
  // le fichier de 80-90% sans perte visible, ce qui est déterminant sur un
  // réseau terrain instable (voir logs "Upload échoué : erreur réseau").
  const MAX_PHOTO_WIDTH = 1600;
  const PHOTO_JPEG_QUALITY = 0.72;

  const compressPhoto = async (uri: string) => {
    try {
      const result = await ImageManipulator.manipulateAsync(
        uri,
        [{ resize: { width: MAX_PHOTO_WIDTH } }],
        { compress: PHOTO_JPEG_QUALITY, format: ImageManipulator.SaveFormat.JPEG },
      );
      return result.uri;
    } catch (err) {
      // Si la compression échoue pour une raison quelconque, on retombe sur
      // l'original plutôt que de bloquer la capture — mais c'est un cas
      // d'exception, pas le comportement attendu.
      console.warn('[Acquisition] Compression photo échouée, envoi en taille native :', err);
      return uri;
    }
  };

  const capturePhoto = async (type: 'recto'|'verso') => {
    if (!cameraRef.current || !cameraReady) return;
    try {
      const photo = await cameraRef.current.takePictureAsync({ quality: 0.85, skipProcessing: false });
      const uri = photo?.uri;
      if (!uri) throw new Error('Aucun fichier photo renvoyé');

      const compressedUri = await compressPhoto(uri);

      // On s'arrête sur un aperçu (Reprendre / Valider) plutôt que de
      // committer directement — comme sur AcquisitionPage.tsx (web).
      setPendingPhoto({ uri: compressedUri, type });
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
      fd.append('type_piece', typePiece || 'AUTRE');
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
        dateExpiration:  prev.dateExpiration  || data.date_expiration || '',
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
    if (!typePiece) return 'Sélectionnez le type de pièce avant de continuer';
    if (!numeroMtn) return 'Saisissez le numéro MTN';
    const v = validatePhoneNumber(numeroMtn, agent.country);
    if (!v.valid) return `Numéro invalide : ${v.error}`;
    if (!photos.recto) return 'Capturez le recto du CNI';
    if (!photos.verso) return 'Capturez le verso du CNI';
    // Infos titulaire requises pour l'enregistrement SIM (réglementation KYC).
    // Nom/prénom sont exigés quel que soit le document présenté.
    if (!idInfo.nomTitulaire.trim())    return 'Renseignez le nom du titulaire';
    if (!idInfo.prenomTitulaire.trim()) return 'Renseignez le prénom du titulaire';
    // Une pièce officielle (CNI, CEDEAO, passeport, CIP, permis) a un format
    // d'État structuré : on exige alors une extraction/saisie complète,
    // numéro de pièce et date d'expiration inclus. Une carte scolaire ou un
    // justificatif "autre" n'a pas ce niveau de structuration standardisée —
    // ces champs peuvent légitimement manquer, on ne les exige donc pas.
    const official = isOfficialDoc(typePiece);
    if (official) {
      if (!idInfo.dateNaissance.trim())   return 'Renseignez la date de naissance';
      if (!idInfo.lieuNaissance.trim())   return 'Renseignez le lieu de naissance';
      if (!idInfo.numeroCni.trim())       return 'Renseignez le numéro de la pièce d’identité';
      if (!idInfo.dateExpiration.trim())  return 'Renseignez la date d’expiration de la pièce';
    }
    if (!idInfo.sexe.trim())            return 'Renseignez le sexe';
    if (!idInfo.profession.trim())     return 'Renseignez la profession';
    // Adresse et nationalité : une pièce non officielle (carte scolaire,
    // carte étudiant, autre justificatif) ne les porte pas de façon fiable —
    // on ne bloque donc plus leur absence dans ce cas, contrairement aux
    // pièces officielles où elles restent exigées.
    if (official) {
      if (!idInfo.nationalite.trim())    return 'Renseignez la nationalité';
      if (!idInfo.adresseComplete.trim()) return 'Renseignez l’adresse complète';
    }
    if (!idInfo.nomPere.trim())         return 'Renseignez le nom du père';
    if (!idInfo.nomMere.trim())         return 'Renseignez le nom de la mère';
    if (!signatureData) {
      return signatureMode === 'empreinte'
        ? 'Faites apposer l’empreinte digitale du titulaire'
        : 'Faites signer le titulaire';
    }
    return null;
  };

  // Convertit l'image base64 renvoyée par le pad de signature en fichier
  // temporaire local : XMLHttpRequest/FormData sur React Native ont besoin
  // d'une uri de fichier (comme pour les photos recto/verso), pas d'un
  // simple base64 inline.
  const signatureDataUriToFile = async (dataUri: string): Promise<string> => {
    const base64 = dataUri.includes(',') ? dataUri.split(',')[1] : dataUri;
    const fileUri = `${FileSystem.cacheDirectory}signature_${Date.now()}.png`;
    await FileSystem.writeAsStringAsync(fileUri, base64, { encoding: FileSystem.EncodingType.Base64 });
    return fileUri;
  };

  const submitAttemptRef = useRef(0);

  const handleSubmit = async () => {
    const err = validate();
    if (err) { setError(err); shake(); return; }
    submitAttemptRef.current = 0;
    setActiveStep(4);
    setLoading(true); setError(''); setProgress(0);
    void submitDossier();
  };

  const submitDossier = async () => {
    try {
      const fd = new FormData();
      fd.append('numero_mtn', numeroMtn);
      fd.append('country', agent.country);
      fd.append('wa_agent', agent.numeroAgent);
      fd.append('username_agent', agent.numeroAgent || '');
      fd.append('fonction_agent', agent.fonctionAgent);
      fd.append('zone_agent', agent.zoneAgent);
      // ── Infos titulaire pour l'enregistrement SIM (voir SERVER_SPEC.md) ──
      fd.append('type_piece', typePiece || 'AUTRE');
      fd.append('nom_titulaire', idInfo.nomTitulaire.trim());
      fd.append('prenom_titulaire', idInfo.prenomTitulaire.trim());
      fd.append('date_naissance', idInfo.dateNaissance.trim());
      fd.append('lieu_naissance', idInfo.lieuNaissance.trim());
      fd.append('autre_numero', idInfo.autreNumero.trim());
      fd.append('nom_pere', idInfo.nomPere.trim());
      fd.append('nom_mere', idInfo.nomMere.trim());
      fd.append('adresse_complete', idInfo.adresseComplete.trim());
      fd.append('numero_cni', idInfo.numeroCni.trim());
      fd.append('date_expiration', idInfo.dateExpiration.trim());
      fd.append('sexe', idInfo.sexe.trim());
      fd.append('nationalite', idInfo.nationalite.trim());
      fd.append('profession', idInfo.profession.trim());
      // Audit anti-fraude : liste des champs OCR corrigés manuellement par l'agent
      const overriddenFields = OCR_LOCKED_FIELDS.filter(k => manualOverride[k]);
      if (overriddenFields.length) fd.append('ocr_overrides', overriddenFields.join(','));
      if (photos.recto?.uri) fd.append('photo_recto', { uri: photos.recto.uri, type: 'image/jpeg', name: 'recto.jpg' } as any);
      if (photos.verso?.uri) fd.append('photo_verso', { uri: photos.verso.uri, type: 'image/jpeg', name: 'verso.jpg' } as any);
      // ── Signature titulaire (voir SERVER_SPEC.md — signature_mode / photo_signature) ──
      fd.append('signature_mode', signatureMode);
      if (signatureData) {
        const sigUri = await signatureDataUriToFile(signatureData);
        fd.append('photo_signature', { uri: sigUri, type: 'image/png', name: 'signature.png' } as any);
      }

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
        } else if (xhr.status === 413) {
          setError('Photo trop volumineuse pour le serveur (max 5 Mo) — reprends la photo.');
          console.warn('[Acquisition] Upload refusé : fichier trop volumineux (413)');
          shake();
          setLoading(false);
        } else {
          try { setError(JSON.parse(xhr.responseText)?.error || `Erreur ${xhr.status}`); } catch { setError(`Erreur ${xhr.status}`); }
          console.warn('[Acquisition] Upload refusé par le serveur, statut', xhr.status, xhr.responseText);
          shake();
          setLoading(false);
        }
      });
      xhr.addEventListener('error', () => {
        // Réseau terrain instable : une coupure ponctuelle pendant l'envoi
        // (et pas un refus serveur) mérite une seconde tentative silencieuse
        // avant d'ennuyer l'agent avec une erreur.
        if (submitAttemptRef.current < 1) {
          submitAttemptRef.current += 1;
          console.warn('[Acquisition] Upload échoué : erreur réseau — nouvelle tentative automatique');
          setProgress(0);
          void submitDossier();
          return;
        }
        console.warn('[Acquisition] Upload échoué : erreur réseau (après tentative de reprise)');
        setError('Erreur réseau pendant l’envoi. Vérifie la connexion puis réessaie.');
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
      // Debug: log destination so we can diagnose network errors in logcat
      console.warn('[Acquisition] Envoi dossier vers', `${base}/api/public/dossiers`, { serverUrl: agent.serverUrl });
      xhr.open('POST', `${base}/api/public/dossiers`);
      xhr.send(fd);
    } catch (e: any) {
      console.warn('[Acquisition] submitDossier a échoué :', e);
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
    required = true,
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
          <Text style={s.fieldLabel}>{label} {required && <Text style={s.req}>*</Text>}</Text>
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

  // ── Champ select générique (options fermées, ex. Sexe) ────────────────────
  // Même traitement OCR (verrouillage / demande de correction) que les champs
  // texte, mais ouvre une liste d'options au lieu du clavier — plus rapide et
  // sans erreur de saisie pour un champ à valeurs finies.
  const renderSelectField = (
    key: OcrLockedField,
    label: string,
    options: { label: string; value: string }[],
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
            <Text style={s.lockedFieldValue}>{options.find(o => o.value === idInfo[key])?.label || idInfo[key]}</Text>
          </View>
        </View>
      );
    }
    const displayLabel = options.find(o => o.value === idInfo[key])?.label || '';
    return (
      <View style={s.field}>
        <View style={s.lockedFieldTop}>
          <Text style={s.fieldLabel}>{label} <Text style={s.req}>*</Text></Text>
          {manualOverride[key] && <Text style={s.overrideTag}>Correction signalée</Text>}
        </View>
        <TouchableOpacity
          style={[s.input, s.selectInput, s.selectInputRow]}
          onPress={() => !loading && openOptionPicker(key, label, options)}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Sélectionner ${label}`}
          accessibilityHint="Ouvre la liste des choix"
        >
          <Text style={[s.selectInputText, !displayLabel && s.selectInputPlaceholder]}>
            {displayLabel || 'Sélectionner'}
          </Text>
          <Text style={s.selectInputIcon}>▾</Text>
        </TouchableOpacity>
      </View>
    );
  };

  // ── Champ date (naissance ou expiration) : ouvre le calendrier natif ─────
  // required=false permet d'afficher le champ sans astérisque pour une pièce
  // non officielle où la date d'expiration n'est pas exigée mais reste
  // saisissable si l'agent l'a sous les yeux.
  const renderDateField = (key: 'dateNaissance' | 'dateExpiration', label: string, required = true) => {
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
          <Text style={s.fieldLabel}>{label} {required && <Text style={s.req}>*</Text>}</Text>
          {manualOverride[key] && <Text style={s.overrideTag}>Correction signalée</Text>}
        </View>
        <TouchableOpacity
          style={[s.input, s.selectInput, s.selectInputRow]}
          onPress={() => openDatePicker(key)}
          disabled={loading}
          accessibilityRole="button"
          accessibilityLabel={`Sélectionner ${label}`}
          accessibilityHint="Ouvre un calendrier"
        >
          <Text style={[s.selectInputText, !idInfo[key] && s.selectInputPlaceholder]}>
            {idInfo[key] || 'JJ/MM/AAAA'}
          </Text>
          <Text style={s.selectInputIcon}>📅</Text>
        </TouchableOpacity>
      </View>
    );
  };

  const renderNationalityField = (required = true) => {
    const locked = isFieldLocked('nationalite');
    return (
      <View style={s.field}>
        <View style={s.lockedFieldTop}>
          <Text style={s.fieldLabel}>Nationalité {required && <Text style={s.req}>*</Text>}</Text>
          {manualOverride.nationalite && <Text style={s.overrideTag}>Correction signalée</Text>}
        </View>
        <TouchableOpacity
          style={[s.input, s.selectInput, s.selectInputRow, locked && s.inputLocked]}
          onPress={() => !loading && !locked && setNationalityPickerVisible(true)}
          disabled={loading || locked}
          accessibilityRole="button"
          accessibilityLabel="Sélectionner la nationalité"
          accessibilityHint="Ouvre la liste des pays avec recherche"
        >
          <Text style={[s.selectInputText, !idInfo.nationalite && s.selectInputPlaceholder]}>
            {idInfo.nationalite || 'Sélectionner'}
          </Text>
          {!locked && <Text style={s.selectInputIcon}>▾</Text>}
        </TouchableOpacity>
      </View>
    );
  };

  // ── Formulaire principal ──────────────────────────────────────────────────
  return (
    <View style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />

      <AppHeader title="Acquisition" subtitle="Soumettre un numéro MTN" rightIcon="←" onRightPress={() => navigation.goBack()} />

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : 'height'} style={s.kav}>
        <ScrollView
          ref={scrollViewRef}
          style={s.scroll}
          contentContainerStyle={s.scrollContent}
          scrollEnabled={!signatureInteracting}
        >

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

            {/* ── Type de pièce : choisi AVANT la capture ────────────────────
                Conditionne ce que l'OCR va chercher et les champs exigés
                plus bas (numéro, date d'expiration...). Changer le type
                après une capture réinitialise le statut OCR pour éviter
                d'envoyer des champs verrouillés qui ne correspondent plus
                au document réellement présenté. */}
            <View style={s.field}>
              <Text style={s.fieldLabel}>Type de pièce <Text style={s.req}>*</Text></Text>
              <TouchableOpacity
                style={[s.input, s.selectInput]}
                onPress={() => !loading && setDocTypePickerVisible(true)}
                disabled={loading}
                accessibilityRole="button"
                accessibilityLabel="Sélectionner le type de pièce"
              >
                <View style={s.selectInputRow}>
                  <Text style={[s.selectInputText, !typePiece && s.selectInputPlaceholder]}>
                    {DOCUMENT_TYPES.find(dt => dt.value === typePiece)?.label || 'Sélectionner un type de pièce'}
                  </Text>
                  <Text style={s.selectInputIcon}>▾</Text>
                </View>
              </TouchableOpacity>
              {!typePiece && (
                <Text style={s.hint}>Choisissez le type de pièce avant de capturer les photos.</Text>
              )}
              {!!typePiece && !isOfficialDoc(typePiece) && (
                <Text style={s.hint}>Document non officiel : certains champs (numéro, date d’expiration…) resteront optionnels.</Text>
              )}
            </View>

            <View style={s.photosGrid}>
              {(['recto','verso'] as const).map(side => {
                const photo = photos[side];
                return (
                  <TouchableOpacity
                    key={side}
                    style={[s.photoBox, photo && s.photoBoxDone, !typePiece && s.photoBoxDisabled]}
                    onPress={() => {
                      if (!typePiece) { setError('Sélectionnez le type de pièce avant de capturer'); shake(); return; }
                      setCameraMode(side);
                    }}
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

            {/* Les champs d'identité ne s'affichent qu'une fois la capture
                du recto tentée (succès ou échec) : avant ça, ils seraient
                soit vides soit trompeurs. Pendant l'analyse (loading), on
                n'affiche que le spinner ci-dessus, pas un formulaire vide. */}
            {(ocrStatus === 'success' || ocrStatus === 'failed') && (
              <>
                {renderVerifiableField('nomTitulaire', 'Nom', "Nom tel qu'il figure sur la CNI", { autoCapitalize: 'characters' })}
                {renderVerifiableField('prenomTitulaire', 'Prénom(s)', 'Prénom(s)', { autoCapitalize: 'words' })}

                {/* Naissance, numéro de pièce et expiration : exigés pour une
                    pièce officielle (format d'État structuré), simplement
                    proposés (et non bloquants) pour une carte scolaire ou un
                    justificatif "autre" — voir DOCUMENT_TYPES/isOfficialDoc. */}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>{renderDateField('dateNaissance', 'Date de naissance', isOfficialDoc(typePiece))}</View>
                  <View style={{ flex: 1 }}>{renderVerifiableField('lieuNaissance', `Lieu de naissance${isOfficialDoc(typePiece) ? '' : ' (si connu)'}`, 'Ville', {}, isOfficialDoc(typePiece))}</View>
                </View>

                {renderVerifiableField('numeroCni', `Numéro de pièce${isOfficialDoc(typePiece) ? '' : ' (si disponible)'}`, 'Numéro de pièce d’identité', {}, isOfficialDoc(typePiece))}
                {isOfficialDoc(typePiece) && renderDateField('dateExpiration', "Date d'expiration")}
                <View style={{ flexDirection: 'row', gap: 12 }}>
                  <View style={{ flex: 1 }}>{renderSelectField('sexe', 'Sexe', SEXE_OPTIONS)}</View>
                  {/* Nationalité : lue automatiquement sur une pièce
                      officielle, saisie manuelle sinon (voir ocr.ts). */}
                  <View style={{ flex: 1 }}>{renderNationalityField(isOfficialDoc(typePiece))}</View>
                </View>
              </>
            )}
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
              <Text style={s.fieldLabel}>Adresse complète {isOfficialDoc(typePiece) && <Text style={s.req}>*</Text>}</Text>
              <TextInput
                style={[s.input, { minHeight: 84, textAlignVertical: 'top' }]}
                value={idInfo.adresseComplete}
                onChangeText={(v) => setIdField('adresseComplete', v)}
                placeholder={isOfficialDoc(typePiece) ? 'Adresse complète du titulaire' : 'Adresse complète du titulaire (si connue)'}
                placeholderTextColor={C.ink3}
                multiline
                editable={!loading}
              />
            </View>
          </View>

          {/* ═══════════════════════════════════════════════════════════════
              SECTION 5 — Signature du titulaire
              N'apparaît qu'une fois le recto capturé : avant ça, il n'y a
              pas encore de titulaire identifié à faire signer.
          ═══════════════════════════════════════════════════════════════ */}
          {!!photos.recto && (
            <View style={s.section}>
              <View style={s.sectionHeader}>
                <View style={s.sectionNum}><Text style={s.sectionNumTxt}>5</Text></View>
                <View style={{ flex: 1 }}>
                  <Text style={s.sectionTitle}>Signature</Text>
                  <Text style={s.sectionSubtitle}>{signatureMode === 'empreinte' ? 'Empreinte digitale' : 'Signature manuscrite'}</Text>
                </View>
                <View style={s.requiredPill}><Text style={s.requiredPillTxt}>Obligatoire</Text></View>
              </View>

              {/* Bascule dessin / empreinte — un seul pad, seuls le trait et
                  le message d'instruction changent selon le mode choisi. */}
              <View style={s.sigToggleRow}>
                <TouchableOpacity
                  style={[s.sigToggleBtn, signatureMode === 'dessin' && s.sigToggleBtnActive]}
                  onPress={() => switchSignatureMode('dessin')}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="Signature manuscrite"
                  accessibilityState={{ selected: signatureMode === 'dessin' }}
                >
                  <Text style={[s.sigToggleTxt, signatureMode === 'dessin' && s.sigToggleTxtActive]}>✍️ Signature</Text>
                </TouchableOpacity>
                <TouchableOpacity
                  style={[s.sigToggleBtn, signatureMode === 'empreinte' && s.sigToggleBtnActive]}
                  onPress={() => switchSignatureMode('empreinte')}
                  disabled={loading}
                  accessibilityRole="button"
                  accessibilityLabel="Empreinte digitale"
                  accessibilityState={{ selected: signatureMode === 'empreinte' }}
                >
                  <Text style={[s.sigToggleTxt, signatureMode === 'empreinte' && s.sigToggleTxtActive]}>👆 Empreinte digitale</Text>
                </TouchableOpacity>
              </View>

              <Text style={s.sigInstructions}>
                {signatureMode === 'dessin'
                  ? "Faites signer le titulaire ci-dessous (au doigt ou au stylet), en reproduisant si possible sa signature figurant sur la pièce."
                  : "Le titulaire ne sait pas signer : demandez-lui d'apposer son doigt sur la zone ci-dessous. Cette empreinte sera enregistrée comme sa signature."}
              </Text>

              <View style={[s.sigPadWrap, signatureData && s.sigPadWrapDone]}>
                <NativeSignaturePad
                  key={signaturePadKey}
                  mode={signatureMode}
                  resetKey={signaturePadKey}
                  onChange={setSignatureData}
                  disabled={loading}
                  onInteractionChange={setSignatureInteracting}
                />
                {!signatureData && (
                  <View style={s.sigPadHintOverlay}>
                    <Text style={s.sigPadHintText}>Touchez ici pour signer</Text>
                  </View>
                )}
                <TouchableOpacity
                  style={[s.sigFloatClearBtn, !signatureData && s.sigFloatClearBtnDisabled]}
                  onPress={clearSignature}
                  disabled={loading || !signatureData}
                  hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
                >
                  <Text style={s.sigFloatClearTxt}>Effacer</Text>
                </TouchableOpacity>
              </View>

              <View style={s.sigStatusRow}>
                <Text style={[s.sigStatusTxt, signatureData && s.sigStatusTxtOk]}>
                  {signatureData ? '✓ Signature enregistrée' : 'En attente de signature'}
                </Text>
                <TouchableOpacity onPress={clearSignature} disabled={loading} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
                  <Text style={s.sigClearTxt}>Effacer</Text>
                </TouchableOpacity>
              </View>
            </View>
          )}

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

      <Modal
        visible={docTypePickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setDocTypePickerVisible(false)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>Type de pièce</Text>
              <TouchableOpacity style={s.closeBtnModal} onPress={() => setDocTypePickerVisible(false)}>
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={DOCUMENT_TYPES}
              keyExtractor={(item) => item.value}
              style={s.optionList}
              contentContainerStyle={s.optionListContent}
              renderItem={({ item }) => {
                const active = typePiece === item.value;
                return (
                  <TouchableOpacity
                    style={[s.optionItem, active && s.optionItemActive]}
                    onPress={() => {
                      handleTypePieceChange(item.value as DocumentTypeValue);
                      setDocTypePickerVisible(false);
                    }}
                  >
                    <Text style={[s.optionText, active && s.optionTextActive]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* ── Select générique (ex. Sexe) — modale de choix ──────────────────── */}
      <Modal
        visible={!!optionPicker}
        transparent
        animationType="fade"
        onRequestClose={() => setOptionPicker(null)}
      >
        <View style={s.modalBackdrop}>
          <View style={s.modalCard}>
            <View style={s.modalHeader}>
              <Text style={s.modalTitle}>{optionPicker?.label || 'Sélectionner'}</Text>
              <TouchableOpacity style={s.closeBtnModal} onPress={() => setOptionPicker(null)}>
                <Text style={s.closeBtnText}>✕</Text>
              </TouchableOpacity>
            </View>
            <FlatList
              data={optionPicker?.options || []}
              keyExtractor={(item) => item.value}
              style={s.optionList}
              contentContainerStyle={s.optionListContent}
              renderItem={({ item }) => {
                const active = optionPicker ? idInfo[optionPicker.key] === item.value : false;
                return (
                  <TouchableOpacity
                    style={[s.optionItem, active && s.optionItemActive]}
                    onPress={() => {
                      if (!optionPicker) return;
                      setIdField(optionPicker.key, item.value);
                      setOptionPicker(null);
                    }}
                  >
                    <Text style={[s.optionText, active && s.optionTextActive]}>{item.label}</Text>
                  </TouchableOpacity>
                );
              }}
            />
          </View>
        </View>
      </Modal>

      {/* ── Sélecteur de date natif ─────────────────────────────────────────
          Android : dialogue système, se ferme tout seul, résultat automatique.
          iOS : roue dans une modale, confirmée par le bouton "Valider". ──── */}
      {showDatePicker && Platform.OS === 'android' && (
        <DateTimePicker
          value={tempDate}
          mode="date"
          display="default"
          // Une date de naissance ne peut être dans le futur ; une date
          // d'expiration si — on ne plafonne donc qu'un des deux champs.
          maximumDate={dateFieldTarget === 'dateNaissance' ? new Date() : undefined}
          onChange={onNativeDateChange}
        />
      )}

      {Platform.OS === 'ios' && (
        <Modal
          visible={showDatePicker}
          transparent
          animationType="fade"
          onRequestClose={() => setShowDatePicker(false)}
        >
          <View style={s.modalBackdrop}>
            <View style={s.datePickerCard}>
              <Text style={s.modalTitle}>{dateFieldTarget === 'dateExpiration' ? "Date d'expiration" : 'Date de naissance'}</Text>
              <DateTimePicker
                value={tempDate}
                mode="date"
                display="spinner"
                maximumDate={dateFieldTarget === 'dateNaissance' ? new Date() : undefined}
                onChange={onNativeDateChange}
                style={s.datePickerWheel}
              />
              <View style={s.datePickerActions}>
                <TouchableOpacity style={s.datePickerCancelBtn} onPress={() => setShowDatePicker(false)}>
                  <Text style={s.datePickerCancelTxt}>Annuler</Text>
                </TouchableOpacity>
                <TouchableOpacity style={s.datePickerConfirmBtn} onPress={confirmIosDate}>
                  <Text style={s.datePickerConfirmTxt}>Valider</Text>
                </TouchableOpacity>
              </View>
            </View>
          </View>
        </Modal>
      )}
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
  agentAvatarTxt: { fontSize: T.xs, lineHeight: T.xs, fontWeight: '900', color: C.yellow, includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },
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
  stepNum:          { fontSize: T.sm, lineHeight: T.sm, fontWeight: '700', color: C.ink3, includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },
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
  sectionNumTxt: { fontSize: T.sm, lineHeight: T.sm, fontWeight: '900', color: C.blue, includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },
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
  shieldBadgeTxt: { fontSize: T.sm, lineHeight: T.sm, includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },

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
  selectInputRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectInputText: { color: C.ink, fontSize: T.sm, fontWeight: '600' },
  selectInputPlaceholder: { color: C.ink3 },
  selectInputIcon: { fontSize: T.sm, color: C.ink3, marginLeft: 8 },
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

  // Sélecteur de date (modale iOS)
  datePickerCard: {
    backgroundColor: '#fff', borderRadius: 16, padding: 16, alignItems: 'stretch',
  },
  datePickerWheel: { alignSelf: 'stretch' },
  datePickerActions: { flexDirection: 'row', gap: 10, marginTop: 12 },
  datePickerCancelBtn: {
    flex: 1, borderWidth: 1.5, borderColor: C.bgBorder, borderRadius: R.md,
    paddingVertical: 12, alignItems: 'center', backgroundColor: C.bg2,
  },
  datePickerCancelTxt: { fontSize: T.sm, fontWeight: '700', color: C.ink2 },
  datePickerConfirmBtn: {
    flex: 1, backgroundColor: C.blue, borderRadius: R.md,
    paddingVertical: 12, alignItems: 'center',
  },
  datePickerConfirmTxt: { fontSize: T.sm, fontWeight: '800', color: '#fff' },

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

  // Type de pièce (choix en amont de la capture)
  docTypeGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 6 },
  docTypeChip: {
    paddingVertical: 9, paddingHorizontal: 14,
    borderRadius: R.pill, borderWidth: 1.5, borderColor: C.bgBorder,
    backgroundColor: '#fff',
  },
  docTypeChipSelected: { backgroundColor: C.blue, borderColor: C.blue },
  docTypeChipTxt: { fontSize: T.sm, fontWeight: '700', color: C.ink2 },
  docTypeChipTxtSelected: { color: '#fff' },

  // Signature (bascule dessin/empreinte + pad)
  sigToggleRow: { flexDirection: 'row', gap: 8, marginBottom: 10 },
  sigToggleBtn: {
    flex: 1, paddingVertical: 11, paddingHorizontal: 8, borderRadius: R.md,
    borderWidth: 1.5, borderColor: C.bgBorder, backgroundColor: '#fff', alignItems: 'center',
  },
  sigToggleBtnActive: { backgroundColor: 'rgba(0,48,135,0.08)', borderColor: C.blue },
  sigToggleTxt: { fontSize: T.sm, fontWeight: '700', color: C.blue },
  sigToggleTxtActive: { color: C.blue },
  sigInstructions: { fontSize: T.xs, color: C.ink3, lineHeight: 17, marginBottom: 10 },
  sigPadWrap: {
    width: '100%', minHeight: 220, height: 240, borderRadius: R.lg,
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.bgBorder,
    backgroundColor: C.bg2, overflow: 'hidden', position: 'relative',
    shadowColor: '#0F1720', shadowOpacity: 0.06, shadowRadius: 8, shadowOffset: { width: 0, height: 2 },
    elevation: 2,
  },
  sigPadWrapDone: { borderStyle: 'solid', borderColor: C.success },
  sigPad: { flex: 1, backgroundColor: 'transparent' },
  sigPadHintOverlay: {
    position: 'absolute', top: 0, left: 0, right: 0, bottom: 0,
    alignItems: 'center', justifyContent: 'center', pointerEvents: 'none',
    backgroundColor: 'rgba(248,250,252,0.55)',
  },
  sigPadHintText: { fontSize: T.sm, fontWeight: '700', color: C.ink3 },
  sigFloatClearBtn: {
    position: 'absolute', top: 10, right: 10, zIndex: 2,
    backgroundColor: '#fff', borderWidth: 1.2, borderColor: C.danger,
    paddingVertical: 8, paddingHorizontal: 12, borderRadius: 999,
    shadowColor: '#0F1720', shadowOpacity: 0.15, shadowRadius: 6, shadowOffset: { width: 0, height: 2 },
  },
  sigFloatClearBtnDisabled: { opacity: 0.45 },
  sigFloatClearTxt: { fontSize: T.xs, fontWeight: '800', color: C.danger },
  sigStatusRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 8 },
  sigStatusTxt: { fontSize: T.xs, fontWeight: '700', color: C.ink3 },
  sigStatusTxtOk: { color: C.successText },
  sigClearTxt: { fontSize: T.xs, fontWeight: '800', color: C.danger },

  // Photos
  photosGrid: { flexDirection: 'row', gap: 12 },
  photoBox: {
    flex: 1, aspectRatio: 0.72,
    borderRadius: R.lg, overflow: 'hidden',
    borderWidth: 1.5, borderStyle: 'dashed', borderColor: C.yellowBorder,
    backgroundColor: C.yellowSoft,
  },
  photoBoxDone: { borderStyle: 'solid', borderColor: C.success },
  photoBoxDisabled: { opacity: 0.45 },
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
  photoBadgeTxt: { fontSize: T.xs, lineHeight: T.xs, color: '#fff', fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },
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
  closeTxt:     { fontSize: T.xl, lineHeight: T.xl, color: '#fff', fontWeight: '700', includeFontPadding: false, textAlignVertical: 'center', textAlign: 'center' },
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
    lineHeight: 22,
    color: '#fff',
    includeFontPadding: false,
    textAlignVertical: 'center',
    textAlign: 'center',
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