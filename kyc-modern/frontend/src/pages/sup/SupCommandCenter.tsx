import React, { useMemo, useState } from 'react';
import { useFetch, todayISO } from '../../hooks';
import { usePersistedState } from '../../hooks/usePersistedState';
import { useDossierShortcuts } from '../../hooks/useDossierShortcuts';
import { useLiveClock, formatDuration, urgenceLevel, URGENCE_COLOR_VAR } from '../../hooks/useLiveClock';
import * as api from '../../services/api';
import { apiFetch } from '../../services/api';
import { Dossier, DossierStatut } from '../../types';
import { StatCard, Alert, LoadingCenter, EmptyState, Modal } from '../../components/ui';
import { DossierDetailModal } from '../../components/DossierComponents';

// ─────────────────────────────────────────────────────────────────────────────
// Command Center — vue unique et en direct pour piloter la journée à
// 5000 dossiers/j : compteurs live, file active triée par urgence, alertes
// traitement-long intégrées à la même table (plus besoin de naviguer entre
// Dashboard et File d'attente), transfert en un clic, raccourcis clavier.
// ─────────────────────────────────────────────────────────────────────────────

interface AlerteTraitementLong {
  id: number;
  dossier_id: string;
  agent_saisie: string;
  traitement_demarre_le: number;
  cree_le: number;
}

type SortKey = 'id' | 'duree' | 'statut' | 'agent' | 'numero';

const REFRESH_MS = 5_000;

const STATUT_LABEL: Record<DossierStatut, string> = {
  en_attente: 'En attente', en_cours: 'En cours', accepte: 'Accepté', rejete: 'Rejeté',
} as any;

const STATUT_BADGE_CLASS: Record<DossierStatut, string> = {
  en_attente: 'b-attente',
  en_cours: 'b-cours',
  accepte: 'b-accepte',
  rejete: 'b-rejete',
};

function DureeCell({ depuisSec }: { depuisSec: number | null }) {
  const now = useLiveClock(1000);
  if (depuisSec === null) return <span style={{ color: 'var(--ink-4)' }}>—</span>;
  // depuisSec est un timestamp epoch (secondes) de départ ; on recalcule la
  // durée écoulée à chaque tick pour un affichage qui avance seul, sans
  // dépendre du prochain refetch réseau.
  const elapsed = Math.floor(now / 1000) - depuisSec;
  const level = urgenceLevel(elapsed);
  return (
    <span style={{ fontWeight: 700, color: URGENCE_COLOR_VAR[level] }}>
      {formatDuration(elapsed)}
    </span>
  );
}

export function SupCommandCenter() {
  const [date] = useState(todayISO());
  const [filtreTexte, setFiltreTexte] = usePersistedState('commandCenter.filtreTexte', '');
  const [filtreStatut, setFiltreStatut] = usePersistedState<DossierStatut | ''>('commandCenter.filtreStatut', '');
  const [sortKey, setSortKey] = usePersistedState<SortKey>('commandCenter.sortKey', 'duree');
  const [sortDesc, setSortDesc] = usePersistedState('commandCenter.sortDesc', true);
  const [sel, setSel] = useState<Dossier | null>(null);
  const [transfertTarget, setTransfertTarget] = useState<Dossier | null>(null);
  const [cible, setCible] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const stats = useFetch(() => api.getDossierStats(), [], { silent: true });
  const presence = useFetch(() => api.getPresenceResume(), [], { silent: true });
  const file = useFetch(() => api.getSupFileAttente(date), [date], { silent: true });
  const alertes = useFetch(
    () => apiFetch<{ success: boolean; alertes: AlerteTraitementLong[] }>('/api/alertes-traitement'),
    [],
    { silent: true }
  );
  // Seuil de charge configurable (Configuration > seuil d'alerte) plutôt
  // qu'une valeur figée dans le code — l'admin peut l'ajuster sans déploi.
  const seuilAlerte = useFetch(() => api.getSeuilAlerte(), [], { silent: true });
  const seuil = seuilAlerte.data?.seuil ?? 10;

  const now = useLiveClock(1000);
  const [lastFetchAt, setLastFetchAt] = useState(Date.now());
  React.useEffect(() => { setLastFetchAt(Date.now()); }, [file.data]);
  const secondsSinceRefresh = Math.max(0, Math.floor((now - lastFetchAt) / 1000));

  // useFetch (hooks/index.ts) ne poll pas tout seul : on rafraîchit la file
  // et les alertes nous-mêmes toutes les 5s pour garder la vue "en direct"
  // sans rechargement complet de la page.
  React.useEffect(() => {
    const t = setInterval(() => {
      stats.refetchSilent();
      presence.refetchSilent();
      file.refetchSilent();
      alertes.refetchSilent();
    }, REFRESH_MS);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const alertesByDossier = useMemo(() => {
    const map = new Map<string, AlerteTraitementLong>();
    (alertes.data?.alertes ?? []).forEach(a => map.set(a.dossier_id, a));
    return map;
  }, [alertes.data]);

  const actifs = useMemo(
    () => (file.data?.dossiers ?? []).filter(d => d.statut === 'en_attente' || d.statut === 'en_cours'),
    [file.data]
  );

  const filtered = useMemo(() => {
    const q = filtreTexte.trim().toLowerCase();
    return actifs.filter(d => {
      if (filtreStatut && d.statut !== filtreStatut) return false;
      if (!q) return true;
      return (d.id?.toLowerCase().includes(q))
        || (d.agent_saisie?.toLowerCase().includes(q))
        || (d.numero_mtn?.toLowerCase().includes(q));
    });
  }, [actifs, filtreTexte, filtreStatut]);

  const sorted = useMemo(() => {
    const withDuree = filtered.map(d => {
      const alerte = alertesByDossier.get(d.id);
      const depuis = d.assigne_le && d.assigne_le > 0 ? d.assigne_le : (alerte ? alerte.traitement_demarre_le : null);
      const duree = depuis ? Math.floor(Date.now() / 1000) - depuis : -1;
      return { d, alerte, depuis, duree };
    });
    const dir = sortDesc ? -1 : 1;
    return withDuree.sort((a, b) => {
      switch (sortKey) {
        case 'id': return dir * a.d.id.localeCompare(b.d.id);
        case 'duree': return dir * (a.duree - b.duree);
        case 'statut': return dir * a.d.statut.localeCompare(b.d.statut);
        case 'agent': return dir * (a.d.agent_saisie || '').localeCompare(b.d.agent_saisie || '');
        case 'numero': return dir * (a.d.numero_mtn || '').localeCompare(b.d.numero_mtn || '');
        default: return 0;
      }
    });
  }, [filtered, alertesByDossier, sortKey, sortDesc]);

  const toggleSort = (key: SortKey) => {
    if (sortKey === key) setSortDesc(s => !s);
    else { setSortKey(key); setSortDesc(true); }
  };

  const refetchAll = () => {
    stats.refetch();
    presence.refetch();
    file.refetch();
    alertes.refetch();
  };

  const selIndex = sel ? sorted.findIndex(r => r.d.id === sel.id) : -1;
  useDossierShortcuts({
    enabled: !transfertTarget,
    onSuivant: () => { const n = selIndex < 0 ? 0 : Math.min(selIndex + 1, sorted.length - 1); if (sorted[n]) setSel(sorted[n].d); },
    onPrecedent: () => { const p = selIndex < 0 ? 0 : Math.max(selIndex - 1, 0); if (sorted[p]) setSel(sorted[p].d); },
    onOuvrir: () => { if (!sel && sorted[0]) setSel(sorted[0].d); },
    onTransferer: () => { if (sel) { setTransfertTarget(sel); setSel(null); } },
    onEchap: () => { setSel(null); setTransfertTarget(null); },
    onRafraichir: refetchAll,
  });

  const doTransfert = async () => {
    if (!transfertTarget || !cible.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.transfererDossier(transfertTarget.id, cible.trim().toUpperCase());
      setTransfertTarget(null); setCible(''); setSel(null); refetchAll();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const acquitterAlerte = async (alerteId: number) => {
    try { await apiFetch(`/api/alertes-traitement/${alerteId}/vue`, { method: 'POST' }); alertes.refetch(); } catch { /* ignore */ }
  };

  const alertesCount = alertes.data?.alertes?.length ?? 0;
  const waitingCount = actifs.filter(d => d.statut === 'en_attente').length;
  const enCoursCount = actifs.filter(d => d.statut === 'en_cours').length;
  const chargeCritique = waitingCount >= seuil;

  const SortHeader = ({ label, k }: { label: string; k: SortKey }) => (
    <th onClick={() => toggleSort(k)} style={{ cursor: 'pointer', userSelect: 'none', whiteSpace: 'nowrap' }}>
      {label} {sortKey === k ? (sortDesc ? '▼' : '▲') : ''}
    </th>
  );

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Command Center</h1>
          <p className="page-sub">Vue unique en direct — file active, alertes et présence, actualisée toutes les 5s en arrière-plan.</p>
        </div>
        <div style={{ textAlign: 'right' }}>
          <button className="btn btn-ghost btn-sm" onClick={refetchAll}>↻ Actualiser</button>
          <div style={{ fontSize: 11, color: 'var(--ink-4)', marginTop: 4 }}>
            Mis à jour il y a {formatDuration(secondsSinceRefresh)}
          </div>
        </div>
      </div>

      <p style={{ fontSize: 11.5, color: 'var(--ink-4)', margin: '-.5rem 0 .75rem' }}>
        Raccourcis : <kbd>↓</kbd>/<kbd>↑</kbd> naviguer · <kbd>Entrée</kbd> ouvrir · <kbd>T</kbd> transférer · <kbd>R</kbd> rafraîchir · <kbd>Échap</kbd> fermer
      </p>

      {(stats.error || file.error || err) && <Alert kind="error">{stats.error || file.error || err}</Alert>}

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <StatCard label="En attente" value={waitingCount} variant={chargeCritique ? 'rejete' : 'attente'} sub={`File active — seuil ${seuil}`} />
        <StatCard label="En cours" value={enCoursCount} variant="cours" sub="Traitement actif" />
        <StatCard label="Alertes actives" value={alertesCount} variant={alertesCount ? 'rejete' : undefined} sub="Traitement > 5 min" />
        <StatCard label="Traités aujourd'hui" value={(stats.data?.accepte ?? 0) + (stats.data?.rejete ?? 0)} variant="accepte" />
        <StatCard label="Agents en ligne" value={presence.data?.en_ligne ?? 0} />
      </div>

      <div className="card">
        <div className="filter-bar">
          <div className="field" style={{ flex: 1, minWidth: 220 }}>
            <label>Recherche</label>
            <input
              value={filtreTexte} onChange={e => setFiltreTexte(e.target.value)}
              placeholder="ID dossier, agent, numéro…"
            />
          </div>
          <div className="field">
            <label>Statut</label>
            <select value={filtreStatut} onChange={e => setFiltreStatut(e.target.value as DossierStatut | '')}>
              <option value="">Tous (actifs)</option>
              <option value="en_attente">En attente</option>
              <option value="en_cours">En cours</option>
            </select>
          </div>
        </div>
      </div>

      {file.loading ? <LoadingCenter /> : !sorted.length ? (
        <div className="card"><EmptyState icon="✅" title="Aucun dossier actif" body="La file est vide pour le moment." /></div>
      ) : (
        <div className="card">
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '.5rem' }}>
            <span style={{ fontSize: 12, color: 'var(--ink-3)' }}>{sorted.length} dossier(s) actif(s)</span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <SortHeader label="ID" k="id" />
                  <SortHeader label="Agent" k="agent" />
                  <SortHeader label="Numéro" k="numero" />
                  <SortHeader label="Statut" k="statut" />
                  <SortHeader label="Depuis" k="duree" />
                  <th>Alerte</th>
                  <th style={{ width: 90 }}>Action</th>
                </tr>
              </thead>
              <tbody>
                {sorted.map(({ d, alerte, depuis }) => (
                  <tr
                    key={d.id}
                    onClick={() => setSel(d)}
                    style={{ cursor: 'pointer', background: sel?.id === d.id ? 'var(--surface-2)' : undefined }}
                  >
                    <td><strong>{d.id}</strong></td>
                    <td>{d.agent_saisie || '—'}</td>
                    <td>{d.numero_mtn || '—'}</td>
                    <td><span className={`badge ${STATUT_BADGE_CLASS[d.statut] ?? 'b-attente'}`}>{STATUT_LABEL[d.statut] || d.statut}</span></td>
                    <td><DureeCell depuisSec={depuis} /></td>
                    <td>
                      {alerte ? (
                        <button
                          className="btn btn-ghost btn-sm"
                          title="Marquer l'alerte comme vue"
                          onClick={e => { e.stopPropagation(); acquitterAlerte(alerte.id); }}
                        >
                          ⚠ Vu
                        </button>
                      ) : <span style={{ color: 'var(--ink-4)' }}>—</span>}
                    </td>
                    <td>
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={e => { e.stopPropagation(); setTransfertTarget(d); }}
                      >
                        Transférer
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {sel && (
        <DossierDetailModal dossier={sel} onClose={() => setSel(null)} actions={
          <button className="btn btn-warn btn-sm" onClick={() => { setTransfertTarget(sel); setSel(null); }}>Transférer</button>
        } />
      )}

      {transfertTarget && (
        <Modal title={`Transférer ${transfertTarget.id}`} onClose={() => { setTransfertTarget(null); setCible(''); }} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setTransfertTarget(null); setCible(''); }}>Annuler</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !cible.trim()} onClick={doTransfert}>Confirmer</button>
          </>
        }>
          <div className="field">
            <label>Matricule agent cible<span className="req">*</span></label>
            <input value={cible} onChange={e => setCible(e.target.value.toUpperCase())} placeholder="Ex. AG002" autoFocus />
          </div>
        </Modal>
      )}
    </>
  );
}
