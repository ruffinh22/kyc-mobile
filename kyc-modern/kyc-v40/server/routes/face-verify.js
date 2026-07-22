// ============================================================================
// KYC V4 - Reconnaissance faciale (AWS Rekognition)
// ============================================================================
// POST /api/dossiers/:id/verifier-visage
//   Envoie photo_live + photo_recto a AWS CompareFaces.
//   Stocke le score de similarite dans dossiers.score_visage.
//   Retourne { score, match, motif }.
//
// Appele automatiquement par public-dossiers.js apres sauvegarde des photos
// (via la fonction interne verifierVisageAuto).
// Peut aussi etre appele manuellement par un superviseur/admin depuis l'UI.
//
// Regles d'acces :
//   - Route HTTP protegee : superviseur ou admin seulement
//   - Fonction interne verifierVisageAuto() : pas d'auth (appelee en interne)
// ============================================================================
'use strict';

const fs   = require('fs');
const path = require('path');
const { db } = require('../db');
const { requireAuth } = require('../middleware/auth');

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(__dirname, '..', '..', 'uploads', 'cni');

// ============================================================================
// VALIDATION MANUELLE UNIQUEMENT - Pas de décision automatique
// Les agents feront TOUTES les validations (acceptation/rejet) manuellement
// ============================================================================
// Anciennement :
// const SEUIL_REJET  = 60;   // Score < 60% => REJET AUTOMATIQUE
// const SEUIL_ACCEPT = 90;   // Score >= 90% => ACCEPTATION AUTOMATIQUE
// Maintenant : Tous les dossiers restent EN_ATTENTE jusqu'à validation agent
// Ces valeurs sont maintenues pour compatibilité mais ne sont pas utilisées
const SEUIL_REJET  = 60;
const SEUIL_ACCEPT = 90;

// --------------------------------------------------------------------------
// Helper : charge le client Rekognition de maniere paresseuse (lazy).
// On evite de planter le serveur si la lib AWS n'est pas encore installee.
// --------------------------------------------------------------------------
let _rekClient = null;
function getRekClient() {
  if (_rekClient) return _rekClient;

  // Verifier que les cles sont presentes
  const region = process.env.AWS_REGION;
  const keyId  = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;

  if (!region || !keyId || !secret) {
    throw new Error(
      'Variables AWS manquantes dans .env : AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY'
    );
  }

  // Chargement dynamique pour ne pas bloquer le demarrage si la lib absente
  let RekognitionClient, CompareFacesCommand;
  try {
    ({ RekognitionClient, CompareFacesCommand } = require('@aws-sdk/client-rekognition'));
  } catch (e) {
    throw new Error(
      "Module @aws-sdk/client-rekognition introuvable. Executez : npm install @aws-sdk/client-rekognition"
    );
  }

  _rekClient = {
    client: new RekognitionClient({ region }),
    CompareFacesCommand
  };
  return _rekClient;
}

// --------------------------------------------------------------------------
// verifierVisageAuto(dossierId, log)
//
// Fonction interne appelee depuis public-dossiers.js juste apres la creation
// du dossier. Retourne { score, match, motif } ou null en cas d'erreur non
// bloquante (le dossier est cree quoi qu'il arrive).
//
// @param {string} dossierId  - ID du dossier (ex: "D1720000000001")
// @param {function} log      - logger (ex: fastify.log.info ou console.log)
// --------------------------------------------------------------------------
async function verifierVisageAuto(dossierId, log) {
  try {
    // 1. Charger les chemins depuis la DB
    const row = db
      .prepare('SELECT photo_live, photo_recto FROM dossiers WHERE id = ?')
      .get(dossierId);

    if (!row || !row.photo_live || !row.photo_recto) {
      if (log) log('verifierVisageAuto: photos manquantes pour ' + dossierId);
      return null;
    }

    // 2. Lire les fichiers en buffer
    const pathLive  = path.resolve(UPLOAD_CNI, row.photo_live);
    const pathRecto = path.resolve(UPLOAD_CNI, row.photo_recto);

    // Securite chemin (traverse check)
    const base = path.resolve(UPLOAD_CNI) + path.sep;
    if (!pathLive.startsWith(base) || !pathRecto.startsWith(base)) {
      if (log) log('verifierVisageAuto: chemin hors repertoire pour ' + dossierId);
      return null;
    }

    if (!fs.existsSync(pathLive) || !fs.existsSync(pathRecto)) {
      if (log) log('verifierVisageAuto: fichier(s) absent(s) pour ' + dossierId);
      return null;
    }

    const bufferLive  = fs.readFileSync(pathLive);
    const bufferRecto = fs.readFileSync(pathRecto);

    // 3. Appel AWS Rekognition
    const { client, CompareFacesCommand } = getRekClient();

    const cmd = new CompareFacesCommand({
      // SourceImage = visage de reference (selfie live pris par l'agent terrain)
      SourceImage: { Bytes: bufferLive },
      // TargetImage = document d'identite (recto CNI)
      TargetImage: { Bytes: bufferRecto },
      SimilarityThreshold: 50  // On recupere tout >= 50%, on decide cote applicatif
    });

    const result = await client.send(cmd);

    // 4. Extraire le score
    const faceMatches = result.FaceMatches || [];
    let score = 0;
    let motif = 'aucun_visage';

    if (faceMatches.length > 0) {
      // AWS retourne les matches tries par similarite desc — on prend le meilleur
      score = Math.round((faceMatches[0].Similarity || 0) * 10) / 10;
      // VALIDATION MANUELLE : pas de décision automatique
      // Score enregistré pour l'information seulement
      motif = `verification_manuelle_score_${score.toFixed(1)}_pct`;
    } else {
      // Rekognition n'a pas trouve de visage comparable
      // UnmatchedFaces = visages detectes dans la source mais sans match dans la cible
      const unmatched = result.UnmatchedFaces || [];
      if (unmatched.length === 0) {
        // Aucun visage detecte dans le selfie
        motif = 'aucun_visage_selfie';
      } else {
        // Visage detecte dans le selfie mais aucun dans le recto
        motif = 'aucun_visage_cni';
      }
    }

    // ══════════════════════════════════════════════════════════════════════════
    // VALIDATION MANUELLE UNIQUEMENT - Tous les dossiers restent EN_ATTENTE
    // Les agents feront TOUTES les validations (acceptation/rejet) manuellement
    // ══════════════════════════════════════════════════════════════════════════
    let statut = 'en_attente';  // TOUJOURS EN_ATTENTE
    let match = null;           // Pas de décision automatique

    // 5. Stocker dans la DB
    db.prepare(
      'UPDATE dossiers SET score_visage = ?, visage_match = ?, visage_motif = ?, visage_verifie_le = ?, statut = ? WHERE id = ?'
    ).run(score, match, motif, Math.floor(Date.now() / 1000), statut, dossierId);

    if (log) log('verifierVisageAuto: id=' + dossierId + ' score=' + score + ' match=' + match + ' motif=' + motif);

    return { score, match, motif };

  } catch (err) {
    if (log) log('verifierVisageAuto erreur (non bloquante): ' + err.message);
    // On stocke l'erreur dans la DB pour pouvoir reessayer
    try {
      db.prepare(
        "UPDATE dossiers SET score_visage = NULL, visage_match = NULL, visage_motif = 'erreur_aws', visage_verifie_le = ? WHERE id = ?"
      ).run(Math.floor(Date.now() / 1000), dossierId);
    } catch (dbErr) {
      // Ne pas propager — la creation du dossier ne doit pas echouer
    }
    return null;
  }
}

// --------------------------------------------------------------------------
// Route Fastify :
// POST /api/dossiers/:id/verifier-visage
//
// Permet de relancer manuellement la verification pour un dossier deja cree.
// Reserve aux superviseurs et admins.
// --------------------------------------------------------------------------
async function routes(fastify, opts) {

  fastify.addHook('preHandler', requireAuth);

  fastify.post('/api/dossiers/:id/verifier-visage', async (request, reply) => {
    const { id } = request.params;
    const { role, matricule } = request.user;
    const ip = request.ip;
    const ua = request.headers['user-agent'] || '';

    // Seuls sup/admin peuvent relancer manuellement
    if (role !== 'superviseur' && role !== 'admin') {
      return reply.code(403).send({ error: 'Acces reserve aux superviseurs et administrateurs' });
    }

    // Verifier que le dossier existe
    const dossier = db
      .prepare('SELECT id, statut, photo_live, photo_recto FROM dossiers WHERE id = ?')
      .get(id);

    if (!dossier) {
      return reply.code(404).send({ error: 'Dossier introuvable' });
    }

    if (!dossier.photo_live || !dossier.photo_recto) {
      return reply.code(422).send({ error: 'Photos manquantes pour ce dossier (live ou recto absents)' });
    }

    // Lancer la verification
    const resultat = await verifierVisageAuto(id, fastify.log.info.bind(fastify.log));

    if (!resultat) {
      return reply.code(502).send({
        error: 'Verification AWS echouee. Verifiez les variables AWS_* dans .env et que le module @aws-sdk/client-rekognition est installe.'
      });
    }

    // Audit
    try {
      const { audit } = require('../db');
      audit(
        matricule,
        'FACE_VERIFY_MANUEL',
        'id=' + id + ' score=' + resultat.score,
        ip,
        ua
      );
    } catch (e) {}

    // ══════════════════════════════════════════════════════════════════════════
    // VALIDATION MANUELLE UNIQUEMENT - Dossier reste EN_ATTENTE
    // Les agents feront la décision (acceptation/rejet) manuellement
    // ══════════════════════════════════════════════════════════════════════════
    const statut = 'en_attente';  // TOUJOURS EN_ATTENTE

    return reply.send({
      success: true,
      id,
      score:        resultat.score,
      statut:       statut,
      motif:        resultat.motif,
      seuil_rejet:  SEUIL_REJET,
      seuil_accept: SEUIL_ACCEPT,
      message:      'Score enregistré. La validation sera effectuée manuellement par un agent.'
    });
  });
}

module.exports = routes;
module.exports.verifierVisageAuto = verifierVisageAuto;
module.exports.SEUIL_REJET = SEUIL_REJET;
module.exports.SEUIL_ACCEPT = SEUIL_ACCEPT;
