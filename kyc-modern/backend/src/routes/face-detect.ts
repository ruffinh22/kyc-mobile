// ============================================================================
// Détection faciale temps réel - KYC V4 (TypeScript)
// Vérification faciale interactive avec capture vidéo live
// ============================================================================
import { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import { RekognitionClient, CompareFacesCommand } from '@aws-sdk/client-rekognition';
import * as db from '../db';
import { query, exec } from '../db';

// Configuration
const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(), 'uploads', 'cni');
const MAX_FRAME_MB = 10;
const MAX_FRAME_B = MAX_FRAME_MB * 1024 * 1024;

// Helpers
function isBlank(v: string | null | undefined): boolean {
  return !v || v === 'null' || v === 'undefined' || v.trim() === '';
}

function resolveCNIPath(relativePath: string | null | undefined): { full: string } | null {
  if (isBlank(relativePath)) return null;
  const base = path.resolve(UPLOAD_CNI) + path.sep;
  const full = path.resolve(UPLOAD_CNI, relativePath!.trim());
  if (!full.startsWith(base)) return null;
  return { full };
}

// Lazy-load AWS Rekognition client
let rekClient: { client: RekognitionClient; CompareFacesCommand: typeof CompareFacesCommand } | null = null;

function getRekClient() {
  if (rekClient) return rekClient;

  const region = process.env.AWS_REGION;
  const keyId = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !keyId || !secret) {
    throw new Error(
      'Configuration AWS incomplète — vérifiez AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY'
    );
  }

  rekClient = {
    client: new RekognitionClient({ region }),
    CompareFacesCommand
  };
  return rekClient;
}

export async function faceDetectRoutes(app: any): Promise<void> {
  app.register(async function (fastify) {
    // POST /api/dossiers/verify-face-realtime
    // Comparaison live vs recto CNI
    fastify.post('/api/dossiers/verify-face-realtime', async (request: FastifyRequest, reply) => {
      fastify.log.info('verify-face-realtime — début');

      let frameBuffer: Buffer | null = null;
      let rectoPath: string | null = null;

      // Lecture multipart
      try {
        for await (const part of request.parts()) {
          if (part.type === 'file' && part.fieldname === 'video_frame') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            frameBuffer = Buffer.concat(chunks);
          } else if (part.type === 'field' && part.fieldname === 'recto_path') {
            rectoPath = part.value as string;
          } else if (part.type === 'file') {
            // Drainer les fichiers non attendus
            for await (const _ of part.file) { /* drain */ }
          }
        }
      } catch (parseErr) {
        fastify.log.error('verify-face-realtime — erreur lecture multipart : ' + (parseErr as Error).message);
        return reply.code(400).send({ error: 'Requête multipart malformée' });
      }

      // Validation
      if (!frameBuffer || frameBuffer.length === 0) {
        return reply.code(400).send({ error: 'Champ video_frame manquant ou vide' });
      }
      if (frameBuffer.length > MAX_FRAME_B) {
        return reply.code(413).send({ error: `Frame trop volumineuse (max ${MAX_FRAME_MB} Mo)` });
      }
      if (isBlank(rectoPath)) {
        return reply.code(400).send({ error: 'Champ recto_path manquant ou invalide' });
      }

      const resolved = resolveCNIPath(rectoPath);
      if (!resolved) {
        return reply.code(400).send({
          error: 'Photo recto introuvable ou chemin invalide',
          hint: 'Vérifiez que la photo recto CNI a bien été enregistrée à l\'étape 1'
        });
      }

      // Comparaison AWS Rekognition
      try {
        const rectoBuffer = await fs.readFile(resolved.full);
        const { client, CompareFacesCommand } = getRekClient();

        const result = await client.send(new CompareFacesCommand({
          SourceImage: { Bytes: frameBuffer },
          TargetImage: { Bytes: rectoBuffer },
          SimilarityThreshold: 50
        }));

        const faceMatches = result.FaceMatches || [];
        let score = 0;
        let motif = 'aucun_visage';

        if (faceMatches.length > 0) {
          score = Math.round((faceMatches[0].Similarity || 0) * 10) / 10;
          motif = 'verification_manuelle';
        } else {
          const unmatched = result.UnmatchedFaces || [];
          motif = unmatched.length === 0 ? 'aucun_visage_selfie' : 'aucun_visage_cni';
        }

        fastify.log.info(`verify-face-realtime — score=${score} motif=${motif}`);

        return reply.send({
          success: true,
          score,
          match: null,
          motif,
          message: `Score de similarité : ${score}%. La validation sera effectuée manuellement par un agent.`
        });

      } catch (err) {
        fastify.log.error('verify-face-realtime — erreur Rekognition : ' + (err as Error).message);
        return reply.code(502).send({
          error: 'Erreur AWS Rekognition',
          details: (err as Error).message
        });
      }
    });

    // POST /api/dossiers/prepare-verify-session
    // Génère un sessionId et retourne l'URL de redirection
    fastify.post('/api/dossiers/prepare-verify-session', async (request: FastifyRequest, reply) => {
      fastify.log.info('prepare-verify-session — début');

      const body = request.body as Record<string, any>;
      const {
        numero_mtn, recto_path, verso_path,
        wa_agent, username_agent, fonction_agent, zone_agent
      } = body;

      const errors: Record<string, string> = {};
      if (isBlank(numero_mtn)) errors.numero_mtn = 'manquant';
      if (isBlank(recto_path)) errors.recto_path = 'manquant';
      if (isBlank(verso_path)) errors.verso_path = 'manquant';
      if (isBlank(wa_agent)) errors.wa_agent = 'manquant';

      if (Object.keys(errors).length > 0) {
        fastify.log.warn('prepare-verify-session — champs manquants : ' + JSON.stringify(errors));
        return reply.code(400).send({ error: 'Champs obligatoires manquants', details: errors });
      }

      const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);

      const params = new URLSearchParams({
        session: sessionId,
        recto: recto_path.trim(),
        numero: numero_mtn.trim(),
        wa: wa_agent.trim()
      });

      if (!isBlank(verso_path)) params.set('verso', verso_path.trim());
      if (!isBlank(username_agent)) params.set('username', username_agent.trim());
      if (!isBlank(fonction_agent)) params.set('fonction', fonction_agent.trim());
      if (!isBlank(zone_agent)) params.set('zone', zone_agent.trim());

      fastify.log.info(`prepare-verify-session — sessionId=${sessionId}`);

      return reply.send({
        success: true,
        sessionId,
        redirectUrl: `/face-verify-interactive?${params.toString()}`
      });
    });

    // POST /api/dossiers/complete-with-face-verify
    // Création finale du dossier KYC avec vérification faciale
    fastify.post('/api/dossiers/complete-with-face-verify', async (request: FastifyRequest, reply) => {
      const ip = request.ip;
      const ua = (request.headers as Record<string, string>)['user-agent'] || '';

      fastify.log.info(`complete-with-face-verify — début (ip=${ip})`);

      if (!request.isMultipart()) {
        return reply.code(400).send({ error: 'Format multipart attendu' });
      }

      try {
        const fields: Record<string, any> = {};
        let liveBuffer: Buffer | null = null;
        let liveMime: string | null = null;

        for await (const part of request.parts()) {
          if (part.type === 'field') {
            fields[part.fieldname] = part.value;
          } else if (part.type === 'file' && part.fieldname === 'video_frame') {
            const chunks: Buffer[] = [];
            for await (const chunk of part.file) chunks.push(chunk);
            liveBuffer = Buffer.concat(chunks);
            liveMime = part.mimetype;
          } else if (part.type === 'file') {
            for await (const _ of part.file) { /* drain */ }
          }
        }

        const {
          numero_mtn, wa_agent, username_agent, fonction_agent, zone_agent,
          recto_path, verso_path, score_visage, visage_match, visage_motif
        } = fields;

        // Validation
        if (isBlank(numero_mtn) || !/^01[0-9]{8}$/.test(numero_mtn.trim())) {
          return reply.code(400).send({ error: 'Numéro MTN invalide — 10 chiffres commençant par 01 requis' });
        }
        if (!isBlank(wa_agent) && !/^01[0-9]{8}$/.test(wa_agent.trim())) {
          return reply.code(400).send({ error: 'WhatsApp agent invalide — 10 chiffres commençant par 01 requis' });
        }
        if (isBlank(recto_path)) {
          return reply.code(400).send({
            error: 'recto_path manquant — étape 1 incomplète',
            hint: 'La photo recto CNI n\'a pas été transmise correctement'
          });
        }
        if (isBlank(verso_path)) {
          return reply.code(400).send({
            error: 'verso_path manquant — étape 1 incomplète',
            hint: 'Vérifiez que la photo verso CNI a bien été uploadée à l\'étape 1'
          });
        }
        if (!liveBuffer || liveBuffer.length === 0) {
          return reply.code(400).send({ error: 'Frame live (video_frame) manquante ou vide' });
        }
        if (liveBuffer.length > MAX_FRAME_B) {
          return reply.code(413).send({ error: `Frame trop volumineuse (max ${MAX_FRAME_MB} Mo)` });
        }

        const rectoResolved = resolveCNIPath(recto_path);
        if (!rectoResolved) {
          return reply.code(400).send({ error: 'Chemin recto_path invalide ou fichier introuvable : ' + recto_path });
        }
        const versoResolved = resolveCNIPath(verso_path);
        if (!versoResolved) {
          return reply.code(400).send({
            error: 'Chemin verso_path invalide ou fichier introuvable : ' + verso_path,
            hint: 'Vérifiez que la photo verso CNI a bien été enregistrée à l\'étape 1'
          });
        }


        // Anti-doublon
        const dateJour = new Date().toISOString().slice(0, 10);
        const rows = await query(
          `SELECT statut FROM dossiers
           WHERE numero_mtn = ? AND date = ?
             AND statut IN ('en_attente','en_cours','accepte')
             LIMIT 1`,
          [numero_mtn.trim(), dateJour]
        );
        const existant = rows[0] as { statut: string } | undefined;

        if (existant) {
          const libelle =
            existant.statut === 'accepte' ? 'déjà accepté' :
            existant.statut === 'en_cours' ? 'en cours de traitement' :
            'en attente de certification';
          return reply.code(409).send({
            error: `Ce numéro a déjà été soumis aujourd'hui (${libelle}). ` +
                   'Il ne peut être renvoyé que s\'il a été rejeté.'
          });
        }

        // Génération ID et métadonnées
        const now = new Date();
        const date = now.toISOString().slice(0, 10);
        const heure = now.toTimeString().slice(0, 5);
        const ts = Math.floor(Date.now() / 1000);
        const id = 'D' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');

        // Écriture frame live
        const dateDir = path.join(UPLOAD_CNI, date);
        await fs.mkdir(dateDir, { recursive: true, mode: 0o755 });
        const liveExt = liveMime === 'image/png' ? 'png' : liveMime === 'image/webp' ? 'webp' : 'jpg';
        const liveFilename = `${id}_live.${liveExt}`;
        const liveFullPath = path.join(dateDir, liveFilename);
        await fs.writeFile(liveFullPath, liveBuffer, { mode: 0o644 });
        const livePath = `${date}/${liveFilename}`;

        // Validation manuelle uniquement
        const score = (!isBlank(score_visage) && score_visage !== undefined) ? Number(score_visage) : null;
        const statut_final = 'en_attente';
        const raison_rejet_final = null;
        let motif = visage_motif || 'verification_manuelle';
        const match = null;

        if (score !== null) {
          motif = `verification_manuelle_score_${score.toFixed(1)}_pct`;
        }

        // Insertion en base
        await exec(`
          INSERT INTO dossiers (
            id, numero_mtn, wa_agent, username_agent, fonction_agent, zone_agent,
            ligne, date, heure_reception, statut, raison_rejet,
            photo_recto, photo_verso, photo_live,
            score_visage, visage_match, visage_motif, visage_verifie_le,
            created_at
          ) VALUES (
            ?, ?, ?, ?, ?, ?,
            'Acquisition Interactive', ?, ?, ?, ?,
            ?, ?, ?,
            ?, ?, ?, ?,
            ?
          )
        `, [
          id,
          numero_mtn.trim(),
          !isBlank(wa_agent) ? wa_agent.trim() : null,
          !isBlank(username_agent) ? username_agent.trim() : null,
          !isBlank(fonction_agent) ? fonction_agent.trim() : null,
          !isBlank(zone_agent) ? zone_agent.trim() : null,
          date,
          heure,
          statut_final,
          raison_rejet_final,
          recto_path.trim(),
          verso_path.trim(),
          livePath,
          score,
          match,
          motif,
          ts,
          ts
        ]);

        fastify.log.info(`complete-with-face-verify — dossier créé ${id}`);

        return reply.send({
          success: true,
          id,
          statut: statut_final,
          score,
          motif,
          message: 'Dossier créé avec succès. Validation manuelle requise.'
        });

      } catch (err) {
        fastify.log.error('complete-with-face-verify — erreur : ' + (err as Error).message);
        return reply.code(500).send({
          error: 'Erreur serveur',
          details: (err as Error).message
        });
      }
    });
  });
}
