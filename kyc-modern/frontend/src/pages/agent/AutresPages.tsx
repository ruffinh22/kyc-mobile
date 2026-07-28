import { useFetch, todayISO, nDaysAgo } from '../../hooks';
import { useMemo, useState } from 'react';
import * as api from '../../services/api';
import { Alert, LoadingCenter, EmptyState } from '../../components/ui';

const formatIsoDate = (iso: string) => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  return m ? `${m[3]}/${m[2]}/${m[1]}` : String(iso || '');
};

const formatIsoDay = (iso: string) => {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return String(iso || '');
  const d = new Date(`${m[1]}-${m[2]}-${m[3]}T00:00:00`);
  return d.toLocaleDateString('fr-FR', { weekday: 'long' });
};

// ── Mon Planning ───────────────────────────────────────────────────────────────
export function AgentPlanning() {
  const [debut, setDebut] = useState(todayISO());
  const [fin, setFin]     = useState(() => { const d = new Date(); d.setDate(d.getDate()+13); return d.toISOString().slice(0,10); });
  const { data, loading, error, refetch } = useFetch(() => api.getPlanningMon(debut, fin), [debut, fin]);

  const STATUT_COLORS: Record<string,string> = { présent:'var(--success)', absent:'var(--danger)', congé:'var(--warn)', formation:'var(--info)' };

  const dates = useMemo(() => {
    const entries = data?.entrees ?? [];
    return Array.from(new Set(entries.map(e => e.date))).sort();
  }, [data?.entrees]);

  const entriesByDate = useMemo(() => {
    const entries = data?.entrees ?? [];
    return dates.map(date => ({ date, entries: entries.filter(e => e.date === date) }));
  }, [data?.entrees, dates]);

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
          {!dates.length ? <EmptyState icon="📅" title="Aucune entrée de planning" /> : (
            <div style={{ overflowX:'auto', paddingBottom:'0.5rem' }}>
              <div style={{ minWidth: Math.max(840, dates.length * 220), display:'grid', gridTemplateColumns: `repeat(${dates.length}, minmax(220px, 1fr))`, gap:'1rem' }}>
                {entriesByDate.map(day => (
                  <div key={day.date} style={{ border: '1px solid var(--surface-4)', borderRadius: 12, background: 'var(--surface)', overflow: 'hidden' }}>
                    <div style={{ padding:'1rem', borderBottom:'1px solid var(--surface-4)', background:'var(--surface-2)' }}>
                      <div style={{ fontSize: 12, textTransform:'capitalize', color:'var(--ink-4)' }}>{formatIsoDay(day.date)}</div>
                      <div style={{ fontWeight: 700, marginTop: '.25rem' }}>{formatIsoDate(day.date)}</div>
                      <div style={{ marginTop: '.35rem', fontSize: 13, color:'var(--ink-4)' }}>{day.entries.length} entrée(s)</div>
                    </div>
                    <div style={{ display:'grid', gap:'.65rem', padding:'1rem' }}>
                      {day.entries.map(e => (
                        <div key={e.id} style={{ padding:'0.85rem', borderRadius: 10, background:'var(--surface)', border: '1px solid var(--surface-4)' }}>
                          <div style={{ display:'flex', justifyContent:'space-between', marginBottom: '.35rem', alignItems:'center' }}>
                            <strong>{e.horaire || e.type}</strong>
                            <span style={{ color: STATUT_COLORS[e.statut?.toLowerCase() ?? ''] ?? 'var(--ink-3)', fontSize: 12, padding: '0.15rem 0.45rem', borderRadius: 999, background: 'var(--surface-3)' }}>{e.statut}</span>
                          </div>
                          <div style={{ fontSize: 13, color:'var(--ink-4)' }}>{e.activite || 'Service'} · {e.lieu || '—'}</div>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
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
