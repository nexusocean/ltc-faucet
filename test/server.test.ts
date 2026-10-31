import { test } from 'node:test';
import assert from 'node:assert/strict';
import type { ClaimResult, Faucet } from '../src/faucet.js';
import { buildServer } from '../src/server.js';

function serverReturning(
  result: ClaimResult,
  addresses: { returnAddress?: string; donationAddress?: string; electrumServer?: string } = {},
) {
  const seen: [string, string][] = [];
  const faucet: Faucet = {
    claim: async (address, ip) => {
      seen.push([address, ip]);
      return result;
    },
    balance: async () => 5,
  };
  const app = buildServer(faucet, {
    amount: 0.1,
    cooldownHours: 24,
    trustProxy: false,
    ...addresses,
    logger: false,
  });
  return { app, seen };
}

const claim = (address: unknown) => ({
  method: 'POST' as const,
  url: '/claim',
  payload: { address },
});

const VALID = 'tltc1qw508d6qejxtdg4y5r3zarvary0c5xw7kgmn4n9';

test('POST /claim returns the txid on success', async () => {
  const { app, seen } = serverReturning({ status: 'sent', txid: 'abc', amount: 0.1 });
  const res = await app.inject(claim(VALID));
  assert.equal(res.statusCode, 200);
  assert.deepEqual(res.json(), { txid: 'abc', amount: 0.1 });
  assert.equal(seen[0]?.[0], VALID);
});

test('POST /claim rejects malformed input before reaching the faucet', async () => {
  const { app, seen } = serverReturning({ status: 'sent', txid: 'abc', amount: 0.1 });
  for (const bad of ['short', 'x'.repeat(91), 'tltc1<script>aaaaaaaaaaaaaaaaaaaaaa', 42]) {
    const res = await app.inject(claim(bad));
    assert.equal(res.statusCode, 400, `expected 400 for ${String(bad)}`);
  }
  assert.equal(seen.length, 0);
});

test('POST /claim maps invalid-address to 400', async () => {
  const { app } = serverReturning({ status: 'invalid-address' });
  const res = await app.inject(claim(VALID));
  assert.equal(res.statusCode, 400);
});

test('POST /claim maps rate-limited to 429 with Retry-After', async () => {
  const retryAt = new Date(Date.now() + 3600_000);
  const { app } = serverReturning({ status: 'rate-limited', retryAt });
  const res = await app.inject(claim(VALID));
  assert.equal(res.statusCode, 429);
  assert.equal(res.json().retryAt, retryAt.toISOString());
  const retryAfter = Number(res.headers['retry-after']);
  assert.ok(retryAfter > 3590 && retryAfter <= 3600);
});

test('POST /claim maps empty and unavailable to 503', async () => {
  for (const status of ['empty', 'unavailable'] as const) {
    const { app } = serverReturning({ status });
    const res = await app.inject(claim(VALID));
    assert.equal(res.statusCode, 503);
  }
});

test('GET /info reports amount, cooldown and balance', async () => {
  const { app } = serverReturning({ status: 'empty' });
  const res = await app.inject({ method: 'GET', url: '/info' });
  assert.deepEqual(res.json(), {
    amount: 0.1,
    cooldownHours: 24,
    balance: 5,
    returnAddress: null,
    donationAddress: null,
    electrumServer: null,
  });
});

const MAINNET = 'ltc1q3cr95mcdzvyecq7w9n9ac2h05d2x8kpjfyqqph';

test('GET /info includes the return and donation addresses when set', async () => {
  const { app } = serverReturning(
    { status: 'empty' },
    { returnAddress: VALID, donationAddress: MAINNET },
  );
  const res = await app.inject({ method: 'GET', url: '/info' });
  assert.equal(res.json().returnAddress, VALID);
  assert.equal(res.json().donationAddress, MAINNET);
});

test('GET / shows each address section only when its address is set', async () => {
  const page = async (addresses: { returnAddress?: string; donationAddress?: string }) =>
    (await serverReturning({ status: 'empty' }, addresses).app.inject({ method: 'GET', url: '/' }))
      .body;

  const none = await page({});
  assert.doesNotMatch(none, /id="return"|id="donate"/);

  const onlyReturn = await page({ returnAddress: VALID });
  assert.match(onlyReturn, /id="return"/);
  assert.doesNotMatch(onlyReturn, /id="donate"/);
  assert.match(onlyReturn, new RegExp(`<code>${VALID}</code>`));

  const onlyDonate = await page({ donationAddress: MAINNET });
  assert.match(onlyDonate, /id="donate"/);
  assert.doesNotMatch(onlyDonate, /id="return"/);
  assert.match(onlyDonate, /real Litecoin \(mainnet LTC\)/);
});

const ELECTRUM = 'electrum-ltc.nexusocean.org:51002';

test('GET /info includes the Electrum server when set', async () => {
  const { app } = serverReturning({ status: 'empty' }, { electrumServer: ELECTRUM });
  const res = await app.inject({ method: 'GET', url: '/info' });
  assert.equal(res.json().electrumServer, ELECTRUM);
});

test('GET / shows the Electrum section only when a server is set', async () => {
  const page = async (electrumServer?: string) =>
    (await serverReturning({ status: 'empty' }, { electrumServer }).app.inject({ method: 'GET', url: '/' }))
      .body;

  assert.doesNotMatch(await page(), /id="electrum"/);

  const withServer = await page(ELECTRUM);
  assert.match(withServer, /id="electrum"/);
  assert.match(withServer, new RegExp(`<code>${ELECTRUM}</code>`));
});

test('GET / escapes the addresses', async () => {
  const { app } = serverReturning({ status: 'empty' }, { returnAddress: '<script>x</script>' });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.doesNotMatch(res.body, /<script>x<\/script>/);
  assert.match(res.body, /&lt;script&gt;x&lt;\/script&gt;/);
});

test('GET / serves the claim page', async () => {
  const { app } = serverReturning({ status: 'empty' });
  const res = await app.inject({ method: 'GET', url: '/' });
  assert.equal(res.statusCode, 200);
  assert.match(res.headers['content-type'] as string, /text\/html/);
  assert.match(res.body, /Get 0\.1 tLTC/);
  assert.match(res.body, /href="https:\/\/github\.com\/nexusocean\/ltc-faucet"/);
});
