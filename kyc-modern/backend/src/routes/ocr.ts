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

// Types de pièce d'identité pris en charge. Les pièces "officielles" ont un
// format d'État structuré (numéro, date de naissance, date d'expiration...)
// et on exige une extraction complète + une date d'expiration. Une carte
// scolaire n'a pas ce niveau de structuration standardisée : les champs
// secondaires (numéro de pièce, date d'expiration...) peuvent légitimement
// être absents, on ne les exige donc pas côté extraction.
const OFFICIAL_DOC_TYPES = new Set(['CNI', 'CEDEAO', 'PASSPORT', 'CIP', 'PERMIS']);
const KNOWN_DOC_TYPES = new Set([...OFFICIAL_DOC_TYPES, 'CARTE_SCOLAIRE', 'CARTE_ETUDIANT', 'AUTRE']);

function isOfficialDoc(typePiece: string): boolean {
  return OFFICIAL_DOC_TYPES.has(typePiece.toUpperCase());
}

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
// DATE_RE couvre aussi les dates séparées par des espaces ("12 04 1988"),
// courantes sur les CNI d'Afrique centrale où l'OCR insère parfois un espace
// à la place du séparateur imprimé (trait fin, point) mal détecté.
const DATE_RE = /\b(\d{1,2}[\/\-.\s]\d{1,2}[\/\-.\s]\d{2,4}|\d{4}[\/\-.\s]\d{1,2}[\/\-.\s]\d{1,2})\b/;

const LABELS = {
  nom:    /^(NOM|SURNAME|LAST\s*NAME)\b[:\s]*/i,
  // PR[ÉE]NOM couvre l'accent (É/E) ; \(?S?\)? rend les parenthèses ET le S
  // indépendamment optionnels, pour matcher aussi bien "PRÉNOM", "PRENOMS",
  // "PRÉNOM(S)" que "PRÉNOMS" — l'ancienne regex exigeait un espace littéral
  // avant un "S" optionnel, ce qui ne matchait JAMAIS "PRÉNOM(S)" (le format
  // réellement imprimé sur la plupart des CNI, y compris celui documenté en
  // tête de ce fichier), laissant le champ Prénom vide côté mobile alors que
  // le Nom, lui, s'extrayait correctement — d'où l'incohérence visible à
  // l'écran (bannière "succès" avec un champ resté vide/déverrouillé).
  prenom: /^(PR[ÉE]NOM\(?S?\)?|GIVEN\s*NAMES?|FIRST\s*NAME)\b[:\s]*/i,
  naissance: /(N[ÉE]?\(?E?\)?\s*LE|DATE\s*DE\s*NAISSANCE|DATE\s*OF\s*BIRTH|D\.?O\.?B\.?)\b[:\s]*/i,
  lieu: /(LIEU\s*DE\s*NAISSANCE|[ÀA]\s*[:\s]|PLACE\s*OF\s*BIRTH)\b[:\s]*/i,
  expiration: /(DATE\s*D['’]?\s*EXPIRATION|VALABLE\s*JUSQU['’]?\s*AU|EXPIRE\s*LE|DATE\s*OF\s*EXPIRY|EXP\.?)\b[:\s]*/i,
  // La nationalité est imprimée de façon structurée sur les pièces
  // officielles (CNI, CEDEAO, passeport...) ; une carte scolaire ou un
  // justificatif "autre" ne la porte généralement pas — dans ce cas le champ
  // reste vide et la saisie se fait manuellement côté mobile/web.
  nationalite: /(NATIONALIT[ÉE]?|NATIONALITY)\b[:\s]*/i,
  // Numéro de pièce : couvre "N°", "N", "NUMERO", accolé ou non à CNI/CARTE/
  // IDENTIFIANT selon le pays. Volontairement large car c'est le libellé qui
  // varie le plus d'un pays d'Afrique centrale à l'autre.
  numero: /(N[°ºO]\s*(?:CNI|CARTE|IDENTIFIANT)?|NUM[ÉE]RO\s*(?:DE\s*(?:LA\s*)?(?:CNI|CARTE|PI[ÈE]CE))?|ID\s*N[°ºO])\b[:\s]*/i,
};

// Une ligne d'en-tête tabulaire ("NOM PRÉNOM(S) DATE DE NAISSANCE...",
// fréquente sur les CNI à mise en page en colonnes) commence souvent par le
// même mot-clé qu'une vraie valeur ("NOM: DIALLO"), mais contient ENSUITE
// un ou plusieurs autres mots-clés de LABELS à la suite. On rejette ces
// lignes pour ne jamais prendre un en-tête de colonnes pour une valeur.
function looksLikeHeaderRow(text: string): boolean {
  const keywordHits = Object.values(LABELS).filter((re) => re.test(text)).length;
  return keywordHits >= 2;
}

// Retire les résidus de ponctuation qui échappent parfois au regex de label
// (":" isolé, "(S)" orphelin, espaces multiples issus de la mise en page en
// colonnes) sans toucher au contenu réel de la valeur.
function cleanValue(v: string): string {
  return v.replace(/^[:\-()\s]+/, '').replace(/\s{2,}/g, ' ').trim();
}

function extractFields(lines: string[], typePiece: string) {
  const official = isOfficialDoc(typePiece);
  const out = {
    nom: '', prenom: '', date_naissance: '', lieu_naissance: '',
    adresse_complete: '', numero_cni: '', sexe: '', nationalite: '', profession: '',
    date_expiration: '',
  };

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    if (!out.nom && LABELS.nom.test(line) && !looksLikeHeaderRow(line)) {
      const inline = line.replace(LABELS.nom, '').trim();
      out.nom = cleanValue(inline || (lines[i + 1]?.trim() ?? ''));
      continue;
    }
    if (!out.prenom && LABELS.prenom.test(line) && !looksLikeHeaderRow(line)) {
      const inline = line.replace(LABELS.prenom, '').trim();
      out.prenom = cleanValue(inline || (lines[i + 1]?.trim() ?? ''));
      continue;
    }
    if (!out.date_naissance && LABELS.naissance.test(line)) {
      const m = line.match(DATE_RE) || lines[i + 1]?.match(DATE_RE);
      if (m) out.date_naissance = m[1];
      // le lieu suit parfois sur la même ligne après la date ("NÉ LE 12/04/1988 À BRAZZAVILLE")
      const apresDate = line.split(DATE_RE)[2]?.replace(/^[,àÀ\s-]+/, '').trim();
      if (apresDate) out.lieu_naissance = cleanValue(apresDate);
      continue;
    }
    if (!out.lieu_naissance && LABELS.lieu.test(line) && !looksLikeHeaderRow(line)) {
      const inline = line.replace(LABELS.lieu, '').trim();
      out.lieu_naissance = cleanValue(inline || (lines[i + 1]?.trim() ?? ''));
      continue;
    }
    // Numéro de pièce : uniquement pour les pièces officielles (voir plus
    // haut pour la nationalité et l'expiration — même logique).
    if (official && !out.numero_cni && LABELS.numero.test(line) && !looksLikeHeaderRow(line)) {
      const inline = line.replace(LABELS.numero, '').trim();
      out.numero_cni = cleanValue(inline || (lines[i + 1]?.trim() ?? ''));
      continue;
    }
    // Nationalité : uniquement pour les pièces officielles — un justificatif
    // non officiel ne l'imprime pas de façon fiable, la saisie y reste
    // manuelle (voir isOfficialDoc plus haut et la logique côté mobile/web).
    if (official && !out.nationalite && LABELS.nationalite.test(line) && !looksLikeHeaderRow(line)) {
      const inline = line.replace(LABELS.nationalite, '').trim();
      out.nationalite = cleanValue(inline || (lines[i + 1]?.trim() ?? ''));
      continue;
    }
    // Date d'expiration : uniquement pour les pièces officielles — une carte
    // scolaire n'a généralement pas de date d'expiration structurée (année
    // scolaire imprimée dans un format libre), on évite donc de deviner.
    if (official && !out.date_expiration && LABELS.expiration.test(line)) {
      const m = line.match(DATE_RE) || lines[i + 1]?.match(DATE_RE);
      if (m) out.date_expiration = m[1];
      continue;
    }
  }

  // Repli "date isolée" : uniquement si la date de naissance n'a toujours pas
  // été trouvée via un label explicite, et seulement en toute fin de parcours
  // pour ne jamais préempter une date d'expiration correctement labellisée
  // rencontrée plus loin dans le texte.
  if (!out.date_naissance) {
    for (const line of lines) {
      const m = line.trim().match(DATE_RE);
      if (m) { out.date_naissance = m[1]; break; }
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
    let typePiece = 'AUTRE';

    try {
      for await (const part of req.parts()) {
        if (part.type === 'field' && part.fieldname === 'country') {
          country = String(part.value ?? '');
        } else if (part.type === 'field' && part.fieldname === 'type_piece') {
          const raw = String(part.value ?? '').trim().toUpperCase();
          typePiece = KNOWN_DOC_TYPES.has(raw) ? raw : 'AUTRE';
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

      const fields = extractFields(lines, typePiece);
      const official = isOfficialDoc(typePiece);

      // Champs attendus selon le type de pièce : complets pour une pièce
      // officielle (numéro + date d'expiration inclus) ; réduits au strict
      // nom/prénom pour une carte scolaire ou un type non reconnu, dont le
      // format n'est pas standardisé et où l'absence de certains champs est
      // normale plutôt qu'une erreur de lecture.
      const expectedFields = official
        ? ['nom', 'prenom', 'date_naissance', 'lieu_naissance', 'numero_cni', 'date_expiration', 'nationalite'] as const
        : ['nom', 'prenom'] as const;
      const champsManquants = expectedFields.filter((k) => !fields[k]?.trim());

      const log = req.log as unknown as {
        info: (payload: Record<string, unknown>, msg?: string) => void;
        error: (err: unknown, msg?: string) => void;
      };

      log.info({ event: 'ocr-id-card', country, typePiece, linesCount: lines.length, fields, champsManquants }, 'OCR pièce traitée');

      return reply.send({
        success: true,
        type_piece: typePiece,
        nom: fields.nom,
        prenom: fields.prenom,
        date_naissance: fields.date_naissance,
        lieu_naissance: fields.lieu_naissance,
        adresse_complete: fields.adresse_complete,
        numero_cni: fields.numero_cni,
        date_expiration: fields.date_expiration,
        sexe: fields.sexe,
        nationalite: fields.nationalite,
        profession: fields.profession,
        champs_manquants: champsManquants,
      });
    } catch (err) {
      const log = req.log as unknown as {
        info: (payload: Record<string, unknown>, msg?: string) => void;
        error: (err: unknown, msg?: string) => void;
      };
      
      let errorMessage = 'Erreur OCR';
      const errObj = err as Record<string, unknown> & { name?: string; message?: string; __type?: string };
      
      if (errObj.__type === 'SubscriptionRequiredException' || errObj.name === 'SubscriptionRequiredException') {
        errorMessage = 'AWS Textract non disponible pour ce compte — utilisation du fallback local (Tesseract)';
      } else if (errObj.message) {
        errorMessage = errObj.message;
      }
      
      log.error(err, '[OCR] Textract a échoué');
      return reply.send({ success: false, error: errorMessage });
    }
  });
}