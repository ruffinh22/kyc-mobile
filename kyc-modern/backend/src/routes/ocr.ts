// ============================================================================
// KYC V4 — ocr.ts
// Lecture automatique du recto de la CNI (nom, prénom, date/lieu de naissance)
// pour pré-remplir AcquisitionScreenPro côté mobile.
//
// Utilise AWS Textract (DetectDocumentText) — même compte AWS que Rekognition
// (face-verify-shared.ts), donc pas de nouvelle variable d'env nécessaire :
// AWS_REGION / AWS_ACCESS_KEY_ID / AWS_SECRET_ACCESS_KEY.
//
// IMPORTANT — limites connues :
//   Les CNI d'Afrique centrale n'ont pas un format unique reconnu nativement
//   par un service cloud (contrairement aux passeports MRZ ou permis US/CA
//   que Textract "AnalyzeID" sait lire nativement). On extrait donc le texte
//   brut ligne par ligne puis on applique des heuristiques (mots-clés
//   FR : "NOM", "PRÉNOM(S)", "NÉ(E) LE", "À" / "LIEU DE NAISSANCE") pour
//   deviner les champs. C'est un point de départ fonctionnel, pas une lecture
//   garantie à 100% — d'où le fait que tous les champs restent éditables
//   côté mobile et que l'agent doit systématiquement vérifier avant envoi.
//   Pour un pays donné avec un format de CNI stable, affiner extractFields()
//   avec des règles plus précises (position des lignes, regex dédiées, etc.)
//   fera monter significativement la fiabilité.
//
// npm i @aws-sdk/client-textract
// ============================================================================

import { FastifyInstance, FastifyRequest } from 'fastify';

const MAX_FILE = 5 * 1024 * 1024;
const ALLOWED_MIME = new Set(['image/jpeg', 'image/png', 'image/webp']);

interface TextractClient {
  send: (command: unknown) => Promise<{ Blocks?: Array<{ BlockType?: string; Text?: string }> }>;
}

let _textract: { client: TextractClient; DetectDocumentTextCommand: new (input: Record<string, unknown>) => unknown } | null = null;

function getTextractClient() {
  if (_textract) return _textract;
  const region = process.env.AWS_REGION;
  const keyId  = process.env.AWS_ACCESS_KEY_ID;
  const secret = process.env.AWS_SECRET_ACCESS_KEY;
  if (!region || !keyId || !secret) {
    throw new Error('Variables AWS manquantes (AWS_REGION, AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY)');
  }
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { TextractClient, DetectDocumentTextCommand } = require('@aws-sdk/client-textract');
  _textract = {
    client: new TextractClient({ region, credentials: { accessKeyId: keyId, secretAccessKey: secret } }),
    DetectDocumentTextCommand,
  };
  return _textract!;
}

// ── Heuristiques d'extraction ────────────────────────────────────────────────
const DATE_RE = /\b(\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}|\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2})\b/;

const LABELS = {
  nom:    /^(NOM|SURNAME|LAST\s*NAME)\b[:\s]*/i,
  prenom: /^(PR[ÉE]NOM S?|PRENOMS?|GIVEN\s*NAMES?|FIRST\s*NAME)\b[:\s]*/i,
  naissance: /(N[ÉE]?\(?E?\)?\s*LE|DATE\s*DE\s*NAISSANCE|DATE\s*OF\s*BIRTH|D\.?O\.?B\.?)\b[:\s]*/i,
  lieu: /(LIEU\s*DE\s*NAISSANCE|[ÀA]\s*[:\s]|PLACE\s*OF\s*BIRTH)\b[:\s]*/i,
};

function extractFields(lines: string[]) {
  const out = {
    nom: '', prenom: '', date_naissance: '', lieu_naissance: '',
    adresse_complete: '', numero_cni: '', sexe: '', nationalite: '', profession: ''
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (!out.nom && LABELS.nom.test(line)) {
      const inline = line.replace(LABELS.nom, '').trim();
      out.nom = inline || (lines[i + 1]?.trim() ?? '');
      continue;
    }
    if (!out.prenom && LABELS.prenom.test(line)) {
      const inline = line.replace(LABELS.prenom, '').trim();
      out.prenom = inline || (lines[i + 1]?.trim() ?? '');
      continue;
    }
    if (!out.date_naissance && LABELS.naissance.test(line)) {
      const m = line.match(DATE_RE) || lines[i + 1]?.match(DATE_RE);
      if (m) out.date_naissance = m[1];
      // le lieu suit parfois sur la même ligne après la date ("NÉ LE 12/04/1988 À BRAZZAVILLE")
      const apresDate = line.split(DATE_RE)[2]?.replace(/^[,àÀ\s-]+/, '').trim();
      if (apresDate) out.lieu_naissance = apresDate;
      continue;
    }
    if (!out.lieu_naissance && LABELS.lieu.test(line)) {
      const inline = line.replace(LABELS.lieu, '').trim();
      out.lieu_naissance = inline || (lines[i + 1]?.trim() ?? '');
      continue;
    }
    // Repli : une ligne isolée qui ne contient qu'une date plausible
    if (!out.date_naissance) {
      const m = line.match(DATE_RE);
      if (m) out.date_naissance = m[1];
    }
  }

  return out;
}

export async function ocrRoutes(app: any): Promise<void> {
  // ==========================================================================
  // POST /api/ocr/id-card
  // Body (multipart) : country (field), photo_recto (file)
  // Réponse : { success, nom, prenom, date_naissance, lieu_naissance, adresse_complete, numero_cni, sexe, nationalite, profession }
  // Contrat détaillé côté mobile : voir SignalingService/AcquisitionScreenPro,
  // section SERVER_SPEC.md fournie précédemment.
  // ==========================================================================
  app.post('/api/ocr/id-card', {
    config: { rateLimit: { max: 20, timeWindow: 60_000 } },
  }, async (req: FastifyRequest, reply: any) => {
    if (!req.isMultipart()) {
      return reply.code(400).send({ success: false, error: 'Format multipart attendu' });
    }

    let photoBuf: Buffer | null = null;
    let country = '';

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field' && part.fieldname === 'country') {
          country = String(part.value ?? '');
        } else if (part.type === 'file' && part.fieldname === 'photo_recto') {
          if (!ALLOWED_MIME.has(part.mimetype)) {
            for await (const _ of part.file) { /* drain */ }
            return reply.code(400).send({ success: false, error: `Type MIME non autorisé : ${part.mimetype}` });
          }
          const chunks: Buffer[] = [];
          let size = 0;
          for await (const chunk of part.file) {
            size += chunk.length;
            if (size > MAX_FILE) return reply.code(413).send({ success: false, error: 'Fichier trop volumineux (max 5 Mo)' });
            chunks.push(chunk);
          }
          photoBuf = Buffer.concat(chunks);
        } else if (part.type === 'file') {
          for await (const _ of part.file) { /* drain champs non attendus */ }
        }
      }
    } catch {
      return reply.code(400).send({ success: false, error: 'Erreur lecture multipart' });
    }

    if (!photoBuf) {
      return reply.code(400).send({ success: false, error: 'photo_recto requis' });
    }

    if (!process.env.AWS_ACCESS_KEY_ID) {
      return reply.send({ success: false, error: 'OCR non configuré côté serveur (AWS manquant)' });
    }

    try {
      const { client, DetectDocumentTextCommand } = getTextractClient();
      const result = await client.send(new DetectDocumentTextCommand({
        Document: { Bytes: photoBuf },
      }));

      const lines = (result.Blocks ?? [])
        .filter(b => b.BlockType === 'LINE' && b.Text)
        .map(b => b.Text as string);

      if (lines.length === 0) {
        return reply.send({ success: false, error: 'Aucun texte détecté sur le document' });
      }

      const fields = extractFields(lines);
      const log = req.log as unknown as {
        info: (payload: Record<string, unknown>, msg?: string) => void;
        error: (err: unknown, msg?: string) => void;
      };

      log.info({ event: 'ocr-id-card', country, linesCount: lines.length, fields }, 'OCR CNI traité');

      return reply.send({
        success: true,
        nom: fields.nom,
        prenom: fields.prenom,
        date_naissance: fields.date_naissance,
        lieu_naissance: fields.lieu_naissance,
        adresse_complete: fields.adresse_complete,
        numero_cni: fields.numero_cni,
        sexe: fields.sexe,
        nationalite: fields.nationalite,
        profession: fields.profession,
      });
    } catch (err) {
      const log = req.log as unknown as {
        info: (payload: Record<string, unknown>, msg?: string) => void;
        error: (err: unknown, msg?: string) => void;
      };
      log.error(err, '[OCR] Textract a échoué');
      return reply.send({ success: false, error: err instanceof Error ? err.message : 'Erreur OCR' });
    }
  });
}
