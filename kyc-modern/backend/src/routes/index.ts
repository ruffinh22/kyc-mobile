import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { authRoutes }        from './auth';
import { dossiersRoutes }    from './dossiers';
import { gsmRoutes }         from './gsm';
import { presenceRoutes }    from './presence';
import { planningRoutes }    from './planning';
import { planningManagersRoutes } from './planning-managers';
import { notesQualiteRoutes } from './notes-qualite';
import { configRoutes }      from './config';
import { supFileRoutes }     from './sup-file';
import { publicDossierRoutes } from './public-dossiers';
import { faceVerifyRoutes }  from './face-verify';
import { faceLivenessRoutes } from './face-liveness';
import { livenessPageRoutes } from './liveness-page';
import { adminRoutes }       from './admin';
import { ocrRoutes }         from './ocr';
import { videoSignalRoutes } from './video-signal';
import { capturesRoutes } from './captures';

export async function registerRoutes(app: any): Promise<void> {
  app.get('/api/health', async (_req: FastifyRequest, reply: FastifyReply) =>
    reply.send({ success: true, status: 'ok', version: '4.0.0', ts: new Date().toISOString() })
  );

  await app.register(authRoutes);
  await app.register(dossiersRoutes);
  await app.register(gsmRoutes);
  await app.register(presenceRoutes);
  await app.register(planningRoutes);
  await app.register(planningManagersRoutes);
  await app.register(notesQualiteRoutes);
  await app.register(configRoutes);
  await app.register(supFileRoutes);
  await app.register(publicDossierRoutes);
  await app.register(faceVerifyRoutes);
  await app.register(faceLivenessRoutes);
  await app.register(livenessPageRoutes);
  await app.register(adminRoutes);
  await app.register(ocrRoutes);
  await app.register(videoSignalRoutes);
  await app.register(capturesRoutes);
}