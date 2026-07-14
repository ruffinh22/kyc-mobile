import { useState } from 'react';
import { useFetch, useDebounce, todayISO, nDaysAgo } from '../../hooks';
import * as api from '../../services/api';
import { Dossier, DossierStatut } from '../../types';
import { StatCard, Alert, LoadingCenter, EmptyState, Modal } from '../../components/ui';
import { DossiersTable, DossierDetailModal } from '../../components/DossierComponents';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dashboard Superviseur
// ─────────────────────────────────────────────────────────────────────────────
export function SupDashboard() {
  const stats    = useFetch(() => api.getDossierStats(), []);
  const presence = useFetch(() => api.getPresenceResume(), []);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Tableau de bord superviseur</h1>
          <p className="page-sub">Vue d'ensemble activité + équipe — {new Date().toLocaleDateString('fr-FR', { weekday:'long', year:'numeric', month:'long', day:'numeric' })}</p></div>
        <button className="btn btn-ghost btn-sm" onClick={() => { stats.refetch(); presence.refetch(); }}>↻ Actualiser</button>
      </div>

      {stats.error && <Alert kind="error">{stats.error}</Alert>}
      {stats.loading ? <LoadingCenter /> : stats.data && (
        <div className="stats-grid">
          <StatCard label="En attente" value={stats.data.en_attente} variant="attente" sub="File d'attente" />
          <StatCard label="En cours"   value={stats.data.en_cours}   variant="cours"   sub="Traitement en cours" />
          <StatCard label="Acceptés"   value={stats.data.accepte}    variant="accepte" sub="Aujourd'hui" />
          <StatCard label="Rejetés"    value={stats.data.rejete}     variant="rejete"  sub="Aujourd'hui" />
          <StatCard label="Total"      value={stats.data.total} />
        </div>
      )}

      <div className="card">
        <div className="card-header"><p className="card-title">Présence équipe en temps réel</p></div>
        {presence.loading ? <LoadingCenter /> : presence.data && (
          <>
            <div className="stats-grid" style={{ marginBottom:'1rem' }}>
              <StatCard label="En ligne" value={presence.data.en_ligne} variant="accepte" />
              <StatCard label="En pause" value={presence.data.en_pause} variant="attente" />
              <StatCard label="Total actifs" value={presence.data.en_ligne + presence.data.en_pause} />
            </div>
            {Object.keys(presence.data.detail).length > 0 ? (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Matricule</th><th>Statut</th></tr></thead>
                  <tbody>
                    {Object.entries(presence.data.detail).map(([m, s]) => (
                      <tr key={m}>
                        <td><strong>{m}</strong></td>
                        <td><span className={`badge b-${s}`}>{s === 'online' ? 'En ligne' : 'En pause'}</span></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <EmptyState icon="🛌" title="Aucun agent actif" />}
          </>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. File d'attente Superviseur (vue complète avec transfert)
// ─────────────────────────────────────────────────────────────────────────────
export function SupFileAttente() {
  const [date, setDate] = useState(todayISO());
  const [statut, setStatut] = useState<DossierStatut|''>('');
  const [sel, setSel] = useState<Dossier|null>(null);
  const [transfertTarget, setTransfertTarget] = useState<Dossier|null>(null);
  const [cible, setCible] = useState('');
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const { data, loading, error, refetch } = useFetch(
    () => api.getSupFileAttente(date), [date]
  );

  const filtered = (data?.dossiers ?? []).filter(d => !statut || d.statut === statut);

  const doTransfert = async () => {
    if (!transfertTarget || !cible.trim()) return;
    setBusy(true); setErr(null);
    try {
      await api.transfererDossier(transfertTarget.id, cible.trim().toUpperCase(), msg.trim() || undefined);
      setTransfertTarget(null); setCible(''); setMsg('');
      setSel(null); refetch();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const STATUTS: { v: DossierStatut|''; l: string }[] = [
    { v:'', l:'Tous' }, { v:'en_attente', l:'En attente' },
    { v:'en_cours', l:'En cours' }, { v:'accepte', l:'Acceptés' }, { v:'rejete', l:'Rejetés' },
  ];

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">File d'attente — vue superviseur</h1>
          <p className="page-sub">Tous les dossiers du jour avec possibilité de transfert.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}

      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <div className="field"><label>Statut</label>
            <select value={statut} onChange={e => setStatut(e.target.value as DossierStatut|'')}>
              {STATUTS.map(s => <option key={s.v} value={s.v}>{s.l}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? <LoadingCenter /> : (
        <div className="card">
          <div style={{ fontSize:12, color:'var(--ink-3)', marginBottom:'.75rem' }}>{filtered.length} dossier(s)</div>
          <DossiersTable dossiers={filtered} onSelect={setSel} />
        </div>
      )}

      {sel && (
        <DossierDetailModal dossier={sel} onClose={() => setSel(null)} actions={
          <button className="btn btn-warn btn-sm" onClick={() => { setTransfertTarget(sel); setSel(null); }}>Transférer</button>
        }/>
      )}

      {transfertTarget && (
        <Modal title={`Transférer ${transfertTarget.id}`} onClose={() => { setTransfertTarget(null); setCible(''); setMsg(''); }} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setTransfertTarget(null); setCible(''); }}>Annuler</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !cible.trim()} onClick={doTransfert}>Confirmer</button>
          </>
        }>
          <div className="form-grid">
            <div className="field"><label>Matricule agent cible<span className="req">*</span></label><input value={cible} onChange={e => setCible(e.target.value.toUpperCase())} placeholder="Ex. AG002" autoFocus /></div>
            <div className="field"><label>Message (optionnel)</label><textarea value={msg} onChange={e => setMsg(e.target.value)} placeholder="Raison du transfert…" /></div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Historique complet
// ─────────────────────────────────────────────────────────────────────────────
export function SupHistorique() {
  const [debut, setDebut] = useState(nDaysAgo(7));
  const [fin, setFin]     = useState(todayISO());
  const [statut, setStatut] = useState<DossierStatut|''>('');
  const [agent, setAgent]   = useState('');
  const [search, setSearch] = useState('');
  const dSearch = useDebounce(search, 350);
  const [sel, setSel] = useState<Dossier|null>(null);
  const [transfertTarget, setTransfertTarget] = useState<Dossier|null>(null);
  const [cible, setCible] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const { data, loading, error, refetch } = useFetch(
    () => api.getDossiersHistorique({ debut, fin, statut: statut||undefined, agent: agent||undefined, search: dSearch||undefined, limit: 500 }),
    [debut, fin, statut, agent, dSearch]
  );

  const doTransfert = async () => {
    if (!transfertTarget || !cible.trim()) return;
    setBusy(true); setErr(null);
    try { await api.transfererDossier(transfertTarget.id, cible.trim().toUpperCase()); setTransfertTarget(null); setCible(''); setSel(null); refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Historique des dossiers</h1><p className="page-sub">Vue complète filtrée sur toutes les périodes.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}

      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <div className="field"><label>Statut</label>
            <select value={statut} onChange={e => setStatut(e.target.value as DossierStatut|'')}>
              <option value="">Tous</option>
              <option value="en_attente">En attente</option>
              <option value="en_cours">En cours</option>
              <option value="accepte">Acceptés</option>
              <option value="rejete">Rejetés</option>
            </select>
          </div>
          <div className="field"><label>Agent</label><input value={agent} onChange={e => setAgent(e.target.value.toUpperCase())} placeholder="Matricule…" /></div>
          <div className="field"><label>Recherche</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Réf., numéro…" /></div>
        </div>
      </div>

      {loading ? <LoadingCenter /> : (
        <div className="card">
          <div style={{ fontSize:12, color:'var(--ink-3)', marginBottom:'.75rem' }}>{data?.total ?? 0} résultat(s)</div>
          <DossiersTable dossiers={data?.dossiers ?? []} onSelect={setSel} />
        </div>
      )}

      {sel && (
        <DossierDetailModal dossier={sel} onClose={() => setSel(null)} actions={
          <button className="btn btn-warn btn-sm" onClick={() => { setTransfertTarget(sel); setSel(null); }}>Transférer</button>
        }/>
      )}

      {transfertTarget && (
        <Modal title={`Transférer ${transfertTarget.id}`} onClose={() => { setTransfertTarget(null); setCible(''); }} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setTransfertTarget(null); setCible(''); }}>Annuler</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !cible.trim()} onClick={doTransfert}>Confirmer</button>
          </>
        }>
          <div className="field"><label>Matricule agent cible<span className="req">*</span></label><input value={cible} onChange={e => setCible(e.target.value.toUpperCase())} autoFocus /></div>
        </Modal>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Présence agents
// ─────────────────────────────────────────────────────────────────────────────
export function SupPresence() {
  const { data, loading, error, refetch } = useFetch(() => api.getPresenceResume(), []);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Présence des agents</h1><p className="page-sub">Statut en temps réel — heartbeat toutes les 60s.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻ Actualiser</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : data && (
        <>
          <div className="stats-grid">
            <StatCard label="En ligne" value={data.en_ligne} variant="accepte" />
            <StatCard label="En pause" value={data.en_pause} variant="attente" />
            <StatCard label="Total actifs" value={data.en_ligne + data.en_pause} />
          </div>
          <div className="card">
            {!Object.keys(data.detail).length
              ? <EmptyState icon="🛌" title="Aucun agent actif" body="Tous les agents sont hors ligne." />
              : (
                <div className="table-wrap">
                  <table>
                    <thead><tr><th>Matricule</th><th>Statut</th></tr></thead>
                    <tbody>
                      {Object.entries(data.detail).map(([m, s]) => (
                        <tr key={m}>
                          <td><strong>{m}</strong></td>
                          <td><span className={`badge b-${s}`}>{s === 'online' ? 'En ligne' : 'En pause'}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Performance agents
// ─────────────────────────────────────────────────────────────────────────────
export function SupPerformance() {
  const [debut, setDebut] = useState(nDaysAgo(6));
  const [fin, setFin]     = useState(todayISO());
  const { data, loading, error, refetch } = useFetch(() => api.getSupPerformance(debut, fin), [debut, fin]);
  const agents = data?.agents ?? [];
  const maxTotal = Math.max(1, ...agents.map(a => a.total));

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Performance agents</h1><p className="page-sub">Dossiers traités par agent sur la période.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <div className="card">
          {!agents.length ? <EmptyState icon="📊" title="Aucune donnée" /> : (
            <>
              <div className="bar-chart" style={{ marginBottom:'1.5rem' }}>
                {[...agents].sort((a,b) => b.total - a.total).map(a => (
                  <div className="bar-row" key={a.matricule}>
                    <span className="bar-label" style={{ minWidth:70, fontSize:11 }}>{a.matricule}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width:`${(a.total/maxTotal)*100}%` }} /></div>
                    <span className="bar-val">{a.total}</span>
                  </div>
                ))}
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Agent</th><th>Total</th><th>Acceptés</th><th>Rejetés</th><th>Taux acceptation</th></tr></thead>
                  <tbody>
                    {[...agents].sort((a,b) => b.total - a.total).map(a => (
                      <tr key={a.matricule}>
                        <td><strong>{a.matricule}</strong></td>
                        <td>{a.total}</td>
                        <td style={{ color:'var(--success)', fontWeight:600 }}>{a.accepte}</td>
                        <td style={{ color:'var(--danger)',  fontWeight:600 }}>{a.rejete}</td>
                        <td>{a.total > 0 ? `${Math.round((a.accepte/a.total)*100)}%` : '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Distribution
// ─────────────────────────────────────────────────────────────────────────────
export function SupDistribution() {
  const modeQ    = useFetch(() => api.getDistributionMode(), []);
  const statsQ   = useFetch(() => api.getDossierStats(), []);
  const presenceQ = useFetch(() => api.getPresenceResume(), []);

  const [changing, setChanging] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const toggleMode = async () => {
    const cur = modeQ.data?.mode ?? 'manuel';
    const next = cur === 'auto' ? 'manuel' : 'auto';
    setChanging(true); setErr(null);
    try { await api.setDistributionMode(next); modeQ.refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setChanging(false); }
  };

  const mode = modeQ.data?.mode ?? 'manuel';

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Distribution des dossiers</h1><p className="page-sub">Gestion de l'attribution des dossiers en attente.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={() => { modeQ.refetch(); statsQ.refetch(); presenceQ.refetch(); }}>↻</button>
      </div>
      {err && <Alert kind="error">{err}</Alert>}

      <div className="card">
        <div className="card-header">
          <div><p className="card-title">Mode de distribution</p>
            <p style={{ fontSize:13, color:'var(--ink-3)', marginTop:'.25rem' }}>
              {mode === 'auto' ? 'Auto : attribution FIFO toutes les 2s au 1er agent disponible.' : 'Manuel : chaque agent choisit son dossier dans la file.'}
            </p>
          </div>
          <div className="toggle-wrap">
            <label className="toggle">
              <input type="checkbox" checked={mode === 'auto'} onChange={toggleMode} disabled={changing} />
              <span className="toggle-track" />
            </label>
            <span className="toggle-label" style={{ color: mode === 'auto' ? 'var(--success)' : 'var(--ink-3)', fontWeight: 600 }}>
              {mode === 'auto' ? 'AUTO' : 'MANUEL'}
            </span>
          </div>
        </div>
      </div>

      {statsQ.data && (
        <div className="stats-grid">
          <StatCard label="En attente" value={statsQ.data.en_attente} variant="attente" sub="À distribuer" />
          <StatCard label="En cours"   value={statsQ.data.en_cours}   variant="cours"   sub="En traitement" />
          <StatCard label="Agents actifs" value={(presenceQ.data?.en_ligne ?? 0)} variant="accepte" sub="Disponibles" />
        </div>
      )}

      <div className="card">
        <p className="card-title">Règles de distribution automatique</p>
        <div className="detail-grid">
          <div className="detail-item"><span className="detail-label">Ordre dossiers</span><span className="detail-value">FIFO strict — le plus ancien en attente d'abord</span></div>
          <div className="detail-item"><span className="detail-label">Sélection agent</span><span className="detail-value">En ligne, sans dossier en cours, disponible depuis le plus longtemps</span></div>
          <div className="detail-item"><span className="detail-label">Fréquence</span><span className="detail-value">Toutes les 2 secondes</span></div>
          <div className="detail-item"><span className="detail-label">Seuil heartbeat</span><span className="detail-value">Agent ignoré si heartbeat {'>'} 120s</span></div>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Données par heure
// ─────────────────────────────────────────────────────────────────────────────
export function SupDonneesHeures() {
  const [date, setDate] = useState(todayISO());
  const { data, loading, error, refetch } = useFetch(() => api.getDonneesHeures(date), [date]);
  const heures = data?.heures ?? [];
  const maxTotal = Math.max(1, ...heures.map(h => h.total));

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Données par heure</h1><p className="page-sub">Volume de dossiers reçus et traités heure par heure.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Date</label><input type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <div className="card">
          {!heures.length ? <EmptyState icon="⏱" title="Aucune donnée" body={`Pas de dossiers pour le ${date}`} /> : (
            <>
              <div className="bar-chart" style={{ marginBottom:'1.5rem' }}>
                {heures.map(h => (
                  <div className="bar-row" key={h.heure}>
                    <span className="bar-label">{h.heure}h</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width:`${(h.total/maxTotal)*100}%` }} /></div>
                    <span className="bar-val">{h.total}</span>
                  </div>
                ))}
              </div>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Heure</th><th>Total</th><th>Acceptés</th><th>Rejetés</th><th>En cours</th></tr></thead>
                  <tbody>
                    {heures.map(h => (
                      <tr key={h.heure}>
                        <td><strong>{h.heure}h</strong></td>
                        <td>{h.total}</td>
                        <td style={{ color:'var(--success)' }}>{h.accepte}</td>
                        <td style={{ color:'var(--danger)'  }}>{h.rejete}</td>
                        <td style={{ color:'var(--info)'    }}>{h.en_cours}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Flux & Prédiction
// ─────────────────────────────────────────────────────────────────────────────
export function SupFlux() {
  const [debut, setDebut] = useState(nDaysAgo(13));
  const [fin, setFin]     = useState(todayISO());
  const { data, loading, error, refetch } = useFetch(() => api.getDossiersHistorique({ debut, fin, limit: 2000 }), [debut, fin]);

  const parJour: Record<string, number> = {};
  (data?.dossiers ?? []).forEach(d => { parJour[d.date] = (parJour[d.date] ?? 0) + 1; });
  const evolution = Object.entries(parJour).sort(([a],[b]) => a.localeCompare(b)).map(([jour, n]) => ({ jour, n }));
  const total = evolution.reduce((s, e) => s + e.n, 0);
  const moy   = evolution.length > 0 ? Math.round(total / evolution.length) : 0;
  const maxN  = Math.max(1, ...evolution.map(e => e.n));

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Flux & Prédiction</h1><p className="page-sub">Évolution du volume de dossiers sur la période.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <>
          <div className="stats-grid">
            <StatCard label="Total période" value={total} />
            <StatCard label="Jours actifs"  value={evolution.length} />
            <StatCard label="Moyenne / jour" value={moy} variant="cours" />
          </div>
          <div className="card">
            <p className="card-title">Évolution quotidienne</p>
            {!evolution.length ? <EmptyState icon="📉" title="Aucune donnée" /> : (
              <div className="bar-chart">
                {evolution.map(e => (
                  <div className="bar-row" key={e.jour}>
                    <span className="bar-label" style={{ minWidth:60, fontSize:10 }}>{e.jour.slice(5)}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width:`${(e.n/maxN)*100}%` }} /></div>
                    <span className="bar-val">{e.n}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
          {moy > 0 && (
            <div className="card">
              <p className="card-title">Prédiction (base moyenne)</p>
              <div className="detail-grid">
                <div className="detail-item"><span className="detail-label">Demain (1 jour)</span><span className="detail-value" style={{ color:'var(--brand)', fontWeight:700, fontSize:18 }}>~{moy}</span></div>
                <div className="detail-item"><span className="detail-label">Semaine (5 jours)</span><span className="detail-value" style={{ color:'var(--brand)', fontWeight:700, fontSize:18 }}>~{moy * 5}</span></div>
                <div className="detail-item"><span className="detail-label">Mois (22 jours)</span><span className="detail-value" style={{ color:'var(--brand)', fontWeight:700, fontSize:18 }}>~{moy * 22}</span></div>
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Compilation GSM Superviseur
// ─────────────────────────────────────────────────────────────────────────────
export function SupCompilationGsm() {
  const [debut, setDebut] = useState(nDaysAgo(6));
  const [fin, setFin]     = useState(todayISO());
  const { data, loading, error, refetch } = useFetch(() => api.getGsmCompilation(debut, fin), [debut, fin]);
  const saisies = data?.saisies ?? [];

  const parAgent: Record<string, number> = {};
  saisies.forEach(s => { parAgent[s.agent_ctrl] = (parAgent[s.agent_ctrl] ?? 0) + 1; });
  const maxN = Math.max(1, ...Object.values(parAgent));

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Compilation GSM</h1><p className="page-sub">Toutes les saisies Gross Add de l'équipe.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <>
          <div className="stats-grid">
            <StatCard label="Total saisies" value={saisies.length} variant="accepte" />
            <StatCard label="Agents actifs" value={Object.keys(parAgent).length} />
          </div>
          {Object.keys(parAgent).length > 0 && (
            <div className="card">
              <p className="card-title">Répartition par agent</p>
              <div className="bar-chart">
                {Object.entries(parAgent).sort(([,a],[,b]) => b - a).map(([agent, n]) => (
                  <div className="bar-row" key={agent}>
                    <span className="bar-label" style={{ minWidth:70, fontSize:11 }}>{agent}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width:`${(n/maxN)*100}%` }} /></div>
                    <span className="bar-val">{n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
          <div className="card">
            <p className="card-title">Détail des saisies ({saisies.length})</p>
            {!saisies.length ? <EmptyState icon="📋" title="Aucune saisie" /> : (
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Agent</th><th>Numéro</th><th>Date</th><th>Type</th><th>Constat</th><th>Statut final</th></tr></thead>
                  <tbody>
                    {saisies.map(s => (
                      <tr key={s.id}>
                        <td><strong>{s.agent_ctrl}</strong></td>
                        <td>{s.numero}</td>
                        <td>{s.date_saisie}</td>
                        <td>{s.type_id || '—'}</td>
                        <td>{s.constat || '—'}</td>
                        <td>{s.statut_final || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 10. Notes qualité Superviseur
// ─────────────────────────────────────────────────────────────────────────────
export function SupNotesQualite() {
  const now = new Date();
  const [mois, setMois]     = useState(now.getMonth() + 1);
  const [annee, setAnnee]   = useState(now.getFullYear());
  const { data, loading, error, refetch } = useFetch(() => api.getNotesQualiteAll({ mois, annee }), [mois, annee]);
  const [importData, setImportData] = useState('');
  const [importErr,  setImportErr]  = useState<string|null>(null);
  const [importing,  setImporting]  = useState(false);

  const handleImport = async () => {
    setImportErr(null);
    try {
      const notes = JSON.parse(importData);
      if (!Array.isArray(notes)) throw new Error('Format attendu : tableau JSON');
      setImporting(true);
      const r = await api.importNotesQualite(notes);
      setImportData('');
      refetch();
      alert(`${r.count} note(s) importée(s)`);
    } catch (e) { setImportErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setImporting(false); }
  };

  const NOTE_COLOR = (n: number|null) => n === null ? 'var(--ink-4)' : n >= 80 ? 'var(--success)' : n >= 60 ? 'var(--warn)' : 'var(--danger)';
  const MOIS_FR = ['','Janvier','Février','Mars','Avril','Mai','Juin','Juillet','Août','Septembre','Octobre','Novembre','Décembre'];

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Notes qualité équipe</h1><p className="page-sub">Évaluations hebdomadaires et moyennes mensuelles.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Mois</label>
            <select value={mois} onChange={e => setMois(Number(e.target.value))}>
              {MOIS_FR.slice(1).map((m, i) => <option key={i+1} value={i+1}>{m}</option>)}
            </select>
          </div>
          <div className="field"><label>Année</label>
            <select value={annee} onChange={e => setAnnee(Number(e.target.value))}>
              {[2023,2024,2025,2026].map(y => <option key={y} value={y}>{y}</option>)}
            </select>
          </div>
        </div>
      </div>

      {loading ? <LoadingCenter /> : (
        <div className="card">
          <p className="card-title">{MOIS_FR[mois]} {annee} — {data?.count ?? 0} agent(s)</p>
          {!data?.notes?.length ? <EmptyState icon="⭐" title="Aucune note" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Agent</th><th>Campagne</th><th>Équipe</th><th>S1</th><th>S2</th><th>S3</th><th>S4</th><th>Moyenne</th><th>TL</th></tr></thead>
                <tbody>
                  {data.notes.map(n => (
                    <tr key={n.id}>
                      <td><strong>{n.matricule}</strong><br/><span style={{ fontSize:11, color:'var(--ink-3)' }}>{n.nom}</span></td>
                      <td>{n.campagne}</td><td>{n.equipe}</td>
                      {[n.note_w1, n.note_w2, n.note_w3, n.note_w4].map((w, i) => (
                        <td key={i} style={{ fontWeight:600, color: NOTE_COLOR(w) }}>{w ?? '—'}</td>
                      ))}
                      <td style={{ fontWeight:700, fontSize:15, color: NOTE_COLOR(n.moyenne) }}>{n.moyenne ?? '—'}</td>
                      <td>{n.tl || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      <div className="card">
        <p className="card-title">Import notes (JSON)</p>
        {importErr && <div style={{ marginBottom:'.75rem' }}><Alert kind="error">{importErr}</Alert></div>}
        <div className="form-grid">
          <div className="field"><label>Coller le JSON ici</label><textarea value={importData} onChange={e => setImportData(e.target.value)} placeholder='[{"id":"...","matricule":"AG001",...}]' style={{ minHeight:100, fontFamily:'monospace', fontSize:12 }} /></div>
          <button className="btn btn-primary btn-sm" disabled={importing || !importData.trim()} onClick={handleImport}>{importing ? 'Import…' : 'Importer les notes'}</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 11. Planning + Planning Managers
// ─────────────────────────────────────────────────────────────────────────────
export function SupPlanning() {
  const [debut, setDebut] = useState(todayISO());
  const [fin, setFin]     = useState(() => { const d = new Date(); d.setDate(d.getDate()+13); return d.toISOString().slice(0,10); });
  const [tab, setTab]     = useState<'equipe'|'import'>('equipe');
  const { data, loading, error, refetch } = useFetch(() => api.getPlanningAll(debut, fin), [debut, fin]);
  const [importData, setImportData] = useState('');
  const [importErr,  setImportErr]  = useState<string|null>(null);
  const [importing,  setImporting]  = useState(false);

  const handleImport = async () => {
    setImportErr(null);
    try {
      const entrees = JSON.parse(importData);
      if (!Array.isArray(entrees)) throw new Error('Tableau JSON attendu');
      setImporting(true);
      const r = await api.importPlanning(entrees);
      setImportData(''); refetch();
      alert(`${r.count} entrée(s) importée(s)`);
    } catch (e) { setImportErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setImporting(false); }
  };

  const parAgent: Record<string, { id: string; matricule: string; nom: string; statut: string; quartier: string; date: string; type: string; horaire: string; heure_debut: string; heure_fin: string; activite: string; lieu: string }[]> = {};
  (data?.entrees ?? []).forEach(e => { if (!parAgent[e.matricule]) parAgent[e.matricule] = []; parAgent[e.matricule].push(e); });

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Planning équipe</h1><p className="page-sub">Planning de toute l'équipe sur la période.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}

      <div className="tabs">
        <button className={`tab-btn ${tab==='equipe' ? 'active' : ''}`} onClick={() => setTab('equipe')}>Vue équipe</button>
        <button className={`tab-btn ${tab==='import' ? 'active' : ''}`} onClick={() => setTab('import')}>Import JSON</button>
      </div>

      {tab === 'equipe' && (
        <>
          <div className="card">
            <div className="filter-bar">
              <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
              <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
            </div>
          </div>
          {loading ? <LoadingCenter /> : (
            <div className="card">
              {!Object.keys(parAgent).length ? <EmptyState icon="📅" title="Aucune entrée" /> : (
                Object.entries(parAgent).map(([mat, entrees]) => (
                  <div key={mat} style={{ marginBottom:'1.5rem' }}>
                    <p style={{ fontWeight:700, marginBottom:'.5rem', color:'var(--ink)' }}>{mat}</p>
                    <div className="table-wrap">
                      <table>
                        <thead><tr><th>Date</th><th>Statut</th><th>Horaire</th><th>Activité</th><th>Lieu</th></tr></thead>
                        <tbody>
                          {entrees.map(e => (
                            <tr key={e.id}>
                              <td>{new Date(e.date+'T00:00:00').toLocaleDateString('fr-FR')}</td>
                              <td>{e.statut}</td><td>{e.horaire}</td><td>{e.activite}</td><td>{e.lieu}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </>
      )}

      {tab === 'import' && (
        <div className="card">
          <p className="card-title">Import planning (JSON)</p>
          {importErr && <div style={{ marginBottom:'.75rem' }}><Alert kind="error">{importErr}</Alert></div>}
          <div className="form-grid">
            <div className="field"><label>Coller le JSON ici</label>
              <textarea value={importData} onChange={e => setImportData(e.target.value)} placeholder='[{"id":"uuid","matricule":"AG001","date":"2024-01-15",...}]' style={{ minHeight:120, fontFamily:'monospace', fontSize:12 }} />
            </div>
            <button className="btn btn-primary btn-sm" disabled={importing || !importData.trim()} onClick={handleImport}>{importing ? 'Import…' : 'Importer le planning'}</button>
          </div>
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 12. Reporting / Export
// ─────────────────────────────────────────────────────────────────────────────
export function SupReporting() {
  const [debut, setDebut] = useState(nDaysAgo(6));
  const [fin, setFin]     = useState(todayISO());
  const [type, setType]   = useState<'dossiers'|'gsm'>('dossiers');
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const exportCSV = async () => {
    setLoading(true); setErr(null);
    try {
      let rows: Record<string,unknown>[] = [];
      let filename = '';

      if (type === 'dossiers') {
        const r = await api.getDossiersHistorique({ debut, fin, limit: 5000 });
        rows = r.dossiers as unknown as Record<string,unknown>[];
        filename = `dossiers_${debut}_${fin}.csv`;
      } else {
        const r = await api.getGsmCompilation(debut, fin);
        rows = r.saisies as unknown as Record<string,unknown>[];
        filename = `gsm_${debut}_${fin}.csv`;
      }

      if (!rows.length) { setErr('Aucune donnée à exporter'); return; }
      const headers = Object.keys(rows[0]);
      const csv = [headers.join(';'), ...rows.map(r => headers.map(h => JSON.stringify(r[h] ?? '')).join(';'))].join('\n');
      const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a'); a.href = url; a.download = filename; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur export'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Reporting & Export</h1><p className="page-sub">Exportez les données au format CSV.</p></div></div>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="card" style={{ maxWidth: 520 }}>
        <div className="form-grid">
          <div className="field"><label>Type de données</label>
            <select value={type} onChange={e => setType(e.target.value as 'dossiers'|'gsm')}>
              <option value="dossiers">Dossiers KYC</option>
              <option value="gsm">Saisies GSM / Gross Add</option>
            </select>
          </div>
          <div className="form-row">
            <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
            <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          </div>
          <button className="btn btn-primary btn-lg" disabled={loading} onClick={exportCSV}>{loading ? 'Export en cours…' : '⬇ Télécharger CSV'}</button>
        </div>
      </div>
    </>
  );
}
