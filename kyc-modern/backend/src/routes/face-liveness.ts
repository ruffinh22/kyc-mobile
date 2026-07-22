// ============================================================================
// KYC V4 — face-liveness.ts
// Routes publiques terrain pour AWS Rekognition Face Liveness.
//
//   POST /api/public/dossiers/:id/liveness-session
//     → crée une session Face Liveness AWS liée à ce dossier précis.
//       Réponse : { success, sessionId, region }
//       Le client (page web chargée dans la WebView, cf. AcquisitionWebScreen)
//       utilise sessionId + region pour démarrer le composant
//       <FaceLivenessDetector /> (@aws-amplify/ui-react-liveness), qui gère
//       lui-même tout le flux caméra + streaming vers AWS. Le backend NE
//       reçoit AUCUNE vidéo — c'est le client qui streame directement à AWS
//       via des identifiants Cognito temporaires à portée minimale (voir
//       README-liveness-web.md pour la config Cognito à créer une seule fois).
//
//   GET /api/public/dossiers/:id/liveness-session/:sessionId/result
//     → une fois le composant FaceLivenessDetector terminé côté client,
//       appeler cette route pour que le backend aille chercher le résultat
//       AWS, calcule le score d'identité (vs photo recto CNI), et persiste
//       tout en base. Réponse : { success, liveness_status,
//       liveness_confidence, is_live, identity: {score, match, motif},
//       verified }
//
// Remplace l'usage direct de score_visage/visage_match par CompareFaces seul
// (photo statique) pour le flux terrain — CompareFaces reste utilisé tel
// quel pour la vérification manuelle back-office (face-verify.ts), qui n'a
// pas le même niveau d'exigence anti-fraude.
// ============================================================================

import { FastifyRequest } from 'fastify';
import * as db from '../db';
import {
  createLivenessSessionForDossier,
  resolveLivenessSessionForDossier,
  getAwsFriendlyErrorMessage,
} from './face-liveness-shared';

export async function faceLivenessRoutes(app: any): Promise<void> {

  // ==========================================================================
  // POST /api/public/dossiers/:id/liveness-session
  // ==========================================================================
  app.post(
    '/api/public/dossiers/:id/liveness-session',
    {
      config: { rateLimit: { max: 10, timeWindow: 60_000 } },
      schema: { body: { type: 'object', additionalProperties: true } },
    },
    async (req: FastifyRequest, reply: any) => {
      const dossierId = (req.params as { id?: string }).id?.trim();
      if (!dossierId) {
        return reply.code(400).send({ success: false, error: 'ID dossier manquant' });
      }

      const dossier = await db.getDossierById(dossierId);
      if (!dossier) {
        return reply.code(404).send({ success: false, error: `Dossier introuvable : ${dossierId}` });
      }
      if (!dossier.photo_recto) {
        return reply.code(400).send({
          success: false,
          error: 'Photo recto manquante — impossible de vérifier l’identité sans elle',
        });
      }
      if (!process.env.AWS_ACCESS_KEY_ID) {
        return reply.code(503).send({ success: false, error: 'Face Liveness non configuré côté serveur (AWS manquant)' });
      }

      try {
        const { sessionId, region } = await createLivenessSessionForDossier(dossierId);
        db.audit(null, 'LIVENESS_SESSION_CREEE', `id=${dossierId} session=${sessionId}`, req.ip);
        return reply.send({ success: true, sessionId, region });
      } catch (err) {
        req.log.error(err, '[LIVENESS] création session échouée');
        return reply.code(502).send({
          success: false,
          error: getAwsFriendlyErrorMessage(err),
        });
      }
    },
  );

  // ==========================================================================
  // GET /api/public/dossiers/:id/liveness-session/:sessionId/result
  // ==========================================================================
  app.get(
    '/api/public/dossiers/:id/liveness-session/:sessionId/result',
    { config: { rateLimit: { max: 20, timeWindow: 60_000 } } },
    async (req: FastifyRequest, reply: any) => {
      const params = req.params as { id?: string; sessionId?: string };
      const dossierId = params.id?.trim();
      const sessionId  = params.sessionId?.trim();
      if (!dossierId || !sessionId) {
        return reply.code(400).send({ success: false, error: 'ID dossier ou sessionId manquant' });
      }

      const dossier = await db.getDossierById(dossierId);
      if (!dossier) {
        return reply.code(404).send({ success: false, error: `Dossier introuvable : ${dossierId}` });
      }

      const result = await resolveLivenessSessionForDossier(dossierId, sessionId);

      if (!result.success) {
        // Session inconnue / mismatch / erreur AWS → 409 (conflit d'état),
        // pas 500, car ce n'est pas nécessairement une erreur serveur.
        return reply.code(409).send(result);
      }

      return reply.send({
        success: true,
        id: dossierId,
        liveness_status: result.liveness_status,
        liveness_confidence: result.liveness_confidence,
        is_live: result.is_live,
        score_visage: result.identity?.score ?? null,
        visage_match: result.identity?.match === 1,
        visage_motif: result.identity?.motif ?? null,
        verified: result.verified,
        message: result.verified
          ? `✅ Identité vérifiée — vivacité ${result.liveness_confidence}%, correspondance ${result.identity?.score}%.`
          : result.is_live
            ? `⚠️ Personne réelle confirmée (${result.liveness_confidence}%) mais correspondance d’identité insuffisante — vérification manuelle requise.`
            : `⚠️ Vivacité non confirmée (statut: ${result.liveness_status}) — vérification manuelle requise.`,
      });
    },
  );
}
