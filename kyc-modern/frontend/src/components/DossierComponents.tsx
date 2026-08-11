import { useState, useEffect } from 'react';
import { Dossier } from '../types';
import { StatutBadge, Modal, EmptyState, StatCard } from './ui';
import { photoUrlWithToken, getDistributionTiming } from '../services/api';
import { useAuth } from '../context/AuthContext';

function parseDossierTime(value: string | null): number | null {
  if (!value) return null;
  const candidates = [value, value.replace(' ', 'T')];
  for (const candidate of candidates) {
    const parsed = Date.parse(candidate);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return null;
}

function formatDossierDate(value: string | null): string {
  if (!value) return '—';
  const trimmed = value.trim();
  if (!trimmed) return '—';
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) return trimmed;
  return new Date(parsed).toLocaleDateString('fr-FR', {
    day: '2-digit', month: '2-digit', year: 'numeric',
  });
}

function formatProcessingDuration(dossier: Dossier, now = Date.now()): string {
  const assignedAt = Number(dossier.assigne_le ?? 0);
  const closedAt = Number(dossier.closed_at ?? 0);
  const startCandidate = assignedAt > 0
    ? assignedAt * 1000
    : parseDossierTime(dossier.heure_prise) ?? (dossier.created_at ? dossier.created_at * 1000 : null);

  if (dossier.statut === 'en_attente' && assignedAt <= 0) return 'En attente';
  if (!startCandidate) return 'Non calculable';

  const endCandidate = dossier.statut === 'en_cours'
    ? now
    : (closedAt > 0
      ? closedAt * 1000
      : parseDossierTime(dossier.heure_cloture));

  if (!endCandidate || endCandidate < startCandidate) return 'Non calculable';

  const totalSeconds = Math.floor((endCandidate - startCandidate) / 1000);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes < 60) {
    return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
  }

  const hours = Math.floor(minutes / 60);
  const remMinutes = minutes % 60;
  if (hours < 24) {
    return remMinutes > 0 ? `${hours}h ${remMinutes}m` : `${hours}h`;
  }

  const days = Math.floor(hours / 24);
  const remHours = hours % 24;
  return remHours > 0 ? `${days}j ${remHours}h` : `${days}j`;
}

function formatCountdown(seconds: number): string {
  const safe = Math.max(0, Math.floor(seconds));
  const minutes = Math.floor(safe / 60);
  const secs = safe % 60;
  return `${String(minutes).padStart(2, '0')}:${String(secs).padStart(2, '0')}`;
}

function getAutoDistributionRemainingSeconds(dossier: Dossier, now: number, abandonSec: number): number | null {
  if (dossier.statut !== 'en_cours' || !dossier.assigne_le || dossier.assigne_le <= 0) return null;
  const remaining = Math.floor(abandonSec - ((now / 1000) - dossier.assigne_le));
  return remaining > 0 ? remaining : 0;
}

function AutoDistributionCountdown({ dossier, abandonSec, now }: { dossier: Dossier; abandonSec: number; now: number }) {
  const remaining = getAutoDistributionRemainingSeconds(dossier, now, abandonSec);
  if (remaining === null) return null;

  const isCritical = remaining <= 30;
  return (
    <span
      className="badge"
      title={`Redistribution automatique dans ${remaining}s`}
      style={{
        background: isCritical ? 'rgba(220, 38, 38, 0.14)' : 'rgba(249, 115, 22, 0.16)',
        color: isCritical ? 'var(--danger)' : 'var(--warning)',
        border: isCritical ? '1px solid rgba(220, 38, 38, 0.22)' : '1px solid rgba(249, 115, 22, 0.2)',
      }}
    >
      ⏳ {formatCountdown(remaining)}
    </span>
  );
}

// ── Dossiers Table ─────────────────────────────────────────────────────────────
export function DossiersTable({ dossiers, onSelect, showAgent = true, showDate = true, rowActions }: {
  dossiers: Dossier[]; onSelect(d: Dossier): void; showAgent?: boolean; showDate?: boolean; rowActions?: (dossier: Dossier) => React.ReactNode;
}) {
  const [now, setNow] = useState(Date.now());
  const [abandonSec, setAbandonSec] = useState(120);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    getDistributionTiming().then((data) => {
      if (!mounted) return;
      setAbandonSec(data?.abandon_sec ?? 120);
    }).catch(() => {
      if (mounted) setAbandonSec(120);
    });
    return () => { mounted = false; };
  }, []);

  if (!dossiers.length) return <EmptyState icon="📭" title="Aucun dossier" body="Aucun résultat ne correspond aux filtres." />;

  const counts = dossiers.reduce((acc, d) => {
    if (d.statut === 'en_attente') acc.en_attente += 1;
    else if (d.statut === 'en_cours') acc.en_cours += 1;
    else if (d.statut === 'accepte') acc.accepte += 1;
    else if (d.statut === 'rejete') acc.rejete += 1;
    return acc;
  }, { en_attente: 0, en_cours: 0, accepte: 0, rejete: 0 });

  return (
    <div className="dossier-table-shell">
      <div className="stats-grid" style={{ marginBottom: '1.25rem' }}>
        <StatCard label="Total" value={dossiers.length} />
        <StatCard label="En attente" value={counts.en_attente} variant="attente" />
        <StatCard label="En cours" value={counts.en_cours} variant="cours" />
        <StatCard label="Acceptés" value={counts.accepte} variant="accepte" />
        <StatCard label="Rejetés" value={counts.rejete} variant="rejete" />
      </div>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th>Référence</th>
              <th>Numéro</th>
              {showAgent && <th>Agent</th>}
              {showDate  && <th>Date</th>}
              <th>Réception</th>
              <th>Temps de traitement</th>
              <th>Statut</th>
              {rowActions && <th style={{ textAlign: 'right' }}>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {dossiers.map(d => (
              <tr key={d.id} className="clickable" onClick={() => onSelect(d)} style={{ cursor: 'pointer' }}>
                <td style={{ fontFamily: 'monospace', fontSize: 12.5 }}>{d.id}</td>
                <td style={{ fontFamily: 'monospace' }}>{d.masque ? '•••••••••' : (d.numero_mtn || '—')}</td>
                {showAgent && <td>{d.agent_saisie || (d.statut === 'en_attente' ? 'Non attribué' : '—')}</td>}
                {showDate  && <td>{formatDossierDate(d.date)}</td>}
                <td>{d.heure_reception || '—'}</td>
                <td>{formatProcessingDuration(d, now)}</td>
                <td>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem', flexWrap: 'wrap' }}>
                    <StatutBadge statut={d.statut} />
                    <AutoDistributionCountdown dossier={d} abandonSec={abandonSec} now={now} />
                  </div>
                </td>
                {rowActions && (
                  <td onClick={e => e.stopPropagation()} style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', gap: '.4rem', flexWrap: 'wrap', justifyContent: 'flex-end' }}>
                      {rowActions(d)}
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Dossier Detail Modal ───────────────────────────────────────────────────────
export function DossierDetailModal({ dossier, onClose, actions }: {
  dossier: Dossier; onClose(): void; actions?: React.ReactNode;
}) {
  const { user } = useAuth();
  const [errPhoto, setErrPhoto] = useState<Record<string, boolean>>({});
  const [preview, setPreview] = useState<{ imgs: string[]; idx: number } | null>(null);
  const [now, setNow] = useState(Date.now());
  const [abandonSec, setAbandonSec] = useState(120);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(id);
  }, []);

  useEffect(() => {
    let mounted = true;
    getDistributionTiming().then((data) => {
      if (!mounted) return;
      setAbandonSec(data?.abandon_sec ?? 120);
    }).catch(() => {
      if (mounted) setAbandonSec(120);
    });
    return () => { mounted = false; };
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
  const canSeePhoto = user?.role !== 'agent'
    || dossier.statut === 'en_attente'
    || (dossier.agent_saisie === user?.matricule && ['en_cours', 'accepte', 'rejete'].includes(dossier.statut));

  return (
    <Modal title={`Dossier ${dossier.id}`} onClose={onClose} footer={actions}>
      <div className="form-grid">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', flexWrap: 'wrap' }}>
          <StatutBadge statut={dossier.statut} />
          <AutoDistributionCountdown dossier={dossier} abandonSec={abandonSec} now={now} />
          {dossier.score_visage !== null && dossier.score_visage !== undefined && (
            <span
              className="badge"
              style={{
                background: dossier.visage_match ? 'var(--success-soft)' : 'var(--danger-soft)',
                color: dossier.visage_match ? 'var(--success)' : 'var(--danger)',
              }}
            >
              Visage {dossier.score_visage}% {dossier.visage_match ? '✓' : '✗'}
            </span>
          )}
        </div>

        <div className="detail-grid">
          <div className="detail-item"><span className="detail-label">Numéro MTN</span><span className="detail-value">{dossier.masque ? '***' : dossier.numero_mtn}</span></div>
          <div className="detail-item"><span className="detail-label">Date</span><span className="detail-value">{formatDossierDate(dossier.date)}</span></div>
          <div className="detail-item"><span className="detail-label">Agent terrain</span><span className="detail-value">{dossier.username_agent || '—'}</span></div>
          <div className="detail-item"><span className="detail-label">Fonction</span><span className="detail-value">{dossier.fonction_agent || '—'}</span></div>
          <div className="detail-item"><span className="detail-label">Zone</span><span className="detail-value">{dossier.zone_agent || '—'}</span></div>
          <div className="detail-item"><span className="detail-label">Agent traitant</span><span className="detail-value">{dossier.agent_saisie || '—'}</span></div>
          <div className="detail-item"><span className="detail-label">Réception</span><span className="detail-value">{dossier.heure_reception || '—'}</span></div>
          <div className="detail-item"><span className="detail-label">Prise en charge</span><span className="detail-value">{dossier.heure_prise || '—'}</span></div>
          <div className="detail-item"><span className="detail-label">Temps de traitement</span><span className="detail-value">{formatProcessingDuration(dossier, now)}</span></div>
          <div className="detail-item"><span className="detail-label">Clôture</span><span className="detail-value">{dossier.heure_cloture || '—'}</span></div>
          {dossier.resultat_crm && <div className="detail-item"><span className="detail-label">Résultat CRM</span><span className="detail-value">{dossier.resultat_crm}</span></div>}
          {dossier.raison_rejet && <div className="detail-item" style={{ gridColumn: '1/-1' }}><span className="detail-label">Raison rejet</span><span className="detail-value" style={{ color: 'var(--danger)' }}>{dossier.raison_rejet}</span></div>}
          {dossier.transfert_message && <div className="detail-item" style={{ gridColumn: '1/-1' }}><span className="detail-label">Message transfert</span><span className="detail-value">{dossier.transfert_message}</span></div>}
          {dossier.note_superviseur && <div className="detail-item" style={{ gridColumn: '1/-1' }}><span className="detail-label">Note superviseur</span><span className="detail-value">{dossier.note_superviseur}</span></div>}
        </div>

        {canSeePhoto && (dossier.photo_recto || dossier.photo_verso || dossier.photo_live) && (
          <div>
            <div className="detail-label" style={{ marginBottom: '.5rem' }}>Pièces d'identité</div>
            <div className="photo-grid">
              {(() => {
                const types = ['recto','verso','live'] as const;
                const imgs = types.map(t => dossier[`photo_${t}` as 'photo_recto'|'photo_verso'|'photo_live'] ? photoUrlWithToken(dossier.id, t) : null).filter(Boolean) as string[];
                return types.map(type => {
                  const field = `photo_${type}` as 'photo_recto' | 'photo_verso' | 'photo_live';
                  if (!dossier[field]) return null;
                  const url = photoUrlWithToken(dossier.id, type);
                  const index = imgs.indexOf(url);
                  return (
                    <div className="photo-thumb" key={type} title={`Photo ${type}`}>
                      {!errPhoto[type] ? (
                        <img
                          src={url}
                          alt={type}
                          onError={() => setErrPhoto(s => ({ ...s, [type]: true }))}
                          onClick={() => setPreview({ imgs, idx: index >= 0 ? index : 0 })}
                          style={{ cursor: 'zoom-in' }}
                        />
                      ) : (
                        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', fontSize: 12, color: 'var(--ink-4)' }}>Indisponible</div>
                      )}
                    </div>
                  );
                });
              })()}
            </div>
          </div>
        )}
        {preview && (
          <Modal title={`Aperçu`} onClose={() => setPreview(null)}>
            <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', alignItems: 'center' }}>
              <div style={{ display: 'flex', justifyContent: 'center' }}>
                <img src={preview.imgs[preview.idx]} alt={`Aperçu ${preview.idx+1}`} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' }} />
              </div>
              <div style={{ display: 'flex', gap: '.5rem' }}>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.max(0, p.idx - 1) } : p)} disabled={preview.idx <= 0}>← Précédent</button>
                <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.min(p.imgs.length - 1, p.idx + 1) } : p)} disabled={preview.idx >= preview.imgs.length - 1}>Suivant →</button>
              </div>
            </div>
          </Modal>
        )}
      </div>
    </Modal>
  );
}