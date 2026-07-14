// ============================================================================
// KYC V4 — face-verify-shared.ts
// Logique Rekognition partagée entre face-verify.ts et public-dossiers.ts
// ============================================================================

import fs  from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import * as db from '../db';

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(), 'uploads', 'cni');

// ── Lazy-load Rekognition ─────────────────────────────────────────────────────

interface RekClient {
  client: { send: (command: unknown) => Promise<unknown> };
  CompareFacesCommand: new (input: Record<string, unknown>) => unknown;
}

let _rek: RekClient | null = null;

export function getRekognitionClient(): RekClient {
  if (_rek) return _rek;
  const region = process.env.AWS_REGION;
  const keyId  = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !keyId || !secret) {
    throw new Error(
      'Variables AWS manquantes — vérifiez dans .env : AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY'
    );
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition');
  _rek = {
    client: new RekognitionClient({
      region,
      credentials: { accessKeyId: keyId, secretAccessKey: secret },
    }),
    CompareFacesCommand,
  };
  return _rek!;
}

// ── compareWithRekognition ────────────────────────────────────────────────────

export interface FaceCompareResult {
  score:  number;       // 0–100
  match:  number;       // 1 = match, 0 = no match
  motif:  string;       // description textuelle
}

export async function compareWithRekognition(
  liveBuffer:  Buffer,
  rectoBuffer: Buffer,
): Promise<FaceCompareResult> {
  const { client, CompareFacesCommand } = getRekognitionClient();

  const result = await client.send(new CompareFacesCommand({
    SourceImage:         { Bytes: liveBuffer },   // frame capturée (selfie)
    TargetImage:         { Bytes: rectoBuffer },  // photo CNI recto
    SimilarityThreshold: 50,
  }));

  const matches = (result as { FaceMatches?: Array<{ Similarity: number }> }).FaceMatches ?? [];

  if (matches.length === 0) {
    const unmatched = (result as { UnmatchedFaces?: unknown[] }).UnmatchedFaces ?? [];
    return {
      score: 0,
      match: 0,
      motif: unmatched.length === 0 ? 'aucun_visage_selfie' : 'aucun_visage_cni',
    };
  }

  const score = Math.round((matches[0].Similarity ?? 0) * 10) / 10;
  const match = score >= 70 ? 1 : 0;
  const motif = score >= 70
    ? 'Visage correspondant'
    : score > 0
      ? 'Score insuffisant'
      : 'Aucune correspondance';

  return { score, match, motif };
}

// ── verifierVisageAutoById ────────────────────────────────────────────────────
// Utilisé par public-dossiers.ts route /api/public/dossiers/:id/live
// Prend le buffer live déjà lu + l'id du dossier (pour lire photo_recto depuis le disque).

export async function verifierVisageAutoById(
  dossierId:  string,
  liveBuffer: Buffer,
): Promise<FaceCompareResult> {
  const dossier = await db.getDossierById(dossierId);
  if (!dossier?.photo_recto) {
    return { score: 0, match: 0, motif: 'photo_recto_manquante' };
  }

  const base   = path.resolve(UPLOAD_CNI) + path.sep;
  const full   = path.resolve(UPLOAD_CNI, dossier.photo_recto.trim());
  if (!full.startsWith(base) || !fs.existsSync(full)) {
    return { score: 0, match: 0, motif: 'photo_recto_introuvable_disque' };
  }

  const rectoBuffer = await fsp.readFile(full);
  return compareWithRekognition(liveBuffer, rectoBuffer);
}

// ── verifierVisageAutoByPath ──────────────────────────────────────────────────
// Utilisé par face-verify.ts (route /api/dossiers/:id/verifier-visage back-office)
// Version qui prend les buffers directement depuis les chemins disque.

export async function verifierVisageAutoByPath(
  liveRelPath:  string,
  rectoRelPath: string,
): Promise<FaceCompareResult> {
  const base = path.resolve(UPLOAD_CNI) + path.sep;

  const liveResolved  = path.resolve(UPLOAD_CNI, liveRelPath.trim());
  const rectoResolved = path.resolve(UPLOAD_CNI, rectoRelPath.trim());

  if (!liveResolved.startsWith(base)  || !fs.existsSync(liveResolved)) {
    return { score: 0, match: 0, motif: 'photo_live_introuvable' };
  }
  if (!rectoResolved.startsWith(base) || !fs.existsSync(rectoResolved)) {
    return { score: 0, match: 0, motif: 'photo_recto_introuvable' };
  }

  const [liveBuffer, rectoBuffer] = await Promise.all([
    fsp.readFile(liveResolved),
    fsp.readFile(rectoResolved),
  ]);

  return compareWithRekognition(liveBuffer, rectoBuffer);
}
