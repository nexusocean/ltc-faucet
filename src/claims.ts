import { MongoServerError, type Collection, type Db, type ObjectId } from 'mongodb';

export interface ClaimDoc {
  _id?: ObjectId;
  ip: string;
  address: string;
  createdAt: Date;
  txid?: string;
}

export type ReserveResult =
  | { ok: true; id: ObjectId }
  | { ok: false; retryAt: Date };

export interface ClaimStore {
  /** Atomically records a claim, or reports when the IP/address may claim again. */
  reserve(ip: string, address: string): Promise<ReserveResult>;
  complete(id: ObjectId, txid: string): Promise<void>;
  /** Drops a reservation whose send failed, so the user can retry. */
  release(id: ObjectId): Promise<void>;
}

const DUPLICATE_KEY = 11000;
const INDEX_OPTIONS_CONFLICT = 85;

export const CLAIMS_COLLECTION = 'claims';

/**
 * One claim per IP and per address: unique indexes reject a second claim, and
 * the TTL index deletes the claim once the cooldown passes (MongoDB's TTL
 * monitor runs about once a minute, so expiry can lag by up to ~60s).
 */
export async function ensureClaimIndexes(db: Db, cooldownHours: number): Promise<void> {
  const claims = db.collection<ClaimDoc>(CLAIMS_COLLECTION);
  const expireAfterSeconds = Math.round(cooldownHours * 3600);

  try {
    await claims.createIndex({ createdAt: 1 }, { expireAfterSeconds });
  } catch (err) {
    // The TTL index exists with a different cooldown: update it in place.
    if (!(err instanceof MongoServerError && err.code === INDEX_OPTIONS_CONFLICT)) throw err;
    await db.command({
      collMod: CLAIMS_COLLECTION,
      index: { keyPattern: { createdAt: 1 }, expireAfterSeconds },
    });
  }

  await claims.createIndex({ ip: 1 }, { unique: true });
  await claims.createIndex({ address: 1 }, { unique: true });
}

export function createClaimStore(
  claims: Collection<ClaimDoc>,
  cooldownHours: number,
  now: () => Date = () => new Date(),
): ClaimStore {
  const cooldownMs = cooldownHours * 3600 * 1000;

  return {
    async reserve(ip, address) {
      try {
        const { insertedId } = await claims.insertOne({ ip, address, createdAt: now() });
        return { ok: true, id: insertedId };
      } catch (err) {
        if (!(err instanceof MongoServerError && err.code === DUPLICATE_KEY)) throw err;
      }

      const existing = await claims
        .find({ $or: [{ ip }, { address }] })
        .sort({ createdAt: -1 })
        .limit(1)
        .next();
      // Absent only if the blocking claim expired in the meantime.
      const retryAt = existing
        ? new Date(existing.createdAt.getTime() + cooldownMs)
        : now();
      return { ok: false, retryAt };
    },

    async complete(id, txid) {
      await claims.updateOne({ _id: id }, { $set: { txid } });
    },

    async release(id) {
      await claims.deleteOne({ _id: id });
    },
  };
}
