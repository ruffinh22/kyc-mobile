// ============================================================================
// Planning Manager - KYC V4 (TypeScript)
// Grille planning shift × jours pour l'équipe managers/TL
// ============================================================================
import { FastifyInstance, FastifyRequest } from 'fastify';
import * as db from '../db';
import { query, exec } from '../db';

// Types
interface PlanningShift {
  vacation: string;
  horaire: string;
  cells: string[];
}

interface PlanningData {
  titre: string;
  shifts: PlanningShift[];
}

interface PlanningRequest {
  semaine: string;
  titre: string;
  shifts: PlanningShift[];
}

export async function planningManagersRoutes(app: any): Promise<void> {
  app.register(async function (fastify) {
    // Middleware d'authentification
    fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
      // @ts-ignore - user set by auth middleware
      if (!request.user) {
        return reply.code(401).send({ error: 'Non authentifié' });
      }
      // @ts-ignore
      const { role } = request.user;
      if (role !== 'superviseur' && role !== 'admin') {
        return reply.code(403).send({ error: 'Accès refusé' });
      }
    });

    // POST /api/planning-managers - Enregistre/écrase la grille d'une semaine
    fastify.post('/api/planning-managers', async (request: FastifyRequest, reply) => {
      // @ts-ignore
      const { matricule } = request.user;
      const ip = request.ip;
      const ua = (request.headers as Record<string, string>)['user-agent'] || '';

      const body = request.body as PlanningRequest;
      const semaine = String(body.semaine || '');

      if (!/^\d{4}-\d{2}-\d{2}$/.test(semaine)) {
        return reply.code(400).send({ error: 'Semaine invalide (format YYYY-MM-DD attendu)' });
      }

      const shifts = Array.isArray(body.shifts) ? body.shifts : [];
      const titre = String(body.titre || '');

      // Normalisation : chaque shift = {vacation, horaire, cells:[7 chaînes]}
      const clean: PlanningShift[] = shifts.map(s => ({
        vacation: String(s.vacation || ''),
        horaire: String(s.horaire || ''),
        cells: Array.isArray(s.cells) ? s.cells.slice(0, 7).map(c => String(c || '')) : ['', '', '', '', '', '', '']
      }));

      while (clean.length === 0) {
        clean.push({ vacation: '', horaire: '', cells: ['', '', '', '', '', '', ''] });
      }

      const dataStr = JSON.stringify({ titre, shifts: clean });

      try {
        await exec(
          `INSERT INTO planning_managers (semaine, titre, data, updated_at) 
           VALUES (?, ?, ?, UNIX_TIMESTAMP()) 
           ON DUPLICATE KEY UPDATE titre=VALUES(titre), data=VALUES(data), updated_at=UNIX_TIMESTAMP()`,
          [semaine, titre, dataStr]
        );

        fastify.log.info(`[PLANNING-MANAGERS] ${matricule} saved planning for ${semaine} (${clean.length} shifts)`);

        return reply.send({ success: true, semaine, shiftsCount: clean.length });
      } catch (err) {
        fastify.log.error('POST planning-managers error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur', details: (err as Error).message });
      }
    });

    // GET /api/planning-managers?semaine=YYYY-MM-DD - Grille d'une semaine
    fastify.get('/api/planning-managers', async (request: FastifyRequest, reply) => {
      const queryParams = request.query as { semaine?: string };
      const { semaine } = queryParams;

      if (!semaine || !/^\d{4}-\d{2}-\d{2}$/.test(semaine)) {
        return reply.code(400).send({ error: 'Paramètre semaine requis (YYYY-MM-DD)' });
      }

      try {
        const rows = await query('SELECT semaine, titre, data, updated_at FROM planning_managers WHERE semaine = ?', [semaine]);
        const row = rows[0] as { semaine: string; titre: string; data: string; updated_at: number } | undefined;

        if (!row) {
          return reply.send({ success: true, semaine, titre: '', shifts: null });
        }

        let parsed: PlanningData = { titre: '', shifts: [] };
        try {
          parsed = JSON.parse(row.data || '{}');
        } catch (e) {
          parsed = { titre: '', shifts: [] };
        }

        return reply.send({
          success: true,
          semaine: row.semaine,
          titre: row.titre || (parsed.titre || ''),
          shifts: Array.isArray(parsed.shifts) ? parsed.shifts : null,
          updated_at: row.updated_at
        });
      } catch (err) {
        fastify.log.error('GET planning-managers error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    });

    // GET /api/planning-managers/semaines - Liste des semaines enregistrées
    fastify.get('/api/planning-managers/semaines', async (request: FastifyRequest, reply) => {
      try {
        const rows = await query('SELECT semaine, titre, updated_at FROM planning_managers ORDER BY semaine DESC LIMIT 200') as { semaine: string; titre: string; updated_at: number }[];

        return reply.send({ success: true, count: rows.length, semaines: rows });
      } catch (err) {
        fastify.log.error('GET planning-managers/semaines error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    });
  });
}
