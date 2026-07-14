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

  const login = useCallback(async (matricule: string, password: string): Promise<User> => {
    setLoading(true); setError(null);
    try {
      const r = await api.login(matricule, password);
      const u: User = { matricule: r.user.matricule, nom: r.user.nom, prenom: r.user.prenom, role: r.user.role as User['role'], must_change_password: r.must_change_password };
      setUser(u); setToken(r.token);
      localStorage.setItem(TOKEN_KEY, r.token);
      localStorage.setItem(USER_KEY, JSON.stringify(u));
      return u;
    } catch (e) {
      const msg = e instanceof Error ? e.message : 'Connexion impossible';
      setError(msg); throw new Error(msg);
    } finally { setLoading(false); }
  }, []);

  const logout = useCallback(async () => {
    try { await api.logout(); } finally {
      setUser(null); setToken(null);
      localStorage.removeItem(TOKEN_KEY); localStorage.removeItem(USER_KEY);
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
