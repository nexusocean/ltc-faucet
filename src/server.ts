import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import type { Faucet } from './faucet.js';
import { views } from './views.js';

export interface ServerOptions {
  amount: number;
  cooldownHours: number;
  trustProxy: boolean;
  returnAddress?: string;
  donationAddress?: string;
  publicUrl?: string;
  electrumServer?: string;
  logger?: FastifyServerOptions['logger'];
}

const claimSchema = {
  body: {
    type: 'object',
    required: ['address'],
    additionalProperties: false,
    properties: {
      // Litecoin addresses are base58 or bech32: alphanumeric, 26–90 chars.
      address: { type: 'string', pattern: '^\\s*[a-zA-Z0-9]{26,90}\\s*$' },
    },
  },
} as const;

export function buildServer(faucet: Faucet, opts: ServerOptions): FastifyInstance {
  const app = Fastify({ logger: opts.logger ?? true, trustProxy: opts.trustProxy });

  app.get('/', async (_req, reply) => {
    reply.type('text/html; charset=utf-8');
    return views.render('index.njk', {
      amount: opts.amount,
      cooldownHours: opts.cooldownHours,
      returnAddress: opts.returnAddress ?? null,
      donationAddress: opts.donationAddress ?? null,
      publicUrl: opts.publicUrl ?? null,
      electrumServer: opts.electrumServer ?? null,
    });
  });

  app.get('/info', async () => ({
    amount: opts.amount,
    cooldownHours: opts.cooldownHours,
    balance: await faucet.balance(),
    returnAddress: opts.returnAddress ?? null,
    donationAddress: opts.donationAddress ?? null,
    electrumServer: opts.electrumServer ?? null,
  }));

  app.post<{ Body: { address: string } }>(
    '/claim',
    { schema: claimSchema },
    async (req, reply) => {
      const result = await faucet.claim(req.body.address, req.ip);

      switch (result.status) {
        case 'sent':
          return { txid: result.txid, amount: result.amount };
        case 'invalid-address':
          return reply.code(400).send({ error: 'Invalid testnet address' });
        case 'rate-limited': {
          const seconds = Math.max(
            0,
            Math.ceil((result.retryAt.getTime() - Date.now()) / 1000),
          );
          return reply
            .code(429)
            .header('Retry-After', String(seconds))
            .send({ error: 'Already claimed', retryAt: result.retryAt.toISOString() });
        }
        case 'empty':
          return reply.code(503).send({ error: 'Faucet is empty' });
        case 'unavailable':
          return reply.code(503).send({ error: 'Faucet is temporarily unavailable' });
      }
    },
  );

  return app;
}
