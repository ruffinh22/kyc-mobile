// ============================================================================
// services/formulaireEnregistrement.ts
// ----------------------------------------------------------------------------
// Reproduit fidèlement, en PDF natif (texte réel, pas une image), la PAGE 1
// du formulaire papier d'origine (« FORMULAIRE D'ENREGISTREMENT » —
// registration_information.pdf) : en-tête SPACETEL-BENIN SA + logo, boîte
// encadrée du titre, grand encadré jaune listant tous les champs saisis avec
// cases à cocher (Aval / Entreprise / Mobile Money), rappel des pièces
// valables, tableau de signatures (client + agent, avec la signature
// réellement capturée si elle existe), rappel de l'article 161 du code pénal
// et texte de certification.
//
// Utilisé par services/ficheDossierPdf.ts, qui construit un FormulaireData à
// partir du dossier puis appelle renderFormulaireEnregistrement(doc, data)
// en tout début de document, avant les pages internes du back-office et
// avant l'annexe CGU (voir conditionsGeneralesMtnMomo.ts).
//
// NB IMPORTANT SUR LE MAPPING DES CHAMPS :
// Le formulaire papier d'origine contient plus de champs que ceux
// actuellement stockés sur `dossiers` (numéro de kit, département, ville,
// quartier, carré, maison, type d'abonné, source de revenu, date
// d'émission de la pièce, e-mail, personne à contacter, aval, tuteur,
// entreprise, infos de transaction...). ficheDossierPdf.ts va chercher ces
// valeurs sur l'objet dossier via des noms de colonnes « probables » — tant
// qu'une colonne n'existe pas encore côté base, le champ s'affiche vide
// (tiret) sans faire planter la génération. Si vos colonnes portent des
// noms différents, ajustez `pick(dossier, [...])` dans buildFormulaireData
// (ficheDossierPdf.ts), pas ce fichier-ci.
// ============================================================================
import PDFKit from 'pdfkit';
import { MTN_MOMO_ICON_B64, MTN_LOGO_SQUARE_B64 } from './conditionsGeneralesMtnMomo';

type PDFDoc = InstanceType<typeof PDFKit>;

const MTN_YELLOW = '#FFCC00';
const MTN_YELLOW_DEEP = '#F0B90B';
const INK_DARK = '#161616';
const INK_MUTED = '#6B6B6B';
const INK_FAINT = '#9A9A9A';
const BORDER = '#E4E4E4';
const BORDER_SOFT = '#EDEDED';
const BG_CARD = '#FAFAFA';
const ACCENT = '#0A0A0A';
const GREEN = '#15803D';
const GREEN_BG = '#EAF6EE';

export interface FormulaireData {
  // Méta souscription
  dateSouscription: string;
  heureSouscription: string;

  // Identité / GSM
  numeroTelephone: string;
  numeroKit: string;
  prenoms: string;
  nom: string;
  genre: string;
  dateNaissance: string;
  lieuNaissance: string;
  nationalite: string;
  profession: string;
  departement: string;
  ville: string;
  quartier: string;
  carre: string;
  maison: string;
  typeAbonne: string;
  sourceRevenu: string;

  // Pièce d'identité
  typePiece: string;
  numeroPiece: string;
  dateEmission: string;
  dateExpiration: string;
  email: string;
  autresContacts: string;

  // Personne à contacter
  contactPrenoms: string;
  contactNom: string;
  contactTel: string;

  // Enregistrement par aval
  aval: boolean | null;
  avalPrenoms: string;
  avalNom: string;
  avalTel: string;
  avalProfession: string;

  // Tuteur (mineur)
  tuteurPrenoms: string;
  tuteurNom: string;
  tuteurTel: string;
  tuteurProfession: string;
  tuteurTypePiece: string;
  tuteurNumeroPiece: string;
  tuteurDateExpiration: string;

  // Enregistrement entreprise
  entreprise: boolean | null;
  entrepriseNom: string;
  entrepriseAdresse: string;
  entrepriseDepartement: string;
  entrepriseVille: string;
  entrepriseTypePreuveAdresse: string;

  // Mobile Money
  mobileMoney: boolean | null;

  // Transaction
  transactionUsername: string;
  transactionAction: string;
  transactionActionPar: string;
  transactionDate: string;

  // Signatures — chemins absolus déjà résolus (fs-safe) par l'appelant,
  // ou null si aucune signature capturée pour ce dossier.
  signatureClientPath: string | null;
  signatureAgentPath: string | null;
  nomPrenomsClient: string;
  nomPrenomsAgent: string;
}

const dash = (v: string | undefined | null): string => (v && v.trim() ? v.trim() : '—');

export interface FormulaireRenderResult {
  /** Nombre de pages occupées par la reproduction du formulaire (1 en pratique, sauf dossier avec énormément de champs remplis). */
  pageCount: number;
}

export function renderFormulaireEnregistrement(doc: PDFDoc, data: FormulaireData): FormulaireRenderResult {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const MARGIN = 30;
  const contentW = pageW - 2 * MARGIN;
  const iconBuffer = Buffer.from(MTN_MOMO_ICON_B64, 'base64');
  // Grand logo carré MTN — même asset que celui utilisé en bas des pages du
  // document source, posé en pied de la dernière page du formulaire pour
  // reproduire l'habillage « logo en haut + logo en bas » de l'original.
  const logoBuffer = Buffer.from(MTN_LOGO_SQUARE_B64, 'base64');
  // Laisse la place à la ligne de pagination « Page X/Y » (dessinée par
  // ficheDossierPdf.ts à pageH - 46) : la dernière chose posée par cette
  // fonction (le logo bas de page) doit rester strictement au-dessus.
  const BOTTOM_LIMIT = pageH - 50;
  // NB : contrairement à renderConditionsGenerales (appelé après que
  // plusieurs pages existent déjà, donc juste avant un addPage()), cette
  // fonction dessine directement sur la page COURANTE — page 0, créée
  // automatiquement par `new PDFDocument()` avant même le premier
  // addPage(). L'index de départ est donc le dernier index déjà existant
  // (range.start + range.count - 1), pas le prochain index à créer.
  const rangeAtStart = doc.bufferedPageRange();
  const startPageIndex = rangeAtStart.start + rangeAtStart.count - 1;

  let y = MARGIN;

  const ensure = (h: number) => {
    if (y + h > BOTTOM_LIMIT) {
      doc.addPage({ size: 'A4', margins: { top: MARGIN, bottom: 0, left: MARGIN, right: MARGIN } });
      doc.page.margins.bottom = 0;
      y = MARGIN;
    }
  };

  // ── En-tête société + logo (identique à l'original, compacté) ───────────
  const iconSize = 40;
  doc.font('Helvetica-Bold').fontSize(8.4).fillColor(INK_DARK)
    .text('SPACETEL-BENIN SA', MARGIN, y, { width: contentW - iconSize - 10, lineGap: -0.5 });
  y = doc.y + 1;
  doc.font('Helvetica').fontSize(6.2).fillColor(INK_MUTED);
  const headerLines = [
    'Société Anonyme avec Conseil d’Administration au capital de 892 000 000FCFA',
    'Registre de Commerce et du Crédit Mobilier n°22.749-B- · Immeuble Roc Fleuri, Quartier Djomehountin',
    '01BP5293 Cotonou · Tél : (229)21316641 · Fax : (229)21316643 · www.mtn.bj',
  ];
  headerLines.forEach(line => {
    doc.text(line, MARGIN, y, { width: contentW - iconSize - 10, lineGap: -1 });
    y = doc.y + 0.3;
  });
  doc.image(iconBuffer, MARGIN + contentW - iconSize, MARGIN, { width: iconSize, height: iconSize });
  y = Math.max(y, MARGIN + iconSize) + 7;

  // ── Bandeau titre — cadre fin (pas de fond noir), même langage visuel
  // que l'en-tête des Conditions Générales : fond blanc, liseré noir,
  // titre en noir gras. Reproduit fidèlement le document source. ─────────
  const titleBandH = 25;
  doc.lineWidth(1).strokeColor('#000000').fillColor('#FFFFFF')
    .rect(MARGIN, y, contentW, titleBandH).fillAndStroke('#FFFFFF', '#000000');
  doc.fillColor(INK_DARK).font('Helvetica-Bold').fontSize(12)
    .text('FORMULAIRE D’ENREGISTREMENT', MARGIN, y + 5, { width: contentW, align: 'center', characterSpacing: 0.3 });
  doc.fillColor(INK_MUTED).font('Helvetica').fontSize(6.4)
    .text('Souscription GSM & Mobile Money — République du Bénin', MARGIN, y + 17, { width: contentW, align: 'center' });
  y += titleBandH + 8;

  // ── Helpers de mise en page (compacts, cohérents avec la page 2) ────────
  const REQ_MARK_COLOR = '#B91C1C';

  const sectionTitle = (title: string) => {
    ensure(17);
    doc.roundedRect(MARGIN, y + 1.5, 3.5, 9.5, 1.5).fill(ACCENT);
    doc.font('Helvetica-Bold').fontSize(8.6).fillColor(INK_DARK)
      .text(title.toUpperCase(), MARGIN + 10, y, { characterSpacing: 0.4 });
    y += 10.5;
    doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(BORDER).lineWidth(1).stroke();
    y += 4.5;
  };

  // pairs : [label, value, obligatoire?]. Rendu en carte grise arrondie,
  // libellé en petite capitale grise au-dessus de la valeur en gras — grille
  // à `cols` colonnes (3 par défaut : 3 champs par ligne).
  const card = (pairs: Array<[string, string, boolean?]>, cols = 3) => {
    const colW = contentW / cols;
    const rowH = 20;
    const pad = 8;
    const rows = Math.ceil(pairs.length / cols);
    const cardH = rows * rowH + pad * 2 - 6;
    ensure(cardH + 5);
    doc.roundedRect(MARGIN, y, contentW, cardH, 5).fillAndStroke(BG_CARD, BORDER_SOFT);
    pairs.forEach(([label, value, required], i) => {
      const col = i % cols;
      const row = Math.floor(i / cols);
      const x = MARGIN + pad + col * colW;
      const rowY = y + pad + row * rowH;
      doc.font('Helvetica-Bold').fontSize(6.4).fillColor(INK_FAINT)
        .text(label.toUpperCase(), x, rowY, { continued: !!required, width: colW - pad, characterSpacing: 0.15 });
      if (required) doc.fillColor(REQ_MARK_COLOR).text(' *', { continued: false });
      doc.font('Helvetica-Bold').fontSize(9.6).fillColor(INK_DARK)
        .text(dash(value), x, rowY + 8.5, { width: colW - pad - 4 });
    });
    y += cardH + 5;
  };

  // Ligne de « puces » statut (Aval / Mineur / Entreprise / Mobile Money) —
  // remplace les cases à cocher papier par des badges colorés modernes.
  const statusRow = (items: Array<[string, boolean | null]>) => {
    const rowH = 28;
    const pad = 9;
    ensure(rowH + 5);
    doc.roundedRect(MARGIN, y, contentW, rowH, 5).fillAndStroke(BG_CARD, BORDER_SOFT);
    const colW = contentW / items.length;
    items.forEach(([label, val], i) => {
      const x = MARGIN + i * colW + pad;
      doc.font('Helvetica-Bold').fontSize(6.4).fillColor(INK_FAINT)
        .text(label.toUpperCase(), x, y + 6, { width: colW - pad * 1.4, characterSpacing: 0.15 });
      const chipLabel = val === true ? 'OUI' : val === false ? 'NON' : '—';
      const chipColor = val === true ? GREEN : val === false ? INK_MUTED : INK_FAINT;
      const chipBg = val === true ? GREEN_BG : '#EFEFEF';
      doc.font('Helvetica-Bold').fontSize(7.2);
      const chipW = doc.widthOfString(chipLabel, { characterSpacing: 0.3 }) + 12;
      doc.roundedRect(x, y + 16, chipW, 11, 5.5).fill(chipBg);
      doc.fillColor(chipColor).text(chipLabel, x, y + 19, { width: chipW, align: 'center', characterSpacing: 0.3 });
    });
    y += rowH + 5;
  };

  const miniLabel = (text: string) => {
    ensure(11);
    doc.font('Helvetica-Bold').fontSize(6.8).fillColor(INK_MUTED).text(text, MARGIN, y);
    y = doc.y + 2.5;
  };

  const hasAny = (...vals: string[]) => vals.some(v => v && v.trim());

  // ── Informations de souscription (date / heure / numéro / kit) ─────────
  card([
    ['Date de souscription (JJ/MM/AAAA)', data.dateSouscription, true],
    ['Heure (h/mn)', data.heureSouscription, true],
    ['Numéro de téléphone (+229)', dash(data.numeroTelephone), true],
    ['Numéro Kit', data.numeroKit, true],
  ]);

  // ── Identité du titulaire ───────────────────────────────────────────────
  sectionTitle('Identité du titulaire');
  card([
    ['Prénoms', data.prenoms, true],
    ['Nom de famille', data.nom, true],
    ['Genre (H/F)', data.genre, true],
    ['Date de naissance', data.dateNaissance, true],
    ['Lieu de naissance', data.lieuNaissance, true],
    ['Nationalité', data.nationalite, true],
    ['Profession', data.profession, false],
  ]);

  // ── Adresse ──────────────────────────────────────────────────────────
  sectionTitle('Adresse');
  card([
    ['Département', data.departement, true],
    ['Ville', data.ville, true],
    ['Quartier', data.quartier, true],
    ['Carré', data.carre, false],
    ['Maison', data.maison, false],
    ['Type d’abonné (Ind/ent)', data.typeAbonne, true],
  ]);

  // ── Pièce d'identité ─────────────────────────────────────────────────
  sectionTitle('Pièce d’identité');
  card([
    ['Type de pièce', data.typePiece, true],
    ['Numéro pièce', data.numeroPiece, true],
    ['Date d’émission', data.dateEmission, false],
    ['Date d’expiration', data.dateExpiration, true],
  ]);

  // ── Contacts ─────────────────────────────────────────────────────────
  sectionTitle('Contacts');
  card([
    ['E-mail', data.email, false],
    ['Autres contacts', data.autresContacts, false],
    ['Source de revenu principal', data.sourceRevenu, true],
    ['Personne à contacter — Prénoms', data.contactPrenoms, false],
    ['Personne à contacter — Nom', data.contactNom, false],
    ['Personne à contacter — N° Tél', data.contactTel, false],
  ]);

  // ── Statut de l'enregistrement (Aval / Mineur / Entreprise / MoMo) ──────
  sectionTitle('Statut de l’enregistrement');
  const hasTuteur = hasAny(data.tuteurPrenoms, data.tuteurNom, data.tuteurTel, data.tuteurTypePiece, data.tuteurNumeroPiece);
  statusRow([
    ['Enregistrement par aval', data.aval],
    ['Enregistrement mineur', hasTuteur ? true : null],
    ['Enregistrement entreprise', data.entreprise],
    ['Mobile Money', data.mobileMoney],
  ]);

  // Détails conditionnels : uniquement affichés quand la case correspondante
  // est cochée « Oui », pour ne pas noyer la fiche de tirets inutiles.
  if (data.aval === true) {
    miniLabel('Détails de l’aval');
    card([
      ['Prénoms', data.avalPrenoms, false],
      ['Nom', data.avalNom, false],
      ['N° Tél', data.avalTel, false],
      ['Profession', data.avalProfession, false],
    ]);
  }

  if (hasTuteur) {
    miniLabel('Tuteur (enregistrement mineur)');
    card([
      ['Prénoms', data.tuteurPrenoms, false],
      ['Nom', data.tuteurNom, false],
      ['N° Tél', data.tuteurTel, false],
      ['Profession', data.tuteurProfession, false],
      ['Type de pièce', data.tuteurTypePiece, false],
      ['Numéro pièce', data.tuteurNumeroPiece, false],
      ['Date d’expiration', data.tuteurDateExpiration, false],
    ]);
  }

  if (data.entreprise === true) {
    miniLabel('Détails de l’entreprise');
    card([
      ['Nom de l’entreprise', data.entrepriseNom, false],
      ['Adresse', data.entrepriseAdresse, false],
      ['Département', data.entrepriseDepartement, false],
      ['Ville', data.entrepriseVille, false],
      ['Type de preuve d’adresse physique', data.entrepriseTypePreuveAdresse, false],
    ]);
  }

  // ── Information de la transaction ───────────────────────────────────
  sectionTitle('Information de la transaction');
  card([
    ['Nom d’utilisateur', data.transactionUsername, false],
    ['Action', data.transactionAction, false],
    ['Action faite par', data.transactionActionPar, false],
    ['Date de l’action', data.transactionDate, false],
  ]);

  // ── Pièces valables ───────────────────────────────────────────────────
  ensure(30);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(BORDER_SOFT).lineWidth(1).stroke();
  y += 4;
  doc.font('Helvetica-Oblique').fontSize(5.8).fillColor(INK_MUTED)
    .text('Pièces valables : les pièces ci-dessous ne sont admises que lorsqu’elles sont valides (non expirées)', MARGIN, y, { width: contentW, lineGap: -1 });
  y = doc.y + 1;
  doc.font('Helvetica').fontSize(5.8).fillColor(INK_MUTED)
    .text('1. Carte Nationale d’identité  2. Passeport  3. Permis de conduire  4. Carte consulaire  5. Titre de Séjour  6. Carte d’électeur (LEPI)  7. Carte professionnelle FDS  8. Carte d’étudiant/scolaire  9. Carte de réfugié.', MARGIN, y, { width: contentW, lineGap: -1 });
  y = doc.y + 1;
  doc.font('Helvetica-BoldOblique').fontSize(5.8).fillColor(INK_MUTED)
    .text('NB : Les Cartes d’étudiant, scolaires et de réfugié ne sont pas autorisées pour l’enregistrement Mobile Money.', MARGIN, y, { width: contentW, lineGap: -1 });
  y = doc.y + 6;

  // ── Signatures ───────────────────────────────────────────────────────
  ensure(52);
  const sigGap = 10;
  const sigColW = (contentW - sigGap) / 2;
  doc.font('Helvetica-Bold').fontSize(6.6).fillColor(INK_MUTED)
    .text('SIGNATURE DU CLIENT *', MARGIN, y, { width: sigColW, characterSpacing: 0.4 })
    .text('SIGNATURE DE L’AGENT *', MARGIN + sigColW + sigGap, y, { width: sigColW, characterSpacing: 0.4 });
  y += 9;
  const sigBoxH = 28;
  doc.roundedRect(MARGIN, y, sigColW, sigBoxH, 5).fillAndStroke(BG_CARD, BORDER_SOFT);
  doc.roundedRect(MARGIN + sigColW + sigGap, y, sigColW, sigBoxH, 5).fillAndStroke(BG_CARD, BORDER_SOFT);
  if (data.signatureClientPath) {
    try { doc.image(data.signatureClientPath, MARGIN + 8, y + 3, { fit: [sigColW - 16, sigBoxH - 6] }); } catch { /* image illisible : case laissée vide */ }
  }
  if (data.signatureAgentPath) {
    try { doc.image(data.signatureAgentPath, MARGIN + sigColW + sigGap + 8, y + 3, { fit: [sigColW - 16, sigBoxH - 6] }); } catch { /* idem */ }
  }
  const nameY = y + sigBoxH + 3;
  doc.font('Helvetica').fontSize(6.4).fillColor(INK_MUTED)
    .text(`Nom & Prénoms : ${dash(data.nomPrenomsClient)}`, MARGIN, nameY, { width: sigColW })
    .text(`Nom & Prénoms : ${dash(data.nomPrenomsAgent)}`, MARGIN + sigColW + sigGap, nameY, { width: sigColW });
  y = nameY + 9;

  // ── Article 161 du code pénal + certification (bloc légal, sobre) ──────
  ensure(52);
  doc.moveTo(MARGIN, y).lineTo(MARGIN + contentW, y).strokeColor(BORDER_SOFT).lineWidth(1).stroke();
  y += 4;
  doc.font('Helvetica-Bold').fontSize(6.1).fillColor(INK_MUTED)
    .text('Article 161 du code pénal', MARGIN, y, { underline: true });
  y = doc.y + 1;
  doc.font('Helvetica').fontSize(5.6).fillColor(INK_FAINT).text(
    'Sera puni d’un emprisonnement de six mois à deux ans et d’une amende de 40.000 à 400.000 francs ou l’une de ces deux peines seulement, sans préjudice de l’application le cas échéant, des peines plus fortes prévues par le présent code et les lois spéciales, quiconque :',
    MARGIN, y, { width: contentW, align: 'justify', lineGap: -1 }
  );
  y = doc.y + 1.5;
  const art161Items = [
    'Aura établi sciemment une attestation ou un certificat faisant états de fait matériellement inexacts',
    'Aura falsifié ou modifié d’une façon quelconque une attestation ou un certificat originairement sincère',
    'Aura fait sciemment usage d’une attestation ou d’un certificat inexact ou falsifié',
  ];
  art161Items.forEach((t, i) => {
    doc.font('Helvetica').fontSize(5.6).fillColor(INK_FAINT)
      .text(`${i + 1}.  ${t}`, MARGIN + 12, y, { width: contentW - 12, align: 'justify', lineGap: -1 });
    y = doc.y + 0.6;
  });
  y += 2;

  doc.font('Helvetica-BoldOblique').fontSize(5.8).fillColor(INK_MUTED)
    .text('* Champs obligatoires à renseigner', MARGIN, y);
  y = doc.y + 2.5;
  doc.font('Helvetica').fontSize(5.6).fillColor(INK_FAINT).text(
    'Je certifie exacts tous les renseignements sur le présent formulaire d’abonnement et reconnais que toute fausse déclaration de ma part m’expose à des sanctions pénales prévues à l’article 161 du code Pénal en annexe. Je reconnais également avoir reçu un exemplaire des conditions générales d’abonnement, en avoir pris connaissance et les accepte.',
    MARGIN, y, { width: contentW, align: 'justify', lineGap: -1 }
  );
  y = doc.y;

  // ── Logo MTN en pied de page (même asset qu'en haut) ────────────────────
  // Reproduit l'habillage « logo haut + logo bas » de l'original : posé en
  // bas à droite de la DERNIÈRE page du formulaire, au-dessus de la ligne de
  // pagination ajoutée globalement par ficheDossierPdf.ts (voir
  // `Page X/Y`, dessinée à ~46pt du bas de chaque page). ensure() garantit
  // qu'on ne dessine jamais ce logo par-dessus le texte qui précède : s'il
  // ne reste pas la place, une nouvelle page est créée pour lui, comme pour
  // n'importe quel autre bloc du formulaire.
  const bottomLogoSize = 30;
  ensure(bottomLogoSize + 8);
  const bottomLogoY = Math.max(y + 4, doc.page.height - 46 - bottomLogoSize);
  try {
    doc.image(logoBuffer, MARGIN + contentW - bottomLogoSize, bottomLogoY, { width: bottomLogoSize, height: bottomLogoSize });
  } catch { /* logo illisible : espace laissé vide */ }

  const rangeAtEnd = doc.bufferedPageRange();
  const endPageIndex = rangeAtEnd.start + rangeAtEnd.count - 1;
  return { pageCount: endPageIndex - startPageIndex + 1 };
}