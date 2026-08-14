import { useEffect, useState, FormEvent, ReactNode } from 'react';
import { useFetch, useDebounce, todayISO, nDaysAgo } from '../../hooks';
import * as api from '../../services/api';
import { Dossier, GsmRecord } from '../../types';
import { Alert, LoadingCenter, EmptyState, StatCard, Modal } from '../../components/ui';

// ── Charte institutionnelle (MTN) — partagée par toutes les vues GSM ───────────
const MTN_BLUE = '#003087';
const MTN_GOLD = '#FFCC00';
const MTN_TEXT = '#0F172A';
const MTN_MUTED = '#64748B';

function formatGsmDateValue(value?: string | null): string {
  if (!value) return '—';
  const text = String(value).trim();
  if (!text) return '—';

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }

  const parsed = new Date(text);
  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric' });
  }

  return text;
}

function formatGsmEvolutionLabel(value?: string | null): string {
  if (!value) return '—';
  const text = String(value).trim();
  if (!text) return '—';

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})(?:[T\s].*)?$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}/${month}/${year}`;
  }

  return formatGsmDateValue(text);
}

function SectionLabel({ children, accent = MTN_BLUE }: { children: ReactNode; accent?: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 9, margin: '2px 0 4px' }}>
      <span style={{ width: 4, height: 18, borderRadius: 2, background: accent, flexShrink: 0 }} />
      <p style={{ margin: 0, fontSize: 13, fontWeight: 800, letterSpacing: '.02em', color: MTN_TEXT, textTransform: 'uppercase' }}>
        {children}
      </p>
    </div>
  );
}

const STATUT_BADGE: Record<string, { bg: string; fg: string }> = {
  accepte:    { bg: '#DCFCE7', fg: '#166534' },
  rejete:     { bg: '#FEE2E2', fg: '#991B1B' },
  en_cours:   { bg: '#FEF3C7', fg: '#92400E' },
  en_attente: { bg: '#FEF3C7', fg: '#92400E' },
};

function StatutBadge({ value }: { value?: string | null }) {
  if (!value) return <span style={{ color: MTN_MUTED }}>—</span>;
  const key = value.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/\s+/g, '_');
  const tone = STATUT_BADGE[key] ?? { bg: '#EEF2F7', fg: MTN_TEXT };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11.5, fontWeight: 700, padding: '3px 10px',
      borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap',
    }}>
      {value}
    </span>
  );
}

// Pastille neutre pour les valeurs de référentiel (constat, pièce, action, statut
// final…) dans les tableaux — évite le texte brut et donne un rendu uniforme et
// institutionnel à toutes les listes GSM du fichier.
function Chip({ value }: { value?: string | null }) {
  if (!value) return <span style={{ color: MTN_MUTED }}>—</span>;
  return (
    <span style={{
      display: 'inline-block', fontSize: 11.5, fontWeight: 600, padding: '3px 9px',
      borderRadius: 999, background: '#EEF2FF', color: MTN_BLUE, whiteSpace: 'nowrap',
      border: `1px solid ${MTN_BLUE}26`,
    }}>
      {value}
    </span>
  );
}

// Pastille « Pré-rempli » — signale qu'un champ a été rempli automatiquement à
// partir de ce que l'agent terrain (ou l'OCR) a déjà collecté à l'acquisition,
// pour que l'agent GSM sache d'un coup d'œil ce qu'il peut vérifier plutôt que
// ressaisir. Le champ reste toujours modifiable ; la pastille disparaît dès
// qu'il est touché (voir `chg`).
function AutoTag() {
  return (
    <span style={{
      marginLeft: 8, fontSize: 10, fontWeight: 700, color: MTN_BLUE,
      background: '#EEF2FF', border: `1px solid ${MTN_BLUE}26`,
      borderRadius: 999, padding: '1px 7px', textTransform: 'uppercase',
      letterSpacing: '.02em', verticalAlign: 'middle', display: 'inline-block',
    }}>
      Pré-rempli
    </span>
  );
}

// Fait correspondre une valeur déjà collectée (ex: le type de pièce lu à
// l'acquisition, parfois via OCR — voir ocr.ts) à une option existante du
// référentiel GSM, insensible à la casse et aux accents. Si rien ne matche,
// on ne force rien : le champ Sel ci-dessous retombe alors en saisie libre
// avec la valeur brute, que l'agent peut corriger si elle n'est pas la bonne.
function matchReferentiel(opts: string[] | undefined, raw: string | null | undefined): string | undefined {
  if (!opts?.length || !raw) return undefined;
  const norm = (s: string) => s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').trim();
  const target = norm(raw);
  return opts.find(o => norm(o) === target);
}

// ── Détail d'une saisie GSM (recap) ─────────────────────────────────────────────
// Vue partagée par « Mes saisies d'aujourd'hui » et « Mon historique GSM » afin que
// le recap d'une saisie ait toujours le même rendu propre, complet (tous les champs,
// pas seulement les colonnes visibles dans le tableau) et institutionnel.
const GSM_DETAIL_FIELDS: [string, keyof GsmRecord][] = [
  ['Numéro',            'numero'],
  ['Date de saisie',    'date_saisie'],
  ['Coach',             'coach'],
  ['Type ID',           'type_id'],
  ['Pièce',             'piece'],
  ['Constat',           'constat'],
  ['Verbatim',          'verbatim'],
  ['Action',            'action'],
  ['Statut final',      'statut_final'],
  ['Traitement',        'traitement'],
  ['Raison',            'raison'],
  ['Nom client',        'nom_client'],
];

const GSM_CAPTURE_FIELDS: { key: 'capture_a' | 'capture_p' | 'capture_aa'; label: string }[] = [
  { key: 'capture_a',  label: 'Capture écran recto CNI' },
  { key: 'capture_p',  label: 'Capture écran verso CNI' },
  { key: 'capture_aa', label: 'Capture écran pièce complémentaire' },
];

function GsmRecordDetailModal({ record, onClose, footer }: {
  record: GsmRecord; onClose: () => void; footer?: ReactNode;
}) {
  const hasCaptures = GSM_CAPTURE_FIELDS.some(c => !!record[c.key]);
  return (
    <Modal title={`Saisie #${record.id} — ${record.numero}`} onClose={onClose} footer={footer}>
      <SectionLabel>Détails de la saisie</SectionLabel>
      <div className="detail-grid">
        {GSM_DETAIL_FIELDS.map(([label, key]) => {
          const value = record[key];
          if (!value) return null;
          const displayValue = key === 'date_saisie' ? formatGsmDateValue(String(value)) : String(value);
          return (
            <div className="detail-item" key={String(key)}>
              <span className="detail-label">{label}</span>
              <span className="detail-value">{displayValue}</span>
            </div>
          );
        })}
      </div>

      {hasCaptures && (
        <>
          <hr className="divider" />
          <SectionLabel accent={MTN_GOLD}>Captures écran complémentaires</SectionLabel>
          <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap' }}>
            {GSM_CAPTURE_FIELDS.map(c => {
              const value = record[c.key];
              if (!value) return null;
              return (
                <div key={c.key} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', width: 150 }}>
                  <img
                    src={`/api/gsm/captures/${encodeURIComponent(value)}`}
                    alt={c.label}
                    style={{ width: 150, height: 110, objectFit: 'cover', borderRadius: 10, border: '1px solid #E2E8F0' }}
                  />
                  <span style={{ fontSize: 11.5, color: MTN_MUTED, textAlign: 'center' }}>{c.label}</span>
                </div>
              );
            })}
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Mon Tableau GSM ────────────────────────────────────────────────────────────
export function GsmMonTableau() {
  const { data, loading, error, refetch } = useFetch(() => api.getGsmMonTableau(), []);
  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Mon tableau GSM</h1><p className="page-sub">Vos statistiques Gross Add en temps réel.</p></div><button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button></div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : data && (
        <>
          <div className="stats-grid">
            <StatCard label="Aujourd'hui" value={data.aujourdhui} />
            <StatCard label="7 derniers jours" value={data.sept_jours} />
            <StatCard label={`Mois de paie (${data.libelle_mois_paie})`} value={data.mois_paie} variant="accepte" />
            <StatCard label="Total cumulé" value={data.total} />
          </div>
          {data.dernieres?.length > 0 && (
            <div className="card">
              <p className="card-title">5 dernières saisies</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Numéro</th><th>Date</th><th>Constat</th><th>Statut final</th></tr></thead>
                  <tbody>
                    {data.dernieres.map(g => (
                      <tr key={g.id}>
                        <td><strong>{g.numero}</strong></td>
                        <td>{formatGsmDateValue(g.date_saisie)}</td>
                        <td><Chip value={g.constat} /></td>
                        <td><Chip value={g.statut_final} /></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Saisie GSM ─────────────────────────────────────────────────────────────────
const EMPTY_GSM = { numero:'', type_id:'', constat:'', piece:'', verbatim:'', action:'', statut_final:'', traitement:'', raison:'', nom_client:'', coach:'', date:'' };

interface GsmSaisieProps {
  dossierId?: string;
  defaultValues?: Partial<Record<keyof typeof EMPTY_GSM, string>>;
  onComplete?: () => void;
  onClose?: () => void;
  compact?: boolean;
}

// ── Rappel dossier ────────────────────────────────────────────────────────────
// Tout ce que l'agent a déjà collecté côté acquisition (identité, pièces,
// signature) est réaffiché ici en lecture seule avant qu'il ne traite le
// dossier — pas de ressaisie, pas d'import. Les champs propres à la saisie
// GSM/Gross Add (constat, verbatim, action…) restent dans le formulaire
// en dessous, inchangés.
const STATUTS_EN_ATTENTE = new Set(['en_attente', 'en_cours']);

function DossierRecap({ dossier, busy, onDecision }: {
  dossier: Dossier;
  busy: boolean;
  onDecision: (statut: 'accepte' | 'rejete', raison?: string) => void;
}) {
  const [zoom, setZoom] = useState<{ src: string; label: string } | null>(null);
  const [rejectOpen, setRejectOpen] = useState(false);
  const [raison, setRaison] = useState('');

  const nomComplet = `${dossier.nom_titulaire || ''} ${dossier.prenom_titulaire || ''}`.trim() || '—';
  const statutLabel = ({ en_attente: 'En attente', en_cours: 'En cours', accepte: 'Accepté', rejete: 'Rejeté' } as Record<string, string>)[dossier.statut] ?? dossier.statut;
  const enAttente = STATUTS_EN_ATTENTE.has(dossier.statut);

  // Nom et Prénom sont ré-affichés ici en plus du bandeau d'en-tête : le
  // bandeau tronque (ellipsis) les noms longs, et avoir les deux séparément
  // juste au-dessus de la CNI recto facilite la vérification visuelle
  // ligne-à-ligne (comme sur la pièce elle-même : NOM puis PRÉNOM).
  const champs: [string, string | null | undefined][] = [
    ['Nom',                dossier.nom_titulaire],
    ['Prénom',             dossier.prenom_titulaire],
    ['Numéro MTN',         dossier.numero_mtn],
    ['Type de pièce',      dossier.type_piece],
    ['N° pièce',           dossier.numero_cni],
    ["Date d'expiration",  dossier.date_expiration],
    ['Date de naissance',  dossier.date_naissance],
    ['Lieu de naissance',  dossier.lieu_naissance],
    ['Sexe',               dossier.sexe],
    ['Nationalité',        dossier.nationalite],
    ['Profession',         dossier.profession],
    ['Nom du père',        dossier.nom_pere],
    ['Nom de la mère',     dossier.nom_mere],
    ['Adresse',            dossier.adresse_complete],
    ['Autre numéro',       dossier.autre_numero],
    ['Pays',               dossier.country],
  ];

  const cniSides: ('recto' | 'verso')[] = ['recto', 'verso'].filter(side => !!(dossier as any)[`photo_${side}`]) as ('recto' | 'verso')[];
  // Signature manuscrite ('dessin') ou empreinte digitale ('empreinte' —
  // utilisée quand le titulaire ne sait pas signer) : voir public-dossiers.ts,
  // normalizedSignatureMode. On étiquette la tuile en fonction, pour ne
  // jamais faire passer une empreinte pour une signature aux yeux de l'agent.
  const signatureLabel = dossier.signature_mode === 'empreinte'
    ? 'Empreinte digitale du titulaire'
    : 'Signature manuscrite du titulaire';
  const pieceTiles = [
    ...(cniSides.length > 0 ? [{
      id: 'cni',
      label: cniSides.length === 2 ? 'CNI (Recto + Verso)' : `CNI ${cniSides[0] === 'recto' ? 'Recto' : 'Verso'}`,
      type: 'cni',
      srcs: cniSides.map(side => api.photoUrlWithToken(dossier.id, side)),
      fit: 'cover' as const,
    }] : []),
    ...(dossier.photo_live ? [{
      id: 'live',
      label: 'Photo live (visage)',
      type: 'live',
      srcs: [api.photoUrlWithToken(dossier.id, 'live')],
      fit: 'cover' as const,
    }] : []),
    ...(dossier.photo_signature ? [{
      id: 'signature',
      label: signatureLabel,
      type: 'signature',
      srcs: [api.photoUrlWithToken(dossier.id, 'signature')],
      fit: 'contain' as const,
    }] : []),
  ];

  const confirmReject = () => {
    if (!raison.trim()) return;
    onDecision('rejete', raison.trim());
    setRejectOpen(false); setRaison('');
  };

  return (
    <div className="card" style={{ padding: 0, overflow: 'hidden', border: '1px solid var(--border, #E2E8F0)' }}>
      <div style={{
        background: `linear-gradient(135deg, ${MTN_BLUE} 0%, #001d5c 100%)`,
        color: '#fff', padding: '22px 24px', display: 'flex', alignItems: 'center',
        justifyContent: 'space-between', gap: 16, borderBottom: `3px solid ${MTN_GOLD}`,
      }}>
        <div style={{ minWidth: 0 }}>
          <p style={{ margin: '0 0 4px', fontSize: 12, fontWeight: 700, letterSpacing: '.06em', color: 'rgba(255,255,255,.65)', textTransform: 'uppercase' }}>
            Dossier {dossier.id}
          </p>
          <p style={{ margin: 0, fontSize: 18, fontWeight: 800, lineHeight: 1.25, overflowWrap: 'anywhere' }}>
            {nomComplet}
          </p>
          <p style={{ margin: '2px 0 0', fontSize: 13, color: 'rgba(255,255,255,.8)' }}>{dossier.numero_mtn}</p>
          {(dossier.username_agent || dossier.zone_agent || dossier.heure_reception) && (
            <p style={{ margin: '6px 0 0', fontSize: 11.5, color: 'rgba(255,255,255,.65)' }}>
              Collecté par {dossier.username_agent || '—'}
              {dossier.zone_agent ? ` · ${dossier.zone_agent}` : ''}
              {dossier.heure_reception ? ` · reçu à ${dossier.heure_reception}` : ''}
            </p>
          )}
        </div>
        <span style={{ fontSize: 12.5, fontWeight: 800, color: MTN_BLUE, background: MTN_GOLD, borderRadius: 999, padding: '8px 16px', whiteSpace: 'nowrap', flexShrink: 0 }}>
          {statutLabel}
        </span>
      </div>

      <div style={{ padding: '22px 24px' }}>
        {(dossier.score_visage != null || dossier.visage_match != null) && (
          <div style={{
            marginBottom: 18, padding: '12px 14px', borderRadius: 10,
            background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex',
            flexWrap: 'wrap', gap: '6px 18px', alignItems: 'baseline',
          }}>
            <span style={{ fontSize: 11.5, fontWeight: 700, color: MTN_MUTED, textTransform: 'uppercase', letterSpacing: '.03em' }}>
              Vérification faciale
            </span>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: MTN_TEXT }}>
              {dossier.score_visage != null ? `Score ${Number(dossier.score_visage).toFixed(1)}%` : ''}
              {dossier.visage_match != null ? ` · Correspondance ${Number(dossier.visage_match).toFixed(1)}%` : ''}
              {dossier.visage_motif ? ` (${dossier.visage_motif})` : ''}
            </span>
          </div>
        )}

        <SectionLabel>Informations du titulaire</SectionLabel>
        <div className="detail-grid">
          {champs.filter(([, v]) => !!(v && String(v).trim())).map(([label, v]) => (
            <div className="detail-item" key={label}>
              <span className="detail-label">{label}</span>
              <span className="detail-value">{v}</span>
            </div>
          ))}
        </div>

        {pieceTiles.length > 0 && (
          <>
            <hr className="divider" />
            <SectionLabel accent={MTN_GOLD}>Documents et preuves visuelles</SectionLabel>
            <div style={{ display: 'flex', gap: '.85rem', flexWrap: 'wrap' }}>
              {pieceTiles.map(piece => (
                <button
                  key={piece.id}
                  type="button"
                  onClick={() => setZoom({ src: piece.srcs[0], label: piece.label })}
                  style={{
                    border: `1px solid ${MTN_BLUE}20`,
                    borderRadius: 14,
                    padding: 10,
                    background: '#fff',
                    cursor: 'pointer',
                    display: 'flex',
                    flexDirection: 'column',
                    gap: 8,
                    alignItems: 'center',
                    minWidth: 150,
                    boxShadow: '0 16px 32px rgba(0,0,0,0.06)'
                  }}
                >
                  <div style={{ display: 'grid', gridTemplateColumns: piece.srcs.length === 2 ? '1fr 1fr' : '1fr', gap: 6, width: 140, height: 96 }}>
                    {piece.srcs.map((src, idx) => (
                      <img
                        key={idx}
                        src={src}
                        alt={`${piece.label} ${idx + 1}`}
                        style={{ width: '100%', height: '100%', objectFit: piece.fit, borderRadius: 8, background: piece.fit === 'contain' ? '#F8FAFC' : '#E2E8F0' }}
                      />
                    ))}
                  </div>
                  <span style={{ fontSize: 12, fontWeight: 700, color: MTN_TEXT, textAlign: 'center', lineHeight: 1.3 }}>{piece.label}</span>
                </button>
              ))}
            </div>
          </>
        )}

        <hr className="divider" />
        {enAttente ? (
          <div style={{ display: 'flex', gap: '.6rem' }}>
            <button type="button" className="btn btn-lg" disabled={busy} onClick={() => onDecision('accepte')} style={{ background: '#16A34A', color: '#fff', border: 'none' }}>
              ✓ Valider le dossier
            </button>
            <button type="button" className="btn btn-lg btn-danger" disabled={busy} onClick={() => setRejectOpen(true)}>
              ✗ Rejeter le dossier
            </button>
          </div>
        ) : (
          <p style={{ fontSize: 12.5, color: 'var(--ink-3)' }}>
            Dossier déjà {statutLabel.toLowerCase()}{dossier.raison_rejet ? ` — ${dossier.raison_rejet}` : ''}.
          </p>
        )}
      </div>

      {zoom && (
        <Modal title={zoom.label} onClose={() => setZoom(null)}>
          <img src={zoom.src} alt={zoom.label} style={{ maxWidth: '100%', borderRadius: 10, display: 'block', margin: '0 auto' }} />
        </Modal>
      )}

      {rejectOpen && (
        <Modal title="Motif du rejet" onClose={() => setRejectOpen(false)} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setRejectOpen(false)}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={!raison.trim() || busy} onClick={confirmReject}>Confirmer le rejet</button>
          </>
        }>
          <div className="field">
            <label>Raison du rejet<span className="req">*</span></label>
            <input value={raison} onChange={e => setRaison(e.target.value)} placeholder="Expliquez pourquoi ce dossier est rejeté…" autoFocus />
          </div>
        </Modal>
      )}
    </div>
  );
}

export function GsmSaisie({ dossierId: propDossierId, defaultValues, onComplete, onClose, compact = false }: GsmSaisieProps) {
  const searchParams = new URLSearchParams(window.location.search);
  const dossierId = propDossierId ?? (searchParams.get('dossier') || localStorage.getItem('gsm_dossier_id') || '');
  const refs = useFetch(() => api.getReferentiels(), []);
  const R = refs.data?.referentiels ?? {};
  const today = todayISO();
  const [f, setF] = useState({ ...EMPTY_GSM, date: today });
  const [dossier, setDossier] = useState<Dossier | null>(null);
  const [initialized, setInitialized] = useState(false);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null); const [success, setSuccess] = useState<string|null>(null);
  const [dossierBusy, setDossierBusy] = useState(false);
  const [captures, setCaptures] = useState<{ a?: File; p?: File; aa?: File }>({});
  const [search, setSearch] = useState('');
  const [lastId, setLastId] = useState<number|null>(null);
  const { data: listData, loading: listLoading, error: listError, refetch: refetchList } = useFetch(() => api.getGsmMesSaisies(today), [today]);
  const saisies = listData?.saisies ?? [];
  const filteredSaisies = saisies.filter(g => !search || [g.numero, g.constat, g.type_id, g.action, g.statut_final].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()));
  const [detailSel, setDetailSel] = useState<GsmRecord | null>(null);
  // Champs remplis automatiquement depuis le dossier d'acquisition (type de
  // pièce, décision de traitement...) — sert uniquement à afficher la pastille
  // « Pré-rempli »; n'affecte jamais la validation ni l'envoi du formulaire.
  const [autoFilled, setAutoFilled] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (dossierId && (!dossier || dossier.id !== dossierId)) {
      api.getDossier(dossierId).then(result => setDossier(result.dossier)).catch(() => null);
    }
  }, [dossierId, dossier]);

  useEffect(() => {
    if (initialized) return;
    if (!dossier && !defaultValues) return;

    const joinedNomClient = dossier ? `${dossier.nom_titulaire || ''} ${dossier.prenom_titulaire || ''}`.trim() : '';
    const defaultPiece = dossier ? (dossier.photo_recto && dossier.photo_verso ? 'Recto/Verso' : dossier.photo_recto ? 'Recto' : dossier.photo_verso ? 'Verso' : '') : '';
    // Type de pièce (CNI, Passeport, CEDEAO...) déjà déterminé à l'acquisition
    // terrain — et parfois lu automatiquement par l'OCR recto (voir ocr.ts,
    // champ type_piece). On le réutilise directement au lieu de faire
    // reconstater l'agent GSM : c'est justement ce que l'acquisition (OCR
    // compris) a été faite pour éviter de ressaisir en aval.
    const defaultTypeId = dossier?.type_piece
      ? (matchReferentiel(R['type_id'], dossier.type_piece) ?? dossier.type_piece)
      : '';

    const auto = new Set<string>();
    setF(current => {
      const next = { ...current };
      const applyAuto = (key: keyof typeof EMPTY_GSM, value: string) => {
        if (!current[key] && value) { next[key] = value; auto.add(key); }
      };
      next.date = current.date || today;
      applyAuto('numero', defaultValues?.numero || dossier?.numero_mtn || '');
      applyAuto('nom_client', defaultValues?.nom_client || joinedNomClient);
      applyAuto('type_id', defaultValues?.type_id || defaultTypeId);
      applyAuto('piece', defaultValues?.piece || defaultPiece);
      applyAuto('raison', defaultValues?.raison || dossier?.raison_rejet || dossier?.visage_motif || '');
      if (defaultValues?.action) applyAuto('action', defaultValues.action);
      return { ...next, ...defaultValues };
    });
    setAutoFilled(auto);
    setInitialized(true);
  }, [initialized, dossier, defaultValues, today]);

  const chg = (k: string, v: string) => {
    setF(x => ({ ...x, [k]: v }));
    // Dès que l'agent touche un champ pré-rempli, on retire la pastille — la
    // valeur devient une saisie normale, plus une suggestion.
    setAutoFilled(current => {
      if (!current.has(k)) return current;
      const next = new Set(current);
      next.delete(k);
      return next;
    });
  };

  // ── Décision sur le dossier (valider/rejeter) — indépendante de la saisie
  // GSM ci-dessous : l'agent statue sur le dossier d'identité déjà collecté
  // (recto/verso, infos, signature) sans avoir besoin de le ressaisir.
  // NB : à adapter si les noms des fonctions diffèrent dans services/api.ts.
  const handleDossierDecision = async (statut: 'accepte' | 'rejete', raison?: string) => {
    if (!dossier) return;
    setDossierBusy(true); setErr(null); setSuccess(null);
    try {
      if (statut === 'accepte') {
        await api.accepterDossier(dossier.id);
      } else {
        await api.rejeterDossier(dossier.id, raison ?? '');
      }
      const refreshed = await api.getDossier(dossier.id);
      setDossier(refreshed.dossier);
      setSuccess(statut === 'accepte' ? 'Dossier validé.' : 'Dossier rejeté.');

      // Automatisation : la décision de traitement vient d'être prise à
      // l'instant — on la reporte directement dans la saisie GSM (statut
      // final, raison) au lieu de faire retaper la même information deux fois.
      // Toujours modifiable ensuite, comme les autres champs pré-remplis.
      const decisionLabel = statut === 'accepte' ? 'Accepté' : 'Rejeté';
      const matchedStatut = matchReferentiel(R['statut_final'], decisionLabel) ?? decisionLabel;
      setF(current => ({
        ...current,
        statut_final: matchedStatut,
        raison: statut === 'rejete' ? (raison || current.raison) : current.raison,
      }));
      setAutoFilled(current => {
        const next = new Set(current);
        next.add('statut_final');
        if (statut === 'rejete') next.add('raison');
        return next;
      });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors du traitement du dossier');
    } finally {
      setDossierBusy(false);
    }
  };

  // Automatisation « pro totale » : on bloque l'enregistrement de la saisie
  // GSM tant que le dossier lié n'a pas été validé ou rejeté ci-dessus. Sans
  // ce garde-fou, un agent pouvait enregistrer sa saisie GSM et quitter la
  // page en laissant le dossier bloqué "en_cours" indéfiniment — le filet de
  // sécurité de distribution.ts se base sur la présence de l'agent, pas sur
  // le temps passé sur CE dossier précis, donc rien ne le récupérait.
  const dossierNonDecide = !!dossier && STATUTS_EN_ATTENTE.has(dossier.statut);

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setSuccess(null);
    if (dossierNonDecide)
      return setErr("Validez ou rejetez le dossier ci-dessus avant d'enregistrer la saisie GSM.");
    if (!f.numero || !f.type_id || !f.constat || !f.piece || !f.verbatim || !f.action)
      return setErr('Champs obligatoires manquants');
    setLoading(true);
    try {
      const today = todayISO();
      const payload = { ...f, date: f.date || today, dossier_id: dossierId || undefined };
      const r = await api.createGsmLibre(payload);
      setLastId(r.id);
      if (captures.a || captures.p || captures.aa) {
        const fd = new FormData();
        if (captures.a)  fd.append('capture_a',  captures.a);
        if (captures.p)  fd.append('capture_p',  captures.p);
        if (captures.aa) fd.append('capture_aa', captures.aa);
        await api.uploadGsmCaptures(r.id, fd);
      }
      setSuccess(`Saisie enregistrée (ID ${r.id})`);
      setF({ ...EMPTY_GSM }); setCaptures({});
      refetchList();
      (e.target as HTMLFormElement).reset();
      onComplete?.();
    } catch(e2) { setErr(e2 instanceof Error ? e2.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  const Sel = ({ k, label, opts, req }: { k: string; label: string; opts?: string[]; req?: boolean }) => {
    const value = (f as Record<string,string>)[k] || '';
    const hasOpts = Array.isArray(opts) && opts.length > 0;

    // Si l'agent a fourni une valeur qui n'existe pas dans le référentiel,
    // on l'insère en tête de la liste pour qu'elle soit visible et
    // pré-sélectionnée dans le <select> plutôt que de basculer sur un input.
    const existingOpts = hasOpts ? opts! : [];
    const isCustom = hasOpts && value && !existingOpts.includes(value);
    const selectOptions = isCustom ? [value, ...existingOpts] : existingOpts;

    return (
      <div className="field">
        <label>{label}{req && <span className="req">*</span>}{autoFilled.has(k) && <AutoTag />}</label>
        {hasOpts ? (
          <select value={value} onChange={e => chg(k, e.target.value)}>
            <option value="">Sélectionner…</option>
            {selectOptions.map(o => (
              <option key={o} value={o}>{o}{isCustom && o === value ? ' (pré-rempli)' : ''}</option>
            ))}
          </select>
        ) : (
          <input value={value} onChange={e => chg(k, e.target.value)} placeholder={label} />
        )}
      </div>
    );
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Saisie GSM / Gross Add</h1>
          <p className="page-sub">Enregistrez une nouvelle saisie Gross Add liée au dossier traité.</p>
        </div>
        {onClose && <button className="btn btn-ghost btn-sm" onClick={onClose}>Fermer</button>}
      </div>
      {dossierId && !dossier && <Alert kind="info">Chargement du dossier {dossierId}…</Alert>}
      {dossier && <DossierRecap dossier={dossier} busy={dossierBusy} onDecision={handleDossierDecision} />}
      {dossierNonDecide && (
        <Alert kind="info">
          ⏳ Décidez d'abord du dossier ci-dessus (✓ Valider ou ✗ Rejeter) — la saisie GSM se débloque juste après, avec le statut final déjà pré-rempli.
        </Alert>
      )}
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      <div className="card" style={{ maxWidth: 760, border: '1px solid var(--border, #E2E8F0)', borderTop: `3px solid ${MTN_BLUE}`, overflow: 'hidden' }}>
        <form onSubmit={submit} className="form-grid">
          <SectionLabel>Informations obligatoires</SectionLabel>
          <p style={{ margin: '-6px 0 4px', fontSize: 12, color: MTN_MUTED }}>
            Numéro, Type ID, Pièce, Constat, Verbatim et Action — tous requis avant l'enregistrement.
          </p>
          <div className="form-row">
            <div className="field"><label>Numéro<span className="req">*</span>{autoFilled.has('numero') && <AutoTag />}</label><input value={f.numero} onChange={e => chg('numero', e.target.value)} placeholder="Numéro GSM" required /></div>
            <Sel k="type_id" label="Type ID" opts={R['type_id']} req />
          </div>
          <div className="form-row">
            <Sel k="piece"    label="Pièce"     opts={R['piece']}    req />
            <Sel k="constat"  label="Constat"   opts={R['constat']}  req />
          </div>
          <div className="form-row">
            <Sel k="verbatim" label="Verbatim"  opts={R['verbatim']} req />
            <Sel k="action"   label="Action"    opts={R['action']}   req />
          </div>

          <hr className="divider" />
          <SectionLabel accent="#94A3B8">Informations complémentaires</SectionLabel>
          <div className="form-row">
            <div className="field"><label>Coach</label><input value={f.coach} onChange={e => chg('coach', e.target.value)} /></div>
            <Sel k="statut_final"  label="Statut final"  opts={R['statut_final']} />
          </div>
          <div className="form-row">
            <Sel k="traitement" label="Traitement" opts={R['traitement']} />
            <Sel k="raison"     label="Raison"     opts={R['raison']} />
          </div>
          <div className="form-row">
            <div className="field"><label>Nom client{autoFilled.has('nom_client') && <AutoTag />}</label><input value={f.nom_client} onChange={e => chg('nom_client', e.target.value)} /></div>
            <div className="field"><label>Date saisie</label><input type="date" value={f.date} onChange={e => chg('date', e.target.value)} /></div>
          </div>

          <hr className="divider" />
          <SectionLabel accent="#94A3B8">Captures écran complémentaires (optionnel)</SectionLabel>
          <div className="form-row">
            <div className="field"><label>Capture écran recto CNI (optionnel)</label><input type="file" accept="image/*" onChange={e => setCaptures(x => ({ ...x, a: e.target.files?.[0] }))} /></div>
            <div className="field"><label>Capture écran verso CNI (optionnel)</label><input type="file" accept="image/*" onChange={e => setCaptures(x => ({ ...x, p: e.target.files?.[0] }))} /></div>
          </div>
          <div className="field" style={{ maxWidth: 280 }}><label>Capture écran pièce complémentaire (optionnel)</label><input type="file" accept="image/*" onChange={e => setCaptures(x => ({ ...x, aa: e.target.files?.[0] }))} /></div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading || dossierNonDecide}
            title={dossierNonDecide ? "Validez ou rejetez le dossier ci-dessus avant d'enregistrer" : undefined}
            style={{ background: dossierNonDecide ? '#94A3B8' : MTN_BLUE, borderColor: dossierNonDecide ? '#94A3B8' : MTN_BLUE, color: '#fff' }}
          >
            {loading ? 'Enregistrement…' : dossierNonDecide ? '⏳ En attente de décision sur le dossier' : '✓ Enregistrer la saisie'}
          </button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <p className="card-title">Mes saisies d’aujourd’hui</p>
            <p className="page-sub">Suivi rapide des entrées enregistrées pour la journée.</p>
          </div>
          <div className="field" style={{ minWidth: 260 }}>
            <label>Recherche</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Numéro, constat, action…" />
          </div>
        </div>
        {listError && <Alert kind="error">{listError}</Alert>}
        {listLoading ? <LoadingCenter /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Numéro</th><th>Date</th><th>Constat</th><th>Pièce</th><th>Action</th><th>Statut</th><th /></tr></thead>
              <tbody>
                {filteredSaisies.length ? filteredSaisies.map(g => (
                  <tr key={g.id} className="clickable" onClick={() => setDetailSel(g)} style={{ cursor: 'pointer' }}>
                    <td><strong>{g.numero}</strong></td>
                    <td>{formatGsmDateValue(g.date_saisie)}</td>
                    <td><Chip value={g.constat} /></td>
                    <td><Chip value={g.piece} /></td>
                    <td><Chip value={g.action} /></td>
                    <td><Chip value={g.statut_final} /></td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); setDetailSel(g); }}
                      >
                        Voir →
                      </button>
                    </td>
                  </tr>
                )) : <tr><td colSpan={7}><EmptyState icon="📋" title="Aucune saisie aujourd’hui" /></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {detailSel && <GsmRecordDetailModal record={detailSel} onClose={() => setDetailSel(null)} />}
    </>
  );
}

// ── Mon Historique GSM ─────────────────────────────────────────────────────────
export function GsmHistorique() {
  const [debut, setDebut] = useState(nDaysAgo(30)); const [fin, setFin] = useState(todayISO());
  const [search, setSearch] = useState(''); const dSearch = useDebounce(search, 300);
  const [sel, setSel] = useState<GsmRecord|null>(null);
  const [delTarget, setDelTarget] = useState<GsmRecord|null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string|null>(null);
  const { data, loading, error, refetch } = useFetch(() => api.getGsmMesHistorique(debut, fin), [debut, fin]);

  const filtered = (data?.saisies ?? []).filter(g => !dSearch || g.numero.includes(dSearch) || (g.constat ?? '').toLowerCase().includes(dSearch.toLowerCase()));

  const handleDelete = async () => {
    if (!delTarget) return; setBusy(true);
    try { await api.deleteGsm(delTarget.id); setDelTarget(null); refetch(); }
    catch(e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const handleExport = async () => {
    setExporting(true); setErr(null);
    try {
      const csv = await api.exportGsmCsv({ du: debut, au: fin });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `gsm_${debut}_${fin}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur export'); }
    finally { setExporting(false); }
  };

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Mon historique GSM</h1><p className="page-sub">Toutes vos saisies sur la période sélectionnée, avec détails et export.</p></div><div style={{ display:'flex', gap:'.5rem' }}><button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting}>{exporting ? 'Export…' : 'Export CSV'}</button><button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button></div></div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}
      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <div className="field"><label>Recherche</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Numéro, constat…" /></div>
        </div>
      </div>
      {loading ? <LoadingCenter /> : (
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: '.75rem' }}>{filtered.length} saisie(s)</div>
          {!filtered.length ? <EmptyState icon="📋" title="Aucune saisie" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Numéro</th><th>Date</th><th>Type</th><th>Constat</th><th>Statut final</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(g => (
                    <tr key={g.id} className="clickable" onClick={() => setSel(g)} style={{ cursor: 'pointer' }}>
                      <td><strong>{g.numero}</strong></td>
                      <td>{formatGsmDateValue(g.date_saisie)}</td>
                      <td><Chip value={g.type_id} /></td>
                      <td><Chip value={g.constat} /></td>
                      <td><Chip value={g.statut_final} /></td>
                      <td onClick={e => e.stopPropagation()}>
                        <div style={{ display:'flex', gap:'.3rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setSel(g)}>Voir</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setDelTarget(g)}>Suppr.</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {sel && (
        <GsmRecordDetailModal
          record={sel}
          onClose={() => setSel(null)}
          footer={
            <>
              <button className="btn btn-ghost btn-sm" onClick={() => setSel(null)}>Fermer</button>
              <button className="btn btn-danger btn-sm" onClick={() => { setDelTarget(sel); setSel(null); }}>Supprimer</button>
            </>
          }
        />
      )}
      {delTarget && (
        <Modal title="Supprimer la saisie" onClose={() => setDelTarget(null)} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setDelTarget(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={handleDelete}>Confirmer</button>
          </>
        }>
          <p style={{ fontSize: 13.5 }}>Supprimer la saisie <strong>{delTarget.numero}</strong> du {formatGsmDateValue(delTarget.date_saisie)} ?</p>
        </Modal>
      )}
    </>
  );
}

// ── Mes Performances GSM ───────────────────────────────────────────────────────
export function GsmPerfs() {
  const [debut, setDebut] = useState(nDaysAgo(29)); const [fin, setFin] = useState(todayISO());
  const { data, loading, error, refetch } = useFetch(() => api.getGsmMesPerfs(debut, fin), [debut, fin]);
  const stats = data?.stats as Record<string,unknown> | undefined;
  const evolution = data?.evolution ?? [];
  const max = Math.max(1, ...evolution.map(e => e.n));

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mes performances GSM</h1><p className="page-sub">Analyse de votre activité sur la période.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <>
          {stats && (
            <div className="stats-grid">
              <StatCard label="Total période"     value={stats.total as number} variant="accepte" />
              <StatCard label="Jours travaillés"  value={stats.jours_travailles as number} />
              <StatCard label="Jours période"     value={stats.jours_periode as number} />
              <StatCard label="Moyenne / jour actif" value={stats.moyenne as number} variant="cours" />
            </div>
          )}
          {evolution.length > 0 && (
            <div className="card">
              <p className="card-title">Évolution quotidienne</p>
              <div className="bar-chart">
                {evolution.map(e => (
                  <div className="bar-row" key={e.jour}>
                    <span className="bar-label">{formatGsmEvolutionLabel(e.jour)}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(e.n / max) * 100}%` }} /></div>
                    <span className="bar-val">{e.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}