import { useEffect, useState } from 'react';
import { Modal, Alert, LoadingCenter, ConfirmModal } from '../../components/ui';
import { getAdminFields, createAdminField } from '../../services/api';
import { z } from 'zod';

export default function FieldsManager() {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [fields, setFields] = useState<any[]>([]);
  const [showCreate, setShowCreate] = useState(false);
  const [creating, setCreating] = useState(false);

  useEffect(() => { fetchFields(); }, []);

  async function fetchFields() {
    setLoading(true); setError(null);
    try {
      const d = await getAdminFields();
      if (d.success) setFields(d.fields || []);
      else setError('Échec récupération');
    } catch (err) { setError(err instanceof Error ? err.message : 'Erreur'); }
    setLoading(false);
  }

  async function doAction(name: string, action: 'hide' | 'schedule_drop' | 'drop_now') {
    if (!confirm(`Confirmer ${action} pour ${name} ?`)) return;
    try {
      const res = await (await import('../../services/api')).adminFieldAction(name, action);
      if (res.success) {
        alert('Action réussie');
        await fetchFields();
      } else {
        alert('Échec action');
      }
    } catch (err) { alert(err instanceof Error ? err.message : 'Erreur'); }
  }

  async function onCreate(form: Record<string, any>) {
    setCreating(true);
    try {
      const res = await createAdminField(form);
      if (res.success) {
        setShowCreate(false);
        await fetchFields();
      } else {
        alert(res.error || 'Échec création');
      }
    } catch (err) { alert(err instanceof Error ? err.message : 'Erreur'); }
    setCreating(false);
  }

  return (
    <div className="card">
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <p className="card-title">Champs dynamiques</p>
        <div>
          <button className="btn btn-ghost" onClick={() => fetchFields()} disabled={loading}>↻</button>
          <button className="btn btn-primary" onClick={() => setShowCreate(true)}>Créer un champ</button>
        </div>
      </div>
      {error && <Alert kind="error">{error}</Alert>}
      {loading ? <LoadingCenter /> : (
        <div style={{ marginTop: '.5rem' }}>
          {fields.length === 0 ? <div>Aucun champ</div> : (
            <table className="table">
              <thead><tr><th>Nom</th><th>Libellé</th><th>Type</th><th>Table</th><th>Statut</th><th>Actions</th></tr></thead>
                <tbody>
                  {fields.map(f => (
                    <tr key={f.id}>
                      <td>{f.name}</td>
                      <td>{f.label}</td>
                      <td>{f.type}</td>
                      <td>{f.target_table}</td>
                      <td>{f.status}</td>
                      <td>
                        <button className="btn btn-ghost btn-sm" onClick={() => doAction(f.name, 'hide')}>Masquer</button>
                        <button className="btn btn-ghost btn-sm" onClick={() => doAction(f.name, 'schedule_drop')}>Planifier suppression</button>
                        <button className="btn btn-danger btn-sm" onClick={() => doAction(f.name, 'drop_now')}>Supprimer maintenant</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
            </table>
          )}
        </div>
      )}

      {showCreate && (
        <Modal title="Créer un champ dynamique" onClose={() => setShowCreate(false)} footer={null}>
          <CreateFieldForm onCancel={() => setShowCreate(false)} onCreate={onCreate} loading={creating} />
        </Modal>
      )}
    </div>
  );
}

function CreateFieldForm({ onCreate, onCancel, loading }: { onCreate(form: Record<string, any>): Promise<void>; onCancel(): void; loading: boolean; }) {
  const [name, setName] = useState('');
  const [label, setLabel] = useState('');
  const [type, setType] = useState('VARCHAR');
  const [length, setLength] = useState<number | ''>('' as any);
  const [nullable, setNullable] = useState(true);
  const [targetTable, setTargetTable] = useState('dossiers');

  const schema = z.object({
    name: z.string().min(2).regex(/^[a-z][a-z0-9_]{1,63}$/),
    label: z.string().min(1),
    type: z.enum(['VARCHAR','TEXT','INT','DECIMAL','DATE','DATETIME']),
    length: z.number().int().positive().optional(),
    nullable: z.boolean(),
    targetTable: z.string().min(1),
  });

  function previewSql() {
    const len = type === 'VARCHAR' ? (length || 255) : undefined;
    const t = type === 'BOOLEAN' ? 'TINYINT(1)' : type === 'VARCHAR' ? `VARCHAR(${len})` : type;
    const nullSql = nullable ? 'NULL' : 'NOT NULL';
    return `ALTER TABLE \`${targetTable}\` ADD COLUMN \`${name}\` ${t} ${nullSql};`;
  }

  return (
    <div>
      <div style={{ display: 'grid', gap: '.5rem' }}>
        <div className="field"><label>Nom (snake_case)</label><input value={name} onChange={e => setName(e.target.value)} /></div>
        <div className="field"><label>Libellé</label><input value={label} onChange={e => setLabel(e.target.value)} /></div>
        <div className="field"><label>Type</label>
          <select value={type} onChange={e => setType(e.target.value)}>
            <option value="VARCHAR">VARCHAR</option>
            <option value="TEXT">TEXT</option>
            <option value="INT">INT</option>
            <option value="DECIMAL">DECIMAL</option>
            <option value="DATE">DATE</option>
            <option value="DATETIME">DATETIME</option>
          </select>
        </div>
        {type === 'VARCHAR' && <div className="field"><label>Longueur</label><input type="number" min={1} max={255} value={length as any} onChange={e => setLength(e.target.value === '' ? '' : parseInt(e.target.value, 10))} /></div>}
        <div className="field"><label>Nullable</label><select value={nullable ? '1' : '0'} onChange={e => setNullable(e.target.value === '1')}><option value="1">Oui</option><option value="0">Non</option></select></div>
        <div className="field"><label>Table cible</label><input value={targetTable} onChange={e => setTargetTable(e.target.value)} /></div>
      </div>
      <div style={{ marginTop: '.5rem' }}>
        <div style={{ fontSize: 13, color: 'var(--ink-4)', marginBottom: '.5rem' }}>Prévisualisation SQL</div>
        <pre style={{ background: 'var(--surface-2)', padding: '.5rem', borderRadius: 6 }}>{previewSql()}</pre>
      </div>

      <div style={{ marginTop: '.75rem', display: 'flex', gap: '.5rem', justifyContent: 'flex-end' }}>
        <button className="btn btn-ghost" onClick={onCancel} disabled={loading}>Annuler</button>
        <button className="btn btn-primary" onClick={() => {
          const data = { name, label, type, length: length === '' ? undefined : length, nullable, targetTable };
          const parsed = schema.safeParse(data);
          if (!parsed.success) {
            alert(parsed.error.issues.map((i: any) => `${i.path.join('.')}: ${i.message}`).join('\n'));
            return;
          }
          onCreate(parsed.data as any);
        }} disabled={loading}>{loading ? 'Création…' : 'Créer'}</button>
      </div>
    </div>
  );
}
