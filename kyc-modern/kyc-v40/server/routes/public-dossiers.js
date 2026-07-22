// ============================================================================
// KYC V4 - Routes publiques dossiers (agent terrain, sans auth)
// ============================================================================
// POST /api/public/dossiers       - Depose les photos recto/verso (etape 1)
//                                    Aucun dossier n'est cree ici. Le dossier
//                                    definitif est cree par
//                                    POST /api/dossiers/complete-with-face-verify
//                                    (voir server/routes/face-detect.js)
// GET  /api/public/dossiers       - Liste par wa_agent
// GET  /api/public/mon-tableau    - Tableau de bord agent terrain
// ============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');
const { db, audit } = require('../db');

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(__dirname, '..', '..', 'uploads', 'cni');
const MAX_SIZE   = 5 * 1024 * 1024;                          // 5 MB par photo
const ALLOWED    = ['image/jpeg', 'image/png', 'image/webp'];

async function routes(fastify, opts) {

  // --------------------------------------------------------------------------
  // POST /api/public/dossiers
  // Soumis par l'agent terrain depuis le formulaire acquisition.html.
  // Pas d'authentification — taux limite a 10 soumissions/min par IP.
  // --------------------------------------------------------------------------
  fastify.post('/api/public/dossiers', {
    config: {
      rateLimit: {
        max: 10,
        timeWindow: 60 * 1000
      }
    }
  }, async (request, reply) => {
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';

    if (!request.isMultipart()) {
      return reply.code(400).send({ error: 'Format multipart attendu' });
    }

    const data = { fields: {}, photos: {} };

    try {
      // -- Lecture des champs et fichiers multipart ---------------------------
      const parts = request.parts();
      for await (const part of parts) {
        if (part.type === 'field') {
          data.fields[part.fieldname] = part.value;
        } else if (part.type === 'file') {
          const label = part.fieldname; // photo_recto | photo_verso | photo_live
          if (!['photo_recto', 'photo_verso', 'photo_live'].includes(label)) {
            part.file.resume();
            continue;
          }
          if (!ALLOWED.includes(part.mimetype)) {
            part.file.resume();
            continue;
          }
          // Lire en buffer pour verifier la taille avant ecriture disque
          const chunks = [];
          for await (const chunk of part.file) {
            chunks.push(chunk);
            const total = chunks.reduce((s, c) => s + c.length, 0);
            if (total > MAX_SIZE) {
              return reply.code(413).send({ error: 'Fichier ' + label + ' trop volumineux (max 5 Mo)' });
            }
          }
          data.photos[label] = {
            buffer:   Buffer.concat(chunks),
            mimetype: part.mimetype
          };
        }
      }

      // -- Validation des champs obligatoires ---------------------------------
      const { wa_agent, username_agent, fonction_agent, zone_agent, numero_mtn } = data.fields;

      if (!numero_mtn || !/^01[0-9]{8}$/.test(numero_mtn)) {
        return reply.code(400).send({ error: 'Numero MTN invalide (10 chiffres commençant par 01 requis)' });
      }

      // Agent info is OPTIONAL for the initial photo upload
      // It will be collected during the interactive verification flow
      // Only validate if provided
      if (wa_agent && !/^01[0-9]{8}$/.test(wa_agent)) {
        return reply.code(400).send({ error: 'WhatsApp agent invalide (10 chiffres commençant par 01 requis)' });
      }
      if (!data.photos.photo_recto || !data.photos.photo_verso) {
        return reply.code(400).send({ error: 'Les photos recto et verso sont obligatoires' });
      }

      // -- Anti-doublon : meme numero deja soumis aujourd'hui ----------------
      // Verifie uniquement les dossiers REELLEMENT crees (apres verif faciale).
      // A ce stade (simple depot photos), aucun dossier n'existe encore pour
      // cette soumission : on bloque seulement si un dossier FINAL existe deja.
      {
        const dateJour = new Date().toISOString().slice(0, 10);
        const existant = db.prepare(
          "SELECT statut FROM dossiers WHERE numero_mtn = ? AND date = ? AND statut IN ('en_attente','en_cours','accepte') LIMIT 1"
        ).get(numero_mtn, dateJour);

        if (existant) {
          const libelle =
            existant.statut === 'accepte'  ? 'deja accepte' :
            existant.statut === 'en_cours' ? 'en cours de traitement' :
                                             'en attente de certification';
          return reply.code(409).send({
            error: 'Ce numero a deja ete envoye aujourd\'hui (' + libelle + '). Il ne peut etre renvoye que s\'il a ete rejete.'
          });
        }
      }

      // -- Generation d'une reference temporaire + metadata -------------------
      // Pas d'ID de dossier ici : le dossier definitif sera cree a l'etape
      // "complete-with-face-verify", apres la verification faciale interactive.
      const ref   = 'TMP' + Date.now() + Math.floor(Math.random() * 1000).toString().padStart(3, '0');
      const now   = new Date();
      const date  = now.toISOString().slice(0, 10);

      // -- Ecriture photos sur disque (recto/verso uniquement) ----------------
      const dateDir = path.join(UPLOAD_CNI, date);
      if (!fs.existsSync(dateDir)) {
        fs.mkdirSync(dateDir, { recursive: true, mode: 0o755 });
      }

      const photoPaths = {};
      for (const label of ['photo_recto', 'photo_verso']) {
        if (!data.photos[label]) continue;
        const mime     = data.photos[label].mimetype;
        const ext      = mime === 'image/png' ? 'png' : (mime === 'image/webp' ? 'webp' : 'jpg');
        const suffix   = label.replace('photo_', '');
        const filename = ref + '_' + suffix + '.' + ext;
        const fullPath = path.join(dateDir, filename);
        fs.writeFileSync(fullPath, data.photos[label].buffer, { mode: 0o644 });
        photoPaths[label] = date + '/' + filename;
      }

      audit(null, 'DOSSIER_PHOTOS_STAGED', 'ref=' + ref + ' numero=' + numero_mtn + ' wa=' + (wa_agent || ''), ip, ua);

      // Aucune insertion en base et aucune verification faciale auto a ce
      // stade : le dossier definitif est cree par
      // POST /api/dossiers/complete-with-face-verify une fois la
      // verification interactive (live + recto) terminee.
      return reply.send({
        success: true,
        ref,
        numero: numero_mtn,
        recto_path: photoPaths.photo_recto,
        verso_path: photoPaths.photo_verso
      });

    } catch (err) {
      fastify.log.error('POST /api/public/dossiers error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur', details: err.message });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/public/dossiers?wa_agent=XXXXXXXXX
  // Liste des 50 derniers dossiers de l'agent terrain (par son numero WhatsApp).
  // --------------------------------------------------------------------------
  fastify.get('/api/public/dossiers', async (request, reply) => {
    const wa = request.query.wa_agent;
    if (!wa || !/^01[0-9]{8}$/.test(wa)) {
      return reply.code(400).send({ error: 'wa_agent requis (10 chiffres commençant par 01)' });
    }
    try {
      const rows = db.prepare(`
        SELECT id, numero_mtn, statut, date, heure_reception, heure_cloture, raison_rejet, agent_saisie,
               score_visage, visage_match, visage_motif
        FROM dossiers
        WHERE wa_agent = ?
        ORDER BY created_at DESC LIMIT 50
      `).all(wa);
      return reply.send({ success: true, count: rows.length, dossiers: rows });
    } catch (err) {
      fastify.log.error('GET /api/public/dossiers error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });

  // --------------------------------------------------------------------------
  // GET /api/public/mon-tableau?wa_agent=XXXXXXXXX[&debut=YYYY-MM-DD&fin=YYYY-MM-DD]
  // Tableau de bord individuel de l'agent terrain.
  // Compteurs exacts (sans plafond) + liste de la periode.
  // --------------------------------------------------------------------------
  fastify.get('/api/public/mon-tableau', async (request, reply) => {
    const wa = request.query.wa_agent;
    if (!wa || !/^01[0-9]{8}$/.test(wa)) {
      return reply.code(400).send({ error: 'wa_agent requis (10 chiffres commençant par 01)' });
    }

    const dateRe = /^\d{4}-\d{2}-\d{2}$/;
    const debut  = request.query.debut;
    const fin    = request.query.fin;

    try {
      let where  = 'wa_agent = ?';
      const params = [wa];
      if (debut && dateRe.test(debut)) { where += ' AND date >= ?'; params.push(debut); }
      if (fin   && dateRe.test(fin))   { where += ' AND date <= ?'; params.push(fin); }

      const countsRows = db.prepare(
        'SELECT statut, COUNT(*) AS n FROM dossiers WHERE ' + where + ' GROUP BY statut'
      ).all(...params);

      const c = { en_attente: 0, en_cours: 0, accepte: 0, rejete: 0 };
      for (const r of countsRows) {
        if (c[r.statut] !== undefined) c[r.statut] = r.n;
      }

      const compteurs = {
        envoyes:   c.en_attente + c.en_cours,
        certifies: c.accepte,
        rejetes:   c.rejete,
        total:     c.en_attente + c.en_cours + c.accepte + c.rejete
      };

      const dossiers = db.prepare(
        'SELECT id, numero_mtn, statut, date, heure_reception, heure_cloture, raison_rejet, ' +
        'score_visage, visage_match, visage_motif ' +
        'FROM dossiers WHERE ' + where + ' ORDER BY created_at DESC LIMIT 1000'
      ).all(...params);

      return reply.send({ success: true, compteurs, count: dossiers.length, dossiers });

    } catch (err) {
      fastify.log.error('GET /api/public/mon-tableau error: ' + err.message);
      return reply.code(500).send({ error: 'Erreur serveur' });
    }
  });
}

module.exports = routes;