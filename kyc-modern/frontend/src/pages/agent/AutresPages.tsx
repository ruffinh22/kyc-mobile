import { useFetch, todayISO, nDaysAgo } from '../../hooks';
import { useState } from 'react';
import * as api from '../../services/api';
import { Alert, LoadingCenter, EmptyState } from '../../components/ui';

// ── Mon Planning ───────────────────────────────────────────────────────────────
export function AgentPlanning() {
  const [debut, setDebut] = useState(todayISO());
  const [fin, setFin]     = useState(() => { const d = new Date(); d.setDate(d.getDate()+13); return d.toISOString().slice(0,10); });
  const { data, loading, error, refetch } = useFetch(() => api.getPlanningMon(debut, fin), [debut, fin]);

  const STATUT_COLORS: Record<string,string> = { présent:'var(--success)', absent:'var(--danger)', congé:'var(--warn)', formation:'var(--info)' };

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mon planning</h1><p className="page-sub">Votre planning sur la période sélectionnée.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <div className="card">
          {!data?.entrees?.length ? <EmptyState icon="📅" title="Aucune entrée de planning" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Statut</th><th>Horaire</th><th>Début</th><th>Fin</th><th>Activité</th><th>Lieu</th><th>Quartier</th></tr></thead>
                <tbody>
                  {data.entrees.map(e => (
                    <tr key={e.id}>
                      <td>{new Date(e.date+'T00:00:00').toLocaleDateString('fr-FR')}</td>
                      <td><span style={{ fontWeight:600, color: STATUT_COLORS[e.statut?.toLowerCase() ?? ''] ?? 'var(--ink)' }}>{e.statut}</span></td>
                      <td>{e.horaire}</td><td>{e.heure_debut}</td><td>{e.heure_fin}</td>
                      <td>{e.activite}</td><td>{e.lieu}</td><td>{e.quartier}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ── Notes Qualité agent ────────────────────────────────────────────────────────
export function AgentNotesQualite() {
  const { data, loading, error, refetch } = useFetch(() => api.getNotesQualiteMes(), []);

  const NOTE_COLOR = (n: number|null) => n === null ? 'var(--ink-4)' : n >= 80 ? 'var(--success)' : n >= 60 ? 'var(--warn)' : 'var(--danger)';

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mes notes qualité</h1><p className="page-sub">Notes d'évaluation par semaine et moyenne mensuelle.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <div className="card">
          {!data?.notes?.length ? <EmptyState icon="⭐" title="Aucune note disponible" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Mois</th><th>Campagne</th><th>S1</th><th>S2</th><th>S3</th><th>S4</th><th>Moyenne</th><th>TL</th></tr></thead>
                <tbody>
                  {data.notes.map(n => (
                    <tr key={n.id}>
                      <td>{String(n.mois).padStart(2,'0')}/{n.annee}</td>
                      <td>{n.campagne}</td>
                      {[n.note_w1, n.note_w2, n.note_w3, n.note_w4].map((w, i) => (
                        <td key={i} style={{ fontWeight:600, color: NOTE_COLOR(w) }}>{w ?? '—'}</td>
                      ))}
                      <td style={{ fontWeight:700, color: NOTE_COLOR(n.moyenne), fontSize:15 }}>{n.moyenne ?? '—'}</td>
                      <td>{n.tl || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}
