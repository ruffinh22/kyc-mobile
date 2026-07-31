import { useState, useMemo, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { changePassword } from '../services/api';
import { Alert, Spinner } from '../components/ui';

/* ────────────────────────────────────────────────────────────────────────
   Shared visual system for the auth pages.
   Uses the app's existing design tokens (--mtn-blue, --mtn-yellow, --r-lg,
   --ink-3, --ink-4, --border, --font) with safe fallbacks so this still
   renders correctly if those tokens aren't defined in scope.
   ────────────────────────────────────────────────────────────────────── */

function AuthStyles() {
  return (
    <style>{`
      .mtnauth-shell {
        min-height: 100dvh;
        display: grid;
        grid-template-columns: 1fr;
        background: #f6f7f9;
      }
      @media (min-width: 960px) {
        .mtnauth-shell { grid-template-columns: minmax(360px, 5fr) minmax(420px, 6fr); }
      }

      /* ── Brand panel ─────────────────────────────────────────────── */
      .mtnauth-brand {
        position: relative;
        overflow: hidden;
        display: flex;
        flex-direction: column;
        justify-content: space-between;
        padding: 1.5rem 1.5rem;
        background: linear-gradient(160deg, var(--mtn-blue, #003e7e) 0%, #002a57 100%);
        color: #fff;
      }
      @media (min-width: 960px) {
        .mtnauth-brand { padding: 3rem 3.5rem; }
      }
      .mtnauth-brand-top { position: relative; z-index: 2; display: flex; align-items: center; gap: .75rem; }
      .mtnauth-brand-body { position: relative; z-index: 2; display: none; }
      @media (min-width: 960px) {
        .mtnauth-brand-body { display: block; margin-top: 2.5rem; max-width: 30rem; }
      }
      .mtnauth-brand-headline {
        font-size: clamp(1.6rem, 2.4vw, 2.15rem);
        font-weight: 800;
        line-height: 1.2;
        letter-spacing: -0.01em;
        margin: 0 0 .85rem;
      }
      .mtnauth-brand-sub {
        font-size: .95rem;
        line-height: 1.6;
        color: rgba(255,255,255,.72);
        margin: 0;
      }
      .mtnauth-brand-foot {
        position: relative; z-index: 2;
        display: none;
        gap: .6rem;
        align-items: center;
        font-size: .8rem;
        color: rgba(255,255,255,.6);
      }
      @media (min-width: 960px) { .mtnauth-brand-foot { display: flex; } }

      .mtnauth-node-field { position: absolute; inset: 0; z-index: 1; opacity: .55; }

      /* ── Logo badge ──────────────────────────────────────────────── */
      .mtnauth-logo {
        display: flex; align-items: center; justify-content: center;
        background: var(--mtn-blue, #003e7e);
        border-radius: var(--r-lg, 10px);
        padding: 6px 12px;
        flex-shrink: 0;
      }
      .mtnauth-logo--on-brand { background: rgba(255,255,255,.12); backdrop-filter: blur(4px); }
      .mtnauth-logo span {
        font-weight: 900; font-size: 16px; letter-spacing: -0.5px;
        color: var(--mtn-yellow, #ffcb05);
        font-family: var(--font, inherit);
      }
      .mtnauth-brand-title { font-size: 15px; font-weight: 800; letter-spacing: -.2px; }
      .mtnauth-brand-title--light { color: #fff; }
      .mtnauth-brand-title--dark { color: var(--mtn-blue, #003e7e); }
      .mtnauth-brand-tag { font-size: 11px; margin-top: 1px; }
      .mtnauth-brand-tag--light { color: rgba(255,255,255,.65); }
      .mtnauth-brand-tag--dark { color: var(--ink-3, #6b7280); }

      /* ── Form panel ──────────────────────────────────────────────── */
      .mtnauth-formside {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 2rem 1.25rem 2.5rem;
      }
      @media (min-width: 960px) { .mtnauth-formside { padding: 2rem; } }

      .mtnauth-card {
        width: 100%;
        max-width: 420px;
        animation: mtnauth-rise .45s cubic-bezier(.16,1,.3,1) both;
      }
      @keyframes mtnauth-rise {
        from { opacity: 0; transform: translateY(10px); }
        to   { opacity: 1; transform: translateY(0); }
      }

      .mtnauth-mobile-brand { display: flex; margin-bottom: 1.5rem; }
      @media (min-width: 960px) { .mtnauth-mobile-brand { display: none; } }

      .mtnauth-title {
        font-size: clamp(1.35rem, 2vw, 1.6rem);
        font-weight: 800;
        color: #111827;
        letter-spacing: -.01em;
        margin: 0 0 .35rem;
      }
      .mtnauth-sub {
        font-size: .9rem;
        color: var(--ink-3, #6b7280);
        margin: 0 0 1.75rem;
        line-height: 1.55;
      }

      .mtnauth-form { display: flex; flex-direction: column; gap: 1.15rem; }
      .mtnauth-field { display: flex; flex-direction: column; gap: .4rem; position: relative; }
      .mtnauth-field label {
        font-size: .82rem; font-weight: 600; color: #1f2937;
        display: flex; align-items: center; gap: .3rem;
      }
      .mtnauth-req { color: #dc2626; }

      .mtnauth-input-wrap { position: relative; display: flex; align-items: center; }
      .mtnauth-input-icon {
        position: absolute; left: 12px; display: flex; color: var(--ink-4, #9ca3af); pointer-events: none;
      }
      .mtnauth-field input {
        width: 100%;
        box-sizing: border-box;
        padding: .72rem .8rem .72rem 2.5rem;
        font-size: .92rem;
        border: 1.5px solid var(--border, #e5e7eb);
        border-radius: var(--r-lg, 10px);
        background: #fff;
        color: #111827;
        transition: border-color .15s ease, box-shadow .15s ease;
      }
      .mtnauth-field input::placeholder { color: var(--ink-4, #9ca3af); }
      .mtnauth-field input:focus {
        outline: none;
        border-color: var(--mtn-blue, #003e7e);
        box-shadow: 0 0 0 3px rgba(0,62,126,.12);
      }
      .mtnauth-field input.mtnauth-input-error {
        border-color: #dc2626;
        box-shadow: 0 0 0 3px rgba(220,38,38,.1);
      }
      .mtnauth-field input.has-toggle { padding-right: 2.6rem; }

      .mtnauth-toggle-visibility {
        position: absolute;
        right: 10px;
        display: flex;
        align-items: center;
        justify-content: center;
        border: none;
        background: transparent;
        color: var(--ink-4, #9ca3af);
        cursor: pointer;
        padding: 6px;
        border-radius: 6px;
      }
      .mtnauth-toggle-visibility:hover { color: var(--ink-3, #6b7280); background: #f3f4f6; }
      .mtnauth-toggle-visibility:focus-visible { outline: 2px solid var(--mtn-blue, #003e7e); outline-offset: 1px; }

      .mtnauth-hint { font-size: .76rem; color: var(--ink-4, #9ca3af); }
      .mtnauth-hint-error { font-size: .76rem; color: #dc2626; }

      .mtnauth-strength { display: flex; gap: 4px; margin-top: 2px; }
      .mtnauth-strength-bar { height: 4px; flex: 1; border-radius: 2px; background: #e5e7eb; transition: background .2s ease; }

      .mtnauth-submit {
        margin-top: .35rem;
        width: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .5rem;
        padding: .8rem 1rem;
        border: none;
        border-radius: var(--r-lg, 10px);
        background: var(--mtn-blue, #003e7e);
        color: #fff;
        font-size: .92rem;
        font-weight: 700;
        cursor: pointer;
        transition: background .15s ease, transform .05s ease, opacity .15s ease;
      }
      .mtnauth-submit:hover:not(:disabled) { background: #002a57; }
      .mtnauth-submit:active:not(:disabled) { transform: translateY(1px); }
      .mtnauth-submit:disabled { opacity: .55; cursor: not-allowed; }
      .mtnauth-submit:focus-visible { outline: 2px solid var(--mtn-yellow, #ffcb05); outline-offset: 2px; }

      .mtnauth-footer {
        margin-top: 1.75rem;
        padding-top: 1.25rem;
        border-top: 1px solid var(--border, #e5e7eb);
        display: flex;
        align-items: center;
        justify-content: center;
        gap: .5rem;
      }
      .mtnauth-footer-dot { width: 7px; height: 7px; border-radius: 50%; background: var(--mtn-yellow, #ffcb05); }
      .mtnauth-footer-text { font-size: 11px; color: var(--ink-4, #9ca3af); font-weight: 500; }

      @media (prefers-reduced-motion: reduce) {
        .mtnauth-card { animation: none; }
      }
    `}</style>
  );
}

/* Decorative "identity network" motif for the brand panel — abstract nodes
   and connecting lines evoke KYC / identity verification without literal
   iconography. Purely decorative, aria-hidden. */
function NetworkMotif() {
  return (
    <svg className="mtnauth-node-field" viewBox="0 0 520 640" preserveAspectRatio="xMidYMid slice" aria-hidden="true">
      <g stroke="rgba(255,255,255,.16)" strokeWidth="1">
        <line x1="40" y1="120" x2="180" y2="60" />
        <line x1="180" y1="60" x2="340" y2="140" />
        <line x1="340" y1="140" x2="470" y2="90" />
        <line x1="180" y1="60" x2="220" y2="220" />
        <line x1="220" y1="220" x2="80" y2="300" />
        <line x1="220" y1="220" x2="380" y2="300" />
        <line x1="380" y1="300" x2="470" y2="90" />
        <line x1="80" y1="300" x2="140" y2="460" />
        <line x1="140" y1="460" x2="320" y2="520" />
        <line x1="380" y1="300" x2="320" y2="520" />
        <line x1="320" y1="520" x2="260" y2="640" />
      </g>
      <g fill="#ffcb05">
        <circle cx="180" cy="60" r="4" />
        <circle cx="470" cy="90" r="3" />
        <circle cx="220" cy="220" r="5" opacity=".9" />
      </g>
      <g fill="rgba(255,255,255,.55)">
        <circle cx="40" cy="120" r="3" />
        <circle cx="340" cy="140" r="3" />
        <circle cx="80" cy="300" r="4" />
        <circle cx="380" cy="300" r="3" />
        <circle cx="140" cy="460" r="3" />
        <circle cx="320" cy="520" r="4" />
        <circle cx="260" cy="640" r="3" />
      </g>
    </svg>
  );
}

function LogoBadge({ variant }: { variant: 'light' | 'dark' }) {
  const onBrand = variant === 'light';
  return (
    <>
      <div className={`mtnauth-logo${onBrand ? ' mtnauth-logo--on-brand' : ''}`}>
        <span>MTN</span>
      </div>
      <div>
        <div className={`mtnauth-brand-title mtnauth-brand-title--${variant}`}>KYC</div>
        <div className={`mtnauth-brand-tag mtnauth-brand-tag--${variant}`}>Plateforme Back Office</div>
      </div>
    </>
  );
}

function BrandPanel({ headline, sub }: { headline: string; sub: string }) {
  return (
    <div className="mtnauth-brand">
      <NetworkMotif />
      <div className="mtnauth-brand-top">
        <LogoBadge variant="light" />
      </div>
      <div className="mtnauth-brand-body">
        <p className="mtnauth-brand-headline">{headline}</p>
        <p className="mtnauth-brand-sub">{sub}</p>
      </div>
      <div className="mtnauth-brand-foot">
        <span style={{ width: 7, height: 7, borderRadius: '50%', background: 'var(--mtn-yellow, #ffcb05)' }} />
        <span>MTN Congo · Back Office sécurisé</span>
      </div>
    </div>
  );
}

function EyeIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7Z" stroke="currentColor" strokeWidth="1.8" strokeLinejoin="round" />
      <circle cx="12" cy="12" r="3.2" stroke="currentColor" strokeWidth="1.8" />
    </svg>
  );
}

function EyeOffIcon() {
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path d="M3 3l18 18" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M10.6 5.2A11.6 11.6 0 0 1 12 5c7 0 11 7 11 7a13.9 13.9 0 0 1-3.3 3.9M6.3 6.4C3.4 8.1 1 12 1 12s4 7 11 7c1.4 0 2.7-.28 3.9-.75" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 10a3.2 3.2 0 0 0 4.5 4.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function UserIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="12" cy="8" r="3.5" stroke="currentColor" strokeWidth="1.8" />
      <path d="M4.5 20c1.3-3.6 4.2-5.5 7.5-5.5s6.2 1.9 7.5 5.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

function LockIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.2" stroke="currentColor" strokeWidth="1.8" />
      <path d="M8 10.5V7.8a4 4 0 0 1 8 0v2.7" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  );
}

/* Small helper: reveal/hide toggle button shared across password fields */
function VisibilityToggle({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      className="mtnauth-toggle-visibility"
      onClick={onToggle}
      aria-label={shown ? 'Masquer le mot de passe' : 'Afficher le mot de passe'}
    >
      {shown ? <EyeOffIcon /> : <EyeIcon />}
    </button>
  );
}

/* ── Login Page MTN ─────────────────────────────────────────────────────── */
export function LoginPage() {
  const { login, loading, error, clearError } = useAuth();
  const [mat, setMat] = useState('');
  const [pwd, setPwd] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try {
      await login(mat, pwd);
      // Replace URL and notify router so SPA shows authenticated shell
      window.history.replaceState({}, '', '/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    } catch { /* géré par le contexte */ }
  };

  return (
    <div className="mtnauth-shell">
      <AuthStyles />
      <BrandPanel
        headline="Vérification d'identité, simplifiée."
        sub="Gérez les dossiers KYC de vos abonnés en toute sécurité : validation des pièces, conformité et suivi centralisé, en un seul espace."
      />

      <main className="mtnauth-formside">
        <div className="mtnauth-card">
          <div className="mtnauth-mobile-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
              <LogoBadge variant="dark" />
            </div>
          </div>

          <h1 className="mtnauth-title">Connexion</h1>
          <p className="mtnauth-sub">Identifiez-vous pour accéder à votre espace de travail.</p>

          {error && (
            <div style={{ marginBottom: '1rem' }} aria-live="polite">
              <Alert kind="error">{error}</Alert>
            </div>
          )}

          <form onSubmit={submit} className="mtnauth-form" noValidate>
            <div className="mtnauth-field">
              <label htmlFor="mat">Matricule <span className="mtnauth-req">*</span></label>
              <div className="mtnauth-input-wrap">
                <span className="mtnauth-input-icon"><UserIcon /></span>
                <input
                  id="mat"
                  type="text"
                  value={mat}
                  onChange={e => setMat(e.target.value.toUpperCase())}
                  placeholder="Ex. AG001"
                  required
                  autoFocus
                  autoComplete="username"
                />
              </div>
            </div>

            <div className="mtnauth-field">
              <label htmlFor="pwd">Mot de passe <span className="mtnauth-req">*</span></label>
              <div className="mtnauth-input-wrap">
                <span className="mtnauth-input-icon"><LockIcon /></span>
                <input
                  id="pwd"
                  className="has-toggle"
                  type={showPassword ? 'text' : 'password'}
                  value={pwd}
                  onChange={e => setPwd(e.target.value)}
                  placeholder="••••••••"
                  required
                  autoComplete="current-password"
                />
                <VisibilityToggle shown={showPassword} onToggle={() => setShowPassword(s => !s)} />
              </div>
            </div>

            <button type="submit" className="mtnauth-submit" disabled={loading}>
              {loading ? <><Spinner /> Connexion…</> : 'Se connecter'}
            </button>
          </form>

          <div className="mtnauth-footer">
            <span className="mtnauth-footer-dot" />
            <span className="mtnauth-footer-text">MTN Congo · Back Office sécurisé</span>
          </div>
        </div>
      </main>
    </div>
  );
}

/* ── Change Password Page ──────────────────────────────────────────────── */
function passwordStrength(pwd: string): number {
  if (!pwd) return 0;
  let score = 0;
  if (pwd.length >= 8) score++;
  if (/[a-z]/.test(pwd) && /[A-Z]/.test(pwd)) score++;
  if (/\d/.test(pwd)) score++;
  if (/[^A-Za-z0-9]/.test(pwd)) score++;
  return score; // 0–4
}

const strengthMeta = [
  { label: '', color: '#e5e7eb' },
  { label: 'Faible', color: '#dc2626' },
  { label: 'Moyen', color: '#f59e0b' },
  { label: 'Bon', color: '#3b82f6' },
  { label: 'Excellent', color: '#16a34a' },
];

export function ChangePasswordPage() {
  const { logout } = useAuth();
  const [cur, setCur] = useState('');
  const [nxt, setNxt] = useState('');
  const [cnf, setCnf] = useState('');
  const [showCur, setShowCur] = useState(false);
  const [showNxt, setShowNxt] = useState(false);
  const [showCnf, setShowCnf] = useState(false);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [ok, setOk] = useState(false);

  const strength = useMemo(() => passwordStrength(nxt), [nxt]);
  const mismatch = cnf.length > 0 && nxt !== cnf;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setErr(null);
    if (nxt !== cnf) { setErr('Les deux nouveaux mots de passe ne correspondent pas'); return; }
    if (nxt.length < 8) { setErr('Minimum 8 caractères requis'); return; }
    setLoading(true);
    try {
      await changePassword(cur, nxt);
      setOk(true);
      setTimeout(() => logout(), 1600);
    } catch (e2) {
      setErr(e2 instanceof Error ? e2.message : 'Erreur lors du changement');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mtnauth-shell">
      <AuthStyles />
      <BrandPanel
        headline="Un nouveau mot de passe, une sécurité renforcée."
        sub="Cette étape protège votre compte et l'accès aux dossiers de vos abonnés. Elle ne prend qu'une minute."
      />

      <main className="mtnauth-formside">
        <div className="mtnauth-card">
          <div className="mtnauth-mobile-brand">
            <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem' }}>
              <LogoBadge variant="dark" />
            </div>
          </div>

          <h1 className="mtnauth-title">Changement obligatoire</h1>
          <p className="mtnauth-sub">
            Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.
          </p>

          {err && <div style={{ marginBottom: '1rem' }} aria-live="polite"><Alert kind="error">{err}</Alert></div>}
          {ok && <div style={{ marginBottom: '1rem' }} aria-live="polite"><Alert kind="success">Mot de passe modifié. Reconnexion en cours…</Alert></div>}

          <form onSubmit={submit} className="mtnauth-form" noValidate>
            <div className="mtnauth-field">
              <label htmlFor="cur">Mot de passe actuel <span className="mtnauth-req">*</span></label>
              <div className="mtnauth-input-wrap">
                <span className="mtnauth-input-icon"><LockIcon /></span>
                <input
                  id="cur"
                  className="has-toggle"
                  type={showCur ? 'text' : 'password'}
                  value={cur}
                  onChange={e => setCur(e.target.value)}
                  required
                  autoFocus
                  autoComplete="current-password"
                />
                <VisibilityToggle shown={showCur} onToggle={() => setShowCur(s => !s)} />
              </div>
            </div>

            <div className="mtnauth-field">
              <label htmlFor="nxt">Nouveau mot de passe <span className="mtnauth-req">*</span></label>
              <div className="mtnauth-input-wrap">
                <span className="mtnauth-input-icon"><LockIcon /></span>
                <input
                  id="nxt"
                  className="has-toggle"
                  type={showNxt ? 'text' : 'password'}
                  value={nxt}
                  onChange={e => setNxt(e.target.value)}
                  required
                  autoComplete="new-password"
                  aria-describedby="nxt-hint"
                />
                <VisibilityToggle shown={showNxt} onToggle={() => setShowNxt(s => !s)} />
              </div>
              {nxt.length > 0 && (
                <div className="mtnauth-strength" aria-hidden="true">
                  {[1, 2, 3, 4].map(i => (
                    <span
                      key={i}
                      className="mtnauth-strength-bar"
                      style={{ background: i <= strength ? strengthMeta[strength].color : '#e5e7eb' }}
                    />
                  ))}
                </div>
              )}
              <span id="nxt-hint" className="mtnauth-hint">
                8+ caractères, majuscule, minuscule, chiffre{strength > 0 ? ` · ${strengthMeta[strength].label}` : ''}
              </span>
            </div>

            <div className="mtnauth-field">
              <label htmlFor="cnf">Confirmer le nouveau mot de passe <span className="mtnauth-req">*</span></label>
              <div className="mtnauth-input-wrap">
                <span className="mtnauth-input-icon"><LockIcon /></span>
                <input
                  id="cnf"
                  className={`has-toggle${mismatch ? ' mtnauth-input-error' : ''}`}
                  type={showCnf ? 'text' : 'password'}
                  value={cnf}
                  onChange={e => setCnf(e.target.value)}
                  required
                  autoComplete="new-password"
                  aria-invalid={mismatch}
                />
                <VisibilityToggle shown={showCnf} onToggle={() => setShowCnf(s => !s)} />
              </div>
              {mismatch && <span className="mtnauth-hint-error">Les mots de passe ne correspondent pas</span>}
            </div>

            <button type="submit" className="mtnauth-submit" disabled={loading || ok}>
              {loading ? <><Spinner /> Enregistrement…</> : 'Mettre à jour le mot de passe'}
            </button>
          </form>
        </div>
      </main>
    </div>
  );
}