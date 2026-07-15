// ============================================================================
// AcquisitionPage.tsx — CORRIGÉ
//
// CORRECTIONS :
//   [FIX-1] soumettre() → après succès, appelle maintenant prepareSession()
//           avec l'id retourné par le serveur (pas juste les paths)
//   [FIX-2] prepareSession() passe l'id du dossier dans l'URL → face-verify
//           pourra uploader la photo live via /api/public/dossiers/:id/live
//   [FIX-3] prepareSession() transmet country en plus des autres champs
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { getPublicDossiers } from '../services/api';

// ── Types ──────────────────────────────────────────────────────────────────────

interface PhotoState { file: Blob; preview: string }

interface DossierTerrain {
  id: string; numero_mtn: string; statut: string; date: string;
  heure_reception: string | null; heure_cloture: string | null; raison_rejet: string | null;
  score_visage?: number | null; visage_match?: number | null; visage_motif?: string | null;
}

type Tab = 'form' | 'dash';

interface AgentInfo {
  wa_agent: string; username_agent: string;
  fonction_agent: string; zone_agent: string; country: string;
}

interface QualityResult { ok: boolean; cls: 'ok' | 'warn' | 'bad'; label: string }

// ── Analyse qualité photo ──────────────────────────────────────────────────────

function analyzeQuality(canvas: HTMLCanvasElement): QualityResult {
  const ctx = canvas.getContext('2d');
  if (!ctx) return { ok: false, cls: 'bad', label: '⚠ Erreur analyse' };
  const { width: w, height: h } = canvas;
  const data = ctx.getImageData(0, 0, w, h).data;
  let sum = 0, sumSq = 0;
  const n = w * h;
  for (let i = 0; i < data.length; i += 4) {
    const luma = 0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2];
    sum += luma; sumSq += luma * luma;
  }
  const mean = sum / n;
  const variance = sumSq / n - mean * mean;
  const contrast = Math.sqrt(Math.max(variance, 0));
  const step = 4;
  let lapSum = 0, lapN = 0;
  for (let y = step; y < h - step; y += step) {
    for (let x = step; x < w - step; x += step) {
      const idx = (y * w + x) * 4;
      const c = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
      const t = 0.299 * data[((y - step) * w + x) * 4] + 0.587 * data[((y - step) * w + x) * 4 + 1] + 0.114 * data[((y - step) * w + x) * 4 + 2];
      const b = 0.299 * data[((y + step) * w + x) * 4] + 0.587 * data[((y + step) * w + x) * 4 + 1] + 0.114 * data[((y + step) * w + x) * 4 + 2];
      const l = 0.299 * data[(y * w + x - step) * 4] + 0.587 * data[(y * w + x - step) * 4 + 1] + 0.114 * data[(y * w + x - step) * 4 + 2];
      const r = 0.299 * data[(y * w + x + step) * 4] + 0.587 * data[(y * w + x + step) * 4 + 1] + 0.114 * data[(y * w + x + step) * 4 + 2];
      lapSum += Math.abs(4 * c - t - b - l - r); lapN++;
    }
  }
  const sharpness = lapN > 0 ? lapSum / lapN : 0;
  if (mean < 45)      return { ok: false, cls: 'bad',  label: '⚠ Trop sombre' };
  if (mean > 220)     return { ok: false, cls: 'bad',  label: '⚠ Surexposé' };
  if (sharpness < 4)  return { ok: false, cls: 'warn', label: '⚠ Photo floue' };
  if (contrast < 15)  return { ok: false, cls: 'warn', label: '⚠ Contraste faible' };
  return { ok: true, cls: 'ok', label: '✓ Photo nette' };
}

// ── Config pays ────────────────────────────────────────────────────────────────

const PAYS_CONFIG: Record<string, { digitCount: number; prefix: string; placeholder: string; hint: string }> = {
  CG: { digitCount: 9,  prefix: '0',  placeholder: '06 XXX XXX',      hint: '9 chiffres, commence par 0'  },
  BJ: { digitCount: 10, prefix: '01', placeholder: '01 XX XX XX XX',  hint: '10 chiffres, commence par 01' },
  CI: { digitCount: 10, prefix: '0',  placeholder: '05 XX XX XX XX',  hint: '10 chiffres, commence par 0'  },
  CM: { digitCount: 9,  prefix: '6',  placeholder: '67 XX XX XXX',    hint: '9 chiffres, commence par 6'  },
  GW: { digitCount: 7,  prefix: '9',  placeholder: '96 XX XXX',       hint: '7 chiffres, commence par 9'  },
  GN: { digitCount: 8,  prefix: '6',  placeholder: '61 XX XX XX',     hint: '8 chiffres, commence par 6'  },
};

// ── Composant principal ────────────────────────────────────────────────────────

export function AcquisitionPage() {
  const [tab, setTab]           = useState<Tab>('form');
  const [agent, setAgent]       = useState<AgentInfo | null>(null);
  const [editAgent, setEditAgent] = useState(false);
  const [form, setForm]         = useState({
    wa_agent: '', username_agent: '', fonction_agent: '',
    zone_agent: '', numero_mtn: '', country: '',
  });
  const [photos, setPhotos]     = useState<{ recto: PhotoState | null; verso: PhotoState | null }>({ recto: null, verso: null });
  const [photoErr, setPhotoErr] = useState({ recto: false, verso: false });
  const [loading, setLoading]   = useState(false);
  const [progress, setProgress] = useState(0);
  const [erreur, setErreur]     = useState('');
  const [success, setSuccess]   = useState<string | null>(null);

  // Caméra
  const [camOpen, setCamOpen]     = useState(false);
  const [camType, setCamType]     = useState<'recto' | 'verso'>('recto');
  const [camQuality, setCamQuality] = useState<QualityResult>({ ok: false, cls: 'warn', label: '' });
  const [cameras, setCameras]     = useState<MediaDeviceInfo[]>([]);
  const [selectedCam, setSelectedCam] = useState('');
  const [facingMode, setFacingMode]   = useState<'environment' | 'user'>('environment');
  const streamRef   = useRef<MediaStream | null>(null);
  const videoRef    = useRef<HTMLVideoElement>(null);
  const canvasRef   = useRef<HTMLCanvasElement>(null);
  const qualityTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Preview
  const [preview, setPreview] = useState<{
    open: boolean; type: 'recto' | 'verso'; url: string;
    blob: Blob | null; quality: QualityResult;
  } | null>(null);

  // Dashboard
  const [dossiers, setDossiers]   = useState<DossierTerrain[]>([]);
  const [dashLoading, setDashLoading] = useState(false);
  const [dateDebut, setDateDebut] = useState(new Date().toLocaleDateString('en-CA'));
  const [dateFin, setDateFin]     = useState(new Date().toLocaleDateString('en-CA'));

  // Charger agent mémorisé
  useEffect(() => {
    try {
      const saved = localStorage.getItem('kyc_acq_agent');
      if (saved) {
        const a = JSON.parse(saved) as AgentInfo;
        if (a.wa_agent && a.username_agent && a.fonction_agent && a.zone_agent && a.country) {
          setAgent(a);
          setForm(f => ({ ...f, ...a }));
        }
      }
    } catch { /* ignore */ }
  }, []);

  // ── Helpers ────────────────────────────────────────────────────────────────

  const paysConf = PAYS_CONFIG[form.country] ?? null;

  const formatPhoneLike = (val: string, country: string, maxDigits: number) => {
    const digits = val.replace(/\D/g, '').slice(0, maxDigits);
    if (!digits) return '';
    const groups = country === 'CI' || (country === 'BJ' && maxDigits === 10)
      ? [2, 2, 2, 4]
      : country === 'BJ' || country === 'GN' ? [2, 2, 2, 2]
      : country === 'CM' ? [2, 3, 4]
      : country === 'GW' ? [2, 3, 2]
      : [3, 3, 3];
    const parts: string[] = [];
    let start = 0;
    for (const size of groups) {
      const part = digits.slice(start, start + size);
      if (part) parts.push(part);
      start += size;
    }
    return parts.join(' ');
  };

  const formatNumero   = (val: string) => formatPhoneLike(val, form.country, paysConf?.digitCount ?? 9);
  const formatWaInput  = (val: string) => {
    const digits = val.replace(/\D/g, '').slice(0, paysConf?.digitCount ?? 9);
    return formatPhoneLike(digits, form.country, paysConf?.digitCount ?? 9);
  };

  const nbPhotos     = () => (photos.recto ? 1 : 0) + (photos.verso ? 1 : 0);
  const pct          = () => Math.round(nbPhotos() / 2 * 100);
  const selectedCamLabel = cameras.find(c => c.deviceId === selectedCam)?.label ?? '';
  const previewMirrored = facingMode === 'user' || /front|selfie|avant|user|face/i.test(selectedCamLabel);
  const peutSoumettre = () => {
    const wa  = form.wa_agent.replace(/\D/g, '');
    const num = form.numero_mtn.replace(/\D/g, '');
    const conf = paysConf;
    const waOk = !!conf && wa.length === conf.digitCount;
    return form.country && waOk && form.username_agent && form.fonction_agent &&
           form.zone_agent && conf && num.length === conf.digitCount &&
           photos.recto && photos.verso;
  };

  // ── Caméra ────────────────────────────────────────────────────────────────

  const stopCamera = useCallback(() => {
    if (qualityTimerRef.current) { clearInterval(qualityTimerRef.current); qualityTimerRef.current = null; }
    if (streamRef.current) { streamRef.current.getTracks().forEach(t => t.stop()); streamRef.current = null; }
    setCamQuality({ ok: false, cls: 'warn', label: '' });
  }, []);

  const startCamera = useCallback(async (deviceId?: string, facing?: 'environment' | 'user') => {
    stopCamera();
    if (!navigator.mediaDevices?.getUserMedia) {
      setErreur('Caméra non supportée par ce navigateur.');
      setCamOpen(false); return;
    }
    try {
      const deviceToUse = deviceId || selectedCam || undefined;
      const constraints: MediaStreamConstraints = deviceToUse
        ? { video: { deviceId: { exact: deviceToUse } } }
        : { video: { facingMode: facing ?? 'environment' } };
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia(constraints); }
      catch { stream = await navigator.mediaDevices.getUserMedia({ video: true }); }

      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await new Promise<void>(res => { videoRef.current!.onloadedmetadata = () => res(); });
        videoRef.current.play();
      }

      try {
        const devices = await navigator.mediaDevices.enumerateDevices();
        const vids = devices.filter(d => d.kind === 'videoinput');
        setCameras(vids);
        if (!deviceToUse && vids.length > 0) {
          const back = vids.find(d => /back|rear|environ|arrière|usb|webcam/i.test(d.label));
          setSelectedCam((back ?? vids[0]).deviceId);
        }
      } catch { /* ignore */ }

      if (qualityTimerRef.current) clearInterval(qualityTimerRef.current);
      qualityTimerRef.current = setInterval(() => {
        const vid = videoRef.current;
        const cvs = canvasRef.current;
        if (!vid || !cvs || !vid.videoWidth) return;
        cvs.width = 320; cvs.height = 240;
        const ctx = cvs.getContext('2d')!;
        const vw = vid.videoWidth, vh = vid.videoHeight;
        const cropW = Math.min(vw * 0.9, vh * (85 / 54));
        const cropH = cropW * (54 / 85);
        const sx = (vw - cropW) / 2;
        const sy = (vh - cropH) / 2;
        ctx.drawImage(vid, sx, sy, cropW, cropH, 0, 0, 320, 240);
        setCamQuality(analyzeQuality(cvs));
      }, 600);

    } catch (e: unknown) {
      setCamOpen(false);
      const err = e as { name?: string };
      if (err.name === 'NotAllowedError')       setErreur('Accès caméra refusé. Autorisez l\'accès dans les paramètres.');
      else if (err.name === 'NotFoundError')    setErreur('Caméra introuvable.');
      else if (err.name === 'NotReadableError') setErreur('La caméra est utilisée par une autre application.');
      else setErreur('Impossible d\'accéder à la caméra : ' + (err.name ?? 'erreur inconnue'));
    }
  }, [selectedCam, stopCamera]);

  const ouvrirCamera = useCallback(async (type: 'recto' | 'verso') => {
    setCamType(type); setCamOpen(true); setErreur('');
    await startCamera(selectedCam || undefined, facingMode);
  }, [startCamera, selectedCam, facingMode]);

  const fermerCamera = () => { stopCamera(); setCamOpen(false); };

  const switchCamera = async () => {
    if (cameras.length > 1 && selectedCam) {
      const idx  = cameras.findIndex(c => c.deviceId === selectedCam);
      const next = cameras[(idx + 1) % cameras.length];
      setSelectedCam(next.deviceId);
      await startCamera(next.deviceId);
    } else {
      const newFacing: 'environment' | 'user' = facingMode === 'environment' ? 'user' : 'environment';
      setFacingMode(newFacing);
      setSelectedCam('');
      await startCamera(undefined, newFacing);
    }
  };

  const capturer = async () => {
    const vid = videoRef.current;
    if (!vid || !vid.videoWidth) return;
    const cropAspect = 85 / 54;
    const cropW = Math.min(vid.videoWidth * 0.85, vid.videoHeight * cropAspect);
    const cropH = cropW / cropAspect;
    const sx = Math.round((vid.videoWidth - cropW) / 2);
    const sy = Math.round((vid.videoHeight - cropH) / 2);
    const fc = document.createElement('canvas');
    fc.width = Math.round(cropW);
    fc.height = Math.round(cropH);
    const ctx = fc.getContext('2d')!;
    ctx.drawImage(vid, sx, sy, cropW, cropH, 0, 0, fc.width, fc.height);
    const dataUrl = fc.toDataURL('image/jpeg', .92);
    const blob    = await new Promise<Blob>(res => fc.toBlob(res as BlobCallback, 'image/jpeg', .92));
    const quality = analyzeQuality(fc);
    const t = camType;
    fermerCamera();
    setPreview({ open: true, type: t, url: dataUrl, blob, quality });
  };

  const validerPhoto = () => {
    if (!preview?.blob) return;
    const url = URL.createObjectURL(preview.blob);
    setPhotos(p => ({ ...p, [preview.type]: { file: preview.blob!, preview: url } }));
    setPhotoErr(e => ({ ...e, [preview.type]: false }));
    setPreview(null);
  };

  const rejeterPhoto = () => {
    const t = preview?.type ?? 'recto';
    setPreview(null);
    ouvrirCamera(t);
  };

  // ── Dashboard ─────────────────────────────────────────────────────────────

  const chargerDash = useCallback(async () => {
    const wa = String(form.wa_agent).replace(/\D/g, '');
    if (wa.length !== (paysConf?.digitCount ?? 0)) { setDossiers([]); return; }
    setDashLoading(true);
    try {
      const data = await getPublicDossiers(wa);
      setDossiers((data.dossiers ?? []) as DossierTerrain[]);
    } catch (err) {
      console.error('Erreur chargement dossiers', err);
      setDossiers([]);
    }
    setDashLoading(false);
  }, [form.wa_agent, paysConf]);

  useEffect(() => {
    if (tab === 'dash') {
      chargerDash();
      const t = setInterval(() => chargerDash(), 15000);
      return () => clearInterval(t);
    }
  }, [tab, chargerDash]);

  const normaliserDate = (value: string | null | undefined) => {
    if (!value) return '';
    const text = String(value).trim();
    if (!text) return '';
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) return match[0];
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? '' : parsed.toISOString().slice(0, 10);
  };

  const dossiersFiltres = () => dossiers.filter(d => {
    const dateDossier = normaliserDate(d.date);
    if (!dateDossier) return true;
    if (dateDebut && dateDossier < dateDebut) return false;
    if (dateFin && dateDossier > dateFin) return false;
    return true;
  });

  const statsFiltre = () => {
    const s = { total: 0, en_cours: 0, accepte: 0, rejete: 0 };
    for (const d of dossiersFiltres()) {
      s.total++;
      if (d.statut === 'en_attente' || d.statut === 'en_cours') s.en_cours++;
      else if (d.statut in s) (s as Record<string, number>)[d.statut]++;
    }
    return s;
  };

  // ── [FIX-1] Soumission corrigée ───────────────────────────────────────────
  // Après le succès du POST /api/public/dossiers, on récupère l'id du dossier
  // et on passe à prepareSession() pour que la page face-verify puisse uploader
  // la photo live via /api/public/dossiers/:id/live

  const soumettre = async () => {
    if (!peutSoumettre()) { setErreur('Tous les champs et photos recto/verso sont obligatoires'); return; }
    setErreur(''); setLoading(true); setProgress(0);
    try {
      const fd = new FormData();
      const numDigits = form.numero_mtn.replace(/\D/g, '');
      fd.append('numero_mtn',     numDigits);
      fd.append('country',        form.country);
      fd.append('wa_agent',       form.wa_agent);
      fd.append('username_agent', form.username_agent);
      fd.append('fonction_agent', form.fonction_agent);
      fd.append('zone_agent',     form.zone_agent);
      fd.append('photo_recto',    photos.recto!.file, 'recto.jpg');
      fd.append('photo_verso',    photos.verso!.file, 'verso.jpg');

      const xhr = new XMLHttpRequest();
      xhr.upload.onprogress = e => {
        if (e.lengthComputable) setProgress(Math.round(e.loaded / e.total * 100));
      };
      xhr.onload = () => {
        setLoading(false);
        if (xhr.status >= 200 && xhr.status < 300) {
          const data = JSON.parse(xhr.responseText);

          // [FIX-1] Vérifier la présence de l'id ET des paths
          if (!data.id || !data.recto_path || !data.verso_path) {
            setErreur('Erreur serveur : données manquantes dans la réponse.'); return;
          }

          // Mémoriser agent
          try {
            localStorage.setItem('kyc_acq_agent', JSON.stringify({
              wa_agent: form.wa_agent, username_agent: form.username_agent,
              fonction_agent: form.fonction_agent, zone_agent: form.zone_agent,
              country: form.country,
            }));
          } catch { /* ignore */ }

          // [FIX-2] Passer l'id du dossier à prepareSession
          prepareSession(data.id, data.recto_path, data.verso_path);
        } else {
          try { setErreur(JSON.parse(xhr.responseText).error ?? 'Erreur ' + xhr.status); }
          catch { setErreur('Erreur ' + xhr.status); }
        }
      };
      xhr.onerror = () => { setLoading(false); setErreur('Erreur réseau — vérifiez votre connexion'); };
      xhr.open('POST', '/api/public/dossiers');
      xhr.send(fd);
    } catch (e: unknown) {
      setLoading(false);
      setErreur('Erreur : ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  // ── [FIX-2] prepareSession corrigée ──────────────────────────────────────
  // Transmet l'id du dossier dans les paramètres URL → face-verify-interactive
  // peut uploader la photo live via /api/public/dossiers/:id/live

  const prepareSession = async (dossierId: string, rectoPath: string, versoPath: string) => {
    try {
      const r = await fetch('/api/dossiers/prepare-verify-session', {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          numero_mtn:     form.numero_mtn.replace(/\D/g, ''),
          country:        form.country,           // [FIX-3] country ajouté
          recto_path:     rectoPath,
          verso_path:     versoPath,
          wa_agent:       form.wa_agent,
          username_agent: form.username_agent,
          fonction_agent: form.fonction_agent,
          zone_agent:     form.zone_agent,
        }),
      });
      const data = await r.json();
      if (!r.ok) { setErreur(data.error ?? 'Impossible de préparer la session'); return; }

      // [FIX-2] Ajouter dossierId dans les params pour face-verify-interactive
      const params = new URLSearchParams({
        session:   data.sessionId,
        dossier_id: dossierId,          // ← NOUVEAU : ID pour upload /live
        recto:     rectoPath,
        verso:     versoPath,
        numero:    form.numero_mtn,
        country:   form.country,
        wa:        form.wa_agent,
        username:  form.username_agent,
        fonction:  form.fonction_agent,
        zone:      form.zone_agent,
      });

      setSuccess(form.numero_mtn);
      window.location.href = '/face-verify-interactive?' + params.toString();
    } catch (e: unknown) {
      setErreur('Erreur réseau : ' + (e instanceof Error ? e.message : String(e)));
    }
  };

  const libelleStatut = (s: string) =>
    ({ en_attente: 'En attente', en_cours: 'En cours', accepte: 'Accepté', rejete: 'Rejeté' }[s] ?? s);
  const colorStatut = (s: string) =>
    ({ en_attente: '#C2660A', en_cours: '#C2660A', accepte: '#16A34A', rejete: '#DC2626' }[s] ?? '#94A3B8');
  const formatDateDossier = (value: string | null | undefined) => {
    if (!value) return '';
    const text = String(value).trim();
    if (!text) return '';
    const match = text.match(/^\d{4}-\d{2}-\d{2}/);
    if (match) {
      const [year, month, day] = match[0].split('-').map(Number);
      return `${String(day).padStart(2, '0')}/${String(month).padStart(2, '0')}/${year}`;
    }
    const parsed = new Date(text);
    if (Number.isNaN(parsed.getTime())) return text;
    return `${String(parsed.getDate()).padStart(2, '0')}/${String(parsed.getMonth() + 1).padStart(2, '0')}/${parsed.getFullYear()}`;
  };

  const formatScoreDossier = (score: number | string | null | undefined) => {
    const value = typeof score === 'string' ? Number(score) : score;
    if (value === null || value === undefined || Number.isNaN(value)) return '';
    return `${value.toFixed(value >= 10 ? 0 : 1)}%`;
  };

  const scoreBadgeStyle = (score: number | null | undefined) => {
    if (score === null || score === undefined || Number.isNaN(score)) {
      return { color: '#64748B', background: 'rgba(100, 116, 139, 0.12)', border: '1px solid rgba(100, 116, 139, 0.2)' };
    }
    if (score >= 80) {
      return { color: '#16A34A', background: 'rgba(22, 163, 74, 0.12)', border: '1px solid rgba(22, 163, 74, 0.24)' };
    }
    if (score >= 60) {
      return { color: '#C2660A', background: 'rgba(194, 102, 10, 0.12)', border: '1px solid rgba(194, 102, 10, 0.24)' };
    }
    return { color: '#DC2626', background: 'rgba(220, 38, 38, 0.12)', border: '1px solid rgba(220, 38, 38, 0.24)' };
  };

  // ── Rendu ──────────────────────────────────────────────────────────────────
  return (
    <div style={{ fontFamily: "'Inter', system-ui, sans-serif", background: '#F0F4FA', minHeight: '100vh', WebkitFontSmoothing: 'antialiased', color: '#0F172A' }}>
      <canvas ref={canvasRef} style={{ display: 'none' }} />

      {/* Topbar */}
      <div style={{ background: 'linear-gradient(135deg,#003087 0%,#0057A8 100%)', borderBottom: '3px solid #FFCC00', padding: '12px 16px', display: 'flex', alignItems: 'center', gap: 12, position: 'sticky', top: 0, zIndex: 50, boxShadow: '0 4px 16px rgba(0,48,135,.25)' }}>
        <a href="/" style={{ color: '#fff', fontSize: 18, textDecoration: 'none', padding: '6px 8px', borderRadius: 8, lineHeight: 1, display: 'flex', alignItems: 'center' }}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M19 12H5M12 5l-7 7 7 7"/></svg>
        </a>
        <div style={{ width: 34, height: 34, background: '#FFCC00', borderRadius: 9, display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 900, fontSize: 13, color: '#003087', boxShadow: '0 2px 8px rgba(255,204,0,.4)', letterSpacing: '-.5px' }}>MTN</div>
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 700, color: '#fff' }}>Nouveau dossier</div>
          <div style={{ fontSize: 11, color: 'rgba(255,255,255,.6)', marginTop: 1 }}>Enregistrement KYC</div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, fontWeight: 600, color: '#fff' }}>
          <div style={{ width: 6, height: 6, borderRadius: '50%', background: '#16A34A' }} />
          En ligne
        </div>
      </div>

      {/* Tabs */}
      <div style={{ background: '#fff', borderBottom: '1px solid rgba(0,48,135,.1)', padding: '0 16px', display: 'flex', position: 'sticky', top: 59, zIndex: 40 }}>
        {(['form', 'dash'] as Tab[]).map(t => (
          <button key={t} onClick={() => t === 'dash' ? (setTab('dash'), chargerDash()) : setTab('form')} style={{ flex: 1, padding: '12px 8px 10px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer', background: 'transparent', border: 'none', borderBottom: `2px solid ${tab === t ? '#FFCC00' : 'transparent'}`, color: tab === t ? '#003087' : '#94A3B8', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
            {t === 'form' ? '📄 Enregistrer' : '📊 Mes dossiers'}
          </button>
        ))}
      </div>

      <div style={{ maxWidth: 480, margin: '0 auto', paddingBottom: 24 }}>

        {/* ══ ONGLET FORM ══ */}
        {tab === 'form' && (
          <div>
            {success ? (
              <div style={{ background: '#fff', border: '1px solid rgba(22,163,74,.2)', borderRadius: 20, padding: '36px 24px', textAlign: 'center', margin: '20px 12px', boxShadow: '0 4px 16px rgba(0,48,135,.1)' }}>
                <div style={{ width: 80, height: 80, borderRadius: '50%', background: 'rgba(22,163,74,.1)', border: '2px solid rgba(22,163,74,.28)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 36, margin: '0 auto 20px' }}>✓</div>
                <div style={{ fontSize: 22, fontWeight: 800, color: '#16A34A', marginBottom: 8 }}>Dossier envoyé</div>
                <div style={{ fontSize: 13.5, color: '#475569', lineHeight: 1.7 }}>
                  Le numéro <strong style={{ fontFamily: 'monospace', color: '#003087' }}>{success}</strong> est en cours de vérification.
                  <br /><br />
                  Vous serez notifié sur WhatsApp <strong style={{ fontFamily: 'monospace', color: '#003087' }}>{form.wa_agent}</strong>.
                </div>
                <button onClick={() => { setSuccess(null); setPhotos({ recto: null, verso: null }); setForm(f => ({ ...f, numero_mtn: '' })); }} style={{ marginTop: 24, background: 'linear-gradient(135deg,#FFCC00,#E6B800)', color: '#003087', fontWeight: 700, border: 'none', borderRadius: 10, padding: '13px 28px', cursor: 'pointer', fontSize: 14 }}>
                  + Nouveau dossier
                </button>
              </div>
            ) : (
              <div>
                {/* Informations agent */}
                <SectionLabel label="Informations agent" />
                <Card>
                  <StepHeader num="01" title="Agent" sub="Vos informations" />
                  {agent && !editAgent ? (
                    <div style={{ background: 'rgba(0,48,135,.06)', border: '1.5px solid rgba(0,48,135,.18)', borderRadius: 12, padding: '14px 16px', display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 10 }}>
                      <div>
                        <div style={{ fontFamily: 'monospace', fontSize: 16, fontWeight: 700, color: '#003087' }}>{agent.wa_agent}</div>
                        <div style={{ fontSize: 12, color: '#475569', marginTop: 4, lineHeight: 1.6 }}>
                          {agent.username_agent} · {agent.fonction_agent}<br />{agent.zone_agent}
                        </div>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, color: '#16A34A', background: 'rgba(22,163,74,.1)', border: '1px solid rgba(22,163,74,.25)', borderRadius: 99, padding: '2px 8px', marginTop: 6 }}>✓ Mémorisé</span>
                      </div>
                      <button onClick={() => setEditAgent(true)} style={{ background: '#fff', border: '1.5px solid rgba(0,48,135,.18)', color: '#475569', fontSize: 12, fontWeight: 600, borderRadius: 8, padding: '7px 13px', cursor: 'pointer' }}>Modifier</button>
                    </div>
                  ) : (
                    <div>
                      <Fld label="Pays" req>
                        <select value={form.country} onChange={e => setForm(f => ({ ...f, country: e.target.value, numero_mtn: '' }))} style={inpSt}>
                          <option value="">— Sélectionnez —</option>
                          <option value="CG">Congo</option>
                          <option value="BJ">Bénin</option>
                          <option value="CI">Côte d'Ivoire</option>
                          <option value="CM">Cameroun</option>
                          <option value="GW">Guinée Bissau</option>
                          <option value="GN">Guinée</option>
                        </select>
                      </Fld>
                      <Fld label="WhatsApp" req hint={paysConf ? `${paysConf.digitCount} chiffres, commence par ${paysConf.prefix}` : 'Sélectionnez d\'abord un pays'}>
                        <input value={formatWaInput(form.wa_agent)} onChange={e => { const digits = e.target.value.replace(/\D/g, '').slice(0, paysConf?.digitCount ?? 9); setForm(f => ({ ...f, wa_agent: digits })); }} type="tel" inputMode="numeric" placeholder={paysConf?.placeholder ?? '— sélectionnez un pays —'} disabled={!form.country} style={{ ...inpSt, fontFamily: 'monospace', fontSize: 20, fontWeight: 700, letterSpacing: 4, color: '#003087' }} />
                      </Fld>
                      <Fld label="Username" req><input value={form.username_agent} onChange={e => setForm(f => ({ ...f, username_agent: e.target.value }))} placeholder="ex : dav_centre" style={inpSt} /></Fld>
                      <Fld label="Fonction" req>
                        <select value={form.fonction_agent} onChange={e => setForm(f => ({ ...f, fonction_agent: e.target.value }))} style={inpSt}>
                          <option value="">— Sélectionnez —</option>
                          <option>Agent Acquisition</option>
                          <option>Agent EBU</option>
                          <option>Agent Frontoffice</option>
                          <option>Autre</option>
                        </select>
                      </Fld>
                      <Fld label="Zone" req>
                        <select value={form.zone_agent} onChange={e => setForm(f => ({ ...f, zone_agent: e.target.value }))} style={inpSt}>
                          <option value="">— Sélectionnez —</option>
                          <option>Brazzaville</option>
                          <option>Pointe-Noire</option>
                          <option>Hinterland Nord</option>
                          <option>Hinterland Sud</option>
                          <option>Autre</option>
                        </select>
                      </Fld>
                    </div>
                  )}
                </Card>

                {/* Numéro MTN */}
                <SectionLabel label="Numéro à identifier" />
                <Card style={{ borderColor: 'rgba(255,204,0,.35)', background: 'linear-gradient(135deg,rgba(255,204,0,.05),rgba(255,204,0,.02))' }}>
                  <StepHeader num="02" title="Numéro MTN" sub="À identifier" gold />
                  <Fld label="Numéro vendu" req hint={paysConf?.hint ?? 'Sélectionnez d\'abord un pays'}>
                    <input value={form.numero_mtn} onChange={e => setForm(f => ({ ...f, numero_mtn: formatNumero(e.target.value) }))} type="tel" inputMode="numeric" placeholder={paysConf?.placeholder ?? '— sélectionnez un pays —'} disabled={!form.country} style={{ ...inpSt, fontFamily: 'monospace', fontSize: 24, fontWeight: 700, letterSpacing: 5, color: '#003087', textAlign: 'center', padding: '16px' }} />
                  </Fld>
                </Card>

                {/* Photos CNI */}
                <SectionLabel label="Documents" />
                <Card>
                  <StepHeader num="03" title="Photos CNI" sub="Recto et verso" />
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 14 }}>
                    {(['recto', 'verso'] as const).map(type => (
                      <div key={type} onClick={() => ouvrirCamera(type)} style={{ aspectRatio: '85/54', borderRadius: 12, overflow: 'hidden', position: 'relative', background: photos[type] ? 'transparent' : '#EDF1F8', border: `2px ${photos[type] ? 'solid #16A34A' : photoErr[type] ? 'solid #DC2626' : 'dashed rgba(0,48,135,.25)'}`, cursor: 'pointer', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 6 }}>
                        {photos[type] ? (
                          <>
                            <img src={photos[type]!.preview} alt={type} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', objectFit: 'cover' }} />
                            <span style={{ position: 'absolute', top: 6, right: 6, background: '#16A34A', color: '#fff', fontSize: 9, fontWeight: 800, borderRadius: 99, padding: '2px 8px' }}>✓ OK</span>
                            <span style={{ position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', background: 'rgba(0,0,0,.55)', color: '#fff', fontSize: 10, fontWeight: 600, borderRadius: 99, padding: '3px 10px', whiteSpace: 'nowrap' }}>↺ Reprendre</span>
                          </>
                        ) : (
                          <>
                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#003087" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
                            <span style={{ fontSize: 10, fontWeight: 700, color: '#6B7A99', textAlign: 'center', textTransform: 'uppercase', letterSpacing: .8 }}>{type === 'recto' ? 'RECTO CNI' : 'VERSO CNI'}<br /><span style={{ fontWeight: 400, fontSize: 9, opacity: .5, textTransform: 'none', letterSpacing: 0 }}>Appuyer</span></span>
                          </>
                        )}
                      </div>
                    ))}
                  </div>

                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: '#475569' }}>Photos ajoutées</span>
                    <span style={{ fontSize: 11, fontWeight: 700, color: '#003087', fontFamily: 'monospace' }}>{nbPhotos()}/2</span>
                  </div>
                  <div style={{ height: 5, background: '#EDF1F8', borderRadius: 99, overflow: 'hidden' }}>
                    <div style={{ height: '100%', background: 'linear-gradient(90deg,#003087,#0057A8)', borderRadius: 99, width: `${pct()}%`, transition: 'width .3s' }} />
                  </div>

                  <div style={{ marginTop: 14, background: 'rgba(0,48,135,.05)', border: '1px solid rgba(0,48,135,.15)', borderLeft: '3px solid #003087', borderRadius: 8, padding: '11px 13px', display: 'flex', gap: 9 }}>
                    <span style={{ fontSize: 14, flexShrink: 0 }}>ℹ</span>
                    <div style={{ fontSize: 12, color: '#475569', lineHeight: 1.55 }}>
                      <strong style={{ color: '#003087', fontWeight: 600, display: 'block', marginBottom: 2 }}>Photo live — étape suivante</strong>
                      Capturée automatiquement lors de la vérification faciale interactive après envoi.
                    </div>
                  </div>
                </Card>

                {erreur && (
                  <div style={{ background: 'rgba(220,38,38,.08)', border: '1px solid rgba(220,38,38,.22)', borderLeft: '3px solid #DC2626', borderRadius: 8, padding: '12px 16px', margin: '12px 12px 0', fontSize: 13, color: '#DC2626', display: 'flex', alignItems: 'flex-start', gap: 8 }}>
                    ⚠ <span>{erreur}</span>
                  </div>
                )}

                <button onClick={soumettre} disabled={loading || !peutSoumettre()} style={{ width: 'calc(100% - 24px)', margin: '16px 12px 0', background: 'linear-gradient(135deg,#FFCC00,#E6B800)', color: '#003087', fontSize: 15, fontWeight: 700, border: 'none', borderRadius: 14, padding: 17, cursor: loading || !peutSoumettre() ? 'not-allowed' : 'pointer', opacity: !peutSoumettre() ? .4 : 1, boxShadow: '0 6px 24px rgba(255,204,0,.4)', display: 'block', textAlign: 'center' }}>
                  {loading ? `Envoi… ${progress}%` : 'Passer à la vérification →'}
                </button>
                <p style={{ textAlign: 'center', fontSize: 11, color: '#94A3B8', padding: '8px 0 14px' }}>* Tous les champs sont obligatoires</p>
              </div>
            )}
          </div>
        )}

        {/* ══ ONGLET DASH ══ */}
        {tab === 'dash' && (
          <div>
            {form.wa_agent.replace(/\D/g, '').length !== (paysConf?.digitCount ?? 0) ? (
              <div style={{ textAlign: 'center', padding: '60px 24px', color: '#94A3B8', fontSize: 13 }}>
                <div style={{ fontSize: 36, marginBottom: 14, opacity: .35 }}>📊</div>
                <div style={{ fontWeight: 600, color: '#475569', marginBottom: 6 }}>Aucun agent connecté</div>
                Renseignez votre WhatsApp dans l'onglet Enregistrer pour voir vos dossiers.
              </div>
            ) : (
              <div>
                <SectionLabel label="Période" />
                <Card>
                  <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', marginBottom: 14 }}>
                    <input type="date" value={dateDebut} onChange={e => setDateDebut(e.target.value)} style={{ ...inpSt, flex: 1, minWidth: 130, padding: '10px 12px', fontSize: 13 }} />
                    <span style={{ color: '#94A3B8', fontSize: 12, fontWeight: 600, display: 'flex', alignItems: 'center' }}>→</span>
                    <input type="date" value={dateFin} onChange={e => setDateFin(e.target.value)} style={{ ...inpSt, flex: 1, minWidth: 130, padding: '10px 12px', fontSize: 13 }} />
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: 'repeat(4,1fr)', gap: 8 }}>
                    {[
                      { label: 'Total',    val: statsFiltre().total,    color: '#003087' },
                      { label: 'En cours', val: statsFiltre().en_cours, color: '#C2660A' },
                      { label: 'Acceptés', val: statsFiltre().accepte,  color: '#16A34A' },
                      { label: 'Rejetés',  val: statsFiltre().rejete,   color: '#DC2626' },
                    ].map(s => (
                      <div key={s.label} style={{ background: '#fff', border: '1px solid rgba(0,48,135,.1)', borderRadius: 8, padding: '12px 6px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,48,135,.06)' }}>
                        <div style={{ fontSize: 22, fontWeight: 800, fontFamily: 'monospace', color: s.color }}>{s.val}</div>
                        <div style={{ fontSize: 9, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1.2, color: '#94A3B8', marginTop: 3 }}>{s.label}</div>
                      </div>
                    ))}
                  </div>
                </Card>

                <SectionLabel label="Dossiers" />
                <div style={{ padding: '0 12px' }}>
                  {dashLoading && dossiers.length === 0 && <div style={{ textAlign: 'center', padding: 28, color: '#94A3B8', fontSize: 13 }}>Chargement…</div>}
                  {!dashLoading && dossiersFiltres().length === 0 && <div style={{ textAlign: 'center', padding: '40px 24px', color: '#94A3B8', fontSize: 13 }}>Aucun dossier sur cette période.</div>}
                  {dossiersFiltres().map(d => (
                    <div key={d.id} style={{ background: '#fff', border: `1px solid rgba(0,48,135,.1)`, borderLeft: `3px solid ${colorStatut(d.statut)}`, borderRadius: 8, padding: '13px 14px', marginBottom: 8, boxShadow: '0 1px 3px rgba(0,48,135,.06)' }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
                        <span style={{ fontFamily: 'monospace', fontSize: 15, fontWeight: 700, color: '#003087' }}>{d.numero_mtn}</span>
                        <span style={{ fontSize: 10, fontWeight: 700, borderRadius: 99, padding: '3px 10px', background: d.statut === 'accepte' ? 'rgba(22,163,74,.1)' : d.statut === 'rejete' ? 'rgba(220,38,38,.08)' : 'rgba(194,102,10,.1)', color: colorStatut(d.statut) }}>{libelleStatut(d.statut)}</span>
                      </div>
                      <div style={{ fontSize: 11, color: '#94A3B8', display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 6 }}>
                        <span>{formatDateDossier(d.date)}{d.heure_reception ? ` · ${d.heure_reception}` : ''}</span>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4, fontSize: 10, fontWeight: 700, borderRadius: 999, padding: '2px 8px', ...scoreBadgeStyle(d.score_visage) }}>
                          Similarité {d.score_visage !== null && d.score_visage !== undefined ? formatScoreDossier(d.score_visage) : 'non disponible'}
                        </span>
                      </div>
                      {d.statut === 'rejete' && d.raison_rejet && <div style={{ fontSize: 11, color: '#DC2626', marginTop: 5 }}>✗ {d.raison_rejet}</div>}
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}
      </div>

      {/* ══ MODAL CAMÉRA ══ */}
      {camOpen && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 200, background: '#000', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '12px 18px', background: 'rgba(255,255,255,.97)', display: 'flex', alignItems: 'center', justifyContent: 'space-between', borderBottom: '1px solid rgba(0,48,135,.1)' }}>
            <span style={{ fontSize: 14, fontWeight: 700 }}>📷 Photo {camType === 'recto' ? 'Recto' : 'Verso'} CNI</span>
            <button onClick={fermerCamera} style={{ background: '#F0F4FA', border: '1.5px solid rgba(0,48,135,.18)', color: '#475569', borderRadius: 8, padding: '7px 13px', fontSize: 12.5, fontWeight: 600, cursor: 'pointer' }}>✕ Annuler</button>
          </div>
          {cameras.length > 0 && (
            <div style={{ padding: '7px 18px', background: '#F6F8FC', borderBottom: '1px solid rgba(0,48,135,.1)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <label style={{ fontSize: 11, fontWeight: 700, color: '#475569', whiteSpace: 'nowrap' }}>📹 CAMÉRA</label>
              <select value={selectedCam} onChange={e => { setSelectedCam(e.target.value); startCamera(e.target.value); }} style={{ ...inpSt, flex: 1, padding: '7px 10px', fontSize: 12 }}>
                {cameras.map((c, i) => <option key={c.deviceId} value={c.deviceId}>{c.label || `Caméra ${i + 1}`}</option>)}
              </select>
            </div>
          )}
          <div style={{ flex: 1, display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 18, minHeight: 0 }}>
            <div style={{ position: 'relative', width: '100%', maxWidth: 560, aspectRatio: '85 / 54', background: '#050508', borderRadius: 22, overflow: 'hidden', boxShadow: '0 18px 50px rgba(0,0,0,.35)' }}>
              <video ref={videoRef} autoPlay muted playsInline style={{ width: '100%', height: '100%', objectFit: 'cover', transform: previewMirrored ? 'scaleX(-1)' : undefined }} />
              <div style={{ position: 'absolute', inset: 0, background: 'radial-gradient(circle at center, rgba(0,0,0,0) 44%, rgba(0,0,0,.48) 55%)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', inset: '10%', border: '2px solid rgba(255,255,255,.85)', borderRadius: 18, boxShadow: '0 0 0 9999px rgba(0,0,0,.2)', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: '8%', left: '8%', width: 46, height: 46, borderTop: '3px solid #FFCC00', borderLeft: '3px solid #FFCC00', borderRadius: '0 0 0 14px', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', top: '8%', right: '8%', width: 46, height: 46, borderTop: '3px solid #FFCC00', borderRight: '3px solid #FFCC00', borderRadius: '0 0 14px 0', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '8%', left: '8%', width: 46, height: 46, borderBottom: '3px solid #FFCC00', borderLeft: '3px solid #FFCC00', borderRadius: '0 14px 0 0', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '8%', right: '8%', width: 46, height: 46, borderBottom: '3px solid #FFCC00', borderRight: '3px solid #FFCC00', borderRadius: '14px 0 0 0', pointerEvents: 'none' }} />
              <div style={{ position: 'absolute', bottom: '8%', left: '50%', transform: 'translateX(-50%)', fontSize: 12, fontWeight: 700, color: '#fff', background: 'rgba(0,0,0,.64)', padding: '7px 14px', borderRadius: 999, pointerEvents: 'none' }}>Placez la CNI dans le cadre</div>
              {camQuality.label && (
                <div style={{ position: 'absolute', top: 14, left: '50%', transform: 'translateX(-50%)', fontSize: 12, fontWeight: 700, borderRadius: 99, padding: '7px 16px', backdropFilter: 'blur(4px)', background: camQuality.cls === 'ok' ? 'rgba(22,163,74,.95)' : camQuality.cls === 'warn' ? 'rgba(255,204,0,.94)' : 'rgba(220,38,38,.94)', color: camQuality.cls === 'warn' ? '#000' : '#fff', whiteSpace: 'nowrap' }}>
                  {camQuality.label}
                </div>
              )}
            </div>
          </div>
          <div style={{ padding: '16px 24px', background: 'rgba(255,255,255,.97)', borderTop: '1px solid rgba(0,48,135,.1)', display: 'flex', gap: 10, justifyContent: 'center' }}>
            <button onClick={switchCamera} style={{ background: '#F0F4FA', border: '1.5px solid rgba(0,48,135,.18)', color: '#475569', fontSize: 13, fontWeight: 600, borderRadius: 50, padding: '13px 18px', cursor: 'pointer' }}>↺ Retourner</button>
            <button onClick={capturer} disabled={!camQuality.ok} style={{ background: '#003087', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 50, padding: '13px 32px', cursor: camQuality.ok ? 'pointer' : 'not-allowed', opacity: camQuality.ok ? 1 : .35, boxShadow: '0 4px 16px rgba(0,48,135,.35)', display: 'flex', alignItems: 'center', gap: 8 }}>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z"/><circle cx="12" cy="13" r="4"/></svg>
              Capturer
            </button>
          </div>
        </div>
      )}

      {/* ══ MODAL PREVIEW ══ */}
      {preview?.open && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 300, background: 'rgba(15,23,42,.75)', backdropFilter: 'blur(12px)', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, gap: 14 }}>
          <div style={{ textAlign: 'center', fontSize: 14, fontWeight: 700, color: '#fff', marginBottom: 2 }}>
            {preview.type === 'recto' ? 'Vérifiez le recto CNI' : 'Vérifiez le verso CNI'}
          </div>
          <div style={{ fontSize: 12, padding: '6px 16px', borderRadius: 99, fontWeight: 600, background: preview.quality.cls === 'ok' ? 'rgba(22,163,74,.15)' : preview.quality.cls === 'warn' ? 'rgba(255,204,0,.15)' : 'rgba(220,38,38,.15)', color: preview.quality.cls === 'ok' ? '#16A34A' : preview.quality.cls === 'warn' ? '#C2660A' : '#DC2626', border: `1px solid ${preview.quality.cls === 'ok' ? 'rgba(22,163,74,.3)' : preview.quality.cls === 'warn' ? 'rgba(255,204,0,.4)' : 'rgba(220,38,38,.3)'}` }}>
            {preview.quality.ok ? '✓ Photo nette et lisible — vous pouvez valider' : preview.quality.cls === 'warn' ? '⚠ Qualité moyenne — vérifiez que le texte est lisible' : '✗ Photo insuffisante — veuillez reprendre'}
          </div>
          <img src={preview.url} alt="Aperçu" style={{ width: '100%', maxWidth: 400, borderRadius: 14, border: '1px solid rgba(255,255,255,.15)', boxShadow: '0 8px 32px rgba(0,48,135,.14)' }} />
          <div style={{ display: 'flex', gap: 10, width: '100%', maxWidth: 400 }}>
            <button onClick={rejeterPhoto} style={{ flex: 1, background: '#fff', border: '1.5px solid rgba(0,48,135,.18)', color: '#475569', fontSize: 14, fontWeight: 600, borderRadius: 10, padding: 14, cursor: 'pointer' }}>↺ Reprendre</button>
            <button onClick={validerPhoto} style={{ flex: 1, background: '#16A34A', color: '#fff', fontSize: 14, fontWeight: 700, border: 'none', borderRadius: 10, padding: 14, cursor: 'pointer', boxShadow: '0 4px 14px rgba(22,163,74,.35)' }}>✓ Valider</button>
          </div>
          <p style={{ fontSize: 11, color: 'rgba(255,255,255,.4)', textAlign: 'center' }}>Texte lisible et photo nette requis</p>
        </div>
      )}
    </div>
  );
}

// ── Composants helpers ─────────────────────────────────────────────────────────

function SectionLabel({ label }: { label: string }) {
  return (
    <div style={{ fontSize: 10.5, fontWeight: 700, textTransform: 'uppercase', letterSpacing: 1, color: '#94A3B8', margin: '16px 12px 4px', display: 'flex', alignItems: 'center', gap: 8 }}>
      {label}<div style={{ flex: 1, height: 1, background: 'rgba(0,48,135,.1)' }} />
    </div>
  );
}

function Card({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div style={{ background: '#fff', border: '1px solid rgba(0,48,135,.1)', borderRadius: 20, padding: 20, margin: '0 12px 12px', boxShadow: '0 1px 3px rgba(0,48,135,.06)', ...style }}>
      {children}
    </div>
  );
}

function StepHeader({ num, title, sub, gold }: { num: string; title: string; sub: string; gold?: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 18 }}>
      <div style={{ width: 30, height: 30, borderRadius: '50%', background: gold ? '#FFCC00' : '#003087', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 11, fontWeight: 800, color: gold ? '#003087' : '#fff', flexShrink: 0, boxShadow: gold ? '0 2px 8px rgba(255,204,0,.35)' : '0 2px 8px rgba(0,48,135,.28)', fontFamily: 'monospace' }}>
        {num}
      </div>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <span style={{ fontSize: 12.5, fontWeight: 700, color: '#0F172A', letterSpacing: .3, textTransform: 'uppercase' }}>{title}</span>
        <span style={{ fontSize: 11, color: '#94A3B8', marginTop: 2 }}>{sub}</span>
      </div>
      <div style={{ flex: 1, height: 1, background: 'rgba(0,48,135,.15)' }} />
    </div>
  );
}

function Fld({ label, req, hint, children }: { label: string; req?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div style={{ marginBottom: 14 }}>
      <label style={{ display: 'block', fontSize: 11, fontWeight: 700, color: '#475569', marginBottom: 7, letterSpacing: .7, textTransform: 'uppercase' }}>
        {label}{req && <span style={{ color: '#FFCC00', marginLeft: 2 }}>*</span>}
      </label>
      {children}
      {hint && <p style={{ fontSize: 11, color: '#94A3B8', marginTop: 5 }}>{hint}</p>}
    </div>
  );
}

const inpSt: React.CSSProperties = {
  width: '100%', padding: '11px 14px',
  border: '1.5px solid rgba(0,48,135,.18)', borderRadius: 10,
  fontSize: 14, color: '#0F172A', background: '#F6F8FC',
  outline: 'none', fontFamily: "'Inter', sans-serif",
  appearance: 'none', WebkitAppearance: 'none',
};