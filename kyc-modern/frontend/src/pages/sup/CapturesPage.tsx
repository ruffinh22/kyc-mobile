import { useState, useEffect } from 'react';

export function SupCapturesPage() {
  const [captures, setCaptures] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [filters, setFilters] = useState({
    type: 'cni',
    date: '',
    numero: '',
    dossier_id: ''
  });

  const fetchCaptures = async () => {
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (filters.type) params.set('type', filters.type);
      if (filters.date) params.set('date', filters.date);
      if (filters.numero) params.set('numero', filters.numero);
      if (filters.dossier_id) params.set('dossier_id', filters.dossier_id);

      const res = await fetch(`/api/captures/search?${params.toString()}`);
     const data = await res.json();
      if (data.success) {
        setCaptures(data.captures || []);
      }
    } catch (err) {
      console.error('Error fetching captures:', err);
    } finally {
      setLoading(false);
    }
  };

  const exportCaptures = async () => {
    const params = new URLSearchParams();
    if (filters.type) params.set('type', filters.type);
    if (filters.date) params.set('date_from', filters.date);
    if (filters.date) params.set('date_to', filters.date);

    window.location.href = `/api/captures/export?${params.toString()}`;
  };

  useEffect(() => {
    fetchCaptures();
  }, []);

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Recherche Captures</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          <div>
            <label className="block text-sm font-medium mb-1">Type</label>
            <select
              value={filters.type}
              onChange={(e) => setFilters({ ...filters, type: e.target.value })}
              className="w-full border rounded px-3 py-2"
            >
              <option value="cni">CNI</option>
              <option value="live">Live</option>
              <option value="gsm">GSM</option>
            </select>
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Date</label>
            <input
              type="date"
              value={filters.date}
              onChange={(e) => setFilters({ ...filters, date: e.target.value })}
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Numéro</label>
            <input
              type="text"
              value={filters.numero}
              onChange={(e) => setFilters({ ...filters, numero: e.target.value })}
              placeholder="Numéro MTN/GSM"
              className="w-full border rounded px-3 py-2"
            />
          </div>
          <div>
            <label className="block text-sm font-medium mb-1">Dossier ID</label>
            <input
              type="text"
              value={filters.dossier_id}
              onChange={(e) => setFilters({ ...filters, dossier_id: e.target.value })}
              placeholder="ID Dossier"
              className="w-full border rounded px-3 py-2"
            />
          </div>
        </div>
        <div className="flex gap-2 mt-4">
          <button
            onClick={fetchCaptures}
            disabled={loading}
            className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
          >
            {loading ? 'Recherche...' : 'Rechercher'}
          </button>
          <button
            onClick={exportCaptures}
            className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
          >
            Exporter CSV
          </button>
        </div>
      </div>

      <div className="bg-white rounded-lg shadow overflow-hidden">
        <table className="min-w-full">
          <thead className="bg-gray-50">
            <tr>
              <th className="px-4 py-2 text-left">ID</th>
              <th className="px-4 py-2 text-left">Dossier ID</th>
              <th className="px-4 py-2 text-left">Numéro</th>
              <th className="px-4 py-2 text-left">Recto</th>
              <th className="px-4 py-2 text-left">Verso</th>
              <th className="px-4 py-2 text-left">Live</th>
            </tr>
          </thead>
          <tbody>
            {captures.map((capture) => (
              <tr key={capture.id} className="border-t">
                <td className="px-4 py-2">{capture.id}</td>
                <td className="px-4 py-2">{capture.dossier_id || '-'}</td>
                <td className="px-4 py-2">{capture.numero_mtn || capture.numero || '-'}</td>
                <td className="px-4 py-2">
                  {capture.recto_url ? (
                    <a href={capture.recto_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Voir
                    </a>
                  ) : '-'}
                </td>
                <td className="px-4 py-2">
                  {capture.verso_url ? (
                    <a href={capture.verso_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Voir
                    </a>
                  ) : '-'}
                </td>
                <td className="px-4 py-2">
                  {capture.live_url ? (
                    <a href={capture.live_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 hover:underline">
                      Voir
                    </a>
                  ) : '-'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {captures.length === 0 && (
          <div className="p-4 text-center text-gray-500">Aucune capture trouvée</div>
        )}
      </div>
    </div>
  );
}
