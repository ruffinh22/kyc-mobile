/**
 * FaceVerifyScreen.tsx — Vérification faciale interactive pour mobile
 * ─────────────────────────────────────────────────────────────────────────────
 * 1 capture live du visage
 * • Hold-bar 1s avant auto-capture
 * • Flash blanc à la capture
 * • Envoi du frame live vers /api/dossiers/verify-face-realtime pour obtenir un score Rekognition AWS
 * • Puis POST /api/dossiers/complete-with-face-verify pour finaliser le dossier
 * • Caméra de secours (expo-image-picker) si la permission ou le matériel caméra bloque
 */

import React, { useEffect, useState, useRef, useCallback } from 'react';
import {
  View, Text, TouchableOpacity, StyleSheet, SafeAreaView,
  StatusBar, ActivityIndicator, Platform, NativeModules
} from 'react-native';
import { Camera, CameraType } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useAgentStore } from '../store/callStore';
import { C, R, T } from '../theme/tokens';

type StepType = 'center' | 'left' | 'right';
type StepState = 'idle' | 'active' | 'done';

interface StepDef {
  id: number;
  label: string;
  dir: StepType;
  icon: string;
}

const STEPS: StepDef[] = [
  { id: 0, label: 'Face', dir: 'center', icon: '😐' },
  { id: 1, label: 'Gauche', dir: 'left', icon: '↩️' },
  { id: 2, label: 'Droite', dir: 'right', icon: '↪️' },
];

const HOLD_MS = 1000;
const TICK_MS = 50;
// Nombre d'échecs de capture live avant de proposer la caméra de secours
const MAX_LIVE_FAILURES = 2;

export function FaceVerifyScreen({ route, navigation }: any) {
  const {
    dossierId,
    serverUrl,
    rectoPath,
    versoPath,
    numeroMtn,
    waAgent,
    country,
    fonctionAgent,
    zoneAgent,
  } = route.params;
  const { numeroAgent, preferredCamera, setPreferredCamera } = useAgentStore();

  const cameraRef = useRef<any>(null);
  const flashRef = useRef<View>(null);

  const holdTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdProgressRef = useRef(0);
  const isHoldingRef = useRef(false);
  const doneRef = useRef(false);
  const liveFailuresRef = useRef(0);

  // State UI
  const [stepStates, setStepStates] = useState<StepState[]>(['active', 'idle', 'idle']);
  const [ovalColor, setOvalColor] = useState<'grey' | 'yellow' | 'green' | 'red'>('grey');
  const [holdPct, setHoldPct] = useState(0);
  const [showHold, setShowHold] = useState(false);
  const [instrTitle, setInstrTitle] = useState('Initialisation…');
  const [instrSub, setInstrSub] = useState('Préparation caméra');
  // 'init' | 'capture' (caméra live) | 'fallback' (caméra de secours) |
  // 'uploading' | 'done' | 'error'
  const [phase, setPhase] = useState<'init' | 'capture' | 'fallback' | 'uploading' | 'done' | 'error'>('init');
  const [errMsg, setErrMsg] = useState('');
  const [selectedCamera, setSelectedCamera] = useState<'front' | 'back'>(preferredCamera === 'front' ? 'front' : preferredCamera === 'back' ? 'back' : 'front');
  const [result, setResult] = useState<{ message: string } | null>(null);
  const [cameraReady, setCameraReady] = useState(false);

  const baseUrl = serverUrl?.replace(/\/$/, '') || '';
  const apiBase = baseUrl.startsWith('http') ? baseUrl : `http://${baseUrl}`;

  useEffect(() => {
    if (preferredCamera === 'front' || preferredCamera === 'back') {
      setSelectedCamera(preferredCamera);
    }
  }, [preferredCamera]);

  // ── Init ────────────────────────────────────────────────────────────────
  useEffect(() => {
    (async () => {
      try {
        const cameraModule = NativeModules.CameraModule as any;
        const nativeInfo = cameraModule?.checkCameraAvailability
          ? await cameraModule.checkCameraAvailability()
          : null;
        const nativeAvailable = nativeInfo?.available === true && nativeInfo?.cameraPermissionGranted === true;

        const perm = await ImagePicker.requestCameraPermissionsAsync();
        if (!perm.granted || !nativeAvailable) {
          setPhase('fallback');
          setInstrTitle('Caméra live indisponible');
          setInstrSub('Utilise l’appareil photo du téléphone pour continuer');
          return;
        }
      } catch (err) {
        setPhase('fallback');
        setInstrTitle('Caméra live indisponible');
        setInstrSub('Utilise l’appareil photo du téléphone pour continuer');
        return;
      }

      setPhase('capture');
      setInstrTitle(STEPS[0].label);
      setInstrSub('Placez votre visage dans l\'oval');
    })();
  }, []);

  // ── Hold logic ──────────────────────────────────────────────────────────
  const resetHold = useCallback(() => {
    if (holdTimerRef.current) {
      clearInterval(holdTimerRef.current);
      holdTimerRef.current = null;
    }
    isHoldingRef.current = false;
    holdProgressRef.current = 0;
    setHoldPct(0);
    setShowHold(false);
  }, []);

  const startHold = useCallback(() => {
    if (isHoldingRef.current || doneRef.current || !cameraReady) return;
    isHoldingRef.current = true;
    setShowHold(true);
    holdProgressRef.current = 0;

    holdTimerRef.current = setInterval(() => {
      holdProgressRef.current += TICK_MS;
      setHoldPct((holdProgressRef.current / HOLD_MS) * 100);

      if (holdProgressRef.current >= HOLD_MS) {
        clearInterval(holdTimerRef.current!);
        holdTimerRef.current = null;
        autoCapture();
      }
    }, TICK_MS);
  }, [cameraReady]);

  // ── Traitement commun d'une photo capturée (live ou secours) ──────────
  const handleCapturedPhoto = useCallback(async (uri: string) => {
    try {
      resetHold();
      setOvalColor('green');
      doneRef.current = true;
      setPhase('uploading');
      setInstrTitle('Analyse en cours…');
      setInstrSub('Capture du visage et calcul du score Rekognition AWS');
      setStepStates(['done', 'idle', 'idle']);

      const verifyFd = new FormData();
      verifyFd.append('video_frame', {
        uri,
        type: 'image/jpeg',
        name: 'live-front.jpg',
      } as any);
      verifyFd.append('recto_path', rectoPath || '');

      const verifyRes = await fetch(`${apiBase}/api/dossiers/verify-face-realtime`, {
        method: 'POST',
        body: verifyFd,
      });

      if (!verifyRes.ok) {
        throw new Error(`Vérification échouée (${verifyRes.status})`);
      }

      const verifyData = await verifyRes.json();
      if (!verifyData?.success) {
        throw new Error(verifyData?.message || 'Échec de la vérification');
      }

      const completeFd = new FormData();
      completeFd.append('video_frame', {
        uri,
        type: 'image/jpeg',
        name: 'live-front.jpg',
      } as any);
      completeFd.append('dossier_id', dossierId || '');
      completeFd.append('numero_mtn', String(numeroMtn || '').replace(/\D/g, ''));
      completeFd.append('wa_agent', waAgent || numeroAgent || '');
      completeFd.append('username_agent', waAgent || numeroAgent || '');
      completeFd.append('fonction_agent', fonctionAgent || '');
      completeFd.append('zone_agent', zoneAgent || '');
      completeFd.append('country', country || '');
      completeFd.append('recto_path', rectoPath || '');
      completeFd.append('verso_path', versoPath || '');
      completeFd.append('score_visage', verifyData.score != null ? String(verifyData.score) : '');
      completeFd.append('visage_match', verifyData.match ? '1' : '0');
      completeFd.append('visage_motif', verifyData.motif || 'verification_live');

      const completeRes = await fetch(`${apiBase}/api/dossiers/complete-with-face-verify`, {
        method: 'POST',
        body: completeFd,
      });

      if (!completeRes.ok) {
        throw new Error(`Finalisation échouée (${completeRes.status})`);
      }

      const completeData = await completeRes.json();
      setPhase('done');
      setResult({ message: completeData?.message || verifyData?.message || 'Dossier validé avec succès !' });
      setInstrTitle('✓ Vérification enregistrée');
      setInstrSub('Le score facial a été recueilli et le dossier a été finalisé');

      setTimeout(() => {
        navigation.navigate('Idle');
      }, 2200);
    } catch (err: any) {
      liveFailuresRef.current += 1;
      setErrMsg(err.message || "Erreur d'analyse faciale");
      setPhase('error');
    }
  }, [apiBase, country, dossierId, fonctionAgent, navigation, numeroAgent, numeroMtn, rectoPath, resetHold, versoPath, waAgent, zoneAgent]);

  // ── Auto-capture (caméra live) ─────────────────────────────────────────
  const autoCapture = useCallback(async () => {
    if (!cameraRef.current || doneRef.current) return;

    try {
      if (flashRef.current) {
        flashRef.current.setNativeProps({ opacity: 0.8 });
        setTimeout(() => {
          if (flashRef.current) flashRef.current.setNativeProps({ opacity: 0 });
        }, 150);
      }

      // `fixOrientation` n'existe pas dans expo-camera : l'orientation est
      // déjà correctement gérée via les métadonnées EXIF de la photo.
      const photo = await cameraRef.current.takePictureAsync({
        quality: 0.92,
        base64: true,
      });

      if (!photo?.uri) {
        throw new Error('Échec de la capture');
      }

      await handleCapturedPhoto(photo.uri);
    } catch (err: any) {
      liveFailuresRef.current += 1;
      resetHold();

      // Après plusieurs échecs de la caméra live, on bascule automatiquement
      // sur la caméra de secours plutôt que de bloquer l'agent sur le terrain.
      if (liveFailuresRef.current >= MAX_LIVE_FAILURES) {
        setPhase('fallback');
        setInstrTitle('Caméra live instable');
        setInstrSub('Utilise l\u2019appareil photo du téléphone pour continuer');
      } else {
        setErrMsg(err.message || "Erreur d'analyse faciale");
        setPhase('error');
      }
    }
  }, [handleCapturedPhoto, resetHold]);

  // ── Capture de secours (appareil photo natif via expo-image-picker) ────
  const captureFallback = useCallback(async () => {
    try {
      const perm = await ImagePicker.requestCameraPermissionsAsync();
      if (!perm.granted) {
        setErrMsg('Autorisation caméra refusée. Active-la dans les réglages du téléphone.');
        setPhase('error');
        return;
      }

      const res = await ImagePicker.launchCameraAsync({
        cameraType: selectedCamera === 'front' ? ImagePicker.CameraType.front : ImagePicker.CameraType.back,
        quality: 0.92,
        base64: false,
        allowsEditing: false,
      });

      if (res.canceled || !res.assets?.[0]?.uri) {
        return;
      }

      doneRef.current = false;
      await handleCapturedPhoto(res.assets[0].uri);
    } catch (err: any) {
      setErrMsg(err.message || "Erreur de la caméra de secours");
      setPhase('error');
    }
  }, [handleCapturedPhoto, selectedCamera]);

  // ── Handlers ────────────────────────────────────────────────────────────
  const [arrow, setArrow] = useState<string | null>(null);

  return (
    <SafeAreaView style={s.root}>
      <StatusBar barStyle="dark-content" backgroundColor={C.bg0} />

      {/* ── Caméra live ─────────────────────────────────────────────────── */}
      {phase === 'capture' && (
        <Camera
          ref={cameraRef}
          style={s.camera}
          type={selectedCamera === 'front' ? CameraType.front : CameraType.back}
          onCameraReady={() => setCameraReady(true)}
        />
      )}

      {/* ── Flash ───────────────────────────────────────────────────────── */}
      <View
        ref={flashRef}
        style={[s.flash]}
        pointerEvents="none"
      />

      {/* ── Overlay UI (caméra live) ────────────────────────────────────── */}
      {phase === 'capture' && (
        <View style={s.overlay}>
          {/* Header */}
          <View style={s.header}>
            <TouchableOpacity
              style={s.closeBtn}
              onPress={() => navigation.goBack()}
            >
              <Text style={s.closeTxt}>✕</Text>
            </TouchableOpacity>
            <Text style={s.headerTitle}>Vérification faciale</Text>
            <View style={s.cameraSwitchRow}>
              <TouchableOpacity
                style={[s.cameraSwitchBtn, selectedCamera === 'front' && s.cameraSwitchBtnActive]}
                onPress={() => {
                  setSelectedCamera('front');
                  setPreferredCamera('front');
                }}
              >
                <Text style={[s.cameraSwitchTxt, selectedCamera === 'front' && s.cameraSwitchTxtActive]}>Avant</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[s.cameraSwitchBtn, selectedCamera === 'back' && s.cameraSwitchBtnActive]}
                onPress={() => {
                  setSelectedCamera('back');
                  setPreferredCamera('back');
                }}
              >
                <Text style={[s.cameraSwitchTxt, selectedCamera === 'back' && s.cameraSwitchTxtActive]}>Arrière</Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Stepper */}
          <View style={s.stepper}>
            {STEPS.map((step, i) => (
              <View key={step.id} style={s.stepItem}>
                <View
                  style={[
                    s.stepDot,
                    stepStates[i] === 'done'
                      ? s.stepDone
                      : stepStates[i] === 'active'
                      ? s.stepActive
                      : s.stepIdle,
                  ]}
                >
                  <Text style={s.stepIcon}>{step.icon}</Text>
                </View>
                <Text
                  style={[
                    s.stepLabel,
                    stepStates[i] === 'active' && s.stepLabelActive,
                  ]}
                >
                  {step.label}
                </Text>
              </View>
            ))}
          </View>

          {/* Instructions */}
          <View style={s.instrBox}>
            <Text style={s.instrTitle}>{instrTitle}</Text>
            <Text style={s.instrSub}>{instrSub}</Text>
          </View>

          {/* Oval avec couleur */}
          <View style={s.ovalContainer}>
            <View
              style={[
                s.oval,
                ovalColor === 'green'
                  ? s.ovalGreen
                  : ovalColor === 'red'
                  ? s.ovalRed
                  : ovalColor === 'yellow'
                  ? s.ovalYellow
                  : s.ovalGrey,
              ]}
            />
            {arrow && <Text style={s.arrow}>{arrow}</Text>}
          </View>

          {/* Hold bar */}
          {showHold && (
            <View style={s.holdBarContainer}>
              <View style={[s.holdBar, { width: `${holdPct}%` }]} />
            </View>
          )}

          {/* Controls */}
          <View style={s.controls}>
            <TouchableOpacity
              style={s.captureBtn}
              onPress={startHold}
              onLongPress={startHold}
              disabled={!cameraReady}
            >
              <Text style={s.captureTxt}>
                {cameraReady ? 'Maintenir pour capturer en live' : 'Préparation caméra…'}
              </Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={s.fallbackLink}
              onPress={() => setPhase('fallback')}
            >
              <Text style={s.fallbackLinkTxt}>Problème avec la caméra ? Utiliser l'appareil photo</Text>
            </TouchableOpacity>
          </View>
        </View>
      )}

      {/* ── Caméra de secours ───────────────────────────────────────────── */}
      {phase === 'fallback' && (
        <View style={s.messageBox}>
          <Text style={s.instrTitle}>{instrTitle}</Text>
          <Text style={[s.instrSub, { marginBottom: 24, textAlign: 'center' }]}>{instrSub}</Text>
          <TouchableOpacity style={s.retryBtn} onPress={captureFallback}>
            <Text style={s.retryTxt}>Ouvrir l'appareil photo</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.fallbackLink, { marginTop: 20 }]}
            onPress={() => {
              liveFailuresRef.current = 0;
              setPhase('capture');
              setCameraReady(false);
            }}
          >
            <Text style={s.fallbackLinkTxt}>Réessayer la caméra live</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Loading/Uploading ───────────────────────────────────────────── */}
      {phase === 'uploading' && (
        <View style={s.messageBox}>
          <ActivityIndicator size="large" color={C.yellow} />
          <Text style={s.messageTxt}>{instrSub}</Text>
        </View>
      )}

      {/* ── Error ───────────────────────────────────────────────────────── */}
      {phase === 'error' && (
        <View style={s.messageBox}>
          <Text style={s.errorTxt}>{errMsg}</Text>
          <TouchableOpacity
            style={s.retryBtn}
            onPress={() => {
              doneRef.current = false;
              setPhase('capture');
              setCameraReady(false);
              setStepStates(['active', 'idle', 'idle']);
              setOvalColor('grey');
              setInstrTitle(STEPS[0].label);
              setInstrSub("Placez votre visage dans l'oval");
            }}
          >
            <Text style={s.retryTxt}>Recommencer</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[s.fallbackLink, { marginTop: 16 }]}
            onPress={() => setPhase('fallback')}
          >
            <Text style={s.fallbackLinkTxt}>Utiliser l'appareil photo à la place</Text>
          </TouchableOpacity>
        </View>
      )}

      {/* ── Done ────────────────────────────────────────────────────────── */}
      {phase === 'done' && (
        <View style={s.messageBox}>
          <Text style={s.successIcon}>✓</Text>
          <Text style={s.successTxt}>{result?.message}</Text>
        </View>
      )}
    </SafeAreaView>
  );
}

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.bg0 },
  camera: { flex: 1 },
  flash: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: 'rgba(255, 255, 255, 0)',
    opacity: 0,
  },
  overlay: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: 'column',
    justifyContent: 'space-between',
    paddingBottom: 20,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingHorizontal: 20,
    paddingTop: 16,
    paddingBottom: 12,
  },
  cameraSwitchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  cameraSwitchBtn: {
    paddingHorizontal: 10,
    paddingVertical: 6,
    borderRadius: 999,
    backgroundColor: 'rgba(255,255,255,0.9)',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.12)',
  },
  cameraSwitchBtnActive: {
    backgroundColor: C.blue,
    borderColor: C.blue,
  },
  cameraSwitchTxt: {
    color: C.ink,
    fontSize: 12,
    fontWeight: '700',
  },
  cameraSwitchTxtActive: {
    color: '#fff',
  },
  closeBtn: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    shadowColor: '#0F1720',
    shadowOpacity: 0.1,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 4,
  },
  closeTxt: { fontSize: 20, fontWeight: '700', color: C.ink },
  headerTitle: {
    fontSize: T.base,
    fontWeight: '900',
    color: 'rgba(255, 255, 255, 0.98)',
    textShadowColor: 'rgba(0, 0, 0, 0.3)',
    textShadowOffset: { width: 0, height: 2 },
    textShadowRadius: 4,
  },
  stepper: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 20,
    paddingHorizontal: 20,
    paddingVertical: 12,
    backgroundColor: 'rgba(0, 0, 0, 0.15)',
    borderRadius: R.lg,
    marginHorizontal: 20,
  },
  stepItem: { alignItems: 'center', gap: 8 },
  stepDot: {
    width: 60,
    height: 60,
    borderRadius: 30,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
  },
  stepIdle: {
    backgroundColor: 'rgba(255, 255, 255, 0.1)',
    borderColor: 'rgba(255, 255, 255, 0.2)',
  },
  stepActive: {
    backgroundColor: C.yellow,
    borderColor: C.yellow,
  },
  stepDone: {
    backgroundColor: 'rgba(76, 175, 80, 0.8)',
    borderColor: 'rgba(76, 175, 80, 0.95)',
  },
  stepIcon: { fontSize: 24 },
  stepLabel: {
    fontSize: T.xs,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.6)',
  },
  stepLabelActive: {
    color: C.yellow,
  },
  instrBox: {
    alignItems: 'center',
    paddingVertical: 16,
  },
  instrTitle: {
    fontSize: T.lg,
    fontWeight: '800',
    color: 'rgba(255, 255, 255, 0.98)',
    marginBottom: 4,
  },
  instrSub: {
    fontSize: T.sm,
    color: 'rgba(255, 255, 255, 0.7)',
  },
  ovalContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  oval: {
    width: 180,
    height: 220,
    borderRadius: 90,
    borderWidth: 3,
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  ovalGrey: {
    borderColor: 'rgba(255, 255, 255, 0.3)',
  },
  ovalYellow: {
    borderColor: C.yellow,
  },
  ovalGreen: {
    borderColor: 'rgba(76, 175, 80, 0.9)',
  },
  ovalRed: {
    borderColor: 'rgba(244, 67, 54, 0.9)',
  },
  arrow: {
    fontSize: 40,
    fontWeight: '600',
    color: C.yellow,
    marginTop: 12,
  },
  holdBarContainer: {
    height: 4,
    backgroundColor: 'rgba(255, 255, 255, 0.15)',
    borderRadius: 2,
    marginHorizontal: 40,
    overflow: 'hidden',
  },
  holdBar: {
    height: '100%',
    backgroundColor: C.yellow,
  },
  controls: {
    alignItems: 'center',
    paddingBottom: 16,
    gap: 12,
  },
  captureBtn: {
    paddingVertical: 14,
    paddingHorizontal: 24,
    backgroundColor: 'rgba(255, 255, 255, 0.95)',
    borderRadius: R.pill,
    borderWidth: 1,
    borderColor: 'rgba(15, 23, 42, 0.08)',
    alignItems: 'center',
  },
  captureTxt: {
    fontSize: T.sm,
    fontWeight: '700',
    color: C.ink,
  },
  fallbackLink: {
    paddingVertical: 8,
    paddingHorizontal: 16,
  },
  fallbackLinkTxt: {
    fontSize: T.xs,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.85)',
    textDecorationLine: 'underline',
  },
  messageBox: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 24,
  },
  messageTxt: {
    marginTop: 16,
    fontSize: T.base,
    color: 'rgba(255, 255, 255, 0.8)',
    textAlign: 'center',
  },
  errorTxt: {
    fontSize: T.base,
    color: 'rgba(244, 67, 54, 0.9)',
    textAlign: 'center',
  },
  retryBtn: {
    marginTop: 20,
    paddingVertical: 12,
    paddingHorizontal: 28,
    backgroundColor: C.yellow,
    borderRadius: R.lg,
    shadowColor: C.shadowYellow,
    shadowOpacity: 0.24,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
  },
  retryTxt: {
    fontSize: T.sm,
    fontWeight: '700',
    color: C.blue,
  },
  successIcon: {
    fontSize: 60,
    fontWeight: '800',
    color: 'rgba(76, 175, 80, 0.9)',
    marginBottom: 12,
  },
  successTxt: {
    fontSize: T.base,
    fontWeight: '600',
    color: 'rgba(255, 255, 255, 0.9)',
    textAlign: 'center',
  },
});