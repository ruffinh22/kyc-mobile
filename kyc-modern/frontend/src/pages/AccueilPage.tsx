// ============================================================================
// AccueilPage – Sélection de l'espace de travail (terrain vs back-office)
// Design : fond bleu MTN sombre, cartes glassmorphism, halo doré
// ============================================================================

export function AccueilPage() {
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div style={S.root}>
      {/* Halos décoratifs */}
      <div style={S.haloTop} />
      <div style={S.haloBottom} />

      {/* Logo MEDIA CONTACT */}
      <div style={S.logoWrap}>
        <div style={S.logoCard}>
          <div style={S.logoRow}>
            <div style={S.logoMark}><span style={S.logoM}>M</span></div>
            <span style={S.logoText}>EDIA CONTACT</span>
          </div>
          <span style={S.logoTag}>The offshore company</span>
        </div>
      </div>

      <p style={S.subtitle}>Sélectionnez votre espace de travail</p>

      {/* Cartes */}
      <div style={S.grid}>
        {/* Carte 1 — Agents terrain */}
        <CardLink
          href="/acquisition"
          icon={<IconClipboard />}
          title={<>Agents Acquisition<br />et Front office</>}
          desc="Soumettez vos numéros à certifier et suivez leur statut en temps réel."
          onNavigate={() => navigateTo('/acquisition')}
        />

        {/* Carte 2 — Back Office (gold) */}
        <CardLink
          href="/login"
          icon={<IconBuilding />}
          title="MEDIA CONTACT"
          desc="Plateforme de certification KYC avec contrôle qualité et appel vidéo terrain en temps réel."
          isGold
          onNavigate={() => navigateTo('/login')}
        />
      </div>

      <p style={S.footer}>KYC Congo V4 · Palladium Africa © 2026 · 🔒 Sécurisé</p>
    </div>
  );
}

// ── Composant carte lien ───────────────────────────────────────────────────────
function CardLink({
  href, icon, title, desc, isGold = false, onNavigate,
}: {
  href: string;
  icon: React.ReactNode;
  title: React.ReactNode;
  desc: string;
  isGold?: boolean;
  onNavigate?: () => void;
}) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onNavigate?.();
  };

  return (
    <a
      href={href}
      style={{
        ...S.card,
        ...(isGold ? S.cardGold : {}),
      }}
      onClick={handleClick}
      onMouseEnter={e => {
        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(-6px)';
        (e.currentTarget as HTMLAnchorElement).style.borderColor = 'rgba(255,204,0,.6)';
        (e.currentTarget as HTMLAnchorElement).style.background  = 'rgba(255,255,255,.055)';
      }}
      onMouseLeave={e => {
        (e.currentTarget as HTMLAnchorElement).style.transform = 'translateY(0)';
        (e.currentTarget as HTMLAnchorElement).style.borderColor = isGold ? 'rgba(255,204,0,.28)' : 'rgba(255,255,255,.07)';
        (e.currentTarget as HTMLAnchorElement).style.background  = isGold ? 'rgba(255,204,0,.04)' : 'rgba(255,255,255,.025)';
      }}
    >
      <div style={S.cardIcon}>{icon}</div>
      <div style={S.cardAccent} />
      <h2 style={S.cardTitle}>{title}</h2>
      <p style={S.cardDesc}>{desc}</p>
      <div style={S.arrow}>
        <IconArrow />
      </div>
    </a>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
function IconClipboard() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="#FFCC00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <rect width="8" height="4" x="8" y="2" rx="1" ry="1"/>
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2"/>
      <path d="M12 11h4"/><path d="M12 16h4"/>
      <path d="M8 11h.01"/><path d="M8 16h.01"/>
    </svg>
  );
}

function IconBuilding() {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none"
      stroke="#FFCC00" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M6 22V4a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v18Z"/>
      <path d="M6 12H4a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h2"/>
      <path d="M18 9h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2h-2"/>
      <path d="M10 6h4"/><path d="M10 10h4"/>
      <path d="M10 14h4"/><path d="M10 18h4"/>
    </svg>
  );
}

function IconArrow() {
  return (
    <svg width="20" height="20" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: 'linear-gradient(160deg, #001530 0%, #002870 45%, #003087 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '48px 20px',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'Inter', system-ui, sans-serif",
    WebkitFontSmoothing: 'antialiased',
  },
  haloTop: {
    position: 'absolute', top: -80, left: '50%',
    transform: 'translateX(-50%)',
    width: 600, height: 320,
    background: 'radial-gradient(ellipse, rgba(255,204,0,.12) 0%, transparent 70%)',
    pointerEvents: 'none',
    borderRadius: '50%',
  },
  haloBottom: {
    position: 'absolute', bottom: -120, right: -80,
    width: 400, height: 400,
    background: 'radial-gradient(ellipse, rgba(0,87,168,.2) 0%, transparent 70%)',
    pointerEvents: 'none',
    borderRadius: '50%',
  },

  // Logo
  logoWrap: { position: 'relative', zIndex: 1, marginBottom: 32 },
  logoCard: {
    background: '#fff',
    borderRadius: 14,
    padding: '14px 28px 12px',
    display: 'inline-flex',
    flexDirection: 'column',
    alignItems: 'flex-start',
    boxShadow: '0 0 60px rgba(255,255,255,.10), 0 18px 40px rgba(0,0,0,.45)',
  },
  logoRow: { display: 'flex', alignItems: 'center', gap: 0 },
  logoMark: {
    width: 29, height: 29,
    background: '#e3000f',
    borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    marginRight: -6,
    position: 'relative', zIndex: 1,
  },
  logoM: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 900, fontSize: 20, color: '#fff',
    lineHeight: 1, transform: 'translateX(2px)',
    display: 'block',
  },
  logoText: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 900, fontSize: 22, letterSpacing: '.3px',
    color: '#111', lineHeight: 1,
  },
  logoTag: {
    alignSelf: 'flex-end',
    fontStyle: 'italic', fontWeight: 600, fontSize: 11,
    color: '#444', marginTop: 3, letterSpacing: '.2px',
  },

  // Subtitle
  subtitle: {
    position: 'relative', zIndex: 1,
    marginBottom: 36,
    fontSize: 11.5, fontWeight: 700,
    letterSpacing: 4, textTransform: 'uppercase' as const,
    color: 'rgba(255,255,255,.35)',
  },

  // Grid
  grid: {
    position: 'relative', zIndex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 300px))',
    gap: 20,
    width: '100%',
    maxWidth: 640,
  },

  // Card base
  card: {
    position: 'relative',
    display: 'flex', flexDirection: 'column',
    minHeight: 240,
    padding: '28px 26px',
    background: 'rgba(255,255,255,.025)',
    border: '1px solid rgba(255,255,255,.07)',
    borderRadius: 20,
    textDecoration: 'none',
    overflow: 'hidden',
    transition: 'transform .35s cubic-bezier(.22,1,.36,1), border-color .25s, background .25s, box-shadow .25s',
  },
  cardGold: {
    background: 'rgba(255,204,0,.04)',
    borderColor: 'rgba(255,204,0,.28)',
    boxShadow: '0 0 0 1px rgba(255,204,0,.06) inset, 0 12px 40px rgba(0,0,0,.3)',
  },
  cardIcon: { color: '#FFCC00', marginBottom: 12 },
  cardAccent: {
    width: 28, height: 3, borderRadius: 3,
    background: '#FFCC00',
    marginBottom: 16,
  },
  cardTitle: {
    fontWeight: 800, fontSize: 18, lineHeight: 1.28,
    color: '#f4f4f5',
    marginBottom: 10,
  },
  cardDesc: {
    fontSize: 13, lineHeight: 1.6,
    color: 'rgba(255,255,255,.45)',
    maxWidth: '92%',
  },
  arrow: {
    position: 'absolute', right: 24, bottom: 24,
    color: 'rgba(255,255,255,.25)',
    transition: 'transform .3s, color .25s',
  },

  // Footer
  footer: {
    position: 'relative', zIndex: 1,
    marginTop: 40, fontSize: 11.5,
    color: 'rgba(255,255,255,.2)',
    letterSpacing: '.3px',
  },
};
