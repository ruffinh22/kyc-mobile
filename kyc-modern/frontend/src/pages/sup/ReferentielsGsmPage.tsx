import { useState, type FormEvent } from 'react';
import { useFetch } from '../../hooks';
import { apiFetch } from '../../services/api';
import { Alert, EmptyState, LoadingCenter } from '../../components/ui';

// Champs gérés ici. `piece` reprend volontairement les mêmes types de pièce
// que l'agent terrain choisit déjà à l'acquisition (CNI, CEDEAO, PASSPORT,
// CIP, PERMIS, AUTRE — voir OFFICIAL_DOC_TYPES côté backend) : ce n'est PAS
// une liste indépendante, donc on l'affiche mais avec un rappel explicite.
const FIELDS: { key: string; label: string; hint?: string }[] = [
  { key: 'type_id',      label: 'Type ID' },
  { key: 'piece',         label: 'Pièce', hint: 'Doit rester aligné avec les types de pièce choisis par l’agent terrain à l’acquisition (CNI, CEDEAO, Passeport, CIP, Permis, Autre).' },
  { key: 'constat',       label: 'Constat' },
  { key: 'verbatim',      label: 'Verbatim' },
  { key: 'action',        label: 'Action' },
  { key: 'statut_final',  label: 'Statut final' },
  { key: 'traitement',    label: 'Traitement' },
  { key: 'raison',        label: 'Raison' },
];

export function SupReferentielsGsm() {
  const { data, loading, error, refetch } = useFetch(
    () => apiFetch<{ success: boolean; referentiels: Record<string, string[]> }>('/api/gsm/referentiels'),
    []
  );
  const [active, setActive] = useState(FIELDS[0].key);
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const refs = data?.referentiels ?? {};
  const values = refs[active] ?? [];
  const activeField = FIELDS.find(f => f.key === active)!;

  const addValue = async (e: FormEvent) => {
    e.preventDefault();
    const v = newValue.trim();
    if (!v) return;
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/gsm/referentiels/${encodeURIComponent(active)}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ value: v }),
      });
      setNewValue('');
      refetch();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Erreur lors de l’ajout'); }
    finally { setBusy(false); }
  };

  const removeValue = async (v: string) => {
    setBusy(true); setErr(null);
    try {
      await apiFetch(`/api/gsm/referentiels/${encodeURIComponent(active)}/${encodeURIComponent(v)}`, { method: 'DELETE' });
      refetch();
    } catch (e2) { setErr(e2 instanceof Error ? e2.message : 'Erreur lors de la suppression'); }
    finally { setBusy(false); }
  };

  return (
    <>
      <div className="page-header">
        <div>
          <h1 className="page-title">Référentiels GSM</h1>
          <p className="page-sub">Valeurs disponibles dans les listes déroulantes de la saisie GSM — ajoutez-en autant que nécessaire.</p>
        </div>
        <button className="btn btn-ghost btn-sm" onClick={refetch}>↻</button>
      </div>

      {error && <Alert kind="error">{error}</Alert>}
      {err && <Alert kind="error">{err}</Alert>}

      {loading ? <LoadingCenter /> : (
        <div className="card" style={{ display: 'flex', gap: '1.5rem', flexWrap: 'wrap' }}>
          <div style={{ minWidth: 200, display: 'flex', flexDirection: 'column', gap: '.35rem' }}>
            {FIELDS.map(f => (
              <button
                key={f.key}
                type="button"
                className={`btn btn-sm ${active === f.key ? 'btn-primary' : 'btn-ghost'}`}
                style={{ justifyContent: 'flex-start' }}
                onClick={() => setActive(f.key)}
              >
                {f.label}
                <span style={{ marginLeft: 'auto', opacity: .7, fontSize: 12 }}>{(refs[f.key] ?? []).length}</span>
              </button>
            ))}
          </div>

          <div style={{ flex: 1, minWidth: 280 }}>
            <h3 style={{ margin: '0 0 .25rem' }}>{activeField.label}</h3>
            {activeField.hint && (
              <p style={{ fontSize: 12.5, color: 'var(--ink-4)', margin: '0 0 .75rem' }}>{activeField.hint}</p>
            )}

            <form onSubmit={addValue} className="form-row" style={{ marginBottom: '1rem' }}>
              <div className="field" style={{ flex: 1 }}>
                <label>Nouvelle valeur</label>
                <input value={newValue} onChange={e => setNewValue(e.target.value)} placeholder={`Ajouter à « ${activeField.label} »`} />
              </div>
              <button type="submit" className="btn btn-primary btn-sm" disabled={busy || !newValue.trim()} style={{ alignSelf: 'flex-end' }}>
                + Ajouter
              </button>
            </form>

            {!values.length ? (
              <EmptyState icon="🗂️" title="Aucune valeur" body="Ajoutez la première valeur ci-dessus." />
            ) : (
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
                {values.map(v => (
                  <span
                    key={v}
                    style={{
                      display: 'inline-flex', alignItems: 'center', gap: 8, fontSize: 13, fontWeight: 600,
                      padding: '.4rem .5rem .4rem .75rem', borderRadius: 999,
                      background: 'var(--surface-2)', border: '1px solid var(--surface-4)',
                    }}
                  >
                    {v}
                    <button
                      type="button" disabled={busy} onClick={() => removeValue(v)}
                      title={`Retirer « ${v} »`}
                      style={{ border: 'none', background: 'transparent', color: 'var(--danger)', cursor: 'pointer', fontWeight: 700, lineHeight: 1, padding: 0 }}
                    >
                      ✕
                    </button>
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
