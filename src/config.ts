import { isMainnetAddress } from './ltc-address.js';

export interface Config {
  rpc: {
    host: string;
    port: number;
    user: string;
    pass: string;
    protocol: 'http' | 'https';
  };
  wallet: string | undefined;
  /** Testnet address users can send unused coins back to. */
  returnAddress: string | undefined;
  /** Real (mainnet) LTC address for supporting the faucet. */
  donationAddress: string | undefined;
  /** Public base URL of the site, used for canonical and Open Graph tags. */
  publicUrl: string | undefined;
  /** Electrum-LTC server advertised on the page, as host:port (SSL), or with a :s or :t suffix. */
  electrumServer: string | undefined;
  mongo: { uri: string; db: string };
  amount: number;
  cooldownHours: number;
  port: number;
  host: string;
  trustProxy: boolean;
}

function required(env: NodeJS.ProcessEnv, key: string): string {
  const value = env[key];
  if (!value) throw new Error(`Missing required env var ${key}`);
  return value;
}

function positiveNumber(env: NodeJS.ProcessEnv, key: string, fallback: number): number {
  const raw = env[key];
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${key} must be a positive number, got "${raw}"`);
  }
  return value;
}

function mainnetAddress(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const value = env[key]?.trim();
  if (!value) return undefined;
  // Real money: a typo here would send donations to an unspendable address.
  if (!isMainnetAddress(value)) {
    throw new Error(`${key} is not a valid Litecoin mainnet address (bad format or checksum)`);
  }
  return value;
}

function publicUrl(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${key} must be a full URL like https://example.com, got "${raw}"`);
  }
  if (url.protocol !== 'http:' && url.protocol !== 'https:') {
    throw new Error(`${key} must be an http or https URL, got "${raw}"`);
  }
  return url.href;
}

function electrumServer(env: NodeJS.ProcessEnv, key: string): string | undefined {
  const raw = env[key]?.trim();
  if (!raw) return undefined;
  const match = /^([a-zA-Z0-9.-]+):(\d{1,5})(?::([st]))?$/.exec(raw);
  const port = Number(match?.[2]);
  if (!match || port < 1 || port > 65535) {
    throw new Error(`${key} must look like host:port, host:port:s (SSL) or host:port:t (TCP), got "${raw}"`);
  }
  return match[3] ? `${match[1]}:${port}:${match[3]}` : `${match[1]}:${port}`;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const protocol = env.LTC_PROTOCOL ?? 'http';
  if (protocol !== 'http' && protocol !== 'https') {
    throw new Error(`LTC_PROTOCOL must be http or https, got "${protocol}"`);
  }

  return {
    rpc: {
      host: env.LTC_HOST ?? '127.0.0.1',
      port: positiveNumber(env, 'LTC_PORT', 19332),
      user: required(env, 'LTC_USER'),
      pass: required(env, 'LTC_PASS'),
      protocol,
    },
    wallet: env.FAUCET_WALLET || undefined,
    returnAddress: env.RETURN_ADDRESS?.trim() || undefined,
    donationAddress: mainnetAddress(env, 'DONATION_ADDRESS'),
    publicUrl: publicUrl(env, 'PUBLIC_URL'),
    electrumServer: electrumServer(env, 'ELECTRUM_SERVER'),
    mongo: { uri: required(env, 'MONGO_URI'), db: env.MONGO_DB ?? 'ltc-faucet' },
    amount: positiveNumber(env, 'FAUCET_AMOUNT', 0.1),
    cooldownHours: positiveNumber(env, 'COOLDOWN_HOURS', 24),
    port: positiveNumber(env, 'PORT', 3000),
    host: env.HOST ?? '127.0.0.1',
    trustProxy: env.TRUST_PROXY === 'true',
  };
}
