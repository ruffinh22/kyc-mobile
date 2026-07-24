import dotenv from 'dotenv';
import path from 'path';
import Fastify, { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import fsp from 'fs/promises';
import fs from 'fs';
import cors from '@fastify/cors';

const envPath = path.resolve(__dirname, '../.env');
dotenv.config({ path: envPath });
console.log('[ENV] Chargement du fichier .env depuis', envPath);
console.log('[ENV] FCM_SERVER_KEY présent ?', Boolean(process.env.FCM_SERVER_KEY));
console.log('[ENV] FCM_API_KEY présent ?', Boolean(process.env.FCM_API_KEY));
import helmet     from '@fastify/helmet';
import cookie     from '@fastify/cookie';
import multipart  from '@fastify/multipart';
import rateLimit  from '@fastify/rate-limit';
import staticPlugin from '@fastify/static';
import websocket from '@fastify/websocket';

import { initDb, getDistributionMode, getOldestPendingDossier, getOldestAvailableAgent, updateDossier, audit } from './db';
import { registerRoutes } from './routes';

import { startDossierTimeoutWorker } from './utils/dossier-timeout-worker';

const PORT     = parseInt(process.env.PORT || '3001', 10);
const HOST     = process.env.HOST || '0.0.0.0';
const NODE_ENV = process.env.NODE_ENV || 'development';

const app: any = Fastify({
  logger: {
    level: NODE_ENV === 'production' ? 'info' : 'debug',
    transport: NODE_ENV !== 'production'
      ? { target: 'pino-pretty', options: { colorize: true, translateTime: 'HH:MM:ss' } }
      : undefined,
  },
  trustProxy: true,
  bodyLimit: 10 * 1024 * 1024,
});

async function main(): Promise<void> {
  await initDb();

  await app.register(helmet, { contentSecurityPolicy: false, crossOriginResourcePolicy: { policy: 'cross-origin' } });
  const configuredCorsOrigins = (process.env.CORS_ORIGIN || '')
    .split(',')
    .map(value => value.trim())
    .filter(Boolean);

  const corsConfig = NODE_ENV === 'production'
    ? {
        origin: (origin: string | undefined, callback: (error: Error | null, allow?: boolean) => void) => {
          if (!origin) {
            return callback(null, true);
          }

          const normalizedOrigin = origin.replace(/\/$/, '');
          const isAllowed = configuredCorsOrigins.some((allowed) => allowed.replace(/\/$/, '') === normalizedOrigin);
          if (!isAllowed) {
            return callback(null, false);
          }

          return callback(null, true);
        },
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
        exposedHeaders: ['Set-Cookie'],
      }
    : {
        origin: true,
        credentials: true,
        methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
        allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With', 'Accept'],
        exposedHeaders: ['Set-Cookie'],
      };

  await app.register(cors, corsConfig);
  await app.register(cookie, { secret: process.env.JWT_SECRET || 'kyc-cookie' });
  await app.register(multipart, { limits: { fileSize: 5 * 1024 * 1024, files: 5 } });
  await app.register(websocket as any);
  await app.register(rateLimit, {
    global: true, max: 300, timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => req.headers?.['x-forwarded-for']?.toString() || req.ip || 'unknown',
  });

  // Fichiers statiques (photos CNI/GSM via /uploads/*)
  const uploadsDir = path.join(process.cwd(), 'uploads');
  try {
    await app.register(staticPlugin, { root: uploadsDir, prefix: '/uploads/', decorateReply: false });
  } catch { app.log.warn('[STATIC] uploads dir non trouvé, ignoré'); }

  // Serve frontend build si disponible (doit être généré via `cd ../frontend && npm run build`)
  const frontendDist = path.join(process.cwd(), '../frontend/dist');
  if (fs.existsSync(frontendDist)) {
    try {
      await app.register(staticPlugin, { root: frontendDist, prefix: '/', decorateReply: false });
      app.log.info('[STATIC] frontend dist servie depuis', frontendDist);
    } catch (err) {
      app.log.warn('[STATIC] impossible de servir frontend dist', err instanceof Error ? err.message : String(err));
    }
  } else {
    app.log.info('[STATIC] frontend dist non trouvé, redirection /liveness-check si FRONTEND_URL défini');
  }

  await registerRoutes(app);

  app.setErrorHandler((error: import('fastify').FastifyError, _req, reply) => {
    app.log.error(error);
    const code = error.statusCode ?? 500;
    reply.code(code).send({ error: code === 500 ? 'Erreur serveur interne' : error.message });
  });

  app.setNotFoundHandler((req, reply) => {
    const url = req.raw.url || '/';
    const isApi = url.startsWith('/api/') || url.startsWith('/uploads/') || url.startsWith('/ws');
    const hasExtension = path.extname(url) !== '';

    if (isApi || hasExtension) {
      return reply.code(404).send({ error: 'Route introuvable' });
    }

    const indexCandidates = [
      path.join(process.cwd(), '../frontend/dist/index.html'),
      path.resolve(__dirname, '../../frontend/dist/index.html'),
      path.resolve(__dirname, '../../frontend/index.html'),
    ];
    const indexPath = indexCandidates.find((candidate) => fs.existsSync(candidate));
    if (indexPath) {
      const html = fs.readFileSync(indexPath, 'utf8');
      return reply.type('text/html; charset=utf-8').send(html);
    }

    return reply.code(404).send({ error: 'Route introuvable' });
  });

  if (!process.env.FCM_SERVER_KEY && !process.env.FCM_API_KEY) {
    app.log.warn('[FCM] FCM_SERVER_KEY/FCM_API_KEY non défini — les pushes d\'appel entrants seront désactivés en arrière-plan');
    app.log.warn('[FCM] Définis FCM_SERVER_KEY avec la clé serveur Firebase du projet pour activer les notifications hors app');
  } else {
    app.log.info('[FCM] Clé serveur FCM détectée — les appels entrants peuvent être poussés en arrière-plan');
  }

  await app.listen({ port: PORT, host: HOST });
  app.log.info(`✅ KYC V4 démarré — http://${HOST}:${PORT} [${NODE_ENV}]`);

  // ── Workers en arrière-plan ───────────────────────────────────────────────
  // Détecter et retourner les dossiers abandonnés (timeout)
  startDossierTimeoutWorker();

  // ── Distribution automatique ──────────────────────────────────────────────
  const INTERVAL  = parseInt(process.env.DISTRIBUTION_INTERVAL_MS || '2000', 10);
  const ABANDON   = parseInt(process.env.DISTRIBUTION_ABANDON_SEC || '120', 10);

  setInterval(async () => {
    try {
      if (await getDistributionMode() !== 'auto') return;
      const dossier = await getOldestPendingDossier();
      if (!dossier) return;
      const agent = await getOldestAvailableAgent(Math.floor(Date.now() / 1000) - ABANDON);
      if (!agent) return;

      const now = Math.floor(Date.now() / 1000);
      await updateDossier(dossier.id, {
        statut: 'en_cours', agent_saisie: agent.matricule, assigne_a: agent.matricule,
        assigne_le: now, heure_prise: new Date().toTimeString().slice(0, 5),
      });
      audit(null, 'DISTRIB_AUTO', `dossier=${dossier.id} agent=${agent.matricule}`);
    } catch (err) {
      app.log.warn('[DISTRIB-AUTO] %s', err instanceof Error ? err.message : String(err));
    }
  }, INTERVAL);
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`[SHUTDOWN] ${signal}`);
    await app.close();
    process.exit(0);
  });
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });
