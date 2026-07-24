import { useAuth } from '../../context/AuthContext';
import { Role } from '../../types';

// ── Topbar MTN ─────────────────────────────────────────────────────────────────
const ROLE_LABELS: Record<Role, string> = {
  agent: 'Agent',
  superviseur: 'Superviseur',
  admin: 'Administrateur',
};

export function Topbar() {
  const { user, logout } = useAuth();
  const initials = user
    ? `${(user.prenom[0] ?? '').toUpperCase()}${(user.nom[0] ?? '').toUpperCase()}`
    : '??';

  return (
    <header className="topbar">
      {/* Brand MTN */}
      <div className="topbar-brand">
        {/* Logo ovale MTN stylisé en CSS */}
        <div className="topbar-logo">
          <span className="topbar-logo-text">MTN</span>
        </div>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '.375rem' }}>
            <span className="topbar-title">KYC</span>
          </div>
          <div className="topbar-subtitle">Back Office — Plateforme de vérification</div>
        </div>
      </div>

      {/* Right : user info */}
      {user && (
        <div className="topbar-right">
          <span className={`role-chip ${user.role}`}>{ROLE_LABELS[user.role]}</span>
          <div className="topbar-avatar">{initials}</div>
          <div>
            <div className="topbar-name">{user.prenom} {user.nom}</div>
          </div>
          <button
            className="btn btn-ghost btn-sm"
            style={{ color: 'rgba(255,255,255,.75)', borderColor: 'rgba(255,255,255,.2)', fontSize: 12 }}
            onClick={() => logout()}
          >
            Déconnexion
          </button>
        </div>
      )}
    </header>
  );
}

// ── Sidebar MTN ────────────────────────────────────────────────────────────────
interface NavSection {
  label?: string;
  items: { key: string; icon: string; label: string }[];
}

const NAV: Record<Role, NavSection[]> = {
  agent: [
    {
      items: [
        { key: 'dashboard',    icon: '📊', label: 'Tableau de bord' },
        { key: 'file-attente', icon: '📥', label: "File d'attente" },
        { key: 'mes-dossiers', icon: '📁', label: 'Mes dossiers' },
        { key: 'video-call',   icon: '🎥', label: 'Appel vidéo' },
      ],
    },
    {
      label: 'GSM · Gross Add',
      items: [
        { key: 'gsm-saisie',     icon: '✍️',  label: 'Saisie GSM' },
        { key: 'gsm-tableau',    icon: '📈', label: 'Mon tableau' },
        { key: 'gsm-historique', icon: '🕓', label: 'Mon historique' },
        { key: 'gsm-perfs',      icon: '🏆', label: 'Mes performances' },
      ],
    },
    {
      label: 'Divers',
      items: [
        { key: 'planning',    icon: '📅', label: 'Mon planning' },
        { key: 'qualite',     icon: '⭐', label: 'Notes qualité' },
        { key: 'acquisition', icon: '📷', label: 'Acquisition terrain' },
      ],
    },
  ],

  superviseur: [
    {
      items: [
        { key: 'dashboard',      icon: '📊', label: 'Tableau de bord' },
        { key: 'file-attente',   icon: '📥', label: "File d'attente" },
        { key: 'historique',     icon: '🕓', label: 'Historique' },
        { key: 'donnees-heures', icon: '⏱',  label: 'Données par heure' },
      ],
    },
    {
      label: 'Équipe',
      items: [
        { key: 'presence',          icon: '🟢', label: 'Présence' },
        { key: 'performance',       icon: '🏆', label: 'Performance agents' },
        { key: 'distribution',      icon: '🔀', label: 'Distribution' },
        { key: 'flux',              icon: '📉', label: 'Flux & Prédiction' },
      ],
    },
    {
      label: 'GSM & Qualité',
      items: [
        { key: 'compilation-gsm', icon: '📋', label: 'Compilation GSM' },
        { key: 'notes-qualite',   icon: '⭐', label: 'Notes qualité' },
      ],
    },
    {
      label: 'Planification',
      items: [
        { key: 'planning',          icon: '📅', label: 'Planning équipe' },
        { key: 'planning-managers', icon: '🗓',  label: 'Planning managers' },
      ],
    },
    {
      label: 'Captures',
      items: [
        { key: 'captures', icon: '🔍', label: 'Recherche captures' },
      ],
    },
    {
      label: 'Export',
      items: [
        { key: 'reporting', icon: '📤', label: 'Reporting / Export' },
      ],
    },
  ],

  admin: [
    {
      items: [
        { key: 'dashboard', icon: '📊', label: 'Tableau de bord' },
        { key: 'comptes',   icon: '👥', label: 'Comptes' },
        { key: 'sessions',  icon: '🔐', label: 'Sessions actives' },
        { key: 'audit',     icon: '📜', label: "Journal d'audit" },
      ],
    },
    {
      label: 'Configuration',
      items: [
        { key: 'distribution',  icon: '🔀', label: 'Distribution' },
        { key: 'habilitations', icon: '🔑', label: 'Habilitations' },
        { key: 'referentiels',  icon: '📚', label: 'Référentiels GSM' },
      ],
    },
    {
      label: 'Maintenance',
      items: [
        { key: 'stockage', icon: '💾', label: 'Stockage' },
        { key: 'purge',    icon: '🗑',  label: 'Purge données' },
      ],
    },
    {
      label: 'Captures',
      items: [
        { key: 'captures', icon: '🔍', label: 'Recherche captures' },
      ],
    },
    {
      label: 'Reporting',
      items: [
        { key: 'reporting', icon: '📊', label: 'Reporting admin' },
      ],
    },
  ],
};

export function Sidebar({
  role,
  active,
  onChange,
}: {
  role: Role;
  active: string;
  onChange(k: string): void;
}) {
  return (
    <aside className="sidebar">
      {NAV[role].map((section, i) => (
        <nav key={i}>
          {section.label && (
            <div className="sidebar-section-label">{section.label}</div>
          )}
          {section.items.map(item => (
            <button
              key={item.key}
              className={`nav-btn ${active === item.key ? 'active' : ''}`}
              onClick={() => onChange(item.key)}
            >
              <span className="nav-icon">{item.icon}</span>
              {item.label}
            </button>
          ))}
        </nav>
      ))}
    </aside>
  );
}
