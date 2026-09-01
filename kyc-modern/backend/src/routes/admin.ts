import { FastifyInstance } from 'fastify';
import { z } from 'zod';
import * as db from '../db';
import fs from 'fs';
import path from 'path';
import { validateFieldInput, computeChecksum, backupTable, columnTypeSql, logChange, listFields, getField, applyDropColumn } from '../db/dynamicFields';
import { autoCreateMigration, runMigrations, rollbackMigration } from '../db/migrations';
import * as authUtil from '../utils/auth';
import { requireAuth, requireRole } from '../middleware/auth';
import { Role } from '../types';

const CreateCompteSchema = z.object({
  matricule: z.string().min(2).max(30),
  nom: z.string().min(1),
  prenom: z.string().default(''),
  role: z.enum(['agent', 'superviseur', 'admin']),
  password: z.string().min(6).optional(),
});

const UpdateCompteSchema = z.object({
  nom: z.string().min(1).optional(),
  prenom: z.string().optional(),
  role: z.enum(['agent', 'superviseur', 'admin']).optional(),
  actif: z.boolean().optional(),
  must_change_password: z.boolean().optional(),
  phone_number: z.string().min(6).max(20).optional(),
});

export async function adminRoutes(app: any): Promise<void> {
  app.addHook('preHandler', requireAuth);
  app.addHook('preHandler', requireRole(['admin']));

  // ── Comptes ──────────────────────────────────────────────────────────────

  app.get('/api/admin/comptes', async (_req, reply) => {
    const comptes = await db.getAllComptes();
    return reply.send({
      success: true, count: comptes.length,
      comptes: comptes.map(c => ({
        matricule: c.matricule, nom: c.nom, prenom: c.prenom,
        role: c.role, actif: !!c.actif, must_change_password: !!c.must_change_password,
        phone_number: c.phone_number ?? null,
        phone_verified: !!c.phone_verified_at,
        failed_login_count: c.failed_login_count,
        locked_until: c.locked_until,
        last_login_at: c.last_login_at,
        created_at: c.created_at,
      })),
    });
  });

  app.post('/api/admin/comptes', async (req, reply) => {
    const p = CreateCompteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Données invalides', details: p.error.issues.map(i => i.message) });
    const { matricule, nom, prenom, role, password } = p.data;
    const existing = await db.getCompteByMatricule(matricule.toUpperCase());
    if (existing) return reply.code(409).send({ error: 'Matricule déjà existant' });
    const plain = password || `KYC${matricule.toUpperCase()}#Init`;
    const hash  = await authUtil.hashPassword(plain);
    const id    = await db.createCompte({ matricule: matricule.toUpperCase(), nom, prenom, role: role as Role, password_hash: hash });
    db.audit(req.user.matricule, 'COMPTE_CREE', `id=${id} matricule=${matricule}`, req.ip);
    return reply.code(201).send({ success: true, id, matricule: matricule.toUpperCase(), password_initial: password ? undefined : plain });
  });

  app.put('/api/admin/comptes/:matricule', async (req, reply) => {
    const p = UpdateCompteSchema.safeParse(req.body);
    if (!p.success) return reply.code(400).send({ error: 'Données invalides' });
    const target = req.params.matricule.toUpperCase();
    if (!await db.getCompteByMatricule(target)) return reply.code(404).send({ error: 'Compte introuvable' });
    await db.updateCompte(target, {
      nom: p.data.nom, prenom: p.data.prenom,
      role: p.data.role as Role | undefined,
      actif: p.data.actif !== undefined ? (p.data.actif ? 1 : 0) : undefined,
      must_change_password: p.data.must_change_password !== undefined ? (p.data.must_change_password ? 1 : 0) : undefined,
      phone_number: p.data.phone_number,
    });
    db.audit(req.user.matricule, 'COMPTE_MODIFIE', `matricule=${target}`, req.ip);
    return reply.send({ success: true });
  });

  app.post('/api/admin/comptes/:matricule/reset-password', async (req, reply) => {
    const target = req.params.matricule.toUpperCase();
    if (!await db.getCompteByMatricule(target)) return reply.code(404).send({ error: 'Compte introuvable' });
    const body  = req.body as { new_password?: string } | null;
    const plain = body?.new_password || `KYC${target}#Reset`;
    const str   = authUtil.validatePassword(plain);
    if (!str.valid) return reply.code(400).send({ error: 'Mot de passe faible', details: str.errors });
    await db.updatePasswordHash(target, await authUtil.hashPassword(plain));
    await db.revokeAllSessions(target);
    db.audit(req.user.matricule, 'PASSWORD_RESET', `matricule=${target}`, req.ip);
    return reply.send({ success: true, password_initial: body?.new_password ? undefined : plain });
  });

  // ── Sessions ──────────────────────────────────────────────────────────────

  app.get('/api/admin/sessions', async (_req, reply) => {
    const sessions = await db.getAllActiveSessions();
    return reply.send({ success: true, count: sessions.length, sessions });
  });

  app.post('/api/admin/sessions/:jti/revoquer', async (req, reply) => {
    await db.revokeSession(req.params.jti);
    db.audit(req.user.matricule, 'SESSION_REVOQUEE', `jti=${req.params.jti}`, req.ip);
    return reply.send({ success: true });
  });

  // ── Audit ─────────────────────────────────────────────────────────────────

  app.get('/api/admin/audit', async (req, reply) => {
    const q = req.query as Record<string, string>;
    const { rows, total } = await db.getAuditLogs({
      matricule: q.matricule || undefined,
      action: q.action || undefined,
      debut: q.debut ? Math.floor(new Date(q.debut).getTime() / 1000) : undefined,
      fin: q.fin ? Math.floor(new Date(q.fin + 'T23:59:59').getTime() / 1000) : undefined,
      limit: Math.min(parseInt(q.limit || '200', 10), 1000),
      offset: parseInt(q.offset || '0', 10),
    });
    return reply.send({ success: true, total, count: rows.length, logs: rows });
  });

  // ── Reporting admin ─────────────────────────────────────────────────────

  app.get('/api/admin/reporting', async (req, reply) => {
    const q = req.query as Record<string, string | undefined>;
    const params = {
      debut: q.debut || undefined,
      fin: q.fin || undefined,
      statut: q.statut || undefined,
      agent: q.agent || undefined,
      search: q.search || undefined,
      limit: 5000,
      offset: 0,
    };

    const { rows, total } = await db.getDossiers(params);

    const stats = rows.reduce((acc, dossier) => {
      const status = dossier.statut || 'inconnu';
      if (status in acc) acc[status as keyof typeof acc] += 1;
      return acc;
    }, { en_attente: 0, en_cours: 0, accepte: 0, rejete: 0, total: 0 } as Record<string, number>);

    stats.total = rows.length;

    const byAgent = Object.entries(
      rows.reduce<Record<string, { total: number; accepte: number; rejete: number; en_cours: number }>>((acc, dossier) => {
        const key = (dossier.agent_saisie || dossier.username_agent || 'inconnu').trim() || 'inconnu';
        if (!acc[key]) {
          acc[key] = { total: 0, accepte: 0, rejete: 0, en_cours: 0 };
        }
        acc[key].total += 1;
        if (dossier.statut === 'accepte') acc[key].accepte += 1;
        if (dossier.statut === 'rejete') acc[key].rejete += 1;
        if (dossier.statut === 'en_cours') acc[key].en_cours += 1;
        return acc;
      }, {})
    )
      .map(([agent, values]) => ({ agent, ...values }))
      .sort((a, b) => b.total - a.total);

    return reply.send({
      success: true,
      total,
      count: rows.length,
      dossiers: rows,
      stats,
      byAgent,
    });
  });

  // ── Stats globales ────────────────────────────────────────────────────────

  app.get('/api/admin/stats', async (_req, reply) => {
    const today = new Date().toISOString().slice(0, 10);
    const [dossiers, presence, comptes, storage] = await Promise.all([
      db.getDossierStats(today),
      db.getPresenceResume(),
      db.getAllComptes(),
      db.getStorageStats(),
    ]);
    return reply.send({
      success: true,
      dossiers_today: dossiers,
      presence,
      comptes: {
        total: comptes.length,
        actifs: comptes.filter(c => c.actif).length,
        agents: comptes.filter(c => c.role === 'agent').length,
        superviseurs: comptes.filter(c => c.role === 'superviseur').length,
        admins: comptes.filter(c => c.role === 'admin').length,
      },
      storage,
    });
  });

  // ── Stockage ──────────────────────────────────────────────────────────────

  app.get('/api/admin/stockage', async (_req, reply) => {
    const stats = await db.getStorageStats();
    return reply.send({ success: true, ...stats });
  });

  // ── Multi-DB (lecture / bascule) ────────────────────────────────────────
  app.get('/api/admin/db/active', async (_req, reply) => {
    try {
      const active = db.getActiveDbName();
      return reply.send({ success: true, active });
    } catch (err) {
      return reply.code(500).send({ error: 'Impossible de lire la DB active' });
    }
  });

  app.post('/api/admin/db/switch', async (req, reply) => {
    const body = req.body as { name?: string } | null;
    if (!body?.name || (body.name !== 'primary' && body.name !== 'secondary')) {
      return reply.code(400).send({ error: 'name doit être primary ou secondary' });
    }
    try {
      await db.setActiveDbName(body.name as 'primary' | 'secondary');
      db.audit(req.user.matricule, 'DB_SWITCH', `active=${body.name}`, req.ip);
      return reply.send({ success: true, active: db.getActiveDbName() });
    } catch (err: any) {
      return reply.code(500).send({ error: err.message || 'Erreur lors de la bascule' });
    }
  });

  // ── Purge ─────────────────────────────────────────────────────────────────

  app.post('/api/admin/purge/apercu', async (req, reply) => {
    const body = req.body as { action?: string; mode?: string; du?: string; au?: string } | null;
    if (!body?.action) return reply.code(400).send({ error: 'action requise' });
    const du = body.mode === 'periode' ? body.du : undefined;
    const au = body.mode === 'periode' ? body.au : undefined;
    const count = await db.purgeCount(body.action, du, au);
    return reply.send({ success: true, count });
  });

  app.post('/api/admin/purge/executer', async (req, reply) => {
    const body = req.body as { action?: string; code?: string; mode?: string; du?: string; au?: string } | null;
    if (!body?.action || !body.code) return reply.code(400).send({ error: 'action et code requis' });
    try {
      const du = body.mode === 'periode' ? body.du : undefined;
      const au = body.mode === 'periode' ? body.au : undefined;
      const result = await db.purgeExecute(body.action, body.code, du, au);
      db.audit(req.user.matricule, 'PURGE_EXEC', `action=${body.action} count=${result.count}`, req.ip);
      return reply.send({ success: true, ...result });
    } catch (err) {
      return reply.code(403).send({ error: err instanceof Error ? err.message : 'Erreur' });
    }
  });

  // ── Champs dynamiques (Admin) ────────────────────────────────────────────
  app.get('/api/admin/fields', async (_req, reply) => {
    const rows = await listFields(true);
    return reply.send({ success: true, count: rows.length, fields: rows });
  });

  app.get('/api/admin/fields/schema', async (_req, reply) => {
    const rows = await listFields(false);
    const schema = rows.map(r => ({
      name: r.name,
      label: r.label,
      type: r.type,
      length: r.length,
      decimalScale: r.decimal_scale,
      nullable: !!r.nullable,
      defaultValue: r.default_value,
      position: r.position,
      targetTable: r.target_table,
    }));
    return reply.send({ success: true, count: schema.length, schema });
  });

  app.post('/api/admin/fields', async (req, reply) => {
    const body = req.body as Record<string, unknown> | null;
    if (!body) return reply.code(400).send({ error: 'body requis' });
    const input = {
      name: String(body.name || '').trim(),
      label: String(body.label || '').trim(),
      type: String(body.type || 'VARCHAR').toUpperCase(),
      length: body.length ? parseInt(String(body.length), 10) : undefined,
      decimalScale: body.decimalScale ? parseInt(String(body.decimalScale), 10) : undefined,
      nullable: body.nullable === undefined ? true : Boolean(body.nullable),
      defaultValue: body.defaultValue === undefined ? null : body.defaultValue,
      position: body.position ? parseInt(String(body.position), 10) : null,
      targetTable: String(body.targetTable || 'dossiers'),
    } as any;

    try {
      validateFieldInput(input);
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : 'invalid' });
    }

    const checksum = computeChecksum(input);
    const migrationBase = `add_field_${input.name}`;
    let filePath: string;
    try {
      filePath = autoCreateMigration(migrationBase);
    } catch (err) {
      return reply.code(500).send({ error: 'Impossible de créer le fichier de migration' });
    }

    // Build migration content
    const table = input.targetTable || 'dossiers';
    const colType = columnTypeSql(input);
    const nullSql = input.nullable ? 'NULL' : 'NOT NULL';
    const defaultSql = input.defaultValue !== undefined && input.defaultValue !== null
      ? ` DEFAULT '${String(input.defaultValue).replace(/'/g, "''")}'`
      : '';

    const migrationName = path.basename(filePath).replace(/\.(ts|js)$/, '');
    const upSql = `ALTER TABLE \`${table}\` ADD COLUMN \`${input.name}\` ${colType} ${nullSql}${defaultSql}`;
    const downSql = `ALTER TABLE \`${table}\` DROP COLUMN \`${input.name}\``;

    const content = `export const migration = {
  name: '${migrationName}',
  async up(pool) {
    await pool.execute(${JSON.stringify(upSql)});
  },
  async down(pool) {
    await pool.execute(${JSON.stringify(downSql)});
  },
};
`;

    try {
      fs.writeFileSync(filePath, content, 'utf8');
    } catch (err) {
      return reply.code(500).send({ error: 'Impossible d\'écrire la migration' });
    }

    // Backup
    let backupFile: string | null = null;
    try {
      backupFile = await backupTable(table, input.name);
    } catch (err) {
      return reply.code(500).send({ error: 'Backup échoué' });
    }

    // Apply migration
    try {
      await runMigrations(db.getPool());
    } catch (err) {
      // tentative de rollback de la migration créée
      try {
        await rollbackMigration(db.getPool(), migrationName);
      } catch (rbErr) {
        // ignore rollback errors but record
        console.error('Rollback failed for', migrationName, rbErr);
      }
      // tenter supprimer le fichier de migration pour ne pas laisser de fichier orphelin
      try {
        fs.unlinkSync(filePath);
      } catch (uErr) {
        console.error('Could not remove migration file', filePath, uErr);
      }
      return reply.code(500).send({ error: 'Application migration échouée', detail: err instanceof Error ? err.message : String(err) });
    }

    // Insert metadata
    try {
      await db.exec(
        `INSERT INTO admin_field_changes (name,label,type,length,decimal_scale,nullable,default_value,position,target_table,status,migration_file,checksum,backup_file,created_by,created_at,updated_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        [input.name, input.label, input.type, input.length || null, input.decimalScale || null, input.nullable ? 1 : 0, input.defaultValue || null, input.position || null, table, 'active', path.basename(filePath), checksum, backupFile, req.user.matricule, db.nowSec(), db.nowSec()]
      );
      await logChange(input.name, table, 'create', `migration=${path.basename(filePath)}`, req.user.matricule);
    } catch (err) {
      // tentative de rollback si l'enregistrement échoue
      try {
        await rollbackMigration(db.getPool(), migrationName);
      } catch (rbErr) {
        console.error('Rollback failed after metadata insert error for', migrationName, rbErr);
      }
      try { fs.unlinkSync(filePath); } catch (uErr) { console.error('Could not remove migration file', filePath, uErr); }
      return reply.code(500).send({ error: 'Impossible d\'enregistrer le champ', detail: err instanceof Error ? err.message : String(err) });
    }

    db.audit(req.user.matricule, 'ADMIN_FIELD_CREATE', `field=${input.name} migration=${path.basename(filePath)}`, req.ip);
    return reply.code(201).send({ success: true, migration_file: path.basename(filePath) });
  });

  // Action on a dynamic field: hide / schedule_drop / drop_now
  app.post('/api/admin/fields/:name/action', async (req, reply) => {
    const name = String(req.params.name || '').trim();
    const body = req.body as { action?: string; targetTable?: string } | null;
    if (!name || !body?.action) return reply.code(400).send({ error: 'name et action requis' });
    const action = body.action;
    const targetTable = String(body.targetTable || 'dossiers');
    try {
      const field = await getField(name, targetTable);
      if (!field) return reply.code(404).send({ error: 'Champ introuvable' });

      if (action === 'hide') {
        await db.exec('UPDATE admin_field_changes SET status = ?, hidden_at = ? WHERE id = ?', ['hidden', db.nowSec(), field.id]);
        await logChange(name, targetTable, 'hide', 'hidden by admin', req.user.matricule);
        db.audit(req.user.matricule, 'ADMIN_FIELD_HIDE', `field=${name}`, req.ip);
        return reply.send({ success: true });
      }

      if (action === 'schedule_drop') {
        await db.exec('UPDATE admin_field_changes SET status = ?, drop_scheduled_at = ? WHERE id = ?', ['drop_scheduled', db.nowSec(), field.id]);
        await logChange(name, targetTable, 'schedule_drop', 'drop scheduled by admin', req.user.matricule);
        db.audit(req.user.matricule, 'ADMIN_FIELD_SCHEDULE_DROP', `field=${name}`, req.ip);
        return reply.send({ success: true });
      }

      if (action === 'drop_now') {
        // backup the table first
        const backupFile = await backupTable(targetTable, name + '_drop');
        try {
          await applyDropColumn(targetTable, name);
        } catch (err) {
          return reply.code(500).send({ error: 'Drop échoué', detail: err instanceof Error ? err.message : String(err) });
        }
        await db.exec('UPDATE admin_field_changes SET status = ?, dropped_at = ?, backup_file = ? WHERE id = ?', ['dropped', db.nowSec(), backupFile, field.id]);
        await logChange(name, targetTable, 'drop', `dropped, backup=${backupFile}`, req.user.matricule);
        db.audit(req.user.matricule, 'ADMIN_FIELD_DROP', `field=${name}`, req.ip);
        return reply.send({ success: true, backupFile });
      }

      return reply.code(400).send({ error: 'action inconnue' });
    } catch (err) {
      return reply.code(500).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

    // ── Valeurs inconnues (référentiels) ──────────────────────────────────────
    app.get('/api/admin/unknown-referentiels', async (req, reply) => {
      const q = req.query as Record<string, string | undefined>;
      const field = q.field || undefined;
      const limit = Math.min(parseInt(q.limit || '200', 10), 2000);
      const offset = parseInt(q.offset || '0', 10) || 0;
      const { rows, total } = await db.getUnknownReferentielValues({ field, limit, offset });
      return reply.send({ success: true, total, count: rows.length, rows });
    });

    app.post('/api/admin/unknown-referentiels/:id/accept', async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id invalide' });
      try {
        await db.acceptUnknownReferentielById(id);
        db.audit(req.user.matricule, 'UNKNOWN_REFERENTIEL_ACCEPT', `id=${id}`, req.ip);
        return reply.send({ success: true });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Erreur' });
      }
    });

    app.post('/api/admin/unknown-referentiels/:id/ignore', async (req, reply) => {
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id)) return reply.code(400).send({ error: 'id invalide' });
      try {
        await db.deleteUnknownReferentielById(id);
        db.audit(req.user.matricule, 'UNKNOWN_REFERENTIEL_DELETE', `id=${id}`, req.ip);
        return reply.send({ success: true });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : 'Erreur' });
      }
    });
}
