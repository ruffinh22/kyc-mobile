import { useState, FormEvent } from 'react';
import { useAuth } from '../context/AuthContext';
import { changePassword } from '../services/api';
import { Alert, Spinner } from '../components/ui';

// ── Login Page MTN ─────────────────────────────────────────────────────────────
export function LoginPage() {
  const { login, loading, error, clearError } = useAuth();
  const [mat, setMat] = useState('');
  const [pwd, setPwd] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    clearError();
    try { await login(mat, pwd); } catch { /* géré par le contexte */ }
  };

  return (
    <div className="shell-auth">
      <div className="login-card">
        {/* Logo MTN */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.75rem' }}>
          <div style={{
            background: 'var(--mtn-blue)',
            borderRadius: 'var(--r-lg)',
            padding: '6px 12px',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <span style={{
              fontWeight: 900,
              fontSize: 16,
              color: 'var(--mtn-yellow)',
              letterSpacing: '-0.5px',
              fontFamily: 'var(--font)',
            }}>MTN</span>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mtn-blue)', letterSpacing: '-.2px' }}>
              KYC Congo
            </div>
            <div style={{ fontSize: 11, color: 'var(--ink-3)', marginTop: 1 }}>
              Plateforme Back Office — V4
            </div>
          </div>
        </div>

        <h1 className="login-title">Connexion</h1>
        <p className="login-sub">
          Identifiez-vous pour accéder à votre espace de travail.
        </p>

        {error && (
          <div style={{ marginBottom: '1rem' }}>
            <Alert kind="error">{error}</Alert>
          </div>
        )}

        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label htmlFor="mat">
              Matricule <span className="req">*</span>
            </label>
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

          <div className="field">
            <label htmlFor="pwd">
              Mot de passe <span className="req">*</span>
            </label>
            <input
              id="pwd"
              type="password"
              value={pwd}
              onChange={e => setPwd(e.target.value)}
              placeholder="••••••••"
              required
              autoComplete="current-password"
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading}
            style={{ marginTop: '.375rem', width: '100%' }}
          >
            {loading ? <><Spinner /> Connexion…</> : 'Se connecter'}
          </button>
        </form>

        <div style={{
          marginTop: '1.75rem',
          paddingTop: '1.25rem',
          borderTop: '1px solid var(--border)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          gap: '.5rem',
        }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--mtn-yellow)' }} />
          <span style={{ fontSize: 11, color: 'var(--ink-4)', fontWeight: 500 }}>
            MTN Congo · Back Office sécurisé
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Change Password Page ────────────────────────────────────────────────────────
export function ChangePasswordPage() {
  const { logout } = useAuth();
  const [cur, setCur]     = useState('');
  const [nxt, setNxt]     = useState('');
  const [cnf, setCnf]     = useState('');
  const [loading, setLoading] = useState(false);
  const [err, setErr]     = useState<string | null>(null);
  const [ok,  setOk]      = useState(false);

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
    <div className="shell-auth">
      <div className="login-card">
        <div style={{ display: 'flex', alignItems: 'center', gap: '.75rem', marginBottom: '1.75rem' }}>
          <div style={{ background: 'var(--mtn-blue)', borderRadius: 'var(--r-lg)', padding: '6px 12px' }}>
            <span style={{ fontWeight: 900, fontSize: 16, color: 'var(--mtn-yellow)', fontFamily: 'var(--font)' }}>MTN</span>
          </div>
          <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--mtn-blue)' }}>KYC Congo</div>
        </div>

        <h1 className="login-title">Changement obligatoire</h1>
        <p className="login-sub">
          Pour des raisons de sécurité, vous devez définir un nouveau mot de passe avant de continuer.
        </p>

        {err && <div style={{ marginBottom: '1rem' }}><Alert kind="error">{err}</Alert></div>}
        {ok  && <div style={{ marginBottom: '1rem' }}><Alert kind="success">Mot de passe modifié. Reconnexion en cours…</Alert></div>}

        <form onSubmit={submit} className="form-grid">
          <div className="field">
            <label>Mot de passe actuel <span className="req">*</span></label>
            <input type="password" value={cur} onChange={e => setCur(e.target.value)} required autoFocus />
          </div>
          <div className="field">
            <label>Nouveau mot de passe <span className="req">*</span></label>
            <input type="password" value={nxt} onChange={e => setNxt(e.target.value)} required />
            <span className="field-hint">8+ caractères, majuscule, minuscule, chiffre</span>
          </div>
          <div className="field">
            <label>Confirmer le nouveau mot de passe <span className="req">*</span></label>
            <input type="password" value={cnf} onChange={e => setCnf(e.target.value)} required />
          </div>
          <button
            type="submit"
            className="btn btn-primary btn-lg"
            disabled={loading || ok}
            style={{ marginTop: '.375rem', width: '100%' }}
          >
            {loading ? <><Spinner /> Enregistrement…</> : 'Mettre à jour le mot de passe'}
          </button>
        </form>
      </div>
    </div>
  );
}
