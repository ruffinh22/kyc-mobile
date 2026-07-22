export interface GsmDossierPayload {
  dossier_id: string;
  numero: string;
  coach?: string;
  nom_client?: string;
  type_id?: string;
  constat?: string;
  piece?: string;
  verbatim?: string;
  action?: string;
  statut_final?: string;
  traitement?: string;
  raison?: string;
  observations?: string;
}

export function buildGsmPayloadFromDossier(
  dossierId: string,
  form: Partial<GsmDossierPayload>,
  defaultNumero?: string
): GsmDossierPayload {
  return {
    dossier_id: dossierId,
    numero: (form.numero || defaultNumero || '').trim(),
    coach: form.coach || '',
    nom_client: form.nom_client || '',
    type_id: form.type_id || '',
    constat: form.constat || '',
    piece: form.piece || '',
    verbatim: form.verbatim || '',
    action: form.action || '',
    statut_final: form.statut_final || '',
    traitement: form.traitement || '',
    observations: form.observations || '',
  };
}

export function validateGsmDossierPayload(payload: Partial<GsmDossierPayload>): string[] {
  const missing: string[] = [];
  if (!payload.dossier_id) missing.push('dossier_id');
  if (!payload.numero) missing.push('numero');
  if (!payload.type_id) missing.push('type_id');
  if (!payload.constat) missing.push('constat');
  if (!payload.piece) missing.push('piece');
  if (!payload.verbatim) missing.push('verbatim');
  if (!payload.action) missing.push('action');
  if (!payload.statut_final) missing.push('statut_final');
  return missing;
}

export function buildGsmExportEntry(gsm: {
  id: number | string;
  numero: string;
  date_saisie: string;
  capture_a?: string | null;
  capture_p?: string | null;
  capture_aa?: string | null;
}) {
  return {
    id: gsm.id,
    numero: gsm.numero,
    date_saisie: gsm.date_saisie,
    captures: [
      gsm.capture_a ? { field: 'capture_a', filename: gsm.capture_a, url: `/api/gsm/captures/${encodeURIComponent(gsm.capture_a)}` } : null,
      gsm.capture_p ? { field: 'capture_p', filename: gsm.capture_p, url: `/api/gsm/captures/${encodeURIComponent(gsm.capture_p)}` } : null,
      gsm.capture_aa ? { field: 'capture_aa', filename: gsm.capture_aa, url: `/api/gsm/captures/${encodeURIComponent(gsm.capture_aa)}` } : null,
    ].filter(Boolean),
  };
}
