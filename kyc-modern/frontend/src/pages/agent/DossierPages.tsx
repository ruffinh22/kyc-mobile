import { useMemo, useState, FormEvent, useEffect } from 'react';
import { useFetch, useDebounce, todayISO, nDaysAgo } from '../../hooks';
import * as api from '../../services/api';
import { useAuth } from '../../context/AuthContext';
import { Dossier, DossierStatut } from '../../types';
import { StatCard, Alert, LoadingCenter, EmptyState, Modal } from '../../components/ui';
import { DossiersTable, DossierDetailModal } from '../../components/DossierComponents';
import { FaceLivenessCheck } from '../FaceLivenessCheck';

const PHONE_CONFIG: Record<string, { digitCount: number; placeholder: string }> = {
  CG: { digitCount: 9, placeholder: '06 XXX XXX' },
  BJ: { digitCount: 10, placeholder: '01 XX XX XX XX' },
  CI: { digitCount: 10, placeholder: '05 XX XX XX XX' },
  CM: { digitCount: 9, placeholder: '67 XX XX XXX' },
  GW: { digitCount: 7, placeholder: '96 XX XXX' },
  GN: { digitCount: 8, placeholder: '61 XX XX XX' },
};

function faceSummary(d: Dossier) {
  if (d.score_visage === null || d.score_visage === undefined) {
    return { label: 'Analyse à venir', tone: 'pending', icon: '⏳', motif: d.visage_motif || 'La vérification faciale est en attente' };
  }
  if (d.score_visage >= 80) return { label: 'Conforme', tone: 'ok', icon: '✅', motif: d.visage_motif || 'Score élevé et conforme' };
  if (d.score_visage >= 70) return { label: 'À vérifier', tone: 'warn', icon: '⚠️', motif: d.visage_motif || 'Seuil proche, contrôle recommandé' };
  return { label: 'Non conforme', tone: 'error', icon: '❌', motif: d.visage_motif || 'Score faible' };
}

function ageMinutes(createdAt: number | null | undefined) {
  if (!createdAt) return 0;
  return Math.max(0, Math.floor((Date.now() / 1000 - createdAt) / 60));
}

function formatFaceScore(value: number | string | null | undefined) {
  if (value === null || value === undefined) return null;
  const num = typeof value === 'number' ? value : parseFloat(String(value));
  if (!Number.isFinite(num)) return null;
  return `${num.toFixed(1)}%`;
}

const formatPhoneLike = (val: string, country: string, maxDigits: number) => {
  const digits = val.replace(/\D/g, '').slice(0, maxDigits);
  if (!digits) return '';

  const groups = country === 'CI' || (country === 'BJ' && maxDigits === 10)
    ? [2, 2, 2, 4]
    : country === 'BJ' || country === 'GN'
      ? [2, 2, 2, 2]
      : country === 'CM'
        ? [2, 3, 4]
        : country === 'GW'
          ? [2, 3, 2]
          : [3, 3, 3];

  const parts: string[] = [];
  let start = 0;
  for (const size of groups) {
    const part = digits.slice(start, start + size);
    if (part) parts.push(part);
    start += size;
  }

  return parts.join(' ');
};

// ── Dashboard Agent ────────────────────────────────────────────────────────────
export function AgentDashboard() {
  const { user } = useAuth();
  const today = todayISO();
  const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);
  const tomorrowISO = tomorrow.toISOString().slice(0, 10);
  const { data, loading, error } = useFetch(() => api.getDossierStats(), []);
  const { data: gsmData, loading: gsmLoading, error: gsmError } = useFetch(() => api.getGsmMonTableau(), []);
  const { data: planningData, loading: planningLoading, error: planningError } = useFetch(() => api.getPlanningMon(today, tomorrowISO), [today, tomorrowISO]);

  const planningToday = planningData?.entrees.filter(e => e.date === today) ?? [];
  const planningTomorrow = planningData?.entrees.filter(e => e.date === tomorrowISO) ?? [];

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Bonjour {user?.prenom} 👋</h1>
          <p className="page-sub">Activité du jour — {new Date().toLocaleDateString('fr-FR', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' })}</p>
        </div>
      </div>

      {(error || gsmError || planningError) && <Alert kind="error">{error || gsmError || planningError}</Alert>}

      <div className="card hero-card">
        <div className="hero-card-content">
          <div>
            <p className="hero-card-eyebrow">Tableau de bord agent</p>
            <h2 className="hero-card-title">Suivez vos dossiers, votre GSM et votre planning en un seul endroit.</h2>
            <p className="hero-card-sub">Le flux a été conçu pour reproduire l’expérience de l’ancien back office avec une navigation plus fluide et un suivi plus clair.</p>
          </div>
          <div className="info-pills">
            <span className="info-pill">📥 File d’attente</span>
            <span className="info-pill">📋 GSM / Gross Add</span>
            <span className="info-pill">📅 Planning</span>
          </div>
        </div>
      </div>

      {loading || gsmLoading || planningLoading ? <LoadingCenter /> : (
        <>
          <div className="stats-grid">
            <StatCard label="En attente" value={data?.en_attente ?? 0} variant="attente" sub="File commune" />
            <StatCard label="En cours" value={data?.en_cours ?? 0} variant="cours" sub="Vos dossiers actifs" />
            <StatCard label="Acceptés" value={data?.accepte ?? 0} variant="accepte" sub="Aujourd’hui" />
            <StatCard label="Rejetés" value={data?.rejete ?? 0} variant="rejete" sub="Aujourd’hui" />
          </div>

          <div className="stats-grid">
            <StatCard label="Saisies aujourd’hui" value={gsmData?.aujourdhui ?? 0} variant="accepte" sub="Gross Add" />
            <StatCard label="7 derniers jours" value={gsmData?.sept_jours ?? 0} variant="cours" sub="Évolution rapide" />
            <StatCard label="Mois de paie" value={gsmData?.mois_paie ?? 0} variant="attente" sub={gsmData?.libelle_mois_paie || '—'} />
            <StatCard label="Total cumulé" value={gsmData?.total ?? 0} variant="info" sub="Toutes saisies" />
          </div>

          <div className="dashboard-two-col">
            <div className="card">
              <div className="card-header">
                <div>
                  <p className="card-title">Planning du jour</p>
                  <p className="page-sub">Vos activités prévues aujourd’hui.</p>
                </div>
              </div>
              {!planningToday.length ? <EmptyState icon="📅" title="Aucun planning aujourd’hui" /> : (
                <div className="stack-list">
                  {planningToday.map(entry => (
                    <div key={entry.id} className="stack-item">
                      <div className="stack-item-main">
                        <strong>{entry.activite || 'Activité'}</strong>
                        <span>{entry.lieu || 'Lieu non renseigné'}</span>
                      </div>
                      <div className="stack-item-side">
                        <span>{entry.heure_debut || entry.horaire || '—'}</span>
                        <span>{entry.heure_fin || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            <div className="card">
              <div className="card-header">
                <div>
                  <p className="card-title">Planning de demain</p>
                  <p className="page-sub">Préparez votre journée à l’avance.</p>
                </div>
              </div>
              {!planningTomorrow.length ? <EmptyState icon="🗓" title="Aucun planning demain" /> : (
                <div className="stack-list">
                  {planningTomorrow.map(entry => (
                    <div key={entry.id} className="stack-item">
                      <div className="stack-item-main">
                        <strong>{entry.activite || 'Activité'}</strong>
                        <span>{entry.lieu || 'Lieu non renseigné'}</span>
                      </div>
                      <div className="stack-item-side">
                        <span>{entry.heure_debut || entry.horaire || '—'}</span>
                        <span>{entry.heure_fin || '—'}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>

          <div className="card">
            <div className="card-header">
              <div>
                <p className="card-title">5 dernières saisies GSM</p>
                <p className="page-sub">Un aperçu rapide de votre activité récente.</p>
              </div>
            </div>
            {!gsmData?.dernieres?.length ? <EmptyState icon="📋" title="Aucune saisie récente" /> : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr><th>Numéro</th><th>Date</th><th>Constat</th><th>Statut</th></tr>
                  </thead>
                  <tbody>
                    {gsmData.dernieres.map(g => (
                      <tr key={g.id}>
                        <td><strong>{g.numero}</strong></td>
                        <td>{g.date_saisie}</td>
                        <td>{g.constat || '—'}</td>
                        <td>{g.statut_final || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        </>
      )}
    </>
  );
}

// ── File d'attente ─────────────────────────────────────────────────────────────
export function AgentFileAttente() {
  const { user } = useAuth();
  const [preview, setPreview] = useState<{ imgs: string[]; idx: number; title?: string } | null>(null);
  useEffect(() => {
    if (!preview) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setPreview(null);
      if (e.key === 'ArrowLeft') setPreview(p => p ? { ...p, idx: Math.max(0, p.idx - 1) } : p);
      if (e.key === 'ArrowRight') setPreview(p => p ? { ...p, idx: Math.min(p.imgs.length - 1, p.idx + 1) } : p);
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [preview]);
  const [selected, setSelected] = useState<Dossier | null>(null);
  const [rejetTarget, setRejetTarget] = useState<Dossier | null>(null);
  const [livenessDossier, setLivenessDossier] = useState<Dossier | null>(null);
  const [selectedMotif, setSelectedMotif] = useState('');
  const [customMotif, setCustomMotif] = useState('');
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string|null>(null);
  const { data, loading, error, refetch } = useFetch(() => api.getDossiers({ limit: 200 }), []);
  const motifsQ = useFetch(() => api.getRejectionMotifs(), []);

  const dossiers = data?.dossiers ?? [];
  const stats = useMemo(() => ({
    total: dossiers.length,
    en_attente: dossiers.filter(d => d.statut === 'en_attente').length,
    en_cours: dossiers.filter(d => d.statut === 'en_cours').length,
    accepte: dossiers.filter(d => d.statut === 'accepte').length,
    rejete: dossiers.filter(d => d.statut === 'rejete').length,
    vieux: dossiers.filter(d => ageMinutes(d.created_at) > 5).length,
  }), [dossiers]);

  const action = async (fn: () => Promise<unknown>, after?: () => void) => { setBusy(true); setErr(null); try { await fn(); setSelected(null); refetch(); after?.(); } catch(e) { setErr(e instanceof Error ? e.message : 'Erreur'); } finally { setBusy(false); } };
  const motifs = motifsQ.data?.motifs ?? [];

  useEffect(() => {
    if (rejetTarget) {
      setSelectedMotif(motifs[0] ?? 'autre');
      setCustomMotif('');
    }
  }, [rejetTarget, motifs]);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">File d'attente</h1><p className="page-sub">Vue professionnelle de la file commune, avec les informations utiles au traitement rapide.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻ Actualiser</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}
      {stats.vieux > 0 && <Alert kind="error">{stats.vieux} dossier(s) en attente depuis plus de 5 minutes.</Alert>}

      {loading ? <LoadingCenter /> : (
        <>
          <div className="stats-grid">
            <StatCard label="Total" value={stats.total} variant="attente" sub="Dossiers visibles" />
            <StatCard label="En attente" value={stats.en_attente} variant="attente" sub="À prendre" />
            <StatCard label="En cours" value={stats.en_cours} variant="cours" sub="En traitement" />
            <StatCard label="Acceptés" value={stats.accepte} variant="accepte" sub="Validés" />
            <StatCard label="Rejetés" value={stats.rejete} variant="rejete" sub="Refusés" />
          </div>
          <div className="agent-dossier-grid">
            {dossiers.filter(d => d.statut === 'en_attente').map(d => {
              const face = faceSummary(d);
              const age = ageMinutes(d.created_at);
              return (
                <div key={d.id} className="agent-dossier-card">
                  <div className="agent-dossier-meta">
                    <div>
                      <div className="agent-dossier-id">{d.id}</div>
                      <div className="agent-dossier-sub">{d.username_agent || 'Agent terrain'} • {d.heure_reception || '—'}</div>
                    </div>
                    <span className="agent-badge attente">en attente</span>
                  </div>
                  <div className="agent-dossier-body">
                    <div className="agent-dossier-actions">
                      <div>
                        <div className="agent-dossier-title">{d.numero_mtn || 'Numéro masqué'}</div>
                        <div className="agent-dossier-sub">{age} minute(s) • {d.zone_agent || 'Zone non renseignée'}</div>
                      </div>
                      <div className="agent-actions-inline">
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setLivenessDossier(d)}>Vérifier visage</button>
                        <button className="btn btn-primary btn-sm" disabled={busy} onClick={() => action(() => api.prendreEnCharge(d.id))}>Prendre</button>
                      </div>
                    </div>
                    <div className="face-preview-card">
                      <div className="face-preview-header">
                        <span>Reconnaissance faciale</span>
                        <span className={`face-pill ${face.tone}`}>{face.icon} {face.label}</span>
                      </div>
                      <div className="face-preview-text">{face.motif}</div>
                      {d.score_visage !== null && d.score_visage !== undefined && (
                        <div className="score-row"><span>Score</span><strong>{d.score_visage.toFixed(1)}%</strong></div>
                      )}
                    </div>
                            {(d.photo_recto || d.photo_verso || d.photo_live) && (
                              <div className="photo-strip">
                                {(() => {
                                  const types = ['recto','verso','live'] as const;
                                  const imgs = types.map(t => d[`photo_${t}` as 'photo_recto'|'photo_verso'|'photo_live'] ? api.photoUrlWithToken(d.id, t) : null).filter(Boolean) as string[];
                                  return types.map(type => {
                                    const field = `photo_${type}` as 'photo_recto' | 'photo_verso' | 'photo_live';
                                    const path = d[field];
                                    if (!path) return null;
                                    const url = api.photoUrlWithToken(d.id, type);
                                    const idx = imgs.indexOf(url);
                                    return <img key={type} src={url} alt={type} className="mini-photo" onClick={() => setPreview({ imgs, idx: idx >= 0 ? idx : 0, title: `${d.id} — ${type}` })} />;
                                  });
                                })()}
                              </div>
                            )}
                  </div>
                </div>
              );
            })}
            {dossiers.filter(d => d.statut === 'en_cours').map(d => {
              const face = faceSummary(d);
              return (
                <div key={d.id} className="agent-dossier-card">
                  <div className="agent-dossier-meta">
                    <div>
                      <div className="agent-dossier-id">{d.id}</div>
                      <div className="agent-dossier-sub">{d.username_agent || 'Agent terrain'} • {d.heure_prise || '—'}</div>
                    </div>
                    <span className="agent-badge cours">en cours</span>
                  </div>
                  <div className="agent-dossier-body">
                    <div className="agent-dossier-actions">
                      <div>
                        <div className="agent-dossier-title">{d.numero_mtn}</div>
                        <div className="agent-dossier-sub">{d.zone_agent || 'Zone non renseignée'}</div>
                      </div>
                      <div className="agent-actions-inline">
                        {(d.acquisition_status === 'face_verify_retry' || d.visage_motif?.includes('erreur_rekognition') || d.visage_motif?.includes('failed')) && (
                          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => action(() => api.reprendreFaceVerify(d.id))}>↺ Reprendre faciale</button>
                        )}
                        <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setLivenessDossier(d)}>Vérifier visage</button>
                        <button className="btn btn-danger btn-sm" disabled={busy} onClick={() => { setRejetTarget(d); setSelected(null); }}>Rejeter</button>
                        <button className="btn btn-success btn-sm" disabled={busy} onClick={() => action(() => api.accepterDossier(d.id), () => {
                          localStorage.setItem('gsm_dossier_id', d.id);
                          window.location.href = '/gsm-saisie?dossier=' + d.id;
                        })}>Accepter</button>
                      </div>
                    </div>
                    <div className="face-preview-card">
                      <div className="face-preview-header">
                        <span>Reconnaissance faciale</span>
                        <span className={`face-pill ${face.tone}`}>{face.icon} {face.label}</span>
                      </div>
                      <div className="face-preview-text">{face.motif}</div>
                      {d.score_visage !== null && d.score_visage !== undefined && (
                        <div className="score-row"><span>Score</span><strong>{d.score_visage.toFixed(1)}%</strong></div>
                      )}
                    </div>
                    {(d.photo_recto || d.photo_verso || d.photo_live) && (
                      <div className="photo-strip">
                        {(() => {
                          const types = ['recto','verso','live'] as const;
                          const imgs = types.map(t => d[`photo_${t}` as 'photo_recto'|'photo_verso'|'photo_live'] ? api.photoUrlWithToken(d.id, t) : null).filter(Boolean) as string[];
                          return types.map(type => {
                            const field = `photo_${type}` as 'photo_recto' | 'photo_verso' | 'photo_live';
                            const path = d[field];
                            if (!path) return null;
                            const url = api.photoUrlWithToken(d.id, type);
                            const idx = imgs.indexOf(url);
                            return <img key={type} src={url} alt={type} className="mini-photo" onClick={() => setPreview({ imgs, idx: idx >= 0 ? idx : 0, title: `${d.id} — ${type}` })} />;
                          });
                        })()}
                      </div>
                    )}
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}

      {selected && (
        <DossierDetailModal dossier={selected} onClose={() => setSelected(null)} actions={
          selected.statut === 'en_attente' ? (
            <>
              <button className="btn btn-ghost" disabled={busy} onClick={() => { setSelected(null); setLivenessDossier(selected); }}>
                Vérifier visage
              </button>
              <button className="btn btn-primary" disabled={busy} onClick={() => action(() => api.prendreEnCharge(selected.id))}>
                {busy ? 'Traitement…' : 'Prendre en charge'}
              </button>
            </>
          ) : selected.statut === 'en_cours' && selected.agent_saisie === user?.matricule ? (
            <>
              {(selected.acquisition_status === 'face_verify_retry' || selected.visage_motif?.includes('erreur_rekognition') || selected.visage_motif?.includes('failed')) && (
                <button className="btn btn-ghost" disabled={busy} onClick={() => action(() => api.reprendreFaceVerify(selected.id))}>↺ Reprendre faciale</button>
              )}
              <button className="btn btn-ghost" disabled={busy} onClick={() => { setSelected(null); setLivenessDossier(selected); }}>Vérifier visage</button>
              <button className="btn btn-danger" disabled={busy} onClick={() => { setRejetTarget(selected); setSelected(null); }}>Rejeter</button>
              <button className="btn btn-success" disabled={busy} onClick={() => action(() => api.accepterDossier(selected.id), () => {
                localStorage.setItem('gsm_dossier_id', selected.id);
                window.location.href = '/gsm-saisie?dossier=' + selected.id;
              })}>Accepter</button>
            </>
          ) : null
        }/>
      )}

      {rejetTarget && (
        <Modal title={`Rejeter ${rejetTarget.id}`} onClose={() => { setRejetTarget(null); setSelectedMotif(''); setCustomMotif(''); }} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => { setRejetTarget(null); setSelectedMotif(''); setCustomMotif(''); }}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={busy || (!selectedMotif || (selectedMotif === 'autre' && !customMotif.trim()))} onClick={() => action(async () => {
              const finalReason = selectedMotif === 'autre' ? customMotif.trim() : selectedMotif;
              if (!finalReason) return;
              if (selectedMotif === 'autre' && finalReason && !motifs.includes(finalReason)) {
                await api.setRejectionMotifs([...motifs, finalReason]);
              }
              await api.rejeterDossier(rejetTarget.id, finalReason);
              setRejetTarget(null);
              setSelectedMotif('');
              setCustomMotif('');
              localStorage.setItem('gsm_dossier_id', rejetTarget.id);
              window.location.href = '/gsm-saisie?dossier=' + rejetTarget.id;
            })}>Confirmer</button>
          </>
        }>
          <div className="field">
            <label>Motif du rejet<span className="req">*</span></label>
            <select value={selectedMotif} onChange={e => setSelectedMotif(e.target.value)}>
              <option value="">Sélectionner…</option>
              {motifs.map(m => <option key={m} value={m}>{m}</option>)}
              <option value="autre">Autre…</option>
            </select>
          </div>
          {selectedMotif === 'autre' && (
            <div className="field" style={{ marginTop: '.75rem' }}>
              <label>Préciser le motif</label>
              <textarea value={customMotif} onChange={e => setCustomMotif(e.target.value)} placeholder="Saisissez un motif puis validez" autoFocus />
            </div>
          )}
        </Modal>
      )}
      {livenessDossier && (
        <Modal title={`Vérification faciale — ${livenessDossier.id}`} onClose={() => setLivenessDossier(null)}>
          <FaceLivenessCheck
            dossierId={livenessDossier.id}
            compact
            onClose={() => setLivenessDossier(null)}
            onComplete={() => {
              setLivenessDossier(null);
              refetch();
            }}
          />
        </Modal>
      )}
      {preview && (
        <Modal title={preview.title || 'Aperçu'} onClose={() => setPreview(null)}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '.75rem', alignItems: 'center' }}>
            <div style={{ display: 'flex', justifyContent: 'center' }}>
              <img src={preview.imgs[preview.idx]} alt={preview.title || `Aperçu ${preview.idx+1}`} style={{ maxWidth: '90vw', maxHeight: '80vh', objectFit: 'contain' }} />
            </div>
            <div style={{ display: 'flex', gap: '.5rem' }}>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.max(0, p.idx - 1) } : p)} disabled={preview.idx <= 0}>← Précédent</button>
              <button className="btn btn-ghost btn-sm" onClick={() => setPreview(p => p ? { ...p, idx: Math.min(p.imgs.length - 1, p.idx + 1) } : p)} disabled={preview.idx >= preview.imgs.length - 1}>Suivant →</button>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ── Mes Dossiers ───────────────────────────────────────────────────────────────
export function AgentMesDossiers() {
  const [debut, setDebut] = useState(''); const [fin, setFin] = useState('');
  const [statut, setStatut] = useState<DossierStatut|''>(''); const [search, setSearch] = useState('');
  const [sortBy, setSortBy] = useState<'date' | 'statut' | 'reference' | 'reception'>('date');
  const [sortDir, setSortDir] = useState<'asc' | 'desc'>('desc');
  const dSearch = useDebounce(search, 350);
  const [sel, setSel] = useState<Dossier|null>(null);
  const { data, loading, error, refetch } = useFetch(() => api.getDossiers({ debut, fin, statut: statut||undefined, search: dSearch, limit: 300 }), [debut, fin, statut, dSearch]);

  const sortedDossiers = useMemo(() => {
    const rows = [...(data?.dossiers ?? [])];
    const weights: Record<string, number> = { en_attente: 0, en_cours: 1, accepte: 2, rejete: 3 };
    rows.sort((a, b) => {
      let cmp = 0;
      if (sortBy === 'date') {
        cmp = String(a.date || '').localeCompare(String(b.date || ''));
      } else if (sortBy === 'statut') {
        cmp = (weights[a.statut] ?? 99) - (weights[b.statut] ?? 99);
      } else if (sortBy === 'reference') {
        cmp = String(a.id).localeCompare(String(b.id));
      } else if (sortBy === 'reception') {
        cmp = String(a.heure_reception || '').localeCompare(String(b.heure_reception || ''));
      }
      return sortDir === 'asc' ? cmp : -cmp;
    });
    return rows;
  }, [data?.dossiers, sortBy, sortDir]);

  const STATUTS: { value: DossierStatut|''; label: string }[] = [
    { value: '', label: 'Tous statuts' }, { value: 'en_cours', label: 'En cours' },
    { value: 'accepte', label: 'Acceptés' }, { value: 'rejete', label: 'Rejetés' },
  ];

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mes dossiers</h1><p className="page-sub">Historique de vos dossiers traités.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Recherche</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Référence…" /></div>
          <div className="field"><label>Statut</label><select value={statut} onChange={e => setStatut(e.target.value as DossierStatut|'')}>{STATUTS.map(s => <option key={s.value} value={s.value}>{s.label}</option>)}</select></div>
          <div className="field"><label>Trier par</label><select value={sortBy} onChange={e => setSortBy(e.target.value as typeof sortBy)}>
            <option value="date">Date</option>
            <option value="statut">Statut</option>
            <option value="reference">Référence</option>
            <option value="reception">Réception</option>
          </select></div>
          <div className="field"><label>Ordre</label><select value={sortDir} onChange={e => setSortDir(e.target.value as typeof sortDir)}>
            <option value="desc">Descendant</option>
            <option value="asc">Ascendant</option>
          </select></div>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : <div className="card"><div style={{ fontSize:12, color:'var(--ink-3)', marginBottom:'.75rem' }}>{sortedDossiers.length} résultat(s)</div><DossiersTable dossiers={sortedDossiers} onSelect={setSel} showAgent={false} /></div>}
      {sel && <DossierDetailModal dossier={sel} onClose={() => setSel(null)} />}
    </>
  );
}

// ── Acquisition terrain ────────────────────────────────────────────────────────
const COUNTRIES = [
  { code: 'CG', label: 'Congo' },
  { code: 'BJ', label: 'Bénin' },
  { code: 'CI', label: "Côte d'Ivoire" },
  { code: 'CM', label: 'Cameroun' },
  { code: 'GW', label: 'Guinée Bissau' },
  { code: 'GN', label: 'Guinée' },
];

export function AgentAcquisition() {
  const [f, setF] = useState({
    wa_agent:'', username_agent:'', fonction_agent:'', zone_agent:'', numero_mtn:'', country:'',
    nom_titulaire:'', prenom_titulaire:'', date_naissance:'', lieu_naissance:'', autre_numero:'',
    nom_pere:'', nom_mere:'', adresse_complete:'', numero_cni:'', sexe:'', nationalite:'', profession:''
  });
  const [recto, setRecto] = useState<File|null>(null); const [verso, setVerso] = useState<File|null>(null);
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null); const [success, setSuccess] = useState<string|null>(null);

  const submit = async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault(); setErr(null); setSuccess(null);
    if (!recto || !verso) { setErr('Photos recto et verso obligatoires'); return; }
    if (!f.country) { setErr('Sélectionnez un pays'); return; }
    if (!f.nom_titulaire.trim() || !f.prenom_titulaire.trim() || !f.date_naissance.trim() || !f.lieu_naissance.trim() || !f.nom_pere.trim() || !f.nom_mere.trim()) {
      setErr('Les informations du titulaire et des parents sont obligatoires'); return;
    }
    setLoading(true);
    try {
      const fd = new FormData();
      Object.entries(f).forEach(([k,v]) => fd.append(k, v));
      fd.append('photo_recto', recto); fd.append('photo_verso', verso);
      const r = await api.submitDossierPublic(fd);
      setSuccess(`Dossier déposé avec succès — Réf. ${r.ref}`);
      setF({
        wa_agent:'', username_agent:'', fonction_agent:'', zone_agent:'', numero_mtn:'', country:'',
        nom_titulaire:'', prenom_titulaire:'', date_naissance:'', lieu_naissance:'', autre_numero:'',
        nom_pere:'', nom_mere:'', adresse_complete:'', numero_cni:'', sexe:'', nationalite:'', profession:''
      });
      setRecto(null); setVerso(null);
      (e.target as HTMLFormElement).reset();
    } catch(e2) { setErr(e2 instanceof Error ? e2.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Acquisition KYC terrain</h1><p className="page-sub">Saisissez les informations et les pièces d'identité du client.</p></div></div>
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      <div className="card" style={{ maxWidth: 620 }}>
        <form onSubmit={submit} className="form-grid">
          <div className="form-row">
            <div className="field"><label>WhatsApp agent<span className="req">*</span></label>
              <input
                value={formatPhoneLike(f.wa_agent, f.country, PHONE_CONFIG[f.country]?.digitCount ?? 9)}
                onChange={e => {
                  const digits = e.target.value.replace(/\D/g, '').slice(0, PHONE_CONFIG[f.country]?.digitCount ?? 9);
                  setF(x => ({ ...x, wa_agent: digits }));
                }}
                placeholder={PHONE_CONFIG[f.country]?.placeholder ?? 'Sélectionnez un pays'}
                inputMode="numeric"
                required
              />
            </div>
            <div className="field"><label>Nom agent<span className="req">*</span></label><input value={f.username_agent} onChange={e => setF(x => ({...x, username_agent: e.target.value}))} placeholder="Nom complet" required /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Fonction</label><input value={f.fonction_agent} onChange={e => setF(x => ({...x, fonction_agent: e.target.value}))} placeholder="Fonction" /></div>
            <div className="field"><label>Zone</label><input value={f.zone_agent} onChange={e => setF(x => ({...x, zone_agent: e.target.value}))} placeholder="Zone" /></div>
          </div>
          <div className="form-row">
            <div className="field"><label>Numéro MTN client<span className="req">*</span></label><input value={f.numero_mtn} onChange={e => setF(x => ({...x, numero_mtn: e.target.value}))} placeholder="Numéro MTN" required /></div>
            <div className="field"><label>Pays<span className="req">*</span></label>
              <select value={f.country} onChange={e => setF(x => ({...x, country: e.target.value, wa_agent: ''}))} required>
                <option value="">Sélectionner…</option>
                {COUNTRIES.map(c => <option key={c.code} value={c.code}>{c.label}</option>)}
              </select>
            </div>
          </div>

          <div className="card" style={{ marginBottom: '1rem', padding: '1rem' }}>
            <h3 style={{ margin: '0 0 .75rem', fontSize: '1rem' }}>Informations du titulaire</h3>
            <div className="form-row">
              <div className="field"><label>Nom titulaire<span className="req">*</span></label><input value={f.nom_titulaire} onChange={e => setF(x => ({...x, nom_titulaire: e.target.value}))} placeholder="Nom du titulaire" required /></div>
              <div className="field"><label>Prénom titulaire<span className="req">*</span></label><input value={f.prenom_titulaire} onChange={e => setF(x => ({...x, prenom_titulaire: e.target.value}))} placeholder="Prénom du titulaire" required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Date de naissance<span className="req">*</span></label><input type="date" value={f.date_naissance} onChange={e => setF(x => ({...x, date_naissance: e.target.value}))} required /></div>
              <div className="field"><label>Lieu de naissance<span className="req">*</span></label><input value={f.lieu_naissance} onChange={e => setF(x => ({...x, lieu_naissance: e.target.value}))} placeholder="Lieu de naissance" required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Nom du père<span className="req">*</span></label><input value={f.nom_pere} onChange={e => setF(x => ({...x, nom_pere: e.target.value}))} placeholder="Nom du père" required /></div>
              <div className="field"><label>Nom de la mère<span className="req">*</span></label><input value={f.nom_mere} onChange={e => setF(x => ({...x, nom_mere: e.target.value}))} placeholder="Nom de la mère" required /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Adresse complète</label><input value={f.adresse_complete} onChange={e => setF(x => ({...x, adresse_complete: e.target.value}))} placeholder="Adresse complète" /></div>
              <div className="field"><label>Numéro CNI</label><input value={f.numero_cni} onChange={e => setF(x => ({...x, numero_cni: e.target.value}))} placeholder="Numéro CNI" /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Sexe</label><select value={f.sexe} onChange={e => setF(x => ({...x, sexe: e.target.value}))}><option value="">Sélectionner…</option><option value="M">Masculin</option><option value="F">Féminin</option></select></div>
              <div className="field"><label>Nationalité</label><input value={f.nationalite} onChange={e => setF(x => ({...x, nationalite: e.target.value}))} placeholder="Nationalité" /></div>
            </div>
            <div className="form-row">
              <div className="field"><label>Profession</label><input value={f.profession} onChange={e => setF(x => ({...x, profession: e.target.value}))} placeholder="Profession" /></div>
              <div className="field"><label>Autre numéro</label><input value={f.autre_numero} onChange={e => setF(x => ({...x, autre_numero: e.target.value}))} placeholder="Autre numéro" /></div>
            </div>
          </div>

          <div className="form-row">
            <div className="field"><label>Photo recto CNI<span className="req">*</span></label><input type="file" accept="image/*" onChange={e => setRecto(e.target.files?.[0]??null)} required /></div>
            <div className="field"><label>Photo verso CNI<span className="req">*</span></label><input type="file" accept="image/*" onChange={e => setVerso(e.target.files?.[0]??null)} required /></div>
          </div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>{loading ? 'Envoi en cours…' : 'Envoyer le dossier'}</button>
        </form>
      </div>
    </>
  );
}
