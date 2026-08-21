import { useEffect, useState } from 'react';

/**
 * Équivalent de useState, mais dont la valeur survit à la navigation entre
 * pages et au rechargement de l'onglet (localStorage). Chaque page utilise
 * une clé namespacée (ex. 'fileAttente.filters', 'captures.filters') pour
 * ne jamais entrer en collision avec une autre page.
 *
 * Note : hooks/index.ts expose déjà `useLocalStorage`, mais son setter ne
 * prend qu'une valeur directe (`set(v: T)`). Ici, `setState` accepte aussi
 * une fonction de mise à jour (`setState(prev => ...)`), nécessaire pour les
 * objets de filtres (ex. `setFilters(f => ({ ...f, type: 'cni' }))` dans
 * CapturesPage) — d'où un hook dédié plutôt qu'une réutilisation directe.
 *
 * Si le JSON stocké est corrompu, absent, ou que localStorage est
 * inaccessible (navigation privée stricte, quota dépassé…), on retombe
 * silencieusement sur la valeur initiale : la persistance est un confort,
 * jamais une dépendance bloquante.
 */
export function usePersistedState<T>(key: string, initial: T): [T, (v: T | ((prev: T) => T)) => void] {
  const storageKey = `kyc.sup.${key}`;

  const [state, setState] = useState<T>(() => {
    try {
      const raw = window.localStorage.getItem(storageKey);
      return raw !== null ? (JSON.parse(raw) as T) : initial;
    } catch {
      return initial;
    }
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(state));
    } catch {
      // quota dépassé / navigation privée : on continue sans persister
    }
  }, [storageKey, state]);

  return [state, setState];
}

/** Réinitialise les filtres persistés d'une page (bouton "Réinitialiser"). */
export function clearPersistedState(key: string): void {
  try { window.localStorage.removeItem(`kyc.sup.${key}`); } catch { /* ignore */ }
}
