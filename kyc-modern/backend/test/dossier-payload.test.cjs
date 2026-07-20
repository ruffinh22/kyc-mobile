const test = require('node:test');
const assert = require('node:assert/strict');

const { buildDossierCreatePayload } = require('../dist/utils/dossierPayload.js');

test('buildDossierCreatePayload keeps the acquisition fields for storage', () => {
  const payload = buildDossierCreatePayload({
    id: 'KYC123',
    numero_mtn: '0700000000',
    country: 'CG',
    wa_agent: '12345678',
    nom_titulaire: 'MABIKA',
    prenom_titulaire: 'Jean',
    date_naissance: '01/01/1990',
    lieu_naissance: 'Brazzaville',
    autre_numero: '0567891234',
    nom_pere: 'MABIKA Paul',
    nom_mere: 'MABIKA Marie',
    adresse_complete: 'Brazzaville, Rue 1',
    numero_cni: '123456789',
    sexe: 'M',
    nationalite: 'Congolaise',
    profession: 'Commerçant',
    date: '2026-07-20',
    heure_reception: '10:00',
  });

  assert.equal(payload.country, 'CG');
  assert.equal(payload.nom_titulaire, 'MABIKA');
  assert.equal(payload.autre_numero, '0567891234');
  assert.equal(payload.profession, 'Commerçant');
  assert.equal(payload.numero_cni, '123456789');
  assert.equal(payload.nationalite, 'Congolaise');
});
