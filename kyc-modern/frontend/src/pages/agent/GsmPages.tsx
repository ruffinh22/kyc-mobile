import { useEffect, useState, FormEvent } from 'react';
import { useFetch, useDebounce, todayISO, nDaysAgo } from '../../hooks';
import * as api from '../../services/api';
import { GsmRecord } from '../../types';
import { Alert, LoadingCenter, EmptyState, StatCard, Modal } from '../../components/ui';

// ── Mon Tableau GSM ────────────────────────────────────────────────────────────
export function GsmMonTableau() {
  const { data, loading, error, refetch } = useFetch(() => api.getGsmMonTableau(), []);
  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Mon tableau GSM</h1><p className="page-sub">Vos statistiques Gross Add en temps réel.</p></div><button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button></div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : data && (
        <>
          <div className="stats-grid">
            <StatCard label="Aujourd'hui" value={data.aujourdhui} />
            <StatCard label="7 derniers jours" value={data.sept_jours} />
            <StatCard label={`Mois de paie (${data.libelle_mois_paie})`} value={data.mois_paie} variant="accepte" />
            <StatCard label="Total cumulé" value={data.total} />
          </div>
          {data.dernieres?.length > 0 && (
            <div className="card">
              <p className="card-title">5 dernières saisies</p>
              <div className="table-wrap">
                <table>
                  <thead><tr><th>Numéro</th><th>Date</th><th>Constat</th><th>Statut final</th></tr></thead>
                  <tbody>
                    {data.dernieres.map(g => (
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
            </div>
          )}
        </>
      )}
    </>
  );
}

// ── Saisie GSM ─────────────────────────────────────────────────────────────────
const EMPTY_GSM = { numero:'', type_id:'', constat:'', piece:'', verbatim:'', action:'', statut_final:'', traitement:'', raison:'', nom_client:'', coach:'', date:'' };

export function GsmSaisie() {
  const searchParams = new URLSearchParams(window.location.search);
  const dossierId = searchParams.get('dossier') || localStorage.getItem('gsm_dossier_id') || '';
  const refs = useFetch(() => api.getReferentiels(), []);
  const R = refs.data?.referentiels ?? {};
  const [f, setF] = useState({ ...EMPTY_GSM });
  const [loading, setLoading] = useState(false); const [err, setErr] = useState<string|null>(null); const [success, setSuccess] = useState<string|null>(null);
  const [captures, setCaptures] = useState<{ a?: File; p?: File; aa?: File }>({});
  const [search, setSearch] = useState('');
  const [lastId, setLastId] = useState<number|null>(null);
  const today = todayISO();
  const { data: listData, loading: listLoading, error: listError, refetch: refetchList } = useFetch(() => api.getGsmMesSaisies(today), [today]);
  const saisies = listData?.saisies ?? [];
  const filteredSaisies = saisies.filter(g => !search || [g.numero, g.constat, g.type_id, g.action, g.statut_final].filter(Boolean).join(' ').toLowerCase().includes(search.toLowerCase()));

  useEffect(() => {
    if (dossierId) {
      setF(x => ({ ...x, numero: x.numero || '' }));
      // Nettoyer localStorage après lecture pour éviter les conflits
      localStorage.removeItem('gsm_dossier_id');
    }
  }, [dossierId]);

  const chg = (k: string, v: string) => setF(x => ({ ...x, [k]: v }));

  const submit = async (e: FormEvent) => {
    e.preventDefault(); setErr(null); setSuccess(null);
    if (!f.numero || !f.type_id || !f.constat || !f.piece || !f.verbatim || !f.action)
      return setErr('Champs obligatoires manquants');
    setLoading(true);
    try {
      const today = todayISO();
      const payload = { ...f, date: f.date || today, dossier_id: dossierId || undefined };
      const r = await api.createGsmLibre(payload);
      setLastId(r.id);
      if (captures.a || captures.p || captures.aa) {
        const fd = new FormData();
        if (captures.a)  fd.append('capture_a',  captures.a);
        if (captures.p)  fd.append('capture_p',  captures.p);
        if (captures.aa) fd.append('capture_aa', captures.aa);
        await api.uploadGsmCaptures(r.id, fd);
      }
      setSuccess(`Saisie enregistrée (ID ${r.id})`);
      setF({ ...EMPTY_GSM }); setCaptures({});
      refetchList();
      (e.target as HTMLFormElement).reset();
    } catch(e2) { setErr(e2 instanceof Error ? e2.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  const Sel = ({ k, label, opts, req }: { k: string; label: string; opts?: string[]; req?: boolean }) => (
    <div className="field">
      <label>{label}{req && <span className="req">*</span>}</label>
      {opts?.length ? (
        <select value={(f as Record<string,string>)[k]} onChange={e => chg(k, e.target.value)}>
          <option value="">Sélectionner…</option>
          {opts.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
      ) : (
        <input value={(f as Record<string,string>)[k]} onChange={e => chg(k, e.target.value)} placeholder={label} />
      )}
    </div>
  );

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Saisie GSM / Gross Add</h1><p className="page-sub">Enregistrez une nouvelle saisie Gross Add liée au dossier traité.</p></div></div>
      {dossierId && <Alert kind="info">Dossier lié : {dossierId}</Alert>}
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      <div className="card" style={{ maxWidth: 700 }}>
        <form onSubmit={submit} className="form-grid">
          <div className="form-row">
            <div className="field"><label>Numéro<span className="req">*</span></label><input value={f.numero} onChange={e => chg('numero', e.target.value)} placeholder="Numéro GSM" required /></div>
            <div className="field"><label>Coach</label><input value={f.coach} onChange={e => chg('coach', e.target.value)} /></div>
          </div>
          <div className="form-row">
            <Sel k="type_id"  label="Type ID"  opts={R['type_id']}  req />
            <Sel k="constat"  label="Constat"   opts={R['constat']}  req />
          </div>
          <div className="form-row">
            <Sel k="piece"    label="Pièce"     opts={R['piece']}    req />
            <Sel k="verbatim" label="Verbatim"  opts={R['verbatim']} req />
          </div>
          <div className="form-row">
            <Sel k="action"        label="Action"        opts={R['action']}        req />
            <Sel k="statut_final"  label="Statut final"  opts={R['statut_final']} />
          </div>
          <div className="form-row">
            <Sel k="traitement" label="Traitement" opts={R['traitement']} />
            <Sel k="raison"     label="Raison"     opts={R['raison']} />
          </div>
          <div className="form-row">
            <div className="field"><label>Nom client</label><input value={f.nom_client} onChange={e => chg('nom_client', e.target.value)} /></div>
            <div className="field"><label>Date saisie</label><input type="date" value={f.date} onChange={e => chg('date', e.target.value)} /></div>
          </div>
          <hr className="divider" />
          <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--ink-3)' }}>Captures écran (optionnel)</p>
          <div className="form-row">
            <div className="field"><label>Capture A</label><input type="file" accept="image/*" onChange={e => setCaptures(x => ({ ...x, a: e.target.files?.[0] }))} /></div>
            <div className="field"><label>Capture P</label><input type="file" accept="image/*" onChange={e => setCaptures(x => ({ ...x, p: e.target.files?.[0] }))} /></div>
          </div>
          <div className="field" style={{ maxWidth: 280 }}><label>Capture AA</label><input type="file" accept="image/*" onChange={e => setCaptures(x => ({ ...x, aa: e.target.files?.[0] }))} /></div>
          <button type="submit" className="btn btn-primary btn-lg" disabled={loading}>{loading ? 'Enregistrement…' : 'Enregistrer la saisie'}</button>
        </form>
      </div>

      <div className="card">
        <div className="card-header">
          <div>
            <p className="card-title">Mes saisies d’aujourd’hui</p>
            <p className="page-sub">Suivi rapide des entrées enregistrées pour la journée.</p>
          </div>
          <div className="field" style={{ minWidth: 260 }}>
            <label>Recherche</label>
            <input value={search} onChange={e => setSearch(e.target.value)} placeholder="Numéro, constat, action…" />
          </div>
        </div>
        {listError && <Alert kind="error">{listError}</Alert>}
        {listLoading ? <LoadingCenter /> : (
          <div className="table-wrap">
            <table>
              <thead><tr><th>Numéro</th><th>Date</th><th>Constat</th><th>Pièce</th><th>Action</th><th>Statut</th></tr></thead>
              <tbody>
                {filteredSaisies.length ? filteredSaisies.map(g => (
                  <tr key={g.id}>
                    <td><strong>{g.numero}</strong></td>
                    <td>{g.date_saisie}</td>
                    <td>{g.constat || '—'}</td>
                    <td>{g.piece || '—'}</td>
                    <td>{g.action || '—'}</td>
                    <td>{g.statut_final || '—'}</td>
                  </tr>
                )) : <tr><td colSpan={6}><EmptyState icon="📋" title="Aucune saisie aujourd’hui" /></td></tr>}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ── Mon Historique GSM ─────────────────────────────────────────────────────────
export function GsmHistorique() {
  const [debut, setDebut] = useState(nDaysAgo(30)); const [fin, setFin] = useState(todayISO());
  const [search, setSearch] = useState(''); const dSearch = useDebounce(search, 300);
  const [sel, setSel] = useState<GsmRecord|null>(null);
  const [delTarget, setDelTarget] = useState<GsmRecord|null>(null);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false); const [err, setErr] = useState<string|null>(null);
  const { data, loading, error, refetch } = useFetch(() => api.getGsmMesHistorique(debut, fin), [debut, fin]);

  const filtered = (data?.saisies ?? []).filter(g => !dSearch || g.numero.includes(dSearch) || (g.constat ?? '').toLowerCase().includes(dSearch.toLowerCase()));

  const handleDelete = async () => {
    if (!delTarget) return; setBusy(true);
    try { await api.deleteGsm(delTarget.id); setDelTarget(null); refetch(); }
    catch(e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const handleExport = async () => {
    setExporting(true); setErr(null);
    try {
      const csv = await api.exportGsmCsv({ du: debut, au: fin });
      const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url; a.download = `gsm_${debut}_${fin}.csv`; a.click();
      URL.revokeObjectURL(url);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur export'); }
    finally { setExporting(false); }
  };

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Mon historique GSM</h1><p className="page-sub">Toutes vos saisies sur la période sélectionnée, avec détails et export.</p></div><div style={{ display:'flex', gap:'.5rem' }}><button className="btn btn-ghost btn-sm" onClick={handleExport} disabled={exporting}>{exporting ? 'Export…' : 'Export CSV'}</button><button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button></div></div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}
      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <div className="field"><label>Recherche</label><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Numéro, constat…" /></div>
        </div>
      </div>
      {loading ? <LoadingCenter /> : (
        <div className="card">
          <div style={{ fontSize: 12, color: 'var(--ink-3)', marginBottom: '.75rem' }}>{filtered.length} saisie(s)</div>
          {!filtered.length ? <EmptyState icon="📋" title="Aucune saisie" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Numéro</th><th>Date</th><th>Type</th><th>Constat</th><th>Statut final</th><th>Actions</th></tr></thead>
                <tbody>
                  {filtered.map(g => (
                    <tr key={g.id}>
                      <td><strong>{g.numero}</strong></td>
                      <td>{g.date_saisie}</td>
                      <td>{g.type_id || '—'}</td>
                      <td>{g.constat || '—'}</td>
                      <td>{g.statut_final || '—'}</td>
                      <td>
                        <div style={{ display:'flex', gap:'.3rem' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setSel(g)}>Voir</button>
                          <button className="btn btn-danger btn-sm" onClick={() => setDelTarget(g)}>Suppr.</button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
      {sel && (
        <Modal title={`Saisie #${sel.id} — ${sel.numero}`} onClose={() => setSel(null)}>
          <div className="detail-grid">
            {(['numero','date_saisie','coach','type_id','constat','piece','verbatim','action','statut_final','traitement','raison','nom_client'] as (keyof typeof sel)[]).map(k => (
              <div className="detail-item" key={k}><span className="detail-label">{String(k).replace('_',' ')}</span><span className="detail-value">{String(sel[k] ?? '') || '—'}</span></div>
            ))}
            {(sel.capture_a || sel.capture_p || sel.capture_aa) && (
              <div className="detail-item" style={{ gridColumn: '1 / -1' }}>
                <span className="detail-label">Captures</span>
                <div style={{ display:'flex', gap:'.75rem', flexWrap:'wrap' }}>
                  {['capture_a','capture_p','capture_aa'].map(key => {
                    const value = sel[key as keyof GsmRecord] as string | null;
                    if (!value) return null;
                    return <img key={key} src={`/api/gsm/captures/${encodeURIComponent(value)}`} alt={key} style={{ maxWidth:180, maxHeight:140, borderRadius:8, objectFit:'cover' }} />;
                  })}
                </div>
              </div>
            )}
          </div>
        </Modal>
      )}
      {delTarget && (
        <Modal title="Supprimer la saisie" onClose={() => setDelTarget(null)} footer={
          <>
            <button className="btn btn-ghost btn-sm" onClick={() => setDelTarget(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={handleDelete}>Confirmer</button>
          </>
        }>
          <p style={{ fontSize: 13.5 }}>Supprimer la saisie <strong>{delTarget.numero}</strong> du {delTarget.date_saisie} ?</p>
        </Modal>
      )}
    </>
  );
}

// ── Mes Performances GSM ───────────────────────────────────────────────────────
export function GsmPerfs() {
  const [debut, setDebut] = useState(nDaysAgo(29)); const [fin, setFin] = useState(todayISO());
  const { data, loading, error, refetch } = useFetch(() => api.getGsmMesPerfs(debut, fin), [debut, fin]);
  const stats = data?.stats as Record<string,unknown> | undefined;
  const evolution = data?.evolution ?? [];
  const max = Math.max(1, ...evolution.map(e => e.n));

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Mes performances GSM</h1><p className="page-sub">Analyse de votre activité sur la période.</p></div>
        <div style={{ display:'flex', gap:'.5rem', alignItems:'flex-end' }}>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
          <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <>
          {stats && (
            <div className="stats-grid">
              <StatCard label="Total période"     value={stats.total as number} variant="accepte" />
              <StatCard label="Jours travaillés"  value={stats.jours_travailles as number} />
              <StatCard label="Jours période"     value={stats.jours_periode as number} />
              <StatCard label="Moyenne / jour actif" value={stats.moyenne as number} variant="cours" />
            </div>
          )}
          {evolution.length > 0 && (
            <div className="card">
              <p className="card-title">Évolution quotidienne</p>
              <div className="bar-chart">
                {evolution.map(e => (
                  <div className="bar-row" key={e.jour}>
                    <span className="bar-label">{e.jour.slice(5)}</span>
                    <div className="bar-track"><div className="bar-fill" style={{ width: `${(e.n / max) * 100}%` }} /></div>
                    <span className="bar-val">{e.n}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </>
  );
}
