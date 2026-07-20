export type DossierCreateInput = {
  id: string;
  numero_mtn: string;
  country?: string | null;
  wa_agent?: string | null;
  username_agent?: string | null;
  fonction_agent?: string | null;
  zone_agent?: string | null;
  date: string;
  heure_reception: string;
  nom_titulaire?: string | null;
  prenom_titulaire?: string | null;
  date_naissance?: string | null;
  lieu_naissance?: string | null;
  autre_numero?: string | null;
  nom_pere?: string | null;
  nom_mere?: string | null;
  adresse_complete?: string | null;
  numero_cni?: string | null;
  sexe?: string | null;
  nationalite?: string | null;
  profession?: string | null;
  ocr_overrides?: string | null;
  flow_step?: number | null;
  acquisition_status?: string | null;
};

export function buildDossierCreatePayload(input: DossierCreateInput) {
  return {
    id: input.id,
    numero_mtn: input.numero_mtn,
    country: input.country ?? null,
    wa_agent: input.wa_agent ?? null,
    username_agent: input.username_agent ?? null,
    fonction_agent: input.fonction_agent ?? null,
    zone_agent: input.zone_agent ?? null,
    date: input.date,
    heure_reception: input.heure_reception,
    nom_titulaire: input.nom_titulaire ?? null,
    prenom_titulaire: input.prenom_titulaire ?? null,
    date_naissance: input.date_naissance ?? null,
    lieu_naissance: input.lieu_naissance ?? null,
    autre_numero: input.autre_numero ?? null,
    nom_pere: input.nom_pere ?? null,
    nom_mere: input.nom_mere ?? null,
    adresse_complete: input.adresse_complete ?? null,
    numero_cni: input.numero_cni ?? null,
    sexe: input.sexe ?? null,
    nationalite: input.nationalite ?? null,
    profession: input.profession ?? null,
    ocr_overrides: input.ocr_overrides ?? null,
    flow_step: input.flow_step ?? 4,
    acquisition_status: input.acquisition_status ?? 'submitted',
  };
}
