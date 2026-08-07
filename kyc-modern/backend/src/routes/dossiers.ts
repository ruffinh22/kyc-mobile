import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { Dossier } from '../types';
import {
  appelerProchainDossier,
  prendreDossierSpecifique,
  releaseAgentLock,
  transferDossierToAgent,
} from '../db/locks';

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(),'uploads','cni');

function nowSec()  { return Math.floor(Date.now()/1000); }
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
    photo_recto: null, photo_verso: null, photo_live: null, photo_signature: null,
    // Infos titulaire/SIM — mêmes règles de confidentialité que numero_mtn/photos
    nom_titulaire: '***', prenom_titulaire: '***',
    date_naissance: '***', lieu_naissance: '***',
    autre_numero: '***', nom_pere: '***', nom_mere: '***',
    masque: true,
  };
}

// ── Redistribution automatique des dossiers non traités ───────────────────────
// Si un dossier reste "en_cours" plus longtemps que le délai d'abandon configuré
// (config 'distribution_abandon_sec' — réglable via /api/config/distribution-timing,
// 120s/2min par défaut, cf. config.ts) sans être traité (accepté, rejeté,
// transféré...), il est remis dans la file globale ('en_attente') pour être
// redistribué à un autre agent disponible.
const DOSSIER_TIMEOUT_SEC_DEFAULT = 120;
let timeoutIntervalStarted = false;

async function getAbandonSeconds(): Promise<number> {
  try {
    const v = await db.getConfig('distribution_abandon_sec');
    const n = parseInt(v ?? '', 10);
    if (!Number.isNaN(n) && n > 0) return n;
  } catch (e) {}
  return DOSSIER_TIMEOUT_SEC_DEFAULT;
}

async function requeueDossiersExpires(): Promise<void> {
  const maintenant = nowSec();
  const abandonSec = await getAbandonSeconds();
  const seuil = maintenant - abandonSec;
  try {
    const expires = await db.query<{ id: string; agent_saisie: string | null }>(
      "SELECT id, agent_saisie FROM dossiers WHERE statut = 'en_cours' AND assigne_le IS NOT NULL AND assigne_le < ?",
      [seuil]
    );
    if (!expires.length) return;

    await db.exec(
      `UPDATE dossiers
       SET statut = 'en_attente', agent_saisie = NULL, assigne_a = NULL,
           assigne_le = NULL, heure_prise = NULL, updated_at = ?
       WHERE statut = 'en_cours' AND assigne_le IS NOT NULL AND assigne_le < ?`,
      [maintenant, seuil]
    );

    for (const d of expires) {
      // Le dossier n'est plus en_cours pour cet agent : on libère son
      // verrou (agent_dossier_lock) pour qu'il soit immédiatement
      // ré-éligible à une nouvelle attribution, sans attendre le prochain
      // cycle de réconciliation.
      if (d.agent_saisie) {
        try { await releaseAgentLock(d.agent_saisie); } catch (e) {}
      }
      db.audit(d.agent_saisie || 'SYSTEM', 'DOSSIER_TIMEOUT_REQUEUE', `id=${d.id} (>${abandonSec}s sans action, remis en file)`, 'system');
      try {
        const sse = await import('../utils/sse.js');
        if (d.agent_saisie) sse.notifier(d.agent_saisie, 'dossier-expire', { id: d.id });
      } catch (e) {}
    }

    // Redistribuer immédiatement aux agents disponibles (mode auto)
    try {
      const { distribuerMaintenant } = await import('../utils/distribution.js');
      await distribuerMaintenant();
    } catch (e) {}
  } catch (e) {
    // Ne jamais interrompre le serveur pour une erreur de nettoyage périodique
  }
}

export async function dossiersRoutes(app: any): Promise<void> {
  (app as unknown as { addHook: (name: string, hook: typeof requireAuth) => void }).addHook('preHandler', requireAuth);

  if (!timeoutIntervalStarted) {
    timeoutIntervalStarted = true;
    setInterval(() => { requeueDossiersExpires(); }, 30_000);
  }

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
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
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
  // PATCH : passe par prendreDossierSpecifique() (verrou agent_dossier_lock),
  // qui garantit que l'agent ne détient déjà aucun autre dossier en_cours —
  // l'ancienne version ne faisait AUCUNE vérification de ce type.
  app.post('/api/dossiers/:id/prendre', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (d.statut !== 'en_attente') return reply.code(409).send({ error: `Statut: ${d.statut}` });

    const outcome = await prendreDossierSpecifique(req.user.matricule, params.id);
    if (outcome === 'agent_occupe') {
      return reply.code(409).send({ error: 'Vous avez déjà un dossier en cours' });
    }
    if (outcome === 'dossier_indisponible') {
      return reply.code(409).send({ error: 'Dossier déjà pris par un autre agent' });
    }

    await db.upsertPresence(req.user.matricule, 'online');
    db.audit(req.user.matricule,'DOSSIER_PRIS',`id=${params.id}`,req.ip);
    return reply.send({ success: true });
  });

  // POST /api/dossiers/:id/prendre-en-charge
  // Confirmation explicite, côté agent, de la prise en charge d'un dossier déjà
  // en_cours (attribué via distribution automatique / POST /api/dossiers/appeler).
  // L'agent doit consulter le détail complet du dossier avant d'accepter/rejeter ;
  // ce clic relève le chrono d'abandon (assigne_le) pour que le dossier ne soit
  // pas repris par le système pendant que l'agent est en train de le traiter.
  app.post('/api/dossiers/:id/prendre-en-charge', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (d.statut !== 'en_cours') return reply.code(409).send({ error: `Statut: ${d.statut}` });
    if (d.agent_saisie !== req.user.matricule) return reply.code(403).send({ error: 'Pas votre dossier' });
    const nouvelleAssignation = nowSec();
    await db.updateDossier(params.id, { assigne_le: nouvelleAssignation });
    db.audit(req.user.matricule, 'DOSSIER_PRISE_EN_CHARGE_CONFIRMEE', `id=${params.id}`, req.ip);
    return reply.send({ success: true, assigne_le: nouvelleAssignation });
  });

  // POST /api/dossiers/appeler - Mode AUTO: appeler le prochain dossier
  // PATCH : toute la logique de contrôle "1 dossier max par agent" + boucle
  // anti-collision est désormais dans appelerProchainDossier() (db/locks.ts),
  // qui pose le verrou et attribue le dossier dans UNE transaction. C'est la
  // même fonction que celle utilisée par le worker de distribution
  // automatique (utils/distribution.ts) — les deux chemins ne peuvent donc
  // plus jamais attribuer 2 dossiers au même agent, même en cas d'appel
  // concurrent des deux à la fois.
  app.post('/api/dossiers/appeler', async (req: FastifyRequest, reply: FastifyReply) => {
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const { matricule } = req.user;

    const res = await appelerProchainDossier(matricule);

    if (res.result === 'agent_occupe') {
      return reply.code(409).send({ error: 'Maximum de 1 dossier en cours atteint' });
    }
    if (res.result === 'aucun_dossier') {
      return reply.send({ success: true, aucun: true, message: 'Aucun dossier en attente' });
    }

    // 3) L'agent devient occupé: on efface dispo_depuis
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
    const maintenant = nowSec();
    
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
    const maintenant = nowSec();

    if (action === 'pause') {
      // Renvoyer ses dossiers en cours dans la file
      const remis = await db.exec(
        `UPDATE dossiers 
         SET statut='en_attente', agent_saisie=NULL, assigne_a=NULL, 
             assigne_le=NULL, heure_prise=NULL, updated_at=? 
         WHERE agent_saisie=? AND statut='en_cours'`,
        [maintenant, matricule]
      );

      // Le(s) dossier(s) de cet agent ne sont plus en_cours : on libère son
      // verrou pour qu'il soit immédiatement ré-éligible à la reprise.
      try { await releaseAgentLock(matricule); } catch (e) {}

      // Passer en pause
      await db.exec(
        `INSERT INTO presence (matricule, statut, ts, pause_debut, dispo_depuis, updated_at) 
         VALUES (?, 'pause', ?, ?, NULL, ?) 
         ON DUPLICATE KEY UPDATE 
         statut='pause', ts=VALUES(ts), pause_debut=VALUES(pause_debut), 
         dispo_depuis=NULL, updated_at=VALUES(updated_at)`,
        [matricule, maintenant, maintenant, maintenant]
      );

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
    await db.updateDossier(params.id, { statut: 'accepte', heure_cloture: nowTime(), closed_at: nowSec(), resultat_crm: body?.resultat_crm??null });
    // Le dossier quitte en_cours : on libère le verrou pour rendre l'agent
    // immédiatement éligible à une nouvelle attribution.
    try { await releaseAgentLock(req.user.matricule); } catch (e) {}
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
    await db.updateDossier(params.id, { statut: 'rejete', heure_cloture: nowTime(), closed_at: nowSec(), raison_rejet: body.raison.trim() });
    try { await releaseAgentLock(req.user.matricule); } catch (e) {}
    db.audit(req.user.matricule,'DOSSIER_REJETE',`id=${params.id} raison=${body.raison}`,req.ip);
    return reply.send({ success: true });
  });

  // POST /api/dossiers/:id/reprendre-face-verify
  // NOTE : cette route remet un dossier en en_cours pour le même agent sans
  // repasser par le verrou (le dossier lui appartient déjà, d.agent_saisie
  // === matricule est vérifié). Si le dossier n'était PAS déjà en_cours au
  // moment de l'appel (ex: reprise après un rejet), l'agent pourrait ne plus
  // détenir de verrou, ou pire, en détenir un pour un AUTRE dossier entre
  // temps. Distinct du bug initial — à valider avec le métier si ce flux est
  // censé être possible en dehors d'un dossier déjà en_cours ; je n'ai pas
  // introduit de contrôle ici pour ne pas changer un comportement produit
  // sans confirmation.
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
  // PATCH : passe par transferDossierToAgent() (db/locks.ts), qui refuse le
  // transfert si l'agent cible a déjà un dossier en_cours (au lieu de créer
  // silencieusement une seconde attribution pour lui).
  app.post('/api/dossiers/:id/transferer',
    { preHandler: requireRole(['superviseur','admin']) },
    async (req: FastifyRequest, reply: FastifyReply) => {
      const params = req.params as { id: string };
      const body = req.body as { cible?: string; message?: string }|null;
      if (!body?.cible?.trim()) return reply.code(400).send({ error: 'Agent cible obligatoire' });
      const cible = body.cible.trim().toUpperCase();
      const cibleCompte = await db.getCompteByMatricule(cible);
      if (!cibleCompte || !cibleCompte.actif) return reply.code(400).send({ error: 'Agent cible introuvable ou inactif' });

      const outcome = await transferDossierToAgent(params.id, cible, {
        message: body.message ?? null,
        transferePar: req.user.matricule,
      });
      if (outcome === 'introuvable') return reply.code(404).send({ error: 'Dossier introuvable' });
      if (outcome === 'cible_occupee') return reply.code(409).send({ error: 'Agent cible déjà occupé par un autre dossier' });

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