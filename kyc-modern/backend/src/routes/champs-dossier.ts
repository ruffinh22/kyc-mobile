import { FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth, requireRole } from '../middleware/auth';
import * as champs from '../db/customFields';

export async function champsDossierRoutes(app: any): Promise<void> {
  (app as unknown as { addHook: (name: string, hook: typeof requireAuth) => void }).addHook('preHandler', requireAuth);

  // GET /api/champs-dossier/actifs — utilisé par la page agent terrain
  // (AcquisitionPage) et le formulaire de réattribution : uniquement les
  // champs actifs, quel que soit le rôle.
  app.get('/api/champs-dossier/actifs', async (_req: FastifyRequest, reply: FastifyReply) => {
    const list = await champs.listChampsActifs();
    return reply.send({ champs: list });
  });

  // GET /api/admin/champs-dossier — vue complète (admin/superviseur)
  app.get('/api/admin/champs-dossier', {
    preHandler: requireRole(['admin', 'superviseur']),
  }, async (_req: FastifyRequest, reply: FastifyReply) => {
    const list = await champs.listChamps();
    return reply.send({ champs: list });
  });

  // POST /api/admin/champs-dossier — créer un champ custom (admin uniquement,
  // déclenche un ALTER TABLE réel sur `dossiers`)
  app.post('/api/admin/champs-dossier', {
    preHandler: requireRole(['admin']),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule } = req.user;
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      const champ = await champs.createChampCustom({
        label: String(body.label ?? ''),
        type: String(body.type ?? 'texte') as champs.ChampType,
        options: Array.isArray(body.options) ? (body.options as string[]) : null,
        obligatoire: !!body.obligatoire,
        placeholder: typeof body.placeholder === 'string' ? body.placeholder : null,
        nullable: body.nullable === undefined ? true : !!body.nullable,
        matricule,
      });
      return reply.code(201).send({ champ });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || 'Impossible de créer le champ' });
    }
  });

  // PATCH /api/admin/champs-dossier/:id — renommer / rendre (in)actif ou
  // (non) obligatoire / réordonner. Fonctionne pour les champs standards ET
  // custom (mais ne touche jamais à la colonne SQL sous-jacente).
  app.patch('/api/admin/champs-dossier/:id', {
    preHandler: requireRole(['admin']),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule } = req.user;
    const id = Number((req.params as Record<string, string>).id);
    const body = (req.body || {}) as Record<string, unknown>;
    try {
      const champ = await champs.updateChamp(id, {
        label: typeof body.label === 'string' ? body.label : undefined,
        obligatoire: typeof body.obligatoire === 'boolean' ? body.obligatoire : undefined,
        actif: typeof body.actif === 'boolean' ? body.actif : undefined,
        ordre: typeof body.ordre === 'number' ? body.ordre : undefined,
        options: Array.isArray(body.options) ? (body.options as string[]) : undefined,
        placeholder: typeof body.placeholder === 'string' ? body.placeholder : undefined,
        nullable: typeof body.nullable === 'boolean' ? body.nullable : undefined,
        matricule,
      });
      return reply.send({ champ });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || 'Impossible de modifier le champ' });
    }
  });

  // DELETE /api/admin/champs-dossier/:id — suppression définitive (champ
  // custom uniquement) : ALTER TABLE DROP COLUMN réel. Nécessite confirm=true.
  app.delete('/api/admin/champs-dossier/:id', {
    preHandler: requireRole(['admin']),
  }, async (req: FastifyRequest, reply: FastifyReply) => {
    const { matricule } = req.user;
    const id = Number((req.params as Record<string, string>).id);
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.confirm !== true) {
      return reply.code(400).send({ error: 'Confirmation requise (confirm=true) — cette action supprime aussi les valeurs déjà saisies' });
    }
    try {
      await champs.deleteChampCustom(id, matricule);
      return reply.send({ success: true });
    } catch (err: any) {
      return reply.code(400).send({ error: err?.message || 'Impossible de supprimer le champ' });
    }
  });
}