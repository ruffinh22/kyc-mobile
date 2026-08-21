import { useEffect, useState } from 'react';

/**
 * Force un re-render à intervalle régulier pour que les durées affichées
 * ("en cours depuis 3min12s") restent exactes sans dépendre d'un refetch
 * serveur. Le hook ne renvoie qu'un timestamp de tick : c'est au composant
 * appelant de recalculer `Date.now() - timestampDepart` à chaque rendu.
 *
 * Usage :
 *   const now = useLiveClock(1000); // tick chaque seconde
 *   const secondes = Math.floor((now - dossier.assigne_le * 1000) / 1000);
 *   <span>{formatDuration(secondes)}</span>
 */
export function useLiveClock(intervalMs = 1000): number {
  const [tick, setTick] = useState(() => Date.now());

  useEffect(() => {
    const t = setInterval(() => setTick(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);

  return tick;
}

/** Formate une durée en secondes en "Xs" / "Xmin Ys" / "Xh Ymin", en français. */
export function formatDuration(totalSeconds: number): string {
  const s = Math.max(0, Math.floor(totalSeconds));
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  const rs = s % 60;
  if (m < 60) return `${m}min ${String(rs).padStart(2, '0')}s`;
  const h = Math.floor(m / 60);
  const rm = m % 60;
  return `${h}h${String(rm).padStart(2, '0')}`;
}

/**
 * Niveau d'urgence associé à une durée d'attente/traitement, pour colorer
 * cellules/badges de façon cohérente dans toute l'app.
 * Seuils par défaut alignés sur alertes-routes.ts (5 min = traitement long).
 */
export type UrgenceLevel = 'ok' | 'attention' | 'critique';

export function urgenceLevel(totalSeconds: number, seuilAttentionMin = 3, seuilCritiqueMin = 5): UrgenceLevel {
  const min = totalSeconds / 60;
  if (min >= seuilCritiqueMin) return 'critique';
  if (min >= seuilAttentionMin) return 'attention';
  return 'ok';
}

export const URGENCE_COLOR_VAR: Record<UrgenceLevel, string> = {
  ok: 'var(--success)',
  attention: 'var(--warning)',
  critique: 'var(--danger)',
};
