// ============================================================================
// Recherche et Export de Captures - KYC V4 (TypeScript)
// Recherche de fichiers captures (CNI, GSM, etc.) et export
// ============================================================================
import { FastifyInstance, FastifyRequest } from 'fastify';
import fs from 'fs/promises';
import path from 'path';
import * as db from '../db';
import { query, exec } from '../db';
import { requireAuth, requireRole } from '../middleware/auth';
import { Role } from '../types';

// Configuration
const UPLOAD_BASE = process.env.UPLOAD_BASE || path.join(process.cwd(), 'uploads');

// Helpers
function isBlank(v: string | null | undefined): boolean {
  return !v || v === 'null' || v === 'undefined' || v.trim() === '';
}

// Vérifie que le chemin reste dans le répertoire uploads
function resolveSafePath(relativePath: string): string | null {
  const base = path.resolve(UPLOAD_BASE) + path.sep;
  const full = path.resolve(UPLOAD_BASE, relativePath.trim());
  if (!full.startsWith(base)) return null;
  return full;
}

function sanitizeLimit(limit: number | undefined, fallback = 100, max = 500): number {
  const parsed = Number.isFinite(limit) ? Math.floor(limit) : fallback;
  if (parsed <= 0) return fallback;
  return Math.min(parsed, max);
}

export function buildCaptureSearchQuery(options: {
  type?: string;
  date?: string;
  dossier_id?: string;
  numero?: string;
  limit?: number;
}): { sql: string; params: any[] } {
  const { type, date, dossier_id, numero, limit } = options;
  const safeLimit = sanitizeLimit(limit, 100, 500);
  let baseSql = 'SELECT id, numero_mtn, photo_recto, photo_verso, photo_live, created_at FROM dossiers WHERE 1=1';
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (!isBlank(dossier_id)) {
    whereClauses.push('id = ?');
    params.push(dossier_id!.trim());
  }

  if (!isBlank(numero)) {
    whereClauses.push('numero_mtn LIKE ?');
    params.push(`%${numero!.trim()}%`);
  }

  if (!isBlank(date)) {
    whereClauses.push('date = ?');
    params.push(date!.trim());
  }

  if (!isBlank(type)) {
    if (type === 'cni') {
      whereClauses.push('(photo_recto IS NOT NULL OR photo_verso IS NOT NULL)');
    } else if (type === 'live') {
      whereClauses.push('photo_live IS NOT NULL');
    }
  }

  if (whereClauses.length > 0) {
    baseSql += ' AND ' + whereClauses.join(' AND ');
  }

  baseSql += ` ORDER BY created_at DESC LIMIT ${safeLimit}`;
  return { sql: baseSql, params };
}

export function buildGsmCaptureSearchQuery(options: {
  date?: string;
  agent?: string;
  numero?: string;
  limit?: number;
}): { sql: string; params: any[] } {
  const { date, agent, numero, limit } = options;
  const safeLimit = sanitizeLimit(limit, 100, 500);
  let baseSql = 'SELECT id, numero, date_saisie, agent_ctrl, capture_a, capture_p, capture_aa, dossier_id FROM gsm WHERE 1=1';
  const whereClauses: string[] = [];
  const params: any[] = [];

  if (!isBlank(date)) {
    whereClauses.push('date_saisie = ?');
    params.push(date!.trim());
  }

  if (!isBlank(agent)) {
    whereClauses.push('agent_ctrl = ?');
    params.push(agent!.trim());
  }

  if (!isBlank(numero)) {
    whereClauses.push('numero LIKE ?');
    params.push(`%${numero!.trim()}%`);
  }

  if (whereClauses.length > 0) {
    baseSql += ' AND ' + whereClauses.join(' AND ');
  }

  baseSql += ` ORDER BY date_saisie DESC, created_at DESC LIMIT ${safeLimit}`;
  return { sql: baseSql, params };
}

export async function capturesRoutes(app: any): Promise<void> {
  app.register(async function (fastify) {
    // Middleware d'authentification et autorisation
    fastify.addHook('preHandler', async (request: FastifyRequest, reply) => {
      await requireAuth(request, reply);
      // @ts-ignore - user set by requireAuth
      const { role } = request.user;
      if (role !== 'superviseur' && role !== 'admin') {
        return reply.code(403).send({ error: 'Accès refusé' });
      }
    });

    // GET /api/captures/search - Recherche de captures
    // Query params: type (cni, gsm), date, dossier_id, numero
    fastify.get('/api/captures/search', async (request: FastifyRequest, reply) => {
      const queryParams = request.query as {
        type?: string;
        date?: string;
        dossier_id?: string;
        numero?: string;
        limit?: string;
      };

      const { type, date, dossier_id, numero } = queryParams;
      const limit = parseInt(queryParams.limit || '100', 10);

      try {
        const { sql, params } = buildCaptureSearchQuery({
          type,
          date,
          dossier_id,
          numero,
          limit,
        });

        const rows = await query(sql, params);

        // Construire les URLs complètes pour les captures
        const results = rows.map((row: any) => ({
          ...row,
          recto_url: row.photo_recto ? `/uploads/cni/${row.photo_recto}` : null,
          verso_url: row.photo_verso ? `/uploads/cni/${row.photo_verso}` : null,
          live_url: row.photo_live ? `/uploads/cni/${row.photo_live}` : null,
        }));

        return reply.send({ success: true, count: results.length, captures: results });
      } catch (err) {
        fastify.log.error('GET captures/search error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    });

    // GET /api/captures/gsm - Recherche de captures GSM
    // Query params: date, agent, numero
    fastify.get('/api/captures/gsm', async (request: FastifyRequest, reply) => {
      const queryParams = request.query as {
        date?: string;
        agent?: string;
        numero?: string;
        limit?: string;
      };

      const { date, agent, numero } = queryParams;
      const limit = parseInt(queryParams.limit || '100', 10);

      try {
        const { sql, params } = buildGsmCaptureSearchQuery({
          date,
          agent,
          numero,
          limit,
        });

        const rows = await query(sql, params);

        // Construire les URLs pour les captures GSM
        const results = rows.map((row: any) => ({
          ...row,
          capture_a_url: row.capture_a ? `/uploads/gsm/${row.capture_a}` : null,
          capture_p_url: row.capture_p ? `/uploads/gsm/${row.capture_p}` : null,
          capture_aa_url: row.capture_aa ? `/uploads/gsm/${row.capture_aa}` : null,
        }));

        return reply.send({ success: true, count: results.length, captures: results });
      } catch (err) {
        fastify.log.error('GET captures/gsm error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    });

    // GET /api/captures/export - Export des captures en CSV
    // Query params: type (cni, gsm), date_from, date_to
    fastify.get('/api/captures/export', async (request: FastifyRequest, reply) => {
      const queryParams = request.query as {
        type?: string;
        date_from?: string;
        date_to?: string;
      };

      const { type, date_from, date_to } = queryParams;

      try {
        let baseSql: string;
        let params: any[] = [];
        let filename = 'captures_export.csv';
        let headers: string[] = [];
        let whereClauses: string[] = [];

        if (type === 'gsm') {
          baseSql = 'SELECT id, numero, date_saisie, agent_ctrl, capture_a, capture_p, capture_aa, dossier_id FROM gsm WHERE 1=1';
          headers = ['ID', 'Numéro', 'Date', 'Agent', 'Capture A', 'Capture P', 'Capture AA', 'Dossier ID'];
          filename = 'gsm_captures_export.csv';
        } else {
          // Default: CNI captures
          baseSql = 'SELECT id, dossier_id, numero_mtn, photo_recto, photo_verso, photo_live, created_at FROM dossiers WHERE 1=1';
          headers = ['ID', 'Dossier ID', 'Numéro MTN', 'Photo Recto', 'Photo Verso', 'Photo Live', 'Created At'];
          filename = 'cni_captures_export.csv';
        }

        if (!isBlank(date_from)) {
          if (type === 'gsm') {
            whereClauses.push('date_saisie >= ?');
          } else {
            whereClauses.push('date >= ?');
          }
          params.push(date_from!.trim());
        }

        if (!isBlank(date_to)) {
          if (type === 'gsm') {
            whereClauses.push('date_saisie <= ?');
          } else {
            whereClauses.push('date <= ?');
          }
          params.push(date_to!.trim());
        }

        if (whereClauses.length > 0) {
          baseSql += ' AND ' + whereClauses.join(' AND ');
        }

        baseSql += ' ORDER BY created_at DESC LIMIT 5000';

        const rows = await query(baseSql, params);

        // Génération CSV
        const csvLines = [headers.join(',')];
        rows.forEach((row: any) => {
          const values = headers.map((h, i) => {
            const key = h.toLowerCase().replace(/ /g, '_').replace('/', '_');
            const val = row[Object.keys(row)[i]] || '';
            return `"${String(val).replace(/"/g, '""')}"`;
          });
          csvLines.push(values.join(','));
        });

        const csvContent = csvLines.join('\n');

        reply.header('Content-Type', 'text/csv');
        reply.header('Content-Disposition', `attachment; filename="${filename}"`);
        return reply.send(csvContent);
      } catch (err) {
        fastify.log.error('GET captures/export error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    });

    // DELETE /api/captures/:id - Suppression d'une capture (admin only)
    fastify.delete('/api/captures/:id', async (request: FastifyRequest, reply) => {
      // @ts-ignore
      const { role } = request.user;
      if (role !== 'admin') {
        return reply.code(403).send({ error: 'Accès refusé - Admin uniquement' });
      }

      const params = request.params as { id: string };
      const { id } = params;

      try {
        const rows = await db.query('SELECT photo_recto, photo_verso, photo_live FROM dossiers WHERE id = ?', [id]);
        const row = rows[0] as { photo_recto: string | null; photo_verso: string | null; photo_live: string | null } | undefined;

        if (!row) {
          return reply.code(404).send({ error: 'Capture non trouvée' });
        }

        // Suppression des fichiers physiques
        const filesToDelete: string[] = [];
        if (row.photo_recto) filesToDelete.push(row.photo_recto);
        if (row.photo_verso) filesToDelete.push(row.photo_verso);
        if (row.photo_live) filesToDelete.push(row.photo_live);

        for (const file of filesToDelete) {
          const fullPath = resolveSafePath(file);
          if (fullPath) {
            try {
              await fs.unlink(fullPath);
              fastify.log.info(`[CAPTURES] Deleted file: ${file}`);
            } catch (e) {
              fastify.log.warn(`[CAPTURES] Failed to delete ${file}: ${(e as Error).message}`);
            }
          }
        }

        // Suppression de l'enregistrement en base
        await exec('DELETE FROM dossiers WHERE id = ?', [id]);

        return reply.send({ success: true, message: 'Capture supprimée' });
      } catch (err) {
        fastify.log.error('DELETE captures/:id error: ' + (err as Error).message);
        return reply.code(500).send({ error: 'Erreur serveur' });
      }
    });
  });
}
