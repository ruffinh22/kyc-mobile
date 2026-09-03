// ============================================================================
// FaceVerifyInteractivePage – Vérification faciale interactive
// Comportement identique à face-verify-interactive-v2.html :
//   • Caméra frontale (user)
//   • MediaPipe Face Mesh pour détection du yaw (orientation tête)
//   • 3 étapes auto-capturées : Face / Gauche / Droite
//   • Hold-bar 1s avant auto-capture
//   • Flash blanc à la capture
//   • Upload capture[0] vers /api/dossiers/verify-face-realtime (AWS Rekognition)
//   • Puis POST /api/dossiers/complete-with-face-verify pour créer le dossier
//   • Validation manuelle uniquement (tous les dossiers restent en_attente)
// ============================================================================

import { useEffect, useRef, useState, useCallback } from 'react';
import { completeWithFaceVerify, verifyFaceRealtime } from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────────

type StepState = 'idle' | 'active' | 'done';
type PoseDir   = 'center' | 'left' | 'right';
type OvalColor = 'grey' | 'yellow' | 'green' | 'red';

interface Step {
  id:    number;
  label: string;
  dir:   PoseDir;
  icon:  string;
  arrow: string | null;
  range: [number, number];
}

interface Capture { blob: Blob; dataUrl: string }

// ── Constantes ─────────────────────────────────────────────────────────────────

const STEPS: Step[] = [
  { id: 0, label: 'Face',   dir: 'center', icon: '😐', arrow: null, range: [-0.18,  0.18] },
  { id: 1, label: 'Gauche', dir: 'left',   icon: '↩️', arrow: '←', range: [-0.45, -0.15] },
  { id: 2, label: 'Droite', dir: 'right',  icon: '↪️', arrow: '→', range: [ 0.15,  0.45] },
];

const HOLD_MS  = 1000;
const TICK_MS  = 50;

// ── URL params ─────────────────────────────────────────────────────────────────

function getParams() {
  const p = new URLSearchParams(window.location.search);
  return {
    session:     p.get('session')     ?? '',
    dossier_id:  p.get('dossier_id')  ?? '',
    recto:       p.get('recto')       ?? '',
    verso:       p.get('verso')       ?? '',
    numero:      p.get('numero')      ?? '',
    wa:          p.get('wa')          ?? '',
    username:    p.get('username')    ?? '',
    fonction:    p.get('fonction')    ?? '',
    zone:        p.get('zone')        ?? '',
    country:     p.get('country')     ?? '',
  };
}

// ── Composant principal ────────────────────────────────────────────────────────

export function FaceVerifyInteractivePage() {
  const P = getParams();

  // Refs vidéo / canvas
  const videoRef   = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const captureRef = useRef<HTMLCanvasElement>(document.createElement('canvas'));
  const flashRef   = useRef<HTMLDivElement>(null);

  // Refs état temps réel (pas de re-render pour les frames)
  const currentStepRef  = useRef(0);
  const capturesRef     = useRef<Capture[]>([]);
  const holdTimerRef    = useRef<ReturnType<typeof setInterval> | null>(null);
  const holdProgressRef = useRef(0);
  const isHoldingRef    = useRef(false);
  const lastYawRef      = useRef(0);
  const faceDetRef      = useRef(false);
  const animFrameRef    = useRef<number>(0);
  const faceMeshRef     = useRef<unknown>(null);
  const doneRef         = useRef(false);

  // State UI
  const [stepStates, setStepStates] = useState<StepState[]>(['active', 'idle', 'idle']);
  const [thumbs, setThumbs]         = useState<(string | null)[]>([null, null, null]);
  const [ovalColor, setOvalColor]   = useState<OvalColor>('grey');
  const [ovalPulse, setOvalPulse]   = useState(false);
  const [holdPct, setHoldPct]       = useState(0);
  const [showHold, setShowHold]     = useState(false);
  const [instrTitle, setInstrTitle] = useState('Initialisation…');
  const [instrSub, setInstrSub]     = useState('Chargement de la caméra');
  const [instrState, setInstrState] = useState<'waiting' | 'locked' | 'success'>('waiting');
  const [arrow, setArrow]           = useState<string | null>(null);
  const [errMsg, setErrMsg]         = useState('');
  const [result, setResult]         = useState<{ score: number | null; msg: string; motif?: string } | null>(null);
  const [phase, setPhase]           = useState<'init' | 'capture' | 'verif' | 'done' | 'error'>('init');
  const [creating, setCreating]     = useState(false);

  // ── Step UI helpers ────────────────────────────────────────────────────────

  const setInstruction = useCallback((title: string, sub: string, state: 'waiting' | 'locked' | 'success') => {
    setInstrTitle(title); setInstrSub(sub); setInstrState(state);
  }, []);

  const advanceStepUI = useCallback((done: number, next: number) => {
    setStepStates(prev => {
      const s = [...prev] as StepState[];
      s[done] = 'done';
      if (next < STEPS.length) s[next] = 'active';
      return s;
    });
  }, []);

  // ── Hold logic ─────────────────────────────────────────────────────────────

  const resetHold = useCallback(() => {
    if (holdTimerRef.current) { clearInterval(holdTimerRef.current); holdTimerRef.current = null; }
    isHoldingRef.current    = false;
    holdProgressRef.current = 0;
    setHoldPct(0); setShowHold(false);
  }, []);

  // ── Auto-capture ───────────────────────────────────────────────────────────

  const autoCapture = useCallback(async () => {
    const vid = videoRef.current;
    if (!vid || !vid.videoWidth) return;

    // Flash
    if (flashRef.current) {
      flashRef.current.style.opacity = '0.8';
      setTimeout(() => { if (flashRef.current) flashRef.current.style.opacity = '0'; }, 150);
    }

    const fc = captureRef.current;
    fc.width  = vid.videoWidth;
    fc.height = vid.videoHeight;
    const ctx = fc.getContext('2d')!;
    // Dé-miroir (CSS scaleX(-1) → on re-flip pour le JPEG final)
    ctx.save();
    ctx.translate(fc.width, 0);
    ctx.scale(-1, 1);
    ctx.drawImage(vid, 0, 0, fc.width, fc.height);
    ctx.restore();

    const dataUrl = fc.toDataURL('image/jpeg', 0.92);
    const blob    = await new Promise<Blob>(res => fc.toBlob(res as BlobCallback, 'image/jpeg', 0.92));

    const step = currentStepRef.current;
    capturesRef.current.push({ blob, dataUrl });

    // Update thumb
    setThumbs(t => { const n = [...t]; n[step] = dataUrl; return n; });

    advanceStepUI(step, step + 1);
    currentStepRef.current++;
    resetHold();

    if (currentStepRef.current < STEPS.length) {
      const next = STEPS[currentStepRef.current];
      setArrow(next.arrow);
      setInstruction(outOfRangeTitle(next), outOfRangeSub(next), 'waiting');
      setOvalColor('grey'); setOvalPulse(false);
    } else {
      // Toutes les captures faites → verif
      doneRef.current = true;
      setArrow(null); setOvalColor('green'); setOvalPulse(false);
      setInstruction('📤 Envoi en cours…', 'Comparaison avec la CNI…', 'success');
      setPhase('verif');
      cancelAnimationFrame(animFrameRef.current);
      await verifyAPI();
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [advanceStepUI, resetHold, setInstruction]);

  const startHold = useCallback(() => {
    if (isHoldingRef.current) return;
    isHoldingRef.current = true;
    holdProgressRef.current = 0;
    setShowHold(true);
    holdTimerRef.current = setInterval(() => {
      holdProgressRef.current += TICK_MS;
      const pct = Math.min((holdProgressRef.current / HOLD_MS) * 100, 100);
      setHoldPct(pct);
      if (holdProgressRef.current >= HOLD_MS) {
        clearInterval(holdTimerRef.current!); holdTimerRef.current = null;
        autoCapture();
      }
    }, TICK_MS);
  }, [autoCapture]);

  // ── Pose processor ─────────────────────────────────────────────────────────

  const processPose = useCallback(() => {
    if (doneRef.current) return;
    const step  = STEPS[currentStepRef.current];
    const [mn, mx] = step.range;
    const inRange   = faceDetRef.current && lastYawRef.current >= mn && lastYawRef.current <= mx;

    if (!faceDetRef.current) {
      setOvalColor('red'); setOvalPulse(false);
      setInstruction('Visage non détecté', 'Rapprochez-vous et centrez votre visage dans l\'ovale.', 'waiting');
      setShowHold(false); resetHold(); return;
    }

    if (inRange) {
      setOvalColor('green');
      setOvalPulse(isHoldingRef.current);
      setInstruction(inRangeTitle(step), 'Maintenez immobile…', isHoldingRef.current ? 'success' : 'locked');
      if (!isHoldingRef.current) startHold();
    } else {
      setOvalColor('yellow'); setOvalPulse(false);
      setInstruction(outOfRangeTitle(step), outOfRangeSub(step), 'locked');
      resetHold();
    }
  }, [resetHold, startHold, setInstruction]);

  // ── Frame loop ─────────────────────────────────────────────────────────────

  const tick = useCallback(async () => {
    const fm  = faceMeshRef.current as { send: (o: { image: HTMLVideoElement }) => Promise<void> } | null;
    const vid = videoRef.current;
    if (fm && vid && vid.readyState >= 2) {
      try {
        await fm.send({ image: vid });
      } catch (err) {
        console.warn('[KYC] MediaPipe send failed:', err);
      }
    }
    processPose();
    animFrameRef.current = requestAnimationFrame(tick);
  }, [processPose]);

  // ── Init MediaPipe ─────────────────────────────────────────────────────────

  const initFaceMesh = useCallback((): Promise<void> => {
    return new Promise(resolve => {
      const win = window as unknown as Record<string, unknown>;
      const FaceMesh = win['FaceMesh'] as new (opts: { locateFile: (f: string) => string }) => {
        setOptions: (o: unknown) => void;
        onResults: (cb: (r: { multiFaceLandmarks?: { x: number; y: number }[][] }) => void) => void;
      };
      if (!FaceMesh) { resolve(); return; }

      const fm = new FaceMesh({
        locateFile: (f: string) => `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`,
      });
      fm.setOptions({
        maxNumFaces: 1, refineLandmarks: false,
        minDetectionConfidence: 0.6, minTrackingConfidence: 0.5,
      });
      fm.onResults((results) => {
        if (results.multiFaceLandmarks?.length) {
          const lm    = results.multiFaceLandmarks[0];
          const leftX = lm[234].x, rightX = lm[454].x;
          const faceW = Math.abs(leftX - rightX);
          const noseX = lm[1].x;
          const centerX = (leftX + rightX) / 2;
          lastYawRef.current = faceW > 0.01 ? (noseX - centerX) / faceW : 0;
          faceDetRef.current = true;
        } else {
          faceDetRef.current = true;
          lastYawRef.current = 0;
        }
      });
      faceMeshRef.current = fm;
      resolve();
    });
  }, []);

  // ── API : verify ───────────────────────────────────────────────────────────

  const verifyAPI = useCallback(async () => {
    try {
      const data = await verifyFaceRealtime(capturesRef.current[0].blob, P.recto);

      if (data.success) {
        const motif = (data as any).motif as string | undefined;
        const awsConfigured = (data as any).aws_configured as boolean | undefined;
        const scoreFromApi = typeof data.score === 'number' ? data.score : null;

        // Treat as unavailable when backend explicitly says so, when score is null,
        // or when an Rekognition error occurred.
        const unavailable = awsConfigured === false || scoreFromApi === null || (motif && motif.startsWith('erreur_rekognition'));
        if (unavailable) {
          setResult({ score: null, msg: data.message ?? 'Score non disponible (AWS non configuré).', motif });
        } else {
          setResult({ score: scoreFromApi, msg: data.message ?? '', motif });
        }
        setInstruction('✅ Vérification enregistrée', 'Vous pouvez créer le dossier. Un agent validera manuellement.', 'success');
        setPhase('done');
      } else {
        setErrMsg(data.message ?? 'Erreur lors de la vérification');
        setPhase('error');
      }
    } catch (e: unknown) {
      setErrMsg('Erreur réseau : ' + (e instanceof Error ? e.message : String(e)));
      setPhase('error');
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [setInstruction, P.recto]);

  // ── API : create dossier ───────────────────────────────────────────────────

  const createDossier = useCallback(async () => {
    if (creating) return;
    setCreating(true);

    try {
      const fd = new FormData();
      fd.append('video_frame',    capturesRef.current[0].blob, 'live-front.jpg');
      fd.append('dossier_id',     P.dossier_id);
      fd.append('numero_mtn',     P.numero.replace(/\D/g, ''));
      fd.append('wa_agent',       P.wa);
      fd.append('username_agent', P.username);
      fd.append('fonction_agent', P.fonction);
      fd.append('zone_agent',     P.zone);
      fd.append('country',        P.country);
      fd.append('recto_path',     P.recto);
      fd.append('verso_path',     P.verso);
      fd.append('score_visage',   result?.score != null ? String(result.score) : '');
      fd.append('visage_match',   result?.score != null ? String(result.score >= 70 ? 1 : 0) : '');
      fd.append('visage_motif',   'verification_manuelle_interactive');

      const data = await completeWithFaceVerify(fd);

      if (data.success) {
        setInstruction('🎉 Dossier créé !', `ID : ${data.id} — redirection…`, 'success');
        setTimeout(() => { window.location.href = '/acquisition'; }, 2500);
      } else {
        setErrMsg(data.message ?? 'Erreur création dossier');
        setCreating(false);
      }
    } catch (e: unknown) {
      setErrMsg('Erreur réseau : ' + (e instanceof Error ? e.message : String(e)));
      setCreating(false);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [creating, result, setInstruction, P]);

  // ── Retry ──────────────────────────────────────────────────────────────────

  const retryAll = useCallback(() => {
    cancelAnimationFrame(animFrameRef.current);
    resetHold();
    currentStepRef.current  = 0;
    capturesRef.current     = [];
    doneRef.current         = false;
    isHoldingRef.current    = false;
    holdProgressRef.current = 0;
    lastYawRef.current      = 0;
    faceDetRef.current      = false;

    setStepStates(['active', 'idle', 'idle']);
    setThumbs([null, null, null]);
    setOvalColor('grey'); setOvalPulse(false);
    setHoldPct(0); setShowHold(false);
    setArrow(null);
    setResult(null); setErrMsg('');
    setCreating(false);
    setPhase('capture');
    setInstruction('😐 Regardez droit devant vous', 'Centrez votre visage dans l\'ovale.', 'waiting');

    animFrameRef.current = requestAnimationFrame(tick);
  }, [resetHold, setInstruction, tick]);

  // ── Init principal ─────────────────────────────────────────────────────────

  useEffect(() => {
    let stopped = false;

    // Injecter les scripts MediaPipe si absents
    const injectScript = (src: string) => new Promise<void>((res, rej) => {
      if (document.querySelector(`script[src="${src}"]`)) { res(); return; }
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = () => res(); s.onerror = () => rej(new Error('Script load fail: ' + src));
      document.head.appendChild(s);
    });

    const run = async () => {
      if (!P.recto || !P.numero) {
        setErrMsg('Session incomplète — données de l\'étape 1 manquantes. Revenez en arrière.');
        setInstruction('Erreur de session', 'Données manquantes.', 'waiting');
        setPhase('error'); return;
      }

      setInstruction('Chargement…', 'Initialisation caméra et modèle IA…', 'waiting');

      // Caméra
      try {
        const stream = await navigator.mediaDevices.getUserMedia({
          video: { width: { ideal: 1280 }, height: { ideal: 720 }, facingMode: 'user' },
        });
        if (stopped) { stream.getTracks().forEach(t => t.stop()); return; }
        videoRef.current!.srcObject = stream;
        await new Promise<void>(res => { videoRef.current!.onloadedmetadata = () => res(); });
        videoRef.current!.play();
        if (overlayRef.current) {
          overlayRef.current.width  = videoRef.current!.videoWidth  || 640;
          overlayRef.current.height = videoRef.current!.videoHeight || 480;
        }
      } catch (e: unknown) {
        const err = e as { name?: string };
        let msg = 'Erreur caméra. Autorisez l\'accès.';
        if (err.name === 'NotAllowedError')    msg = 'Accès caméra refusé — autorisez dans les paramètres du navigateur.';
        else if (err.name === 'NotFoundError') msg = 'Aucune caméra frontale détectée.';
        setErrMsg(msg); setPhase('error'); return;
      }

      // MediaPipe
      try {
        await injectScript('https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js');
        await injectScript('https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js');
        await initFaceMesh();
        if (!faceMeshRef.current) {
          console.warn('[KYC] MediaPipe chargé mais FaceMesh non disponible — mode dégradé sans détection de pose');
          faceDetRef.current = true;
          lastYawRef.current = 0;
        }
      } catch {
        // MediaPipe indisponible → mode dégradé (yaw = 0 = face toujours valide)
        console.warn('[KYC] MediaPipe non chargé — mode dégradé sans détection de pose');
        faceDetRef.current = true;
      }

      if (stopped) return;

      setPhase('capture');
      setInstruction('😐 Regardez droit devant vous', 'Centrez votre visage dans l\'ovale.', 'waiting');
      animFrameRef.current = requestAnimationFrame(tick);
    };

    run();

    return () => {
      stopped = true;
      cancelAnimationFrame(animFrameRef.current);
      if (holdTimerRef.current) clearInterval(holdTimerRef.current);
      if (videoRef.current?.srcObject) {
        (videoRef.current.srcObject as MediaStream).getTracks().forEach(t => t.stop());
      }
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Oval stroke color ──────────────────────────────────────────────────────
  const ovalStroke = ovalColor === 'green' ? '#22c55e' : ovalColor === 'yellow' ? '#eab308' : ovalColor === 'red' ? '#ef4444' : '#475569';
  const ovalGlow   = ovalColor === 'green' ? '0 0 8px #22c55e' : ovalColor === 'yellow' ? '0 0 6px #eab308' : 'none';

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ background: '#0f172a', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', fontFamily: "'Inter', system-ui, sans-serif", WebkitFontSmoothing: 'antialiased', padding: 16 }}>
      <div style={{ width: '100%', maxWidth: 480 }}>

        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 20 }}>
          <h1 style={{ fontSize: '1.4rem', fontWeight: 700, letterSpacing: '-0.02em', color: '#f8fafc' }}>🔐 Vérification Faciale</h1>
          <p style={{ fontSize: '.78rem', color: '#94a3b8', marginTop: 4 }}>
            {phase === 'init' ? 'Initialisation…' : 'Suivi automatique — suivez les instructions ci-dessous'}
          </p>
        </div>

        {/* Viewfinder */}
        <div style={{ position: 'relative', width: '100%', aspectRatio: '4/3', background: '#000', borderRadius: 20, overflow: 'hidden', marginBottom: 20, boxShadow: '0 0 0 3px #1e293b, 0 0 0 6px #334155' }}>
          <video ref={videoRef} autoPlay muted playsInline style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover', transform: 'scaleX(-1)' }} />
          <canvas ref={overlayRef} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transform: 'scaleX(-1)', pointerEvents: 'none' }} />

          {/* Oval SVG guide */}
          <div style={{ position: 'absolute', inset: 0, display: 'flex', alignItems: 'center', justifyContent: 'center', pointerEvents: 'none' }}>
            <svg style={{ width: '55%', maxWidth: 200, filter: ovalGlow, animation: ovalPulse ? 'ovalPulse .7s ease-in-out infinite' : 'none' }} viewBox="0 0 200 260" fill="none">
              <ellipse cx="100" cy="130" rx="90" ry="120" stroke={ovalStroke} strokeWidth="4" strokeDasharray="8 4" />
            </svg>
          </div>

          {/* Flèche direction tête */}
          {arrow && (
            <div style={{ position: 'absolute', top: '50%', transform: 'translateY(-50%)', [arrow === '←' ? 'left' : 'right']: 10, fontSize: '2.8rem', color: '#fff', filter: 'drop-shadow(0 2px 6px rgba(0,0,0,.8))', pointerEvents: 'none', lineHeight: 1 }}>
              {arrow}
            </div>
          )}

          {/* Flash */}
          <div ref={flashRef} style={{ position: 'absolute', inset: 0, background: '#fff', opacity: 0, pointerEvents: 'none', transition: 'opacity .05s' }} />
        </div>

        {/* Steps */}
        <div style={{ display: 'flex', gap: 10, marginBottom: 18, justifyContent: 'center' }}>
          {STEPS.map((s, i) => (
            <div key={s.id} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, padding: '10px 14px', background: stepStates[i] === 'done' ? '#051a0e' : stepStates[i] === 'active' ? '#1c1a09' : '#1e293b', border: `2px solid ${stepStates[i] === 'done' ? '#22c55e' : stepStates[i] === 'active' ? '#eab308' : '#334155'}`, borderRadius: 14, flex: 1, minWidth: 0 }}>
              <span style={{ fontSize: '1.4rem' }}>{stepStates[i] === 'done' ? '✅' : s.icon}</span>
              <span style={{ fontSize: '.65rem', fontWeight: 600, color: stepStates[i] === 'done' ? '#22c55e' : stepStates[i] === 'active' ? '#eab308' : '#94a3b8', textAlign: 'center', letterSpacing: '.03em', textTransform: 'uppercase' }}>{s.label}</span>
            </div>
          ))}
        </div>

        {/* Instruction banner */}
        <div style={{ background: instrState === 'success' ? '#051a0e' : instrState === 'locked' ? '#1c1a09' : '#1e293b', borderRadius: 14, padding: '14px 18px', textAlign: 'center', marginBottom: 18, border: `2px solid ${instrState === 'success' ? '#22c55e' : instrState === 'locked' ? '#eab308' : '#334155'}` }}>
          <h2 style={{ fontSize: '1rem', fontWeight: 700, marginBottom: 4, color: '#f1f5f9' }}>{instrTitle}</h2>
          <p style={{ fontSize: '.78rem', color: '#94a3b8' }}>{instrSub}</p>
          {showHold && (
            <div style={{ marginTop: 10 }}>
              <div style={{ background: '#334155', borderRadius: 99, height: 6, overflow: 'hidden' }}>
                <div style={{ height: '100%', background: '#22c55e', borderRadius: 99, width: `${holdPct}%`, transition: `width ${TICK_MS}ms linear` }} />
              </div>
            </div>
          )}
        </div>

        {/* Thumbnails */}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'center', marginBottom: 18 }}>
          {STEPS.map((s, i) => (
            <div key={i} style={{ width: 72, height: 54, borderRadius: 10, overflow: 'hidden', border: `2px solid ${thumbs[i] ? '#22c55e' : '#334155'}`, background: '#0f172a', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '1.2rem', color: '#475569' }}>
              {thumbs[i]
                ? <img src={thumbs[i]!} alt={`capture ${i+1}`} style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                : s.icon}
            </div>
          ))}
        </div>

        {/* Erreur */}
        {errMsg && (
          <div style={{ background: '#1a0505', border: '1px solid #ef4444', borderRadius: 10, padding: '10px 14px', fontSize: '.8rem', color: '#fca5a5', marginBottom: 14 }}>
            ⚠️ {errMsg}
          </div>
        )}

        {/* Résultat */}
        {result && phase === 'done' && (
          <div style={{ background: '#051a0e', borderRadius: 16, padding: 18, textAlign: 'center', border: '2px solid #22c55e', marginBottom: 18 }}>
            <h2 style={{ fontSize: '1.1rem', fontWeight: 700, marginBottom: 6, color: '#f1f5f9' }}>✅ Vérification enregistrée</h2>
            <p style={{ fontSize: '.78rem', color: '#94a3b8', marginBottom: 10 }}>{result.msg}</p>
            {result.score != null ? (
              <>
                <div style={{ background: '#334155', borderRadius: 99, height: 10, overflow: 'hidden', marginBottom: 6 }}>
                  <div style={{ height: '100%', background: '#22c55e', borderRadius: 99, width: `${Math.min(result.score, 100)}%`, transition: 'width .6s ease' }} />
                </div>
                <p style={{ fontSize: '.75rem', color: '#94a3b8' }}>Score de similarité : {result.score.toFixed(1)}%</p>
              </>
            ) : (
              <div style={{ fontSize: '.9rem', color: '#94a3b8' }}>Score non disponible (AWS non configuré). La validation sera effectuée manuellement par un agent.</div>
            )}
          </div>
        )}

        {/* CTA */}
        {phase === 'done' && (
          <button
            onClick={createDossier}
            disabled={creating}
            style={{ width: '100%', padding: 15, background: creating ? 'rgba(34,197,94,.4)' : 'linear-gradient(135deg,#22c55e,#16a34a)', color: '#fff', fontWeight: 700, fontSize: '1rem', border: 'none', borderRadius: 14, cursor: creating ? 'not-allowed' : 'pointer', marginBottom: 8, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8 }}
          >
            {creating ? <><Spinner /> Création en cours…</> : '✅ Créer le dossier'}
          </button>
        )}

        {(phase === 'error' || (phase === 'done' && result)) && (
          <button
            onClick={retryAll}
            style={{ width: '100%', padding: 11, background: 'transparent', color: '#64748b', border: '2px solid #334155', borderRadius: 14, cursor: 'pointer', fontSize: '.85rem', fontWeight: 600 }}
          >
            🔄 Recommencer
          </button>
        )}
      </div>

      {/* Animation CSS pulse oval */}
      <style>{`
        @keyframes ovalPulse {
          0%,100% { stroke-opacity:.9; }
          50%      { stroke-opacity:.3; }
        }
      `}</style>
    </div>
  );
}

// ── Spinner ────────────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <span style={{ display: 'inline-block', width: 18, height: 18, border: '3px solid rgba(255,255,255,.2)', borderTopColor: '#fff', borderRadius: '50%', animation: 'spin .6s linear infinite' }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
    </span>
  );
}

// ── Helpers instruction ────────────────────────────────────────────────────────
function inRangeTitle(s: Step) {
  if (s.dir === 'center') return '😐 Parfait — regardez droit devant';
  if (s.dir === 'left')   return '↩️ Bonne position — tête à gauche';
  return '↪️ Bonne position — tête à droite';
}
function outOfRangeTitle(s: Step) {
  if (s.dir === 'center') return '😐 Regardez droit devant vous';
  if (s.dir === 'left')   return '↩️ Inclinez la tête vers la gauche';
  return '↪️ Inclinez la tête vers la droite';
}
function outOfRangeSub(s: Step) {
  if (s.dir === 'center') return 'Centrez votre regard face à la caméra.';
  if (s.dir === 'left')   return 'Tournez doucement la tête vers votre gauche.';
  return 'Tournez doucement la tête vers votre droite.';
}