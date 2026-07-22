// ============================================================================
// KYC V4 — face-liveness-shared.ts
// Logique AWS Rekognition Face Liveness partagée entre face-liveness.ts
// (routes) et tout autre appelant back-office.
//
// CE QUE CE MODULE FAIT :
//   1. Crée une session Face Liveness AWS (CreateFaceLivenessSession) LIÉE
//      à un dossier précis, et garde cette liaison côté serveur uniquement
//      (jamais confiée au client).
//   2. Récupère le résultat (GetFaceLivenessSessionResults) : un score de
//      confiance "personne réelle" (0-100) + une image de référence extraite
//      de la session vidéo par AWS lui-même (donc non falsifiable par le
//      client, contrairement à un upload de photo classique).
//   3. Compare cette image de référence à la photo recto CNI via
//      CompareFaces (réutilise compareWithRekognition de face-verify-shared)
//      pour obtenir un score d'identité, en plus du score de vivacité.
//   4. Persiste les deux scores en base et journalise (audit).
//
// SÉCURITÉ — points critiques :
//   - Un sessionId Face Liveness ne doit JAMAIS être accepté pour un
//     dossier différent de celui pour lequel il a été créé. La liaison
//     sessionId → dossierId est stockée en mémoire serveur (Map), jamais
//     déduite d'un paramètre envoyé par le client.
//   - Chaque session est à USAGE UNIQUE côté résultat : une fois le résultat
//     traité et persisté, la session est supprimée de la Map. Un rejeu du
//     même sessionId renvoie une erreur plutôt que de re-déclencher une
//     comparaison (empêche un client de "réessayer" GetFaceLivenessSessionResults
//     indéfiniment sur une session déjà validée pour forcer un score différent
//     via une race condition, et empêche un rejeu après expiration serveur).
//   - TTL serveur de 5 minutes sur la liaison (la session AWS elle-même a
//     une durée de vie de quelques minutes ; on s'aligne dessus).
//   - Le score de vivacité (Confidence AWS) ET le score d'identité
//     (CompareFaces) sont TOUS LES DEUX nécessaires : l'un prouve
//     "personne réelle présente", l'autre "c'est la bonne personne".
//     Un dossier n'est marqué "vérifié" que si les deux seuils sont
//     atteints.
//
// npm : aucune nouvelle dépendance — CreateFaceLivenessSessionCommand et
// GetFaceLivenessSessionResultsCommand font partie de @aws-sdk/client-rekognition,
// déjà utilisé pour CompareFaces.
// ============================================================================

import fs   from 'fs';
import fsp  from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import * as db from '../db';
import { compareWithRekognition, type FaceCompareResult } from './face-verify-shared';

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(), 'uploads', 'cni');

// Seuil de vivacité recommandé par AWS pour du KYC réglementé.
// (En-dessous, on considère la preuve de présence insuffisante.)
const LIVENESS_MIN_CONFIDENCE = parseFloat(process.env.LIVENESS_MIN_CONFIDENCE || '90');

// Durée de vie de la liaison sessionId → dossierId côté serveur.
const SESSION_TTL_MS = 5 * 60 * 1000;

// ── Lazy-load Rekognition (client Liveness) ──────────────────────────────────

interface LivenessClient {
  client: { send: (command: unknown) => Promise<unknown> };
  CreateFaceLivenessSessionCommand: new (input: Record<string, unknown>) => unknown;
  GetFaceLivenessSessionResultsCommand: new (input: Record<string, unknown>) => unknown;
}

let _liveness: LivenessClient | null = null;

function getLivenessClient(): LivenessClient {
  if (_liveness) return _liveness;
  const region = process.env.AWS_REGION;
  const keyId  = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !keyId || !secret) {
    throw new Error(
      'Variables AWS manquantes — vérifiez AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY dans .env'
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const {
    RekognitionClient,
    CreateFaceLivenessSessionCommand,
    GetFaceLivenessSessionResultsCommand,
  } = require('@aws-sdk/client-rekognition');
  _liveness = {
    client: new RekognitionClient({
      region,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    }),
    CreateFaceLivenessSessionCommand,
    GetFaceLivenessSessionResultsCommand,
  };
  return _liveness!;
}

export function getAwsFriendlyErrorMessage(err: unknown): string {
  if (err && typeof err === 'object') {
    const maybeErr = err as { name?: string; Code?: string; message?: string };
    const errorCode = maybeErr.name || maybeErr.Code;
    if (errorCode === 'AccessDeniedException') {
      return 'Service de vérification indisponible — contactez le support technique';
    }
    if (errorCode === 'UnsupportedRegion') {
      return 'Région AWS non prise en charge pour Face Liveness';
    }
    if (maybeErr.message) {
      return maybeErr.message;
    }
  }
  return 'Erreur AWS Rekognition';
}

// ── Liaison serveur sessionId → dossierId (JAMAIS fournie par le client) ────

interface LivenessSessionBinding {
  dossierId: string;
  createdAt: number;
  expiresAt: number;
}

const sessionBindings = new Map<string, LivenessSessionBinding>();

function cleanupExpiredBindings() {
  const now = Date.now();
  for (const [sid, binding] of sessionBindings) {
    if (binding.expiresAt < now) sessionBindings.delete(sid);
  }
}

// ── 1. Créer une session Face Liveness liée à un dossier ────────────────────

export interface CreateLivenessSessionResult {
  sessionId: string;
  region: string;
}

export async function createLivenessSessionForDossier(
  dossierId: string,
): Promise<CreateLivenessSessionResult> {
  const { client, CreateFaceLivenessSessionCommand } = getLivenessClient();
  const region = process.env.AWS_REGION!;

  // ClientRequestToken : idempotence AWS côté création (évite de créer deux
  // sessions si le client réémet la requête suite à un timeout réseau).
  const clientRequestToken = crypto.randomUUID();

  const result = await client.send(new CreateFaceLivenessSessionCommand({
    ClientRequestToken: clientRequestToken,
    Settings: {
      // 0 image d'audit par défaut : on ne stocke pas d'images intermédiaires
      // additionnelles, seule l'image de référence (nécessaire à la
      // comparaison d'identité) est récupérée dans GetFaceLivenessSessionResults.
      // Passer à 1-4 si un dossier d'audit visuel est requis réglementairement.
      AuditImagesLimit: parseInt(process.env.LIVENESS_AUDIT_IMAGES_LIMIT || '0', 10),
      // Pas d'OutputConfig (pas de bucket S3) : les images sont renvoyées en
      // octets bruts directement dans GetFaceLivenessSessionResults, donc
      // aucune infrastructure S3 supplémentaire à sécuriser pour démarrer.
      // À activer plus tard si un stockage d'audit long terme est requis
      // (avec KmsKeyId pour chiffrement).
    },
  })) as { SessionId?: string };

  const sessionId = result.SessionId;
  if (!sessionId) {
    throw new Error('AWS n’a pas renvoyé de SessionId');
  }

  cleanupExpiredBindings();
  const now = Date.now();
  sessionBindings.set(sessionId, {
    dossierId,
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
  });

  return { sessionId, region };
}

// ── 2. Récupérer + traiter le résultat d'une session ─────────────────────────

export interface LivenessResult {
  success: boolean;
  error?: string;
  liveness_status: 'SUCCEEDED' | 'FAILED' | 'EXPIRED' | 'IN_PROGRESS' | 'CREATED' | 'ERROR';
  liveness_confidence: number | null;
  is_live: boolean;
  identity: FaceCompareResult | null;
  verified: boolean; // vivacité ET identité au-dessus des seuils
}

export async function resolveLivenessSessionForDossier(
  dossierId: string,
  sessionId: string,
): Promise<LivenessResult> {
  cleanupExpiredBindings();

  // ── Vérification CRITIQUE : la session doit avoir été créée pour CE dossier ─
  const binding = sessionBindings.get(sessionId);
  if (!binding) {
    return {
      success: false,
      error: 'Session inconnue, expirée, ou déjà utilisée',
      liveness_status: 'ERROR',
      liveness_confidence: null,
      is_live: false,
      identity: null,
      verified: false,
    };
  }
  if (binding.dossierId !== dossierId) {
    // Tentative de rejouer une session créée pour un autre dossier —
    // on journalise explicitement car c'est un signal de fraude potentielle.
    db.audit(null, 'LIVENESS_SESSION_MISMATCH', `session=${sessionId} attendu=${binding.dossierId} recu=${dossierId}`);
    return {
      success: false,
      error: 'Session non associée à ce dossier',
      liveness_status: 'ERROR',
      liveness_confidence: null,
      is_live: false,
      identity: null,
      verified: false,
    };
  }

  // Usage unique : on retire la liaison immédiatement, avant même l'appel AWS,
  // pour empêcher deux requêtes concurrentes de traiter la même session deux fois.
  sessionBindings.delete(sessionId);

  const { client, GetFaceLivenessSessionResultsCommand } = getLivenessClient();

  let awsResult: {
    Status?: string;
    Confidence?: number;
    ReferenceImage?: { Bytes?: Uint8Array | Buffer };
  };
  try {
    awsResult = await client.send(
      new GetFaceLivenessSessionResultsCommand({ SessionId: sessionId }),
    ) as typeof awsResult;
  } catch (err) {
    db.audit(null, 'LIVENESS_AWS_ERROR', `id=${dossierId} session=${sessionId} err=${err instanceof Error ? err.message : String(err)}`);
    return {
      success: false,
      error: getAwsFriendlyErrorMessage(err),
      liveness_status: 'ERROR',
      liveness_confidence: null,
      is_live: false,
      identity: null,
      verified: false,
    };
  }

  const status = (awsResult.Status as LivenessResult['liveness_status']) ?? 'ERROR';
  const confidence = typeof awsResult.Confidence === 'number' ? Math.round(awsResult.Confidence * 10) / 10 : null;
  const isLive = status === 'SUCCEEDED' && confidence !== null && confidence >= LIVENESS_MIN_CONFIDENCE;

  if (status !== 'SUCCEEDED') {
    await db.updateDossier(dossierId, {
      liveness_status: status,
      liveness_confidence: confidence,
      liveness_verifie_le: Math.floor(Date.now() / 1000),
    });
    db.audit(null, 'LIVENESS_CHECK', `id=${dossierId} status=${status} confidence=${confidence}`);
    return {
      success: true,
      liveness_status: status,
      liveness_confidence: confidence,
      is_live: false,
      identity: null,
      verified: false,
    };
  }

  // ── Identité : comparer l'image de référence (extraite par AWS depuis la
  //    session vidéo — non falsifiable par le client) à la photo recto CNI ──
  let identity: FaceCompareResult | null = null;
  const referenceBytes = awsResult.ReferenceImage?.Bytes;

  if (referenceBytes) {
    const referenceBuffer = Buffer.isBuffer(referenceBytes) ? referenceBytes : Buffer.from(referenceBytes);

    const dossier = await db.getDossierById(dossierId);
    if (dossier?.photo_recto) {
      const base = path.resolve(UPLOAD_CNI) + path.sep;
      const rectoFull = path.resolve(UPLOAD_CNI, dossier.photo_recto.trim());
      if (rectoFull.startsWith(base) && fs.existsSync(rectoFull)) {
        const rectoBuffer = await fsp.readFile(rectoFull);
        identity = await compareWithRekognition(referenceBuffer, rectoBuffer);
      } else {
        identity = { score: 0, match: 0, motif: 'photo_recto_introuvable_disque' };
      }
    } else {
      identity = { score: 0, match: 0, motif: 'photo_recto_manquante' };
    }

    // Sauvegarder l'image de référence AWS comme nouvelle photo_live —
    // c'est une image dont la provenance est garantie par AWS (extraite
    // pendant la session live), contrairement à un upload libre du client.
    try {
      const date = new Date().toLocaleDateString('en-CA');
      const destDir = path.join(UPLOAD_CNI, date);
      await fsp.mkdir(destDir, { recursive: true });
      const filename = `${dossierId}_live_${crypto.randomBytes(4).toString('hex')}.jpg`;
      await fsp.writeFile(path.join(destDir, filename), referenceBuffer, { mode: 0o644 });
      await db.updateDossier(dossierId, { photo_live: `${date}/${filename}` });
    } catch (err) {
      console.error('[LIVENESS] échec sauvegarde image de référence', err);
    }
  } else {
    identity = { score: 0, match: 0, motif: 'image_reference_absente' };
  }

  const verified = isLive && identity !== null && identity.match === 1;

  await db.updateDossier(dossierId, {
    liveness_status: status,
    liveness_confidence: confidence,
    liveness_verifie_le: Math.floor(Date.now() / 1000),
    score_visage: identity?.score ?? null,
    visage_match: identity?.match ?? null,
    visage_motif: identity?.motif ?? null,
    visage_verifie_le: Math.floor(Date.now() / 1000),
  });

  db.audit(
    null,
    'LIVENESS_CHECK',
    `id=${dossierId} confidence=${confidence} identity_score=${identity?.score} verified=${verified}`,
  );

  return {
    success: true,
    liveness_status: status,
    liveness_confidence: confidence,
    is_live: isLive,
    identity,
    verified,
  };
}
