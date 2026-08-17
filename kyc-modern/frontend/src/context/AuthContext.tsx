import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { User } from '../types';
import * as api from '../services/api';

const TOKEN_KEY = 'kyc4-token';
const USER_KEY  = 'kyc4-user';

interface Ctx {
  user: User | null; token: string | null; loading: boolean; error: string | null;
  login(m: string, p: string): Promise<User>;
  logout(): Promise<void>;
  clearError(): void;
}

const AuthContext = createContext<Ctx | undefined>(undefined);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user,    setUser]    = useState<User | null>(null);
  const [token,   setToken]   = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error,   setError]   = useState<string | null>(null);

  useEffect(() => {
    const t = localStorage.getItem(TOKEN_KEY);
    const u = localStorage.getItem(USER_KEY);
    if (t && u) {
      try {
        const parsed = JSON.parse(u) as User;
        api.setToken(t);
        setToken(t); setUser(parsed);
      } catch { localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY); }
    }
    setLoading(false);
  }, []);

  // Ecouter l'événement global 'session_expired' (dispatched par apiFetch sur 401)
  useEffect(() => {
    const handler = () => {
      try {
        // Clean local state without calling backend logout (token déjà invalide)
        setUser(null); setToken(null);
        localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
        localStorage.removeItem('session_expired');
        // navigate SPA to login
        try {
          window.history.pushState({}, '', '/login');
          window.dispatchEvent(new Event('popstate'));
        } catch (e) {
          try { window.location.href = '/login'; } catch (ee) { /* ignore */ }
        }
      } catch (e) {
        console.warn('[Auth] erreur handling session_expired', e);
      }
    };
    window.addEventListener('session_expired', handler as EventListener);
    return () => window.removeEventListener('session_expired', handler as EventListener);
  }, []);

  const login = useCallback(async (matricule: string, password: string): Promise<User> => {
    setLoading(true); setError(null);
    try {
      const r = await api.login(matricule, password);
      const u: User = { matricule: r.user.matricule, nom: r.user.nom, prenom: r.user.prenom, role: r.user.role as User['role'], must_change_password: r.must_change_password };
      api.setToken(r.token);
      setUser(u); setToken(r.token);
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      try { localStorage.removeItem('session_expired'); } catch (e) { /* ignore */ }
      return u;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible';
      setError(msg); throw new Error(msg);
    } finally { setLoading(false); }
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } finally {
      setUser(null); setToken(null);
      // Clear auth and commonly persisted client state that should not survive logout
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      localStorage.removeItem('gsm_dossier_id');
      localStorage.removeItem('kyc_acq_agent');
      localStorage.removeItem('gsm_pending_decision');
      // Ensure SPA navigates to login so the UI is not left on a protected page
      try {
        window.history.pushState({}, '', '/login');
        window.dispatchEvent(new Event('popstate'));
      } catch (e) {
        // Fallback to full reload if pushState is not available
        try { window.location.href = '/login'; } catch (ee) { /* ignore */ }
      }
    }
  }, []);

  const clearError = useCallback(() => setError(null), []);
  const value = useMemo(() => ({ user, token, loading, error, login, logout, clearError }), [user, token, loading, error, login, logout, clearError]);
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth hors AuthProvider');
  return ctx;
}
