import { useState, useEffect, useCallback, useRef } from 'react';
import { sendHeartbeat } from '../services/api';

export function useFetch<T>(
  fn: (() => Promise<T>) | null,
  deps: unknown[] = [],
  options: { silent?: boolean } = {}
) {
  const [data,    setData]    = useState<T | null>(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState<string | null>(null);
  const [tick,    setTick]    = useState(0);

  useEffect(() => {
    if (!fn) return;
    let dead = false;
    if (!options.silent) {
      setLoading(true);
      setError(null);
    }
    fn()
      .then(r  => { if (!dead) setData(r); })
      .catch(e => {
        if (!dead) {
          setData(null);
          setError(e instanceof Error ? e.message : 'Erreur');
        }
      })
      .finally(() => { if (!dead && !options.silent) setLoading(false); });
    return () => { dead = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tick, ...deps]);

  const refetch = useCallback(() => {
    setLoading(true);
    setError(null);
    setTick(t => t + 1);
  }, []);

  const refetchSilent = useCallback(() => {
    setTick(t => t + 1);
  }, []);

  return { data, loading, error, refetch, refetchSilent };
}

export function useHeartbeat(active: boolean, ms = 60_000) {
  const ref = useRef<ReturnType<typeof setInterval> | null>(null);
  useEffect(() => {
    if (!active) return;
    sendHeartbeat().catch(() => {});
    ref.current = setInterval(() => sendHeartbeat().catch(() => {}), ms);
    return () => { if (ref.current) clearInterval(ref.current); };
  }, [active, ms]);
}

export function useDebounce<T>(val: T, delay: number): T {
  const [deb, setDeb] = useState<T>(val);
  useEffect(() => {
    const t = setTimeout(() => setDeb(val), delay);
    return () => clearTimeout(t);
  }, [val, delay]);
  return deb;
}

export function useLocalStorage<T>(key: string, init: T): [T, (v: T) => void] {
  const [val, setVal] = useState<T>(() => {
    try { const s = localStorage.getItem(key); return s ? JSON.parse(s) as T : init; }
    catch { return init; }
  });
  const set = useCallback((v: T) => { setVal(v); localStorage.setItem(key, JSON.stringify(v)); }, [key]);
  return [val, set];
}

export function todayISO() { return new Date().toISOString().slice(0, 10); }

export function nDaysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n);
  return d.toISOString().slice(0, 10);
}
