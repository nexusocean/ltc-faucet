import { createHash } from 'node:crypto';

/**
 * Offline check that a string is a Litecoin mainnet address with a valid
 * checksum. Used for the donation address, which the faucet's testnet node
 * cannot validate.
 */
export function isMainnetAddress(address: string): boolean {
  return address.toLowerCase().startsWith('ltc1')
    ? isValidSegwit(address)
    : isValidBase58(address);
}

// --- Base58Check: L… (P2PKH, 0x30), M… (P2SH, 0x32), 3… (legacy P2SH, 0x05)

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const MAINNET_VERSIONS = new Set([0x30, 0x32, 0x05]);

function base58Decode(input: string): Uint8Array | null {
  let value = 0n;
  for (const char of input) {
    const digit = BASE58.indexOf(char);
    if (digit < 0) return null;
    value = value * 58n + BigInt(digit);
  }
  const bytes: number[] = [];
  while (value > 0n) {
    bytes.unshift(Number(value % 256n));
    value /= 256n;
  }
  for (const char of input) {
    if (char !== '1') break;
    bytes.unshift(0);
  }
  return Uint8Array.from(bytes);
}

const sha256 = (data: Uint8Array) => createHash('sha256').update(data).digest();

/** Returns the version byte + 20-byte hash, or null if the checksum fails. */
export function base58CheckDecode(address: string): Uint8Array | null {
  const bytes = base58Decode(address);
  if (!bytes || bytes.length !== 25) return null;
  const payload = bytes.subarray(0, 21);
  const checksum = sha256(sha256(payload)).subarray(0, 4);
  return checksum.equals(bytes.subarray(21)) ? payload : null;
}

function isValidBase58(address: string): boolean {
  const payload = base58CheckDecode(address);
  return payload !== null && MAINNET_VERSIONS.has(payload[0] as number);
}

// --- Bech32 / Bech32m (BIP173 / BIP350): ltc1…

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
const GENERATORS = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
const BECH32 = 1;
const BECH32M = 0x2bc830a3;

function polymod(values: number[]): number {
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    GENERATORS.forEach((g, i) => {
      if ((top >>> i) & 1) chk ^= g;
    });
  }
  return chk >>> 0;
}

function hrpExpand(hrp: string): number[] {
  const codes = [...hrp].map((c) => c.charCodeAt(0));
  return [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
}

function convertBits(data: number[], from: number, to: number): number[] | null {
  let acc = 0;
  let bits = 0;
  const out: number[] = [];
  const maxv = (1 << to) - 1;
  for (const value of data) {
    acc = (acc << from) | value;
    bits += from;
    while (bits >= to) {
      bits -= to;
      out.push((acc >> bits) & maxv);
    }
  }
  // Leftover bits must be zero padding shorter than one input group.
  if (bits >= from || ((acc << (to - bits)) & maxv)) return null;
  return out;
}

export interface Bech32Decoded {
  hrp: string;
  /** 5-bit words, without the 6-word checksum. */
  words: number[];
  encoding: 'bech32' | 'bech32m';
}

export function bech32Decode(input: string): Bech32Decoded | null {
  if (input !== input.toLowerCase() && input !== input.toUpperCase()) return null;
  const lower = input.toLowerCase();
  if (lower.length > 90) return null;

  const sep = lower.lastIndexOf('1');
  if (sep < 1 || sep + 7 > lower.length) return null;
  const hrp = lower.slice(0, sep);
  if ([...hrp].some((c) => c.charCodeAt(0) < 33 || c.charCodeAt(0) > 126)) return null;

  const data: number[] = [];
  for (const char of lower.slice(sep + 1)) {
    const v = CHARSET.indexOf(char);
    if (v < 0) return null;
    data.push(v);
  }

  const constant = polymod([...hrpExpand(hrp), ...data]);
  const encoding = constant === BECH32 ? 'bech32' : constant === BECH32M ? 'bech32m' : null;
  if (!encoding) return null;
  return { hrp, words: data.slice(0, -6), encoding };
}

function isValidSegwit(address: string): boolean {
  const decoded = bech32Decode(address);
  if (!decoded || decoded.hrp !== 'ltc' || decoded.words.length < 1) return false;

  const version = decoded.words[0] as number;
  if (decoded.encoding !== (version === 0 ? 'bech32' : 'bech32m')) return false;

  const program = convertBits(decoded.words.slice(1), 5, 8);
  if (!program || version > 16 || program.length < 2 || program.length > 40) return false;
  if (version === 0 && program.length !== 20 && program.length !== 32) return false;
  return true;
}
