import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import crypto from 'crypto';
import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';

const UPLOAD_GSM  = process.env.UPLOAD_GSM  || path.join(process.cwd(),'uploads','gsm');
const UPLOAD_CNI  = process.env.UPLOAD_CNI  || path.join(process.cwd(),'uploads','cni');
const MAX_FILE    = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg','image/png','image/webp']);

export async function gsmRoutes(app: any): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /api/gsm/referentiels
  app.get('/api/gsm/referentiels', async (_req, reply) => {
    const refs = await db.getReferentiels();
    return reply.send({ success: true, referentiels: refs });
  });

  // GET /api/gsm/mon-tableau
  app.get('/api/gsm/mon-tableau', async (req, reply) => {
    const stats = await db.getGsmStats(req.user.matricule);
    return reply.send({ success: true, ...stats });
  });

  // GET /api/gsm/mes-saisies?date=
  app.get('/api/gsm/mes-saisies', async (req, reply) => {
    const q = req.query as Record<string,string>;
    const date = q.date || new Date().toISOString().slice(0,10);
    const saisies = await db.getGsmSaisies({ agent: req.user.matricule, date });
    return reply.send({ success: true, count: saisies.length, saisies });
  });

  // GET /api/gsm/mes-historique?debut=&fin=
  app.get('/api/gsm/mes-historique', async (req, reply) => {
    const q = req.query as Record<string,string>;
    const saisies = await db.getGsmSaisies({ agent: req.user.matricule, debut: q.debut||undefined, fin: q.fin||undefined, limit: 500 });
    return reply.send({ success: true, count: saisies.length, saisies });
  });

  // GET /api/gsm/mes-perfs?debut=&fin=
  app.get('/api/gsm/mes-perfs', async (req, reply) => {
    const q = req.query as Record<string,string>;
    if (!q.debut || !q.fin) return reply.code(400).send({ error: 'debut et fin requis (YYYY-MM-DD)' });
    const result = await db.getGsmPerfs(req.user.matricule, q.debut, q.fin);
    return reply.send({ success: true, ...result });
  });

  // GET /api/gsm/compilation (sup/admin)
  app.get('/api/gsm/compilation',
    { preHandler: requireRole(['superviseur','admin']) },
    async (req, reply) => {
      const q = req.query as Record<string,string>;
      const saisies = await db.getGsmCompilation(q.debut||null, q.fin||null);
      return reply.send({ success: true, count: saisies.length, saisies });
    }
  );

  // POST /api/gsm/libre – saisie sans dossier
  app.post('/api/gsm/libre', async (req, reply) => {
    const body = req.body as Record<string,string>|null;
    if (!body?.numero || !body.type_id || !body.constat || !body.piece || !body.verbatim || !body.action) {
      return reply.code(400).send({ error: 'Champs obligatoires: numero, type_id, constat, piece, verbatim, action' });
    }
    const now = new Date();
    const id = await db.createGsm({
      numero: body.numero, agent_ctrl: req.user.matricule,
      date_saisie: body.date || now.toISOString().slice(0,10),
      heure_saisie: now.toTimeString().slice(0,5),
      coach: body.coach||null, type_id: body.type_id||null,
      constat: body.constat||null, piece: body.piece||null,
      verbatim: body.verbatim||null, action: body.action||null,
      statut_final: body.statut_final||null, traitement: body.traitement||null,
      raison: body.raison||null, nom_client: body.nom_client||null,
      observations: body.observations||null, dossier_id: null,
      capture_a: null, capture_p: null, capture_aa: null,
    });
    db.audit(req.user.matricule,'GSM_CREE',`id=${id}`,req.ip);
    return reply.code(201).send({ success: true, id });
  });

  // PUT /api/gsm/:id – modifier saisie
  app.put('/api/gsm/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const gsm = await db.getGsmById(id);
    if (!gsm) return reply.code(404).send({ error: 'Saisie introuvable' });
    if (gsm.agent_ctrl !== req.user.matricule && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'Pas votre saisie' });
    const body = req.body as Record<string,unknown>|null;
    await db.updateGsm(id, body as never);
    db.audit(req.user.matricule,'GSM_MODIFIE',`id=${id}`,req.ip);
    return reply.send({ success: true });
  });

  // DELETE /api/gsm/:id
  app.delete('/api/gsm/:id', async (req, reply) => {
    const id = parseInt(req.params.id, 10);
    const gsm = await db.getGsmById(id);
    if (!gsm) return reply.code(404).send({ error: 'Saisie introuvable' });
    if (gsm.agent_ctrl !== req.user.matricule && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'Pas votre saisie' });
    await db.deleteGsm(id);
    db.audit(req.user.matricule,'GSM_SUPPRIME',`id=${id}`,req.ip);
    return reply.send({ success: true });
  });

  // POST /api/gsm/:id/captures
  app.post('/api/gsm/:id/captures', async (req, reply) => {
    if (!req.isMultipart()) return reply.code(400).send({ error: 'Multipart attendu' });
    const id = parseInt(req.params.id, 10);
    const gsm = await db.getGsmById(id);
    if (!gsm) return reply.code(404).send({ error: 'Saisie introuvable' });
    if (gsm.agent_ctrl !== req.user.matricule && req.user.role !== 'admin')
      return reply.code(403).send({ error: 'Accès refusé' });

    const uploads: Record<string, string> = {};
    await fsp.mkdir(UPLOAD_GSM, { recursive: true });

    const parts = req.parts();
    for await (const part of parts) {
      if (part.type !== 'file') continue;
      if (!['capture_a','capture_p','capture_aa'].includes(part.fieldname)) { part.file.resume(); continue; }
      if (!ALLOWED_MIME.has(part.mimetype)) { part.file.resume(); continue; }
      const ext = part.mimetype === 'image/png' ? 'png' : part.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const fname = `gsm_${id}_${part.fieldname}_${crypto.randomBytes(6).toString('hex')}.${ext}`;
      const fpath = path.join(UPLOAD_GSM, fname);
      const chunks: Buffer[] = []; let size = 0;
      for await (const chunk of part.file) {
        size += chunk.length;
        if (size > MAX_FILE) { return reply.code(413).send({ error: 'Fichier trop volumineux (max 5 Mo)' }); }
        chunks.push(chunk);
      }
      await fsp.writeFile(fpath, Buffer.concat(chunks));
      uploads[part.fieldname] = fname;
    }

    if (Object.keys(uploads).length > 0) {
      await db.updateGsm(id, uploads as never);
    }
    return reply.send({ success: true, uploads });
  });

  // GET /api/gsm/captures/:fname – servir image GSM sécurisée
  app.get('/api/gsm/captures/:fname', async (req, reply) => {
    const fname = path.basename(req.params.fname);
    const fpath = path.join(UPLOAD_GSM, fname);
    if (!fs.existsSync(fpath)) return reply.code(404).send({ error: 'Fichier introuvable' });
    const ext = path.extname(fname).toLowerCase();
    const mimes: Record<string,string> = { '.jpg':'image/jpeg', '.jpeg':'image/jpeg', '.png':'image/png', '.webp':'image/webp' };
    reply.header('Content-Type', mimes[ext]||'application/octet-stream');
    reply.header('Cache-Control','private,max-age=3600');
    return reply.send(fs.createReadStream(fpath));
  });

  // GET /api/gsm – liste filtrée (sup/admin ou agent sur ses propres saisies)
  app.get('/api/gsm', async (req, reply) => {
    const q = req.query as Record<string,string>;
    const agentFilter = req.user.role === 'agent' ? req.user.matricule : (q.agent||undefined);
    const saisies = await db.getGsmSaisies({
      agent: agentFilter, dossier_id: q.dossier_id||undefined,
      date: q.date||undefined, debut: q.debut||undefined, fin: q.fin||undefined,
      limit: parseInt(q.limit||'500',10),
    });
    return reply.send({ success: true, count: saisies.length, saisies });
  });
}
