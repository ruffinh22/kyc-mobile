// ============================================================================
// AccueilPage – Sélection de l'espace de travail (terrain vs back-office)
// Design : navy profond MTN, verre dépoli premium, liseré or métallique,
//          bandeau de confiance institutionnel, présence multi-pays,
//          header avec logo + bouton de téléchargement APK
// ============================================================================

export function AccueilPage() {
  const navigateTo = (path: string) => {
    window.history.pushState({}, '', path);
    window.dispatchEvent(new PopStateEvent('popstate'));
  };

  return (
    <div style={S.root} className="ac-root">
      <FontsAndKeyframes />

      {/* Halos décoratifs + trame technique */}
      <div style={S.haloTop} />
      <div style={S.haloBottom} />
      <div style={S.gridPattern} />
      <div style={S.grain} />

      {/* ── Header ─────────────────────────────────────────────────────── */}
      <header style={S.header} className="ac-header">
        <div style={S.headerLogoRow}>
          <div style={S.headerMark}><span style={S.headerMarkM}>M</span></div>
          <div style={S.headerWordmark}>
            <span style={S.headerTitle}>EDIA CONTACT</span>
            <span style={S.headerTag}>The offshore company</span>
          </div>
        </div>

        <div style={S.headerRight}>
          <span style={S.headerBadge}><IconGlobe /> Réseau mobile</span>
          <ApkButton href="/apk/app-release.apk" />
        </div>
      </header>

      {/* ── Hero ───────────────────────────────────────────────────────── */}
      <div style={S.hero} className="ac-hero">
        <span style={S.heroEyebrow}>
          <span className="live-dot" />
          Plateforme KYC · Palladium Africa
        </span>
        <h1 style={S.heroTitle} className="ac-hero-title">
          Sélectionnez votre<br /><span style={S.heroTitleAccent}>espace de travail</span>
        </h1>
        <p style={S.heroSubtitle}>
          Deux univers, une seule exigence&nbsp;: la certification de qualité.
        </p>

        {/* Bandeau de confiance institutionnel */}
        <div style={S.trustBar} className="ac-trust-bar">
          <span style={S.trustItem}><IconLock /> Chiffrement de bout en bout</span>
          <span style={S.trustDivider} />
          <span style={S.trustItem}><IconCheck /> Conforme aux normes KYC</span>
          <span style={S.trustDivider} />
          <span style={S.trustItem}><IconGlobe /> Opérations multi-pays</span>
        </div>
      </div>

      {/* ── Cartes ─────────────────────────────────────────────────────── */}
      <div style={S.grid} className="ac-grid">
        <CardLink
          index="01"
          href="/acquisition"
          icon={<IconClipboard />}
          eyebrow="Terrain"
          title={<>Agents Acquisition<br />&amp; Front Office</>}
          desc="Soumettez vos numéros à certifier et suivez leur statut en temps réel, où que vous soyez."
          onNavigate={() => navigateTo('/acquisition')}
        />

        <CardLink
          index="02"
          href="/login"
          icon={<IconBuilding />}
          eyebrow="Back office"
          title="MEDIA CONTACT"
          desc="Contrôle qualité, supervision et appel vidéo terrain en temps réel pour la certification KYC."
          isGold
          onNavigate={() => navigateTo('/login')}
        />
      </div>

      <div style={S.footerDivider} />
      <p style={S.footer} className="ac-footer">
        KYC · Palladium Africa © 2026 · 🔒 Connexion sécurisée
      </p>
    </div>
  );
}

// ── Bouton APK (header) ────────────────────────────────────────────────────
function ApkButton({ href }: { href: string }) {
  return (
    <a
      href={href}
      download
      style={S.apkBtn}
      className="ac-apk-btn"
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.borderColor = 'rgba(255,216,77,.75)';
        el.style.boxShadow = '0 8px 28px rgba(255,204,0,.22), inset 0 0 0 1px rgba(255,216,77,.15)';
        el.style.transform = 'translateY(-2px)';
        (el.querySelector('.apk-shine') as HTMLElement).style.left = '130%';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.borderColor = 'rgba(255,204,0,.35)';
        el.style.boxShadow = '0 2px 14px rgba(0,0,0,.25)';
        el.style.transform = 'translateY(0)';
        (el.querySelector('.apk-shine') as HTMLElement).style.left = '-60%';
      }}
    >
      <span className="apk-shine" style={S.apkShine} />
      <IconDownload />
      <span style={S.apkLabel}>
        <span style={S.apkLabelMain}>Télécharger l’app</span>
        <span style={S.apkLabelSub}>APK · Android</span>
      </span>
    </a>
  );
}

// ── Composant carte lien ────────────────────────────────────────────────────
function CardLink({
  href, icon, eyebrow, title, desc, isGold = false, onNavigate, index,
}: {
  href: string;
  icon: React.ReactNode;
  eyebrow: string;
  title: React.ReactNode;
  desc: string;
  isGold?: boolean;
  onNavigate?: () => void;
  index: string;
}) {
  const handleClick = (e: React.MouseEvent<HTMLAnchorElement>) => {
    e.preventDefault();
    onNavigate?.();
  };

  return (
    <a
      href={href}
      style={{ ...S.card, ...(isGold ? S.cardGold : {}) }}
      className="ac-card"
      onClick={handleClick}
      onMouseEnter={e => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = 'translateY(-8px)';
        el.style.borderColor = 'rgba(255,204,0,.55)';
        el.style.background = isGold ? 'rgba(255,204,0,.14)' : 'rgba(255,255,255,.11)';
        el.style.boxShadow = '0 24px 56px rgba(0,0,0,.3), 0 0 0 1px rgba(255,204,0,.16)';
        (el.querySelector('.card-shine') as HTMLElement).style.transform = 'translateX(120%) skewX(-12deg)';
        (el.querySelector('.card-arrow') as HTMLElement).style.transform = 'translateX(4px)';
        (el.querySelector('.card-arrow') as HTMLElement).style.color = '#FFCC00';
      }}
      onMouseLeave={e => {
        const el = e.currentTarget as HTMLAnchorElement;
        el.style.transform = 'translateY(0)';
        el.style.borderColor = isGold ? 'rgba(255,204,0,.4)' : 'rgba(255,255,255,.14)';
        el.style.background = isGold ? 'rgba(255,204,0,.09)' : 'rgba(255,255,255,.07)';
        el.style.boxShadow = isGold
          ? '0 0 0 1px rgba(255,204,0,.1) inset, 0 14px 34px rgba(0,0,0,.24)'
          : '0 14px 34px rgba(0,0,0,.22)';
        (el.querySelector('.card-shine') as HTMLElement).style.transform = 'translateX(-120%) skewX(-12deg)';
        (el.querySelector('.card-arrow') as HTMLElement).style.transform = 'translateX(0)';
        (el.querySelector('.card-arrow') as HTMLElement).style.color = 'rgba(255,255,255,.5)';
      }}
    >
      <span className="card-shine" style={S.cardShine} />
      <span style={S.cardIndex}>{index}</span>
      <div style={S.cardTop}>
        <div style={{ ...S.cardIconBadge, ...(isGold ? S.cardIconBadgeGold : {}) }}>{icon}</div>
        <span style={S.cardEyebrow}>{eyebrow}</span>
      </div>
      <h2 style={S.cardTitle}>{title}</h2>
      <p style={S.cardDesc}>{desc}</p>
      <div style={S.cardBottom}>
        <span style={S.cardCta}>Accéder</span>
        <span className="card-arrow" style={S.arrow}><IconArrow /></span>
      </div>
    </a>
  );
}

// ── SVG Icons ─────────────────────────────────────────────────────────────────
function IconClipboard() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
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
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none"
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
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M5 12h14"/><path d="m12 5 7 7-7 7"/>
    </svg>
  );
}

function IconDownload() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none"
      stroke="#FFCC00" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
      <polyline points="7 10 12 15 17 10" />
      <line x1="12" y1="15" x2="12" y2="3" />
    </svg>
  );
}

function IconLock() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <rect width="18" height="11" x="3" y="11" rx="2" ry="2"/>
      <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
    </svg>
  );
}

function IconCheck() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <path d="M20 6 9 17l-5-5"/>
    </svg>
  );
}

function IconGlobe() {
  return (
    <svg width="13" height="13" viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2.1" strokeLinecap="round" strokeLinejoin="round"
      style={{ flexShrink: 0 }}>
      <circle cx="12" cy="12" r="10"/>
      <path d="M2 12h20"/>
      <path d="M12 2a15 15 0 0 1 4 10 15 15 0 0 1-4 10 15 15 0 0 1-4-10 15 15 0 0 1 4-10Z"/>
    </svg>
  );
}

// ── Fonts + keyframes (injecté une fois) ────────────────────────────────────
function FontsAndKeyframes() {
  return (
    <style>{`
      @import url('https://fonts.googleapis.com/css2?family=Sora:wght@600;700;800&family=Inter:wght@400;500;600;700&display=swap');

      @keyframes haloDrift {
        0%, 100% { transform: translateX(-50%) translateY(0); opacity: .9; }
        50%      { transform: translateX(-50%) translateY(14px); opacity: 1; }
      }

      @keyframes pulseDot {
        0%   { box-shadow: 0 0 0 0 rgba(70,220,150,.55); }
        70%  { box-shadow: 0 0 0 7px rgba(70,220,150,0); }
        100% { box-shadow: 0 0 0 0 rgba(70,220,150,0); }
      }

      @keyframes ringSpin {
        to { transform: rotate(360deg); }
      }

      .ac-root { box-sizing: border-box; }
      .ac-root *, .ac-root *::before, .ac-root *::after { box-sizing: inherit; }

      .live-dot {
        display: inline-block; width: 6px; height: 6px; border-radius: 50%;
        background: #46dc96; margin-right: 7px; vertical-align: middle;
        animation: pulseDot 2.2s infinite;
      }

      .ac-card { position: relative; isolation: isolate; }
      .ac-card::before {
        content: '';
        position: absolute; inset: -1px;
        border-radius: 23px;
        padding: 1px;
        background: conic-gradient(from 0deg, rgba(255,204,0,0) 0%, rgba(255,204,0,.7) 20%, rgba(255,204,0,0) 40%);
        -webkit-mask: linear-gradient(#fff 0 0) content-box, linear-gradient(#fff 0 0);
        -webkit-mask-composite: xor;
        mask-composite: exclude;
        opacity: 0;
        transition: opacity .5s ease;
        animation: ringSpin 5s linear infinite;
        pointer-events: none;
        z-index: -1;
      }
      .ac-card:hover::before { opacity: 1; }

      /* ── Tablette ─────────────────────────────────────────────── */
      @media (max-width: 860px) {
        .ac-header    { padding-top: 22px !important; }
        .ac-grid      { max-width: 520px !important; gap: 18px !important; }
        .ac-trust-bar { gap: 10px !important; }
      }

      /* ── Grille en une colonne ────────────────────────────────── */
      @media (max-width: 680px) {
        .ac-grid  { grid-template-columns: minmax(0, 1fr) !important; max-width: 440px !important; }
        .ac-card  { min-height: 0 !important; padding: 26px 24px !important; }
      }

      /* ── Mobile ───────────────────────────────────────────────── */
      @media (max-width: 560px) {
        .ac-root       { padding-left: 14px !important; padding-right: 14px !important; padding-bottom: 40px !important; }
        .ac-header     { flex-direction: column !important; align-items: stretch !important; gap: 14px !important; padding-top: 18px !important; }
        .ac-apk-btn    { width: 100% !important; justify-content: center !important; padding: 12px 16px !important; }
        .ac-hero       { margin-top: 32px !important; margin-bottom: 26px !important; }
        .ac-hero-title { font-size: 24px !important; letter-spacing: -.2px !important; }
        .ac-trust-bar  { flex-direction: column !important; gap: 10px !important; align-items: center !important; }
        .ac-trust-bar > span[data-divider] { display: none !important; }
        .ac-footer     { margin-top: 26px !important; text-align: center !important; padding: 0 8px !important; }
      }

      /* ── Très petit écran ─────────────────────────────────────── */
      @media (max-width: 380px) {
        .ac-card { padding: 22px 18px !important; }
      }

      /* ── Accessibilité mouvement réduit ───────────────────────── */
      @media (prefers-reduced-motion: reduce) {
        * { animation-duration: 0.001ms !important; transition-duration: 0.001ms !important; }
      }
    `}</style>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────────────
const S: Record<string, React.CSSProperties> = {
  root: {
    minHeight: '100vh',
    background: 'radial-gradient(ellipse 1200px 700px at 50% -10%, #0d5aad 0%, #003e7e 42%, #00294f 78%, #001327 100%)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: '0 20px 56px',
    position: 'relative',
    overflow: 'hidden',
    fontFamily: "'Inter', system-ui, sans-serif",
    WebkitFontSmoothing: 'antialiased',
  },
  gridPattern: {
    position: 'absolute', inset: 0,
    backgroundImage:
      'linear-gradient(rgba(255,255,255,.035) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,.035) 1px, transparent 1px)',
    backgroundSize: '64px 64px',
    maskImage: 'radial-gradient(ellipse 900px 600px at 50% 0%, #000 0%, transparent 75%)',
    WebkitMaskImage: 'radial-gradient(ellipse 900px 600px at 50% 0%, #000 0%, transparent 75%)',
    pointerEvents: 'none',
  },
  grain: {
    position: 'absolute', inset: 0,
    backgroundImage: 'radial-gradient(rgba(255,255,255,.035) 1px, transparent 1px)',
    backgroundSize: '3px 3px',
    pointerEvents: 'none',
    mixBlendMode: 'overlay',
  },
  haloTop: {
    position: 'absolute', top: -100, left: '50%',
    width: 760, height: 380,
    background: 'radial-gradient(ellipse, rgba(255,204,0,.14) 0%, transparent 68%)',
    pointerEvents: 'none',
    borderRadius: '50%',
    animation: 'haloDrift 9s ease-in-out infinite',
  },
  haloBottom: {
    position: 'absolute', bottom: -140, right: -100,
    width: 460, height: 460,
    background: 'radial-gradient(ellipse, rgba(80,150,255,.16) 0%, transparent 70%)',
    pointerEvents: 'none',
    borderRadius: '50%',
  },

  // Header
  header: {
    position: 'relative', zIndex: 2,
    width: '100%', maxWidth: 960,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
    padding: '26px 4px 0',
    gap: 16,
    flexWrap: 'wrap',
  },
  headerLogoRow: { display: 'flex', alignItems: 'center', gap: 10 },
  headerMark: {
    width: 34, height: 34,
    background: 'linear-gradient(155deg, #ff2d3d 0%, #e3000f 60%, #b8000c 100%)',
    borderRadius: '50%',
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    boxShadow: '0 4px 14px rgba(227,0,15,.35)',
    flexShrink: 0,
  },
  headerMarkM: {
    fontFamily: "'Sora', sans-serif",
    fontWeight: 800, fontSize: 17, color: '#fff', lineHeight: 1,
  },
  headerWordmark: { display: 'flex', flexDirection: 'column', lineHeight: 1.1 },
  headerTitle: {
    fontFamily: "'Sora', sans-serif",
    fontWeight: 700, fontSize: 15.5, letterSpacing: '.4px',
    color: '#F5F7FA',
  },
  headerTag: {
    fontStyle: 'italic', fontWeight: 500, fontSize: 10,
    color: 'rgba(255,255,255,.6)', letterSpacing: '.2px', marginTop: 2,
  },
  headerRight: { display: 'flex', alignItems: 'center', gap: 14, flexWrap: 'wrap' },
  headerBadge: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 10.5, fontWeight: 600, letterSpacing: '.3px',
    color: 'rgba(255,255,255,.6)',
    padding: '6px 12px',
    borderRadius: 999,
    border: '1px solid rgba(255,255,255,.14)',
    background: 'rgba(255,255,255,.04)',
    whiteSpace: 'nowrap',
  },

  // APK button (header)
  apkBtn: {
    position: 'relative',
    display: 'inline-flex', alignItems: 'center', gap: 10,
    padding: '10px 18px 10px 16px',
    borderRadius: 999,
    background: 'rgba(255,204,0,.06)',
    border: '1px solid rgba(255,204,0,.35)',
    boxShadow: '0 2px 14px rgba(0,0,0,.25)',
    textDecoration: 'none',
    overflow: 'hidden',
    cursor: 'pointer',
    transition: 'transform .3s cubic-bezier(.22,1,.36,1), border-color .25s, box-shadow .25s',
  },
  apkShine: {
    position: 'absolute', top: 0, left: '-60%',
    width: '40%', height: '100%',
    background: 'linear-gradient(100deg, transparent, rgba(255,255,255,.28), transparent)',
    transform: 'skewX(-18deg)',
    transition: 'left .55s ease',
    pointerEvents: 'none',
  },
  apkLabel: { display: 'flex', flexDirection: 'column', lineHeight: 1.15 },
  apkLabelMain: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 700, fontSize: 12.5, color: '#FFE58A', letterSpacing: '.2px',
  },
  apkLabelSub: {
    fontFamily: "'Inter', sans-serif",
    fontWeight: 500, fontSize: 9.5, color: 'rgba(255,229,138,.55)',
    letterSpacing: '.4px', textTransform: 'uppercase' as const, marginTop: 1,
  },

  // Hero
  hero: {
    position: 'relative', zIndex: 1,
    marginTop: 56, marginBottom: 40,
    textAlign: 'center' as const,
    maxWidth: 660,
    display: 'flex', flexDirection: 'column', alignItems: 'center',
  },
  heroEyebrow: {
    display: 'inline-flex', alignItems: 'center',
    fontSize: 11, fontWeight: 700,
    letterSpacing: 3.2, textTransform: 'uppercase' as const,
    color: '#FFCC00',
    marginBottom: 20,
    padding: '7px 16px',
    borderRadius: 999,
    border: '1px solid rgba(255,204,0,.28)',
    background: 'rgba(255,204,0,.05)',
  },
  heroTitle: {
    fontFamily: "'Sora', sans-serif",
    fontWeight: 800, fontSize: 'clamp(28px, 4vw, 42px)',
    lineHeight: 1.18, letterSpacing: '-.5px',
    color: '#F8F9FB',
    margin: 0,
  },
  heroTitleAccent: {
    background: 'linear-gradient(100deg, #FFE58A 0%, #FFCC00 45%, #FFE58A 100%)',
    WebkitBackgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    backgroundClip: 'text',
  },
  heroSubtitle: {
    marginTop: 16,
    fontSize: 14.5, lineHeight: 1.6,
    color: 'rgba(255,255,255,.7)',
    fontWeight: 400,
  },

  // Bandeau de confiance
  trustBar: {
    marginTop: 26,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    gap: 18,
    flexWrap: 'wrap',
  },
  trustItem: {
    display: 'inline-flex', alignItems: 'center', gap: 6,
    fontSize: 11.5, fontWeight: 500,
    color: 'rgba(255,255,255,.6)',
    letterSpacing: '.1px',
  },
  trustDivider: {
    width: 3, height: 3, borderRadius: '50%',
    background: 'rgba(255,255,255,.25)',
    flexShrink: 0,
  },

  // Grid
  grid: {
    position: 'relative', zIndex: 1,
    display: 'grid',
    gridTemplateColumns: 'repeat(2, minmax(0, 320px))',
    gap: 22,
    width: '100%',
    maxWidth: 680,
  },

  // Card base
  card: {
    position: 'relative',
    display: 'flex', flexDirection: 'column',
    minHeight: 258,
    padding: '30px 28px',
    background: 'rgba(255,255,255,.07)',
    border: '1px solid rgba(255,255,255,.14)',
    borderRadius: 22,
    textDecoration: 'none',
    overflow: 'hidden',
    backdropFilter: 'blur(18px)',
    WebkitBackdropFilter: 'blur(18px)',
    boxShadow: '0 14px 34px rgba(0,0,0,.22)',
    transition: 'transform .4s cubic-bezier(.22,1,.36,1), border-color .3s, background .3s, box-shadow .3s',
  },
  cardGold: {
    background: 'rgba(255,204,0,.09)',
    borderColor: 'rgba(255,204,0,.4)',
    boxShadow: '0 0 0 1px rgba(255,204,0,.1) inset, 0 14px 34px rgba(0,0,0,.24)',
  },
  cardShine: {
    position: 'absolute', top: 0, left: '-120%',
    width: '55%', height: '100%',
    background: 'linear-gradient(100deg, transparent, rgba(255,204,0,.08), transparent)',
    transform: 'translateX(-120%) skewX(-12deg)',
    transition: 'transform .7s ease',
    pointerEvents: 'none',
  },
  cardIndex: {
    position: 'absolute', top: 22, right: 26,
    fontFamily: "'Sora', sans-serif",
    fontSize: 11, fontWeight: 700,
    letterSpacing: '.5px',
    color: 'rgba(255,255,255,.22)',
  },
  cardTop: {
    display: 'flex', alignItems: 'center', gap: 12,
    marginBottom: 22,
  },
  cardIconBadge: {
    width: 44, height: 44, borderRadius: 13,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    background: 'linear-gradient(155deg, rgba(255,204,0,.16), rgba(255,204,0,.04))',
    border: '1px solid rgba(255,204,0,.22)',
    flexShrink: 0,
  },
  cardIconBadgeGold: {
    background: 'linear-gradient(155deg, rgba(255,204,0,.28), rgba(255,204,0,.08))',
    border: '1px solid rgba(255,204,0,.4)',
  },
  cardEyebrow: {
    fontSize: 10.5, fontWeight: 700,
    letterSpacing: 2, textTransform: 'uppercase' as const,
    color: 'rgba(255,204,0,.65)',
  },
  cardTitle: {
    fontFamily: "'Sora', sans-serif",
    fontWeight: 700, fontSize: 19, lineHeight: 1.3,
    color: '#ffffff',
    marginBottom: 10,
    letterSpacing: '-.2px',
  },
  cardDesc: {
    fontSize: 13.2, lineHeight: 1.62,
    color: 'rgba(255,255,255,.72)',
    maxWidth: '94%',
  },
  cardBottom: {
    marginTop: 'auto',
    paddingTop: 20,
    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
  },
  cardCta: {
    fontSize: 12.5, fontWeight: 600,
    color: 'rgba(255,255,255,.75)',
    letterSpacing: '.2px',
  },
  arrow: {
    display: 'flex',
    color: 'rgba(255,255,255,.5)',
    transition: 'transform .3s, color .25s',
  },

  // Footer
  footerDivider: {
    position: 'relative', zIndex: 1,
    width: '100%', maxWidth: 320,
    height: 1,
    marginTop: 40,
    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,.16), transparent)',
  },
  footer: {
    position: 'relative', zIndex: 1,
    marginTop: 18, fontSize: 12,
    color: 'rgba(255,255,255,.55)',
    letterSpacing: '.3px',
    fontWeight: 500,
  },
};