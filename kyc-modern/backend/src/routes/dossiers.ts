import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { Dossier } from '../types';
import { appelerProchainDossier, prendreDossierSpecifique, transferDossierToAgent, releaseAgentLock } from '../db/locks';

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(),'uploads','cni');

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
    const d = await db.getDossierById(params.id) as (Dossier & { traitement_demarre_le?: number | null });
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });

    // Marque le DÉBUT RÉEL du traitement par l'agent assigné — la toute
    // première fois que CE dossier précis est effectivement consulté par
    // l'agent qui en est responsable (concrètement : l'arrivée sur l'écran
    // de saisie GSM, voir GsmSaisie dans GsmPages.tsx, qui charge le dossier
    // via cette même route). C'est un signal beaucoup plus précis que la
    // présence générale (heartbeat ping-dispo) pour le filet de sécurité de
    // utils/distribution.ts : un dossier attribué mais jamais ouvert doit
    // repartir en file dès que le délai est dépassé, MÊME si l'agent est
    // par ailleurs en ligne (autre onglet, occupé ailleurs...) — alors qu'un
    // dossier réellement en cours de traitement doit être protégé tant que
    // l'agent reste joignable. Idempotent (WHERE ... IS NULL côté SQL) : ne
    // se déclenche qu'une seule fois par attribution, jamais réécrit ensuite.
    if (req.user.role === 'agent' && d.agent_saisie === req.user.matricule && d.statut === 'en_cours' && !d.traitement_demarre_le) {
      const maintenant = db.nowSec();
      d.traitement_demarre_le = maintenant;
      db.exec(
        `UPDATE dossiers SET traitement_demarre_le=? WHERE id=? AND agent_saisie=? AND statut='en_cours' AND traitement_demarre_le IS NULL`,
        [maintenant, d.id, req.user.matricule]
      ).catch(() => {});
    }

    return reply.send({ success: true, dossier: maskDossier(normalizeDossier(d), req.user.matricule, req.user.role) });
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
             assigne_le=NULL, heure_prise=NULL, traitement_demarre_le=NULL, updated_at=? 
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

    db.audit(req.user.matricule, 'DOSSIER_FACE_VERIFY_REPRISE', `id=${params.id}`, req.ip);
    return reply.send({ success: true, message: 'La vérification faciale peut être relancée.' });
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