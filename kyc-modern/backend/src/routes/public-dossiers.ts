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
import { buildDossierCreatePayload } from '../utils/dossierPayload';

const UPLOAD_CNI   = process.env.UPLOAD_CNI || path.join(process.cwd(), 'uploads', 'cni');
const MAX_FILE     = 5  * 1024 * 1024; // 5 Mo pour recto/verso
const MAX_LIVE     = 10 * 1024 * 1024; // 10 Mo pour photo live
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

// NOTE: session management for face-verify flows is handled in
// `face-verify.ts` to avoid duplicated route declarations.

// Peers WebRTC par wa_agent (signaling)
const signalingPeers = new Map<string, Set<WsSocket>>();
const terrainSockets = new Map<string, WsSocket>();
const backofficeSockets = new Map<string, WsSocket>();
const terrainTokens = new Map<string, string>();
const pendingCalls = new Map<string, { callUuid: string; boSocket: WsSocket; numeroMtn: string; timer: NodeJS.Timeout }>();

const CALL_RING_TIMEOUT_MS = 45_000;

const fcmServerKey = process.env.FCM_SERVER_KEY || process.env.FCM_API_KEY || '';
const turnSecret = process.env.TURN_SHARED_SECRET || '';
const turnHost = process.env.TURN_HOST || '41.85.184.155';
const turnTtlSeconds = 600;
const serviceAccountPath = path.resolve(process.cwd(), 'kyc-congo-399bc93f01c9.json');
let cachedServiceAccount: any = null;

console.log('[FCM] service account path', serviceAccountPath);

function loadServiceAccount(): any | null {
  if (cachedServiceAccount) return cachedServiceAccount;

  try {
    if (!fs.existsSync(serviceAccountPath)) {
      console.warn('[FCM] Fichier de compte de service introuvable', serviceAccountPath);
      return null;
    }

    cachedServiceAccount = JSON.parse(fs.readFileSync(serviceAccountPath, 'utf8'));
    return cachedServiceAccount;
  } catch (err) {
    console.warn('[FCM] Impossible de lire le compte de service', err);
    return null;
  }
}

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function signJwt(serviceAccount: any): string | null {
  try {
    const header = { alg: 'RS256', typ: 'JWT' };
    const now = Math.floor(Date.now() / 1000);
    const payload = {
      iss: serviceAccount.client_email,
      scope: 'https://www.googleapis.com/auth/firebase.messaging',
      aud: 'https://oauth2.googleapis.com/token',
      iat: now,
      exp: now + 3600,
    };

    const encodedHeader = base64UrlEncode(Buffer.from(JSON.stringify(header)));
    const encodedPayload = base64UrlEncode(Buffer.from(JSON.stringify(payload)));
    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const signer = crypto.createSign('RSA-SHA256');
    signer.update(signingInput);
    const privateKey = crypto.createPrivateKey(serviceAccount.private_key);
    const signature = signer.sign(privateKey);

    return `${signingInput}.${base64UrlEncode(signature)}`;
  } catch (err) {
    console.warn('[FCM] Impossible de signer le JWT', err);
    return null;
  }
}

async function getFcmAccessToken(): Promise<string | null> {
  const serviceAccount = loadServiceAccount();
  if (!serviceAccount) return null;

  const assertion = signJwt(serviceAccount);
  if (!assertion) return null;

  try {
    const response = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
        assertion,
      }),
    });

    const result = await response.json() as any;
    if (!response.ok) {
      console.warn('[FCM] OAuth token error', response.status, result);
      return null;
    }

    return result.access_token ?? null;
  } catch (err) {
    console.warn('[FCM] Impossible de récupérer le token OAuth FCM', err);
    return null;
  }
}

async function sendFcmHttp(payload: any): Promise<boolean> {
  if (fcmServerKey) {
    try {
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: {
          Authorization: `key=${fcmServerKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
      });

      const text = await response.text();
      console.log('[FCM] legacy response', response.status, text);
      return response.ok;
    } catch (err) {
      console.warn('[FCM] legacy push exception', err);
    }
  }

  const serviceAccount = loadServiceAccount();
  if (!serviceAccount?.project_id) {
    console.warn('[FCM] Aucun compte Firebase utilisable pour l’envoi du push');
    return false;
  }

  try {
    const accessToken = await getFcmAccessToken();
    if (!accessToken) {
      console.warn('[FCM] impossible d’obtenir un token OAuth pour le push');
      return false;
    }

    const response = await fetch(`https://fcm.googleapis.com/v1/projects/${serviceAccount.project_id}/messages:send`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        message: {
          token: payload.to,
          data: payload.data,
          notification: payload.notification,
          android: payload.android,
        },
      }),
    });

    const text = await response.text();
    console.log('[FCM] v1 response', response.status, text);
    return response.ok;
  } catch (err) {
    console.warn('[FCM] v1 push exception', err);
    return false;
  }
}

function normalizeNumero(value: string | undefined): string {
  return String(value ?? '').replace(/\D/g, '').slice(0, 20);
}

function sendSocketPayload(socket: WsSocket | null | undefined, payload: unknown) {
  if (!socket) return;
  try {
    socket.send(JSON.stringify(payload));
  } catch {
    // ignore
  }
}

function clearPendingCall(numero: string) {
  const pending = pendingCalls.get(numero);
  if (pending) {
    clearTimeout(pending.timer);
    pendingCalls.delete(numero);
  }
}

function generateTurnCredentials(identity: string) {
  if (!turnSecret) {
    return {
      username: '',
      password: '',
      ttl: turnTtlSeconds,
      uris: [
        'stun:stun.l.google.com:19302',
        'stun:stun1.l.google.com:19302',
      ],
    };
  }

  const timestamp = Math.floor(Date.now() / 1000) + turnTtlSeconds;
  const username = `${timestamp}:${identity}`;
  const hmac = crypto.createHmac('sha1', turnSecret);
  hmac.update(username);
  const password = hmac.digest('base64');

  return {
    username,
    password,
    ttl: turnTtlSeconds,
    uris: [
      `turn:${turnHost}:3478?transport=udp`,
      `turn:${turnHost}:3478?transport=tcp`,
    ],
  };
}

async function sendIncomingCallPush(params: {
  token: string;
  numero: string;
  numeroMtn: string;
  callUuid: string;
}): Promise<boolean> {
  if (!params.token) {
    console.warn('[FCM] push skipped: no token registered for terrain', params.numero);
    return false;
  }

  console.log('[FCM] preparing push', {
    forNumero: params.numero,
    tokenPreview: params.token.slice(0, 20),
    callUuid: params.callUuid,
    numeroMtn: params.numeroMtn,
  });

  const payload = {
    to: params.token,
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
    notification: {
      title: 'Appel vidéo entrant',
      body: `Appel de ${params.numeroMtn}`,
    },
  };

  try {
    return await sendFcmHttp(payload);
  } catch (err) {
    console.warn('[FCM] push exception', err);
    return false;
  }
}

function nowDate() { return new Date().toLocaleDateString('en-CA'); }
function nowTime() { return new Date().toTimeString().slice(0, 5); }
function nowSec()  { return Math.floor(Date.now() / 1000); }

export async function publicDossierRoutes(app: any): Promise<void> {

  app.get('/api/turn-credentials', async (req: FastifyRequest, reply: any) => {
    const query = (req.query ?? {}) as { numero?: string };
    const numero = normalizeNumero(query.numero);

    if (!numero) {
      return reply.code(400).send({ error: 'numero requis' });
    }

    try {
      const creds = generateTurnCredentials(numero);
      const iceServers = creds.uris.map((urls: string) => {
        const server: Record<string, unknown> = { urls };
        if (creds.username) server.username = creds.username;
        if (creds.password) server.credential = creds.password;
        return server;
      });

      return reply.send({
        success: true,
        numero,
        username: creds.username || undefined,
        password: creds.password || undefined,
        ttl: creds.ttl,
        uris: creds.uris,
        iceServers,
        message: turnSecret ? 'TURN prêt' : 'TURN non configuré, repli STUN seulement',
      });
    } catch (err) {
      req.log.error(err, '[TURN] génération credentials échouée');
      return reply.code(500).send({ error: 'Configuration TURN indisponible' });
    }
  });

  app.post('/api/device/register-fcm', async (req: FastifyRequest, reply: any) => {
    const body = (req.body ?? {}) as { numero?: string; token?: string };
    const numero = normalizeNumero(body.numero);
    const token = String(body.token ?? '').trim();

    if (!numero || !token) {
      return reply.code(400).send({ success: false, error: 'numero et token requis' });
    }

    terrainTokens.set(numero, token);
    return reply.send({
      success: true,
      registered: true,
      numero,
      tokenPreview: `${token.slice(0, 12)}...`,
    });
  });

  // ==========================================================================
  // POST /api/public/dossiers
  // Upload recto + verso CNI et crée le dossier en attente.
  // (inchangé — photo_live reste null ici, uploadée séparément via :id/live)
  // ==========================================================================
  app.post('/api/public/dossiers', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (req: FastifyRequest, reply: any) => {
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

    const { wa_agent, username_agent, fonction_agent, zone_agent, numero_mtn, country,
            nom_titulaire, prenom_titulaire, date_naissance, lieu_naissance,
            autre_numero, nom_pere, nom_mere, adresse_complete, numero_cni,
            sexe, nationalite, profession } = fields;
    const normalizedWaAgent = String(wa_agent ?? '').replace(/\D/g, '');
    if (!numero_mtn?.trim()) return reply.code(400).send({ error: 'Numéro MTN requis' });
    if (!country?.trim())    return reply.code(400).send({ error: 'Pays requis' });
    if (!photos.photo_recto || !photos.photo_verso)
      return reply.code(400).send({ error: 'Photos recto et verso obligatoires' });
    // Infos titulaire — requises pour l'enregistrement SIM (réglementation KYC)
    if (!nom_titulaire?.trim())    return reply.code(400).send({ error: 'Nom du titulaire requis' });
    if (!prenom_titulaire?.trim()) return reply.code(400).send({ error: 'Prénom du titulaire requis' });
    if (!date_naissance?.trim())   return reply.code(400).send({ error: 'Date de naissance requise' });
    if (!lieu_naissance?.trim())   return reply.code(400).send({ error: 'Lieu de naissance requis' });
    if (!nom_pere?.trim())         return reply.code(400).send({ error: 'Nom du père requis' });
    if (!nom_mere?.trim())         return reply.code(400).send({ error: 'Nom de la mère requis' });

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
      ...buildDossierCreatePayload({
        id,
        numero_mtn: numero_mtn.trim().replace(/\D/g, ''),
        country: country?.trim() || null,
        wa_agent: normalizedWaAgent || null,
        username_agent: username_agent || null,
        fonction_agent: fonction_agent || null,
        zone_agent: zone_agent || null,
        date,
        heure_reception: nowTime(),
        nom_titulaire: nom_titulaire.trim(),
        prenom_titulaire: prenom_titulaire.trim(),
        date_naissance: date_naissance.trim(),
        lieu_naissance: lieu_naissance.trim(),
        autre_numero: (autre_numero ?? '').trim().replace(/\D/g, '') || null,
        nom_pere: nom_pere.trim(),
        nom_mere: nom_mere.trim(),
        adresse_complete: (adresse_complete ?? '').trim() || null,
        numero_cni: (numero_cni ?? '').trim() || null,
        sexe: (sexe ?? '').trim() || null,
        nationalite: (nationalite ?? '').trim() || null,
        profession: (profession ?? '').trim() || null,
        ocr_overrides: fields.ocr_overrides || null,
        flow_step: 4,
        acquisition_status: 'submitted',
      }),
      photo_recto: photoPaths.photo_recto,
      photo_verso: photoPaths.photo_verso,
      photo_live: photoPaths.photo_live,
    });

    db.audit(null, 'DOSSIER_PUBLIC_CREE', `id=${id} wa=${wa_agent ?? ''}`, req.ip);

    return reply.code(201).send({
      success: true,
      id,
      ref: id,
      numero: numero_mtn.trim(),
      recto_path: photoPaths.photo_recto ?? '',
      verso_path: photoPaths.photo_verso ?? '',
      photo_live: photoPaths.photo_live ?? '',
      country: country?.trim() || null,
      flow_step: 4,
      acquisition_status: 'submitted',
      message: 'Dossier créé avec succès — données d’acquisition enregistrées.',
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
  app.post(
    '/api/public/dossiers/:id/live',
    { config: { rateLimit: { max: 30, timeWindow: 60_000 } } },
    async (req: FastifyRequest, reply: any) => {
      if (!req.isMultipart()) {
        return reply.code(400).send({ error: 'Format multipart attendu' });
      }

      const dossierId = (req.params as { id?: string }).id?.trim();
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
  app.get('/api/admin/reporting', async (req: FastifyRequest, reply: any) => {
    const q = req.query as Record<string, string>;
    const { rows } = await db.getDossiers({
      debut: q.debut ?? null,
      fin: q.fin ?? null,
      statut: q.statut ?? null,
      agent: q.agent ?? null,
      search: q.search ?? null,
      limit: 5000,
      offset: 0,
    });
    const dossiers = rows;
    const stats = { total: dossiers.length, en_attente: 0, en_cours: 0, accepte: 0, rejete: 0 };
    for (const d of dossiers) {
      if (d.statut in stats) (stats as Record<string, number>)[d.statut]++;
    }
    const byAgent = new Map<string, { agent: string; total: number; accepte: number; rejete: number; en_cours: number }>();
    for (const d of dossiers) {
      const agent = d.agent_saisie || d.username_agent || 'non_attribue';
      if (!byAgent.has(agent)) byAgent.set(agent, { agent, total: 0, accepte: 0, rejete: 0, en_cours: 0 });
      const item = byAgent.get(agent)!;
      item.total++;
      if (d.statut === 'accepte') item.accepte++;
      else if (d.statut === 'rejete') item.rejete++;
      else if (d.statut === 'en_cours') item.en_cours++;
    }
    return reply.send({ success: true, total: dossiers.length, count: dossiers.length, dossiers, stats, byAgent: Array.from(byAgent.values()).sort((a, b) => b.total - a.total) });
  });

  app.get('/api/public/dossiers', async (req: FastifyRequest, reply: any) => {
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
      nom_titulaire: d.nom_titulaire ?? null,
      prenom_titulaire: d.prenom_titulaire ?? null,
      date_naissance: d.date_naissance ?? null,
      lieu_naissance: d.lieu_naissance ?? null,
      adresse_complete: d.adresse_complete ?? null,
      numero_cni: d.numero_cni ?? null,
      sexe: d.sexe ?? null,
      nationalite: d.nationalite ?? null,
      profession: d.profession ?? null,
      autre_numero: d.autre_numero ?? null,
      nom_pere: d.nom_pere ?? null,
      nom_mere: d.nom_mere ?? null,
      country: d.country ?? null,
      flow_step: d.flow_step ?? 4,
      acquisition_status: d.acquisition_status ?? 'submitted',
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
  app.get('/api/public/mon-tableau', async (req: FastifyRequest, reply: any) => {
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
        nom_titulaire: d.nom_titulaire ?? null,
        prenom_titulaire: d.prenom_titulaire ?? null,
        date_naissance: d.date_naissance ?? null,
        lieu_naissance: d.lieu_naissance ?? null,
        adresse_complete: d.adresse_complete ?? null,
        numero_cni: d.numero_cni ?? null,
        sexe: d.sexe ?? null,
        nationalite: d.nationalite ?? null,
        profession: d.profession ?? null,
        autre_numero: d.autre_numero ?? null,
        nom_pere: d.nom_pere ?? null,
        nom_mere: d.nom_mere ?? null,
        country: d.country ?? null,
        flow_step: d.flow_step ?? 4,
        acquisition_status: d.acquisition_status ?? 'submitted',
      })),
    });
  });

  // NOTE: prepare/verify-session endpoints are defined in `face-verify.ts`.

  // ==========================================================================
  // HTTP /api/call/test — déclenche un appel entrant vers un terrain depuis le serveur
  // ==========================================================================
  app.post('/api/call/test', async (req: FastifyRequest, reply: any) => {
    const body = (req.body ?? {}) as { numero?: string; numeroMtn?: string };
    const numero = normalizeNumero(body.numero);
    const numeroMtn = String(body.numeroMtn ?? '0700000000');

    if (!numero) {
      return reply.code(400).send({ success: false, error: 'numero requis' });
    }

    const targetSocket = terrainSockets.get(numero);
    const pushToken = terrainTokens.get(numero);
    const hasFcmServerKey = Boolean(process.env.FCM_SERVER_KEY || process.env.FCM_API_KEY || true);
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

    const backofficeSocket = backofficeSockets.get(numero);
    if (backofficeSocket) {
      try {
        backofficeSocket.send(JSON.stringify({ type: 'incoming-call', numeroMtn, numero, callUuid }));
      } catch {
        // ignore
      }
    }

    let pushDelivered = false;
    if (pushToken) {
      pushDelivered = await sendIncomingCallPush({ token: pushToken, numero, numeroMtn, callUuid });
    }

    const pushReason = !pushToken
      ? 'no_registered_token'
      : !hasFcmServerKey
        ? 'no_fcm_server_key'
        : (pushDelivered ? 'sent' : 'delivery_failed');
    const pushHint = !hasFcmServerKey
      ? 'Ajoute FCM_SERVER_KEY ou FCM_API_KEY dans le .env du backend pour activer la livraison push hors app'
      : undefined;

    return reply.send({
      success: true,
      delivered: wsDelivered || pushDelivered,
      via: wsDelivered ? (pushDelivered ? 'ws+fcm' : 'ws') : (pushDelivered ? 'fcm' : 'none'),
      wsDelivered,
      pushDelivered,
      pushConfigured: Boolean(pushToken && hasFcmServerKey),
      pushReason,
      pushHint,
      numero,
      numeroMtn,
      callUuid,
      message: wsDelivered || pushDelivered ? 'appel distribué' : 'terrain non connecté et aucune clé FCM disponible',
    });
  });

  app.get('/test/webrtc', async (_req: FastifyRequest, reply: any) => {
    reply.type('text/html');
    return '<!doctype html><html lang="fr"><head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>Test WebRTC KYC</title><style>body{font-family:Arial,sans-serif;margin:0;padding:24px;background:#0f172a;color:#f8fafc;min-height:100vh;box-sizing:border-box}.panel{background:#111827;padding:16px;border-radius:12px;margin-bottom:12px}.row{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}button,input{padding:10px 12px;border-radius:8px;border:1px solid #334155}button{cursor:pointer;background:#2563eb;color:white;border:0}.video-shell{width:100%;max-width:100%;aspect-ratio:16/9;border-radius:12px;overflow:hidden;background:#020617;margin-top:8px;display:flex;align-items:center;justify-content:center;min-height:280px}.video-shell video{display:block;width:100%;height:100%;object-fit:contain;background:#020617}.status{margin-top:8px;color:#93c5fd;white-space:pre-wrap}</style></head><body><div class="panel"><h2>Test WebRTC KYC</h2><p>Validation de bout en bout de la session vidéo entre l’app mobile et le backend.</p><label>Numéro terrain</label><input id="numero" value="0167376539" /><div class="row"><button id="connectBtn">Connecter</button><button id="callBtn">Lancer l’appel test</button></div><div id="status" class="status">Prêt</div></div><div class="panel"><h3>Local</h3><div class="video-shell"><video id="localVideo" autoplay muted playsinline></video></div></div><div class="panel"><h3>Distant</h3><div class="video-shell"><video id="remoteVideo" autoplay playsinline></video></div></div><script>const numeroInput=document.getElementById("numero");const statusEl=document.getElementById("status");const connectBtn=document.getElementById("connectBtn");const callBtn=document.getElementById("callBtn");const localVideo=document.getElementById("localVideo");const remoteVideo=document.getElementById("remoteVideo");let ws=null;let pc=null;let localStream=null;const logs=[];function log(message){const line=new Date().toLocaleTimeString()+" "+message;logs.push(line);console.log("[TEST]", message);statusEl.textContent=logs.slice(-8).join("\\n");}function wsUrl(){const loc=window.location;const protocol=loc.protocol==="https:"?"wss":"ws";return protocol+"://"+loc.host+"/api/signaling";}async function createLocalStream(){try{return await navigator.mediaDevices.getUserMedia({video:true,audio:true});}catch(err){log("Caméra indisponible, génération d’un flux vidéo synthétique");const canvas=document.createElement("canvas");canvas.width=640;canvas.height=480;const ctx=canvas.getContext("2d");let frame=0;const draw=()=>{if(!ctx)return;const gradient=ctx.createLinearGradient(0,0,canvas.width,canvas.height);gradient.addColorStop(0,"#020617");gradient.addColorStop(1,"#2563eb");ctx.fillStyle=gradient;ctx.fillRect(0,0,canvas.width,canvas.height);ctx.fillStyle="#f8fafc";ctx.font="bold 36px Arial";ctx.fillText("Test WebRTC KYC",70,120);ctx.font="24px Arial";ctx.fillText("Flux synthétique",70,180);ctx.beginPath();ctx.arc(500,140,70,0,Math.PI*2);ctx.fillStyle="rgba(255,255,255,0.25)";ctx.fill();ctx.beginPath();ctx.arc(500+Math.sin(frame/15)*20,140+Math.cos(frame/12)*20,35,0,Math.PI*2);ctx.fillStyle="#fbbf24";ctx.fill();frame+=1;};const animate=()=>{draw();requestAnimationFrame(animate);};animate();return canvas.captureStream(15);} }async function initPeer(){if(pc)return pc;pc=new RTCPeerConnection({iceServers:[{urls:"stun:stun.l.google.com:19302"}]});pc.onicecandidate=(e)=>{if(e.candidate&&ws&&ws.readyState===WebSocket.OPEN){ws.send(JSON.stringify({type:"webrtc",payload:{kind:"ice",candidate:e.candidate.toJSON()},numero:numeroInput.value}));log("ICE candidat envoyé");}};pc.ontrack=(e)=>{const stream=e.streams&&e.streams[0];if(stream){remoteVideo.srcObject=stream;log("Flux distant visible");}};localStream=await createLocalStream();localVideo.srcObject=localStream;localStream.getTracks().forEach(track=>pc.addTrack(track,localStream));log("Flux local prêt");return pc;}async function connect(){if(ws&&ws.readyState===WebSocket.OPEN)return;ws=new WebSocket(wsUrl());ws.onopen=()=>{log("WebSocket connecté");ws.send(JSON.stringify({type:"register",role:"backoffice",numero:numeroInput.value}));};ws.onmessage=async(event)=>{const msg=JSON.parse(event.data);log("Message reçu: "+msg.type);if(msg.type==="registered"){log("Back-office enregistré");return;}if(msg.type==="incoming-call"){log("Appel entrant reçu, génération de l’offre…");await initPeer();const offer=await pc.createOffer();await pc.setLocalDescription(offer);ws.send(JSON.stringify({type:"webrtc",payload:{kind:"offer",sdp:pc.localDescription.sdp},numero:numeroInput.value}));log("Offer envoyée");return;}if(msg.type==="webrtc"&&msg.payload&&msg.payload.kind==="answer"){await pc.setRemoteDescription(new RTCSessionDescription({type:"answer",sdp:msg.payload.sdp}));log("Answer reçue");return;}if(msg.type==="webrtc"&&msg.payload&&msg.payload.kind==="ice"&&pc&&pc.remoteDescription){await pc.addIceCandidate(new RTCIceCandidate(msg.payload.candidate));log("ICE ajouté");}};}connectBtn.onclick=()=>connect();callBtn.onclick=async()=>{await connect();const response=await fetch("/api/call/test",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({numero:numeroInput.value,numeroMtn:"0700000000"})});const data=await response.json();log("Réponse appel test: "+(data.message||JSON.stringify(data)));};</script></body></html>';
  });

  // WS /api/signaling — WebRTC signaling terrain ↔ back-office
  // ==========================================================================
  app.get('/api/signaling', { websocket: true }, (socket: WsSocket, _req: any) => {
    let room: string | null = null;
    let role: string | null = null;
    let numero: string | null = null;

    const send = (data: unknown) => {
      try { socket.send(JSON.stringify(data)); } catch { /* fermé */ }
    };

    socket.on('message', (raw: Buffer) => {
      try {
        const msg = JSON.parse(raw.toString()) as { type: string; room?: string; role?: string; numero?: string; numeroMtn?: string; fcmToken?: string; [k: string]: unknown };

        if (msg.type === 'ping') {
          send({ type: 'pong' });
          return;
        }

        if (msg.type === 'pong') {
          return;
        }

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
          console.log('[SIGNAL] register', { role, numero });
          if (role === 'terrain') {
            terrainSockets.set(numero, socket);
            if (msg.fcmToken) terrainTokens.set(numero, String(msg.fcmToken));
            send({ type: 'registered', role: 'terrain', numero });
            const boSocket = backofficeSockets.get(numero);
            if (boSocket) {
              sendSocketPayload(boSocket, { type: 'terrain-presence', enLigne: true, numero });
            }
          } else if (role === 'backoffice') {
            backofficeSockets.set(numero, socket);
            send({ type: 'registered', role: 'backoffice', numero });
            sendSocketPayload(socket, { type: 'terrain-presence', enLigne: terrainSockets.has(numero), numero });
          }
          return;
        }

        if (msg.type === 'call' && role === 'backoffice' && numero) {
          const target = normalizeNumero(msg.numero);
          const targetSocket = terrainSockets.get(target);
          const numeroMtn = String(msg.numeroMtn ?? '');
          const callUuid = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

          if (!targetSocket) {
            send({ type: 'terrain-absent', numero: target });
            return;
          }

          clearPendingCall(target);
          sendSocketPayload(targetSocket, { type: 'incoming-call', numeroMtn, numero: target });
          send({ type: 'call-delivered', numero: target, callUuid });

          const timer = setTimeout(() => {
            pendingCalls.delete(target);
            sendSocketPayload(socket, { type: 'no-answer', numero: target, callUuid });
            sendSocketPayload(targetSocket, { type: 'hangup' });
            console.log('[SIGNAL] no-answer timeout', { target, callUuid });
          }, CALL_RING_TIMEOUT_MS);

          pendingCalls.set(target, { callUuid, boSocket: socket, numeroMtn, timer });
          return;
        }

        // ── Appel SORTANT initié par le terrain ─────────────────────────────
        // Le terrain demande à joindre le back-office rattaché à `numero`
        // (par défaut son propre numero, ou un autre numero enregistré si
        // fourni). Le back-office reste l'offerer SDP — une fois qu'il
        // accepte, il doit créer l'offer et l'envoyer via 'webrtc' comme pour
        // un appel entrant classique (voir /api/call/test pour le même flux).
        if (msg.type === 'call-request' && role === 'terrain' && numero) {
          const target = normalizeNumero(msg.numero) || numero;
          const boSocket = backofficeSockets.get(target);
          if (!boSocket) {
            send({ type: 'call-unavailable', reason: 'Aucun back-office connecté pour ce numéro' });
            return;
          }
          try {
            boSocket.send(JSON.stringify({ type: 'outgoing-call-request', from: numero, numero: target }));
            send({ type: 'call-ringing' });
          } catch {
            send({ type: 'call-unavailable', reason: 'Back-office injoignable' });
          }
          return;
        }

        if (msg.type === 'call-cancel' && role === 'terrain' && numero) {
          const boSocket = backofficeSockets.get(numero);
          if (boSocket) {
            try { boSocket.send(JSON.stringify({ type: 'outgoing-call-cancelled', numero })); } catch { /* fermé */ }
          }
          clearPendingCall(numero);
          return;
        }

        // Réponse du back-office à un appel sortant terrain (voir ci-dessus).
        // `msg.numero` = numero du terrain qui a initié l'appel (celui reçu
        // dans 'outgoing-call-request' / champ `from`).
        if (msg.type === 'call-accept' && role === 'backoffice') {
          const target = normalizeNumero(msg.numero);
          const terrainSocket = terrainSockets.get(target);
          if (terrainSocket) {
            try { terrainSocket.send(JSON.stringify({ type: 'call-accepted' })); } catch { /* fermé */ }
          }
          clearPendingCall(target);
          return;
        }

        if (msg.type === 'call-reject' && role === 'backoffice') {
          const target = normalizeNumero(msg.numero);
          const terrainSocket = terrainSockets.get(target);
          if (terrainSocket) {
            try { terrainSocket.send(JSON.stringify({ type: 'call-rejected' })); } catch { /* fermé */ }
          }
          clearPendingCall(target);
          return;
        }

        if (msg.type === 'webrtc' && role && numero) {
          const payload = msg.payload as { kind?: string } | undefined;
          console.log('[SIGNAL] relay webrtc', { role, numero, kind: payload?.kind, hasPayload: Boolean(msg.payload) });
          clearPendingCall(numero);
          if (role === 'terrain') {
            const boSocket = backofficeSockets.get(numero);
            if (boSocket) {
              try { boSocket.send(JSON.stringify({ type: 'webrtc', payload: msg.payload, numero })); } catch { /* fermé */ }
            }
          } else if (role === 'backoffice') {
            const targetSocket = terrainSockets.get(numero);
            if (targetSocket) {
              try { targetSocket.send(JSON.stringify({ type: 'webrtc', payload: msg.payload, numero })); } catch { /* fermé */ }
            }
          }
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
        const previous = terrainSockets.get(numero);
        if (previous === socket) {
          terrainSockets.delete(numero);
        }
        const boSocket = backofficeSockets.get(numero);
        if (boSocket) {
          sendSocketPayload(boSocket, { type: 'terrain-presence', enLigne: false, numero });
        }
      }
      if (role === 'backoffice' && numero) {
        if (backofficeSockets.get(numero) === socket) {
          backofficeSockets.delete(numero);
        }
      }
    });
  });

  app.get('/api/signaling/stats', async () => ({
    terrainConnectes: terrainSockets.size,
    backofficeConnectes: backofficeSockets.size,
    tokensConnus: terrainTokens.size,
    appelsEnAttente: pendingCalls.size,
  }));
}