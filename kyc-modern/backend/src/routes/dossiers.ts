import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { Dossier } from '../types';
import { appelerProchainDossier, prendreDossierSpecifique, transferDossierToAgent, releaseAgentLock } from '../db/locks';
import {
  listChampsActifs,
  checkChampsObligatoiresDynamique,
  OFFICIAL_DOC_TYPES,
} from '../db/customFields';
import { buildFicheDossierPdf } from '../services/ficheDossierPdf';

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(),'uploads','cni');
const MAX_FILE_REATTR = 5 * 1024 * 1024; // 5 Mo
const ALLOWED_MIME_REATTR = new Set(['image/jpeg', 'image/png', 'image/webp']);
// Champs "identité" standards remplacés lors d'une réattribution — la liste
// réelle des champs actifs (standards + custom) est complétée dynamiquement
// via listChampsActifs() au moment de la requête.
const IDENTITE_STANDARD = [
  'nom_titulaire', 'prenom_titulaire', 'date_naissance', 'lieu_naissance',
  'type_piece', 'numero_cni', 'date_expiration', 'sexe', 'nationalite',
  'profession', 'nom_pere', 'nom_mere', 'adresse_complete', 'autre_numero',
];

// nowSec() vient désormais de '../db' (db.nowSec) — avant, ce fichier avait
// sa PROPRE fonction locale (Math.floor(Date.now()/1000)), distincte de celle
// utilisée par utils/distribution.ts. Deux horloges qui écrivent/lisent la
// même colonne `assigne_le` peuvent diverger (dérive d'horloge process vs
// pool DB, redémarrage, etc.) et fausser le calcul du compte à rebours côté
// agent ainsi que le déclenchement du filet de sécurité côté worker.
function nowTime() { return new Date().toTimeString().slice(0,5); }
function nowDate() { return new Date().toLocaleDateString('en-CA'); }

function normalizeDossier(d: Dossier): Dossier {
  const score = d.score_visage != null ? Number(d.score_visage) : null;
  const match = d.visage_match != null ? Number(d.visage_match) : null;
  return {
    ...d,
    score_visage: Number.isFinite(score) ? score : null,
    visage_match: Number.isFinite(match) ? match : null,
  };
}

function maskDossier(d: Dossier, matricule: string, role: string): Dossier {
  if (role === 'superviseur' || role === 'admin') return d;
  const canSee = role === 'agent' && (d.agent_saisie === matricule || d.statut === 'en_attente');
  if (canSee) return d;
  return {
    ...d,
    numero_mtn: '***', wa_agent: '***',
    photo_recto: null, photo_verso: null, photo_live: null,
    // Infos titulaire/SIM — mêmes règles de confidentialité que numero_mtn/photos
    nom_titulaire: '***', prenom_titulaire: '***',
    date_naissance: '***', lieu_naissance: '***',
    autre_numero: '***', nom_pere: '***', nom_mere: '***',
    masque: true,
  };
}

export async function dossiersRoutes(app: any): Promise<void> {
  (app as unknown as { addHook: (name: string, hook: typeof requireAuth) => void }).addHook('preHandler', requireAuth);

  // GET /api/dossiers
  app.get('/api/dossiers', async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule, role } = req.user;
    const q = req.query as Record<string,string>;
    const agentFilter = role === 'agent' ? matricule : (q.agent || null);
    const scope = q.scope === 'mine' || q.scope === 'queue' ? q.scope : (role === 'agent' ? 'mine' : 'all');
    const { rows, total } = await db.getDossiers({
      date: q.date||null, debut: q.debut||null, fin: q.fin||null,
      statut: q.statut||null, agent: agentFilter, search: q.search||null,
      scope, limit: Math.min(parseInt(q.limit||'100',10),500),
      offset: parseInt(q.offset||'0',10),
    });
    return reply.send({ success: true, total, count: rows.length, dossiers: rows.map(d => maskDossier(normalizeDossier(d), matricule, role)) });
  });

  // GET /api/dossiers/stats
  app.get('/api/dossiers/stats', async (req: FastifyRequest, reply: FastifyReply) => {
    const q = req.query as Record<string,string>;
    const stats = await db.getDossierStats(q.date || nowDate());
    return reply.send({ success: true, ...stats });
  });

  // GET /api/dossiers/:id
  app.get('/api/dossiers/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    const d = await db.getDossierById(params.id) as (Dossier & { traitement_demarre_le?: number | null; derniere_activite_le?: number | null });
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });

    // `traitement_demarre_le` : posé UNE SEULE FOIS, à la toute première
    // ouverture de CE dossier précis par l'agent responsable (concrètement :
    // l'arrivée sur l'écran de saisie GSM, voir GsmSaisie dans GsmPages.tsx,
    // qui charge le dossier via cette même route). Reste inchangé une fois
    // posé (COALESCE côté SQL) — sert de repère "début réel du traitement",
    // affiché côté agent, indépendant du flux d'activité ci-dessous.
    //
    // `derniere_activite_le` : à l'inverse, RAFRAÎCHIE à chaque signe de vie
    // de l'agent SUR ce dossier — chaque ouverture de cette route en fait
    // partie, au même titre que les sauvegardes réelles et les pings dédiés
    // (voir POST /:id/activite ci-dessous et GsmSaisie côté frontend pour un
    // ping périodique pendant la saisie, et handleCallTerrain dans
    // DossierPages.tsx pour le clic "Appeler terrain"). C'est ce champ que
    // utils/distribution.ts lit désormais pour son filet de sécurité, à la
    // place de la présence générale (heartbeat ping-dispo, indépendant de
    // l'écran affiché) : un agent "en ligne" ailleurs (autre onglet, pause
    // café session ouverte...) ne protège plus indéfiniment un dossier qu'il
    // n'a pas concrètement touché depuis `abandonSec`.
    if (req.user.role === 'agent' && d.agent_saisie === req.user.matricule && d.statut === 'en_cours') {
      const maintenant = db.nowSec();
      if (!d.traitement_demarre_le) d.traitement_demarre_le = maintenant;
      d.derniere_activite_le = maintenant;
      db.exec(
        `UPDATE dossiers SET traitement_demarre_le=COALESCE(traitement_demarre_le,?), derniere_activite_le=?
         WHERE id=? AND agent_saisie=? AND statut='en_cours'`,
        [maintenant, maintenant, d.id, req.user.matricule]
      ).catch(() => {});
    }

    return reply.send({ success: true, dossier: maskDossier(normalizeDossier(d), req.user.matricule, req.user.role) });
  });

  // POST /api/dossiers/:id/activite - Ping d'activité dédié, à un dossier
  // précis, pendant que l'agent le traite (voir derniere_activite_le
  // ci-dessus). Appelé explicitement par le frontend pour tout signe de vie
  // qui ne passe PAS par un GET /:id ni par une écriture réelle du dossier :
  // aujourd'hui, le clic "Appeler terrain" (handleCallTerrain dans
  // DossierPages.tsx, avant la redirection vers /video-call) et le ping
  // périodique pendant la saisie GSM (GsmSaisie dans GsmPages.tsx). N'écrit
  // rien d'autre que l'horodatage : ni statut, ni verrou, ni audit — c'est
  // un heartbeat, pas une action métier.
  app.post('/api/dossiers/:id/activite', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const result = await db.exec(
      `UPDATE dossiers SET derniere_activite_le=? WHERE id=? AND agent_saisie=? AND statut='en_cours'`,
      [db.nowSec(), params.id, req.user.matricule]
    );
    return reply.send({ success: true, updated: result.affectedRows === 1 });
  });

  // GET /api/dossiers/:id/photo/:type
  app.get('/api/dossiers/:id/photo/:type', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string; type: string };
    const { matricule, role } = req.user;
    const log = req.log as unknown as { info: (payload: Record<string, unknown>, msg?: string) => void };
    if (!['recto','verso','live','signature'].includes(params.type)) return reply.code(400).send({ error: 'Type invalide' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    log.info({ event: 'photo-access', dossierId: params.id, type: params.type, user: req.user, agent_saisie: d.agent_saisie, statut: d.statut }, 'photo access check');
    if (role === 'agent' && d.statut !== 'en_attente' && d.agent_saisie !== matricule) {
      log.info({ reason: 'access_rejected', expectedMatricule: matricule, actualAgentSaisie: d.agent_saisie, statut: d.statut }, 'photo access denied');
      return reply.code(403).send({ error: 'Accès refusé' });
    }
    const field = `photo_${params.type}` as 'photo_recto'|'photo_verso'|'photo_live'|'photo_signature';
    if (!d[field]) return reply.code(404).send({ error: 'Photo non disponible' });
    const safeRoot = path.resolve(UPLOAD_CNI);
    const fullPath = path.resolve(safeRoot, d[field]!);
    const relative = path.relative(safeRoot, fullPath);
    log.info({ field, safeRoot, fullPath, relative }, 'photo path debug');
    if (relative.startsWith('..') || path.isAbsolute(relative)) return reply.code(403).send({ error: 'Chemin interdit' });
    if (!fs.existsSync(fullPath)) return reply.code(404).send({ error: 'Fichier introuvable' });
    const ext = path.extname(fullPath).toLowerCase();
    const mimes: Record<string,string> = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
    const replyWithHeaders = reply as unknown as { raw: { setHeader: (name: string, value: string) => void } };
    replyWithHeaders.raw.setHeader('Content-Type', mimes[ext]||'application/octet-stream');
    replyWithHeaders.raw.setHeader('Cache-Control','private,max-age=3600');
    return reply.send(fs.createReadStream(fullPath));
  });

  // GET /api/dossiers/:id/fiche-pdf — génère la « fiche dossier » PDF
  // (bandeau MTN, identité, pièce/vérif. faciale, GSM, photos, historique
  // des réattributions). Mêmes règles d'accès que /reattributions ci-dessus :
  // sup/admin toujours, agent uniquement sur son propre dossier assigné (ou
  // encore en_attente). Voir services/ficheDossierPdf.ts pour la mise en page.
  app.get('/api/dossiers/:id/fiche-pdf', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    const { matricule, role } = req.user;
    const dossier = await db.getDossierById(params.id);
    if (!dossier) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (role === 'agent' && dossier.agent_saisie !== matricule && dossier.statut !== 'en_attente') {
      return reply.code(403).send({ error: 'Accès refusé' });
    }

    const rows = await db.getReattributions(params.id);
    const reattributions = rows.map(r => ({ ...r, ancien_snapshot: JSON.parse(r.ancien_snapshot || '{}') }));

    let pdf: Buffer;
    try {
      pdf = await buildFicheDossierPdf(normalizeDossier(dossier), reattributions, matricule);
    } catch (err: any) {
      req.log.error({ err, dossierId: params.id }, 'fiche-pdf generation failed');
      return reply.code(500).send({ error: 'Impossible de générer la fiche PDF' });
    }

    db.audit(matricule, 'DOSSIER_FICHE_PDF', `id=${params.id}`, req.ip);

    reply.header('Content-Type', 'application/pdf');
    reply.header('Content-Disposition', `attachment; filename="fiche-dossier-${params.id}.pdf"`);
    reply.header('Cache-Control', 'private, no-store');
    return reply.send(pdf);
  });

  // GET /api/dossiers/flux?token=xxx - Flux SSE temps réel (notification d'attribution)
  // EventSource ne peut pas envoyer de header Authorization: on lit le token
  // en query string et on le valide manuellement
  app.get('/api/dossiers/flux', { preHandler: async (req, reply) => {
    // Cette route gère son auth elle-même (token en query, pas de header)
    const token = (req.query as { token?: string }).token;
    if (!token) return reply.code(401).send({ error: 'Token manquant' });
    
    const authUtil = await import('../utils/auth.js');
    const decoded = authUtil.verifyToken(token);
    if (!decoded) return reply.code(401).send({ error: 'Token invalide' });
    
    const isValid = await db.isSessionValid(decoded.jti);
    if (!isValid) return reply.code(401).send({ error: 'Session révoquée' });
    
    (req as any).user = decoded;
  }}, async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule } = req.user;
    const sse = await import('../utils/sse.js');
    
    // Préparer le flux SSE
    reply.raw.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    });
    reply.raw.write('event: connecte\ndata: {"ok":true}\n\n');
    
    sse.ajouter(matricule, reply.raw);
    
    // Nettoyage à la fermeture (onglet fermé, réseau coupé)
    (req as any).raw.on('close', () => { sse.retirer(matricule, reply.raw); });
    
    // On garde la connexion ouverte: pas de return/reply.send
  });

  // POST /api/dossiers/:id/prendre
  // AVANT : lisait le dossier, vérifiait son statut, puis faisait un UPDATE
  // séparé — aucune protection contre le fait qu'un push automatique
  // (utils/distribution.ts) attribue à ce même agent un AUTRE dossier entre
  // la lecture et l'UPDATE. Passe maintenant par le verrou exclusif
  // (agent_dossier_lock, PK matricule) : un agent ne peut jamais se voir
  // attribuer 2 dossiers en_cours, peu importe le chemin (prendre / appeler /
  // push worker / transfert).
  app.post('/api/dossiers/:id/prendre', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });

    const result = await prendreDossierSpecifique(req.user.matricule, params.id);
    if (result === 'agent_occupe') return reply.code(409).send({ error: 'Vous avez déjà un dossier en cours' });
    if (result === 'dossier_indisponible') return reply.code(409).send({ error: 'Dossier indisponible (déjà pris ou statut invalide)' });

    await db.upsertPresence(req.user.matricule, 'online');
    db.audit(req.user.matricule,'DOSSIER_PRIS',`id=${params.id}`,req.ip);
    try {
      const sse = await import('../utils/sse.js');
      sse.notifier(req.user.matricule, 'nouveau-dossier', { id: params.id });
    } catch (e) {}
    return reply.send({ success: true });
  });

  // POST /api/dossiers/appeler - Mode AUTO: appeler le prochain dossier
  // AVANT : boucle "5 essais" avec UPDATE ... WHERE statut='en_attente' et
  // aucune coordination avec le worker de distribution (utils/distribution.ts).
  // Un agent pouvait recevoir un dossier via CE endpoint ET, dans la même
  // fenêtre de quelques ms, via le push automatique du worker — deux dossiers
  // en_cours pour le même agent, FIFO cassé. appelerProchainDossier() pose le
  // verrou et assigne le dossier dans une seule transaction ; si l'agent a
  // déjà un dossier en_cours (peu importe par quel chemin), l'attribution
  // échoue proprement au lieu de créer un doublon.
  //
  //
  // NOTE : le verrou (agent_dossier_lock, PK matricule) ne peut structurellement
  // contenir qu'UN dossier par agent. L'ancienne limite `distribution_max_total`
  // (qui autorisait >1 dossier en_cours simultané par agent) n'est donc plus
  // compatible avec ce mécanisme et n'est plus appliquée ici — si ce
  // comportement "plusieurs dossiers en parallèle par agent" est réellement
  // voulu, il faut revoir le schéma du verrou (clé composite matricule+slot)
  // plutôt que de le contourner.

  app.post('/api/dossiers/appeler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const { matricule } = req.user;

    const res = await appelerProchainDossier(matricule);

    if (res.result === 'agent_occupe') {
      return reply.code(409).send({ error: 'Vous avez déjà un dossier en cours' });
    }
    if (res.result === 'aucun_dossier') {
      return reply.send({ success: true, aucun: true, message: 'Aucun dossier en attente' });
    }

    // L'agent devient occupé: on efface dispo_depuis
    try {
      await db.exec("UPDATE presence SET dispo_depuis = NULL WHERE matricule = ?", [matricule]);
    } catch (e) {}

    db.audit(matricule, 'DOSSIER_APPELER', `id=${res.dossierId} numero=${res.numeroMtn}`, req.ip);

    // Notifier via SSE
    try {
      const sse = await import('../utils/sse.js');
      sse.notifier(matricule, 'nouveau-dossier', { id: res.dossierId });
    } catch(e){}

    return reply.send({ success: true, id: res.dossierId });
  });

  // POST /api/dossiers/ping-dispo - L'agent signale qu'il est présent et actif
  app.post('/api/dossiers/ping-dispo', async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule } = req.user;
    const maintenant = db.nowSec();
    
    await db.exec(
      `INSERT INTO presence (matricule, statut, ts, updated_at) 
       VALUES (?, 'online', ?, ?) 
       ON DUPLICATE KEY UPDATE 
       statut = CASE WHEN presence.statut = 'pause' THEN 'pause' ELSE 'online' END,
       ts = VALUES(ts),
       updated_at = VALUES(updated_at)`,
      [matricule, maintenant, maintenant]
    );
    
    return reply.send({ success: true });
  });

  // POST /api/dossiers/pause - Bascule pause <-> reprise
  app.post('/api/dossiers/pause', async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule } = req.user;
    const body = req.body as { action?: string } | null;
    const { action } = body || {};
    const maintenant = db.nowSec();

    if (action === 'pause') {
      // Renvoyer ses dossiers en cours dans la file
      const remis = await db.exec(
        `UPDATE dossiers 
         SET statut='en_attente', agent_saisie=NULL, assigne_a=NULL, 
             assigne_le=NULL, heure_prise=NULL, traitement_demarre_le=NULL,
             derniere_activite_le=NULL, updated_at=? 
         WHERE agent_saisie=? AND statut='en_cours'`,
        [maintenant, matricule]
      );

      // Passer en pause
      await db.exec(
        `INSERT INTO presence (matricule, statut, ts, pause_debut, dispo_depuis, updated_at) 
         VALUES (?, 'pause', ?, ?, NULL, ?) 
         ON DUPLICATE KEY UPDATE 
         statut='pause', ts=VALUES(ts), pause_debut=VALUES(pause_debut), 
         dispo_depuis=NULL, updated_at=VALUES(updated_at)`,
        [matricule, maintenant, maintenant, maintenant]
      );

      // Libérer le verrou de l'agent : ses dossiers en_cours viennent d'être
      // remis en_attente ci-dessus, donc son verrou (s'il en avait un) est
      // maintenant obsolète. Sans ça, il resterait "occupé" du point de vue
      // du système de verrou même une fois en pause, jusqu'à la prochaine
      // réconciliation périodique.
      await releaseAgentLock(matricule);

      db.audit(matricule, 'AGENT_PAUSE', `dossiers_remis=${remis.affectedRows}`, req.ip);

      // Redistribuer aussitôt les dossiers remis
      try {
        const { distribuerMaintenant } = await import('../utils/distribution.js');
        await distribuerMaintenant();
      } catch (e) {}

      return reply.send({ success: true, statut: 'pause', dossiers_remis: remis.affectedRows });
    } else if (action === 'reprendre') {
      // Calculer la durée de la pause qui se termine
      let duree = 0;
      try {
        const p = await db.query<{ pause_debut: number }>(
          "SELECT pause_debut FROM presence WHERE matricule = ?",
          [matricule]
        );
        if (p.length && p[0].pause_debut) {
          duree = maintenant - p[0].pause_debut;
        }
      } catch (e) {}

      await db.exec(
        `INSERT INTO presence (matricule, statut, ts, pause_debut, updated_at) 
         VALUES (?, 'online', ?, NULL, ?) 
         ON DUPLICATE KEY UPDATE 
         statut='online', ts=VALUES(ts), pause_debut=NULL, updated_at=VALUES(updated_at)`,
        [matricule, maintenant, maintenant]
      );

      db.audit(matricule, 'AGENT_REPRISE', `duree_sec=${duree}`, req.ip);
      return reply.send({ success: true, statut: 'online', duree });
    } else {
      return reply.code(400).send({ error: 'Action invalide (pause ou reprendre)' });
    }
  });

  // POST /api/dossiers/:id/accepter
  app.post('/api/dossiers/:id/accepter', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (d.statut !== 'en_cours') return reply.code(409).send({ error: 'Dossier non en cours' });
    if (d.agent_saisie !== req.user.matricule) return reply.code(403).send({ error: 'Pas votre dossier' });
    const body = req.body as { resultat_crm?: string }|null;
    await db.updateDossier(params.id, { statut: 'accepte', heure_cloture: nowTime(), closed_at: db.nowSec(), resultat_crm: body?.resultat_crm??null });
    // Le dossier quitte en_cours pour cet agent : libérer son verrou, sinon
    // il reste "occupé" pour appelerProchainDossier()/prendre() jusqu'à la
    // prochaine réconciliation, malgré un dossier bien clôturé.
    await releaseAgentLock(req.user.matricule);
    db.audit(req.user.matricule,'DOSSIER_ACCEPTE',`id=${params.id}`,req.ip);
    return reply.send({ success: true });
  });

  // POST /api/dossiers/:id/rejeter
  app.post('/api/dossiers/:id/rejeter', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (d.statut !== 'en_cours') return reply.code(409).send({ error: 'Dossier non en cours' });
    if (d.agent_saisie !== req.user.matricule) return reply.code(403).send({ error: 'Pas votre dossier' });
    const body = req.body as { raison?: string }|null;
    if (!body?.raison?.trim()) return reply.code(400).send({ error: 'Raison obligatoire' });
    await db.updateDossier(params.id, { statut: 'rejete', heure_cloture: nowTime(), closed_at: db.nowSec(), raison_rejet: body.raison.trim() });
    // Même remarque que /accepter : le dossier quitte en_cours, le verrou
    // de l'agent doit être libéré ici, pas seulement en pause.
    await releaseAgentLock(req.user.matricule);
    db.audit(req.user.matricule,'DOSSIER_REJETE',`id=${params.id} raison=${body.raison}`,req.ip);
    return reply.send({ success: true });
  });

  // POST /api/dossiers/:id/reprendre-face-verify
  app.post('/api/dossiers/:id/reprendre-face-verify', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (d.agent_saisie !== req.user.matricule) return reply.code(403).send({ error: 'Pas votre dossier' });

    await db.updateDossier(params.id, {
      statut: 'en_cours',
      acquisition_status: 'face_verify_retry',
      flow_step: 4,
      score_visage: null,
      visage_match: null,
      visage_motif: null,
      visage_verifie_le: null,
      raison_rejet: null,
    });
    // Relance active du flux par l'agent sur SON dossier : signe de vie à
    // part entière, au même titre qu'une ouverture (GET /:id) — rafraîchit
    // derniere_activite_le pour ne pas laisser le filet de sécurité de
    // utils/distribution.ts croire à un abandon pendant que l'agent recommence
    // la vérification faciale.
    await db.exec(
      `UPDATE dossiers SET derniere_activite_le=? WHERE id=? AND agent_saisie=? AND statut='en_cours'`,
      [db.nowSec(), params.id, req.user.matricule]
    ).catch(() => {});

    db.audit(req.user.matricule, 'DOSSIER_FACE_VERIFY_REPRISE', `id=${params.id}`, req.ip);
    return reply.send({ success: true, message: 'La vérification faciale peut être relancée.' });
  });

  // ==========================================================================
  // POST /api/dossiers/:id/reattribution
  // --------------------------------------------------------------------------
  // Réattribution GSM : un dossier déjà enregistré (numéro MTN existant) est
  // ré-attribué à une NOUVELLE personne. La nouvelle pièce d'identité
  // (recto/verso) est re-capturée par le superviseur/admin ; l'ancien
  // titulaire est figé dans dossier_reattributions pour l'audit. Le dossier
  // repart ensuite dans le circuit normal de vérification.
  // ==========================================================================
  app.post('/api/dossiers/:id/reattribution',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (!(req as any).isMultipart?.()) {
      return reply.code(400).send({ error: 'Format multipart attendu' });
    }

    const dossier = await db.getDossierById(params.id);
    if (!dossier) return reply.code(404).send({ error: 'Dossier introuvable' });

    const fields: Record<string, string> = {};
    const photos: Record<string, { buf: Buffer; mime: string }> = {};
    try {
      for await (const part of (req as any).parts()) {
        if (part.type === 'field') {
          fields[part.fieldname] = String(part.value ?? '');
        } else if (part.type === 'file') {
          if (!['photo_recto', 'photo_verso', 'photo_signature'].includes(part.fieldname) || !ALLOWED_MIME_REATTR.has(part.mimetype)) {
            part.file.resume(); continue;
          }
          const chunks: Buffer[] = []; let size = 0;
          for await (const chunk of part.file) {
            size += chunk.length;
            if (size > MAX_FILE_REATTR) return reply.code(413).send({ error: 'Fichier trop volumineux (max 5 Mo)' });
            chunks.push(chunk);
          }
          photos[part.fieldname] = { buf: Buffer.concat(chunks), mime: part.mimetype };
        }
      }
    } catch { return reply.code(400).send({ error: 'Erreur lecture multipart' }); }

    // Nom/prénom du nouveau titulaire : c'est l'objet même d'une
    // réattribution (identifier la personne à qui le dossier est transféré),
    // donc volontairement toujours exigé ici — indépendamment de la config
    // admin de ces deux champs pour l'écran d'acquisition initiale.
    if (!fields.nom_titulaire?.trim() || !fields.prenom_titulaire?.trim()) {
      return reply.code(400).send({ error: 'Nom et prénom du nouveau titulaire requis' });
    }
    if (!photos.photo_recto || !photos.photo_verso) {
      return reply.code(400).send({ error: 'Nouvelle pièce d’identité (recto + verso) obligatoire' });
    }
    if (!photos.photo_signature) {
      return reply.code(400).send({ error: 'Signature (ou empreinte) du nouveau titulaire obligatoire' });
    }
    if (!fields.motif?.trim()) {
      return reply.code(400).send({ error: 'Motif de la réattribution obligatoire' });
    }
    // Reste des champs standards (nom_pere, nom_mere, date_naissance,
    // lieu_naissance, date_expiration...) + champs custom actifs : validation
    // dynamique unique, pilotée par Admin > Champs du dossier (dossier_champs)
    // — même fonction que la première acquisition (public-dossiers.ts).
    // AVANT ce correctif, "nom_pere"/"nom_mere" étaient encore exigés en dur
    // ici, indépendamment de ce que l'admin configure : un champ masqué par
    // l'admin bloquait quand même la réattribution GSM sans que l'agent
    // comprenne pourquoi.
    const normalizedTypePiece = String(fields.type_piece ?? dossier.type_piece ?? '').trim().toUpperCase() || 'AUTRE';
    const isOfficialDocType = OFFICIAL_DOC_TYPES.has(normalizedTypePiece);
    const champsError = await checkChampsObligatoiresDynamique(fields, isOfficialDocType);
    if (champsError) return reply.code(400).send({ error: champsError });

    const normalizedSignatureMode = String(fields.signature_mode ?? '').trim().toLowerCase() === 'empreinte'
      ? 'empreinte'
      : 'dessin';

    // 1) Snapshot de l'ancien titulaire (standards + champs custom actifs)
    //    avant écrasement — c'est notre trace d'audit.
    const champsActifs = await listChampsActifs();
    const ancienSnapshot: Record<string, unknown> = {};
    for (const cle of IDENTITE_STANDARD) ancienSnapshot[cle] = (dossier as unknown as Record<string, unknown>)[cle] ?? null;
    for (const c of champsActifs) {
      if (!c.standard) ancienSnapshot[c.cle] = (dossier as unknown as Record<string, unknown>)[c.cle] ?? null;
    }
    ancienSnapshot.photo_recto = dossier.photo_recto;
    ancienSnapshot.photo_verso = dossier.photo_verso;
    ancienSnapshot.photo_signature = (dossier as unknown as Record<string, unknown>).photo_signature ?? null;
    ancienSnapshot.signature_mode = (dossier as unknown as Record<string, unknown>).signature_mode ?? null;

    // 2) Nouvelle pièce d'identité sur disque
    const date = nowDate();
    const destDir = path.join(UPLOAD_CNI, date);
    await fsp.mkdir(destDir, { recursive: true });
    const stamp = Date.now();
    const photoPaths: Record<string, string> = {};
    for (const label of ['photo_recto', 'photo_verso', 'photo_signature'] as const) {
      if (!photos[label]) continue;
      const ext = photos[label].mime === 'image/png' ? 'png' : photos[label].mime === 'image/webp' ? 'webp' : 'jpg';
      const fname = `${params.id}_reattr${stamp}_${label.replace('photo_', '')}.${ext}`;
      await fsp.writeFile(path.join(destDir, fname), photos[label].buf, { mode: 0o644 });
      photoPaths[label] = `${date}/${fname}`;
    }

    // 3) Champs custom actifs présents dans le formulaire → fusionnés dans
    //    la mise à jour (updateDossier() sait déjà les reconnaître).
    const customUpdates: Record<string, unknown> = {};
    for (const c of champsActifs) {
      if (!c.standard && fields[c.cle] !== undefined) customUpdates[c.cle] = fields[c.cle].trim() || null;
    }

    await db.updateDossier(params.id, {
      nom_titulaire: fields.nom_titulaire.trim(),
      prenom_titulaire: fields.prenom_titulaire.trim(),
      date_naissance: fields.date_naissance?.trim() || null,
      lieu_naissance: fields.lieu_naissance?.trim() || null,
      type_piece: normalizedTypePiece,
      numero_cni: fields.numero_cni?.trim() || null,
      date_expiration: fields.date_expiration?.trim() || null,
      sexe: fields.sexe?.trim() || null,
      nationalite: fields.nationalite?.trim() || null,
      profession: fields.profession?.trim() || null,
      // .trim() || null (et non fields.nom_pere.trim() sans garde) : ces deux
      // champs peuvent désormais être absents si l'admin les a masqués — la
      // validation "obligatoire" ci-dessus est la seule à décider s'ils sont
      // requis, plus jamais un accès direct qui crasherait sur undefined.
      nom_pere: fields.nom_pere?.trim() || null,
      nom_mere: fields.nom_mere?.trim() || null,
      adresse_complete: fields.adresse_complete?.trim() || null,
      autre_numero: fields.autre_numero?.trim() || null,
      photo_recto: photoPaths.photo_recto,
      photo_verso: photoPaths.photo_verso,
      photo_signature: photoPaths.photo_signature ?? null,
      signature_mode: normalizedSignatureMode,
      photo_live: null,
      score_visage: null, visage_match: null, visage_motif: null, visage_verifie_le: null,
      liveness_status: null, liveness_confidence: null, liveness_verifie_le: null,
      raison_rejet: null,
      statut: 'en_attente',
      agent_saisie: null,
      assigne_a: null,
      assigne_le: null,
      acquisition_status: 'submitted',
      flow_step: 4,
      reattribue: 1,
      reattribue_le: db.nowSec(),
      reattribue_par: req.user.matricule,
      nb_reattributions: (dossier.nb_reattributions ?? 0) + 1,
      ...customUpdates,
    });

    await db.insertReattribution({
      dossier_id: params.id,
      ancien_snapshot: ancienSnapshot,
      motif: fields.motif.trim(),
      agent_matricule: req.user.matricule,
    });

    db.audit(req.user.matricule, 'DOSSIER_REATTRIBUE', `id=${params.id} motif=${fields.motif.trim()}`, req.ip);

    // Best-effort : l'agent qui vient de saisir le nouveau titulaire
    // reprend directement le dossier pour enchaîner sur la vérification
    // faciale — s'il est déjà occupé sur un autre dossier, le dossier reste
    // simplement disponible dans la file d'attente normale.
    let repris = false;
    if (req.user.role === 'agent') {
      const res = await prendreDossierSpecifique(req.user.matricule, params.id).catch(() => 'dossier_indisponible' as const);
      repris = res === 'ok';
    }

    const updated = await db.getDossierById(params.id);
    return reply.send({ success: true, repris, dossier: updated ? normalizeDossier(updated) : null });
  });

  // GET /api/dossiers/:id/reattributions — historique des réattributions
  app.get('/api/dossiers/:id/reattributions', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    const { matricule, role } = req.user;
    const dossier = await db.getDossierById(params.id);
    if (!dossier) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (role === 'agent' && dossier.agent_saisie !== matricule && dossier.statut !== 'en_attente') {
      return reply.code(403).send({ error: 'Accès refusé' });
    }
    const rows = await db.getReattributions(params.id);
    return reply.send({
      reattributions: rows.map(r => ({ ...r, ancien_snapshot: JSON.parse(r.ancien_snapshot || '{}') })),
    });
  });

  // POST /api/dossiers/:id/transferer (sup/admin)
  app.post('/api/dossiers/:id/transferer',
    { preHandler: requireRole(['superviseur','admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { id: string };
      const body = req.body as { cible?: string; message?: string }|null;
      if (!body?.cible?.trim()) return reply.code(400).send({ error: 'Agent cible obligatoire' });
      const cible = body.cible.trim().toUpperCase();
      const cibleCompte = await db.getCompteByMatricule(cible);
      if (!cibleCompte || !cibleCompte.actif) return reply.code(400).send({ error: 'Agent cible introuvable ou inactif' });
      const d = await db.getDossierById(params.id);
      if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });

      const res = await transferDossierToAgent(params.id, cible, { message: body.message ?? null, transferePar: req.user.matricule });
      if (res === 'introuvable') return reply.code(404).send({ error: 'Dossier introuvable' });
      if (res === 'cible_occupee') return reply.code(409).send({ error: 'Agent cible occupé' });

      db.audit(req.user.matricule,'DOSSIER_TRANSFERE',`id=${params.id} vers=${cible}`,req.ip);
      return reply.send({ success: true });
    }
  );

  // GET /api/dossiers/numero/:numero/historique — traçabilité complète d'un
  // numéro GSM : tous les dossiers qui l'ont porté + toutes les
  // réattributions de chacun, en ordre chronologique. Réservé sup/admin.
  app.get('/api/dossiers/numero/:numero/historique', {
    preHandler: requireRole(['superviseur', 'admin']),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { numero } = req.params as { numero: string };
    const clean = String(numero || '').replace(/\D/g, '');
    if (!clean) return reply.code(400).send({ error: 'Numéro invalide' });

    const dossiers = await db.getDossiersByNumero(clean);
    if (!dossiers.length) {
      return reply.send({ numero: clean, nb_dossiers: 0, nb_reattributions: 0, historique: [] });
    }

    const dossierIds = dossiers.map(d => d.id);
    const reattributionsRows = await db.getReattributionsForDossiers(dossierIds);
    const byDossier = new Map<string, Array<Record<string, unknown>>>();
    for (const row of reattributionsRows) {
      const dossierId = row.dossier_id;
      const list = byDossier.get(dossierId) ?? [];
      list.push({ ...row, ancien_snapshot: JSON.parse(row.ancien_snapshot || '{}') });
      byDossier.set(dossierId, list);
    }

    const historique = dossiers.slice(0, 50).map(d => ({
      dossier: normalizeDossier(d),
      reattributions: (byDossier.get(d.id) ?? []) as Array<{ id: number; motif: string | null; agent_matricule: string; created_at: number; ancien_snapshot: Record<string, unknown> }>,
    }));

    return reply.send({
      numero: clean,
      nb_dossiers: dossiers.length,
      nb_reattributions: reattributionsRows.length,
      historique,
    });
  });

  // GET /api/dossiers/historique (admin)
  app.get('/api/dossiers/historique',
    { preHandler: requireRole(['superviseur','admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const q = req.query as Record<string,string>;
      const { rows, total } = await db.getDossiers({
        debut: q.debut||null, fin: q.fin||null, statut: q.statut||null,
        agent: q.agent||null, search: q.search||null,
        limit: Math.min(parseInt(q.limit||'500',10),2000),
        offset: parseInt(q.offset||'0',10),
      });
      return reply.send({ success: true, total, count: rows.length, dossiers: rows });
    }
  );
}