import { useEffect, useState } from 'react';
import { apiFetch } from '../../services/api';
import { useDebounce } from '../../hooks';
import { usePersistedState } from '../../hooks/usePersistedState';
import { Alert, EmptyState, LoadingCenter, StatCard } from '../../components/ui';

interface Capture {
  id: string | number;
  dossier_id?: string | null;
  numero_mtn?: string | null;
  numero?: string | null;
  recto_url?: string | null;
  verso_url?: string | null;
  live_url?: string | null;
  // Champs spécifiques à la table gsm (type = 'gsm')
  date_saisie?: string | null;
  agent_ctrl?: string | null;
  capture_a_url?: string | null;
  capture_p_url?: string | null;
  capture_aa_url?: string | null;
}

type CaptureType = 'cni' | 'live' | 'gsm';

const TYPES: { v: CaptureType; l: string }[] = [
  { v: 'cni', l: 'CNI' },
  { v: 'live', l: 'Live' },
  { v: 'gsm', l: 'GSM' },
];

const PAGE_SIZE = 50;

export function SupCapturesPage() {
  // Filtres persistés : un superviseur qui revient sur cette page après être
  // allé traiter un dossier retrouve exactement sa dernière recherche.
  const [filters, setFilters] = usePersistedState('captures.filters', {
    type: 'cni' as CaptureType, date: '', numero: '', dossier_id: '',
  });
  const [page, setPage] = useState(0);
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Débounce sur les champs texte uniquement : type/date déclenchent une
  // recherche immédiate (ce sont des choix discrets), numero/dossier_id
  // débouncent à 350ms pour ne pas envoyer une requête par frappe.
  const dNumero = useDebounce(filters.numero, 350);
  const dDossierId = useDebounce(filters.dossier_id, 350);

  const buildParams = (pageIndex: number) => {
    const params = new URLSearchParams();
    if (filters.date) params.set('date', filters.date);
    if (dNumero.trim()) params.set('numero', dNumero.trim());
    if (dDossierId.trim()) params.set('dossier_id', dDossierId.trim());
    // Le type n'est un paramètre que pour /api/captures/search (cni/live) ;
    // /api/captures/gsm est déjà scopé à la table gsm, pas besoin de le passer.
    if (filters.type !== 'gsm') params.set('type', filters.type);
    params.set('limit', String(PAGE_SIZE));
    params.set('offset', String(pageIndex * PAGE_SIZE));
    return params;
  };

  const captureEndpoint = filters.type === 'gsm' ? '/api/captures/gsm' : '/api/captures/search';

  const fetchCaptures = async (pageIndex = page) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; captures?: Capture[]; error?: string }>(
        `${captureEndpoint}?${buildParams(pageIndex).toString()}`
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
    const params = buildParams(0);
    params.delete('limit'); params.delete('offset'); // export = tout, pas la page courante
    if (filters.date) { params.set('date_from', filters.date); params.set('date_to', filters.date); }
    // L'export CSV a ses propres deux modes (?type=gsm ou cni) côté backend,
    // contrairement à la recherche : on remet 'type' explicitement ici.
    params.set('type', filters.type);
    window.location.href = `/api/captures/export?${params.toString()}`;
    setTimeout(() => setExporting(false), 1200);
  };

  // Recherche auto à chaque changement de filtre (débouncé pour le texte) —
  // repart toujours de la page 0 pour éviter d'atterrir sur une page vide.
  useEffect(() => {
    setPage(0);
    fetchCaptures(0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.type, filters.date, dNumero, dDossierId]);

  useEffect(() => {
    fetchCaptures(page);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [page]);

  const goToPage = (next: number) => { if (next >= 0) setPage(next); };
  const isLastPage = captures.length < PAGE_SIZE;

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Recherche captures</h1>
          <p className="page-sub">Retrouvez les captures CNI, live et GSM par dossier ou numéro.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={() => fetchCaptures(page)}>↻</button>
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
              onChange={e => setFilters(f => ({ ...f, numero: e.target.value }))}
            />
          </div>
          <div className="field">
            <label>Dossier ID</label>
            <input
              type="text" value={filters.dossier_id} placeholder="ID dossier"
              onChange={e => setFilters(f => ({ ...f, dossier_id: e.target.value }))}
            />
          </div>
          <div style={{ display: 'flex', gap: '.5rem' }}>
            <button className="btn btn-primary btn-sm" disabled={loading} onClick={() => fetchCaptures(page)}>
              {loading ? 'Recherche…' : 'Rechercher'}
            </button>
            <button className="btn btn-ghost btn-sm" disabled={exporting} onClick={exportCaptures}>
              {exporting ? 'Export…' : '⬇ Exporter CSV'}
            </button>
          </div>
        </div>
      </div>

      <div className="stats-grid" style={{ marginBottom: '1rem' }}>
        <StatCard label="Résultats (page courante)" value={captures.length} />
        <StatCard label="Page" value={page + 1} />
      </div>

      <div className="card">
        {loading ? <LoadingCenter /> : !captures.length ? (
          <EmptyState icon="🖼️" title="Aucune capture trouvée" body="Ajustez les filtres puis relancez la recherche." />
        ) : (
          <>
            <div className="table-wrap">
              <table>
                <thead>
                  {filters.type === 'gsm' ? (
                    <tr>
                      <th>ID</th>
                      <th>Dossier</th>
                      <th>Numéro</th>
                      <th>Date</th>
                      <th>Agent</th>
                      <th>Capture A</th>
                      <th>Capture P</th>
                      <th>Capture AA</th>
                    </tr>
                  ) : (
                    <tr>
                      <th>ID</th>
                      <th>Dossier</th>
                      <th>Numéro</th>
                      <th>Recto</th>
                      <th>Verso</th>
                      <th>Live</th>
                    </tr>
                  )}
                </thead>
                <tbody>
                  {filters.type === 'gsm' ? captures.map(c => (
                    <tr key={c.id}>
                      <td>{c.id}</td>
                      <td>{c.dossier_id || '—'}</td>
                      <td>{c.numero || '—'}</td>
                      <td>{c.date_saisie || '—'}</td>
                      <td>{c.agent_ctrl || '—'}</td>
                      <td>{c.capture_a_url ? <a href={c.capture_a_url} target="_blank" rel="noopener noreferrer">Voir</a> : '—'}</td>
                      <td>{c.capture_p_url ? <a href={c.capture_p_url} target="_blank" rel="noopener noreferrer">Voir</a> : '—'}</td>
                      <td>{c.capture_aa_url ? <a href={c.capture_aa_url} target="_blank" rel="noopener noreferrer">Voir</a> : '—'}</td>
                    </tr>
                  )) : captures.map(c => (
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

            <div style={{ display: 'flex', justifyContent: 'flex-end', gap: '.5rem', marginTop: '1rem' }}>
              <button className="btn btn-ghost btn-sm" disabled={page === 0 || loading} onClick={() => goToPage(page - 1)}>
                ← Précédent
              </button>
              <button className="btn btn-ghost btn-sm" disabled={isLastPage || loading} onClick={() => goToPage(page + 1)}>
                Suivant →
              </button>
            </div>
          </>
        )}
      </div>
    </>
  );
}
