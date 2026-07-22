import assert from 'assert';
import { buildGsmPayloadFromDossier, validateGsmDossierPayload } from '../src/utils/gsmFlow';

const payload = buildGsmPayloadFromDossier('D-42', {
  numero: '',
  coach: 'Coach 1',
  type_id: 'Avec Parrainage',
  constat: 'Identite complete',
  piece: 'ACTE DE NAISSANCE',
  verbatim: 'RAS',
  action: 'Accepte',
  statut_final: 'Accepte',
}, '082000123');

assert.strictEqual(payload.dossier_id, 'D-42');
assert.strictEqual(payload.numero, '082000123');
assert.strictEqual(payload.coach, 'Coach 1');

const invalid = validateGsmDossierPayload({ dossier_id: 'D-42', numero: '123' });
assert.deepStrictEqual(invalid, ['type_id', 'constat', 'piece', 'verbatim', 'action', 'statut_final']);

console.log('gsm-flow test passed');
