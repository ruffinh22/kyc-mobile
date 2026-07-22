import { useState, useEffect } from 'react';

export function SupPlanningManagersPage() {
  const [semaines, setSemaines] = useState<any[]>([]);
  const [currentSemaine, setCurrentSemaine] = useState('');
  const [planning, setPlanning] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetchSemaines();
  }, []);

  const fetchSemaines = async () => {
    try {
      const res = await fetch('/api/planning-managers/semaines');
      const data = await res.json();
      if (data.success) {
        setSemaines(data.semaines || []);
        if (data.semaines && data.semaines.length > 0) {
          setCurrentSemaine(data.semaines[0].semaine);
          fetchPlanning(data.semaines[0].semaine);
        }
      }
    } catch (err) {
      console.error('Error fetching semaines:', err);
    }
  };

  const fetchPlanning = async (semaine: string) => {
    setLoading(true);
    try {
      const res = await fetch(`/api/planning-managers?semaine=${semaine}`);
      const data = await res.json();
      if (data.success) {
        setPlanning(data);
      }
    } catch (err) {
      console.error('Error fetching planning:', err);
    } finally {
      setLoading(false);
    }
  };

  const handleSemaineChange = (semaine: string) => {
    setCurrentSemaine(semaine);
    fetchPlanning(semaine);
  };

  const savePlanning = async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/planning-managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semaine: currentSemaine,
          titre: planning?.titre || '',
          shifts: planning?.shifts || []
        })
      });
      const data = await res.json();
      if (data.success) {
        alert('Planning enregistré avec succès');
        fetchSemaines();
      }
    } catch (err) {
      console.error('Error saving planning:', err);
      alert('Erreur lors de l\'enregistrement');
    } finally {
      setLoading(false);
    }
  };

  const addShift = () => {
    setPlanning({
      ...planning,
      shifts: [
        ...(planning?.shifts || []),
        { vacation: '', horaire: '', cells: ['', '', '', '', '', '', ''] }
      ]
    });
  };

  const updateShift = (index: number, field: string, value: any) => {
    const newShifts = [...(planning?.shifts || [])];
    newShifts[index] = { ...newShifts[index], [field]: value };
    setPlanning({ ...planning, shifts: newShifts });
  };

  const updateCell = (shiftIndex: number, cellIndex: number, value: string) => {
    const newShifts = [...(planning?.shifts || [])];
    newShifts[shiftIndex].cells[cellIndex] = value;
    setPlanning({ ...planning, shifts: newShifts });
  };

  const removeShift = (index: number) => {
    const newShifts = planning?.shifts?.filter((_: any, i: number) => i !== index) || [];
    setPlanning({ ...planning, shifts: newShifts });
  };

  const days = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

  return (
    <div className="p-6 max-w-7xl mx-auto">
      <h1 className="text-2xl font-bold mb-6">Planning Managers</h1>

      <div className="bg-white rounded-lg shadow p-4 mb-6">
        <div className="flex items-center gap-4">
          <label className="font-medium">Semaine:</label>
          <select
            value={currentSemaine}
            onChange={(e) => handleSemaineChange(e.target.value)}
            className="border rounded px-3 py-2"
          >
            {semaines.map((s) => (
              <option key={s.semaine} value={s.semaine}>
                {s.semaine} - {s.titre}
              </option>
            ))}
          </select>
          <button
            onClick={() => {
              const newSemaine = prompt('Entrez la date du lundi (YYYY-MM-DD):');
              if (newSemaine) handleSemaineChange(newSemaine);
            }}
            className="bg-gray-600 text-white px-3 py-2 rounded hover:bg-gray-700"
          >
            Nouvelle Semaine
          </button>
        </div>
      </div>

      {loading ? (
        <div className="text-center py-8">Chargement...</div>
      ) : planning ? (
        <div className="space-y-6">
          <div className="bg-white rounded-lg shadow p-4">
            <div className="mb-4">
              <label className="block text-sm font-medium mb-1">Titre</label>
              <input
                type="text"
                value={planning.titre || ''}
                onChange={(e) => setPlanning({ ...planning, titre: e.target.value })}
                className="w-full border rounded px-3 py-2"
                placeholder="Ex: Semaine 32 - Équipe Managers"
              />
            </div>

            <div className="mb-4">
              <button
                onClick={addShift}
                className="bg-green-600 text-white px-4 py-2 rounded hover:bg-green-700"
              >
                + Ajouter Shift
              </button>
            </div>

            {planning.shifts?.map((shift: any, shiftIndex: number) => (
              <div key={shiftIndex} className="border rounded p-4 mb-4 bg-gray-50">
                <div className="flex justify-between items-center mb-4">
                  <h3 className="font-semibold">Shift {shiftIndex + 1}</h3>
                  <button
                    onClick={() => removeShift(shiftIndex)}
                    className="text-red-600 hover:text-red-800"
                  >
                    Supprimer
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-4 mb-4">
                  <div>
                    <label className="block text-sm font-medium mb-1">Vacation</label>
                    <input
                      type="text"
                      value={shift.vacation || ''}
                      onChange={(e) => updateShift(shiftIndex, 'vacation', e.target.value)}
                      className="w-full border rounded px-3 py-2"
                      placeholder="Ex: Matin"
                    />
                  </div>
                  <div>
                    <label className="block text-sm font-medium mb-1">Horaire</label>
                    <input
                      type="text"
                      value={shift.horaire || ''}
                      onChange={(e) => updateShift(shiftIndex, 'horaire', e.target.value)}
                      className="w-full border rounded px-3 py-2"
                      placeholder="Ex: 08:00-12:00"
                    />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium mb-2">Agents par jour</label>
                  <div className="grid grid-cols-7 gap-2">
                    {days.map((day, cellIndex) => (
                      <div key={cellIndex}>
                        <label className="block text-xs text-gray-600 mb-1">{day}</label>
                        <input
                          type="text"
                          value={shift.cells?.[cellIndex] || ''}
                          onChange={(e) => updateCell(shiftIndex, cellIndex, e.target.value)}
                          className="w-full border rounded px-2 py-1 text-sm"
                          placeholder="Agent"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ))}
          </div>

          <div className="flex gap-4">
            <button
              onClick={savePlanning}
              disabled={loading}
              className="bg-blue-600 text-white px-6 py-2 rounded hover:bg-blue-700 disabled:opacity-50"
            >
              Enregistrer le Planning
            </button>
          </div>
        </div>
      ) : (
        <div className="text-center py-8 text-gray-500">
          Aucun planning pour cette semaine. Créez un nouveau planning.
        </div>
      )}
    </div>
  );
}
