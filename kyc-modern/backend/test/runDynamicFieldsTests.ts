import assert from 'assert';
import { validateFieldInput, computeChecksum, columnTypeSql } from '../src/db/dynamicFields';

function shouldThrow(fn: () => void, name: string) {
  try {
    fn();
    console.error('FAIL: expected throw for', name);
    process.exitCode = 2;
  } catch (err) {
    console.log('ok (throws):', name);
  }
}

function shouldNotThrow(fn: () => void, name: string) {
  try {
    fn();
    console.log('ok:', name);
  } catch (err) {
    console.error('FAIL: unexpected throw for', name, err);
    process.exitCode = 2;
  }
}

async function run() {
  console.log('Running dynamicFields tests...');

  // validateFieldInput - valid
  shouldNotThrow(() => validateFieldInput({
    name: 'date_activation', label: 'Date activation', type: 'DATE', nullable: true,
  } as any), 'valid date field');

  // invalid name
  shouldThrow(() => validateFieldInput({ name: '1bad', label: 'Bad', type: 'VARCHAR', length: 10, nullable: true } as any), 'invalid name');

  // reserved name
  shouldThrow(() => validateFieldInput({ name: 'id', label: 'Id', type: 'INT', nullable: true } as any), 'reserved name');

  // missing label
  shouldThrow(() => validateFieldInput({ name: 'ok_name', label: '', type: 'VARCHAR', length: 10, nullable: true } as any), 'missing label');

  // VARCHAR length invalid
  shouldThrow(() => validateFieldInput({ name: 'big', label: 'Big', type: 'VARCHAR', length: 9999, nullable: true } as any), 'varchar length invalid');

  // DECIMAL invalid precision/scale
  shouldThrow(() => validateFieldInput({ name: 'dec', label: 'Dec', type: 'DECIMAL', length: 2, decimalScale: 5, nullable: true } as any), 'decimal scale invalid');

  // non-nullable without default
  shouldThrow(() => validateFieldInput({ name: 'must', label: 'Must', type: 'INT', nullable: false } as any), 'non-nullable without default');

  // computeChecksum deterministic
  const a = { name: 'x', type: 'VARCHAR', length: 10, decimalScale: null, nullable: true, defaultValue: null, targetTable: 'dossiers' } as any;
  const s1 = computeChecksum(a);
  const s2 = computeChecksum(a);
  assert.strictEqual(s1, s2, 'checksum deterministic');
  console.log('ok: checksum deterministic');

  // checksum changes when property changes
  const b = { ...a, length: 11 };
  const s3 = computeChecksum(b);
  assert.notStrictEqual(s1, s3, 'checksum changes on modification');
  console.log('ok: checksum change on modification');

  // columnTypeSql
  assert.strictEqual(columnTypeSql({ type: 'VARCHAR' } as any), 'VARCHAR(255)');
  assert.strictEqual(columnTypeSql({ type: 'DECIMAL', length: 10, decimalScale: 4 } as any), 'DECIMAL(10,4)');
  assert.strictEqual(columnTypeSql({ type: 'BOOLEAN' } as any), 'TINYINT(1)');
  console.log('ok: columnTypeSql outputs expected types');

  console.log('All dynamicFields tests completed.');
}

run().catch(err => {
  console.error('Test runner error', err);
  process.exitCode = 2;
});
