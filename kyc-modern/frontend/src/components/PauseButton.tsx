import { useState } from 'react';
import { apiFetch } from '../services/api';

export function PauseButton() {
  const [isPaused, setIsPaused] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleToggle = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const action = isPaused ? 'reprendre' : 'pause';
      await apiFetch<{ success: boolean }>('/api/presence/pause', { method: 'POST', json: { action } });
      setIsPaused(!isPaused);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erreur');
      console.error('Pause toggle error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="pause-button-container">
      <button
        onClick={handleToggle}
        disabled={isLoading}
        className={`btn btn-sm ${isPaused ? 'btn-success' : 'btn-warning'}`}
        title={isPaused ? 'Reprendre le travail' : 'Mettre en pause'}
      >
        {isLoading ? '⏳' : isPaused ? '▶️ Reprendre' : '⏸️ Pause'}
      </button>
      {error && <span className="text-error text-xs ml-2">{error}</span>}
    </div>
  );
}
