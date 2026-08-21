import { useEffect, useRef, useState } from 'react';
import * as api from '../services/api';
import { apiFetch } from '../services/api';

interface AlerteTraitementLong { id: number }

type Field = 'en_attente' | 'en_cours' | 'alertes';

const POLL_MS = 15_000;

/**
 * Badge de charge en direct, à placer à côté des entrées de nav
 * "File d'attente" / "Command Center" / "Tableau de bord".
 *
 * S'appuie uniquement sur des endpoints déjà existants — aucune route
 * backend supplémentaire n'est nécessaire :
 *   - GET /api/dossiers/stats  (via api.getDossierStats)  → en_attente, en_cours
 *   - GET /api/alertes-traitement                          → alertes non vues
 *
 * Poll toutes les 15s : ces deux endpoints ne renvoient que des compteurs/
 * une courte liste, donc tourner en permanence sur toutes les pages ne pèse
 * pas sur le serveur même à 5000 dossiers/jour.
 *
 * Intégration dans votre nav (fichier non fourni, à adapter) :
 *
 *   <NavLink to="/sup/file-attente">
 *     File d'attente <QueueBadge field="en_attente" />
 *   </NavLink>
 *   <NavLink to="/sup/dashboard">
 *     Tableau de bord <QueueBadge field="alertes" />
 *   </NavLink>
 */
export function QueueBadge({ field, title }: { field: Field; title?: string }) {
  const [value, setValue] = useState<number | null>(null);
  const [seuil, setSeuil] = useState<number>(10);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  // Seuil chargé une fois au montage : même source que SupFileAttente /
  // SupCommandCenter (Configuration > seuil d'alerte), pour que la couleur
  // du badge reste cohérente avec le reste de l'app sans valeur figée.
  useEffect(() => {
    let cancelled = false;
    api.getSeuilAlerte().then(d => { if (!cancelled) setSeuil((d as any)?.seuil ?? 10); }).catch(() => {});
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    let cancelled = false;

    const poll = async () => {
      try {
        if (field === 'alertes') {
          const d = await apiFetch<{ success: boolean; alertes: AlerteTraitementLong[] }>('/api/alertes-traitement');
          if (!cancelled && d.success) setValue(d.alertes?.length ?? 0);
        } else {
          const d = await api.getDossierStats();
          if (!cancelled) setValue((d as any)?.[field] ?? 0);
        }
      } catch {
        // silencieux : un badge qui rate un poll n'est pas une panne à
        // afficher, il se corrigera au poll suivant
      }
    };

    poll();
    timer.current = setInterval(poll, POLL_MS);
    return () => { cancelled = true; if (timer.current) clearInterval(timer.current); };
  }, [field]);

  if (value === null || value === 0) return null;

  const variant: 'info' | 'warning' | 'danger' =
    field === 'alertes' ? 'danger' : value >= seuil ? 'danger' : value >= Math.ceil(seuil / 2) ? 'warning' : 'info';
  const colorVar = variant === 'danger' ? 'var(--danger)' : variant === 'warning' ? 'var(--warning)' : 'var(--info)';

  return (
    <span
      title={title}
      style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        minWidth: 20, height: 20, padding: '0 6px', marginLeft: 8,
        borderRadius: 999, fontSize: 11, fontWeight: 700, color: '#fff',
        background: colorVar, lineHeight: 1,
      }}
    >
      {value > 99 ? '99+' : value}
    </span>
  );
}
