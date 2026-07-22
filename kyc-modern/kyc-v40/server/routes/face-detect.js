// ============================================================================
// KYC V4 — Vérification faciale temps réel (capture vidéo interactive)
// Version : 2.0.0 — Corrigée & Professionnalisée
// ============================================================================
//
// Routes exposées :
//   POST /api/dossiers/verify-face-realtime      → comparaison live vs recto CNI
//   POST /api/dossiers/prepare-verify-session    → génération de la session KYC
//   POST /api/dossiers/complete-with-face-verify → création finale du dossier
//
// Corrections appliquées :
//   [FIX-1] verso_path vide ('')  traité comme absent → message d'erreur précis
//   [FIX-2] verso_path 'undefined'/'null' rejeté proprement à l'entrée
//   [FIX-3] prepare-verify-session ne construit plus l'URL avec verso vide
//   [FIX-4] audit() appelée uniquement si elle est importée (guard ajouté)
//   [FIX-5] Drain correct des fichiers ignorés (évite memory-leak multipart)
//   [FIX-6] Lecture recto avec fs.promises pour éviter le blocage de l'event loop
//   [FIX-7] Validation taille frame (max 10 Mo)
//   [FIX-8] Log structuré sur chaque route (entrée + sortie)
// ============================================================================

'use strict';

const fs   = require('fs');
const path = require('path');
const { db } = require('../db');

// ── Constantes ────────────────────────────────────────────────────────────────

const UPLOAD_CNI   = process.env.UPLOAD_CNI || path.join(__dirname, '..', '..', 'uploads', 'cni');
// VALIDATION MANUELLE UNIQUEMENT : pas de décision automatique
// Tous les dossiers restent EN_ATTENTE jusqu'à validation agent
// const SEUIL_REJET  = 60;          // DÉSACTIVÉ
// const SEUIL_ACCEPT = 90;          // DÉSACTIVÉ
const MAX_FRAME_MB = 10;          // Taille maximale de la frame vidéo (Mo)
const MAX_FRAME_B  = MAX_FRAME_MB * 1024 * 1024;

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Retourne true si la valeur est absente, vide, ou une chaîne parasite
 * (résidu URL : "null", "undefined", "").
 */
function isBlank(v) {
  return !v || v === 'null' || v === 'undefined' || v.trim() === '';
}

/**
 * Construit le chemin absolu d'un fichier CNI et vérifie qu'il reste
 * strictement dans UPLOAD_CNI (protection path-traversal).
 * Retourne null si le chemin est invalide ou le fichier absent.
 *
 * @param {string} relativePath
 * @returns {{ full: string } | null}
 */
function resolveCNIPath(relativePath) {
  if (isBlank(relativePath)) return null;
  const base = path.resolve(UPLOAD_CNI) + path.sep;
  const full = path.resolve(UPLOAD_CNI, relativePath.trim());
  if (!full.startsWith(base)) return null;
  if (!fs.existsSync(full))   return null;
  return { full };
}

// ── Lazy-load du client AWS Rekognition ───────────────────────────────────────

let _rekClient = null;

function getRekClient() {
  if (_rekClient) return _rekClient;

  const region = process.env.AWS_REGION;
  const keyId  = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !keyId || !secret) {
    throw new Error(
      'Configuration AWS incomplète — vérifiez AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY'
    );
  }

  let RekognitionClient, CompareFacesCommand;
  try {
    ({ RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition'));
  } catch {
    throw new Error(
      'Module @aws-sdk/client-rekognition introuvable — exécutez : npm install @aws-sdk/client-rekognition'
    );
  }

  _rekClient = { client: new RekognitionClient({ region }), CompareFacesCommand };
  return _rekClient;
}

// ── Audit (optionnel — guard si non disponible) ───────────────────────────────

let _audit = null;
function audit(...args) {
  if (!_audit) {
    try { _audit = require('../utils/audit').audit; } catch { _audit = () => {}; }
  }
  _audit(...args);
}

// ── Enregistrement des routes Fastify ─────────────────────────────────────────

async function routes(fastify, _opts) {

  // ==========================================================================
  // POST /api/dossiers/verify-face-realtime
  // --------------------------------------------------------------------------
  // Reçoit : video_frame (file), recto_path (field)
  // Retourne : { success, score, match, motif, seuil, message }
  // ==========================================================================
  fastify.post('/api/dossiers/verify-face-realtime', async (request, reply) => {

    fastify.log.info('verify-face-realtime — début');

    let frameBuffer = null;
    let rectoPath   = null;

    // ── Lecture multipart ────────────────────────────────────────────────────
    try {
      for await (const part of request.parts()) {
        if (part.type === 'file' && part.fieldname === 'video_frame') {
          const chunks = [];
          for await (const chunk of part.file) chunks.push(chunk);
          frameBuffer = Buffer.concat(chunks);
        } else if (part.type === 'field' && part.fieldname === 'recto_path') {
          rectoPath = part.value;
        } else if (part.type === 'file') {
          // [FIX-5] Drainer les fichiers non attendus pour libérer le stream
          for await (const _ of part.file) { /* drain */ }
        }
      }
    } catch (parseErr) {
      fastify.log.error('verify-face-realtime — erreur lecture multipart : ' + parseErr.message);
      return reply.code(400).send({ error: 'Requête multipart malformée' });
    }

    // ── Validation des entrées ───────────────────────────────────────────────
    if (!frameBuffer || frameBuffer.length === 0) {
      return reply.code(400).send({ error: 'Champ video_frame manquant ou vide' });
    }
    if (frameBuffer.length > MAX_FRAME_B) {
      return reply.code(413).send({ error: `Frame trop volumineuse (max ${MAX_FRAME_MB} Mo)` });
    }
    if (isBlank(rectoPath)) {
      return reply.code(400).send({ error: 'Champ recto_path manquant ou invalide' });
    }

    // ── Résolution du chemin recto ───────────────────────────────────────────
    const resolved = resolveCNIPath(rectoPath);
    if (!resolved) {
      return reply.code(400).send({
        error: 'Photo recto introuvable ou chemin invalide',
        hint : 'Vérifiez que la photo recto CNI a bien été enregistrée à l\'étape 1'
      });
    }

    // ── Comparaison AWS Rekognition ──────────────────────────────────────────
    try {
      const rectoBuffer = await fs.promises.readFile(resolved.full); // [FIX-6]
      const { client, CompareFacesCommand } = getRekClient();

      const result = await client.send(new CompareFacesCommand({
        SourceImage        : { Bytes: frameBuffer },   // Frame live (selfie)
        TargetImage        : { Bytes: rectoBuffer },   // Photo CNI recto
        SimilarityThreshold: 50
      }));

      // ── Extraction du score ──────────────────────────────────────────────
      const faceMatches = result.FaceMatches || [];
      let score = 0;
      let motif = 'aucun_visage';

      if (faceMatches.length > 0) {
        score = Math.round((faceMatches[0].Similarity || 0) * 10) / 10;
        // VALIDATION MANUELLE : pas de décision automatique
        // Score fourni uniquement pour l'information de l'agent
        motif = 'verification_manuelle';
      } else {
        const unmatched = result.UnmatchedFaces || [];
        motif = unmatched.length === 0 ? 'aucun_visage_selfie' : 'aucun_visage_cni';
      }

      fastify.log.info(`verify-face-realtime — score=${score} motif=${motif}`);

      return reply.send({
        success : true,
        score,
        match  : null,  // Pas de décision automatique
        motif,
        message: `Score de similarité : ${score}%. La validation sera effectuée manuellement par un agent.`
      });

    } catch (err) {
      fastify.log.error('verify-face-realtime — erreur Rekognition : ' + err.message);
      return reply.code(502).send({
        error  : 'Erreur AWS Rekognition',
        details: err.message
      });
    }
  });

  // ==========================================================================
  // POST /api/dossiers/prepare-verify-session
  // --------------------------------------------------------------------------
  // Génère un sessionId et retourne l'URL de redirection vers la page KYC.
  // Reçoit (JSON) : numero_mtn, recto_path, verso_path, wa_agent, …
  // ==========================================================================
  fastify.post('/api/dossiers/prepare-verify-session', async (request, reply) => {

    fastify.log.info('prepare-verify-session — début');

    const body = request.body || {};
    const {
      numero_mtn, recto_path, verso_path,
      wa_agent, username_agent, fonction_agent, zone_agent
    } = body;

    // ── Validation ───────────────────────────────────────────────────────────
    const errors = {};
    if (isBlank(numero_mtn))  errors.numero_mtn  = 'manquant';
    if (isBlank(recto_path))  errors.recto_path  = 'manquant';
    if (isBlank(verso_path))  errors.verso_path  = 'manquant';
    if (isBlank(wa_agent))    errors.wa_agent    = 'manquant';

    if (Object.keys(errors).length > 0) {
      fastify.log.warn('prepare-verify-session — champs manquants : ' + JSON.stringify(errors));
      return reply.code(400).send({ error: 'Champs obligatoires manquants', details: errors });
    }

    // [FIX-3] verso_path dans l'URL uniquement s'il est présent et valide
    const sessionId = 'sess_' + Date.now() + '_' + Math.random().toString(36).substring(2, 11);

    const params = new URLSearchParams({
      session : sessionId,
      recto   : recto_path.trim(),
      numero  : numero_mtn.trim(),
      wa      : wa_agent.trim()
    });

    // Ajout conditionnel des champs optionnels (jamais de chaîne vide dans l'URL)
    if (!isBlank(verso_path))      params.set('verso',    verso_path.trim());
    if (!isBlank(username_agent))  params.set('username', username_agent.trim());
    if (!isBlank(fonction_agent))  params.set('fonction', fonction_agent.trim());
    if (!isBlank(zone_agent))      params.set('zone',     zone_agent.trim());

    fastify.log.info(`prepare-verify-session — sessionId=${sessionId}`);

    return reply.send({
      success    : true,
      sessionId,
      redirectUrl: `/face-verify-interactive?${params.toString()}`
    });
  });

  // ==========================================================================
  // POST /api/dossiers/complete-with-face-verify
  // --------------------------------------------------------------------------
  // Point d'entrée UNIQUE pour la création du dossier KYC final.
  // Reçoit (multipart) :
  //   video_frame      — frame live JPEG capturée pendant la vérification
  //   recto_path       — chemin relatif photo recto CNI (étape 1)
  //   verso_path       — chemin relatif photo verso CNI (étape 1)  ← OBLIGATOIRE
  //   numero_mtn       — numéro MTN (9 chiffres)
  //   wa_agent         — WhatsApp de l'agent (9 chiffres, optionnel)
  //   username_agent   — identifiant de l'agent
  //   fonction_agent   — fonction de l'agent
  //   zone_agent       — zone géographique de l'agent
  //   score_visage     — score de similarité (float)
  //   visage_match     — "1" si match, "0" sinon
  //   visage_motif     — motif textuel de la décision
  // ==========================================================================
  fastify.post('/api/dossiers/complete-with-face-verify', async (request, reply) => {

    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';

    fastify.log.info(`complete-with-face-verify — début (ip=${ip})`);

    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'Format multipart attendu' });
    }

    try {
      const fields     = {};
      let   liveBuffer = null;
      let   liveMime   = null;

      // ── Lecture multipart ──────────────────────────────────────────────────
      for await (const part of request.parts()) {
        if (part.type === 'field') {
          fields[part.fieldname] = part.value;
        } else if (part.type === 'file' && part.fieldname === 'video_frame') {
          const chunks = [];
          for await (const chunk of part.file) chunks.push(chunk);
          liveBuffer = Buffer.concat(chunks);
          liveMime   = part.mimetype;
        } else if (part.type === 'file') {
          for await (const _ of part.file) { /* drain [FIX-5] */ }
        }
      }

      const {
        numero_mtn, wa_agent, username_agent, fonction_agent, zone_agent,
        recto_path, verso_path, score_visage, visage_match, visage_motif
      } = fields;

      // ── Validation des champs obligatoires ────────────────────────────────
      if (isBlank(numero_mtn) || !/^01[0-9]{8}$/.test(numero_mtn.trim())) {
        return reply.code(400).send({ error: 'Numéro MTN invalide — 10 chiffres commençant par 01 requis' });
      }
      if (!isBlank(wa_agent) && !/^01[0-9]{8}$/.test(wa_agent.trim())) {
        return reply.code(400).send({ error: 'WhatsApp agent invalide — 10 chiffres commençant par 01 requis' });
      }

      // [FIX-1] Validation précise de recto_path et verso_path
      if (isBlank(recto_path)) {
        return reply.code(400).send({
          error: 'recto_path manquant — étape 1 incomplète',
          hint : 'La photo recto CNI n\'a pas été transmise correctement'
        });
      }
      if (isBlank(verso_path)) {
        return reply.code(400).send({
          error: 'verso_path manquant — étape 1 incomplète',
          hint : 'Vérifiez que la photo verso CNI a bien été uploadée à l\'étape 1'
        });
      }

      if (!liveBuffer || liveBuffer.length === 0) {
        return reply.code(400).send({ error: 'Frame live (video_frame) manquante ou vide' });
      }
      if (liveBuffer.length > MAX_FRAME_B) {
        return reply.code(413).send({ error: `Frame trop volumineuse (max ${MAX_FRAME_MB} Mo)` });
      }

      // ── Sécurité path-traversal : recto + verso ───────────────────────────
      const rectoResolved = resolveCNIPath(recto_path);
      if (!rectoResolved) {
        return reply.code(400).send({
          error: 'Chemin recto_path invalide ou fichier introuvable : ' + recto_path
        });
      }
      const versoResolved = resolveCNIPath(verso_path);
      if (!versoResolved) {
        return reply.code(400).send({
          error: 'Chemin verso_path invalide ou fichier introuvable : ' + verso_path,
          hint : 'Vérifiez que la photo verso CNI a bien été enregistrée à l\'étape 1'
        });
      }

      // ── Anti-doublon (même numéro, même jour, statut actif) ───────────────
      const dateJour = new Date().toISOString().slice(0, 10);
      const existant = db.prepare(
        `SELECT statut FROM dossiers
         WHERE numero_mtn = ? AND date = ?
           AND statut IN ('en_attente','en_cours','accepte')
         LIMIT 1`
      ).get(numero_mtn.trim(), dateJour);

      if (existant) {
        const libelle =
          existant.statut === 'accepte'  ? 'déjà accepté' :
          existant.statut === 'en_cours' ? 'en cours de traitement' :
                                           'en attente de certification';
        return reply.code(409).send({
          error: `Ce numéro a déjà été soumis aujourd'hui (${libelle}). ` +
                 'Il ne peut être renvoyé que s\'il a été rejeté.'
        });
      }

      // ── Génération de l'identifiant et des métadonnées ───────────────────
      const now      = new Date();
      const date     = now.toISOString().slice(0, 10);
      const heure    = now.toTimeString().slice(0, 5);
      const ts       = Math.floor(Date.now() / 1000);
      const id       = 'D' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');

      // ── Écriture de la frame live sur disque ──────────────────────────────
      const dateDir = path.join(UPLOAD_CNI, date);
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true, mode: 0o755 });
      }
      const liveExt      = liveMime === 'image/png'  ? 'png'  :
                           liveMime === 'image/webp' ? 'webp' : 'jpg';
      const liveFilename = `${id}_live.${liveExt}`;
      const liveFullPath = path.join(dateDir, liveFilename);
      await fs.promises.writeFile(liveFullPath, liveBuffer, { mode: 0o644 }); // [FIX-6]
      const livePath = `${date}/${liveFilename}`;

      // ── Décision finale basée sur score ──────────────────────────────────
      const score = (!isBlank(score_visage) && score_visage !== undefined)
        ? Number(score_visage)
        : null;
      
      // ══════════════════════════════════════════════════════════════════════
      // VALIDATION MANUELLE UNIQUEMENT - Tous les dossiers restent EN_ATTENTE
      // Les agents feront TOUTES les décisions (acceptation/rejet) manuellement
      // ══════════════════════════════════════════════════════════════════════
      
      let statut_final = 'en_attente';      // TOUJOURS EN_ATTENTE
      let raison_rejet_final = null;        // Pas de rejet automatique
      let motif = visage_motif || 'verification_manuelle';
      
      // Pas de logique automatique : score utilisé pour l'information seulement
      const match = null;  // Pas de décision automatique
      
      // Enregistrement du motif descriptif (score uniquement)
      if (score !== null) {
        motif = `verification_manuelle_score_${score.toFixed(1)}_pct`;
      }

      // ── Insertion en base avec statut décisionnel ────────────────────────
      db.prepare(`
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
      `).run(
        id,                                          // id
        numero_mtn.trim(),                           // numero_mtn
        !isBlank(wa_agent) ? wa_agent.trim() : null,           // wa_agent
        !isBlank(username_agent) ? username_agent.trim() : null, // username_agent
        !isBlank(fonction_agent) ? fonction_agent.trim() : null, // fonction_agent
        !isBlank(zone_agent) ? zone_agent.trim() : null,         // zone_agent
        date,                                        // date
        heure,                                       // heure_reception
        statut_final,                                // statut
        raison_rejet_final,                          // raison_rejet
        recto_path.trim(),                           // photo_recto
        verso_path.trim(),                           // photo_verso
        livePath,                                    // photo_live
        score,                                       // score_visage
        match,                                       // visage_match
        motif,                                       // visage_motif
        ts,                                          // visage_verifie_le
        ts                                           // created_at
      );

      audit(
        null,
        'DOSSIER_PUBLIC_CREATE',
        `id=${id} numero=${numero_mtn} wa=${wa_agent || ''} score=${score} match=${match}`,
        ip, ua
      );

      // ── Distribution FIFO automatique ─────────────────────────────────────
      try {
        require('../utils/distribution').distribuerMaintenant();
      } catch (distErr) {
        fastify.log.warn('complete-with-face-verify — distribution ignorée : ' + distErr.message);
      }

      fastify.log.info(`complete-with-face-verify — dossier créé : id=${id} match=${match}`);

      return reply.send({
        success     : true,
        id,
        numero      : numero_mtn.trim(),
        score_visage: score,
        visage_match: !!match,
        visage_motif: motif,
        message     : `Dossier créé avec vérification faciale ${match ? '✅' : '⚠️'}`
      });

    } catch (err) {
      fastify.log.error('complete-with-face-verify — erreur : ' + err.message);
      return reply.code(500).send({
        error  : 'Erreur lors de la création du dossier',
        details: err.message
      });
    }
  });

} // fin routes

module.exports = routes;