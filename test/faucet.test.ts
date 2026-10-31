import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ObjectId } from 'mongodb';
import { RpcCallError } from '@nexusocean/litecoin-rpc';
import { createFaucet, type FaucetRpc } from '../src/faucet.js';
import type { ClaimStore, ReserveResult } from '../src/claims.js';

const silent = { error: () => {} };

function setup(overrides: {
  isvalid?: boolean;
  reserve?: ReserveResult;
  send?: () => Promise<string>;
} = {}) {
  const id = new ObjectId();
  const calls = { sent: [] as [string, number][], released: 0, completed: [] as string[] };

  const rpc = {
    validateAddress: async () => ({ isvalid: overrides.isvalid ?? true }),
    sendToAddress: async (address: string, amount: number) => {
      calls.sent.push([address, amount]);
      return overrides.send ? overrides.send() : 'txid1';
    },
    getBalance: async () => 5,
  } as unknown as FaucetRpc;

  const store: ClaimStore = {
    reserve: async () => overrides.reserve ?? { ok: true, id },
    complete: async (_id, txid) => {
      calls.completed.push(txid);
    },
    release: async () => {
      calls.released++;
    },
  };

  const faucet = createFaucet({ rpc, store, amount: 0.1, log: silent });
  return { faucet, calls };
}

test('sends to a valid address and records the txid', async () => {
  const { faucet, calls } = setup();
  const res = await faucet.claim('  tltc1aaa  ', '1.1.1.1');
  assert.deepEqual(res, { status: 'sent', txid: 'txid1', amount: 0.1 });
  assert.deepEqual(calls.sent, [['tltc1aaa', 0.1]]);
  assert.deepEqual(calls.completed, ['txid1']);
});

test('rejects an invalid address without reserving or sending', async () => {
  const { faucet, calls } = setup({ isvalid: false });
  const res = await faucet.claim('nope', '1.1.1.1');
  assert.deepEqual(res, { status: 'invalid-address' });
  assert.equal(calls.sent.length, 0);
});

test('rejects legacy testnet addresses even if the node accepts them', async () => {
  const { faucet, calls } = setup();
  for (const address of ['mipcBbFg9gMiCh81Kj8tqqdgoZub1ZJRfn', 'QNcdLVw8fHkixm6NNyN6nVwxKek4u7qrioRR']) {
    assert.deepEqual(await faucet.claim(address, '1.1.1.1'), { status: 'invalid-address' });
  }
  assert.equal(calls.sent.length, 0);
});

test('returns rate-limited without sending', async () => {
  const retryAt = new Date('2026-10-31T12:00:00Z');
  const { faucet, calls } = setup({ reserve: { ok: false, retryAt } });
  const res = await faucet.claim('tltc1aaa', '1.1.1.1');
  assert.deepEqual(res, { status: 'rate-limited', retryAt });
  assert.equal(calls.sent.length, 0);
});

test('reports empty and releases the claim on insufficient funds', async () => {
  const { faucet, calls } = setup({
    send: async () => {
      throw new RpcCallError('Insufficient funds', -6, 500);
    },
  });
  const res = await faucet.claim('tltc1aaa', '1.1.1.1');
  assert.deepEqual(res, { status: 'empty' });
  assert.equal(calls.released, 1);
});

test('releases the claim on other node errors', async () => {
  const { faucet, calls } = setup({
    send: async () => {
      throw new RpcCallError('Wallet is locked', -13, 500);
    },
  });
  const res = await faucet.claim('tltc1aaa', '1.1.1.1');
  assert.deepEqual(res, { status: 'unavailable' });
  assert.equal(calls.released, 1);
});

test('keeps the claim when the send outcome is unknown', async () => {
  const { faucet, calls } = setup({
    send: async () => {
      throw new RpcCallError('RPC request failed: timeout of 30000ms exceeded', -1);
    },
  });
  const res = await faucet.claim('tltc1aaa', '1.1.1.1');
  assert.deepEqual(res, { status: 'unavailable' });
  assert.equal(calls.released, 0);
});
