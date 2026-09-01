import { useEffect, useState, useCallback, useRef } from 'react';
import * as api from '../services/api';

type Options = {
  /** Interval en ms; si null ou <=0 alors pas de polling */
  pollIntervalMs?: number | null;
  /** Si true, n'active le polling qu'en production (NODE_ENV === 'production') */
  productionOnly?: boolean;
};

export function useAdminFieldsSchema(opts: Options = {}) {
  const { pollIntervalMs = 60_000, productionOnly = true } = opts;
  const [inactive, setInactive] = useState<Set<string>>(new Set());
  const intervalRef = useRef<number | null>(null);

  const refresh = useCallback(async () => {
    try {
      const res = await api.getAdminFields();
      const s = new Set<string>((res.fields || [])
        .filter((r: any) => String(r.target_table || '').toLowerCase() === 'dossiers' && r.status !== 'active')
        .map((r: any) => String(r.name)));
      setInactive(s);
    } catch (e) {
      // ignore
    }
  }, []);

  useEffect(() => { void refresh(); }, [refresh]);

  useEffect(() => {
    const isProd = typeof process !== 'undefined' && process.env && process.env.NODE_ENV === 'production';
    if (productionOnly && !isProd) return undefined;
    if (!pollIntervalMs || pollIntervalMs <= 0) return undefined;

    // window.setInterval returns a number in browsers
    intervalRef.current = window.setInterval(() => { void refresh(); }, pollIntervalMs) as unknown as number;
    return () => {
      if (intervalRef.current != null) {
        clearInterval(intervalRef.current);
        intervalRef.current = null;
      }
    };
  }, [pollIntervalMs, productionOnly, refresh]);

  return {
    inactiveFields: inactive,
    isFieldActive: (name: string) => !inactive.has(name),
    refresh,
  } as const;
}

export default useAdminFieldsSchema;
