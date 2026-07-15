// ============================================================================
// KYC V4 — face-verify.ts (TypeScript)
// Routes :
//   POST /api/dossiers/verify-face-realtime       → compare live vs recto CNI
//   POST /api/public/dossiers/:id/live            → [NOUVEAU] upload photo live
//                                                    + appel Rekognition auto
//   POST /api/dossiers/complete-with-face-verify  → création dossier final
//   POST /api/dossiers/prepare-verify-session     → génère session + URL
// ============================================================================

import fs   from 'fs';
import fsp  from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

const UPLOAD_CNI  = process.env.UPLOAD_CNI  || path.join(process.cwd(), 'uploads', 'cni');
const MAX_FRAME_B = 10 * 1024 * 1024; // 10 Mo
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);
const REKOG_SIMILARITY_THRESHOLD = parseInt(process.env.REKOG_SIMILARITY_THRESHOLD || '50', 10);
const FACE_MATCH_THRESHOLD = parseFloat(process.env.FACE_MATCH_THRESHOLD || '70');

// ── Helpers ───────────────────────────────────────────────────────────────────

function isBlank(v: unknown): boolean {
  return !v || v === 'null' || v === 'undefined' || String(v).trim() === '';
}

function resolveCNIPath(relative: string): string | null {
  if (isBlank(relative)) return null;
  const base = path.resolve(UPLOAD_CNI) + path.sep;
  const full = path.resolve(UPLOAD_CNI, relative.trim());
  if (!full.startsWith(base)) return null;
  if (!fs.existsSync(full))   return null;
  return full;
}

function nowDate() { return new Date().toLocaleDateString('en-CA'); }
function nowTime() { return new Date().toTimeString().slice(0, 5); }
function nowSec()  { return Math.floor(Date.now() / 1000); }

// ── Lazy-load Rekognition ─────────────────────────────────────────────────────

let _rek: { client: { send: (command: unknown) => Promise<unknown> }; CompareFacesCommand: new (input: Record<string, unknown>) => unknown } | null = null;

function getRek() {
  if (_rek) return _rek;
  const region = process.env.AWS_REGION;
  const keyId  = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !keyId || !secret) {
    throw new Error(
      'Variables AWS manquantes — vérifiez AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY dans .env'
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

// ── Rekognition compare helper ────────────────────────────────────────────────

async function compareWithRekognition(
  liveBuffer: Buffer,
  rectoBuffer: Buffer
): Promise<{ score: number; match: number; motif: string }> {
  const { client, CompareFacesCommand } = getRek();
  const result = await client.send(new CompareFacesCommand({
    SourceImage:         { Bytes: liveBuffer },
    TargetImage:         { Bytes: rectoBuffer },
    SimilarityThreshold: REKOG_SIMILARITY_THRESHOLD,
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
  const match = score >= FACE_MATCH_THRESHOLD ? 1 : 0;
  const motif = score >= FACE_MATCH_THRESHOLD ? 'Visage correspondant' : score > 0 ? 'Score insuffisant' : 'Aucune correspondance';
  return { score, match, motif };
}

export async function verifierVisageAuto(dossierId: string): Promise<void> {
  if (!process.env.AWS_ACCESS_KEY_ID) return;

  try {
    const dossier = await db.getDossierById(dossierId);
    if (!dossier?.photo_live || !dossier.photo_recto) return;

    const liveFull  = path.join(UPLOAD_CNI, dossier.photo_live);
    const rectoFull = path.join(UPLOAD_CNI, dossier.photo_recto);
    if (!fs.existsSync(liveFull) || !fs.existsSync(rectoFull)) return;

    const liveBuffer = await fsp.readFile(liveFull);
    const rectoBuffer = await fsp.readFile(rectoFull);
    const { score, match, motif } = await compareWithRekognition(liveBuffer, rectoBuffer);

    await db.updateDossier(dossierId, {
      score_visage: score,
      visage_match: match,
      visage_motif: motif,
      visage_verifie_le: nowSec(),
    });

    db.audit(null, 'FACE_VERIFY_AUTO', `id=${dossierId} score=${score} match=${match} motif=${motif}`);
  } catch (err) {
    db.audit(null, 'FACE_VERIFY_AUTO_ERR', `id=${dossierId} err=${err instanceof Error ? err.message : String(err)}`);
  }
}

// ── Sessions en mémoire (TTL 30 min) ─────────────────────────────────────────

interface VerifySession {
  sessionId: string;
  numero_mtn: string;
  country: string;
  recto_path: string;
  verso_path: string;
  wa_agent: string;
  username_agent: string;
  fonction_agent: string;
  zone_agent: string;
  created_at: number;
  expires_at: number;
}

const verifySessions = new Map<string, VerifySession>();

// ── Plugin Fastify ────────────────────────────────────────────────────────────

export async function faceVerifyRoutes(app: FastifyInstance): Promise<void> {

  // ==========================================================================
  // POST /api/dossiers/verify-face-realtime
  // Compare le frame live capturé vs la photo recto CNI (déjà sur disque).
  // Auth : pas requise (appelé depuis la page terrain HTML publique).
  // ==========================================================================
  app.post('/api/dossiers/verify-face-realtime', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'Format multipart attendu' });
    }

    let frameBuffer: Buffer | null = null;
    let rectoPath: string | null   = null;

    try {
      for await (const part of req.parts()) {
        if (part.type === 'file' && part.fieldname === 'video_frame') {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of part.file) {
            size += chunk.length;
            if (size > MAX_FRAME_B) {
              return reply.code(413).send({ error: `Frame trop volumineuse (max 10 Mo)` });
            }
            chunks.push(chunk);
          }
          frameBuffer = Buffer.concat(chunks);
        } else if (part.type === 'field' && part.fieldname === 'recto_path') {
          rectoPath = String(part.value ?? '');
        } else if (part.type === 'file') {
          for await (const _ of part.file) { /* drain */ }
        }
      }
    } catch {
      return reply.code(400).send({ error: 'Requête multipart malformée' });
    }

    if (!frameBuffer || frameBuffer.length === 0) {
      return reply.code(400).send({ error: 'Champ video_frame manquant ou vide' });
    }
    if (isBlank(rectoPath)) {
      return reply.code(400).send({ error: 'Champ recto_path manquant' });
    }

    const rectoFull = resolveCNIPath(rectoPath!);
    if (!rectoFull) {
      return reply.code(400).send({
        error: 'Photo recto introuvable ou chemin invalide',
        hint:  'Vérifiez que la photo recto CNI a bien été enregistrée à l\'étape 1',
      });
    }

    const awsConfigured = Boolean(
      process.env.AWS_REGION &&
      process.env.AWS_ACCESS_KEY_ID &&
      process.env.AWS_SECRET_ACCESS_KEY
    );

    // AWS non configuré → mode dégradé, validation manuelle uniquement
    if (!awsConfigured) {
      return reply.send({
        success: true,
        aws_configured: false,
        score: null,
        match: null,
        motif: 'aws_non_configure',
        message: 'Score non disponible (AWS non configuré). La validation sera effectuée manuellement par un agent.',
      });
    }

    try {
      const rectoBuffer = await fsp.readFile(rectoFull);
      const { score, match, motif } = await compareWithRekognition(frameBuffer, rectoBuffer);

      return reply.send({
        success: true,
        aws_configured: true,
        score,
        match:   match === 1,
        motif,
        message: `Score de similarité : ${score}%. ${
          match === 1 ? 'Visage correspondant.' : 'La validation sera effectuée manuellement par un agent.'
        }`,
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'Erreur Rekognition';
      app.log.error('[FACE-VERIFY-RT] Rekognition error: %s', msg);
      app.log.error(err);
      return reply.send({
        success: true,
        aws_configured: true,
        score: null,
        match: null,
        motif: `erreur_rekognition: ${msg}`,
        message: 'Vérification faciale non disponible. La validation sera effectuée manuellement par un agent.',
      });
    }
  });

  // POST /api/dossiers/prepare-verify-session
  // Génère une session et retourne les paramètres pour la redirection.
  // Auth : pas requise.
  // ==========================================================================
  app.post('/api/dossiers/prepare-verify-session', async (req, reply) => {
    const body = req.body as {
      numero_mtn?:    string;
      country?:       string;
      recto_path?:    string;
      verso_path?:    string;
      wa_agent?:      string;
      username_agent?: string;
      fonction_agent?: string;
      zone_agent?:    string;
    } | null;

    if (!body?.numero_mtn || !body.recto_path || !body.verso_path) {
      return reply.code(400).send({ error: 'numero_mtn, recto_path et verso_path requis' });
    }

    const sessionId = crypto.randomBytes(24).toString('hex');
    const now       = nowSec();

    const session: VerifySession = {
      sessionId,
      numero_mtn:     body.numero_mtn,
      country:        body.country       ?? '',
      recto_path:     body.recto_path,
      verso_path:     body.verso_path,
      wa_agent:       body.wa_agent      ?? '',
      username_agent: body.username_agent ?? '',
      fonction_agent: body.fonction_agent ?? '',
      zone_agent:     body.zone_agent    ?? '',
      created_at:     now,
      expires_at:     now + 1800,
    };

    verifySessions.set(sessionId, session);

    // Nettoyage TTL des sessions expirées
    for (const [k, v] of verifySessions) {
      if (v.expires_at < now) verifySessions.delete(k);
    }

    return reply.send({ success: true, sessionId });
  });

  // ==========================================================================
  // GET /api/dossiers/verify-session/:id
  // ==========================================================================
  app.get<{ Params: { id: string } }>(
    '/api/dossiers/verify-session/:id',
    async (req, reply) => {
      const session = verifySessions.get(req.params.id);
      if (!session) {
        return reply.code(404).send({ error: 'Session expirée ou introuvable' });
      }
      if (session.expires_at < nowSec()) {
        verifySessions.delete(req.params.id);
        return reply.code(410).send({ error: 'Session expirée' });
      }
      return reply.send({ success: true, session });
    }
  );

  // ==========================================================================
  // POST /api/dossiers/complete-with-face-verify
  // Création dossier final depuis la page face-verify-interactive.
  // Auth : pas requise (flux terrain public).
  // Body (multipart) :
  //   video_frame, numero_mtn, wa_agent, username_agent,
  //   fonction_agent, zone_agent, recto_path, verso_path,
  //   score_visage, visage_match, visage_motif
  // ==========================================================================
  app.post('/api/dossiers/complete-with-face-verify', async (req, reply) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ error: 'Format multipart attendu' });
    }

    try {
      const fields: Record<string, string> = {};
      let liveBuffer: Buffer | null = null;
      let liveMime = 'image/jpeg';

      for await (const part of req.parts()) {
        if (part.type === 'field') {
          fields[part.fieldname] = String(part.value ?? '');
        } else if (part.type === 'file' && part.fieldname === 'video_frame') {
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of part.file) {
            size += chunk.length;
            if (size > MAX_FRAME_B) {
              return reply.code(413).send({ error: 'Frame trop volumineuse (max 10 Mo)' });
            }
            chunks.push(chunk);
          }
          liveBuffer = Buffer.concat(chunks);
          liveMime   = part.mimetype;
        } else if (part.type === 'file') {
          for await (const _ of part.file) { /* drain */ }
        }
      }

      const {
        numero_mtn, wa_agent, username_agent, fonction_agent, zone_agent,
        recto_path, verso_path, score_visage, visage_match, visage_motif, dossier_id,
      } = fields;

      // Validation
      if (isBlank(numero_mtn)) {
        return reply.code(400).send({ error: 'numero_mtn manquant' });
      }
      if (isBlank(recto_path)) {
        return reply.code(400).send({ error: 'recto_path manquant — étape 1 incomplète' });
      }
      if (isBlank(verso_path)) {
        return reply.code(400).send({ error: 'verso_path manquant — étape 1 incomplète' });
      }
      if (!liveBuffer || liveBuffer.length === 0) {
        return reply.code(400).send({ error: 'Frame live (video_frame) manquante' });
      }

      const rectoFull = resolveCNIPath(recto_path);
      const versoFull = resolveCNIPath(verso_path);
      if (!rectoFull) return reply.code(400).send({ error: 'Photo recto introuvable : ' + recto_path });
      if (!versoFull) return reply.code(400).send({ error: 'Photo verso introuvable : ' + verso_path });

      // Enregistrer photo live sur disque
      const date    = nowDate();
      const dateDir = path.join(UPLOAD_CNI, date);
      await fsp.mkdir(dateDir, { recursive: true });

      const ext          = liveMime === 'image/png' ? 'png' : liveMime === 'image/webp' ? 'webp' : 'jpg';
      const id           = `KYC${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
      const liveFilename = `${id}_live.${ext}`;
      await fsp.writeFile(path.join(dateDir, liveFilename), liveBuffer, { mode: 0o644 });
      const livePath = `${date}/${liveFilename}`;

      // Score et match depuis les champs (déjà calculés côté HTML) ou recalcul Rekognition
      let score: number | null = null;
      let matchVal: number | null = null;
      let motif: string = visage_motif || 'verification_manuelle';

      if (!isBlank(score_visage)) {
        score = parseFloat(score_visage);
      }
      if (!isBlank(visage_match)) {
        const parsedMatch = parseInt(visage_match, 10);
        if (!Number.isNaN(parsedMatch)) matchVal = parsedMatch;
      }
      if (matchVal === null && score !== null) {
        matchVal = score >= FACE_MATCH_THRESHOLD ? 1 : 0;
      }

      // Si AWS configuré et score pas encore calculé → recalcul
      if (score === null && process.env.AWS_ACCESS_KEY_ID) {
        try {
          const rectoBuffer = await fsp.readFile(rectoFull);
          const result = await compareWithRekognition(liveBuffer, rectoBuffer);
          score    = result.score;
          matchVal = matchVal ?? result.match;
          motif    = result.motif;
        } catch (err) {
          console.error('[FACE-VERIFY-COMPLETE]', err);
          motif = 'erreur_rekognition';
        }
      }

      // Normaliser le numéro MTN (chiffres seulement) pour la base et la réponse
      const cleanedNumero = numero_mtn.trim().replace(/\D/g, '');
      const numDigits = cleanedNumero;

      const dossierId = dossier_id?.trim();
      const existingDossier = dossierId ? await db.getDossierById(dossierId) : null;

      if (existingDossier) {
        await db.updateDossier(dossierId, {
          photo_live: livePath,
          score_visage: score ?? null,
          visage_match: matchVal ?? null,
          visage_motif: motif,
          visage_verifie_le: nowSec(),
        });
        db.audit(null, 'DOSSIER_FACE_VERIFY_MISE_A_JOUR', `id=${dossierId} score=${score} match=${matchVal}`, req.ip);
        return reply.code(200).send({
          success: true,
          aws_configured: Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
          id: dossierId,
          numero: numDigits,
          ref: dossierId,
          score_visage: score,
          visage_match: matchVal === 1,
          visage_motif: motif,
          message: score !== null
            ? `Dossier mis à jour. Score Rekognition : ${score}%`
            : 'Dossier mis à jour. Vérification faciale non effectuée (AWS non configuré).',
        });
      }

      // Créer le dossier en base
      await db.createDossier({
        id,
        numero_mtn:     cleanedNumero,
        wa_agent:       wa_agent       || undefined,
        username_agent: username_agent || undefined,
        fonction_agent: fonction_agent || undefined,
        zone_agent:     zone_agent     || undefined,
        date,
        heure_reception: nowTime(),
        photo_recto:    recto_path.trim(),
        photo_verso:    verso_path.trim(),
        photo_live:     livePath,
        score_visage:   score ?? null,
        visage_match:   matchVal ?? null,
        visage_motif:   motif,
        visage_verifie_le: nowSec(),
      });

      db.audit(null, 'DOSSIER_FACE_VERIFY_CREE', `id=${id} score=${score} match=${matchVal}`, req.ip);

      return reply.code(201).send({
        success:      true,
        aws_configured: Boolean(process.env.AWS_REGION && process.env.AWS_ACCESS_KEY_ID && process.env.AWS_SECRET_ACCESS_KEY),
        id,
        numero:      numDigits,
        ref:          id,
        score_visage: score,
        visage_match: matchVal === 1,
        visage_motif: motif,
        message:      score !== null
          ? `Dossier créé. Score Rekognition : ${score}%`
          : 'Dossier créé. Vérification faciale non effectuée (AWS non configuré).',
      });

    } catch (err) {
      console.error('[COMPLETE-WITH-FACE-VERIFY]', err);
      return reply.code(500).send({
        error:   'Erreur lors de la création du dossier',
        details: err instanceof Error ? err.message : String(err),
      });
    }
  });
}