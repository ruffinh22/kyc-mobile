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

import { initDb, getConfig } from './db';
import { reconcileAgentLocks } from './db/locks';
import { registerRoutes } from './routes';

import { distribuerMaintenant } from './utils/distribution';

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
  await reconcileAgentLocks().catch(err => console.error('[LOCKS] reconciliation initiale échouée:', err));

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

  // Fichiers statiques pour APK release (si généré)
  const apkReleaseDir = process.env.APK_RELEASE_DIR
    ? path.resolve(process.cwd(), process.env.APK_RELEASE_DIR)
    : path.resolve(process.cwd(), '../../android/app/build/outputs/apk/release');

  // Un build APK valide fait plusieurs Mo. En dessous, c'est presque
  // toujours un résidu de build interrompu / test manuel / upload partiel —
  // jamais un vrai livrable. On l'exclut de la sélection pour ne plus jamais
  // servir accidentellement un fichier vide ou corrompu à la place du bon.
  const MIN_VALID_APK_SIZE = 5 * 1024 * 1024; // 5 Mo

  if (fs.existsSync(apkReleaseDir)) {
    // Encapsulé dans son propre scope Fastify : decorateReply (par défaut
    // true) ne s'applique qu'ici, donc reply.sendFile() devient disponible
    // sans entrer en conflit avec les autres registrations de @fastify/static
    // (uploads, frontend) qui restent decorateReply:false.
    app.register(async (apkScope: any) => {
      await apkScope.register(staticPlugin, { root: apkReleaseDir, prefix: '/apk/', maxAge: 0 });

      // Route dynamique : on relit le dossier à CHAQUE requête plutôt que de
      // figer la liste des .apk au démarrage. Sans ça, un nouveau build généré
      // après le démarrage du process (systemd) reste invisible tant que le
      // service n'est pas explicitement redémarré.
      apkScope.get('/apk/app-release.apk', async (_req, reply) => {
        let candidates: { name: string; size: number; mtimeMs: number }[] = [];
        try {
          candidates = fs.readdirSync(apkReleaseDir)
            .filter((f) => f.toLowerCase().endsWith('.apk'))
            .map((name) => {
              const st = fs.statSync(path.join(apkReleaseDir, name));
              return { name, size: st.size, mtimeMs: st.mtimeMs };
            });
        } catch (err) {
          apkScope.log.warn('[APK] lecture dossier échouée', err instanceof Error ? err.message : String(err));
        }

        const valid = candidates
          .filter((f) => f.size >= MIN_VALID_APK_SIZE)
          .sort((a, b) => b.mtimeMs - a.mtimeMs);

        if (valid.length === 0) {
          apkScope.log.warn(
            '[APK] aucun .apk valide (>= %dMo) dans %s — candidats trouvés: %j',
            MIN_VALID_APK_SIZE / (1024 * 1024),
            apkReleaseDir,
            candidates,
          );
          return reply.code(404).send({ error: 'Aucun APK release valide disponible' });
        }

        const chosen = valid[0];
        apkScope.log.info('[APK] sert %s (%d octets)', chosen.name, chosen.size);

        // sendFile() (fourni par @fastify/static) gère Content-Length, ETag,
        // Last-Modified et surtout les requêtes Range — essentiel pour que
        // Chrome/Android puisse reprendre un téléchargement de 50+ Mo coupé
        // sur une connexion mobile instable, ce que notre ancien streaming
        // manuel ne supportait pas.
        return reply
          .header('Content-Disposition', 'attachment; filename="app-release.apk"')
          .sendFile(chosen.name, apkReleaseDir);
      });

      apkScope.log.info('[STATIC] route dynamique /apk/app-release.apk (via sendFile) enregistrée');
    });

    app.log.info('[STATIC] APK release servie depuis', apkReleaseDir);
  } else {
    app.log.warn('[STATIC] APK release non trouvé à', apkReleaseDir);
  }

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

  // ── Distribution automatique ──────────────────────────────────────────────
  const runDistributionLoop = async () => {
    try {
      const intervalMs = parseInt((await getConfig('distribution_interval_ms')) ?? process.env.DISTRIBUTION_INTERVAL_MS ?? '2000', 10);
      const delay = Number.isFinite(intervalMs) && intervalMs > 0 ? intervalMs : 2000;
      setTimeout(async () => {
        try {
          await distribuerMaintenant();
        } catch (err) {
          app.log.warn('[DISTRIB-AUTO] %s', err instanceof Error ? err.message : String(err));
        }
        await runDistributionLoop();
      }, delay);
    } catch (err) {
      app.log.warn('[DISTRIB-AUTO] impossible de charger l’intervalle depuis la config: %s', err instanceof Error ? err.message : String(err));
      setTimeout(() => void runDistributionLoop(), 2000);
    }
  };

  await runDistributionLoop();
}

for (const signal of ['SIGTERM', 'SIGINT']) {
  process.on(signal, async () => {
    app.log.info(`[SHUTDOWN] ${signal}`);
    await app.close();
    process.exit(0);
  });
}

main().catch(err => { console.error('[FATAL]', err); process.exit(1); });