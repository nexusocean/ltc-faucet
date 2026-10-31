import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadConfig } from '../src/config.js';

const base = { LTC_USER: 'u', LTC_PASS: 'p', MONGO_URI: 'mongodb://stub' };

test('donation and return addresses are optional', () => {
  const config = loadConfig({ ...base, DONATION_ADDRESS: '  ', RETURN_ADDRESS: '' });
  assert.equal(config.donationAddress, undefined);
  assert.equal(config.returnAddress, undefined);
});

test('accepts a valid mainnet donation address', () => {
  const config = loadConfig({
    ...base,
    DONATION_ADDRESS: ' ltc1q3cr95mcdzvyecq7w9n9ac2h05d2x8kpjfyqqph ',
  });
  assert.equal(config.donationAddress, 'ltc1q3cr95mcdzvyecq7w9n9ac2h05d2x8kpjfyqqph');
});

test('refuses to start with a mistyped donation address', () => {
  assert.throws(
    () => loadConfig({ ...base, DONATION_ADDRESS: 'ltc1q3cr95mcdzvyecq7w9n9ac2h05d2x8kpjfyqqpj' }),
    /DONATION_ADDRESS is not a valid Litecoin mainnet address/,
  );
});

test('refuses a testnet address as the donation address', () => {
  assert.throws(
    () => loadConfig({ ...base, DONATION_ADDRESS: 'tltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9' }),
    /DONATION_ADDRESS/,
  );
});

test('Electrum server is optional', () => {
  assert.equal(loadConfig({ ...base, ELECTRUM_SERVER: ' ' }).electrumServer, undefined);
});

test('accepts an Electrum server with or without a protocol suffix', () => {
  for (const server of [
    'electrum-ltc.nexusocean.org:51002',
    'electrum-ltc.nexusocean.org:51002:s',
    'example.org:51001:t',
  ]) {
    assert.equal(loadConfig({ ...base, ELECTRUM_SERVER: ` ${server} ` }).electrumServer, server);
  }
});

test('refuses a malformed Electrum server', () => {
  for (const bad of [
    'electrum-ltc.nexusocean.org/:51002',
    'electrum-ltc.nexusocean.org',
    'example.org:70000:s',
    'example.org:51002:x',
    'https://example.org:51002',
  ]) {
    assert.throws(() => loadConfig({ ...base, ELECTRUM_SERVER: bad }), /ELECTRUM_SERVER/, bad);
  }
});
