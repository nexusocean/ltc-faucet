import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MongoServerError, ObjectId, type Collection, type Db } from 'mongodb';
import { createClaimStore, ensureClaimIndexes, type ClaimDoc } from '../src/claims.js';

// In-memory stand-in for the claims collection, enforcing the unique ip/address indexes.
function fakeCollection() {
  const docs: ClaimDoc[] = [];
  const dupError = () => new MongoServerError({ message: 'E11000 duplicate key', code: 11000 });

  const collection = {
    docs,
    async insertOne(doc: ClaimDoc) {
      if (docs.some((d) => d.ip === doc.ip || d.address === doc.address)) throw dupError();
      const _id = new ObjectId();
      docs.push({ ...doc, _id });
      return { insertedId: _id };
    },
    find(filter: { $or: [{ ip: string }, { address: string }] }) {
      const [{ ip }, { address }] = filter.$or;
      const matches = docs
        .filter((d) => d.ip === ip || d.address === address)
        .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      const cursor = {
        sort: () => cursor,
        limit: () => cursor,
        next: async () => matches[0] ?? null,
      };
      return cursor;
    },
    async updateOne(filter: { _id: ObjectId }, update: { $set: { txid: string } }) {
      const doc = docs.find((d) => d._id?.equals(filter._id));
      if (doc) Object.assign(doc, update.$set);
    },
    async deleteOne(filter: { _id: ObjectId }) {
      const i = docs.findIndex((d) => d._id?.equals(filter._id));
      if (i >= 0) docs.splice(i, 1);
    },
  };
  return collection;
}

const T0 = new Date('2026-10-30T12:00:00Z');

function setup() {
  const collection = fakeCollection();
  const store = createClaimStore(
    collection as unknown as Collection<ClaimDoc>,
    24,
    () => T0,
  );
  return { collection, store };
}

test('first claim is reserved', async () => {
  const { store, collection } = setup();
  const res = await store.reserve('1.1.1.1', 'tltc1aaa');
  assert.equal(res.ok, true);
  assert.equal(collection.docs.length, 1);
});

test('same IP is rate-limited until the cooldown ends', async () => {
  const { store } = setup();
  await store.reserve('1.1.1.1', 'tltc1aaa');
  const res = await store.reserve('1.1.1.1', 'tltc1bbb');
  assert.deepEqual(res, { ok: false, retryAt: new Date('2026-10-31T12:00:00Z') });
});

test('same address from another IP is rate-limited', async () => {
  const { store } = setup();
  await store.reserve('1.1.1.1', 'tltc1aaa');
  const res = await store.reserve('2.2.2.2', 'tltc1aaa');
  assert.equal(res.ok, false);
});

test('release frees the IP and address', async () => {
  const { store } = setup();
  const first = await store.reserve('1.1.1.1', 'tltc1aaa');
  assert.ok(first.ok);
  await store.release(first.id);
  const again = await store.reserve('1.1.1.1', 'tltc1aaa');
  assert.equal(again.ok, true);
});

test('complete records the txid', async () => {
  const { store, collection } = setup();
  const res = await store.reserve('1.1.1.1', 'tltc1aaa');
  assert.ok(res.ok);
  await store.complete(res.id, 'abc123');
  assert.equal(collection.docs[0]?.txid, 'abc123');
});

test('non-duplicate insert errors propagate', async () => {
  const collection = {
    insertOne: async () => {
      throw new Error('network down');
    },
  };
  const store = createClaimStore(collection as unknown as Collection<ClaimDoc>, 24);
  await assert.rejects(store.reserve('1.1.1.1', 'tltc1aaa'), /network down/);
});

test('ensureClaimIndexes creates TTL and unique indexes', async () => {
  const created: [object, object][] = [];
  const db = {
    collection: () => ({
      createIndex: async (keys: object, opts: object) => {
        created.push([keys, opts]);
      },
    }),
    command: async () => assert.fail('collMod should not run'),
  };
  await ensureClaimIndexes(db as unknown as Db, 24);
  assert.deepEqual(created, [
    [{ createdAt: 1 }, { expireAfterSeconds: 86400 }],
    [{ ip: 1 }, { unique: true }],
    [{ address: 1 }, { unique: true }],
  ]);
});

test('ensureClaimIndexes updates the TTL when the cooldown changed', async () => {
  const commands: object[] = [];
  let first = true;
  const db = {
    collection: () => ({
      createIndex: async () => {
        if (first) {
          first = false;
          throw new MongoServerError({ message: 'IndexOptionsConflict', code: 85 });
        }
      },
    }),
    command: async (cmd: object) => {
      commands.push(cmd);
    },
  };
  await ensureClaimIndexes(db as unknown as Db, 12);
  assert.deepEqual(commands, [
    {
      collMod: 'claims',
      index: { keyPattern: { createdAt: 1 }, expireAfterSeconds: 43200 },
    },
  ]);
});
