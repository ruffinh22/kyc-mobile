import { useState } from 'react';
import { useFetch } from '../../hooks';
import * as api from '../../services/api';
import { Compte, Role, Session, AuditLog } from '../../types';
import { StatCard, Alert, LoadingCenter, EmptyState, Modal, RoleBadge } from '../../components/ui';

// ─────────────────────────────────────────────────────────────────────────────
// 1. Dashboard Admin
// ─────────────────────────────────────────────────────────────────────────────
export function AdminDashboard() {
  const { data, loading, error, refetch } = useFetch(() => api.getAdminStats(), []);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Tableau de bord administrateur</h1><p className="page-sub">Vue système globale.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : data && (
        <>
          <div className="card">
            <p className="card-title">Dossiers du jour</p>
            <div className="stats-grid">
              <StatCard label="En attente" value={data.dossiers_today.en_attente} variant="attente" />
              <StatCard label="En cours"   value={data.dossiers_today.en_cours}   variant="cours" />
              <StatCard label="Acceptés"   value={data.dossiers_today.accepte}    variant="accepte" />
              <StatCard label="Rejetés"    value={data.dossiers_today.rejete}     variant="rejete" />
              <StatCard label="Total"      value={data.dossiers_today.total} />
            </div>
          </div>
          <div className="card">
            <p className="card-title">Présence temps réel</p>
            <div className="stats-grid">
              <StatCard label="En ligne"   value={data.presence.en_ligne} variant="accepte" />
              <StatCard label="En pause"   value={data.presence.en_pause} variant="attente" />
            </div>
          </div>
          <div className="card">
            <p className="card-title">Comptes utilisateurs</p>
            <div className="stats-grid">
              <StatCard label="Total"        value={data.comptes.total} />
              <StatCard label="Actifs"       value={data.comptes.actifs}      variant="accepte" />
              <StatCard label="Agents"       value={data.comptes.agents} />
              <StatCard label="Superviseurs" value={data.comptes.superviseurs} variant="cours" />
              <StatCard label="Admins"       value={data.comptes.admins}      variant="rejete" />
            </div>
          </div>
          <div className="card">
            <p className="card-title">Stockage base de données</p>
            <div className="stats-grid">
              <StatCard label="Dossiers"    value={data.storage.dossiers} />
              <StatCard label="Saisies GSM" value={data.storage.gsm} />
              <StatCard label="Photos CNI"  value={data.storage.photos_cni} />
              <StatCard label="Captures GSM" value={data.storage.captures_gsm} />
              <StatCard label="Planning"    value={data.storage.planning} />
              <StatCard label="Notes"       value={data.storage.notes} />
            </div>
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. Gestion des comptes
// ─────────────────────────────────────────────────────────────────────────────
export function AdminComptes() {
  const { data, loading, error, refetch } = useFetch(() => api.getComptes(), []);
  const [showCreate, setShowCreate] = useState(false);
  const [resetTarget, setResetTarget] = useState<Compte|null>(null);
  const [editTarget,  setEditTarget]  = useState<Compte|null>(null);
  const [genPwd, setGenPwd] = useState<string|null>(null);
  const [busy, setBusy] = useState(false);
  const [err,  setErr]  = useState<string|null>(null);

  // Formulaire création
  const [nMat, setNMat] = useState(''); const [nNom, setNNom] = useState('');
  const [nPre, setNPre] = useState(''); const [nRole, setNRole] = useState<Role>('agent');

  const handleCreate = async () => {
    if (!nMat || !nNom) { setErr('Matricule et nom obligatoires'); return; }
    setBusy(true); setErr(null);
    try {
      const r = await api.createCompte({ matricule: nMat.toUpperCase(), nom: nNom, prenom: nPre, role: nRole });
      if (r.password_initial) setGenPwd(r.password_initial);
      setShowCreate(false); setNMat(''); setNNom(''); setNPre(''); setNRole('agent');
      refetch();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const handleToggleActif = async (c: Compte) => {
    setBusy(true); setErr(null);
    try { await api.updateCompte(c.matricule, { actif: !c.actif }); refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const handleResetPwd = async () => {
    if (!resetTarget) return; setBusy(true); setErr(null);
    try {
      const r = await api.resetPassword(resetTarget.matricule);
      if (r.password_initial) setGenPwd(r.password_initial);
      setResetTarget(null); refetch();
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  const handleEditSave = async () => {
    if (!editTarget) return; setBusy(true); setErr(null);
    try { await api.updateCompte(editTarget.matricule, { nom: editTarget.nom, prenom: editTarget.prenom, role: editTarget.role }); setEditTarget(null); refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Gestion des comptes</h1><p className="page-sub">Créer, modifier, activer/désactiver les comptes.</p></div>
        <button className="btn btn-primary" onClick={() => { setShowCreate(true); setErr(null); }}>+ Nouveau compte</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}
      {genPwd && <Alert kind="success">Mot de passe généré : <strong style={{ userSelect:'all' }}>{genPwd}</strong> — notez-le maintenant. <button className="btn btn-ghost btn-sm" style={{ marginLeft:'.5rem' }} onClick={() => setGenPwd(null)}>Fermer</button></Alert>}
      {loading ? <LoadingCenter /> : (
        <div className="card">
          {!data?.comptes?.length ? <EmptyState icon="👤" title="Aucun compte" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Matricule</th><th>Nom</th><th>Rôle</th><th>Statut</th><th>Dernière connexion</th><th>Actions</th></tr></thead>
                <tbody>
                  {data.comptes.map(c => (
                    <tr key={c.matricule}>
                      <td><strong>{c.matricule}</strong></td>
                      <td>{c.prenom} {c.nom}</td>
                      <td><RoleBadge role={c.role} /></td>
                      <td>
                        <span className="badge" style={{ background: c.actif ? 'var(--success-soft)' : 'var(--danger-soft)', color: c.actif ? 'var(--success)' : 'var(--danger)' }}>
                          {c.actif ? 'Actif' : 'Désactivé'}
                        </span>
                        {c.locked_until && c.locked_until > Math.floor(Date.now()/1000) && (
                          <span className="badge b-rejete" style={{ marginLeft:'.3rem' }}>Verrouillé</span>
                        )}
                      </td>
                      <td style={{ fontSize:12 }}>{c.last_login_at ? new Date(c.last_login_at * 1000).toLocaleString('fr-FR') : '—'}</td>
                      <td>
                        <div style={{ display:'flex', gap:'.3rem', flexWrap:'wrap' }}>
                          <button className="btn btn-ghost btn-sm" onClick={() => setEditTarget({ ...c })}>Modifier</button>
                          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => handleToggleActif(c)}>{c.actif ? 'Désactiver' : 'Activer'}</button>
                          <button className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setResetTarget(c)}>Reset MDP</button>
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

      {showCreate && (
        <Modal title="Nouveau compte" onClose={() => { setShowCreate(false); setErr(null); }} footer={
          <><button className="btn btn-ghost btn-sm" onClick={() => setShowCreate(false)}>Annuler</button>
            <button className="btn btn-primary btn-sm" disabled={busy || !nMat || !nNom} onClick={handleCreate}>{busy ? 'Création…' : 'Créer'}</button></>
        }>
          <div className="form-grid">
            <div className="field"><label>Matricule<span className="req">*</span></label><input value={nMat} onChange={e => setNMat(e.target.value.toUpperCase())} placeholder="AG010" autoFocus /></div>
            <div className="form-row">
              <div className="field"><label>Nom<span className="req">*</span></label><input value={nNom} onChange={e => setNNom(e.target.value)} /></div>
              <div className="field"><label>Prénom</label><input value={nPre} onChange={e => setNPre(e.target.value)} /></div>
            </div>
            <div className="field"><label>Rôle</label>
              <select value={nRole} onChange={e => setNRole(e.target.value as Role)}>
                <option value="agent">Agent</option><option value="superviseur">Superviseur</option><option value="admin">Admin</option>
              </select>
            </div>
            <span className="field-hint">Un mot de passe temporaire sera généré automatiquement.</span>
          </div>
        </Modal>
      )}

      {resetTarget && (
        <Modal title={`Reset MDP — ${resetTarget.matricule}`} onClose={() => setResetTarget(null)} footer={
          <><button className="btn btn-ghost btn-sm" onClick={() => setResetTarget(null)}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={busy} onClick={handleResetPwd}>{busy ? 'Reset…' : 'Confirmer le reset'}</button></>
        }>
          <p style={{ fontSize:13.5, color:'var(--ink-2)' }}>Un nouveau mot de passe temporaire sera généré et toutes les sessions actives révoquées.</p>
        </Modal>
      )}

      {editTarget && (
        <Modal title={`Modifier — ${editTarget.matricule}`} onClose={() => setEditTarget(null)} footer={
          <><button className="btn btn-ghost btn-sm" onClick={() => setEditTarget(null)}>Annuler</button>
            <button className="btn btn-primary btn-sm" disabled={busy} onClick={handleEditSave}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button></>
        }>
          <div className="form-grid">
            <div className="form-row">
              <div className="field"><label>Nom</label><input value={editTarget.nom} onChange={e => setEditTarget(x => x ? {...x, nom: e.target.value} : x)} /></div>
              <div className="field"><label>Prénom</label><input value={editTarget.prenom} onChange={e => setEditTarget(x => x ? {...x, prenom: e.target.value} : x)} /></div>
            </div>
            <div className="field"><label>Rôle</label>
              <select value={editTarget.role} onChange={e => setEditTarget(x => x ? {...x, role: e.target.value as Role} : x)}>
                <option value="agent">Agent</option><option value="superviseur">Superviseur</option><option value="admin">Admin</option>
              </select>
            </div>
          </div>
        </Modal>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 3. Sessions actives
// ─────────────────────────────────────────────────────────────────────────────
export function AdminSessions() {
  const { data, loading, error, refetch } = useFetch(() => api.getSessions(), []);
  const [busy, setBusy] = useState<string|null>(null);
  const [err,  setErr]  = useState<string|null>(null);

  const revoke = async (jti: string) => {
    setBusy(jti); setErr(null);
    try { await api.revokeSession(jti); refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setBusy(null); }
  };

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Sessions actives</h1><p className="page-sub">Toutes les connexions JWT valides sur la plateforme.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {err   && <Alert kind="error">{err}</Alert>}
      {loading ? <LoadingCenter /> : (
        <div className="card">
          {!data?.sessions?.length ? <EmptyState icon="🔓" title="Aucune session active" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Matricule</th><th>IP</th><th>Connecté le</th><th>Expire le</th><th>Action</th></tr></thead>
                <tbody>
                  {data.sessions.map((s: Session) => (
                    <tr key={s.jti}>
                      <td><strong>{s.matricule}</strong></td>
                      <td style={{ fontFamily:'monospace', fontSize:12 }}>{s.ip || '—'}</td>
                      <td style={{ fontSize:12 }}>{new Date(s.created_at * 1000).toLocaleString('fr-FR')}</td>
                      <td style={{ fontSize:12 }}>{new Date(s.expires_at * 1000).toLocaleString('fr-FR')}</td>
                      <td><button className="btn btn-danger btn-sm" disabled={busy === s.jti} onClick={() => revoke(s.jti)}>{busy === s.jti ? 'Révocation…' : 'Révoquer'}</button></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 4. Journal d'audit
// ─────────────────────────────────────────────────────────────────────────────
export function AdminAudit() {
  const [mat,   setMat]   = useState('');
  const [action, setAction] = useState('');
  const [debut, setDebut] = useState('');
  const [fin,   setFin]   = useState('');

  const { data, loading, error, refetch } = useFetch(
    () => api.getAuditLogs({ matricule: mat||undefined, action: action||undefined, debut: debut||undefined, fin: fin||undefined, limit: 300 }),
    [mat, action, debut, fin]
  );

  const COLOR_ACTION = (a: string) => {
    if (a.includes('FAIL') || a.includes('LOCKED') || a.includes('PURGE')) return 'var(--danger)';
    if (a.includes('SUCCESS') || a.includes('CREE') || a.includes('ACCEPTE')) return 'var(--success)';
    return 'var(--ink-2)';
  };

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Journal d'audit</h1><p className="page-sub">Trace de toutes les actions sensibles.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      <div className="card">
        <div className="filter-bar">
          <div className="field"><label>Matricule</label><input value={mat} onChange={e => setMat(e.target.value.toUpperCase())} placeholder="AG001…" /></div>
          <div className="field"><label>Action</label><input value={action} onChange={e => setAction(e.target.value)} placeholder="LOGIN, DOSSIER…" /></div>
          <div className="field"><label>Du</label><input type="date" value={debut} onChange={e => setDebut(e.target.value)} /></div>
          <div className="field"><label>Au</label><input type="date" value={fin} onChange={e => setFin(e.target.value)} /></div>
        </div>
      </div>
      {loading ? <LoadingCenter /> : (
        <div className="card">
          <div style={{ fontSize:12, color:'var(--ink-3)', marginBottom:'.75rem' }}>{data?.total ?? 0} entrée(s)</div>
          {!data?.logs?.length ? <EmptyState icon="📜" title="Aucune entrée" /> : (
            <div className="table-wrap">
              <table>
                <thead><tr><th>Date</th><th>Matricule</th><th>Action</th><th>Détails</th><th>IP</th></tr></thead>
                <tbody>
                  {data.logs.map((l: AuditLog) => (
                    <tr key={l.id}>
                      <td style={{ fontSize:11, whiteSpace:'nowrap' }}>{new Date(l.created_at * 1000).toLocaleString('fr-FR')}</td>
                      <td>{l.user_matricule || '—'}</td>
                      <td><span style={{ fontFamily:'monospace', fontSize:11, fontWeight:700, color: COLOR_ACTION(l.action) }}>{l.action}</span></td>
                      <td style={{ fontSize:12, maxWidth:280, overflow:'hidden', textOverflow:'ellipsis', whiteSpace:'nowrap' }}>{l.details || '—'}</td>
                      <td style={{ fontFamily:'monospace', fontSize:11 }}>{l.ip || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 5. Configuration Distribution + Seuil
// ─────────────────────────────────────────────────────────────────────────────
export function AdminDistribution() {
  const modeQ  = useFetch(() => api.getDistributionMode(), []);
  const seuilQ = useFetch(() => api.getSeuilAlerte(), []);
  const [seuil, setSeuil]     = useState('');
  const [saving, setSaving]   = useState(false);
  const [err, setErr]         = useState<string|null>(null);
  const [success, setSuccess] = useState<string|null>(null);

  const toggleMode = async () => {
    const cur = modeQ.data?.mode ?? 'manuel';
    setSaving(true); setErr(null); setSuccess(null);
    try { await api.setDistributionMode(cur === 'auto' ? 'manuel' : 'auto'); modeQ.refetch(); setSuccess('Mode mis à jour.'); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setSaving(false); }
  };

  const saveSeuil = async () => {
    const n = parseInt(seuil, 10);
    if (isNaN(n) || n < 1) { setErr('Seuil invalide'); return; }
    setSaving(true); setErr(null); setSuccess(null);
    try { await api.setSeuilAlerte(n); seuilQ.refetch(); setSuccess('Seuil mis à jour.'); setSeuil(''); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setSaving(false); }
  };

  const mode = modeQ.data?.mode ?? 'manuel';

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Configuration — Distribution</h1></div></div>
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      <div className="card" style={{ maxWidth:480 }}>
        <p className="card-title">Mode de distribution</p>
        <div style={{ display:'flex', alignItems:'center', gap:'1rem', marginBottom:'1rem' }}>
          <label className="toggle"><input type="checkbox" checked={mode === 'auto'} onChange={toggleMode} disabled={saving} /><span className="toggle-track" /></label>
          <span className="toggle-label" style={{ fontWeight:700, color: mode === 'auto' ? 'var(--success)' : 'var(--ink-3)' }}>{mode === 'auto' ? 'AUTO' : 'MANUEL'}</span>
        </div>
        <p style={{ fontSize:13, color:'var(--ink-3)' }}>{mode === 'auto' ? 'Attribution automatique FIFO toutes les 2 secondes.' : 'Chaque agent choisit son dossier dans la file.'}</p>
      </div>
      <div className="card" style={{ maxWidth:480 }}>
        <p className="card-title">Seuil d'alerte file d'attente (minutes)</p>
        <p style={{ fontSize:13, color:'var(--ink-3)', marginBottom:'1rem' }}>Actuel : <strong>{seuilQ.data?.seuil ?? '…'} min</strong></p>
        <div className="form-row" style={{ alignItems:'flex-end' }}>
          <div className="field"><label>Nouveau seuil (min)</label><input type="number" min="1" max="1440" value={seuil} onChange={e => setSeuil(e.target.value)} placeholder="Ex. 10" /></div>
          <button className="btn btn-primary" disabled={saving || !seuil} onClick={saveSeuil}>Enregistrer</button>
        </div>
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 6. Habilitations superviseurs
// ─────────────────────────────────────────────────────────────────────────────
export function AdminHabilitations() {
  const habQ = useFetch(() => api.getHabilitations(), []);
  const supsQ = useFetch(() => api.getAgents(), []); // on réutilise la liste agents — côté admin on veut les sups
  const [hab, setHab] = useState<Record<string, Record<string,string>>>({});
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string|null>(null);

  const MENUS = ['file-attente','historique','presence','performance','distribution','flux','compilation-gsm','notes-qualite','planning','reporting'];

  const toggle = (mat: string, menu: string) => {
    setHab(h => {
      const cur = h[mat]?.[menu] ?? 'complet';
      return { ...h, [mat]: { ...(h[mat] ?? {}), [menu]: cur === 'complet' ? 'lecture' : 'complet' } };
    });
    setSaved(false);
  };

  const save = async () => {
    setSaving(true); setErr(null);
    try { await api.setHabilitations(hab); setSaved(true); habQ.refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setSaving(false); }
  };

  const data = habQ.data?.habilitations ?? {};
  const initHab = () => { if (Object.keys(hab).length === 0 && Object.keys(data).length > 0) setHab(data); };
  if (Object.keys(hab).length === 0 && Object.keys(data).length > 0) initHab();

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Habilitations superviseurs</h1><p className="page-sub">Restreindre l'accès à certains menus par superviseur.</p></div>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      {err    && <Alert kind="error">{err}</Alert>}
      {saved  && <Alert kind="success">Habilitations enregistrées.</Alert>}
      <div className="card">
        <p style={{ fontSize:12, color:'var(--ink-3)', marginBottom:'1rem' }}>Cochez les menus auxquels chaque superviseur a accès. Par défaut : accès complet à tout.</p>
        {habQ.loading ? <LoadingCenter /> : (
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Superviseur</th>
                  {MENUS.map(m => <th key={m} style={{ fontSize:10, writingMode:'vertical-rl', transform:'rotate(180deg)', height:80 }}>{m}</th>)}
                </tr>
              </thead>
              <tbody>
                {Object.keys({ ...data, ...hab }).length === 0
                  ? <tr><td colSpan={MENUS.length+1}><EmptyState icon="🔑" title="Aucun superviseur configuré" body="Ajoutez des entrées via le formulaire ci-dessous." /></td></tr>
                  : Object.keys({ ...data, ...hab }).map(mat => (
                    <tr key={mat}>
                      <td><strong>{mat}</strong></td>
                      {MENUS.map(menu => {
                        const cur = (hab[mat] ?? data[mat])?.[menu] ?? 'complet';
                        return (
                          <td key={menu} style={{ textAlign:'center' }}>
                            <input type="checkbox" checked={cur === 'complet'} onChange={() => toggle(mat, menu)} title={cur} />
                          </td>
                        );
                      })}
                    </tr>
                  ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 7. Référentiels GSM
// ─────────────────────────────────────────────────────────────────────────────
export function AdminReferentiels() {
  const { data, loading, error, refetch } = useFetch(() => api.getConfigReferentiels(), []);
  const [refs, setRefs]   = useState<Record<string,string[]>>({});
  const [saving, setSaving] = useState(false);
  const [err, setErr]     = useState<string|null>(null);
  const [success, setSuccess] = useState(false);
  const [editKey, setEditKey] = useState('');
  const [editVal, setEditVal] = useState('');

  if (Object.keys(refs).length === 0 && data?.referentiels && Object.keys(data.referentiels).length > 0) setRefs(data.referentiels);

  const save = async () => {
    setSaving(true); setErr(null); setSuccess(false);
    try { await api.setConfigReferentiels(refs); setSuccess(true); refetch(); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setSaving(false); }
  };

  const addItem = () => {
    if (!editKey.trim()) return;
    setRefs(r => ({ ...r, [editKey]: [...(r[editKey] ?? []), editVal.trim()].filter(Boolean) }));
    setEditVal(''); setSuccess(false);
  };

  const removeItem = (key: string, idx: number) => {
    setRefs(r => ({ ...r, [key]: r[key].filter((_,i) => i !== idx) }));
    setSuccess(false);
  };

  const CHAMPS = ['type_id','constat','piece','verbatim','action','statut_final','traitement','raison'];

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Référentiels GSM</h1><p className="page-sub">Valeurs des listes déroulantes de la saisie GSM.</p></div>
        <button className="btn btn-primary" disabled={saving} onClick={save}>{saving ? 'Enregistrement…' : 'Enregistrer'}</button>
      </div>
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">Référentiels enregistrés.</Alert>}
      {loading ? <LoadingCenter /> : (
        <>
          <div className="card" style={{ maxWidth:480 }}>
            <p className="card-title">Ajouter une valeur</p>
            <div className="form-row" style={{ alignItems:'flex-end' }}>
              <div className="field"><label>Champ</label>
                <select value={editKey} onChange={e => setEditKey(e.target.value)}>
                  <option value="">Sélectionner…</option>
                  {CHAMPS.map(c => <option key={c} value={c}>{c}</option>)}
                </select>
              </div>
              <div className="field"><label>Valeur</label><input value={editVal} onChange={e => setEditVal(e.target.value)} placeholder="Nouvelle valeur" onKeyDown={e => e.key === 'Enter' && addItem()} /></div>
              <button className="btn btn-primary" onClick={addItem} disabled={!editKey || !editVal.trim()}>Ajouter</button>
            </div>
          </div>
          <div style={{ display:'grid', gridTemplateColumns:'repeat(auto-fill,minmax(280px,1fr))', gap:'1rem' }}>
            {CHAMPS.map(champ => (
              <div className="card" key={champ}>
                <p className="card-title" style={{ textTransform:'capitalize' }}>{champ.replace('_',' ')}</p>
                {!(refs[champ]?.length) ? <p style={{ fontSize:12, color:'var(--ink-4)' }}>Aucune valeur</p> : (
                  <ul style={{ listStyle:'none', display:'flex', flexDirection:'column', gap:'.3rem' }}>
                    {refs[champ].map((v,i) => (
                      <li key={i} style={{ display:'flex', alignItems:'center', justifyContent:'space-between', fontSize:13, padding:'.2rem .4rem', background:'var(--surface-2)', borderRadius:'var(--r-sm)' }}>
                        <span>{v}</span>
                        <button className="btn-icon" style={{ fontSize:11, padding:'2px 5px' }} onClick={() => removeItem(champ, i)}>✕</button>
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 8. Purge données
// ─────────────────────────────────────────────────────────────────────────────
export function AdminPurge() {
  const [action, setAction] = useState('images_cni');
  const [mode, setMode]     = useState<'tout'|'periode'>('tout');
  const [du, setDu]         = useState('');
  const [au, setAu]         = useState('');
  const [code, setCode]     = useState('');
  const [apercu, setApercu] = useState<number|null>(null);
  const [loading, setLoading] = useState(false);
  const [err, setErr]       = useState<string|null>(null);
  const [success, setSuccess] = useState<string|null>(null);
  const [confirm, setConfirm] = useState(false);

  const getApercu = async () => {
    setLoading(true); setErr(null); setApercu(null);
    try { const r = await api.purgeApercu(action, mode, du||undefined, au||undefined); setApercu(r.count); }
    catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  const executer = async () => {
    if (!code.trim()) { setErr('Code de confirmation requis'); return; }
    setLoading(true); setErr(null); setSuccess(null); setConfirm(false);
    try {
      const r = await api.purgeExecuter(action, code.trim(), mode, du||undefined, au||undefined);
      setSuccess(`Purge effectuée : ${r.count} enregistrement(s) supprimé(s) / mis à jour.`);
      setCode(''); setApercu(null);
    } catch (e) { setErr(e instanceof Error ? e.message : 'Erreur'); }
    finally { setLoading(false); }
  };

  const ACTIONS = [
    { v:'images_cni',    l:'Images CNI (recto/verso/live)' },
    { v:'captures_gsm',  l:'Captures GSM (A/P/AA)' },
    { v:'saisies_gsm',   l:'Toutes les saisies GSM' },
    { v:'dossiers',      l:'Dossiers KYC' },
  ];

  return (
    <>
      <div className="page-header"><div><h1 className="page-title">Purge des données</h1><p className="page-sub">⚠ Action irréversible — requiert le code de purge.</p></div></div>
      <Alert kind="warn">Cette opération est irréversible. Assurez-vous d'avoir effectué une sauvegarde avant de procéder.</Alert>
      {err     && <Alert kind="error">{err}</Alert>}
      {success && <Alert kind="success">{success}</Alert>}
      <div className="card" style={{ maxWidth:540 }}>
        <div className="form-grid">
          <div className="field"><label>Type de purge</label>
            <select value={action} onChange={e => { setAction(e.target.value); setApercu(null); }}>
              {ACTIONS.map(a => <option key={a.v} value={a.v}>{a.l}</option>)}
            </select>
          </div>
          <div className="field"><label>Périmètre</label>
            <select value={mode} onChange={e => { setMode(e.target.value as 'tout'|'periode'); setApercu(null); }}>
              <option value="tout">Tout</option>
              <option value="periode">Sur une période</option>
            </select>
          </div>
          {mode === 'periode' && (
            <div className="form-row">
              <div className="field"><label>Du</label><input type="date" value={du} onChange={e => setDu(e.target.value)} /></div>
              <div className="field"><label>Au</label><input type="date" value={au} onChange={e => setAu(e.target.value)} /></div>
            </div>
          )}
          <button className="btn btn-ghost" disabled={loading} onClick={getApercu}>Aperçu du volume concerné</button>
          {apercu !== null && (
            <Alert kind="info"><strong>{apercu}</strong> enregistrement(s) seront affectés.</Alert>
          )}
          <hr className="divider" />
          <div className="field"><label>Code de purge<span className="req">*</span></label><input type="password" value={code} onChange={e => setCode(e.target.value)} placeholder="Code secret configuré dans les paramètres" /></div>
          <button className="btn btn-danger btn-lg" disabled={loading || !code.trim()} onClick={() => setConfirm(true)}>Exécuter la purge</button>
        </div>
      </div>

      {confirm && (
        <Modal title="Confirmer la purge" onClose={() => setConfirm(false)} footer={
          <><button className="btn btn-ghost btn-sm" onClick={() => setConfirm(false)}>Annuler</button>
            <button className="btn btn-danger btn-sm" disabled={loading} onClick={executer}>{loading ? 'Purge…' : 'Oui, purger définitivement'}</button></>
        }>
          <Alert kind="warn">Cette action est <strong>irréversible</strong>. {apercu !== null && <span><strong>{apercu}</strong> enregistrement(s) seront supprimés ou modifiés.</span>}</Alert>
        </Modal>
      )}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────
// 9. Stockage
// ─────────────────────────────────────────────────────────────────────────────
export function AdminStockage() {
  const { data, loading, error, refetch } = useFetch(() => api.getStorageStats(), []);

  return (
    <>
      <div className="page-header">
        <div><h1 className="page-title">Stockage base de données</h1><p className="page-sub">Volume des données par table.</p></div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : data && (
        <div className="stats-grid">
          <StatCard label="Dossiers KYC"   value={data.dossiers}     sub="Enregistrements dossiers" />
          <StatCard label="Saisies GSM"     value={data.gsm}          sub="Saisies Gross Add" />
          <StatCard label="Photos CNI"      value={data.photos_cni}   sub="Dossiers avec photo" variant="cours" />
          <StatCard label="Captures GSM"    value={data.captures_gsm} sub="Saisies avec capture" variant="cours" />
          <StatCard label="Planning"        value={data.planning}     sub="Entrées planning" />
          <StatCard label="Notes qualité"   value={data.notes}        sub="Évaluations" />
        </div>
      )}
    </>
  );
}
