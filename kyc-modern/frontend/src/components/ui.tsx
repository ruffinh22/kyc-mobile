import { ReactNode, useEffect } from 'react';
import { DossierStatut, Role } from '../types';

// ── Spinner / Loading / Empty ──────────────────────────────────────────────────
export function Spinner() { return <div className="spin" role="status" />; }
export function LoadingCenter({ label = 'Chargement…' }: { label?: string }) {
  return <div className="loading-center"><div className="spin" style={{ width: 28, height: 28 }} /><span>{label}</span></div>;
}
export function EmptyState({ icon = '📭', title, body }: { icon?: string; title: string; body?: string }) {
  return <div className="empty"><div className="empty-icon">{icon}</div><p className="empty-title">{title}</p>{body && <p className="empty-body">{body}</p>}</div>;
}

// ── Alert ──────────────────────────────────────────────────────────────────────
const ALERT_ICONS = { error: '⚠', success: '✓', info: 'ℹ', warn: '⚡' } as const;
export function Alert({ kind, children }: { kind: 'error' | 'success' | 'info' | 'warn'; children: ReactNode }) {
  return <div className={`alert alert-${kind === 'error' ? 'err' : kind}`}><span>{ALERT_ICONS[kind]}</span><div>{children}</div></div>;
}

// ── Modal ──────────────────────────────────────────────────────────────────────
export function Modal({ title, onClose, children, footer }: { title: string; onClose(): void; children: ReactNode; footer?: ReactNode }) {
  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);
  return (
    <div className="modal-bg" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="modal">
        <div className="modal-header">
          <h3 className="modal-title">{title}</h3>
          <button className="btn-icon" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">{children}</div>
        {footer && <div className="modal-footer">{footer}</div>}
      </div>
    </div>
  );
}

// ── Badges ─────────────────────────────────────────────────────────────────────
const STATUT_LABELS: Record<DossierStatut, string> = { en_attente: 'En attente', en_cours: 'En cours', accepte: 'Accepté', rejete: 'Rejeté' };
const STATUT_CLS:   Record<DossierStatut, string> = { en_attente: 'b-attente', en_cours: 'b-cours', accepte: 'b-accepte', rejete: 'b-rejete' };
export function StatutBadge({ statut }: { statut: DossierStatut }) {
  return <span className={`badge ${STATUT_CLS[statut]}`}>{STATUT_LABELS[statut]}</span>;
}

const ROLE_LABELS: Record<Role, string> = { agent: 'Agent', superviseur: 'Superviseur', admin: 'Admin' };
export function RoleBadge({ role }: { role: Role }) {
  return <span className={`badge b-${role}`}>{ROLE_LABELS[role]}</span>;
}

export function PresenceBadge({ statut }: { statut: string }) {
  if (statut === 'offline') return <span className="badge" style={{ background: 'var(--surface-3)', color: 'var(--ink-3)' }}>Hors ligne</span>;
  return <span className={`badge b-${statut}`}>{statut === 'online' ? 'En ligne' : 'En pause'}</span>;
}

// ── StatCard ───────────────────────────────────────────────────────────────────
export function StatCard({ label, value, sub, variant = 'default' }: { label: string; value: number | string; sub?: string; variant?: 'default' | 'attente' | 'cours' | 'accepte' | 'rejete' }) {
  return (
    <div className={`stat-card ${variant !== 'default' ? `stat-${variant}` : ''}`}>
      <span className="stat-label">{label}</span>
      <span className="stat-value">{value}</span>
      {sub && <span className="stat-sub">{sub}</span>}
    </div>
  );
}

// ── Confirm modal ──────────────────────────────────────────────────────────────
export function ConfirmModal({ title, message, onConfirm, onCancel, danger = false, loading = false }: {
  title: string; message: string; onConfirm(): void; onCancel(): void; danger?: boolean; loading?: boolean;
}) {
  return (
    <Modal title={title} onClose={onCancel} footer={
      <>
        <button className="btn btn-ghost btn-sm" onClick={onCancel} disabled={loading}>Annuler</button>
        <button className={`btn ${danger ? 'btn-danger' : 'btn-primary'} btn-sm`} onClick={onConfirm} disabled={loading}>
          {loading ? <Spinner /> : 'Confirmer'}
        </button>
      </>
    }>
      <p style={{ fontSize: 13.5, color: 'var(--ink-2)' }}>{message}</p>
    </Modal>
  );
}
