import { useEffect, useState } from 'react';
import { Alert, LoadingCenter, StatCard } from '../../components/ui';
import { apiFetch } from '../../services/api';

type DistributionMode = 'manuel' | 'auto';

interface SectionState {
  saving: boolean;
  success: string | null;
  error: string | null;
}

const emptySection = (): SectionState => ({ saving: false, success: null, error: null });

export function AdminParametresPage() {
  const [pageLoading, setPageLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  const [seuilAlerte, setSeuilAlerte] = useState(5);
  const [distributionMode, setDistributionMode] = useState<DistributionMode>('manuel');
  const [intervalMs, setIntervalMs] = useState(2000);
  const [abandonSec, setAbandonSec] = useState(120);

  const [seuilState, setSeuilState] = useState<SectionState>(emptySection());
  const [modeState, setModeState] = useState<SectionState>(emptySection());
  const [timingState, setTimingState] = useState<SectionState>(emptySection());

  useEffect(() => { fetchConfig(); }, []);

  // Les messages de succès s'effacent automatiquement, sans interrompre l'utilisateur
  useEffect(() => {
    const timers = [seuilState, modeState, timingState].map((s, i) => {
      if (!s.success) return null;
      const setters = [setSeuilState, setModeState, setTimingState];
      return setTimeout(() => setters[i](prev => ({ ...prev, success: null })), 4000);
    });
    return () => timers.forEach(t => t && clearTimeout(t));
  }, [seuilState.success, modeState.success, timingState.success]);

  const fetchConfig = async () => {
    setPageLoading(true);
    setPageError(null);
    try {
      const [seuilData, modeData, timingData] = await Promise.all([
        apiFetch<{ success: boolean; seuil: number }>('/api/config/seuil-alerte'),
        apiFetch<{ success: boolean; mode: DistributionMode }>('/api/config/distribution-mode'),
        apiFetch<{ success: boolean; interval_ms?: number; abandon_sec?: number }>('/api/config/distribution-timing'),
      ]);
      if (seuilData.success) setSeuilAlerte(seuilData.seuil);
      if (modeData.success) setDistributionMode(modeData.mode);
      if (timingData.success) {
        setIntervalMs(timingData.interval_ms ?? 2000);
        setAbandonSec(timingData.abandon_sec ?? 120);
      }
    } catch (err) {
      setPageError(err instanceof Error ? err.message : 'Erreur de connexion au serveur');
    } finally {
      setPageLoading(false);
    }
  };

  const saveSeuil = async () => {
    setSeuilState({ saving: true, success: null, error: null });
    try {
      const data = await apiFetch<{ success: boolean; error?: string }>('/api/config/seuil-alerte', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ seuil: seuilAlerte }),
      });
      if (data.success) setSeuilState({ saving: false, success: 'Seuil d’alerte mis à jour', error: null });
      else setSeuilState({ saving: false, success: null, error: data.error || 'Échec de la mise à jour' });
    } catch (err) {
      setSeuilState({ saving: false, success: null, error: err instanceof Error ? err.message : 'Erreur de connexion' });
    }
  };

  const saveMode = async () => {
    setModeState({ saving: true, success: null, error: null });
    try {
      const data = await apiFetch<{ success: boolean; error?: string }>('/api/config/distribution-mode', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode: distributionMode }),
      });
      if (data.success) setModeState({ saving: false, success: 'Mode de distribution mis à jour', error: null });
      else setModeState({ saving: false, success: null, error: data.error || 'Échec de la mise à jour' });
    } catch (err) {
      setModeState({ saving: false, success: null, error: err instanceof Error ? err.message : 'Erreur de connexion' });
    }
  };

  const saveTiming = async () => {
    setTimingState({ saving: true, success: null, error: null });
    try {
      const data = await apiFetch<{ success: boolean; error?: string }>('/api/config/distribution-timing', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ interval_ms: intervalMs, abandon_sec: abandonSec }),
      });
      if (data.success) setTimingState({ saving: false, success: 'Timing de redistribution mis à jour', error: null });
      else setTimingState({ saving: false, success: null, error: data.error || 'Échec de la mise à jour' });
    } catch (err) {
      setTimingState({ saving: false, success: null, error: err instanceof Error ? err.message : 'Erreur de connexion' });
    }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Paramètres système</h1>
          <p className="page-sub">Seuils d’alerte, distribution des dossiers et informations de la plateforme.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={fetchConfig} disabled={pageLoading}>↻</button>
      </div>

      {pageError && <Alert kind="error">{pageError}</Alert>}

      {pageLoading ? <LoadingCenter /> : (
        <>
          <div className="card">
            <div className="stats-grid">
              <StatCard label="Seuil d’alerte" value={`${seuilAlerte} min`} />
              <StatCard label="Distribution" value={distributionMode === 'auto' ? 'Automatique' : 'Manuel'} variant={distributionMode === 'auto' ? 'accepte' : 'attente'} />
              <StatCard label="Intervalle de vérification" value={`${(intervalMs / 1000).toLocaleString('fr-FR')} s`} />
              <StatCard label="Délai d’abandon" value={`${abandonSec} s`} />
            </div>
          </div>

          <div className="card">
            <p className="card-title">⏱ Seuil d’alerte — file d’attente</p>
            <p style={{ fontSize: 13.5, color: 'var(--ink-4)', marginTop: '.25rem', marginBottom: '1rem' }}>
              Durée d’attente, en minutes, au-delà de laquelle une alerte est déclenchée sur la file d’attente.
            </p>
            {seuilState.error && <Alert kind="error">{seuilState.error}</Alert>}
            {seuilState.success && <Alert kind="success">{seuilState.success}</Alert>}
            <div className="form-row" style={{ alignItems: 'flex-end' }}>
              <div className="field" style={{ maxWidth: 180 }}>
                <label>Seuil</label>
                <input
                  type="number"
                  min={1}
                  max={1440}
                  value={seuilAlerte}
                  onChange={e => setSeuilAlerte(parseInt(e.target.value) || 0)}
                />
                <span className="field-hint">minutes</span>
              </div>
              <button className="btn btn-primary" disabled={seuilState.saving} onClick={saveSeuil}>
                {seuilState.saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>
          </div>

          <div className="card">
            <p className="card-title">🔀 Distribution des dossiers</p>

            {modeState.error && <Alert kind="error">{modeState.error}</Alert>}
            {modeState.success && <Alert kind="success">{modeState.success}</Alert>}
            <p style={{ fontSize: 13.5, color: 'var(--ink-4)', marginTop: '.25rem', marginBottom: '.75rem' }}>
              Détermine si les dossiers sont attribués automatiquement aux agents disponibles ou distribués manuellement par un superviseur.
            </p>
            <div className="form-row" style={{ alignItems: 'flex-end', marginBottom: '1.5rem' }}>
              <div className="field" style={{ maxWidth: 240 }}>
                <label>Mode</label>
                <select value={distributionMode} onChange={e => setDistributionMode(e.target.value as DistributionMode)}>
                  <option value="manuel">Manuel</option>
                  <option value="auto">Automatique</option>
                </select>
              </div>
              <button className="btn btn-primary" disabled={modeState.saving} onClick={saveMode}>
                {modeState.saving ? 'Enregistrement…' : 'Enregistrer'}
              </button>
            </div>

            <div style={{ borderTop: '1px solid var(--surface-4)', paddingTop: '1.25rem' }}>
              <p style={{ fontWeight: 600, marginBottom: '.25rem' }}>Redistribution automatique</p>
              {timingState.error && <Alert kind="error">{timingState.error}</Alert>}
              {timingState.success && <Alert kind="success">{timingState.success}</Alert>}
              <p style={{ fontSize: 13.5, color: 'var(--ink-4)', marginTop: '.25rem', marginBottom: '.75rem' }}>
                Fréquence du cycle de vérification et délai avant qu’un dossier non traité soit considéré comme abandonné et réattribué.
              </p>
              <div className="form-grid">
                <div className="form-row">
                  <div className="field">
                    <label>Intervalle de vérification</label>
                    <input
                      type="number"
                      min={1000}
                      max={60000}
                      step={500}
                      value={intervalMs}
                      onChange={e => setIntervalMs(parseInt(e.target.value) || 0)}
                    />
                    <span className="field-hint">millisecondes</span>
                  </div>
                  <div className="field">
                    <label>Délai d’abandon</label>
                    <input
                      type="number"
                      min={30}
                      max={1800}
                      value={abandonSec}
                      onChange={e => setAbandonSec(parseInt(e.target.value) || 0)}
                    />
                    <span className="field-hint">secondes</span>
                  </div>
                </div>
                <div>
                  <button className="btn btn-primary" disabled={timingState.saving} onClick={saveTiming}>
                    {timingState.saving ? 'Enregistrement…' : 'Enregistrer'}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="card">
            <p className="card-title">ℹ️ Informations système</p>
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))', gap: '1rem', marginTop: '.75rem' }}>
              {[
                { label: 'Version', value: 'KYC V4.0.0' },
                { label: 'Base de données', value: 'MySQL' },
                { label: 'Stockage', value: 'Local (uploads/)' },
              ].map(row => (
                <div key={row.label} style={{ padding: '.85rem 1rem', borderRadius: 10, background: 'var(--surface-2)', border: '1px solid var(--surface-4)' }}>
                  <div style={{ fontSize: 12, color: 'var(--ink-4)', marginBottom: '.2rem' }}>{row.label}</div>
                  <div style={{ fontWeight: 600 }}>{row.value}</div>
                </div>
              ))}
            </div>
          </div>
        </>
      )}
    </>
  );
}