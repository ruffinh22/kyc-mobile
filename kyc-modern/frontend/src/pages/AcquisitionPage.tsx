// ============================================================================
// AcquisitionPage.tsx — CORRIGÉ
//
// CORRECTIONS :
//   [FIX-1] soumettre() → après succès, appelle maintenant prepareSession()
//           avec l'id retourné par le serveur (pas juste les paths)
//   [FIX-2] prepareSession() passe l'id du dossier dans l'URL → face-verify
//           pourra uploader la photo live via /api/public/dossiers/:id/live
//   [FIX-3] prepareSession() transmet country en plus des autres champs
//
//   [FIX-4] OCR — refonte de la chaîne d'extraction (voir détail plus bas) :
//     a) `normalizeOcrText` (texte affiché à l'agent) filtrait les lignes
//        contenant les libellés ("nom", "prénom", "naissance", "nation"...)
//        pour ne garder que des lignes "propres". Or `extractFieldsFromOcr`
//        cherchait ces mêmes libellés dans CE texte déjà filtré → il ne
//        pouvait structurellement jamais les trouver. On sépare maintenant
//        clairement : le texte BRUT (avec libellés) sert à l'extraction de
//        champs, le texte normalisé ne sert plus qu'à l'affichage humain.
//     b) Recherche de valeur par proximité de libellé : sur une CNI, le
//        libellé et sa valeur ne sont pas toujours sur la même ligne après
//        OCR (mise en page en colonnes) → on regarde la ligne courante puis
//        les 2 suivantes.
//     c) Correction des confusions de caractères OCR classiques (O/0, I/1,
//        S/5, B/8) sur le numéro de CNI, via un motif regex dédié plutôt
//        que le filtre générique "propreté de ligne".
//     d) Correction floue (distance de Levenshtein) de la nationalité
//        contre une liste de valeurs attendues.
//     e) Suppression de `rotateAuto: true`, option non reconnue par
//        `Tesseract.recognize()` dans tesseract.js (silencieusement
//        ignorée) — retirée pour éviter toute confusion.
// ============================================================================

import { useState, useEffect, useRef, useCallback } from 'react';
import { createWorker, OEM, PSM } from 'tesseract.js';
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
type OcrStatus = 'idle' | 'running' | 'done' | 'error';

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

// ── OCR recto ───────────────────────────────────────────────────────────────

function scoreCandidateText(text: string) {
  let score = 0;
  const lines = text.split('\n').filter(Boolean);
  for (const line of lines) {
    const letters = (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    const digits = (line.match(/\d/g) ?? []).length;
    const spaceCount = (line.match(/\s/g) ?? []).length;
    if (/date|expiration|valide|naissance|sexe|nation|civ|cni|carte|ident/i.test(line)) score -= 24;
    if (letters >= 4) score += letters * 2;
    if (digits > 0) score += digits * 3;
    if (spaceCount <= 2 && letters >= 4) score += 8;
  }
  return score;
}

// [FIX-4c/d] Corrections de confusions OCR classiques -----------------------

// Distance de Levenshtein simple, utilisée pour le rapprochement flou de
// tokens face à un référentiel de valeurs attendues (nationalités, etc.)
function levenshtein(a: string, b: string): number {
  const m = a.length, n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1]
        : 1 + Math.min(dp[i - 1][j], dp[i][j - 1], dp[i - 1][j - 1]);
    }
  }
  return dp[m][n];
}

// Numéro de CNI : 1 à 3 lettres suivies de 8 à 10 chiffres (ex. CI0001945307
// pour la Côte d'Ivoire). On corrige les confusions lettre/chiffre typiques
// UNIQUEMENT dans la portion numérique, jamais dans le préfixe alphabétique,
// pour ne pas transformer un vrai "O" de préfixe en "0".
function corrigerNumeroCni(rawText: string): string | null {
  const upper = rawText.toUpperCase();
  const match = upper.match(/([A-Z]{1,3})[\s.:\-]{0,3}([0-9OIlSBZ]{8,10})/);
  if (!match) return null;
  const prefixe = match[1];
  const corps = match[2]
    .replace(/O/g, '0')
    .replace(/[Il]/g, '1')
    .replace(/S/g, '5')
    .replace(/B/g, '8')
    .replace(/Z/g, '2');
  return `${prefixe}${corps}`;
}

// Rapproche un token OCR bruité d'une valeur connue (nationalité) si la
// distance d'édition reste faible par rapport à la longueur du mot — évite
// les faux positifs sur mots courts (tolérance ~25%, plafonnée).
const NATIONALITES_CONNUES = [
  'IVOIRIENNE', 'BENINOISE', 'CONGOLAISE', 'CAMEROUNAISE',
  'GUINEENNE', 'BISSAU-GUINEENNE',
];

function corrigerNationalite(token: string): string | null {
  const clean = token.toUpperCase().replace(/[^A-Z-]/g, '');
  if (clean.length < 6) return null;
  let best: string | null = null;
  let bestDist = Infinity;
  for (const candidate of NATIONALITES_CONNUES) {
    const dist = levenshtein(clean, candidate);
    if (dist < bestDist) { bestDist = dist; best = candidate; }
  }
  if (best && bestDist <= Math.max(2, Math.round(best.length * 0.25))) return best;
  return null;
}

// ── Texte affiché à l'agent (aperçu) ─────────────────────────────────────────
// Ce texte est volontairement filtré pour ne garder que les lignes qui
// ressemblent à des informations utiles (peu de bruit). Il ne doit PLUS être
// utilisé comme source pour l'extraction de champs structurés : les lignes
// de libellés ("Nom", "Prénoms", "Nationalité"...) y sont retirées par
// construction (voir filtre ci-dessous), donc `extractFieldsFromOcr` doit
// travailler sur le texte BRUT, pas sur celui-ci. [FIX-4a]

function normalizeOcrText(raw: string) {
  const lines = raw
    .replace(/[|{}\[\]<>]/g, '')
    .replace(/[^A-Za-zÀ-ÿ0-9/().,'-\s]/g, ' ')
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean)
    .filter(line => line.length >= 3)
    .filter(line => {
      const letters = (line.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
      const digits = (line.match(/\d/g) ?? []).length;
      const weird = (line.match(/[^A-Za-zÀ-ÿ0-9/().,'-\s]/g) ?? []).length;
      return letters >= 2 && (digits > 0 || letters >= 4) && weird <= 1;
    });

  const keep = lines.filter(line => {
    const clean = line.replace(/\s+/g, ' ').trim();
    if (!clean) return false;
    if (/date|expiration|valide|naissance|sexe|nation|civ|cni|carte|ident/i.test(clean)) return false;
    if (/^[0-9\s./-]+$/.test(clean)) return false;
    const alpha = (clean.match(/[A-Za-zÀ-ÿ]/g) ?? []).length;
    const spaceCount = (clean.match(/\s/g) ?? []).length;
    return alpha >= 4 && (spaceCount <= 2 || clean.length <= 22);
  });

  // Corrige les tokens de nationalité repérables avant tri final, pour
  // éviter de perdre "IVOIRIENNE" mal lue ("IVOIMIENNE") en aval.
  const corrected = keep.map(line => {
    const words = line.split(' ');
    const fixedWords = words.map(w => corrigerNationalite(w) ?? w);
    return fixedWords.join(' ');
  });

  const ranked = corrected
    .map(line => ({ line, score: (line.match(/[A-ZÀ-Ö]/g) ?? []).length * 3 + line.length }))
    .sort((a, b) => b.score - a.score)
    .map(item => item.line);

  return ranked.slice(0, 4).join('\n');
}

function cleanOcrValue(value: string) {
  return value.replace(/\s+/g, ' ').replace(/^[\s:;.-]+|[\s:;.-]+$/g, '').trim();
}

function toDateInput(value: string) {
  const m = value.match(/(\d{1,2})[\/-](\d{1,2})[\/-](\d{2,4})/);
  if (!m) return '';
  let day = parseInt(m[1], 10);
  let month = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += year < 70 ? 2000 : 1900;
  if (month < 1 || month > 12 || day < 1 || day > 31) return '';
  return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

// Un mot "valeur plausible" pour un champ nom/prénom/lieu : au moins 2
// lettres majuscules consécutives possibles, pas un libellé lui-même.
function ressembleValeurTexte(line: string): boolean {
  const clean = line.trim();
  if (clean.length < 2) return false;
  if (LABEL_REGEXES.some(({ re }) => re.test(clean))) return false;
  const letters = (clean.match(/[A-ZÀ-Ö]/gi) ?? []).length;
  return letters >= 2;
}

const LABEL_REGEXES: { key: string; re: RegExp }[] = [
  { key: 'prenom',        re: /PRENOM/ },
  { key: 'nom',           re: /\bNOM\b/ },
  { key: 'date_naissance',re: /NAISSANCE|NE\s*LE|NEE\s*LE/ },
  { key: 'lieu_naissance',re: /LIEU/ },
  { key: 'sexe',          re: /SEXE/ },
  { key: 'nationalite',   re: /NATIONALIT/ },
  { key: 'numero_cni',    re: /^N[°ºO]|CARTE|IDENTIT|CNI/ },
  { key: 'expiration',    re: /EXPIRATION|VALIDE/ },
];

// [FIX-4b] Extraction structurée à partir du texte BRUT (avec libellés),
// avec recherche de la valeur sur la ligne du libellé puis, si absente, sur
// les 1-2 lignes suivantes (mise en page en colonnes après OCR).
function extractFieldsFromOcr(raw: string) {
  const normalized = raw
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase();
  const lines = normalized
    .split('\n')
    .map(line => line.trim())
    .filter(Boolean);

  const updates: Record<string, string> = {};

  const valeurApresLabel = (line: string, labelRe: RegExp): string | null => {
    const idx = line.search(labelRe);
    if (idx < 0) return null;
    const after = line.slice(idx).replace(labelRe, '').replace(/^[\s:;.°ºO'-]+/, '');
    return after.length >= 2 ? cleanOcrValue(after) : null;
  };

  const chercherValeur = (i: number, labelRe: RegExp, maxLookahead = 2): string | null => {
    const direct = valeurApresLabel(lines[i], labelRe);
    if (direct && ressembleValeurTexte(direct)) return direct;
    for (let j = 1; j <= maxLookahead && i + j < lines.length; j++) {
      const candidate = lines[i + j];
      if (ressembleValeurTexte(candidate)) return cleanOcrValue(candidate);
    }
    return null;
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    if (!updates.prenom_titulaire && LABEL_REGEXES.find(l => l.key === 'prenom')!.re.test(line)) {
      const v = chercherValeur(i, /PRENOMS?/);
      if (v) updates.prenom_titulaire = v;
    }
    // "NOM" seul (pas "PRENOM") pour ne pas capturer deux fois la même valeur
    if (!updates.nom_titulaire && /\bNOM\b/.test(line) && !/PRENOM/.test(line)) {
      const v = chercherValeur(i, /\bNOM\b/);
      if (v) updates.nom_titulaire = v;
    }
    if (!updates.nationalite && /NATIONALIT/.test(line)) {
      const v = chercherValeur(i, /NATIONALIT[EÉ]?/);
      if (v) updates.nationalite = corrigerNationalite(v) ?? v;
    }
    if (!updates.sexe && /SEXE/.test(line)) {
      const m = line.match(/SEXE\s*[:.]?\s*([MF])\b/);
      if (m) updates.sexe = m[1];
    }
    if (!updates.lieu_naissance && /LIEU/.test(line)) {
      const v = chercherValeur(i, /LIEU(?:\s+DE)?\s+NAISSANCE/);
      if (v) updates.lieu_naissance = v.replace(/\s*\([A-Z]{2,4}\)\s*$/, '').trim();
    }
    if (!updates.numero_cni && /^N[°ºO]|CNI|CARTE|IDENTIT/.test(line)) {
      const numero = corrigerNumeroCni(line) ?? corrigerNumeroCni(lines[i + 1] ?? '');
      if (numero) updates.numero_cni = numero;
    }
  }

  // Filet de sécurité : si aucun numéro CNI n'a été trouvé via les libellés,
  // on cherche le motif dans l'ensemble du texte (le numéro figure souvent
  // en haut de carte sans libellé "CNI" reconnu par l'OCR).
  if (!updates.numero_cni) {
    const numero = corrigerNumeroCni(normalized);
    if (numero) updates.numero_cni = numero;
  }

  const dateMatch = normalized.match(/(\d{1,2}[\/-]\d{1,2}[\/-]\d{2,4})/);
  if (dateMatch && !updates.date_naissance) {
    const dateValue = toDateInput(dateMatch[1]);
    if (dateValue) updates.date_naissance = dateValue;
  }

  return updates;
}

function preprocessForOcr(imageDataUrl: string): Promise<{ imageDataUrl: string; rectangle: { left: number; top: number; width: number; height: number } }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) { reject(new Error('canvas unavailable')); return; }

      const srcW = img.naturalWidth;
      const srcH = img.naturalHeight;
      const scale = Math.min(2.4, Math.max(1.6, 2000 / Math.max(srcW, srcH)));
      const w = Math.round(srcW * scale);
      const h = Math.round(srcH * scale);
      canvas.width = w;
      canvas.height = h;

      const cropW = Math.round(w * 0.84);
      const cropH = Math.round(h * 0.84);
      const sx = Math.round((w - cropW) / 2);
      const sy = Math.round((h - cropH) / 2);

      ctx.filter = 'grayscale(1) contrast(1.25) brightness(1.04)';
      ctx.drawImage(img, 0, 0, srcW, srcH, sx, sy, cropW, cropH);

      const imageData = ctx.getImageData(0, 0, w, h);
      const { data } = imageData;
      for (let i = 0; i < data.length; i += 4) {
        const avg = (data[i] + data[i + 1] + data[i + 2]) / 3;
        data[i] = avg;
        data[i + 1] = avg;
        data[i + 2] = avg;
      }
      ctx.putImageData(imageData, 0, 0);
      resolve({
        imageDataUrl: canvas.toDataURL('image/png'),
        rectangle: {
          left: Math.round(w * 0.08),
          top: Math.round(h * 0.08),
          width: Math.round(w * 0.84),
          height: Math.round(h * 0.84),
        },
      });
    };
    img.onerror = () => reject(new Error('image loading failed'));
    img.src = imageDataUrl;
  });
}

async function extractRectoText(imageDataUrl: string, onProgress: (progress: number, status: OcrStatus) => void) {
  const worker = await createWorker('eng+fra', OEM.LSTM_ONLY, {
    logger: (m) => {
      if (m.status === 'loading language data') onProgress(8, 'running');
      else if (m.status === 'initializing tesseract') onProgress(15, 'running');
      else if (m.status === 'recognizing text' && typeof m.progress === 'number') {
        onProgress(Math.max(20, Math.min(95, Math.round(m.progress * 100))), 'running');
      }
    },
  });
  try {
    await worker.load();
    await worker.setParameters({
      tessedit_pageseg_mode: PSM.AUTO,
      preserve_interword_spaces: '1',
      tessedit_ocr_engine_mode: '1',
      tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÂÄÉÈÊËÎÏÔÖÙÛÜÇÆŒ0123456789/.-,()\' ',
    });
    const preparedImage = await preprocessForOcr(imageDataUrl);
    const attempts = [
      { pageseg: PSM.AUTO, label: 'auto' },
      { pageseg: PSM.SINGLE_BLOCK, label: 'single-block' },
      { pageseg: PSM.SINGLE_LINE, label: 'single-line' },
    ] as const;

    let bestText = '';
    let bestScore = -1;
    let bestRaw = '';
    for (const attempt of attempts) {
      await worker.setParameters({
        tessedit_pageseg_mode: attempt.pageseg,
        preserve_interword_spaces: '1',
        tessedit_ocr_engine_mode: '1',
        tessedit_char_whitelist: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyzÀÂÄÉÈÊËÎÏÔÖÙÛÜÇÆŒ0123456789/.-,()\' ',
      });
      // [FIX-4e] "rotateAuto" retiré : option non reconnue par
      // Tesseract.recognize() dans tesseract.js, silencieusement ignorée.
      const { data } = await worker.recognize(preparedImage.imageDataUrl, {
        rectangle: preparedImage.rectangle,
      });
      const rawText = data?.text ?? '';
      const text = normalizeOcrText(rawText);
      const score = scoreCandidateText(text);
      // On garde le texte BRUT du meilleur essai (score le plus élevé sur le
      // texte normalisé), pour que l'extraction de champs structurés parte
      // toujours de la version la plus fiable de l'OCR.
      if (rawText && score > bestScore) {
        bestText = text;
        bestScore = score;
        bestRaw = rawText;
      }
      // Filet de sécurité : si aucun essai ne produit de texte normalisé
      // exploitable, on garde quand même le premier texte brut non vide.
      if (!bestRaw && rawText) bestRaw = rawText;
    }

    // [FIX-4c] Extraction ciblée du numéro de CNI par motif regex sur le
    // texte BRUT (avant filtrage), car normalizeOcrText peut exclure la
    // ligne du numéro si elle ne correspond pas aux heuristiques de "nom
    // propre". On l'ajoute au texte affiché s'il n'y figure pas déjà.
    const numeroCorrige = corrigerNumeroCni(bestRaw);
    let finalText = bestText;
    if (numeroCorrige) {
      const dejaPresent = finalText.toUpperCase().includes(numeroCorrige);
      if (!dejaPresent) {
        finalText = finalText ? `${numeroCorrige}\n${finalText}` : numeroCorrige;
      } else {
        finalText = finalText
          .split('\n')
          .map(line => (corrigerNumeroCni(line) ? numeroCorrige : line))
          .join('\n');
      }
    }

    return {
      text: finalText,
      raw: bestRaw,
      status: (finalText || bestRaw) ? 'done' as OcrStatus : 'error' as OcrStatus,
      progress: 100,
    };
  } catch (err) {
    console.error('OCR recto impossible', err);
    return { text: '', raw: '', status: 'error' as OcrStatus, progress: 0 };
  } finally {
    await worker.terminate();
  }
}

// ── Composant principal ────────────────────────────────────────────────────────

export function AcquisitionPage() {
  const [tab, setTab]           = useState<Tab>('form');
  const [agent, setAgent]       = useState<AgentInfo | null>(null);
  const [editAgent, setEditAgent] = useState(false);
  const [form, setForm]         = useState({
    wa_agent: '', username_agent: '', fonction_agent: '',
    zone_agent: '', numero_mtn: '', country: '',
    nom_titulaire: '', prenom_titulaire: '', date_naissance: '', lieu_naissance: '',
    autre_numero: '', nom_pere: '', nom_mere: '', adresse_complete: '', numero_cni: '',
    sexe: '', nationalite: '', profession: '', ocr_overrides: '',
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
    ocrText: string; ocrRaw: string; ocrStatus: OcrStatus; ocrProgress: number;
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
    const titulaireOk = !!form.nom_titulaire.trim() && !!form.prenom_titulaire.trim() &&
      !!form.date_naissance.trim() && !!form.lieu_naissance.trim() &&
      !!form.nom_pere.trim() && !!form.nom_mere.trim();
    return form.country && waOk && form.username_agent && form.fonction_agent &&
           form.zone_agent && conf && num.length === conf.digitCount &&
           titulaireOk && photos.recto && photos.verso;
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
    const previewState = {
      open: true,
      type: t,
      url: dataUrl,
      blob,
      quality,
      ocrText: '',
      ocrRaw: '',
      ocrStatus: t === 'recto' ? 'running' as OcrStatus : 'idle' as OcrStatus,
      ocrProgress: 0,
    };
    setPreview(previewState);

    if (t === 'recto') {
      void (async () => {
        const result = await extractRectoText(dataUrl, (progress, status) => {
          setPreview(prev => prev && prev.type === 'recto' ? { ...prev, ocrStatus: status, ocrProgress: progress } : prev);
        });
        setPreview(prev => prev && prev.type === 'recto' ? {
          ...prev,
          ocrText: result.text,
          ocrRaw: result.raw,
          ocrStatus: result.status,
          ocrProgress: result.progress,
        } : prev);
      })();
    }
  };

  const validerPhoto = () => {
    if (!preview?.blob) return;
    const url = URL.createObjectURL(preview.blob);
    // [FIX-4a] L'extraction de champs part désormais du texte BRUT
    // (préservant les libellés "Nom", "Prénoms", "Nationalité"...), et non
    // plus du texte normalisé affiché à l'agent (qui filtre ces libellés).
    if (preview.type === 'recto' && preview.ocrRaw.trim()) {
      const parsed = extractFieldsFromOcr(preview.ocrRaw.trim());
      setForm(f => {
        const updates: Record<string, string> = { ocr_overrides: preview.ocrText.trim() };
        if (!f.nom_titulaire && parsed.nom_titulaire) updates.nom_titulaire = parsed.nom_titulaire;
        if (!f.prenom_titulaire && parsed.prenom_titulaire) updates.prenom_titulaire = parsed.prenom_titulaire;
        if (!f.date_naissance && parsed.date_naissance) updates.date_naissance = parsed.date_naissance;
        if (!f.lieu_naissance && parsed.lieu_naissance) updates.lieu_naissance = parsed.lieu_naissance;
        if (!f.numero_cni && parsed.numero_cni) updates.numero_cni = parsed.numero_cni;
        if (!f.nationalite && parsed.nationalite) updates.nationalite = parsed.nationalite;
        if (!f.sexe && parsed.sexe) updates.sexe = parsed.sexe;
        return { ...f, ...updates };
      });
    }
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
      for (const [key, value] of Object.entries({
        nom_titulaire: form.nom_titulaire,
        prenom_titulaire: form.prenom_titulaire,
        date_naissance: form.date_naissance,
        lieu_naissance: form.lieu_naissance,
        autre_numero: form.autre_numero,
        nom_pere: form.nom_pere,
        nom_mere: form.nom_mere,
        adresse_complete: form.adresse_complete,
        numero_cni: form.numero_cni,
        sexe: form.sexe,
        nationalite: form.nationalite,
        profession: form.profession,
        ocr_overrides: form.ocr_overrides,
      })) {
        if (typeof value === 'string' && value.trim()) fd.append(key, value.trim());
      }
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

  // ── Nouveau flux : liveness au moment de la création du dossier ────────
  // Remplace l’ancienne vérification interactive de la page face-verify.
  const prepareSession = async (dossierId: string, rectoPath: string, versoPath: string) => {
    try {
      const params = new URLSearchParams({
        dossierId,
        recto: rectoPath,
        verso: versoPath,
        numero: form.numero_mtn,
        country: form.country,
        wa: form.wa_agent,
        username: form.username_agent,
        fonction: form.fonction_agent,
        zone: form.zone_agent,
      });

      setSuccess(form.numero_mtn);
      window.location.href = '/liveness-check?' + params.toString();
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

                {/* Informations titulaire */}
                <SectionLabel label="Identité du client" />
                <Card>
                  <StepHeader num="03" title="Titulaire" sub="Informations obligatoires" />
                  <Fld label="Nom titulaire" req>
                    <input value={form.nom_titulaire} onChange={e => setForm(f => ({ ...f, nom_titulaire: e.target.value }))} placeholder="Nom du titulaire" style={inpSt} />
                  </Fld>
                  <Fld label="Prénom titulaire" req>
                    <input value={form.prenom_titulaire} onChange={e => setForm(f => ({ ...f, prenom_titulaire: e.target.value }))} placeholder="Prénom du titulaire" style={inpSt} />
                  </Fld>
                  <Fld label="Date de naissance" req>
                    <input type="date" value={form.date_naissance} onChange={e => setForm(f => ({ ...f, date_naissance: e.target.value }))} style={inpSt} />
                  </Fld>
                  <Fld label="Lieu de naissance" req>
                    <input value={form.lieu_naissance} onChange={e => setForm(f => ({ ...f, lieu_naissance: e.target.value }))} placeholder="Lieu de naissance" style={inpSt} />
                  </Fld>
                  <Fld label="Nom du père" req>
                    <input value={form.nom_pere} onChange={e => setForm(f => ({ ...f, nom_pere: e.target.value }))} placeholder="Nom du père" style={inpSt} />
                  </Fld>
                  <Fld label="Nom de la mère" req>
                    <input value={form.nom_mere} onChange={e => setForm(f => ({ ...f, nom_mere: e.target.value }))} placeholder="Nom de la mère" style={inpSt} />
                  </Fld>
                  <Fld label="Adresse complète">
                    <input value={form.adresse_complete} onChange={e => setForm(f => ({ ...f, adresse_complete: e.target.value }))} placeholder="Adresse complète" style={inpSt} />
                  </Fld>
                  <Fld label="Numéro CNI">
                    <input value={form.numero_cni} onChange={e => setForm(f => ({ ...f, numero_cni: e.target.value }))} placeholder="Numéro CNI" style={inpSt} />
                  </Fld>
                  <Fld label="Sexe">
                    <select value={form.sexe} onChange={e => setForm(f => ({ ...f, sexe: e.target.value }))} style={inpSt}>
                      <option value="">— Sélectionnez —</option>
                      <option value="M">Masculin</option>
                      <option value="F">Féminin</option>
                    </select>
                  </Fld>
                  <Fld label="Nationalité">
                    <input value={form.nationalite} onChange={e => setForm(f => ({ ...f, nationalite: e.target.value }))} placeholder="Nationalité" style={inpSt} />
                  </Fld>
                  <Fld label="Profession">
                    <input value={form.profession} onChange={e => setForm(f => ({ ...f, profession: e.target.value }))} placeholder="Profession" style={inpSt} />
                  </Fld>
                  <Fld label="Autre numéro">
                    <input value={form.autre_numero} onChange={e => setForm(f => ({ ...f, autre_numero: e.target.value }))} placeholder="Autre numéro" style={inpSt} />
                  </Fld>
                </Card>

                {/* Photos CNI */}
                <SectionLabel label="Documents" />
                <Card>
                  <StepHeader num="04" title="Photos CNI" sub="Recto et verso" />
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
          {preview.type === 'recto' && (
            <div style={{ width: '100%', maxWidth: 400, background: 'rgba(255,255,255,.08)', border: '1px solid rgba(255,255,255,.15)', borderRadius: 14, padding: 12, color: '#fff' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 8, gap: 8 }}>
                <strong style={{ fontSize: 12, textTransform: 'uppercase', letterSpacing: 1 }}>OCR recto</strong>
                <span style={{ fontSize: 11, color: preview.ocrStatus === 'done' ? '#86EFAC' : preview.ocrStatus === 'error' ? '#FCA5A5' : '#FFCC00' }}>
                  {preview.ocrStatus === 'running' ? 'Analyse…' : preview.ocrStatus === 'done' ? '✓ Texte reconnu' : preview.ocrStatus === 'error' ? '⚠ Échec' : 'Prêt'}
                </span>
              </div>
              {preview.ocrStatus === 'running' && (
                <div style={{ height: 7, background: 'rgba(255,255,255,.2)', borderRadius: 999, overflow: 'hidden', marginBottom: 8 }}>
                  <div style={{ height: '100%', width: `${Math.max(8, preview.ocrProgress)}%`, background: '#FFCC00', transition: 'width .2s' }} />
                </div>
              )}
              {preview.ocrText ? (
                <pre style={{ margin: 0, whiteSpace: 'pre-wrap', fontSize: 11, lineHeight: 1.5, color: '#E2E8F0', fontFamily: 'monospace' }}>{preview.ocrText}</pre>
              ) : preview.ocrStatus === 'error' ? (
                <div style={{ fontSize: 11, color: '#FCA5A5' }}>Impossible d’extraire le texte depuis cette photo. Veuillez reprendre.</div>
              ) : (
                <div style={{ fontSize: 11, color: 'rgba(255,255,255,.7)' }}>Le texte du recto est analysé automatiquement après la prise de vue.</div>
              )}
            </div>
          )}
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