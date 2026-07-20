import fs from 'fs';
import path from 'path';
import { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { Dossier } from '../types';

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
    const { rows, total } = await db.getDossiers({
      date: q.date||null, debut: q.debut||null, fin: q.fin||null,
      statut: q.statut||null, agent: agentFilter, search: q.search||null,
      limit: Math.min(parseInt(q.limit||'100',10),500),
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
    if (!['recto','verso','live'].includes(params.type)) return reply.code(400).send({ error: 'Type invalide' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    log.info({ event: 'photo-access', dossierId: params.id, type: params.type, user: req.user, agent_saisie: d.agent_saisie, statut: d.statut }, 'photo access check');
    if (role === 'agent' && d.statut !== 'en_attente' && d.agent_saisie !== matricule) {
      log.info({ reason: 'access_rejected', expectedMatricule: matricule, actualAgentSaisie: d.agent_saisie, statut: d.statut }, 'photo access denied');
      return reply.code(403).send({ error: 'Accès refusé' });
    }
    const field = `photo_${params.type}` as 'photo_recto'|'photo_verso'|'photo_live';
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

  // POST /api/dossiers/:id/prendre
  app.post('/api/dossiers/:id/prendre', async (req: FastifyRequest, reply: FastifyReply) => {
    const params = req.params as { id: string };
    if (req.user.role !== 'agent') return reply.code(403).send({ error: 'Réservé aux agents' });
    const d = await db.getDossierById(params.id);
    if (!d) return reply.code(404).send({ error: 'Dossier introuvable' });
    if (d.statut !== 'en_attente') return reply.code(409).send({ error: `Statut: ${d.statut}` });
    await db.updateDossier(params.id, { statut: 'en_cours', agent_saisie: req.user.matricule, assigne_a: req.user.matricule, assigne_le: nowSec(), heure_prise: nowTime() });
    await db.upsertPresence(req.user.matricule, 'online');
    db.audit(req.user.matricule,'DOSSIER_PRIS',`id=${params.id}`,req.ip);
    return reply.send({ success: true });
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
    db.audit(req.user.matricule,'DOSSIER_REJETE',`id=${params.id} raison=${body.raison}`,req.ip);
    return reply.send({ success: true });
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
      await db.updateDossier(params.id, { statut: 'en_cours', agent_saisie: cible, assigne_a: cible, assigne_le: nowSec(), heure_prise: nowTime(), transfert_message: body.message??null, transfert_par: req.user.matricule });
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