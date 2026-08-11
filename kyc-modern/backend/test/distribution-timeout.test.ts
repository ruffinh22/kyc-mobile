import test from 'node:test';
import assert from 'node:assert/strict';
import { shouldRequeueDossier } from '../src/db/distribution';

test('requeues dossiers whose assignment exceeded the timeout', () => {
  assert.equal(shouldRequeueDossier(1000, 2000, 120), true);
});

test('keeps recently assigned dossiers in progress', () => {
  assert.equal(shouldRequeueDossier(1900, 2000, 120), false);
});
