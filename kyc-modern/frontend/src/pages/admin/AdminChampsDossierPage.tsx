import { useEffect, useState } from 'react';
import * as api from '../../services/api';
import type { ChampDossier, ChampType } from '../../types';
import { Alert, LoadingCenter, ConfirmModal, Modal } from '../../components/ui';

const TYPE_LABELS: Record<ChampType, string> = {
  texte: 'Texte libre', nombre: 'Nombre', date: 'Date', liste: 'Liste déroulante', case: 'Case à cocher',
};

// Un placeholder n'a de sens que pour une saisie libre : une liste (menu
// déroulant) et une case à cocher n'ont rien à "prévisualiser" dans un champ
// vide. Garder cette liste synchronisée avec PLACEHOLDER_CAPABLE_TYPES côté
// serveur (db/customFields.ts) — le serveur l'ignore de toute façon pour les
// autres types, mais autant ne pas l'afficher inutilement ici.
const PLACEHOLDER_CAPABLE_TYPES: ChampType[] = ['texte', 'nombre', 'date'];

const PLACEHOLDER_EXAMPLES: Partial<Record<ChampType, string>> = {
  texte: 'Ex : 0123456789',
  nombre: 'Ex : 15000',
  date: 'Ex : 31/12/2026',
};

function NouveauChampModal({ onClose, onCreated }: { onClose(): void; onCreated(c: ChampDossier): void }) {
  const [label, setLabel] = useState('');
  const [type, setType] = useState<ChampType>('texte');
  const [options, setOptions] = useState('');
  const [obligatoire, setObligatoire] = useState(false);
  const [nullable, setNullable] = useState(true);
  const [placeholder, setPlaceholder] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const placeholderCapable = PLACEHOLDER_CAPABLE_TYPES.includes(type);

  async function submit() {
    setErr(null);
    if (!label.trim()) { setErr('Le libellé est obligatoire'); return; }
    const opts = options.split('\n').map(o => o.trim()).filter(Boolean);
    if (type === 'liste' && opts.length < 2) { setErr('Indiquez au moins 2 options (une par ligne)'); return; }
    setBusy(true);
    try {
      const { champ } = await api.createChampDossier({
        label: label.trim(), type, options: type === 'liste' ? opts : null, obligatoire,
        placeholder: placeholderCapable ? (placeholder.trim() || null) : null,
        nullable,
      });
      onCreated(champ);
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Impossible de créer le champ');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal title="Ajouter un champ" onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Création…' : 'Créer le champ'}</button>
      </>
    }>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="form-group">
        <label>Libellé</label>
        <input value={label} onChange={e => setLabel(e.target.value)} placeholder="Ex : Numéro de reçu" autoFocus />
      </div>
      <div className="form-group">
        <label>Type</label>
        <select value={type} onChange={e => setType(e.target.value as ChampType)}>
          {Object.entries(TYPE_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
      </div>
      {type === 'liste' && (
        <div className="form-group">
          <label>Options (une par ligne)</label>
          <textarea rows={4} value={options} onChange={e => setOptions(e.target.value)} placeholder={'Option 1\nOption 2\nOption 3'} />
        </div>
      )}
      {placeholderCapable && (
        <div className="form-group">
          <label>Texte indicatif (placeholder)</label>
          <input
            value={placeholder}
            onChange={e => setPlaceholder(e.target.value)}
            placeholder={PLACEHOLDER_EXAMPLES[type] || ''}
          />
          <div style={{ fontSize: 12, color: '#889' }}>
            Affiché en grisé dans le champ vide, sur la page agent (web et mobile). Laisser vide pour ne rien afficher.
          </div>
        </div>
      )}
      <div className="form-group">
        <label><input type="checkbox" checked={nullable} onChange={e => setNullable(e.target.checked)} />{' '}Nullable (autorise NULL en base)</label>
      </div>
      <div className="form-group">
        <label>
          <input type="checkbox" checked={obligatoire} onChange={e => setObligatoire(e.target.checked)} />
          {' '}Champ obligatoire pour l'agent
        </label>
      </div>
      <p style={{ fontSize: 13, color: 'var(--text-muted, #667)', marginTop: 8 }}>
        Ce champ apparaîtra immédiatement sur la page de l'agent terrain et lors d'une réattribution GSM.
      </p>
    </Modal>
  );
}

function EditChampModal({ champ, onClose, onUpdated }: { champ: ChampDossier; onClose(): void; onUpdated(c: ChampDossier): void }) {
  const [label, setLabel] = useState(champ.label);
  const [options, setOptions] = useState((champ.options || []).join('\n'));
  const [obligatoire, setObligatoire] = useState(!!champ.obligatoire);
  const [actif, setActif] = useState(!!champ.actif);
  const [placeholder, setPlaceholder] = useState(champ.placeholder || '');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const placeholderCapable = PLACEHOLDER_CAPABLE_TYPES.includes(champ.type);

  async function submit() {
    setErr(null);
    if (!label.trim()) { setErr('Le libellé est obligatoire'); return; }
    setBusy(true);
    try {
      let opts: string[] | undefined = undefined;
      if (champ.type === 'liste') {
        opts = options.split('\n').map(o => o.trim()).filter(Boolean);
      }
      const payload: { label: string; options?: string[] | null; obligatoire?: boolean; actif?: boolean; placeholder?: string | null } = {
        label: label.trim(),
        obligatoire,
        actif,
      };
      if (champ.type === 'liste') {
        payload.options = opts && opts.length ? opts : null;
      }
      if (placeholderCapable) {
        payload.placeholder = placeholder.trim() || null;
      }
      const { champ: updated } = await api.updateChampDossier(champ.id, payload);
      onUpdated(updated);
      onClose();
    } catch (e: any) {
      setErr(e?.message || 'Impossible de modifier le champ');
    } finally {
      setBusy(false);
    }
  }

  // Si le champ parent change (ex: on a masqué/démasqué ailleurs), resynchroniser
  useEffect(() => {
    setLabel(champ.label);
    setOptions((champ.options || []).join('\n'));
    setObligatoire(!!champ.obligatoire);
    setActif(!!champ.actif);
    setPlaceholder(champ.placeholder || '');
  }, [champ]);

  return (
    <Modal title={`Éditer le champ — ${champ.cle}`} onClose={onClose} footer={
      <>
        <button className="btn" onClick={onClose} disabled={busy}>Annuler</button>
        <button className="btn btn-primary" onClick={submit} disabled={busy}>{busy ? 'Enregistrement…' : 'Enregistrer'}</button>
      </>
    }>
      {err && <Alert kind="error">{err}</Alert>}
      <div className="form-group">
        <label>Libellé</label>
        <input value={label} onChange={e => setLabel(e.target.value)} autoFocus />
        <div style={{ fontSize: 12, color: '#889' }}>{champ.cle}</div>
      </div>
      {champ.type === 'liste' && (
        <div className="form-group">
          <label>Options (une par ligne)</label>
          <textarea rows={4} value={options} onChange={e => setOptions(e.target.value)} />
        </div>
      )}
      {placeholderCapable && (
        <div className="form-group">
          <label>Texte indicatif (placeholder)</label>
          <input
            value={placeholder}
            onChange={e => setPlaceholder(e.target.value)}
            placeholder={PLACEHOLDER_EXAMPLES[champ.type] || ''}
          />
          <div style={{ fontSize: 12, color: '#889' }}>
            Affiché en grisé dans le champ vide, sur la page agent (web et mobile). Laisser vide pour ne rien afficher.
          </div>
        </div>
      )}
      <div className="form-group">
        <label><input type="checkbox" checked={obligatoire} onChange={e => setObligatoire(e.target.checked)} />{' '}Champ obligatoire pour l'agent</label>
      </div>
      <div className="form-group">
        <label><input type="checkbox" checked={actif} onChange={e => setActif(e.target.checked)} />{' '}Actif</label>
      </div>
    </Modal>
  );
}

export default function AdminChampsDossierPage() {
  const [champs, setChamps] = useState<ChampDossier[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [toDelete, setToDelete] = useState<ChampDossier | null>(null);
  const [toToggle, setToToggle] = useState<{ champ: ChampDossier; target: boolean } | null>(null);
  const [busyId, setBusyId] = useState<number | null>(null);

  async function load() {
    setErr(null);
    try {
      const { champs: list } = await api.getChampsDossierAdmin();
      setChamps(list);
    } catch (e: any) {
      setErr(e?.message || 'Impossible de charger les champs');
    }
  }
  useEffect(() => { load(); }, []);

  async function toggle(c: ChampDossier, patch: { actif?: boolean; obligatoire?: boolean }) {
    setBusyId(c.id);
    try {
      const { champ } = await api.updateChampDossier(c.id, patch);
      setChamps(list => (list || []).map(x => x.id === champ.id ? champ : x));
    } catch (e: any) {
      setErr(e?.message || 'Modification impossible');
    } finally {
      setBusyId(null);
    }
  }

  async function confirmDelete() {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    try {
      await api.deleteChampDossier(toDelete.id);
      setChamps(list => (list || []).filter(x => x.id !== toDelete.id));
      setToDelete(null);
    } catch (e: any) {
      setErr(e?.message || 'Suppression impossible');
    } finally {
      setBusyId(null);
    }
  }

  if (!champs) return err ? <Alert kind="error">{err}</Alert> : <LoadingCenter />;

  const standards = champs.filter(c => c.standard).sort((a, b) => a.ordre - b.ordre);
  const customs = champs.filter(c => !c.standard).sort((a, b) => a.ordre - b.ordre);

  const renderRow = (c: ChampDossier) => (
    <tr key={c.id}>
      <td>
        <strong>{c.label}</strong>
        <div style={{ fontSize: 12, color: '#889' }}>{c.cle}</div>
        {c.placeholder && <div style={{ fontSize: 12, color: '#aab', fontStyle: 'italic' }}>Placeholder : « {c.placeholder} »</div>}
      </td>
      <td>{TYPE_LABELS[c.type]}</td>
      <td style={{ textAlign: 'center' }}>{c.nullable ? 'Oui' : 'Non'}</td>
      <td>
        <label className="switch">
          <input type="checkbox" checked={c.obligatoire} disabled={busyId === c.id}
            onChange={e => toggle(c, { obligatoire: e.target.checked })} /> Obligatoire
        </label>
      </td>
      <td>
        <div style={{ display: 'flex', alignItems: 'center', gap: '.5rem' }}>
          <span style={{ fontSize: 13, color: c.actif ? 'var(--success)' : 'var(--ink-3)' }}>
            {c.actif ? 'Actif' : 'Masqué'}
          </span>
          <button className="btn btn-ghost btn-sm" disabled={busyId === c.id} onClick={() => {
            const target = !c.actif;
            if (c.standard && !target) {
              setToToggle({ champ: c, target });
            } else {
              toggle(c, { actif: target });
            }
          }}>
            {c.actif ? 'Masquer' : 'Démasquer'}
          </button>
        </div>
      </td>
      <td>
        <div style={{ display: 'flex', gap: '.5rem', alignItems: 'center' }}>
          <EditButton c={c} />
          {!c.standard && (
            <button className="btn btn-danger btn-sm" disabled={busyId === c.id} onClick={() => setToDelete(c)}>
              Supprimer
            </button>
          )}
        </div>
      </td>
    </tr>
  );

  function EditButton({ c }: { c: ChampDossier }) {
    const [open, setOpen] = useState(false);
    return (
      <>
        <button className="btn btn-secondary btn-sm" onClick={() => setOpen(true)}>Éditer</button>
        {open && <EditChampModal champ={c} onClose={() => setOpen(false)} onUpdated={(u) => setChamps(list => (list || []).map(x => x.id === u.id ? u : x))} />}
      </>
    );
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
        <div>
          <h2 style={{ margin: 0 }}>Champs du dossier</h2>
          <p style={{ margin: '4px 0 0', color: '#667', fontSize: 14 }}>
            Active, désactive ou crée les champs saisis par les agents (page terrain et réattribution GSM).
            Créer ou supprimer un champ personnalisé modifie réellement la base de données.
          </p>
        </div>
        <button className="btn btn-primary" onClick={() => setShowCreate(true)}>+ Ajouter un champ</button>
      </div>

      {err && <Alert kind="error">{err}</Alert>}

      <h3>Champs standards</h3>
      <table className="table">
        <thead><tr><th>Champ</th><th>Type</th><th>Nullable</th><th>Obligatoire</th><th>Actif</th><th></th></tr></thead>
        <tbody>{standards.map(renderRow)}</tbody>
      </table>

      <h3 style={{ marginTop: 24 }}>Champs personnalisés</h3>
      {customs.length === 0 ? (
        <p style={{ color: '#889' }}>Aucun champ personnalisé pour le moment.</p>
      ) : (
        <table className="table">
          <thead><tr><th>Champ</th><th>Type</th><th>Nullable</th><th>Obligatoire</th><th>Actif</th><th></th></tr></thead>
          <tbody>{customs.map(renderRow)}</tbody>
        </table>
      )}

      {showCreate && (
        <NouveauChampModal onClose={() => setShowCreate(false)} onCreated={c => setChamps(list => [...(list || []), c])} />
      )}

      {toDelete && (
        <ConfirmModal
          title="Supprimer ce champ ?"
            message={`Le champ « ${toDelete.label} » et toutes les valeurs déjà saisies pour ce champ seront définitivement supprimés. ${toDelete.standard ? 'Ceci est un champ standard : sa suppression est irréversible et peut affecter le fonctionnement des pages d\'acquisition et des rapports.' : 'Cette action est irréversible.'}`}
          danger
          loading={busyId === toDelete.id}
          onConfirm={confirmDelete}
          onCancel={() => setToDelete(null)}
        />
      )}
      {toToggle && (
        <ConfirmModal
          title={toToggle.target ? 'Démasquer le champ ?' : 'Masquer le champ ?'}
          message={toToggle.champ.standard
            ? `Le champ standard « ${toToggle.champ.label} » sera ${toToggle.target ? 'rendu actif' : 'masqué'}. Cela affectera immédiatement la page d'acquisition et les réattributions. Confirmer ?`
            : `Confirmer la modification de l'état du champ « ${toToggle.champ.label} » ?`}
          danger={!toToggle.target}
          loading={busyId === toToggle.champ.id}
          onConfirm={async () => {
            setBusyId(toToggle.champ.id);
            try {
              await toggle(toToggle.champ, { actif: toToggle.target });
            } finally {
              setBusyId(null);
              setToToggle(null);
            }
          }}
          onCancel={() => setToToggle(null)}
        />
      )}
    </div>
  );
}