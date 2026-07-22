import { useState, useEffect } from 'react';
import { Alert, EmptyState, LoadingCenter, Modal } from '../../components/ui';
import { apiFetch, getToken } from '../../services/api';

interface Capture {
  id: string;
  dossier_id?: string;
  numero_mtn?: string;
  numero?: string;
  recto_url?: string;
  verso_url?: string;
  live_url?: string;
  date?: string;
  type?: string;
}

// Helper pour ajouter le token aux URLs de captures
function captureUrlWithToken(baseUrl: string): string {
  const token = getToken();
  if (!token) return baseUrl;
  const separator = baseUrl.includes('?') ? '&' : '?';
  return `${baseUrl}${separator}token=${encodeURIComponent(token)}`;
}

export function AdminCapturesPage() {
  const [captures, setCaptures] = useState<Capture[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sortField, setSortField] = useState<'date' | 'type' | 'numero'>('date');
  const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('desc');
  const [modalImage, setModalImage] = useState<{ url: string; title: string } | null>(null);
  const [filters, setFilters] = useState({
    type: 'cni',
    date_from: '',
    date_to: '',
    numero: '',
    dossier_id: ''
  });

  const fetchCaptures = async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);
      if (filters.date_from) params.set('date_from', filters.date_from);
      if (filters.date_to) params.set('date_to', filters.date_to);
      if (filters.numero) params.set('numero', filters.numero);
      if (filters.dossier_id) params.set('dossier_id', filters.dossier_id);

      const data = await apiFetch<{ success: boolean; captures: Capture[]; error?: string }>(`/api/captures/search?${params.toString()}`);
      if (data.success) {
        setCaptures(data.captures || []);
      } else {
        setError(data.error || 'Erreur lors de la recherche');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
      console.error('Error fetching captures:', err);
    } finally {
      setLoading(false);
    }
  };

  const exportCaptures = async () => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.date_from) params.set('date_from', filters.date_from);
    if (filters.date_to) params.set('date_to', filters.date_to);

    window.location.href = `/api/captures/export?${params.toString()}`;
  };

  const deleteCapture = async (id: string) => {
    if (!confirm('Supprimer cette capture ?')) return;
    try {
      const data = await apiFetch<{ success: boolean; error?: string }>(`/api/captures/${id}`, { method: 'DELETE' });
      if (data.success) {
        setCaptures(captures.filter(c => c.id !== id));
      } else {
        setError(data.error || 'Erreur lors de la suppression');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
      console.error('Error deleting capture:', err);
    }
  };

  const handleSort = (field: 'date' | 'type' | 'numero') => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  const sortedCaptures = [...captures].sort((a, b) => {
    let aVal, bVal;
    switch (sortField) {
      case 'date':
        aVal = a.date || '';
        bVal = b.date || '';
        break;
      case 'type':
        aVal = a.type || '';
        bVal = b.type || '';
        break;
      case 'numero':
        aVal = a.numero_mtn || a.numero || '';
        bVal = b.numero_mtn || b.numero || '';
        break;
      default:
        return 0;
    }
    const comparison = aVal.localeCompare(bVal);
    return sortDirection === 'asc' ? comparison : -comparison;
  });

  useEffect(() => {
    fetchCaptures();
  }, []);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Recherche Captures</h1><p className="page-sub">Recherche et gestion des captures CNI, GSM et Live.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={fetchCaptures} disabled={loading}>
          {loading ? '...' : '↻'}
        </button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}

      <div className="card">
        <div className="filter-bar">
          <div className="field">
            <label>Type</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
            >
              <option value="cni">CNI</option>
              <option value="live">Live</option>
              <option value="gsm">GSM</option>
            </select>
          </div>
          <div className="field">
            <label>Date début</label>
            <input
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilters({ ...filters, date_from: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Date fin</label>
            <input
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilters({ ...filters, date_to: e.target.value })}
            />
          </div>
          <div className="field">
            <label>Numéro</label>
            <input
              type="text"
              value={filters.numero}
              onChange={(e) => setFilters({ ...filters, numero: e.target.value })}
              placeholder="Numéro MTN/GSM"
            />
          </div>
          <div className="field">
            <label>Dossier ID</label>
            <input
              type="text"
              value={filters.dossier_id}
              onChange={(e) => setFilters({ ...filters, dossier_id: e.target.value })}
              placeholder="ID Dossier"
            />
          </div>
          <button className="btn btn-primary" onClick={fetchCaptures} disabled={loading}>
            {loading ? 'Recherche...' : 'Rechercher'}
          </button>
          <button className="btn btn-success" onClick={exportCaptures}>
            ⬇ Export CSV
          </button>
        </div>
      </div>

      {loading ? <LoadingCenter /> : (
        <div className="card">
          <div className="card-title-bar">
            <p className="card-title">Résultats ({captures.length})</p>
            <div style={{ display: 'flex', gap: '0.5rem', fontSize: '0.875rem' }}>
              <span>Trier par:</span>
              <button 
                className={`btn btn-ghost btn-xs ${sortField === 'date' ? 'active' : ''}`}
                onClick={() => handleSort('date')}
              >
                Date {sortField === 'date' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`btn btn-ghost btn-xs ${sortField === 'type' ? 'active' : ''}`}
                onClick={() => handleSort('type')}
              >
                Type {sortField === 'type' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
              <button 
                className={`btn btn-ghost btn-xs ${sortField === 'numero' ? 'active' : ''}`}
                onClick={() => handleSort('numero')}
              >
                Numéro {sortField === 'numero' && (sortDirection === 'asc' ? '↑' : '↓')}
              </button>
            </div>
          </div>

          {!sortedCaptures.length ? (
            <EmptyState icon="🔍" title="Aucune capture trouvée" body="Modifiez les filtres de recherche" />
          ) : (
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>ID</th>
                    <th>Dossier ID</th>
                    <th>Numéro</th>
                    <th>Type</th>
                    <th>Date</th>
                    <th>Recto</th>
                    <th>Verso</th>
                    <th>Live</th>
                    <th>Actions</th>
                  </tr>
                </thead>
                <tbody>
                  {sortedCaptures.map((capture) => (
                    <tr key={capture.id}>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{capture.id}</td>
                      <td style={{ fontFamily: 'monospace', fontSize: '0.875rem' }}>{capture.dossier_id || '—'}</td>
                      <td style={{ fontFamily: 'monospace' }}>{capture.numero_mtn || capture.numero || '—'}</td>
                      <td>
                        <span className={`badge ${capture.type === 'cni' ? 'b-accepte' : capture.type === 'gsm' ? 'b-cours' : 'b-attente'}`}>
                          {capture.type || '—'}
                        </span>
                      </td>
                      <td>{capture.date || '—'}</td>
                      <td>
                        {capture.recto_url ? (
                          <button
                            onClick={() => setModalImage({ url: captureUrlWithToken(capture.recto_url!), title: `Recto - ${capture.id}` })}
                            className="btn btn-ghost btn-sm"
                          >
                            📷 Voir
                          </button>
                        ) : '—'}
                      </td>
                      <td>
                        {capture.verso_url ? (
                          <button
                            onClick={() => setModalImage({ url: captureUrlWithToken(capture.verso_url!), title: `Verso - ${capture.id}` })}
                            className="btn btn-ghost btn-sm"
                          >
                            📷 Voir
                          </button>
                        ) : '—'}
                      </td>
                      <td>
                        {capture.live_url ? (
                          <button
                            onClick={() => setModalImage({ url: captureUrlWithToken(capture.live_url!), title: `Live - ${capture.id}` })}
                            className="btn btn-ghost btn-sm"
                          >
                            📷 Voir
                          </button>
                        ) : '—'}
                      </td>
                      <td>
                        <button
                          onClick={() => deleteCapture(capture.id)}
                          className="btn btn-ghost btn-sm"
                          style={{ color: '#ef4444' }}
                        >
                          🗑 Supprimer
                        </button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {modalImage && (
        <Modal title={modalImage.title} onClose={() => setModalImage(null)}>
          <img 
            src={modalImage.url} 
            alt={modalImage.title}
            style={{ maxWidth: '100%', maxHeight: '80vh', display: 'block', margin: '0 auto' }}
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" width="100" height="100"><text y="50%" x="50%" dominant-baseline="middle" text-anchor="middle">Erreur chargement</text></svg>';
            }}
          />
        </Modal>
      )}
    </>
  );
}
