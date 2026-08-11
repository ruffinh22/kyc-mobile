import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import { Alert, EmptyState, LoadingCenter, Modal, StatCard } from '../../components/ui';
import { apiFetch } from '../../services/api';

interface Semaine { semaine: string; titre: string }
interface Shift { vacation: string; horaire: string; cells: string[] }
interface Planning { titre: string; shifts: Shift[] }

const DAY_LABELS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

function nextMonday(): string {
  const d = new Date();
  const day = d.getDay();
  d.setDate(d.getDate() + ((8 - day) % 7 || 7));
  return d.toISOString().slice(0, 10);
}

function formatWeekLabel(iso: string): string {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return iso || '—';
  const monday = new Date(`${iso}T00:00:00`);
  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  const opts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short' };
  const yearOpts: Intl.DateTimeFormatOptions = { day: 'numeric', month: 'short', year: 'numeric' };
  return `${monday.toLocaleDateString('fr-FR', opts)} – ${sunday.toLocaleDateString('fr-FR', yearOpts)}`;
}

function weekDayDates(iso: string): { label: string; date: string }[] {
  const m = String(iso || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return DAY_LABELS.map(label => ({ label, date: '' }));
  const monday = new Date(`${iso}T00:00:00`);
  return DAY_LABELS.map((label, i) => {
    const d = new Date(monday);
    d.setDate(monday.getDate() + i);
    return { label, date: d.toLocaleDateString('fr-FR', { day: '2-digit', month: '2-digit' }) };
  });
}

const cellInputStyle: CSSProperties = {
  width: '100%', border: '1px solid transparent', borderRadius: 6,
  padding: '.4rem .5rem', background: 'transparent', fontSize: 13.5,
  textAlign: 'center', color: 'var(--ink-1)',
};

export function SupPlanningManagersPage() {
  const [semaines, setSemaines] = useState<Semaine[]>([]);
  const [currentSemaine, setCurrentSemaine] = useState('');
  const [planning, setPlanning] = useState<Planning | null>(null);
  const [pageLoading, setPageLoading] = useState(true);
  const [planningLoading, setPlanningLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [showNewWeek, setShowNewWeek] = useState(false);
  const [newWeekDate, setNewWeekDate] = useState(nextMonday());

  useEffect(() => { fetchSemaines(); }, []);

  useEffect(() => {
    if (!success) return;
    const t = setTimeout(() => setSuccess(null), 4000);
    return () => clearTimeout(t);
  }, [success]);

  const fetchSemaines = async () => {
    setPageLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; semaines: Semaine[]; error?: string }>('/api/planning-managers/semaines');
      if (data.success) {
        const list = data.semaines || [];
        setSemaines(list);
        if (list.length > 0) {
          setCurrentSemaine(list[0].semaine);
          await fetchPlanning(list[0].semaine);
        } else {
          setPlanning(null);
        }
      } else {
        setError(data.error || 'Erreur lors du chargement des semaines');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
    } finally {
      setPageLoading(false);
    }
  };

  const fetchPlanning = async (semaine: string) => {
    setPlanningLoading(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; titre?: string; shifts?: Shift[]; error?: string }>(`/api/planning-managers?semaine=${semaine}`);
      if (data.success) {
        setPlanning({ titre: data.titre || '', shifts: data.shifts || [] });
      } else {
        setError(data.error || 'Erreur lors du chargement du planning');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
    } finally {
      setPlanningLoading(false);
    }
  };

  const handleSemaineChange = (semaine: string) => {
    setCurrentSemaine(semaine);
    fetchPlanning(semaine);
  };

  const createWeek = () => {
    setShowNewWeek(false);
    handleSemaineChange(newWeekDate);
  };

  const savePlanning = async () => {
    setSaving(true);
    setError(null);
    try {
      const data = await apiFetch<{ success: boolean; error?: string }>('/api/planning-managers', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          semaine: currentSemaine,
          titre: planning?.titre || '',
          shifts: planning?.shifts || [],
        }),
      });
      if (data.success) {
        setSuccess('Planning enregistré avec succès');
        fetchSemaines();
      } else {
        setError(data.error || 'Erreur lors de l’enregistrement');
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
    } finally {
      setSaving(false);
    }
  };

  const addShift = () => {
    setPlanning(p => ({
      titre: p?.titre || '',
      shifts: [...(p?.shifts || []), { vacation: '', horaire: '', cells: ['', '', '', '', '', '', ''] }],
    }));
  };

  const updateShift = (index: number, field: 'vacation' | 'horaire', value: string) => {
    setPlanning(p => {
      if (!p) return p;
      const shifts = [...p.shifts];
      shifts[index] = { ...shifts[index], [field]: value };
      return { ...p, shifts };
    });
  };

  const updateCell = (shiftIndex: number, cellIndex: number, value: string) => {
    setPlanning(p => {
      if (!p) return p;
      const shifts = [...p.shifts];
      const cells = [...shifts[shiftIndex].cells];
      cells[cellIndex] = value;
      shifts[shiftIndex] = { ...shifts[shiftIndex], cells };
      return { ...p, shifts };
    });
  };

  const removeShift = (index: number) => {
    setPlanning(p => p ? { ...p, shifts: p.shifts.filter((_, i) => i !== index) } : p);
  };

  const days = useMemo(() => weekDayDates(currentSemaine), [currentSemaine]);

  const agentsPlanifies = useMemo(() => {
    const set = new Set<string>();
    planning?.shifts?.forEach(s => s.cells.forEach(c => { if (c.trim()) set.add(c.trim().toLowerCase()); }));
    return set.size;
  }, [planning]);

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Planning managers</h1>
          <p className="page-sub">Organisation hebdomadaire des équipes d’encadrement.</p>
        </div>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'flex-end' }}>
          <div className="field">
            <label>Semaine</label>
            <select value={currentSemaine} onChange={e => handleSemaineChange(e.target.value)}>
              {semaines.map(s => (
                <option key={s.semaine} value={s.semaine}>
                  {formatWeekLabel(s.semaine)}{s.titre ? ` — ${s.titre}` : ''}
                </option>
              ))}
            </select>
          </div>
          <button className="btn btn-ghost btn-sm" onClick={() => { setNewWeekDate(nextMonday()); setShowNewWeek(true); }}>
            + Nouvelle semaine
          </button>
        </div>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}

      {pageLoading ? <LoadingCenter /> : (
        <>
          {planning && (
            <div className="card">
              <div className="stats-grid">
                <StatCard label="Semaine" value={formatWeekLabel(currentSemaine)} />
                <StatCard label="Shifts" value={planning.shifts.length} />
                <StatCard label="Agents planifiés" value={agentsPlanifies} variant="accepte" />
              </div>
            </div>
          )}

          {planningLoading ? <LoadingCenter /> : planning ? (
            <div className="card">
              <div className="card-title-bar">
                <p className="card-title">Détail de la semaine</p>
                <button className="btn btn-ghost btn-sm" onClick={addShift}>+ Ajouter un shift</button>
              </div>

              <div className="field" style={{ maxWidth: 420, marginBottom: '1.25rem' }}>
                <label>Titre du planning</label>
                <input
                  type="text"
                  value={planning.titre || ''}
                  onChange={e => setPlanning(p => p ? { ...p, titre: e.target.value } : p)}
                  placeholder="Ex : Semaine 32 — Équipe Managers"
                />
              </div>

              {!planning.shifts.length ? (
                <EmptyState icon="🗓️" title="Aucun shift" body="Ajoutez un premier shift pour commencer ce planning." />
              ) : (
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th style={{ minWidth: 140 }}>Vacation</th>
                        <th style={{ minWidth: 130 }}>Horaire</th>
                        {days.map(d => (
                          <th key={d.label} style={{ textAlign: 'center', minWidth: 110 }}>
                            {d.label}<span style={{ display: 'block', fontWeight: 400, fontSize: 11, color: 'var(--ink-4)' }}>{d.date}</span>
                          </th>
                        ))}
                        <th style={{ width: 40 }}></th>
                      </tr>
                    </thead>
                    <tbody>
                      {planning.shifts.map((shift, shiftIndex) => (
                        <tr key={shiftIndex}>
                          <td>
                            <input
                              type="text"
                              value={shift.vacation || ''}
                              onChange={e => updateShift(shiftIndex, 'vacation', e.target.value)}
                              placeholder="Matin"
                              style={{ width: '100%' }}
                            />
                          </td>
                          <td>
                            <input
                              type="text"
                              value={shift.horaire || ''}
                              onChange={e => updateShift(shiftIndex, 'horaire', e.target.value)}
                              placeholder="08:00–12:00"
                              style={{ width: '100%' }}
                            />
                          </td>
                          {days.map((d, cellIndex) => (
                            <td key={d.label}>
                              <input
                                type="text"
                                value={shift.cells?.[cellIndex] || ''}
                                onChange={e => updateCell(shiftIndex, cellIndex, e.target.value)}
                                placeholder="—"
                                style={cellInputStyle}
                                onFocus={e => { e.currentTarget.style.borderColor = 'var(--surface-4)'; e.currentTarget.style.background = 'var(--surface-2)'; }}
                                onBlur={e => { e.currentTarget.style.borderColor = 'transparent'; e.currentTarget.style.background = 'transparent'; }}
                              />
                            </td>
                          ))}
                          <td>
                            <button
                              className="btn btn-ghost btn-sm"
                              title="Retirer ce shift"
                              style={{ color: 'var(--danger)' }}
                              onClick={() => removeShift(shiftIndex)}
                            >
                              ✕
                            </button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}

              <div style={{ display: 'flex', justifyContent: 'flex-end', marginTop: '1.5rem' }}>
                <button className="btn btn-primary" disabled={saving} onClick={savePlanning}>
                  {saving ? 'Enregistrement…' : 'Enregistrer le planning'}
                </button>
              </div>
            </div>
          ) : (
            <div className="card">
              <EmptyState icon="🗓️" title="Aucun planning pour cette semaine" body="Créez une nouvelle semaine pour commencer." />
            </div>
          )}
        </>
      )}

      {showNewWeek && (
        <Modal title="Nouvelle semaine" onClose={() => setShowNewWeek(false)} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setShowNewWeek(false)}>Annuler</button>
            <button className="btn btn-primary btn-sm" onClick={createWeek}>Créer</button>
          </>
        }>
          <div className="field">
            <label>Date du lundi</label>
            <input type="date" value={newWeekDate} onChange={e => setNewWeekDate(e.target.value)} />
            <span className="field-hint">La semaine affichée ira du lundi au dimanche suivant.</span>
          </div>
        </Modal>
      )}
    </>
  );
}