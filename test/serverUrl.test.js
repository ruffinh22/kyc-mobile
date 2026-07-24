const assert = require('assert');
const { normalizeServerUrl } = require('../src/utils/serverUrl');

assert.strictEqual(normalizeServerUrl('https://www.kyc.palladiumafrica.com/'), 'https://kyc.palladiumafrica.com');
assert.strictEqual(normalizeServerUrl('http://www.kyc.palladiumafrica.com/'), 'http://kyc.palladiumafrica.com');
assert.strictEqual(normalizeServerUrl('https://kyc.palladiumafrica.com/api'), 'https://kyc.palladiumafrica.com/api');
assert.strictEqual(normalizeServerUrl('https://example.com/'), 'https://example.com');

console.log('server-url normalization tests passed');
