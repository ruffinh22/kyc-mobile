import { useEffect, useMemo, useState } from 'react';
import * as api from '../../services/api';
import { Dossier } from '../../types';
import { Alert, LoadingCenter, EmptyState, StatCard } from '../../components/ui';
import { ReattributionModal } from '../agent/GsmPages';
import { DossierDetailModal } from '../../components/DossierComponents';
import { useDebounce } from '../../hooks';

function formatDate(ts: number | null | undefined): string {
  if (!ts) return '—';
  return new Date(ts * 1000).toLocaleString('fr-FR', { dateStyle: 'medium', timeStyle: 'short' });
}

// Téléchargement de la fiche dossier PDF (bandeau MTN, identité, pièce &
// vérification faciale, GSM, photos, historique des réattributions) —
// même convention de navigation directe que l'export CSV des captures
// (voir CapturesPage.tsx) : l'endpoint gère l'auth de session lui-même.
function telechargerFichePdf(dossierId: string) {
  window.location.href = `/api/dossiers/${encodeURIComponent(dossierId)}/fiche-pdf`;
}

type Entry = { dossier: Dossier; reattributions: Array<{ id: number; motif: string | null; agent_matricule: string; created_at: number; ancien_snapshot: Record<string, unknown> }> };

export function SupHistoriqueNumero() {
  const [numero, setNumero] = useState('');
  const numeroDebounced = useDebounce(numero, 250);
  const [data, setData] = useState<{ numero: string; nb_dossiers: number; nb_reattributions: number; historique: Entry[] } | null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [reattribCible, setReattribCible] = useState<Dossier | null>(null);
  const [voirCible, setVoirCible] = useState<Dossier | null>(null);

  const historiqueAffiche = useMemo(() => (data?.historique ?? []).slice(0, 25), [data]);

  async function rechercher(value?: string) {
    const term = (value ?? numero).trim();
    if (!term) {
      setErr('Saisissez un numéro, un nom ou un prénom');
      setData(null);
      return;
    }

    const cleanDigits = term.replace(/\D/g, '');
    setLoading(true); setErr(null); setData(null);

    try {
      if (cleanDigits.length >= 6 && term === cleanDigits) {
        const res = await api.getHistoriqueNumero(cleanDigits);
        setData(res);
        return;
      }

      const res = await api.getDossiersHistorique({ search: term, limit: 100 });
      const historique = await Promise.all(res.dossiers.map(async (d) => ({
        dossier: d,
        reattributions: (await api.getReattributions(d.id)).reattributions,
      })));

      setData({
        numero: term,
        nb_dossiers: res.total,
        nb_reattributions: historique.reduce((sum, entry) => sum + entry.reattributions.length, 0),
        historique,
      });
    } catch (e: any) {
      setErr(e?.message || 'Aucune donnée trouvée pour cette recherche');
    } finally {
      setLoading(false);
    }
  }

  const handleSearchClick = () => {
    void rechercher(numero);
  };

  useEffect(() => {
    const term = numeroDebounced.trim();
    if (!term) {
      setData(null);
      setErr(null);
      return;
    }
    const cleanDigits = term.replace(/\D/g, '');
    if (cleanDigits.length >= 6 && term === cleanDigits) {
      void rechercher(term);
      return;
    }
    if (term.length < 2) {
      setData(null);
      setErr('Saisissez au moins 2 caractères pour lancer la recherche');
      return;
    }
    void rechercher(term);
  }, [numeroDebounced]);

  return (
    <div>
      <div className="page-header">
        <div>
          <h1 className="page-title">Historique d'un numéro</h1>
          <p className="page-sub">Traçabilité complète : tous les enregistrements et réattributions déjà effectués sur un numéro GSM.</p>
        </div>
      </div>

      <div className="card history-search-bar">
        <div className="history-search-input-wrap">
          <span className="history-search-icon">⌕</span>
          <input
            value={numero}
            onChange={e => setNumero(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void rechercher(numero);
              }
            }}
            placeholder="Numéro, nom ou prénom (ex : 6XXXXXXXX / DUPONT / Jean)"
            aria-label="Recherche dossier"
          />
        </div>
        <button className="btn btn-primary" onClick={handleSearchClick} disabled={loading}>
          {loading ? 'Recherche…' : 'Rechercher'}
        </button>
      </div>

      {err && <Alert kind="error">{err}</Alert>}

      {data && (
        <>
          <div className="stats-row" style={{ margin: '16px 0' }}>
            <StatCard label="Numéro" value={data.numero} />
            <StatCard label="Dossiers distincts" value={data.nb_dossiers} />
            <StatCard label="Réattributions" value={data.nb_reattributions} variant={data.nb_reattributions > 0 ? 'attente' : 'default'} />
          </div>

          {historiqueAffiche.length === 0 ? (
            <EmptyState icon="🔍" title="Aucun enregistrement trouvé pour ce numéro" />
          ) : (
            historiqueAffiche.map(({ dossier: d, reattributions }) => (
              <div key={d.id} className="card history-result-card">
                <div className="history-result-top">
                  <div className="history-result-main">
                    <div className="history-result-kicker">Dossier</div>
                    <div className="history-result-title-row">
                      <h3>Dossier #{d.id}</h3>
                      <span className={`badge b-${d.statut === 'en_attente' ? 'attente' : d.statut === 'en_cours' ? 'cours' : d.statut === 'accepte' ? 'accepte' : 'rejete'}`}>
                        {d.statut === 'en_attente' ? 'En attente' : d.statut === 'en_cours' ? 'En cours' : d.statut === 'accepte' ? 'Accepté' : 'Rejeté'}
                      </span>
                    </div>
                    <div className="history-result-meta">
                      <span><strong>Titulaire :</strong> {d.nom_titulaire || '—'} {d.prenom_titulaire || ''}</span>
                    </div>
                    <div className="history-result-meta subtle">
                      <span>Créé le {formatDate(d.created_at)}</span>
                      <span>·</span>
                      <span>Agent d'origine : {d.agent_saisie || d.username_agent || '—'}</span>
                      {(d.nb_reattributions ?? 0) > 0 && <><span>·</span><span>Réattribué {d.nb_reattributions}×</span></>}
                    </div>
                  </div>
                  <div className="history-result-actions">
                    <button className="btn btn-ghost btn-sm" onClick={() => setVoirCible(d)}>
                      👁 Voir
                    </button>
                    <button className="btn btn-ghost btn-sm" onClick={() => setReattribCible(d)}>
                      🔄 Réattribuer
                    </button>
                  </div>
                </div>

                {reattributions.length > 0 && (
                  <div className="history-reattrib-card">
                    <div className="history-reattrib-header">
                      <span>Historique des réattributions</span>
                      <span className="history-reattrib-count">{reattributions.length}</span>
                    </div>
                    {data.nb_dossiers > 25 && (
                      <div className="history-reattrib-note">
                        Affichage des 25 premiers dossiers sur {data.nb_dossiers} résultats.
                      </div>
                    )}
                    <div className="history-table-wrap">
                      <table className="table history-reattrib-table">
                        <thead><tr><th>Date</th><th>Ancien titulaire</th><th>Motif</th><th>Par</th></tr></thead>
                        <tbody>
                          {reattributions.map(r => (
                            <tr key={r.id}>
                              <td>{formatDate(r.created_at)}</td>
                              <td>{String(r.ancien_snapshot.nom_titulaire ?? '—')} {String(r.ancien_snapshot.prenom_titulaire ?? '')}</td>
                              <td>{r.motif || '—'}</td>
                              <td>{r.agent_matricule}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  </div>
                )}
              </div>
            ))
          )}
        </>
      )}

      {voirCible && (
        <DossierDetailModal
          dossier={voirCible}
          onClose={() => setVoirCible(null)}
          actions={
            <>
              <button className="btn btn-primary btn-sm" onClick={() => telechargerFichePdf(voirCible.id)}>
                🖨️ Générer la fiche PDF
              </button>
              <button
                className="btn btn-warn btn-sm"
                onClick={() => { setReattribCible(voirCible); setVoirCible(null); }}
              >
                🔄 Réattribuer
              </button>
            </>
          }
        />
      )}

      {reattribCible && (
        <ReattributionModal
          dossier={reattribCible}
          onClose={() => setReattribCible(null)}
          onDone={() => {
            setReattribCible(null);
            rechercher();
          }}
        />
      )}
    </div>
  );
}