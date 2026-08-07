import { useMemo, useState, FormEvent, useEffect, useRef, ReactNode } from 'react';
import { useFetch, useDebounce, todayISO, nDaysAgo } from '../../hooks';
import * as api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Dossier, DossierStatut } from '../../types';
import { StatCard, Alert, LoadingCenter, EmptyState, Modal } from '../../components/ui';
import { DossiersTable } from '../../components/DossierComponents';
import { FaceLivenessCheck } from '../FaceLivenessCheck';
import { PauseButton } from '../../components/PauseButton';

const PHONE_CONFIG: Record<string, { digitCount: number; placeholder: string }> = {
  CG: { digitCount: 9, placeholder: '06 XXX XXX' },
  BJ: { digitCount: 10, placeholder: '01 XX XX XX XX' },
  CI: { digitCount: 10, placeholder: '05 XX XX XX XX' },
  CM: { digitCount: 9, placeholder: '67 XX XX XXX' },
  GW: { digitCount: 7, placeholder: '96 XX XXX' },
  GN: { digitCount: 8, placeholder: '61 XX XX XX' },
};

function faceSummary(d: Dossier) {
  if (d.score_visage === null || d.score_visage === undefined) {
    return { label: 'Analyse à venir', tone: 'pending', icon: '⏳', motif: d.visage_motif || 'La vérification faciale est en attente' };
  }
  if (d.score_visage >= 80) return { label: 'Conforme', tone: 'ok', icon: '✅', motif: d.visage_motif || 'Score élevé et conforme' };
  if (d.score_visage >= 70) return { label: 'À vérifier', tone: 'warn', icon: '⚠️', motif: d.visage_motif || 'Seuil proche, contrôle recommandé' };
  return { label: 'Non conforme', tone: 'error', icon: '❌', motif: d.visage_motif || 'Score faible' };
}

function formatFaceScore(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  return `${num.toFixed(1)}%`;
}

const formatPhoneLike = (val: string, country: string, maxDigits: number) => {
  const digits = val.replace(/\D/g, '').slice(0, maxDigits);
  if (!digits) return '';

  const groups = country === 'CI' || (country === 'BJ' && maxDigits === 10)
    ? [2, 2, 2, 4]
    : country === 'BJ' || country === 'GN'
      ? [2, 2, 2, 2]
      : country === 'CM'
        ? [2, 3, 4]
        : country === 'GW'
          ? [2, 3, 2]
          : [3, 3, 3];

  const parts: string[] = [];
  let start = 0;
  for (const size of groups) {
    const part = digits.slice(start, start + size);
    if (part) parts.push(part);
    start += size;
  }

  return parts.join(' ');
};

// ── Charte institutionnelle (MTN) — même identité visuelle que les pages GSM ───
const MTN_BLUE = '#003087';
const MTN_GOLD = '#FFCC00';
const MTN_TEXT = '#0F172A';
const MTN_MUTED = '#64748B';

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

const DOSSIER_STATUT_BADGE: Record<string, { bg: string; fg: string }> = {
  accepte:    { bg: '#DCFCE7', fg: '#166534' },
  rejete:     { bg: '#FEE2E2', fg: '#991B1B' },
  en_cours:   { bg: '#FEF3C7', fg: '#92400E' },
  en_attente: { bg: '#FEF3C7', fg: '#92400E' },
};

function DossierStatutBadge({ value }: { value?: string | null }) {
  if (!value) return <span style={{ color: MTN_MUTED }}>—</span>;
  const label = ({ en_attente: 'En attente', en_cours: 'En cours', accepte: 'Accepté', rejete: 'Rejeté' } as Record<string, string>)[value] ?? value;
  const tone = DOSSIER_STATUT_BADGE[value] ?? { bg: '#EEF2F7', fg: MTN_TEXT };
  return (
    <span style={{
      display: 'inline-block', fontSize: 11.5, fontWeight: 700, padding: '3px 10px',
      borderRadius: 999, background: tone.bg, color: tone.fg, whiteSpace: 'nowrap',
    }}>
      {label}
    </span>
  );
}

// ── Détail complet d'un dossier — identité du titulaire ────────────────────────
// Vue unique, réutilisée partout où un agent doit consulter un dossier : elle
// affiche systématiquement TOUTES les informations du titulaire (nom, prénom,
// naissance, filiation, adresse, pièce…), organisées par sections logiques
// plutôt qu'une longue liste plate, avec un vrai en-tête d'identité (avatar,
// statut, numéro copiable) et une galerie de pièces plus lisible. L'agent doit
// pouvoir se faire une opinion complète du dossier avant de prendre une
// décision (prise en charge, acceptation, rejet).
const DOSSIER_IDENTITY_SECTIONS: { title: string; accent?: string; fields: [string, keyof Dossier][] }[] = [
  {
    title: 'Identité du titulaire',
    fields: [
      ['Nom',               'nom_titulaire'],
      ['Prénom',            'prenom_titulaire'],
      ['Date de naissance', 'date_naissance'],
      ['Lieu de naissance', 'lieu_naissance'],
      ['Sexe',              'sexe'],
      ['Nationalité',       'nationalite'],
      ['Profession',        'profession'],
    ],
  },
  {
    title: 'Filiation',
    fields: [
      ['Nom du père',   'nom_pere'],
      ['Nom de la mère','nom_mere'],
    ],
  },
  {
    title: "Coordonnées et pièce d'identité",
    accent: MTN_GOLD,
    fields: [
      ['Adresse complète',  'adresse_complete'],
      ['Numéro CNI',        'numero_cni'],
      ['Type de pièce',     'type_piece'],
      ["Date d'expiration", 'date_expiration'],
      ['Autre numéro',      'autre_numero'],
      ['Numéro MTN',        'numero_mtn'],
      ['Pays',              'country'],
    ],
  },
];

const DOSSIER_PHOTO_TYPES: { key: 'photo_recto' | 'photo_verso' | 'photo_live' | 'photo_signature'; type: 'recto' | 'verso' | 'live' | 'signature'; label: string; group: 'cni' | 'live' | 'signature' }[] = [
  { key: 'photo_recto',     type: 'recto',     label: 'CNI recto',  group: 'cni' },
  { key: 'photo_verso',     type: 'verso',     label: 'CNI verso',  group: 'cni' },
  { key: 'photo_live',      type: 'live',      label: 'Photo live', group: 'live' },
  { key: 'photo_signature', type: 'signature', label: 'Signature',  group: 'signature' },
];

function initials(dossier: Dossier): string {
  const a = (dossier.prenom_titulaire || '').trim()[0] || '';
  const b = (dossier.nom_titulaire || '').trim()[0] || '';
  return (a + b).toUpperCase() || '?';
}

function CopyableValue({ value }: { value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(value); setCopied(true); setTimeout(() => setCopied(false), 1500); } catch (e) {}
      }}
      title="Copier"
      style={{
        display: 'inline-flex', alignItems: 'center', gap: 6, border: 'none', background: 'transparent',
        cursor: 'pointer', padding: 0, font: 'inherit', color: 'inherit',
      }}
    >
      <span>{value}</span>
      <span style={{ fontSize: 11, color: copied ? '#16A34A' : 'rgba(255,255,255,.6)', fontWeight: 700 }}>
        {copied ? '✓ copié' : '⧉'}
      </span>
    </button>
  );
}

function FaceScoreBar({ score, tone }: { score: number; tone: string }) {
  const color = tone === 'ok' ? '#16A34A' : tone === 'warn' ? '#D97706' : tone === 'error' ? '#DC2626' : MTN_MUTED;
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 120 }}>
      <div style={{ flex: 1, height: 6, borderRadius: 999, background: '#E2E8F0', overflow: 'hidden' }}>
        <div style={{ width: `${Math.min(100, Math.max(0, score))}%`, height: '100%', background: color, borderRadius: 999 }} />
      </div>
      <span style={{ fontSize: 12.5, fontWeight: 700, color }}>{score.toFixed(1)}%</span>
    </div>
  );
}

function DossierIdentityModal({ dossier, onClose, onZoom, footer }: {
  dossier: Dossier;
  onClose: () => void;
  onZoom?: (imgs: string[], idx: number, title: string) => void;
  footer?: ReactNode;
}) {
  const face = faceSummary(dossier);
  const nomComplet = `${dossier.nom_titulaire || ''} ${dossier.prenom_titulaire || ''}`.trim() || 'Titulaire non renseigné';

  const cniPhotos = DOSSIER_PHOTO_TYPES.filter(p => p.group === 'cni' && !!dossier[p.key]);
  const otherPhotos = DOSSIER_PHOTO_TYPES.filter(p => p.group !== 'cni' && !!dossier[p.key]);
  const allImgs = DOSSIER_PHOTO_TYPES.filter(p => !!dossier[p.key]).map(p => api.photoUrlWithToken(dossier.id, p.type));
  const imgIndex = (type: string) => DOSSIER_PHOTO_TYPES.filter(p => !!dossier[p.key]).findIndex(p => p.type === type);

  return (
    <Modal title={`Dossier ${dossier.id}`} onClose={onClose} footer={footer}>
      {/* En-tête identité */}
      <div style={{
        borderRadius: 16, overflow: 'hidden', marginBottom: 18,
        background: `linear-gradient(135deg, ${MTN_BLUE} 0%, #001d5c 100%)`,
        borderBottom: `3px solid ${MTN_GOLD}`,
        boxShadow: '0 10px 28px rgba(0,48,135,.18)',
      }}>
        <div style={{ padding: '18px 20px', color: '#fff', display: 'flex', alignItems: 'center', gap: 16 }}>
          <div style={{
            width: 52, height: 52, borderRadius: '50%', flexShrink: 0,
            background: MTN_GOLD, color: MTN_BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 18, fontWeight: 800, letterSpacing: '.02em',
            boxShadow: '0 4px 12px rgba(0,0,0,.2)',
          }}>
            {initials(dossier)}
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 17, fontWeight: 800, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                {nomComplet}
              </p>
              <DossierStatutBadge value={dossier.statut} />
            </div>
            <p style={{ margin: '4px 0 0', fontSize: 12.5, color: 'rgba(255,255,255,.82)', display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
              {dossier.numero_mtn ? <CopyableValue value={dossier.numero_mtn} /> : 'Numéro non renseigné'}
              <span style={{ opacity: .5 }}>·</span>
              <span>{dossier.zone_agent || 'Zone non renseignée'}</span>
              <span style={{ opacity: .5 }}>·</span>
              <span style={{ fontFamily: 'monospace', fontSize: 11.5, opacity: .85 }}>{dossier.id}</span>
            </p>
          </div>
        </div>
      </div>

      {/* Vérification faciale */}
      <div style={{
        marginBottom: 18, padding: '14px 16px', borderRadius: 12,
        background: '#F8FAFC', border: '1px solid #E2E8F0', display: 'flex',
        flexWrap: 'wrap', gap: '10px 22px', alignItems: 'center', justifyContent: 'space-between',
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <span style={{ fontSize: 11.5, fontWeight: 700, color: MTN_MUTED, textTransform: 'uppercase', letterSpacing: '.03em' }}>
            Vérification faciale
          </span>
          <span className={`face-pill ${face.tone}`}>{face.icon} {face.label}</span>
        </div>
        {dossier.score_visage !== null && dossier.score_visage !== undefined && (
          <FaceScoreBar score={Number(dossier.score_visage)} tone={face.tone} />
        )}
      </div>
      {face.motif && (
        <p style={{ margin: '-10px 0 18px', fontSize: 12, color: MTN_MUTED, paddingLeft: 2 }}>{face.motif}</p>
      )}

      {/* Sections d'identité */}
      {DOSSIER_IDENTITY_SECTIONS.map((section, i) => {
        const filled = section.fields.filter(([, key]) => !!(dossier[key] && String(dossier[key]).trim()));
        if (!filled.length) return null;
        return (
          <div key={section.title}>
            {i > 0 && <hr className="divider" />}
            <SectionLabel accent={section.accent}>{section.title}</SectionLabel>
            <div className="detail-grid">
              {filled.map(([label, key]) => (
                <div className="detail-item" key={String(key)}>
                  <span className="detail-label">{label}</span>
                  <span className="detail-value">{String(dossier[key])}</span>
                </div>
              ))}
            </div>
          </div>
        );
      })}
      {!DOSSIER_IDENTITY_SECTIONS.some(s => s.fields.some(([, key]) => !!(dossier[key] && String(dossier[key]).trim()))) && (
        <EmptyState icon="🗂" title="Aucune information d'identité renseignée" />
      )}

      {/* Pièces et preuves visuelles */}
      {(cniPhotos.length > 0 || otherPhotos.length > 0) && (
        <>
          <hr className="divider" />
          <SectionLabel accent={MTN_GOLD}>Pièces et preuves visuelles</SectionLabel>
          <div style={{ display: 'flex', gap: '1rem', flexWrap: 'wrap' }}>
            {cniPhotos.length > 0 && (
              <div style={{
                display: 'flex', gap: 8, padding: 10, borderRadius: 12,
                border: '1px solid #E2E8F0', background: '#fff',
              }}>
                {cniPhotos.map(p => (
                  <div key={p.type} style={{ display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', width: 120 }}>
                    <img
                      src={api.photoUrlWithToken(dossier.id, p.type)}
                      alt={p.label}
                      style={{ width: 120, height: 90, objectFit: 'cover', borderRadius: 8, cursor: onZoom ? 'pointer' : 'default' }}
                      onClick={() => onZoom?.(allImgs, imgIndex(p.type), `${dossier.id} — ${p.label}`)}
                    />
                    <span style={{ fontSize: 11.5, color: MTN_MUTED, textAlign: 'center', fontWeight: 600 }}>{p.label}</span>
                  </div>
                ))}
              </div>
            )}
            {otherPhotos.map(p => (
              <div key={p.type} style={{
                display: 'flex', flexDirection: 'column', gap: 6, alignItems: 'center', width: 120,
                padding: 10, borderRadius: 12, border: '1px solid #E2E8F0', background: '#fff',
              }}>
                <img
                  src={api.photoUrlWithToken(dossier.id, p.type)}
                  alt={p.label}
                  style={{ width: 120, height: 90, objectFit: p.group === 'signature' ? 'contain' : 'cover', borderRadius: 8, background: p.group === 'signature' ? '#F8FAFC' : undefined, cursor: onZoom ? 'pointer' : 'default' }}
                  onClick={() => onZoom?.(allImgs, imgIndex(p.type), `${dossier.id} — ${p.label}`)}
                />
                <span style={{ fontSize: 11.5, color: MTN_MUTED, textAlign: 'center', fontWeight: 600 }}>{p.label}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Modal>
  );
}

// ── Dashboard Agent ────────────────────────────────────────────────────────────
export function AgentDashboard() {
  const { user } = useAuth();
  const today = todayISO();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);
  const { data, loading, error } = useFetch(() => api.getDossierStats(), []);
  const { data: gsmData, loading: gsmLoading, error: gsmError } = useFetch(() => api.getGsmMonTableau(), []);
  const { data: planningData, loading: planningLoading, error: planningError } = useFetch(() => api.getPlanningMon(today, tomorrowISO), [today, tomorrowISO]);

  const planningToday = planningData?.entrees.filter(e => e.date === today) ?? [];
  const planningTomorrow = planningData?.entrees.filter(e => e.date === tomorrowISO) ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonjour {user?.prenom} 👋</h1>
          <p className="page-sub">Activité du jour — {new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
        <div className="page-header-actions">
          <PauseButton />
        </div>
      </div>

      {(error || gsmError || planningError) && <Alert kind="error">{error || gsmError || planningError}</Alert>}

      <div className="card hero-card">
        <div className="hero-card-content">
          <div>
            <p className="hero-card-eyebrow">Tableau de bord agent</p>
            <h2 className="hero-card-title">Suivez vos dossiers, votre GSM et votre planning en un seul endroit.</h2>
            <p className="hero-card-sub">Le flux a été conçu pour reproduire l’expérience de l’ancien back office avec une navigation plus fluide et un suivi plus clair.</p>
          </div>
          <div className="info-pills">
            <span className="info-pill">📥 File d’attente</span>
            <span className="info-pill">📋 GSM / Gross Add</span>
            <span className="info-pill">📅 Planning</span>
          </div>
        </div>
      </div>

      {loading || gsmLoading || planningLoading ? <LoadingCenter /> : (
        <>
          <div className="stats-grid">
            <StatCard label="En attente" value={data?.en_attente ?? 0} variant="attente" sub="File commune" />
            <StatCard label="En cours" value={data?.en_cours ?? 0} variant="cours" sub="Vos dossiers actifs" />
            <StatCard label="Acceptés" value={data?.accepte ?? 0} variant="accepte" sub="Aujourd’hui" />
            <StatCard label="Rejetés" value={data?.rejete ?? 0} variant="rejete" sub="Aujourd’hui" />
          </div>

          <div className="stats-grid">
            <StatCard label="Saisies aujourd’hui" value={gsmData?.aujourdhui ?? 0} variant="accepte" sub="Gross Add" />
            <StatCard label="7 derniers jours" value={gsmData?.sept_jours ?? 0} variant="cours" sub="Évolution rapide" />
            <StatCard label="Mois de paie" value={gsmData?.mois_paie ?? 0} variant="attente" sub={gsmData?.libelle_mois_paie || '—'} />
            <StatCard label="Total cumulé" value={gsmData?.total ?? 0} variant="info" sub="Toutes saisies" />
          </div>

          <div className="dashboard-two-col">
            <div className="card">
              <div className="card-header">
                <div>
                  <p className="card-title">Planning du jour</p>
                  <p className="page-sub">Vos activités prévues aujourd’hui.</p>
                </div>
              </div>
              {!planningToday.length ? <EmptyState icon="📅" title="Aucun planning aujourd’hui" /> : (
                <div className="stack-list">
                  {planningToday.map(entry => (
                    <div key={entry.id} className="stack-item">
                      <div className="stack-item-main">
                        <strong>{entry.activite || 'Activité'}</strong>
                        <span>{entry.lieu || 'Lieu non renseigné'}</span>
                      </div>
                      <div className="stack-item-side">
                        <span>{entry.heure_debut || entry.horaire || '—'}</span>
                        <span>{entry.heure_fin || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <p className="card-title">Planning de demain</p>
                  <p className="page-sub">Préparez votre journée à l’avance.</p>
                </div>
              </div>
              {!planningTomorrow.length ? <EmptyState icon="🗓" title="Aucun planning demain" /> : (
                <div className="stack-list">
                  {planningTomorrow.map(entry => (
                    <div key={entry.id} className="stack-item">
                      <div className="stack-item-main">
                        <strong>{entry.activite || 'Activité'}</strong>
                        <span>{entry.lieu || 'Lieu non renseigné'}</span>
                      </div>
                      <div className="stack-item-side">
                        <span>{entry.heure_debut || entry.horaire || '—'}</span>
                        <span>{entry.heure_fin || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-title">5 dernières saisies GSM</p>
                <p className="page-sub">Un aperçu rapide de votre activité récente.</p>
              </div>
            </div>
            {!gsmData?.dernieres?.length ? <EmptyState icon="📋" title="Aucune saisie récente" /> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Numéro</th><th>Date</th><th>Constat</th><th>Statut</th></tr>
                  </thead>
                  <tbody>
                    {gsmData.dernieres.map(g => (
                      <tr key={g.id}>
                        <td><strong>{g.numero}</strong></td>
                        <td>{g.date_saisie}</td>
                        <td>{g.constat || '—'}</td>
                        <td>{g.statut_final || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── File d'attente (dossiers distribués automatiquement à l'agent) ─────────────
const DOSSIER_TIMEOUT_SEC_DEFAULT = 120; // repli si /api/config/distribution-timing indisponible (défaut backend réel)

function secondsRemaining(assigneLe: number | null | undefined, now: number, timeoutSec: number): number | null {
  if (!assigneLe) return null;
  const elapsedSec = Math.floor(now / 1000) - assigneLe;
  return timeoutSec - elapsedSec;
}

function formatCountdown(remaining: number): string {
  const clamped = Math.max(0, remaining);
  const m = Math.floor(clamped / 60);
  const s = clamped % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function countdownTone(remaining: number, timeoutSec: number): 'ok' | 'warn' | 'danger' {
  if (remaining <= timeoutSec * 0.2) return 'danger';
  if (remaining <= timeoutSec * 0.5) return 'warn';
  return 'ok';
}

export function AgentFileAttente() {
  const { user } = useAuth();
  const [preview, setPreview] = useState<{ imgs: string[]; idx: number; title?: string } | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(id);
  }, []);
  useEffect(() => {
    if (!preview) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
      if (e.key === 'ArrowLeft') setPreview(p => p ? { ...p, idx: Math.max(0, p.idx - 1) } : p);
      if (e.key === 'ArrowRight') setPreview(p => p ? { ...p, idx: Math.min(p.imgs.length - 1, p.idx + 1) } : p);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [preview]);
  const [selected, setSelected] = useState<Dossier | null>(null);
  const [rejetTarget, setRejetTarget] = useState<Dossier | null>(null);
  const [livenessDossier, setLivenessDossier] = useState<Dossier | null>(null);
  const [selectedMotif, setSelectedMotif] = useState('');
  const [customMotif, setCustomMotif] = useState('');
  const [motifSearch, setMotifSearch] = useState('');
  const [motifPage, setMotifPage] = useState(1);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string|null>(null);
  const [demanding, setDemanding] = useState(false);

  // Un dossier distribué automatiquement n'est pas immédiatement actionnable :
  // l'agent doit d'abord cliquer sur « Prendre en charge » (après avoir consulté
  // le détail complet du titulaire) avant de pouvoir Appeler / Accepter / Rejeter.
  // Ceci évite toute décision (accepter/rejeter) prise sans avoir vu l'identité
  // complète du dossier.
  const [takenIds, setTakenIds] = useState<Set<string>>(new Set());

  // Un agent ne voit QUE ce qui lui a été distribué automatiquement — jamais la
  // file globale des autres agents.
  const { data, loading, error, refetch } = useFetch(
    () => api.getDossiers({ limit: 10, scope: 'mine', statut: 'en_cours' }), []
  );

  const motifsQ = useFetch(() => api.getRejectionMotifs(), []);
  const timingQ = useFetch(() => api.getDistributionTiming(), []);
  const timeoutSec = timingQ.data?.abandon_sec && timingQ.data.abandon_sec > 0 ? timingQ.data.abandon_sec : DOSSIER_TIMEOUT_SEC_DEFAULT;

  const dossiers = (data?.dossiers ?? []).filter(d => d.statut === 'en_cours');

  const action = async (fn: () => Promise<unknown>, after?: () => void) => { setBusy(true); setErr(null); try { await fn(); setSelected(null); refetch(); after?.(); } catch(e) { setErr(e instanceof Error ? e.message : 'Erreur'); } finally { setBusy(false); } };

  const demanderDossier = async () => {
    setDemanding(true); setErr(null); setSuccess(null);
    try {
      const res = await api.appelerDossier();
      if (res?.aucun) setSuccess('Aucun dossier en attente pour le moment.');
      refetch();
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors de la demande de dossier');
    } finally {
      setDemanding(false);
    }
  };
  const handlePrendre = async (dossier: Dossier) => {
    setErr(null); setSuccess(null); setBusy(true);
    try {
      if (dossier.statut === 'en_attente') {
        await api.prendreEnCharge(dossier.id);
      } else if (dossier.statut === 'en_cours') {
        // Dossier déjà attribué (distribution auto) : on confirme la prise en
        // charge côté serveur pour relever le chrono d'abandon (assigne_le),
        // afin qu'il ne soit pas repris pendant que l'agent le traite.
        await api.confirmerPriseEnCharge(dossier.id);
      }
      refetch();
      setTakenIds(prev => { const next = new Set(prev); next.add(dossier.id); return next; });
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors de la prise en charge du dossier');
    } finally {
      setBusy(false);
    }
  };

  const motifs = motifsQ.data?.motifs ?? [];
  const filteredMotifs = useMemo(() => {
    const query = motifSearch.trim().toLocaleLowerCase('fr-FR');
    return motifs.filter(motif => motif.toLocaleLowerCase('fr-FR').includes(query));
  }, [motifs, motifSearch]);
  const motifsPerPage = 10;
  const motifPageCount = Math.max(1, Math.ceil((filteredMotifs.length + 1) / motifsPerPage));
  const motifPageItems = filteredMotifs.slice((motifPage - 1) * motifsPerPage, motifPage * motifsPerPage);

  const handleCallTerrain = async (dossier: Dossier) => {
    if (!dossier.wa_agent) {
      setSuccess(null);
      setErr('Numéro terrain introuvable pour ce dossier.');
      return;
    }
    setErr(null);
    setSuccess(null);
    setBusy(true);
    try {
      const result = await api.callTerrain(dossier.wa_agent, dossier.numero_mtn);
      setSuccess(result.message || 'Appel lancé vers l’agent terrain.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors du lancement de l’appel.');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalizeGsm = (dossier: Dossier) => {
    localStorage.setItem('gsm_dossier_id', dossier.id);
    window.location.href = '/gsm-saisie?dossier=' + encodeURIComponent(dossier.id);
  };

  useEffect(() => {
    if (rejetTarget) {
      setSelectedMotif('');
      setCustomMotif('');
      setMotifSearch('');
      setMotifPage(1);
    }
  }, [rejetTarget, motifs]);

  useEffect(() => {
    if (motifPage > motifPageCount) setMotifPage(motifPageCount);
  }, [motifPage, motifPageCount]);

  // Polling silencieux en arrière-plan - ne recharge que si le lot de dossiers
  // qui m'est distribué change (nouveau dossier reçu, ou repris par le système
  // après le délai de 5 minutes).
  const dossiersRef = useRef(dossiers);
  useEffect(() => {
    dossiersRef.current = dossiers;
  }, [dossiers]);

  // Distribution automatique silencieuse : tant qu'aucun dossier n'est assigné
  // à l'agent, on redemande périodiquement un dossier en arrière-plan, sans
  // action de sa part — le bouton « Demander un dossier » reste disponible en
  // secours pour forcer une demande immédiate.
  const demandingRef = useRef(false);
  useEffect(() => { demandingRef.current = demanding; }, [demanding]);

  useEffect(() => {
    if (dossiers.length > 0) return;
    let cancelled = false;
    const tryDemanderSilencieux = async () => {
      if (cancelled || demandingRef.current) return;
      try {
        const res = await api.appelerDossier();
        if (!cancelled && !res?.aucun) refetch();
      } catch (e) {
        // Aucun dossier disponible, limite atteinte, ou erreur réseau : on
        // réessaiera silencieusement au prochain cycle, sans alerter l'agent.
      }
    };
    tryDemanderSilencieux();
    const interval = setInterval(tryDemanderSilencieux, 6000);
    return () => { cancelled = true; clearInterval(interval); };
  }, [dossiers.length, refetch]);

  useEffect(() => {
    const interval = setInterval(async () => {
      try {
        const newData = await api.getDossiers({ limit: 10, scope: 'mine', statut: 'en_cours' });
        const newIds = (newData.dossiers ?? []).filter(d => d.statut === 'en_cours').map(d => d.id).sort().join(',');
        const currentIds = dossiersRef.current.map(d => d.id).sort().join(',');
        if (newIds !== currentIds) refetch();
      } catch (e) {
        // Silencieusement ignorer les erreurs de polling
      }
    }, 4000);
    return () => clearInterval(interval);
  }, [refetch]);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mon dossier</h1><p className="page-sub">Distribution automatique — les dossiers qui vous sont attribués apparaissent ici.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻ Actualiser</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      {loading ? <LoadingCenter /> : dossiers.length === 0 ? (
        <div
          className="card"
          style={{
            maxWidth: 440,
            textAlign: 'center',
            padding: '2.5rem 2rem',
            background: 'linear-gradient(160deg, var(--surface-1) 0%, var(--surface-2) 100%)',
            border: '1px solid var(--border)',
            borderRadius: 'var(--r-lg, 16px)',
            boxShadow: '0 8px 28px rgba(0,0,0,.06)',
          }}
        >
          <div style={{ fontSize: 40, marginBottom: '.5rem' }}>🎯</div>
          <div style={{ fontWeight: 700, fontSize: 16, marginBottom: '.35rem' }}>En attente d'un dossier</div>
          <p style={{ fontSize: 13, color: 'var(--ink-3)', marginBottom: '1.25rem' }}>
            La distribution automatique recherche un dossier pour vous en continu. Vous ne voyez ici que ce qui vous a été assigné personnellement.
          </p>
          <button className="btn btn-primary" disabled={demanding} onClick={demanderDossier}>
            {demanding ? 'Demande en cours…' : '↻ Redemander maintenant'}
          </button>
        </div>
      ) : (
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: '1.25rem', width: '100%' }}>
          {dossiers.map(d => {
            const face = faceSummary(d);
            const remaining = secondsRemaining(d.assigne_le, now, timeoutSec);
            const tone = remaining !== null ? countdownTone(remaining, timeoutSec) : 'ok';
            const toneColor = tone === 'danger' ? '#DC2626' : tone === 'warn' ? '#D97706' : '#16A34A';
            const isTaken = takenIds.has(d.id);
            const canReprendreFaciale = d.acquisition_status === 'face_verify_retry' || d.visage_motif?.includes('erreur_rekognition') || d.visage_motif?.includes('failed');
            return (
              <div
                key={d.id}
                className="card assigned-dossier-card"
                style={{
                  flex: '0 0 420px',
                  width: 420,
                  maxWidth: '100%',
                  alignSelf: 'flex-start',
                  padding: 0,
                  overflow: 'hidden',
                  borderRadius: 16,
                  border: `1px solid ${isTaken ? '#E2E8F0' : MTN_GOLD}`,
                  boxShadow: isTaken ? '0 10px 32px rgba(0,0,0,.08)' : '0 12px 34px rgba(255,204,0,.18)',
                  background: '#fff',
                  transition: 'box-shadow .2s ease',
                }}
              >
                <div
                  style={{
                    padding: '14px 18px',
                    color: '#fff',
                    background: `linear-gradient(135deg, ${MTN_BLUE} 0%, #001d5c 100%)`,
                    borderBottom: `3px solid ${MTN_GOLD}`,
                    display: 'flex',
                    justifyContent: 'space-between',
                    alignItems: 'center',
                    gap: '.75rem',
                  }}
                >
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: 15, fontWeight: 800, letterSpacing: '.02em' }}>{d.id}</div>
                    <div style={{ fontSize: 11.5, color: 'rgba(255,255,255,.75)' }}>{d.username_agent || 'Agent terrain'} • pris à {d.heure_prise || '—'}</div>
                  </div>
                  {remaining !== null && (
                    <div
                      title="Temps restant avant redistribution automatique"
                      style={{
                        display: 'flex', alignItems: 'center', gap: '.35rem',
                        padding: '.3rem .6rem', borderRadius: 999,
                        background: '#fff', border: `1px solid ${toneColor}`,
                        color: toneColor, fontWeight: 700, fontSize: 12, fontVariantNumeric: 'tabular-nums',
                        flexShrink: 0,
                      }}
                    >
                      ⏱ {formatCountdown(remaining)}
                    </div>
                  )}
                </div>

                <div style={{ padding: '1.1rem 1.25rem', display: 'flex', flexDirection: 'column', gap: '.9rem' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '.5rem' }}>
                    <div>
                      <div style={{ fontSize: 18, fontWeight: 700, color: MTN_TEXT }}>{d.numero_mtn || 'Numéro masqué'}</div>
                      <div style={{ fontSize: 12, color: MTN_MUTED }}>{d.zone_agent || 'Zone non renseignée'}</div>
                    </div>
                    <span style={{
                      fontSize: 11, fontWeight: 800, padding: '4px 10px', borderRadius: 999, whiteSpace: 'nowrap',
                      background: isTaken ? '#DCFCE7' : '#FEF3C7', color: isTaken ? '#166534' : '#92400E',
                    }}>
                      {isTaken ? '🟢 Pris en charge' : '🟡 À prendre en charge'}
                    </span>
                  </div>

                  <div className="face-preview-card">
                    <div className="face-preview-header">
                      <span>Reconnaissance faciale</span>
                      <span className={`face-pill ${face.tone}`}>{face.icon} {face.label}</span>
                    </div>
                    <div className="face-preview-text">{face.motif}</div>
                    {d.score_visage !== null && d.score_visage !== undefined && (
                      <div className="score-row"><span>Score</span><strong>{d.score_visage.toFixed(1)}%</strong></div>
                    )}
                  </div>

                  {(d.photo_recto || d.photo_verso || d.photo_live) && (
                    <div className="photo-strip">
                      {(() => {
                        const types = ['recto','verso','live'] as const;
                        const imgs = types.map(t => d[`photo_${t}` as 'photo_recto'|'photo_verso'|'photo_live'] ? api.photoUrlWithToken(d.id, t) : null).filter(Boolean) as string[];
                        return types.map(type => {
                          const field = `photo_${type}` as 'photo_recto' | 'photo_verso' | 'photo_live';
                          const path = d[field];
                          if (!path) return null;
                          const url = api.photoUrlWithToken(d.id, type);
                          const idx = imgs.indexOf(url);
                          return <img key={type} src={url} alt={type} className="mini-photo" onClick={() => setPreview({ imgs, idx: idx >= 0 ? idx : 0, title: `${d.id} — ${type}` })} />;
                        });
                      })()}
                    </div>
                  )}

                  {!isTaken && (
                    <p style={{ margin: 0, fontSize: 12, color: MTN_MUTED, lineHeight: 1.4 }}>
                      Consultez le <strong>détail complet</strong> du titulaire (identité, filiation, adresse) avant de prendre ce dossier en charge.
                    </p>
                  )}
                </div>

                <div
                  style={{
                    padding: '.9rem 1.25rem',
                    borderTop: '1px solid #E2E8F0',
                    display: 'flex',
                    flexWrap: 'wrap',
                    gap: '.5rem',
                    background: '#F8FAFC',
                  }}
                >
                  {!isTaken ? (
                    <>
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelected(d)}>🔎 Voir le détail complet</button>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-primary btn-sm" disabled={busy} style={{ background: MTN_BLUE, borderColor: MTN_BLUE, color: '#fff' }} onClick={() => handlePrendre(d)}>
                        {busy ? 'Prise en charge…' : '📥 Prendre en charge'}
                      </button>
                    </>
                  ) : (
                    <>
                      <button className="btn btn-success btn-sm" disabled={busy || !d.wa_agent} onClick={() => handleCallTerrain(d)}>
                        {d.wa_agent ? '📞 Appeler terrain' : 'Pas de WA'}
                      </button>
                      {canReprendreFaciale && (
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action(() => api.reprendreFaceVerify(d.id))}>↺ Reprendre faciale</button>
                      )}
                      <button className="btn btn-ghost btn-sm" onClick={() => setSelected(d)}>Détails</button>
                      <div style={{ flex: 1 }} />
                      <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setRejetTarget(d); setSelected(null); }}>✕ Rejeter</button>
                      <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => action(() => api.accepterDossier(d.id), () => {
                        localStorage.setItem('gsm_dossier_id', d.id);
                        window.location.href = '/gsm-saisie?dossier=' + d.id;
                      })}>✓ Accepter</button>
                    </>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {selected && (
        <DossierIdentityModal
          dossier={selected}
          onClose={() => setSelected(null)}
          onZoom={(imgs, idx, title) => setPreview({ imgs, idx, title })}
          footer={
            !takenIds.has(selected.id) ? (
              <button className="btn btn-primary" disabled={busy} style={{ background: MTN_BLUE, borderColor: MTN_BLUE, color: '#fff' }} onClick={() => handlePrendre(selected)}>
                {busy ? 'Prise en charge…' : '📥 Prendre en charge'}
              </button>
            ) : (
              <>
                {(selected.acquisition_status === 'face_verify_retry' || selected.visage_motif?.includes('erreur_rekognition') || selected.visage_motif?.includes('failed')) && (
                  <button className="btn btn-ghost" disabled={busy} onClick={() => action(() => api.reprendreFaceVerify(selected.id))}>↺ Reprendre faciale</button>
                )}
                <button className="btn btn-success" disabled={busy || !selected.wa_agent} onClick={() => handleCallTerrain(selected)}>
                  {selected.wa_agent ? '📞 Appeler terrain' : 'Pas de WA'}
                </button>
                <button className="btn btn-danger" disabled={busy} onClick={() => { setRejetTarget(selected); setSelected(null); }}>✕ Rejeter</button>
                <button className="btn btn-primary" disabled={busy} onClick={() => action(() => api.accepterDossier(selected.id), () => {
                  localStorage.setItem('gsm_dossier_id', selected.id);
                  window.location.href = '/gsm-saisie?dossier=' + selected.id;
                })}>✓ Accepter</button>
              </>
            )
          }
        />
      )}

      {rejetTarget && (
        <Modal title={`Rejeter ${rejetTarget.id}`} onClose={() => { setRejetTarget(null); setSelectedMotif(''); setCustomMotif(''); setMotifSearch(''); setMotifPage(1); }} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setRejetTarget(null); setSelectedMotif(''); setCustomMotif(''); setMotifSearch(''); setMotifPage(1); }}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={busy || (!selectedMotif || (selectedMotif === 'autre' && !customMotif.trim()))} onClick={() => action(async () => {
              const finalReason = selectedMotif === 'autre' ? customMotif.trim() : selectedMotif;
              if (!finalReason) return;
              if (selectedMotif === 'autre' && finalReason && !motifs.includes(finalReason)) {
                await api.setRejectionMotifs([...motifs, finalReason]);
              }
              await api.rejeterDossier(rejetTarget.id, finalReason);
              setRejetTarget(null);
              setSelectedMotif('');
              setCustomMotif('');
              localStorage.setItem('gsm_dossier_id', rejetTarget.id);
              window.location.href = '/gsm-saisie?dossier=' + rejetTarget.id;
            })}>Confirmer</button>
          </>
        }>
          <div className="field">
            <label htmlFor="motif-search">Rechercher un motif<span className="req">*</span></label>
            <input
              id="motif-search"
              type="search"
              value={motifSearch}
              onChange={e => { setMotifSearch(e.target.value); setMotifPage(1); }}
              placeholder="Rechercher dans les motifs…"
            />
          </div>
          <div className="rejection-motif-table-wrap">
            <table className="rejection-motif-table">
              <thead>
                <tr><th aria-label="Sélection" /><th>Motif</th></tr>
              </thead>
              <tbody>
                {motifPageItems.map(motif => (
                  <tr key={motif} className={selectedMotif === motif ? 'selected' : ''}>
                    <td>
                      <input
                        type="checkbox"
                        checked={selectedMotif === motif}
                        onChange={() => setSelectedMotif(selectedMotif === motif ? '' : motif)}
                        aria-label={`Sélectionner le motif ${motif}`}
                      />
                    </td>
                    <td onClick={() => setSelectedMotif(selectedMotif === motif ? '' : motif)}>{motif}</td>
                  </tr>
                ))}
                {motifPage === 1 && <tr className={selectedMotif === 'autre' ? 'selected' : ''}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selectedMotif === 'autre'}
                      onChange={() => setSelectedMotif(selectedMotif === 'autre' ? '' : 'autre')}
                      aria-label="Sélectionner un autre motif"
                    />
                  </td>
                  <td onClick={() => setSelectedMotif(selectedMotif === 'autre' ? '' : 'autre')}>Autre</td>
                </tr>}
                {!motifPageItems.length && <tr><td colSpan={2}>Aucun motif trouvé.</td></tr>}
              </tbody>
            </table>
          </div>
          <div className="rejection-motif-pagination">
            <span>{filteredMotifs.length + 1} motif(s) • Page {motifPage} sur {motifPageCount}</span>
            <div>
              <button className="btn btn-ghost btn-sm" disabled={motifPage <= 1} onClick={() => setMotifPage(page => page - 1)}>Précédente</button>
              <button className="btn btn-ghost btn-sm" disabled={motifPage >= motifPageCount} onClick={() => setMotifPage(page => page + 1)}>Suivante</button>
            </div>
          </div>
          {selectedMotif === 'autre' && (
            <div className="field" style={{ marginTop: '.75rem' }}>
              <label>Préciser le motif</label>
              <textarea value={customMotif} onChange={e => setCustomMotif(e.target.value)} placeholder="Saisissez un motif puis validez" autoFocus />
            </div>
          )}
        </Modal>
      )}
      {livenessDossier && (
        <Modal title={`Vérification faciale — ${livenessDossier.id}`} onClose={() => setLivenessDossier(null)}>
          <FaceLivenessCheck
            dossierId={livenessDossier.id}
            compact
            onClose={() => setLivenessDossier(null)}
            onComplete={() => {
              setLivenessDossier(null);
              refetch();
            }}
          />
        </Modal>
      )}
      {preview && (
        <Modal title={preview.title || 'Aperçu'} onClose={() => setPreview(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <img src={preview.imgs[preview.idx]} alt={preview.title || `Aperçu ${preview.idx+1}`} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.max(0, p.idx - 1) } : p)} disabled={preview.idx <= 0}>← Précédent</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.min(p.imgs.length - 1, p.idx + 1) } : p)} disabled={preview.idx >= preview.imgs.length - 1}>Suivant →</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Mes Dossiers ───────────────────────────────────────────────────────────────
export function AgentMesDossiers() {
  const [debut, setDebut] = useState(''); const [fin, setFin] = useState('');
  const [statut, setStatut] = useState<DossierStatut|''>(''); const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'statut' | 'reference' | 'reception'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const dSearch = useDebounce(search, 350);
  const [sel, setSel] = useState<Dossier|null>(null);
  const [preview, setPreview] = useState<{ imgs: string[]; idx: number; title?: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const { data, loading, error, refetch } = useFetch(() => api.getDossiers({ debut, fin, statut: statut||undefined, search: dSearch, limit: 300, scope: 'mine' }), [debut, fin, statut, dSearch]);

  const handleCallTerrain = async (dossier: Dossier) => {
    if (!dossier.wa_agent) {
      setSuccess(null);
      setErr('Numéro terrain introuvable pour ce dossier.');
      return;
    }
    setErr(null);
    setSuccess(null);
    setBusy(true);
    try {
      const result = await api.callTerrain(dossier.wa_agent, dossier.numero_mtn);
      setSuccess(result.message || 'Appel lancé vers l’agent terrain.');
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Erreur lors du lancement de l’appel.');
    } finally {
      setBusy(false);
    }
  };

  const handleFinalizeGsm = (dossier: Dossier) => {
    localStorage.setItem('gsm_dossier_id', dossier.id);
    window.location.href = '/gsm-saisie?dossier=' + encodeURIComponent(dossier.id);
  };

  const sortedDossiers = useMemo(() => {
    const rows = [...(data?.dossiers ?? [])];
    const weights: Record<string, number> = { en_attente: 0, en_cours: 1, accepte: 2, rejete: 3 };
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') {
        cmp = String(a.date || '').localeCompare(String(b.date || ''));
      } else if (sortBy === 'statut') {
        cmp = (weights[a.statut] ?? 99) - (weights[b.statut] ?? 99);
      } else if (sortBy === 'reference') {
        cmp = String(a.id).localeCompare(String(b.id));
      } else if (sortBy === 'reception') {
        cmp = String(a.heure_reception || '').localeCompare(String(b.heure_reception || ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data?.dossiers, sortBy, sortDir]);

  const STATUTS: { value: DossierStatut|''; label: string }[] = [
    { value: '', label: 'Tous statuts' }, { value: 'en_cours', label: 'En cours' },
    { value: 'accepte', label: 'Acceptés' }, { value: 'rejete', label: 'Rejetés' },
  ];

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mes dossiers</h1><p className="page-sub">Historique de vos dossiers traités.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Recherche</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Référence…" /></div>
          <div className="field"><label>Statut</label><select value={statut} onChange={e => setStatut(e.target.value as DossierStatut|'')}>{STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
          <div className="field"><label>Trier par</label><select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="date">Date</option>
            <option value="statut">Statut</option>
            <option value="reference">Référence</option>
            <option value="reception">Réception</option>
          </select></div>
          <div className="field"><label>Ordre</label><select value={sortDir} onChange={e => setSortDir(e.target.value as typeof sortDir)}>
            <option value="desc">Descendant</option>
            <option value="asc">Ascendant</option>
          </select></div>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      {loading ? <LoadingCenter /> : <div className="card"><div style={{ fontSize:12, color:'var(--ink-3)', marginBottom:'.75rem' }}>{sortedDossiers.length} résultat(s)</div><DossiersTable dossiers={sortedDossiers} onSelect={setSel} showAgent={false} rowActions={d => (
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <button className="btn btn-success btn-sm" disabled={!d.wa_agent} onClick={(e) => { e.stopPropagation(); handleCallTerrain(d); }}>
            {d.wa_agent ? 'Appeler terrain' : 'Pas de WA'}
          </button>
          {(d.statut === 'accepte' && d.gsm_complete !== 1) ? (
            <button className="btn btn-primary btn-sm" onClick={(e) => { e.stopPropagation(); handleFinalizeGsm(d); }}>
              Finaliser GSM
            </button>
          ) : null}
        </div>
      )} /></div>}
      {sel && (
        <DossierIdentityModal
          dossier={sel}
          onClose={() => setSel(null)}
          onZoom={(imgs, idx, title) => setPreview({ imgs, idx, title })}
          footer={
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button className="btn btn-success" disabled={busy || !sel.wa_agent} onClick={() => handleCallTerrain(sel)}>
                {sel.wa_agent ? '📞 Appeler terrain' : 'Pas de WA'}
              </button>
              {(sel.statut === 'accepte' && sel.gsm_complete !== 1) ? (
                <button className="btn btn-primary" disabled={busy} onClick={() => handleFinalizeGsm(sel)}>
                  Finaliser GSM
                </button>
              ) : null}
            </div>
          }
        />
      )}
      {preview && (
        <Modal title={preview.title || 'Aperçu'} onClose={() => setPreview(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <img src={preview.imgs[preview.idx]} alt={preview.title || `Aperçu ${preview.idx+1}`} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.max(0, p.idx - 1) } : p)} disabled={preview.idx <= 0}>← Précédent</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.min(p.imgs.length - 1, p.idx + 1) } : p)} disabled={preview.idx >= preview.imgs.length - 1}>Suivant →</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Acquisition terrain ────────────────────────────────────────────────────────
const COUNTRIES = [
  { code: 'CG', label: 'Congo' },
  { code: 'BJ', label: 'Bénin' },
  { code: 'CI', label: "Côte d'Ivoire" },
  { code: 'CM', label: 'Cameroun' },
  { code: 'GW', label: 'Guinée Bissau' },
  { code: 'GN', label: 'Guinée' },
];

export function AgentAcquisition() {
  const [f, setF] = useState({
    wa_agent:'', username_agent:'', fonction_agent:'', zone_agent:'', numero_mtn:'', country:'',
    nom_titulaire:'', prenom_titulaire:'', date_naissance:'', lieu_naissance:'', autre_numero:'',
    nom_pere:'', nom_mere:'', adresse_complete:'', numero_cni:'', sexe:'', nationalite:'', profession:''
  });
  const [recto, setRecto] = useState<File|null>(null); const [verso, setVerso] = useState<File|null>(null);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null); const [success, setSuccess] = useState<string|null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr(null); setSuccess(null);
    if (!recto || !verso) { setErr('Photos recto et verso obligatoires'); return; }
    if (!f.country) { setErr('Sélectionnez un pays'); return; }
    if (!f.nom_titulaire.trim() || !f.prenom_titulaire.trim() || !f.date_naissance.trim() || !f.lieu_naissance.trim() || !f.nom_pere.trim() || !f.nom_mere.trim()) {
      setErr('Les informations du titulaire et des parents sont obligatoires'); return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k,v]) => fd.append(k, v));
      fd.append('photo_recto', recto); fd.append('photo_verso', verso);
      const r = await api.submitDossierPublic(fd);
      setSuccess(`Dossier déposé avec succès — Réf. ${r.ref}`);
      setF({
        wa_agent:'', username_agent:'', fonction_agent:'', zone_agent:'', numero_mtn:'', country:'',
        nom_titulaire:'', prenom_titulaire:'', date_naissance:'', lieu_naissance:'', autre_numero:'',
        nom_pere:'', nom_mere:'', adresse_complete:'', numero_cni:'', sexe:'', nationalite:'', profession:''
      });
      setRecto(null); setVerso(null);
      (e.target as HTMLFormElement).reset();
    } catch(e2) { setErr(e2 instanceof Error ? e2.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Acquisition KYC terrain</h1><p className="page-sub">Saisissez les informations et les pièces d'identité du client.</p></div></div>
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      <div className="card" style={{ maxWidth: 620 }}>
        <form onSubmit={submit} className="form-grid">
          <div className="form-row">
            <div className="field"><label>WhatsApp agent<span className="req">*</span></label>
              <input
                value={formatPhoneLike(f.wa_agent, f.country, PHONE_CONFIG[f.country]?.digitCount ?? 9)}
                onChange={e => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, PHONE_CONFIG[f.country]?.digitCount ?? 9);
                  setF(x => ({ ...x, wa_agent: digits }));
                }}
                placeholder={PHONE_CONFIG[f.country]?.placeholder ?? 'Sélectionnez un pays'}
                inputMode="numeric"
                required
              />
            </div>
            <div className="field"><label>Nom agent<span className="req">*</span></label><input value={f.username_agent} onChange={e => setF(x => ({...x, username_agent: e.target.value}))} placeholder="Nom complet" required /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Fonction</label><input value={f.fonction_agent} onChange={e => setF(x => ({...x, fonction_agent: e.target.value}))} placeholder="Fonction" /></div>
            <div className="field"><label>Zone</label><input value={f.zone_agent} onChange={e => setF(x => ({...x, zone_agent: e.target.value}))} placeholder="Zone" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Numéro MTN client<span className="req">*</span></label><input value={f.numero_mtn} onChange={e => setF(x => ({...x, numero_mtn: e.target.value}))} placeholder="Numéro MTN" required /></div>
            <div className="field"><label>Pays<span className="req">*</span></label>
              <select value={f.country} onChange={e => setF(x => ({...x, country: e.target.value, wa_agent: ''}))} required>
                <option value="">Sélectionner…</option>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <h3 style={{ margin: '0 0 .75rem', fontSize: '1rem' }}>Informations du titulaire</h3>
            <div className="form-row">
              <div className="field"><label>Nom titulaire<span className="req">*</span></label><input value={f.nom_titulaire} onChange={e => setF(x => ({...x, nom_titulaire: e.target.value}))} placeholder="Nom du titulaire" required /></div>
              <div className="field"><label>Prénom titulaire<span className="req">*</span></label><input value={f.prenom_titulaire} onChange={e => setF(x => ({...x, prenom_titulaire: e.target.value}))} placeholder="Prénom du titulaire" required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Date de naissance<span className="req">*</span></label><input type="date" value={f.date_naissance} onChange={e => setF(x => ({...x, date_naissance: e.target.value}))} required /></div>
              <div className="field"><label>Lieu de naissance<span className="req">*</span></label><input value={f.lieu_naissance} onChange={e => setF(x => ({...x, lieu_naissance: e.target.value}))} placeholder="Lieu de naissance" required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Nom du père<span className="req">*</span></label><input value={f.nom_pere} onChange={e => setF(x => ({...x, nom_pere: e.target.value}))} placeholder="Nom du père" required /></div>
              <div className="field"><label>Nom de la mère<span className="req">*</span></label><input value={f.nom_mere} onChange={e => setF(x => ({...x, nom_mere: e.target.value}))} placeholder="Nom de la mère" required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Adresse complète</label><input value={f.adresse_complete} onChange={e => setF(x => ({...x, adresse_complete: e.target.value}))} placeholder="Adresse complète" /></div>
              <div className="field"><label>Numéro CNI</label><input value={f.numero_cni} onChange={e => setF(x => ({...x, numero_cni: e.target.value}))} placeholder="Numéro CNI" /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Sexe</label><select value={f.sexe} onChange={e => setF(x => ({...x, sexe: e.target.value}))}><option value="">Sélectionner…</option><option value="M">Masculin</option><option value="F">Féminin</option></select></div>
              <div className="field"><label>Nationalité</label><input value={f.nationalite} onChange={e => setF(x => ({...x, nationalite: e.target.value}))} placeholder="Nationalité" /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Profession</label><input value={f.profession} onChange={e => setF(x => ({...x, profession: e.target.value}))} placeholder="Profession" /></div>
              <div className="field"><label>Autre numéro</label><input value={f.autre_numero} onChange={e => setF(x => ({...x, autre_numero: e.target.value}))} placeholder="Autre numéro" /></div>
            </div>
          </div>

          <div className="form-row">
            <div className="field"><label>Photo recto CNI<span className="req">*</span></label><input type="file" accept="image/*" onChange={e => setRecto(e.target.files?.[0]??null)} required /></div>
            <div className="field"><label>Photo verso CNI<span className="req">*</span></label><input type="file" accept="image/*" onChange={e => setVerso(e.target.files?.[0]??null)} required /></div>
          </div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>{loading ? 'Envoi en cours…' : 'Envoyer le dossier'}</button>
        </form>
      </div>
    </>
  );
}