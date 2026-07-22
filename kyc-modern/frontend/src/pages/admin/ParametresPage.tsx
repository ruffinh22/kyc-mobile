import { useState, useEffect } from 'react';

export function AdminParametresPage() {
  const [seuilAlerte, setSeuilAlerte] = useState(5);
  const [distributionMode, setDistributionMode] = useState('manuel');
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchConfig();
  }, []);

  const fetchConfig = async () => {
    try {
      const [seuilRes, modeRes] = await Promise.all([
        fetch('/api/config/seuil-alerte'),
        fetch('/api/config/distribution-mode')
      ]);
      const seuilData = await seuilRes.json();
      const modeData = await modeRes.json();
      if (seuilData.success) setSeuilAlerte(seuilData.seuil);
      if (modeData.success) setDistributionMode(modeData.mode);
    } catch (err) {
      console.error('Error fetching config:', err);
    }
  };

  const saveSeuil = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config/seuil-alerte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seuil: seuilAlerte })
      });
      const data = await res.json();
      if (data.success) {
        alert('Seuil d\'alerte mis à jour');
      }
    } catch (err) {
      console.error('Error saving seuil:', err);
      alert('Erreur lors de la mise à jour');
    } finally {
      setLoading(false);
    }
  };

  const saveMode = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/config/distribution-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: distributionMode })
      });
      const data = await res.json();
      if (data.success) {
        alert('Mode de distribution mis à jour');
      }
    } catch (err) {
      console.error('Error saving mode:', err);
      alert('Erreur lors de la mise à jour');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Paramètres Système</h1>

      <div className="space-y-6">
        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Seuil d'Alerte File d'Attente</h2>
          <p className="text-gray-600 mb-4">
            Nombre de minutes avant qu'une alerte soit déclenchée pour la file d'attente.
          </p>
          <div className="flex items-center gap-4">
            <input
              type="number"
              min="1"
              max="1440"
              value={seuilAlerte}
              onChange={(e) => setSeuilAlerte(parseInt(e.target.value))}
              className="w-32 border rounded px-3 py-2"
            />
            <span className="text-gray-600">minutes</span>
            <button
              onClick={saveSeuil}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Mode de Distribution des Dossiers</h2>
          <p className="text-gray-600 mb-4">
            Définit si les dossiers sont distribués automatiquement ou manuellement aux agents.
          </p>
          <div className="flex items-center gap-4">
            <select
              value={distributionMode}
              onChange={(e) => setDistributionMode(e.target.value)}
              className="w-48 border rounded px-3 py-2"
            >
              <option value="manuel">Manuel</option>
              <option value="auto">Automatique</option>
            </select>
            <button
              onClick={saveMode}
              disabled={loading}
              className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Enregistrer
            </button>
          </div>
        </div>

        <div className="bg-white rounded-lg shadow p-6">
          <h2 className="text-lg font-semibold mb-4">Informations Système</h2>
          <div className="space-y-2 text-gray-600">
            <p><strong>Version:</strong> KYC V4.0.0</p>
            <p><strong>Base de données:</strong> MySQL</p>
            <p><strong>Stockage:</strong> Local (uploads/)</p>
          </div>
        </div>
      </div>
    </div>
  );
}
