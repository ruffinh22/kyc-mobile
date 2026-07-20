import { FastifyInstance } from 'fastify';
import * as db from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { NoteQualite } from '../types';

export async function notesQualiteRoutes(app: any): Promise<void> {
  app.addHook('preHandler', requireAuth);

  // GET /api/notes-qualite/mes
  app.get('/api/notes-qualite/mes', async (req, reply) => {
    const notes = await db.getNotesQualite({ matricule: req.user.matricule });
    return reply.send({ success: true, count: notes.length, notes });
  });

  // GET /api/notes-qualite (sup/admin)
  app.get('/api/notes-qualite',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req, reply) => {
      const q = req.query as Record<string, string>;
      const notes = await db.getNotesQualite({
        mois: q.mois ? parseInt(q.mois, 10) : undefined,
        annee: q.annee ? parseInt(q.annee, 10) : undefined,
        campagne: q.campagne || undefined,
      });
      return reply.send({ success: true, count: notes.length, notes });
    }
  );

  // POST /api/notes-qualite/import (sup/admin)
  app.post('/api/notes-qualite/import',
    { preHandler: requireRole(['superviseur', 'admin']) },
    async (req, reply) => {
      const body = req.body as { notes?: NoteQualite[] } | null;
      const notes = body?.notes;
      if (!Array.isArray(notes) || notes.length === 0)
        return reply.code(400).send({ error: 'notes[] requis' });
      const count = await db.upsertNotesQualite(notes);
      db.audit(req.user.matricule, 'IMPORT_NOTES_QUALITE', `${count} notes`, req.ip);
      return reply.send({ success: true, count });
    }
  );
}
