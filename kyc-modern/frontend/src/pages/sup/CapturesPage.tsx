import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { Alert, EmptyState, LoadingCenter, StatCard } from '../../components/ui';

interface Capture {
  id: string | number;
  dossier_id?: string | null;
  numero_mtn?: string | null;
  numero?: string | null;
  recto_url?: string | null;
  verso_url?: string | null;
  live_url?: string | null;
}

type CaptureType = 'cni' | 'live' | 'gsm';

const TYPES: { v: CaptureType; l: string }[] = [
  { v: 'cni', l: 'CNI' },
  { v: 'live', l: 'Live' },
  { v: 'gsm', l: 'GSM' },
];

export function SupCapturesPage() {
  const [filters, setFilters] = useState({ type: 'cni' as CaptureType, date: '', numero: '', dossier_id: '' });
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const buildParams = () => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.date) params.set('date', filters.date);
    if (filters.numero.trim()) params.set('numero', filters.numero.trim());
    if (filters.dossier_id.trim()) params.set('dossier_id', filters.dossier_id.trim());
    return params;
  };

  const fetchCaptures = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; captures?: Capture[]; error?: string }>(
        `/api/captures/search?${buildParams().toString()}`
      );
      if (data.success) {
        setCaptures(data.captures || []);
      } else {
        setError(data.error || 'Erreur lors de la recherche');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
    } finally {
      setLoading(false);
    }
  };

  const exportCaptures = () => {
    setExporting(true);
    const params = buildParams();
    if (filters.date) { params.set('date_from', filters.date); params.set('date_to', filters.date); }
    window.location.href = `/api/captures/export?${params.toString()}`;
    setTimeout(() => setExporting(false), 1200);
  };

  useEffect(() => { fetchCaptures(); }, []);

  const onEnter = (e: React.KeyboardEvent) => { if (e.key === 'Enter') fetchCaptures(); };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Recherche captures</h1>
          <p className="page-sub">Retrouvez les captures CNI, live et GSM par dossier ou numéro.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchCaptures}>↻</button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card">
        <div className="filter-bar">
          <div className="field">
            <label>Type</label>
            <select value={filters.type} onChange={e => setFilters(f => ({ ...f, type: e.target.value as CaptureType }))}>
              {TYPES.map(t => <option key={t.v} value={t.v}>{t.l}</option>)}
            </select>
          </div>
          <div className="field">
            <label>Date</label>
            <input type="date" value={filters.date} onChange={e => setFilters(f => ({ ...f, date: e.target.value }))} />
          </div>
          <div className="field">
            <label>Numéro</label>
            <input
              type="text" value={filters.numero} placeholder="Numéro MTN / GSM"
              onChange={e => setFilters(f => ({ ...f, numero: e.target.value }))} onKeyDown={onEnter}
            />
          </div>
          <div className="field">
            <label>Dossier ID</label>
            <input
              type="text" value={filters.dossier_id} placeholder="ID dossier"
              onChange={e => setFilters(f => ({ ...f, dossier_id: e.target.value }))} onKeyDown={onEnter}
            />
          </div>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button className="btn btn-primary btn-sm" disabled={loading} onClick={fetchCaptures}>
              {loading ? 'Recherche…' : 'Rechercher'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={exporting} onClick={exportCaptures}>
              {exporting ? 'Export…' : '⬇ Exporter CSV'}
            </button>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <StatCard label="Résultats" value={captures.length} />
      </div>

      <div className="card">
        {loading ? <LoadingCenter /> : !captures.length ? (
          <EmptyState icon="🖼️" title="Aucune capture trouvée" body="Ajustez les filtres puis relancez la recherche." />
        ) : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>ID</th>
                  <th>Dossier</th>
                  <th>Numéro</th>
                  <th>Recto</th>
                  <th>Verso</th>
                  <th>Live</th>
                </tr>
              </thead>
              <tbody>
                {captures.map(c => (
                  <tr key={c.id}>
                    <td>{c.id}</td>
                    <td>{c.dossier_id || '—'}</td>
                    <td>{c.numero_mtn || c.numero || '—'}</td>
                    <td>{c.recto_url ? <a href={c.recto_url} target="_blank" rel="noopener noreferrer">Voir</a> : '—'}</td>
                    <td>{c.verso_url ? <a href={c.verso_url} target="_blank" rel="noopener noreferrer">Voir</a> : '—'}</td>
                    <td>{c.live_url ? <a href={c.live_url} target="_blank" rel="noopener noreferrer">Voir</a> : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}