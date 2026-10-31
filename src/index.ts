import { MongoClient } from 'mongodb';
import { createLitecoinRpcClient } from '@nexusocean/litecoin-rpc';
import { loadConfig } from './config.js';
import { CLAIMS_COLLECTION, createClaimStore, ensureClaimIndexes, type ClaimDoc } from './claims.js';
import { createFaucet } from './faucet.js';
import { buildServer } from './server.js';

const config = loadConfig();

const client = createLitecoinRpcClient(config.rpc);

// Refuse to hand out real coins.
const { chain } = await client.getBlockchainInfo();
if (chain === 'main') {
  throw new Error('Node is on mainnet; the faucet only runs on test or regtest');
}

const rpc = config.wallet !== undefined ? client.wallet(config.wallet) : client;

if (config.returnAddress !== undefined) {
  const { isvalid } = await rpc.validateAddress(config.returnAddress);
  if (!isvalid) {
    throw new Error(`RETURN_ADDRESS is not a valid ${chain} address`);
  }
}

const mongo = new MongoClient(config.mongo.uri);
await mongo.connect();
const db = mongo.db(config.mongo.db);
await ensureClaimIndexes(db, config.cooldownHours);

const app = buildServer(
  createFaucet({
    rpc,
    store: createClaimStore(db.collection<ClaimDoc>(CLAIMS_COLLECTION), config.cooldownHours),
    amount: config.amount,
    log: { error: (obj, msg) => app.log.error(obj, msg) },
  }),
  {
    amount: config.amount,
    cooldownHours: config.cooldownHours,
    trustProxy: config.trustProxy,
    returnAddress: config.returnAddress,
    donationAddress: config.donationAddress,
    publicUrl: config.publicUrl,
    electrumServer: config.electrumServer,
  },
);

app.addHook('onClose', () => mongo.close());

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.once(signal, () => void app.close());
}

await app.listen({ port: config.port, host: config.host });
app.log.info(`faucet on ${chain}, sending ${config.amount} per claim`);

if (config.returnAddress !== undefined) {
  const { ismine } = await rpc.getAddressInfo(config.returnAddress);
  if (!ismine) {
    app.log.warn('RETURN_ADDRESS is not in the faucet wallet; returned coins will not refill the faucet');
  }
}
