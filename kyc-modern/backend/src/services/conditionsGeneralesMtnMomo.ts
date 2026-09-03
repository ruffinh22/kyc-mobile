// ============================================================================
// services/conditionsGeneralesMtnMomo.ts
// ----------------------------------------------------------------------------
// Contenu transcrit des « Conditions Générales d'Abonnement (Fonctionnement
// des services MTN Mobile Money Bénin) » telles qu'annexées au formulaire
// d'enregistrement papier, + un moteur de mise en page 2 colonnes pdfkit
// pour les reproduire en PDF natif (texte réel, sélectionnable) au sein de
// la fiche dossier.
//
// Le texte source est une pièce scannée (image raster, sans couche texte) :
// il a été retranscrit manuellement à partir des pages haute résolution.
// Toute correction ou ajout d'article doit se faire dans CGU_BLOCKS
// ci-dessous — c'est la seule source de vérité pour ce contenu.
//
// Utilisé par services/ficheDossierPdf.ts (renderConditionsGenerales).
// ============================================================================
import PDFKit from 'pdfkit';

type PDFDoc = InstanceType<typeof PDFKit>;

// ── Charte MTN (reprise de ficheDossierPdf.ts pour rester cohérent) ────────
const MTN_YELLOW = '#FFCC00';
const INK_DARK = '#1A1A1A';
const INK_MUTED = '#5B5B5B';
const BORDER = '#E2E2E2';

export type CguBlock =
  | { t: 'article'; text: string }
  | { t: 'sub'; text: string }
  | { t: 'label'; text: string }
  | { t: 'p'; text: string }
  | { t: 'bullet'; text: string }
  | { t: 'def'; term: string; text: string }
  | { t: 'space' };

const def = (term: string, text: string): CguBlock => ({ t: 'def', term, text });
const p = (text: string): CguBlock => ({ t: 'p', text });
const bullet = (text: string): CguBlock => ({ t: 'bullet', text });
const sub = (text: string): CguBlock => ({ t: 'sub', text });
const label = (text: string): CguBlock => ({ t: 'label', text });
const article = (text: string): CguBlock => ({ t: 'article', text });
const space: CguBlock = { t: 'space' };

// ============================================================================
// CONTENU — transcription fidèle des deux pages annexées
// ============================================================================
export const CGU_BLOCKS: CguBlock[] = [
  { t: 'label', text: 'DÉFINITIONS' },
  def('ACCEPTEUR / MARCHANDS ACCEPTEURS', "désigne le Commerçant fournisseur de biens et de services acceptant la monnaie électronique comme moyen de paiement."),
  def('ANNEXES', "documents distincts, faisant partie intégrante des présentes conditions (dont la brochure tarifaire)."),
  def('AGENCE MTN Mobile Money Bénin', "désigne tout point de vente ou agence exploitée à titre personnel par MTN Mobile Money Bénin."),
  def('BCEAO', "désigne la Banque Centrale des États de l'Afrique de l'Ouest."),
  def('COMPTE MOBILE MONEY', "désigne le porte-monnaie électronique ouvert au nom du Porteur (tel que défini ci-après) dans les livres de l'EE, directement rattaché au numéro de téléphone mobile du Porteur."),
  def('CONTESTATION, RÉCLAMATION', "désigne toutes procédures de plainte du Porteur à l'endroit de l'EE ou de son réseau de distribution, autre que l'opposition."),
  def('DÉTENTEUR NON IDENTIFIÉ (non abonné)', "désigne un utilisateur des services Mobile Money n'ayant pas ouvert de compte auprès de MTN MOBILE MONEY BÉNIN."),
  def('DISTRIBUTEURS PRINCIPAUX', "tout commerçant personne physique ou morale, fournisseur de biens et services, agréé par l'établissement de monnaie électronique pour encaisser les dépôts et effectuer les retraits des PORTEURS et/ou acceptant la monnaie électronique comme moyen de paiement, sous la responsabilité de l'EE."),
  def('PORTEUR / BÉNÉFICIAIRE', "abonné MTN MOBILE MONEY, détenteur d'un COMPTE MOBILE MONEY en vertu du contrat de souscription aux services MTN Mobile Money, avec l'EE, le DP ou le SD."),
  { t: 'def', term: 'MONNAIE ÉLECTRONIQUE', text: "valeur monétaire représentant la créance sur l'émetteur, qui est :" },
  bullet("stockée sur un support électronique (téléphone portable) ;"),
  bullet("émise contre remise d'espèces d'un montant dont la valeur n'est pas inférieure à la valeur monétaire émise ;"),
  bullet("acceptée comme moyen de paiement par des personnes physiques ou personnes morales autres que l'établissement émetteur."),
  def('MTN MOBILE MONEY BÉNIN', "désigne l'Établissement de monnaie électronique, habilitée par la BCEAO à émettre et à distribuer la monnaie électronique, débiteur de la créance incorporée dans l'instrument de monnaie électronique, titulaire de l'offre de services Mobile Money telle que ci-après définie."),
  def('SERVICES MOBILE MONEY', "désigne les services d'émission, de distribution, de chargement, de rechargement, d'encaissement et d'opérations de monnaie électronique de MTN MOBILE MONEY BÉNIN."),
  def('RÉSEAU DE DISTRIBUTION MTN MOBILE MONEY BÉNIN', "désigne le réseau de distribution des services MTN MOBILE MONEY BÉNIN constitué des agences ou points de vente propres MOBILE MONEY BÉNIN, des distributeurs principaux agréés par MOBILE MONEY BÉNIN (dont la liste actualisée est affichée dans toutes les agences) ainsi que des sous-distributeurs, mandataires des Distributeurs principaux (dont la liste actualisée est également affichée)."),
  def('SPACETEL-BÉNIN S.A.', "opérateur de téléphonie mobile. Partenaire technique et distributeur de monnaie électronique ; offrant à la clientèle MTN MOBILE MONEY BÉNIN un service de chargement, de rechargement ou d'encaissement de monnaie électronique."),
  space,

  article("ARTICLE 1 — Services MTN Mobile Money"),
  p("MTN MOBILE MONEY est un ensemble de services innovants permettant, à l'échelle nationale, régionale et internationale (si applicable), d'effectuer des transactions financières relativement simples à partir du téléphone mobile et d'Internet."),
  p("Le PORTEUR n'est pas tenu de disposer d'un compte bancaire."),
  p("Les usages possibles des unités de monnaie électronique MTN MOBILE MONEY sont actuellement :"),
  bullet("le transfert d'argent (de compte à compte, de compte à cash, de cash à cash) ;"),
  bullet("l'alimentation du compte MOBILE MONEY du PORTEUR par achat de monnaie électronique auprès de l'établissement émetteur ou de son réseau de distribution ;"),
  bullet("l'encaissement de monnaie en espèce auprès de ces mêmes personnes ;"),
  bullet("l'encaissement de monnaie espèce ou électronique auprès d'une entreprise financière, spécialisée dans le transfert d'argent ;"),
  bullet("le paiement de factures ;"),
  bullet("l'achat de biens et services ;"),
  bullet("les inscriptions dans les universités, grandes écoles, écoles primaires, lycées et collèges agréés ;"),
  bullet("l'achat de minutes de communication."),
  p("Cette liste n'est pas limitative et pourra être actualisée en fonction de l'évolution technologique et/ou législative."),
  space,

  article("ARTICLE 2 — Conditions de souscription et d'utilisation des services MTN MM par le Porteur / Bénéficiaire"),
  sub("2.1 Conditions de souscription aux services"),
  bullet("Ouverture d'un compte de monnaie électronique sur présentation d'un document officiel en cours de validité (copie conservée par l'établissement Émetteur)."),
  bullet("Être âgé de 18 ans révolus. À défaut, présenter l'autorisation expresse d'un parent ou tuteur détenteur d'un document officiel en cours de validité (copie conservée par l'établissement Émetteur)."),
  bullet("Avoir signé les présentes conditions d'utilisation qui régissent les relations contractuelles entre l'abonné et l'établissement émetteur, MTN MOBILE MONEY ou avec son réseau de distribution."),
  bullet("Détenir une ligne téléphonique en cours de validité auprès de l'opérateur de téléphonie mobile Spacetel-Bénin SA, en mode prépayé ou post-payé — la quittance doit obligatoirement être au nom du Porteur/Bénéficiaire ; sinon, procéder à une déclaration sur l'honneur."),
  sub("2.2 Conditions d'utilisation des services MTN MM"),
  p("NB : les tarifications (frais et commissions) liées à l'utilisation des services font l'objet d'un document distinct, faisant partie intégrante des présentes (cf. article 8)."),
  label("Alimentation du porte-monnaie électronique"),
  p("L'alimentation du porte-monnaie électronique du PORTEUR se fait contre remise de monnaie en espèces auprès du réseau de distribution de l'EE. Le compte électronique est alors crédité du même montant."),
  label("Transfert d'argent"),
  sub("De compte à compte"),
  p("Il s'agit du transfert d'argent d'un abonné MTN MOBILE MONEY vers un autre abonné MTN MOBILE MONEY ou vers un abonné d'un autre établissement émetteur de monnaie électronique (si applicable)."),
  sub("De compte à cash"),
  p("Il s'agit du transfert d'argent d'un abonné MTN MOBILE MONEY vers un non-abonné MTN MOBILE MONEY. Le non-abonné devra alors se rendre auprès de l'établissement émetteur ou de son réseau de distribution, ou d'une agence d'un autre EE ou d'un autre émetteur de monnaie électronique, muni d'une pièce d'identité en cours de validité, pour le retrait des fonds en espèce."),
  sub("De cash à cash"),
  p("Il s'agit du transfert d'argent d'un non-abonné MTN MOBILE MONEY vers un non-abonné MTN MOBILE MONEY. Le transfert cash à cash nécessite, tant pour l'émetteur que pour le bénéficiaire, de se rendre auprès de l'établissement émetteur ou de son réseau de distribution pour le retrait des fonds en espèce."),
  label("L'encaissement d'argent en espèces"),
  p("Le PORTEUR MTN MOBILE MONEY pourra, à sa guise, encaisser l'équivalent en espèce de la monnaie électronique qu'il détient sur son compte en se rendant auprès de l'établissement émetteur, du Distributeur ou des sous-distributeurs MTN MOBILE MONEY."),
  label("Le paiement de facture"),
  p("Cette transaction permettra au PORTEUR MTN MOBILE MONEY d'effectuer le paiement de ses factures, depuis son portable ou via Internet, auprès des personnes morales dont il est débiteur et qui sont agréées par l'émetteur de monnaie électronique, ou de régler ses achats en ligne sur tous sites de son choix autorisant le paiement via Mobile Money (si applicable)."),
  label("L'achat de minutes de communication"),
  p("Le PORTEUR MTN MOBILE MONEY pourra procéder, via son portable ou Internet, à l'achat de minutes de communication auprès de l'opérateur de téléphonie SPACETEL-BÉNIN ou de tout autre opérateur de téléphonie mobile (si applicable). Les transactions effectuées via Mobile Money sont exécutées dans les limites du solde de monnaie électronique disponible sur le porte-monnaie électronique du client."),
  p("Un centre d'écoute (dénommé « Centre d'Appel ») est mis en place par l'EE. Il est accessible 24h/24, 7 jours sur 7, au numéro de téléphone dédié. Le Centre d'Appel est destiné notamment à communiquer aux Porteurs et Accepteurs tous renseignements utiles sur le service MOBILE MONEY, et à recevoir et traiter leurs oppositions et réclamations."),
  sub("2.3 Code secret personnel"),
  p("Le PORTEUR saisira sur son mobile, le jour de l'ouverture de son compte, un CODE SECRET PERSONNEL à cinq (5) caractères numériques qu'il aura lui-même défini."),
  p("Le PORTEUR est seul responsable de la sécurité et de la confidentialité de son code personnel."),
  p("Ce code est indispensable pour activer les services MTN MOBILE MONEY, conçus de façon qu'aucune opération ne puisse être effectuée sans mise en œuvre de ce code secret. Il garantit à l'EE et à son réseau de Distribution que le PORTEUR est l'auteur des ordres transmis au service MTN MOBILE MONEY à partir de son téléphone portable. Les transferts d'argent et les paiements faits au moyen du téléphone du PORTEUR et confirmés par son code secret sont irrévocables."),
  p("Le nombre d'essais successifs de composition du code secret est limité à trois (03). Après le troisième essai infructueux, le PORTEUR — sans que la responsabilité de l'Établissement Émetteur ou de son réseau de Distribution puisse être engagée — verra son code invalidé."),
  p("Dans ce cas, s'il souhaite continuer à bénéficier des services MTN Mobile Money, il devra alors appeler le service client ou se rendre en agence où, après authentification de ses données, il pourra réinitialiser son code PIN."),
  sub("2.4 Plafonds appliqués aux transactions"),
  p("Les transactions effectuées via Mobile Money sont exécutées dans le respect de la réglementation bancaire en vigueur, comme suit :"),
  label("Limitation dans le chargement du porte-monnaie électronique"),
  p("Le montant plafond de rechargement du porte-monnaie électronique du PORTEUR est fixé à 2 millions FCFA par mois. Lorsqu'un PORTEUR possède plusieurs instruments de monnaie électronique MTN MOBILE MONEY BÉNIN, le solde cumulé de l'ensemble de ces instruments ne doit pas excéder la somme de deux millions (2 000 000) FCFA par mois."),
  label("Limitation dans les transferts d'argent en espèces"),
  p("Le montant maximum pour une opération de transfert est fixé à 2 millions FCFA."),
  label("Limitation des avoirs en monnaie électronique pour un Détenteur non identifié"),
  p("Le montant maximum des avoirs en monnaie électronique pour un Détenteur Non-Identifié est fixé à deux cent mille (200 000) francs CFA par mois. Les différents plafonds susmentionnés pourront être relevés sur autorisation expresse de la BCEAO, ou faire l'objet de modifications en cas de changement de la réglementation applicable. En cas de modification de plafond par la BCEAO, le PORTEUR sera tenu informé par tout moyen, notamment par voie de SMS, et le nouveau montant maximum lui sera appliqué d'office."),
  space,

  article("ARTICLE 3 — Obligations des parties dans l'exécution des transactions"),
  sub("3.1 Obligations de l'établissement émetteur"),
  label("Disponibilité des services"),
  p("Les services MTN MOBILE MONEY sont disponibles aux jours et heures d'ouverture des agences de l'établissement Émetteur, des distributeurs et sous-distributeurs, sous réserve de réalisation d'opérations d'actualisation, de sauvegarde ou de maintenance, ou en raison de défaillance des réseaux de télécommunication utilisés."),
  p("Dans ces cas, l'établissement émetteur ou les Distributeurs en informeront le PORTEUR par message SMS, sauf en cas de défaillance du réseau téléphonique empêchant toute communication."),
  p("D'une manière générale, le PORTEUR reconnaît que la disponibilité des Services ne saurait s'entendre de manière absolue, et que des défaillances, retards ou défauts de performance peuvent intervenir indépendamment de la volonté de l'Établissement émetteur ou des Distributeurs partenaires, compte tenu de la structure du réseau Internet ou GSM et des spécificités liées au Service MTN MOBILE MONEY."),
  label("Production d'un reçu électronique de la transaction"),
  p("Toutes les transactions effectuées par le client donneront lieu à la production d'un reçu électronique. Les Parties conviennent que, pour la validation des ordres de transfert de fonds, de retrait d'espèces ou de paiement de factures, des données et informations pourront être échangées à partir d'un support électronique ou d'un téléphone portable, ou de téléphonie mobile (SMS), sans avoir recours à l'utilisation du support papier. Les Parties acceptent de ne pas contester le contenu, la fiabilité, l'intégrité ou la valeur probante des données et informations contenues dans tout document électronique (notamment courrier électronique ou SMS) au seul motif que ce document est établi sur un support électronique et transmis par voie électronique ou par réseau de téléphonie mobile."),
  p("Le reçu électronique devra préciser :"),
  bullet("le numéro de référence de la transaction ;"),
  bullet("la nature du service ;"),
  bullet("le nom de l'émetteur de monnaie électronique ;"),
  bullet("le numéro d'immatriculation du Distributeur Agréé ou du sous-distributeur, le cas échéant ;"),
  bullet("l'identité de l'expéditeur ou du récepteur de la transaction, selon le cas ;"),
  bullet("l'heure, le montant et les frais de la transaction."),
  label("Obligation d'archivage"),
  p("Les Parties conviennent que les communications par lesquelles une transaction est dénouée constituent les preuves de la passation de ces ordres. À cet égard, l'Établissement Émetteur procédera à un archivage et à un enregistrement de toutes données et informations relatives aux transactions, sur un support fiable, pendant une durée de dix (10) ans à compter de la date de la transaction."),
  sub("3.2 Obligations du Porteur / Bénéficiaire"),
  p("Il doit communiquer à l'EE les informations sur sa ou ses sources de revenu, le motif de ses transactions et toutes autres informations jugées nécessaires par l'EE ou ses partenaires dans le cadre du présent contrat."),
  p("Il doit s'assurer de la validité de la période de son crédit de communication téléphonique. Aucune transaction ni utilisation des services ne sera possible pour le Porteur/Bénéficiaire au-delà de la période de validité de son crédit de communication téléphonique."),
  p("Il doit s'assurer de la disponibilité de provision dans son porte-monnaie électronique. Les transactions effectuées via MTN Mobile Money sont exécutées dans les limites du crédit disponible dans le porte-monnaie électronique support de l'opération. À défaut, la transaction ne sera pas validée."),
  p("Il doit s'assurer de la saisie correcte des données de toutes transactions qu'il effectue. En tout état de cause, il demeure responsable des transactions qu'il a lui-même validées."),
  p("Il doit s'assurer de ne communiquer son code secret à personne. Il s'engage à garder secret son code personnel et à ne le communiquer à qui que ce soit. Le PORTEUR prendra donc toutes les mesures nécessaires pour assurer la sécurité de son code personnel. Il doit veiller à ne pas l'enregistrer dans la mémoire de son téléphone portable, et s'engage à détruire les messages dans lesquels figurerait son code secret."),
  space,

  article("ARTICLE 4 — Procédures d'opposition et de contestation / réclamations"),
  sub("4.1 Procédure et délais d'opposition"),
  p("L'ordre de payer donné à un Accepteur au moyen de MTN MOBILE MONEY est irrévocable dès confirmation du code secret."),
  p("Il ne peut, en conséquence, être fait opposition qu'en cas :"),
  bullet("de perte, de vol ou d'utilisation frauduleuse du porte-monnaie électronique ayant pour support le téléphone mobile, UNIQUEMENT pour bloquer des paiements ultérieurs à l'opposition ;"),
  bullet("de transfert erroné, à condition que la somme transférée par erreur figure encore au crédit du Compte Mobile Money du titulaire du numéro erroné."),
  p("L'opposition peut être faite par appel téléphonique ou par écrit."),
  p("L'opposition par appel téléphonique se fait au service client, joignable 24h/24, 7 jours sur 7. Pour être valable et prise en compte définitivement, cette opposition doit être confirmée par écrit par le PORTEUR, muni de toutes pièces justificatives (CNI, déclaration de perte ou de vol aux autorités policières), dans les vingt-quatre (24) heures ouvrées qui suivent la demande d'opposition."),
  p("Suite à l'opposition téléphonique, le service clients de l'EE se chargera de bloquer le compte Mobile Money instantanément, pendant 24h, dans l'attente de la fourniture des pièces justificatives. À défaut, le compte Mobile Money sera débloqué."),
  p("L'opposition par écrit se fait pendant les horaires d'ouverture, dans tout Centre Service de l'Établissement Émetteur ou dans n'importe laquelle des agences de son réseau de distribution."),
  p("Le délai de traitement de la demande d'opposition est de 24 heures, à condition que tous les justificatifs d'authentification du client soient réunis."),
  p("L'EE ne pourra être tenue responsable en cas d'opposition formulée après que la somme transférée ou payée par erreur ne figure plus au crédit du Compte Mobile Money du Bénéficiaire."),
  sub("4.2 Procédure et délais de contestation / réclamation"),
  p("Le PORTEUR peut faire des réclamations par appel téléphonique en appelant le service client, pendant les horaires d'ouverture, ou oralement dans les agences de l'établissement Émetteur ou auprès des distributeurs."),
  p("La prise en charge de la réclamation faite au téléphone sera soumise à une procédure d'authentification du client. Le client n'ayant pas réussi cette authentification sera tenu de se rendre dans une agence de l'établissement Émetteur ou auprès des distributeurs."),
  p("Le délai de traitement de la réclamation varie en fonction de sa nature. Toutefois, le délai moyen est fixé à trois (3) jours ouvrés. Les réclamations relatives aux transactions ne seront prises en compte que lorsqu'elles sont faites dans un délai de deux (2) ans maximum à compter de la date de l'opération contestée."),
  p("Toute réclamation justifiée ouvre droit à régularisation dans les limites du montant de la transaction objet de la réclamation."),
  space,

  article("ARTICLE 5 — Conditions et modalités de remboursement et de compensation"),
  sub("5.1 Condition de remboursement"),
  p("Durant l'exécution des présentes CGU, et à l'exception des cas de force majeure (cf. art. 6.2), le PORTEUR pourra demander le remboursement des unités de monnaie électronique non utilisées. La demande pourra être faite par courrier écrit, adressé à l'établissement émetteur — Direction Générale, Carré 10, Avenue Steinmetz, 01 BP 5293 Cotonou."),
  p("La demande de remboursement devra porter sur une somme supérieure ou égale à mille (1 000) FCFA."),
  sub("5.2 Délai de remboursement"),
  p("Le remboursement sera effectué sans frais et à la valeur nominale. Le PORTEUR devra se rendre, pour se le faire remettre, auprès de toute agence où il pourra percevoir les sommes qui lui reviennent, dans un délai de trois (3) jours ouvrés."),
  sub("5.3 Compensations"),
  p("Les opérations effectuées par le réseau des Distributeurs et agents de l'EE avec les réseaux d'autres Établissements de Monnaie Électronique feront l'objet de compensation, en vertu des dispositions de la Décision N° 31 du 29/09/2015/CM/UMOA relative à la compensation et au règlement des opérations monétiques réalisées dans l'Union Monétaire Ouest Africaine (UMOA)."),
  space,

  article("ARTICLE 6 — Responsabilités des parties"),
  sub("6.1 Responsabilités du PORTEUR"),
  p("Le PORTEUR reconnaît être seul responsable des préjudices financiers ou autres qui pourraient être causés par l'utilisation abusive ou frauduleuse de son téléphone portable et de son code secret personnel."),
  p("Le PORTEUR est seul responsable des conséquences résultant d'un défaut de sécurité (matériel ou logiciel) de l'état du terminal de connexion (ordinateur, téléphone mobile) qu'il utilise. Il reconnaît être seul responsable du préjudice financier subi en cas d'erreur commise par lui dans la transmission des coordonnées du Bénéficiaire d'un Transfert de fonds. Dans le cadre du Service MTN MOBILE MONEY, l'établissement émetteur ne dispose d'aucun moyen pour vérifier que l'identité du Bénéficiaire désigné correspond bien à la personne à laquelle l'Abonné souhaite transférer des fonds."),
  p("Le PORTEUR reconnaît que tout ordre de Transfert de fonds passé à partir de son téléphone portable, authentifié au moyen de son code secret personnel, est réputé avoir été effectué par lui, sauf opposition formulée conformément à l'article 4 des présentes."),
  p("Le PORTEUR doit, préalablement à chaque transaction, s'assurer de l'existence sur son COMPTE MOBILE MONEY de la provision suffisante et disponible, en composant le code USSD à cet effet (*400#) puis en suivant les instructions. Ce code est susceptible de modification en fonction des évolutions technologiques ; l'EE s'engage à en informer le Porteur par SMS."),
  p("Le PORTEUR supportera seul les éventuels préjudices résultant d'ordres de transferts de fonds passés à partir de son téléphone portable et au moyen de son code, lorsqu'aucune opposition n'aura été enregistrée suite à la perte, au vol ou à l'utilisation frauduleuse du téléphone mobile support du porte-monnaie électronique, et dont l'opposition téléphonique n'aura pas été confirmée par écrit."),
  sub("6.2 Responsabilités de l'établissement émetteur"),
  p("L'EE est responsable, vis-à-vis du Porteur, de l'intégrité, de la fiabilité, de la sécurité, de la confidentialité et de la traçabilité des transactions effectuées par ses soins ou dans son réseau de distribution."),
  p("L'Établissement Émetteur (EE) n'assume aucune responsabilité lorsque l'inexécution de ses obligations résulte d'un cas de force majeure, notamment en cas d'interruption du Service liée à des problèmes de transport des informations."),
  p("L'EE n'est pas responsable des conséquences résultant d'un défaut de sécurité (matériel ou logiciel) de l'état du terminal de connexion (ordinateur, téléphone mobile) utilisé par le PORTEUR."),
  p("L'EE n'est pas responsable des éventuels litiges, plaintes, contestations et autres différends qui pourraient survenir entre le PORTEUR et les bénéficiaires de ses transferts de fonds, ou entre le PORTEUR et son opérateur de téléphonie mobile."),
  p("L'EE sera tenue responsable des pertes directes encourues par le PORTEUR dues au mauvais fonctionnement du système de paiement sur lequel elle a un contrôle direct et total."),
  p("Toutefois, l'EE ne sera pas tenue responsable des pertes dues à une panne technique du système de paiement si celle-ci a été signalée au PORTEUR par un message sur son téléphone portable, ou par tout autre moyen visible ou audible. L'EE n'est pas non plus responsable des éventuels litiges, plaintes, contestations et autres différends qui pourraient survenir entre le PORTEUR et les bénéficiaires de ses transferts de fonds, ou entre le PORTEUR et son opérateur de télécommunications."),
  p("L'EE ne sera pas tenue responsable des pertes dues à une fraude sur son réseau. La responsabilité de l'EE, suite à l'exécution erronée d'une opération, sera limitée au montant principal de la transaction. Cette responsabilité sera partagée lorsque le PORTEUR aura contribué de quelque manière que ce soit à l'erreur."),
  sub("6.3 Cas fortuit et force majeure"),
  p("L'EE ou ses distributeurs ne pourront être tenus pour responsables de tout cas fortuit ou de force majeure, indépendant de leur volonté, rendant impossible l'exécution de leurs obligations, soit partiellement, soit en totalité, dont ils n'auront pu, malgré leurs diligences, empêcher la survenance."),
  p("La force majeure, entendue dans les présentes, est celle habituellement qualifiée par les tribunaux, tel, à titre d'exemple, le dysfonctionnement ou l'interruption totale ou partielle des réseaux de communication tels qu'Internet ou le GSM. La grève de tout ou partie du personnel de l'EE, ou de l'un de ses partenaires techniques indépendants, est assimilée à un cas de force majeure."),
  p("Les cas de force majeure suspendront l'exécution des présentes Conditions Générales. En conséquence, les Services MTN MOBILE MONEY seront suspendus."),
  p("Si la durée de la force majeure entraîne la suspension du Service MTN MOBILE MONEY pendant une période supérieure à trois mois, les présentes Conditions Générales seront résiliées de plein droit, sans indemnité aucune, et le PORTEUR pourra obtenir le remboursement des fonds non utilisés conformément à l'article 5 des présentes."),
  space,

  article("ARTICLE 7 — Protection des données personnelles, confidentialité, communication de renseignements à des tiers"),
  p("L'Établissement émetteur, ainsi que tous fournisseurs de biens et services intervenant dans l'exécution des services MTN Mobile Money, prennent les mesures propres à assurer la protection et la confidentialité des données à caractère personnel qu'ils détiennent ou traitent, dans le strict respect des dispositions de la loi n° 2009-09 du 22 mai 2009 relative à la protection des données à caractère personnel en République du Bénin."),
  p("L'Établissement émetteur pourra, à tout moment et sans préavis, SUSPENDRE le service MTN MOBILE MONEY en cas de risque supposé ou avéré sur la confidentialité des Services."),
  p("Les Parties conviennent que les informations échangées entre elles dans le cadre du service MTN MOBILE MONEY, et nécessaires à l'exécution de leurs obligations réciproques, sont confidentielles, à l'exception de l'obligation de communication d'information provenant des autorités administratives et judiciaires habilitées."),
  p("Les informations recueillies dans le cadre de l'exécution du service MOBILE MONEY feront l'objet d'un traitement informatique. Elles seront utilisées par l'EE, son réseau de distribution et ses partenaires pour l'exécution des services."),
  p("Le PORTEUR autorise la communication des informations le concernant à tout fournisseur de biens et services dans le cadre de l'exécution des services MTN MOBILE MONEY (Distributeurs / Sous-distributeurs / Accepteurs / Banque domiciliataire / partenaires techniques)."),
  p("En utilisant les services MOBILE MONEY, le PORTEUR accepte, d'une part, le traitement des données à caractère personnel collectées à la souscription et, d'autre part, la réception gratuite des offres commerciales de l'EE."),
  p("Le PORTEUR dispose d'un droit d'opposition et de rectification de toutes données personnelles le concernant."),
  space,

  article("ARTICLE 8 — Tarification"),
  p("Les conditions financières des services MTN MOBILE MONEY sont mentionnées dans la brochure tarifaire remise au PORTEUR/BÉNÉFICIAIRE à la signature des présentes. Cette brochure fait partie intégrante des présentes."),
  p("Elle est également affichée dans toutes les agences de l'Établissement Émetteur, ainsi que chez tous les fournisseurs de biens et services partenaires de l'EE intervenant dans l'exécution des services MTN MOBILE MONEY. L'EE s'engage à informer prioritairement le Porteur et à le faire bénéficier de toutes remises ou opérations promotionnelles qui pourraient conduire, sur une période déterminée, à pratiquer des tarifs plus avantageux, et ce pour la seule durée de cette période."),
  space,

  article("ARTICLE 9 — Sanctions"),
  p("Tout usage abusif ou frauduleux du service MTN MOBILE MONEY expose le PORTEUR aux poursuites civiles et pénales prévues par la législation en vigueur, et entraîne la résiliation immédiate des présentes, sans préavis."),
  space,

  article("ARTICLE 10 — Modifications du contrat"),
  p("Il est expressément convenu entre les parties que l'EE se réserve le droit de modifier, à tout moment et pour des raisons notamment techniques, financières et/ou de sécurité, les conditions d'exécution des Services MOBILE MONEY, y compris les modalités de réalisation des Transferts de fonds. Le Porteur sera tenu informé par message SMS."),
  space,

  article("ARTICLE 11 — Entrée en vigueur, durée"),
  p("Les présentes conditions générales, accompagnées de la fiche de souscription, tiennent lieu de contrat entre les parties."),
  p("Elles sont conclues pour une durée indéterminée et entrent en vigueur à compter de l'ouverture du compte Mobile Money et de la signature de la fiche de souscription qui l'accompagne."),
  space,

  article("ARTICLE 12 — Résiliation"),
  p("Les présentes CGU peuvent être résiliées soit du fait de l'Établissement Émetteur, soit du fait du PORTEUR."),
  sub("Résiliation du fait de l'Établissement Émetteur"),
  p("Tout manquement du PORTEUR à l'une des obligations mises à sa charge dans le cadre des présentes conditions générales entraînera, à la seule discrétion de l'EE, la rupture immédiate et de plein droit du contrat, sans aucune indemnité. L'Établissement Émetteur se réserve tout droit de poursuite conformément à l'article 9 des présentes."),
  sub("Résiliation du fait du PORTEUR"),
  p("À tout moment, sous réserve d'un préavis de trente (30) jours notifié expressément par lettre contre décharge, le PORTEUR pourra mettre fin aux présentes CGU. Le délai de préavis court à compter de la date de réception de la lettre de notification."),
  p("La monnaie électronique non utilisée détenue par le PORTEUR fera l'objet d'un remboursement par la Banque, à sa valeur nominale, sans frais, dans un délai maximum de 72h. Ce remboursement ne sera accordé que pour les crédits supérieurs à 1 000 FCFA."),
  p("Le contrat sera également résilié en cas de décès du PORTEUR. Dans ce cas, tout solde de monnaie électronique du défunt sera mis à la disposition des héritiers, dans le respect de la législation en vigueur."),
  space,

  article("ARTICLE 13 — Impôts et frais"),
  p("Les Parties conviennent que tous impôts et taxes auxquels les transactions opérées dans le cadre des services MTN MOBILE MONEY donneront lieu sont à la charge du PORTEUR."),
  space,

  article("ARTICLE 14 — Attribution de juridiction, loi applicable, règlement des litiges"),
  p("Les présentes conditions générales sont soumises au droit béninois. Les parties conviennent que tout litige concernant leur interprétation ou leur exécution, qui ne serait pas résolu à l'amiable dans un délai de quinze (15) jours, sera soumis au Tribunal de première instance de Cotonou."),
];

// Icône MTN Mobile Money extraite pixel pour pixel du document source
// (registration_information.pdf, pages CGU) — même logo, même style que
// l'original, plutôt qu'une reconstitution vectorielle approximative.
// Exportée : réutilisée telle quelle par formulaireEnregistrement.ts (page 1)
// pour garantir EXACTEMENT le même logo sur toutes les pages du document,
// sans dupliquer ce blob de 56 Ko.
export const MTN_MOMO_ICON_B64 =
  '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';

// Logo carre MTN (fond jaune, ovale bleu MTN) extrait pixel pour pixel du
// bas des pages du document source (registration_information.pdf) --
// utilise en pied de page 1 du formulaire, en plus de la petite icone
// Mobile Money deja presente en haut, pour reproduire fidelement le meme
// habillage logo << haut + bas >> que l'original.
export const MTN_LOGO_SQUARE_B64 =
  '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' +
  'FMAn/ugAAAAASUVORK5CYII=';

// ============================================================================
// MOTEUR DE RENDU — 4 colonnes serrées, pagination automatique,
// en-tête fidèle à l'original (boîte encadrée + grand titre + logo exact)
// ============================================================================
export interface CguRenderResult {
  /** Index (0-based, dans doc.bufferedPageRange()) de la première page CGU ajoutée. */
  startPageIndex: number;
  /** Nombre de pages ajoutées pour les CGU. */
  pageCount: number;
}

export function renderConditionsGenerales(doc: PDFDoc): CguRenderResult {
  const pageW = doc.page.width;
  const pageH = doc.page.height;
  const MARGIN = 28;
  const GUTTER = 9;
  const COLUMNS = 4;
  const colW = (pageW - 2 * MARGIN - (COLUMNS - 1) * GUTTER) / COLUMNS;

  // Icône exacte extraite du document source (voir MTN_MOMO_ICON_B64 ci-dessus)
  const iconBuffer = Buffer.from(MTN_MOMO_ICON_B64, 'base64');

  // ── En-tête fidèle à l'original : boîte encadrée (titre + sous-titre +
  // logo, flush à droite) puis grand titre centré en dessous. Reproduit sur
  // chaque page CGU, exactement comme dans le document source.
  const BOX_TOP = 26;
  const BOX_H = 52;
  const BIG_TITLE_Y = BOX_TOP + BOX_H + 14;
  const CONTENT_TOP = BIG_TITLE_Y + 34;
  const BOTTOM_LIMIT = pageH - 46; // marge de sécurité (voir note plus bas)

  const startPageIndex = doc.bufferedPageRange().start + doc.bufferedPageRange().count;

  let col = 0;
  let x = MARGIN;
  let y = CONTENT_TOP;

  const drawHeader = () => {
    // Boîte encadrée (fond blanc, liseré noir fin) — titre + sous-titre
    doc.lineWidth(1).strokeColor('#000000')
      .rect(MARGIN, BOX_TOP, pageW - 2 * MARGIN, BOX_H).stroke();
    doc.fillColor('#000000').font('Helvetica').fontSize(15)
      .text('CONDITIONS GÉNÉRALES D’ABONNEMENT', MARGIN + 14, BOX_TOP + 10, {
        width: pageW - 2 * MARGIN - BOX_H - 28, align: 'left', characterSpacing: 0.4,
      });
    doc.font('Helvetica').fontSize(8).fillColor('#000000')
      .text('(FONCTIONNEMENT DES SERVICES MTN MOBILE MONEY BÉNIN)', MARGIN + 14, BOX_TOP + 32, {
        width: pageW - 2 * MARGIN - BOX_H - 28, align: 'left', characterSpacing: 0.2,
      });
    // Logo exact, flush contre le bord droit de la boîte (comme l'original)
    const iconSize = BOX_H;
    const iconX = MARGIN + (pageW - 2 * MARGIN) - iconSize;
    doc.image(iconBuffer, iconX, BOX_TOP, { width: iconSize, height: iconSize });

    // Grand titre centré (police condensée simulée via letter-spacing négatif)
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(20)
      .text('CONDITIONS GÉNÉRALES D’ABONNEMENT', MARGIN, BIG_TITLE_Y, {
        width: pageW - 2 * MARGIN, align: 'center', characterSpacing: -0.3,
      });
    doc.font('Helvetica').fontSize(9).fillColor('#000000')
      .text('(FONCTIONNEMENT DES SERVICES MTN MOBILE MONEY BÉNIN)', MARGIN, BIG_TITLE_Y + 24, {
        width: pageW - 2 * MARGIN, align: 'center',
      });
  };

  const drawFooter = () => {
    doc.font('Helvetica').fontSize(6.5).fillColor(INK_MUTED).text(
      'Conditions générales d’abonnement MTN Mobile Money Bénin — document contractuel annexé à la fiche dossier.',
      MARGIN, pageH - 30, { width: pageW - 2 * MARGIN, align: 'center' }
    );
  };

  const newPage = () => {
    // NB : addPage(options) REMPLACE entièrement les options de page (pas de
    // merge avec les options du document) — on repasse `size` explicitement,
    // sans quoi pdfkit retombe sur 'letter' par défaut et désynchronise
    // pageW/pageH de la taille réelle de la page. La marge basse est
    // neutralisée : la pagination du document est gérée manuellement via
    // ensure()/BOTTOM_LIMIT, pas par le mécanisme d'auto-page de pdfkit
    // (sinon, tout doc.text() dépassant la marge basse standard déclenche
    // une pagination automatique silencieuse, en plus de la nôtre).
    doc.addPage({ size: 'A4', margins: { top: 28, bottom: 0, left: 28, right: 28 } });
    drawHeader();
    col = 0;
    x = MARGIN;
    y = CONTENT_TOP;
  };

  const ensure = (h: number) => {
    if (y + h > BOTTOM_LIMIT) {
      if (col < COLUMNS - 1) {
        col += 1;
        x = MARGIN + col * (colW + GUTTER);
        y = CONTENT_TOP;
      } else {
        drawFooter();
        newPage();
      }
    }
  };

  newPage();

  const F_ARTICLE = 6.6;
  const F_SUB = 6.1;
  const F_LABEL = 5.8;
  const F_BODY = 5.6;
  const GAP_P = 3;
  const GAP_HEAD = 2.2;

  for (const block of CGU_BLOCKS) {
    switch (block.t) {
      case 'space': {
        y += 4;
        break;
      }
      case 'article': {
        doc.font('Helvetica-Bold').fontSize(F_ARTICLE);
        const h = doc.heightOfString(block.text, { width: colW });
        ensure(h + GAP_HEAD + 1.5);
        doc.fillColor(INK_DARK).text(block.text, x, y, { width: colW, underline: true });
        y = doc.y + GAP_HEAD;
        break;
      }
      case 'sub': {
        doc.font('Helvetica-Bold').fontSize(F_SUB);
        const h = doc.heightOfString(block.text, { width: colW });
        ensure(h + GAP_HEAD);
        doc.fillColor(INK_DARK).text(block.text, x, y, { width: colW });
        y = doc.y + GAP_HEAD;
        break;
      }
      case 'label': {
        // U+25CF (●) n'existe pas dans WinAnsiEncoding utilisé par les
        // polices standard de pdfkit (Helvetica) → glyphe manquant à
        // l'impression. On utilise « • » (U+2022), disponible nativement.
        const text = `• ${block.text}`;
        doc.font('Helvetica-Bold').fontSize(F_LABEL);
        const h = doc.heightOfString(text, { width: colW });
        ensure(h + GAP_HEAD);
        doc.fillColor('#8A6D00').text(text, x, y, { width: colW });
        y = doc.y + GAP_HEAD;
        break;
      }
      case 'p': {
        doc.font('Helvetica').fontSize(F_BODY);
        const h = doc.heightOfString(block.text, { width: colW });
        ensure(h + GAP_P);
        doc.fillColor(INK_DARK).text(block.text, x, y, { width: colW, align: 'justify' });
        y = doc.y + GAP_P;
        break;
      }
      case 'bullet': {
        const text = `– ${block.text}`;
        doc.font('Helvetica').fontSize(F_BODY);
        const h = doc.heightOfString(text, { width: colW - 5 });
        ensure(h + 2.5);
        doc.fillColor(INK_DARK).text(text, x + 3, y, { width: colW - 3, align: 'justify' });
        y = doc.y + 2.5;
        break;
      }
      case 'def': {
        const full = `${block.term} — ${block.text}`;
        doc.font('Helvetica').fontSize(F_BODY);
        const h = doc.heightOfString(full, { width: colW });
        ensure(h + GAP_P);
        const startY = y;
        doc.font('Helvetica-Bold').fontSize(F_BODY).fillColor(INK_DARK)
          .text(`${block.term} — `, x, y, { width: colW, continued: true, align: 'justify' });
        doc.font('Helvetica').fontSize(F_BODY).fillColor(INK_DARK).text(block.text, { align: 'justify' });
        y = Math.max(doc.y, startY + h) + GAP_P;
        break;
      }
    }
  }

  drawFooter();

  const endPageIndex = doc.bufferedPageRange().start + doc.bufferedPageRange().count;
  return { startPageIndex, pageCount: endPageIndex - startPageIndex };
}