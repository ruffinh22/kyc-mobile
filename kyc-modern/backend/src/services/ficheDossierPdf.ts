// ============================================================================
// services/ficheDossierPdf.ts
// ----------------------------------------------------------------------------
// Génère la « fiche dossier » d'un titulaire au format PDF : bandeau MTN,
// identité, pièce d'identité & vérification faciale, coordonnées GSM,
// photos capturées (recto/verso/live) et historique des réattributions.
// Utilisé par GET /api/dossiers/:id/fiche-pdf (voir routes/dossiers.ts).
//
// Dépendance : pdfkit (+ @types/pdfkit en devDependency)
//   npm install pdfkit
//   npm install --save-dev @types/pdfkit
// ============================================================================
import PDFDocument from 'pdfkit';
import fs from 'fs';
import path from 'path';
import { Dossier } from '../types';
import { renderConditionsGenerales, MTN_LOGO_SQUARE_B64 } from './conditionsGeneralesMtnMomo';
import { renderFormulaireEnregistrement, FormulaireData } from './formulaireEnregistrement';

const UPLOAD_CNI = process.env.UPLOAD_CNI || path.join(process.cwd(), 'uploads', 'cni');

// ── Charte MTN ────────────────────────────────────────────────────────────
const MTN_YELLOW = '#FFCC00';
const MTN_YELLOW_DEEP = '#F0B90B';
const INK_DARK = '#161616';
const INK_MUTED = '#6B6B6B';
const INK_FAINT = '#9A9A9A';
const BORDER = '#E7E7E7';
const BORDER_SOFT = '#EFEFEF';
const BG_SOFT = '#FAFAFA';
const BG_CARD = '#FCFCFC';
const ACCENT = '#0A0A0A';

const STATUT_LABEL: Record<string, string> = {
  en_attente: 'En attente', en_cours: 'En cours', accepte: 'Accepté', rejete: 'Rejeté',
};
const STATUT_COLOR: Record<string, string> = {
  en_attente: '#B8860B', en_cours: '#1D4ED8', accepte: '#15803D', rejete: '#B91C1C',
};

export interface ReattributionEntry {
  id: number;
  motif: string | null;
  agent_matricule: string;
  created_at: number;
  ancien_snapshot: Record<string, unknown>;
}

function fmtDate(ts?: number | string | null): string {
  if (!ts) return '—';
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (!Number.isFinite(n) || !n) return String(ts || '—');
  return new Date(n * 1000).toLocaleString('fr-FR', { dateStyle: 'long', timeStyle: 'short' });
}

function safeVal(v: unknown): string {
  if (v === null || v === undefined || v === '') return '—';
  if (v === '***') return 'Masqué';
  return String(v);
}

// Résout un chemin de photo relatif en chemin absolu sûr (même logique de
// confinement que GET /api/dossiers/:id/photo/:type dans routes/dossiers.ts).
// pdfkit ne sait pas décoder le WebP : on l'ignore proprement dans ce cas.
function resolvePhoto(rel?: string | null): string | null {
  if (!rel) return null;
  const safeRoot = path.resolve(UPLOAD_CNI);
  const full = path.resolve(safeRoot, rel);
  const relative = path.relative(safeRoot, full);
  if (relative.startsWith('..') || path.isAbsolute(relative)) return null;
  if (!fs.existsSync(full)) return null;
  const ext = path.extname(full).toLowerCase();
  if (ext === '.webp') return null;
  return full;
}

function fmtDateOnly(ts?: number | string | null): string {
  if (!ts) return '';
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (!Number.isFinite(n) || !n) return '';
  return new Date(n * 1000).toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
}

function fmtHeureOnly(ts?: number | string | null): string {
  if (!ts) return '';
  const n = typeof ts === 'string' ? Number(ts) : ts;
  if (!Number.isFinite(n) || !n) return '';
  return new Date(n * 1000).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' });
}

// Cherche la première clé non vide parmi plusieurs noms de colonnes
// possibles — nécessaire car plusieurs champs du formulaire papier
// (numéro de kit, département, quartier, aval, entreprise, etc.) n'ont pas
// encore de colonne standard sur `dossiers` : certains pourraient exister en
// tant que champ personnalisé (voir routes/champs-dossier.ts, qui gère des
// colonnes ajoutées dynamiquement). Tant qu'aucune des clés ne correspond,
// la valeur reste vide et s'affiche comme un tiret dans le PDF — la
// génération n'échoue jamais pour un champ manquant.
function pick(dossier: Record<string, any>, keys: string[]): string {
  for (const k of keys) {
    const v = dossier[k];
    if (v !== undefined && v !== null && v !== '') return String(v);
  }
  return '';
}

function toBool(v: string): boolean | null {
  if (!v) return null;
  const s = v.trim().toLowerCase();
  if (['oui', 'yes', 'true', '1', 'x'].includes(s)) return true;
  if (['non', 'no', 'false', '0'].includes(s)) return false;
  return null;
}

// Construit les données de la page 1 (reproduction du formulaire papier
// d'origine) à partir du dossier. Voir la note en tête de
// formulaireEnregistrement.ts pour la liste des champs qui n'ont pas encore
// de colonne dédiée dans ce projet — ajustez les tableaux de clés ci-dessous
// dès qu'ils existeront (standard ou via Configuration > Champs dossier).
function buildFormulaireData(dossier: Dossier & Record<string, any>, genereParMatricule: string): FormulaireData {
  const agentOrigine = safeVal(dossier.agent_saisie || dossier.username_agent) !== '—'
    ? String(dossier.agent_saisie || dossier.username_agent) : '';

  return {
    dateSouscription: fmtDateOnly(dossier.created_at),
    heureSouscription: fmtHeureOnly(dossier.created_at),

    numeroTelephone: pick(dossier, ['numero_mtn']),
    numeroKit: pick(dossier, ['numero_kit', 'kit', 'num_kit']),
    prenoms: pick(dossier, ['prenom_titulaire']),
    nom: pick(dossier, ['nom_titulaire']),
    genre: pick(dossier, ['sexe', 'genre']),
    dateNaissance: pick(dossier, ['date_naissance']),
    lieuNaissance: pick(dossier, ['lieu_naissance']),
    nationalite: pick(dossier, ['nationalite']),
    profession: pick(dossier, ['profession']),
    departement: pick(dossier, ['departement']),
    ville: pick(dossier, ['ville']),
    quartier: pick(dossier, ['quartier']),
    carre: pick(dossier, ['carre', 'carré']),
    maison: pick(dossier, ['maison', 'numero_maison']),
    typeAbonne: pick(dossier, ['type_abonne', 'type_abonnement']),
    sourceRevenu: pick(dossier, ['source_revenu', 'source_revenu_principal']),

    typePiece: pick(dossier, ['type_piece']),
    numeroPiece: pick(dossier, ['numero_cni', 'numero_piece']),
    dateEmission: pick(dossier, ['date_emission', 'date_delivrance']),
    dateExpiration: pick(dossier, ['date_expiration']),
    email: pick(dossier, ['email', 'e_mail']),
    autresContacts: pick(dossier, ['autre_numero', 'autres_contacts']),

    contactPrenoms: pick(dossier, ['contact_prenoms', 'personne_contact_prenoms']),
    contactNom: pick(dossier, ['contact_nom', 'personne_contact_nom']),
    contactTel: pick(dossier, ['contact_tel', 'personne_contact_tel']),

    aval: toBool(pick(dossier, ['enregistrement_aval', 'aval'])),
    avalPrenoms: pick(dossier, ['aval_prenoms']),
    avalNom: pick(dossier, ['aval_nom']),
    avalTel: pick(dossier, ['aval_tel']),
    avalProfession: pick(dossier, ['aval_profession']),

    tuteurPrenoms: pick(dossier, ['tuteur_prenoms']),
    tuteurNom: pick(dossier, ['tuteur_nom']),
    tuteurTel: pick(dossier, ['tuteur_tel']),
    tuteurProfession: pick(dossier, ['tuteur_profession']),
    tuteurTypePiece: pick(dossier, ['tuteur_type_piece']),
    tuteurNumeroPiece: pick(dossier, ['tuteur_numero_piece']),
    tuteurDateExpiration: pick(dossier, ['tuteur_date_expiration']),

    entreprise: toBool(pick(dossier, ['enregistrement_entreprise', 'entreprise'])),
    entrepriseNom: pick(dossier, ['entreprise_nom']),
    entrepriseAdresse: pick(dossier, ['entreprise_adresse']),
    entrepriseDepartement: pick(dossier, ['entreprise_departement']),
    entrepriseVille: pick(dossier, ['entreprise_ville']),
    entrepriseTypePreuveAdresse: pick(dossier, ['entreprise_type_preuve_adresse']),

    mobileMoney: toBool(pick(dossier, ['enregistrement_mobile_money', 'mobile_money'])),

    transactionUsername: agentOrigine,
    transactionAction: pick(dossier, ['transaction_action']) || 'Enregistrement dossier KYC',
    transactionActionPar: genereParMatricule,
    transactionDate: fmtDateOnly(dossier.created_at),

    signatureClientPath: resolvePhoto(dossier.photo_signature),
    // Pas de signature agent capturée dans ce système à ce jour (seul
    // photo_signature — celle du client — existe côté dossiers) : la case
    // reste vide, prête pour une signature manuscrite si le document est
    // imprimé.
    signatureAgentPath: null,
    nomPrenomsClient: `${pick(dossier, ['prenom_titulaire'])} ${pick(dossier, ['nom_titulaire'])}`.trim(),
    nomPrenomsAgent: agentOrigine || genereParMatricule,
  };
}

export async function buildFicheDossierPdf(
  dossier: Dossier & Record<string, any>,
  reattributions: ReattributionEntry[],
  genereParMatricule: string
): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: 40, bufferPages: true });
    // La marge basse "native" de pdfkit sert normalement de garde-fou pour
    // sa propre pagination automatique — mais elle entre en conflit avec la
    // pagination manuelle de ce fichier (checkPageBreak) : tout doc.text()
    // dont l'origine dépasse page.height - margins.bottom (40) déclenche une
    // pagination AUTOMATIQUE et silencieuse de pdfkit, en plus de la nôtre
    // (pages fantômes, pieds de page perdus). On neutralise cette marge
    // basse ; checkPageBreak() (page.height - 60) reste la seule limite
    // réellement appliquée, avec une marge de sécurité confortable.
    doc.page.margins.bottom = 0;
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    const pageW = doc.page.width;
    const contentW = pageW - 80;

    // ── Page 1 : reproduction fidèle du formulaire papier d'origine ──────
    // (« FORMULAIRE D'ENREGISTREMENT » — même en-tête SPACETEL-BENIN SA,
    // même logo, même encadré jaune avec cases à cocher, mêmes pièces
    // valables / article 161 / tableau de signatures que l'original scanné,
    // mais en PDF natif rempli avec les données réelles du dossier).
    const formResult = renderFormulaireEnregistrement(doc, buildFormulaireData(dossier, genereParMatricule));

    // Les pages suivantes (bandeau interne, identité, pièce, GSM, photos,
    // historique, puis annexe CGU) démarrent sur une page neuve.
    doc.addPage({ size: 'A4', margins: { top: 40, bottom: 0, left: 40, right: 40 } });
    doc.page.margins.bottom = 0;

    // ── Bandeau « Fiche dossier KYC » ────────────────────────────────────
    // Même langage visuel que l'en-tête de la page 1 et des Conditions
    // Générales : cadre fin noir sur fond blanc (pas de fond plein). Logo en
    // en-tête = même asset carré MTN que celui posé en bas des pages 1 et 2
    // (remplace l'ancien médaillon jaune + icône MoMo).
    const bandH = 34;
    doc.lineWidth(1).strokeColor('#000000').fillAndStroke('#FFFFFF', '#000000')
      .rect(40, 0, contentW, bandH).fillAndStroke('#FFFFFF', '#000000');
    const logoS = 26;
    try {
      doc.image(Buffer.from(MTN_LOGO_SQUARE_B64, 'base64'), 46, (bandH - logoS) / 2, { width: logoS, height: logoS });
    } catch { /* logo illisible : espace laissé vide */ }

    const textX = 46 + logoS + 12;
    doc.fillColor(INK_DARK).font('Helvetica-Bold').fontSize(11)
      .text('Fiche dossier KYC', textX, 6.5);
    doc.font('Helvetica').fontSize(6.4).fillColor(INK_MUTED)
      .text(`MTN Bénin · Back office · Document confidentiel · généré le ${fmtDate(Math.floor(Date.now() / 1000))}`, textX, 19.5);

    let y = bandH + 11;

    // ── Ligne méta dossier ───────────────────────────────────────────────
    const statut = String(dossier.statut || '');
    doc.font('Helvetica-Bold').fontSize(11).fillColor(INK_DARK).text(`Dossier ${dossier.id}`, 40, y);
    const badgeColor = STATUT_COLOR[statut] || INK_MUTED;
    const badgeLabel = (STATUT_LABEL[statut] || statut || '—').toUpperCase();
    doc.font('Helvetica-Bold').fontSize(7.5);
    const badgeW = doc.widthOfString(badgeLabel, { characterSpacing: 0.4 }) + 18;
    const badgeH = 15;
    doc.roundedRect(pageW - 40 - badgeW, y - 2, badgeW, badgeH, badgeH / 2).fill(badgeColor);
    doc.circle(pageW - 40 - badgeW + 10, y - 2 + badgeH / 2, 2.2).fill('#FFFFFF');
    doc.fillColor('#FFFFFF').font('Helvetica-Bold').fontSize(7.5)
      .text(badgeLabel, pageW - 40 - badgeW + 14, y + 2.5, { width: badgeW - 16, align: 'left', characterSpacing: 0.4 });
    y += 16;
    doc.font('Helvetica').fontSize(7.6).fillColor(INK_MUTED).text(
      `Créé le ${fmtDate(dossier.created_at)}   ·   Agent d'origine : ${safeVal(dossier.agent_saisie || dossier.username_agent)}` +
      `${(dossier.nb_reattributions ?? 0) > 0 ? `   ·   Réattribué ${dossier.nb_reattributions}×` : ''}`,
      40, y
    );
    y += 13;

    // ── Helpers de mise en page ──────────────────────────────────────────
    const checkPageBreak = (needed: number) => {
      if (y + needed > doc.page.height - 60) { doc.addPage(); doc.page.margins.bottom = 0; y = 40; }
    };

    // Titre de section : petite barre d'accent noire + libellé en petites
    // capitales espacées façon fiche « premium », posé sur une ligne fine
    // plutôt qu'un simple soulignement.
    const sectionTitle = (title: string) => {
      checkPageBreak(20);
      doc.roundedRect(40, y + 1, 3, 9, 1.5).fill(ACCENT);
      doc.font('Helvetica-Bold').fontSize(8.4).fillColor(INK_DARK)
        .text(title.toUpperCase(), 52, y, { characterSpacing: 0.4 });
      y += 11;
      doc.moveTo(40, y).lineTo(pageW - 40, y).strokeColor(BORDER).lineWidth(1).stroke();
      y += 6;
    };

    // Grille de champs présentée en carte légèrement grisée avec coins
    // arrondis (plutôt que du texte nu sur fond blanc) : plus lisible et
    // visuellement plus proche d'une fiche produite par un vrai back-office.
    const grid = (pairs: [string, string][]) => {
      const colW = contentW / 2;
      const rowH = 18.5;
      const rows = Math.ceil(pairs.length / 2);
      const cardH = rows * rowH + 9;
      checkPageBreak(cardH + 6);
      doc.roundedRect(40, y, contentW, cardH, 6).fillAndStroke(BG_CARD, BORDER_SOFT);
      pairs.forEach(([label, value], i) => {
        const col = i % 2;
        const row = Math.floor(i / 2);
        const x = 40 + 14 + col * colW;
        const rowY = y + 7 + row * rowH;
        doc.font('Helvetica-Bold').fontSize(6.2).fillColor(INK_FAINT)
          .text(label.toUpperCase(), x, rowY, { characterSpacing: 0.25 });
        doc.font('Helvetica-Bold').fontSize(8.6).fillColor(INK_DARK)
          .text(value, x, rowY + 9, { width: colW - 24 });
      });
      y += cardH + 6;
    };

    // ── Identité du titulaire ────────────────────────────────────────────
    sectionTitle('Identité du titulaire');
    grid([
      ['Nom', safeVal(dossier.nom_titulaire)],
      ['Prénom', safeVal(dossier.prenom_titulaire)],
      ['Date de naissance', safeVal(dossier.date_naissance)],
      ['Lieu de naissance', safeVal(dossier.lieu_naissance)],
      ['Sexe', safeVal(dossier.sexe)],
      ['Nationalité', safeVal(dossier.nationalite)],
      ['Profession', safeVal(dossier.profession)],
      ['Nom du père', safeVal(dossier.nom_pere)],
      ['Nom de la mère', safeVal(dossier.nom_mere)],
      ['Adresse', safeVal(dossier.adresse_complete)],
    ]);

    // ── Pièce d'identité & vérification faciale ──────────────────────────
    sectionTitle("Pièce d'identité & vérification faciale");
    const scoreStr = dossier.score_visage != null ? `${Math.round(Number(dossier.score_visage) * 100)}%` : '—';
    grid([
      ['Type de pièce', safeVal(dossier.type_piece)],
      ['Numéro de pièce', safeVal(dossier.numero_cni)],
      ["Date d'expiration", safeVal(dossier.date_expiration)],
      ['Score de correspondance visage', scoreStr],
      ['Statut liveness', safeVal(dossier.liveness_status)],
      ['Motif (si rejet visage)', safeVal(dossier.visage_motif)],
    ]);

    // ── Coordonnées GSM ────────────────────────────────────────────────
    sectionTitle('Coordonnées GSM');
    grid([
      ['Numéro MTN', safeVal(dossier.numero_mtn)],
      ['Autre numéro', safeVal(dossier.autre_numero)],
      ['Contact WhatsApp agent', safeVal(dossier.wa_agent)],
    ]);

    // ── Documents capturés ────────────────────────────────────────────
    // Vérifie la place pour le titre ET les vignettes ensemble : sinon le
    // titre de section risque de rester orphelin en bas d'une page pendant
    // que les photos basculent seules sur la suivante.
    checkPageBreak(20 + 78 + 26);
    sectionTitle('Documents capturés');
    const photoDefs: { label: string; rel: string | null | undefined }[] = [
      { label: 'Recto pièce', rel: dossier.photo_recto },
      { label: 'Verso pièce', rel: dossier.photo_verso },
      { label: 'Photo live', rel: dossier.photo_live },
    ];
    const photoW = (contentW - 2 * 10) / 3;
    const photoH = 78;
    let px = 40;
    for (const p of photoDefs) {
      doc.roundedRect(px, y, photoW, photoH, 7).fillAndStroke(BG_SOFT, BORDER_SOFT);
      const full = resolvePhoto(p.rel);
      if (full) {
        try {
          doc.save();
          doc.roundedRect(px, y, photoW, photoH, 7).clip();
          doc.image(full, px, y, { fit: [photoW, photoH], align: 'center', valign: 'center' });
          doc.restore();
        } catch {
          doc.font('Helvetica').fontSize(8).fillColor(INK_FAINT)
            .text('Image illisible', px, y + photoH / 2 - 4, { width: photoW, align: 'center' });
        }
      } else {
        doc.font('Helvetica').fontSize(8).fillColor(INK_FAINT)
          .text('Non disponible', px, y + photoH / 2 - 4, { width: photoW, align: 'center' });
      }
      doc.roundedRect(px, y, photoW, photoH, 7).lineWidth(1).strokeColor(BORDER_SOFT).stroke();
      doc.font('Helvetica-Bold').fontSize(6.8).fillColor(INK_MUTED)
        .text(p.label.toUpperCase(), px, y + photoH + 4, { width: photoW, align: 'center', characterSpacing: 0.3 });
      px += photoW + 10;
    }
    y += photoH + 24;

    // ── Historique des réattributions ─────────────────────────────────
    if (reattributions.length > 0) {
      // Même logique que pour les documents : réserve la place du titre +
      // de l'en-tête de tableau + d'au moins une ligne, pour ne jamais
      // laisser le titre seul en bas de page.
      checkPageBreak(20 + 16 + 15);
      sectionTitle(`Historique des réattributions (${reattributions.length})`);
      const cols = [
        { label: 'Date', w: 110 },
        { label: 'Ancien titulaire', w: 160 },
        { label: 'Motif', w: 140 },
        { label: 'Agent', w: contentW - 110 - 160 - 140 },
      ];
      let cx = 40;
      doc.font('Helvetica-Bold').fontSize(7.5).fillColor(INK_MUTED);
      cols.forEach(c => { doc.text(c.label.toUpperCase(), cx, y, { width: c.w }); cx += c.w; });
      y += 12;
      doc.moveTo(40, y).lineTo(pageW - 40, y).strokeColor(BORDER).stroke();
      y += 5;
      reattributions.forEach(r => {
        checkPageBreak(15);
        cx = 40;
        const ancien = `${safeVal(r.ancien_snapshot?.nom_titulaire)} ${safeVal(r.ancien_snapshot?.prenom_titulaire)}`.trim();
        const rowVals = [fmtDate(r.created_at), ancien || '—', safeVal(r.motif), safeVal(r.agent_matricule)];
        doc.font('Helvetica').fontSize(8).fillColor(INK_DARK);
        cols.forEach((c, i) => { doc.text(rowVals[i], cx, y, { width: c.w - 6 }); cx += c.w; });
        y += 14;
      });
      y += 6;
    }

    // ── Logo MTN en pied de page (même asset copié depuis le bas de la
    // page 1 — reproduit le même habillage « logo bas » sur cette page). ──
    const bottomLogoSize = 30;
    checkPageBreak(bottomLogoSize + 8);
    const bottomLogoBuffer = Buffer.from(MTN_LOGO_SQUARE_B64, 'base64');
    const bottomLogoY = Math.max(y + 4, doc.page.height - 46 - bottomLogoSize);
    try {
      doc.image(bottomLogoBuffer, pageW - 40 - bottomLogoSize, bottomLogoY, { width: bottomLogoSize, height: bottomLogoSize });
    } catch { /* logo illisible : espace laissé vide */ }

    // ── Annexe : Conditions générales d'abonnement MTN Mobile Money ─────
    // Deux pages en 2 colonnes, reproduites en PDF natif (texte sélectionnable)
    // à partir de la pièce papier annexée au formulaire d'enregistrement.
    // Voir services/conditionsGeneralesMtnMomo.ts pour le contenu et le
    // moteur de mise en page.
    const cgu = renderConditionsGenerales(doc);

    // ── Pied de page (sur toutes les pages) ─────────────────────────────
    // Les pages de la fiche elle-même portent la mention de confidentialité
    // + le matricule de génération ; les pages CGU (annexe contractuelle,
    // texte standard non lié au dossier) ont déjà leur propre pied de page
    // posé par renderConditionsGenerales — on n'y ajoute ici que la
    // pagination globale, cohérente sur l'ensemble du document.
    // NB : on reste strictement à l'intérieur de la marge du document (40pt)
    // pour ne pas déclencher une pagination automatique intempestive de
    // pdfkit (tout doc.text() dont l'origine est au-delà de
    // page.height - margins.bottom ouvre silencieusement une page fantôme).
    const range = doc.bufferedPageRange();
    for (let i = range.start; i < range.start + range.count; i++) {
      doc.switchToPage(i);
      const isFormPage = i < formResult.pageCount;
      const isCguPage = i >= cgu.startPageIndex;
      if (!isFormPage && !isCguPage) {
        doc.font('Helvetica').fontSize(7.5).fillColor(INK_MUTED).text(
          `Généré par ${genereParMatricule} — MTN KYC Back Office — Document confidentiel, usage interne uniquement.`,
          40, doc.page.height - 46, { width: contentW - 60, align: 'left' }
        );
      }
      doc.font('Helvetica').fontSize(7.5).fillColor(INK_MUTED)
        .text(`Page ${i - range.start + 1}/${range.count}`, pageW - 100, doc.page.height - 46, { width: 60, align: 'right' });
    }

    doc.end();
  });
}