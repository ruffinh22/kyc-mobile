// ============================================================================
// KYC V4 — public-dossiers.ts (TypeScript)
// Routes publiques terrain (sans auth)
//
// CORRECTIONS :
//   [FIX-1] POST /api/public/dossiers/:id/live  → [NOUVELLE ROUTE]
//            Upload photo_live + appel AWS Rekognition automatique
//   [FIX-2] POST /api/public/dossiers          → inchangé (recto/verso)
//   [FIX-3] Signaling WebRTC + sessions        → inchangés
// ============================================================================

import path   from 'path';
import fsp    from 'fs/promises';
import fs     from 'fs';
import crypto from 'crypto';
import { FastifyInstance, FastifyRequest } from 'fastify';
import * as db from '../db';

type WsSocket = any;

// ── Import de la fonction Rekognition depuis face-verify.ts ──────────────────
// On réexpose la logique via une fonction partagée pour éviter la duplication.
// Si tu préfères l'inline, copie compareWithRekognition() ici.
import { verifierVisageAutoById } from './face-verify-shared';

const UPLOAD_CNI   = process.env.UPLOAD_CNI || path.join(process.cwd(), 'uploads', 'cni');
const MAX_FILE     = 5  * 1024 * 1024; // 5 Mo pour recto/verso
const MAX_LIVE     = 10 * 1024 * 1024; // 10 Mo pour photo live
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// NOTE: session management for face-verify flows is handled in
// `face-verify.ts` to avoid duplicated route declarations.

// Peers WebRTC par wa_agent (signaling)
const signalingPeers = new Map<string, Set<WsSocket>>();
const terrainSockets = new Map<string, WsSocket>();
const terrainTokens = new Map<string, string>();

function normalizeNumero(value: string | undefined): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 20);
}

async function sendIncomingCallPush(params: {
  token: string;
  numero: string;
  numeroMtn: string;
  callUuid: string;
}): Promise<boolean> {
  const serverKey = process.env.FCM_SERVER_KEY || process.env.FCM_API_KEY;
  if (!params.token || !serverKey) return false;

  const payload = {
    to: params.token,
    priority: 'high',
    data: {
      type: 'incoming-call',
      numero: params.numero,
      numeroMtn: params.numeroMtn,
      callUuid: params.callUuid,
      sentAt: String(Date.now()),
    },
    android: {
      priority: 'high',
      notification: {
        title: 'Appel vidéo entrant',
        body: `Appel de ${params.numeroMtn}`,
      },
    },
  };

  try {
    const res = await fetch('https://fcm.googleapis.com/fcm/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `key=${serverKey}`,
      },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      console.warn('[FCM] push failed', res.status, text);
      return false;
    }

    return true;
  } catch (err) {
    console.warn('[FCM] push exception', err);
    return false;
  }
}

function nowDate() { return new Date().toLocaleDateString('en-CA'); }
function nowTime() { return new Date().toTimeString().slice(0, 5); }
function nowSec()  { return Math.floor(Date.now() / 1000); }

export async function publicDossierRoutes(app: FastifyInstance): Promise<void> {

  // ==========================================================================
  // POST /api/public/dossiers
  // Upload recto + verso CNI et crée le dossier en attente.
  // (inchangé — photo_live reste null ici, uploadée séparément via :id/live)
  // ==========================================================================
  app.post('/api/public/dossiers', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (req, reply) => {
    if (!req.isMultipart())
      return reply.code(400).send({ error: 'Format multipart attendu' });

    const fields: Record<string, string> = {};
    const photos: Record<string, { buf: Buffer; mime: string }> = {};

    try {
      const parts = req.parts();
      for await (const part of parts) {
        if (part.type === 'field') {
          fields[part.fieldname] = String(part.value ?? '');
        } else if (part.type === 'file') {
          if (!['photo_recto', 'photo_verso', 'photo_live'].includes(part.fieldname)) {
            part.file.resume(); continue;
          }
          if (!ALLOWED_MIME.has(part.mimetype)) { part.file.resume(); continue; }
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of part.file) {
            size += chunk.length;
            if (size > MAX_FILE) return reply.code(413).send({ error: 'Fichier trop volumineux (max 5 Mo)' });
            chunks.push(chunk);
          }
          photos[part.fieldname] = { buf: Buffer.concat(chunks), mime: part.mimetype };
        }
      }
    } catch { return reply.code(400).send({ error: 'Erreur lecture multipart' }); }

    const { wa_agent, username_agent, fonction_agent, zone_agent, numero_mtn, country } = fields;
    const normalizedWaAgent = String(wa_agent ?? '').replace(/\D/g, '');
    if (!numero_mtn?.trim()) return reply.code(400).send({ error: 'Numéro MTN requis' });
    if (!country?.trim())    return reply.code(400).send({ error: 'Pays requis' });
    if (!photos.photo_recto || !photos.photo_verso)
      return reply.code(400).send({ error: 'Photos recto et verso obligatoires' });

    const date    = nowDate();
    const destDir = path.join(UPLOAD_CNI, date);
    await fsp.mkdir(destDir, { recursive: true });

    const id = `KYC${Date.now()}${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
    const photoPaths: Record<string, string> = {};

    for (const label of ['photo_recto', 'photo_verso', 'photo_live'] as const) {
      if (!photos[label]) continue;
      const ext = photos[label].mime === 'image/png' ? 'png'
                : photos[label].mime === 'image/webp' ? 'webp' : 'jpg';
      const fname = `${id}_${label.replace('photo_', '')}.${ext}`;
      await fsp.writeFile(path.join(destDir, fname), photos[label].buf, { mode: 0o644 });
      photoPaths[label] = `${date}/${fname}`;
    }

    await db.createDossier({
      id,
      numero_mtn:     numero_mtn.trim().replace(/\D/g, ''),
      wa_agent:       normalizedWaAgent || undefined,
      username_agent: username_agent || undefined,
      fonction_agent: fonction_agent || undefined,
      zone_agent:     zone_agent     || undefined,
      date,
      heure_reception: nowTime(),
      photo_recto:    photoPaths.photo_recto,
      photo_verso:    photoPaths.photo_verso,
      photo_live:     photoPaths.photo_live, // null si non fourni ici
    });

    db.audit(null, 'DOSSIER_PUBLIC_CREE', `id=${id} wa=${wa_agent ?? ''}`, req.ip);

    return reply.code(201).send({
      success: true,
      id,
      ref:          id,
      numero:       numero_mtn.trim(),
      recto_path:   photoPaths.photo_recto  ?? '',
      verso_path:   photoPaths.photo_verso  ?? '',
      photo_live:   photoPaths.photo_live   ?? '',
    });
  });

  // ==========================================================================
  // [FIX-1] [NOUVELLE ROUTE] POST /api/public/dossiers/:id/live
  // --------------------------------------------------------------------------
  // Reçoit la photo du visage capturée par face-verify-interactive.html
  // via MediaPipe, l'enregistre sur disque, met à jour photo_live en base,
  // puis appelle automatiquement AWS Rekognition pour la comparaison.
  //
  // Body (multipart) :
  //   photo_live  — blob JPEG/PNG/WEBP capturé côté navigateur
  //
  // Réponse : { success, id, photo_live, score_visage, visage_match, visage_motif }
  // ==========================================================================
  app.post<{ Params: { id: string } }>(
    '/api/public/dossiers/:id/live',
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req, reply) => {
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'Format multipart attendu' });
      }

      const dossierId = req.params.id?.trim();
      if (!dossierId) {
        return reply.code(400).send({ error: 'ID dossier manquant' });
      }

      // Vérifier que le dossier existe
      const dossier = await db.getDossierById(dossierId);
      if (!dossier) {
        return reply.code(404).send({ error: `Dossier introuvable : ${dossierId}` });
      }
      if (!dossier.photo_recto) {
        return reply.code(400).send({
          error: 'Photo recto manquante dans ce dossier — impossible de comparer avec Rekognition',
        });
      }

      // Lire la photo live
      let liveBuffer: Buffer | null = null;
      let liveMime = 'image/jpeg';

      try {
        for await (const part of req.parts()) {
          if (part.type === 'file' && part.fieldname === 'photo_live') {
            if (!ALLOWED_MIME.has(part.mimetype)) {
              for await (const _ of part.file) { /* drain */ }
              return reply.code(400).send({
                error: `Type MIME non autorisé : ${part.mimetype}. Accepté : jpeg, png, webp`,
              });
            }
            const chunks: Buffer[] = [];
            let size = 0;
            for await (const chunk of part.file) {
              size += chunk.length;
              if (size > MAX_LIVE) {
                return reply.code(413).send({ error: 'Photo live trop volumineuse (max 10 Mo)' });
              }
              chunks.push(chunk);
            }
            liveBuffer = Buffer.concat(chunks);
            liveMime   = part.mimetype;
          } else if (part.type === 'file') {
            for await (const _ of part.file) { /* drain */ }
          }
        }
      } catch {
        return reply.code(400).send({ error: 'Erreur lecture multipart' });
      }

      if (!liveBuffer || liveBuffer.length === 0) {
        return reply.code(400).send({ error: 'Champ photo_live manquant ou vide' });
      }

      // Enregistrer sur disque
      const date    = nowDate();
      const dateDir = path.join(UPLOAD_CNI, date);
      await fsp.mkdir(dateDir, { recursive: true });

      const ext          = liveMime === 'image/png' ? 'png' : liveMime === 'image/webp' ? 'webp' : 'jpg';
      const liveFilename = `${dossierId}_live_${crypto.randomBytes(4).toString('hex')}.${ext}`;
      const liveFullPath = path.join(dateDir, liveFilename);
      await fsp.writeFile(liveFullPath, liveBuffer, { mode: 0o644 });
      const livePath = `${date}/${liveFilename}`;

      // Mettre à jour photo_live en base immédiatement
      await db.updateDossier(dossierId, { photo_live: livePath });

      // ── [FIX-1] Appel automatique AWS Rekognition ────────────────────────
      let score: number | null   = null;
      let matchVal: number | null = null;
      let motif = 'aws_non_configure';

      if (process.env.AWS_ACCESS_KEY_ID) {
        try {
          const result = await verifierVisageAutoById(dossierId, liveBuffer);
          score    = result.score;
          matchVal = result.match;
          motif    = result.motif;

          // Persister les résultats Rekognition en base
          await db.updateDossier(dossierId, {
            score_visage:      score,
            visage_match:      matchVal,
            visage_motif:      motif,
            visage_verifie_le: nowSec(),
          });

          db.audit(
            null,
            'FACE_VERIFY_AUTO',
            `id=${dossierId} score=${score} match=${matchVal}`,
            req.ip,
          );
        } catch (err) {
          // L'erreur Rekognition ne bloque PAS la réponse — le dossier est créé quand même
          motif = `erreur_rekognition: ${err instanceof Error ? err.message : String(err)}`;
          console.error('[FACE-VERIFY-AUTO /live]', err);
        }
      }

      return reply.send({
        success:      true,
        id:           dossierId,
        photo_live:   livePath,
        score_visage: score,
        visage_match: matchVal !== null ? matchVal === 1 : null,
        visage_motif: motif,
        message:      score !== null
          ? `Photo live enregistrée. Score Rekognition : ${score}%. ${matchVal === 1 ? '✅ Correspondance détectée.' : '⚠️ Vérification manuelle requise.'}`
          : 'Photo live enregistrée. Vérification AWS non disponible.',
      });
    }
  );

  // ==========================================================================
  // GET /api/public/dossiers?wa_agent=
  // ==========================================================================
  app.get('/api/public/dossiers', async (req, reply) => {
    const q  = req.query as Record<string, string>;
    const wa = String(q.wa_agent ?? '').replace(/\D/g, '');
    if (!wa || wa.length < 8)
      return reply.code(400).send({ error: 'wa_agent requis (8+ chiffres)' });
    const { rows } = await db.getDossiers({ limit: 200, offset: 0 });
    const filtered = rows.filter(d => String(d.wa_agent ?? '').replace(/\D/g, '') === wa).map(d => ({
      id: d.id, numero_mtn: d.numero_mtn, statut: d.statut, date: d.date,
      heure_reception: d.heure_reception, heure_cloture: d.heure_cloture,
      raison_rejet: d.raison_rejet,
      score_visage: d.score_visage != null ? parseFloat(String(d.score_visage)) : null,
      visage_match: d.visage_match ?? null, visage_motif: d.visage_motif ?? null,
    }));
    const stats = { total: 0, en_attente: 0, en_cours: 0, accepte: 0, rejete: 0 };
    for (const d of filtered) {
      stats.total++;
      if (d.statut in stats) (stats as Record<string, number>)[d.statut]++;
    }
    return reply.send({ success: true, count: filtered.length, dossiers: filtered, stats });
  });

  // ==========================================================================
  // GET /api/public/mon-tableau?wa_agent=
  // ==========================================================================
  app.get('/api/public/mon-tableau', async (req, reply) => {
    const q  = req.query as Record<string, string>;
    const wa = String(q.wa_agent ?? '').replace(/\D/g, '');
    if (!wa || wa.length < 8)
      return reply.code(400).send({ error: 'wa_agent requis (8+ chiffres)' });
    const { rows } = await db.getDossiers({ debut: q.debut ?? null, fin: q.fin ?? null, limit: 500 });
    const filtered = rows.filter(d => String(d.wa_agent ?? '').replace(/\D/g, '') === wa);
    const compteurs = { en_attente: 0, en_cours: 0, accepte: 0, rejete: 0 };
    for (const d of filtered) {
      if (d.statut in compteurs) (compteurs as Record<string, number>)[d.statut]++;
    }
    return reply.send({
      success: true, compteurs, count: filtered.length,
      dossiers: filtered.map(d => ({
        id: d.id, numero_mtn: d.numero_mtn, statut: d.statut, date: d.date,
        heure_reception: d.heure_reception, heure_cloture: d.heure_cloture,
        raison_rejet: d.raison_rejet,
        score_visage: d.score_visage != null ? parseFloat(String(d.score_visage)) : null,
        visage_match: d.visage_match ?? null, visage_motif: d.visage_motif ?? null,
      })),
    });
  });

  // NOTE: prepare/verify-session endpoints are defined in `face-verify.ts`.

  // ==========================================================================
  // HTTP /api/call/test — déclenche un appel entrant vers un terrain depuis le serveur
  // ==========================================================================
  app.post('/api/call/test', async (req, reply) => {
    const body = (req.body ?? {}) as { numero?: string; numeroMtn?: string };
    const numero = normalizeNumero(body.numero);
    const numeroMtn = String(body.numeroMtn ?? '0700000000');

    if (!numero) {
      return reply.code(400).send({ success: false, error: 'numero requis' });
    }

    const targetSocket = terrainSockets.get(numero);
    const pushToken = terrainTokens.get(numero);
    const callUuid = `server-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    let wsDelivered = false;
    if (targetSocket) {
      try {
        targetSocket.send(JSON.stringify({ type: 'incoming-call', numeroMtn, numero, callUuid }));
        wsDelivered = true;
      } catch {
        wsDelivered = false;
      }
    }

    let pushDelivered = false;
    if (pushToken) {
      pushDelivered = await sendIncomingCallPush({ token: pushToken, numero, numeroMtn, callUuid });
    }

    return reply.send({
      success: true,
      delivered: wsDelivered || pushDelivered,
      via: wsDelivered ? (pushDelivered ? 'ws+fcm' : 'ws') : (pushDelivered ? 'fcm' : 'none'),
      wsDelivered,
      pushDelivered,
      numero,
      numeroMtn,
      callUuid,
      message: wsDelivered || pushDelivered ? 'appel distribué' : 'terrain non connecté et aucune clé FCM disponible',
    });
  });

  // WS /api/signaling — WebRTC signaling terrain ↔ back-office
  // ==========================================================================
  app.get('/api/signaling', { websocket: true }, (socket: WsSocket, _req: FastifyRequest) => {
    let room: string | null = null;
    let role: string | null = null;
    let numero: string | null = null;

    const send = (data: unknown) => {
      try { socket.send(JSON.stringify(data)); } catch { /* fermé */ }
    };

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; room?: string; role?: string; numero?: string; numeroMtn?: string; fcmToken?: string; [k: string]: unknown };

        if (msg.type === 'join' && msg.room) {
          room = String(msg.room).replace(/\D/g, '').slice(0, 15);
          if (!signalingPeers.has(room)) signalingPeers.set(room, new Set());
          signalingPeers.get(room)!.add(socket);
          send({ type: 'joined', room, peers: signalingPeers.get(room)!.size });
          signalingPeers.get(room)!.forEach(peer => {
            if (peer !== socket) {
              try { peer.send(JSON.stringify({ type: 'peer-joined', room })); } catch { /* fermé */ }
            }
          });
          return;
        }

        if (msg.type === 'register') {
          role = String(msg.role ?? '').toLowerCase();
          numero = normalizeNumero(msg.numero);
          if (!numero) return;
          if (role === 'terrain') {
            terrainSockets.set(numero, socket);
            if (msg.fcmToken) terrainTokens.set(numero, String(msg.fcmToken));
            send({ type: 'registered', role: 'terrain', numero });
          }
          return;
        }

        if (msg.type === 'call' && role === 'backoffice' && numero) {
          const target = normalizeNumero(msg.numero);
          const targetSocket = terrainSockets.get(target);
          if (targetSocket) {
            try {
              targetSocket.send(JSON.stringify({ type: 'incoming-call', numeroMtn: String(msg.numeroMtn ?? ''), numero: target }));
            } catch { /* fermé */ }
          }
          send({ type: targetSocket ? 'call-delivered' : 'terrain-absent', numero: target });
          return;
        }

        if (!room) { send({ type: 'error', message: 'join requis' }); return; }

        const peers = signalingPeers.get(room);
        if (peers) {
          peers.forEach(peer => {
            if (peer !== socket) {
              try { peer.send(JSON.stringify({ ...msg, room })); } catch { /* fermé */ }
            }
          });
        }
      } catch { /* parse error */ }
    });

    socket.on('close', () => {
      if (room && signalingPeers.has(room)) {
        signalingPeers.get(room)!.delete(socket);
        if (signalingPeers.get(room)!.size === 0) {
          signalingPeers.delete(room);
        } else {
          signalingPeers.get(room)!.forEach(peer => {
            try { peer.send(JSON.stringify({ type: 'peer-left', room })); } catch { /* fermé */ }
          });
        }
      }
      if (role === 'terrain' && numero) {
        terrainSockets.delete(numero);
      }
    });
  });
}