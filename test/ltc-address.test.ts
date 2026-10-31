import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { base58CheckDecode, bech32Decode, isMainnetAddress } from '../src/ltc-address.js';

// --- Spec vectors (independent of this implementation)

test('bech32Decode accepts BIP173 valid bech32 strings', () => {
  for (const s of [
    'A12UEL5L',
    'a12uel5l',
    'abcdef1qpzry9x8gf2tvdw0s3jn54khce6mua7lmqqqxw',
    'split1checkupstagehandshakeupstreamerranterredcaperred2y9e3w',
    '?1ezyfcl',
  ]) {
    assert.equal(bech32Decode(s)?.encoding, 'bech32', s);
  }
});

test('bech32Decode accepts BIP350 valid bech32m strings', () => {
  for (const s of ['A1LQFN3A', 'a1lqfn3a', '?1v759aa']) {
    assert.equal(bech32Decode(s)?.encoding, 'bech32m', s);
  }
});

test('bech32Decode rejects BIP173 invalid strings', () => {
  for (const s of [
    'pzry9x0s0muk', // no separator
    '1pzry9x0s0muk', // empty hrp
    'x1b4n0q5v', // invalid data character
    'li1dgmt3', // checksum too short
    '10a06t8', // empty hrp
    '1qzzfhee', // empty hrp
    'A12UEL5l', // mixed case
  ]) {
    assert.equal(bech32Decode(s), null, s);
  }
});

test('base58CheckDecode decodes the Bitcoin genesis address', () => {
  const payload = base58CheckDecode('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNa');
  assert.ok(payload);
  assert.equal(
    Buffer.from(payload).toString('hex'),
    '0062e907b15cbf27d5425399ebf6f0fb50ebb88f18',
  );
  assert.equal(base58CheckDecode('1A1zP1eP5QGefi2DMPTfTL5SLmv7DivfNb'), null);
});

// --- Encoders used only to generate Litecoin addresses for the tests below

const BASE58 = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';
const sha256 = (b: Uint8Array) => createHash('sha256').update(b).digest();

function base58Check(version: number, hash: Uint8Array): string {
  const payload = Buffer.concat([Buffer.from([version]), hash]);
  const bytes = Buffer.concat([payload, sha256(sha256(payload)).subarray(0, 4)]);
  let n = BigInt('0x' + bytes.toString('hex'));
  let out = '';
  while (n > 0n) {
    out = BASE58[Number(n % 58n)] + out;
    n /= 58n;
  }
  for (const b of bytes) {
    if (b !== 0) break;
    out = '1' + out;
  }
  return out;
}

const CHARSET = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l';
function polymod(values: number[]): number {
  const G = [0x3b6a57b2, 0x26508e6d, 0x1ea119fa, 0x3d4233dd, 0x2a1462b3];
  let chk = 1;
  for (const v of values) {
    const top = chk >>> 25;
    chk = ((chk & 0x1ffffff) << 5) ^ v;
    for (let i = 0; i < 5; i++) if ((top >>> i) & 1) chk ^= G[i] as number;
  }
  return chk >>> 0;
}

function segwit(hrp: string, version: number, program: Uint8Array): string {
  const words = [version];
  let acc = 0;
  let bits = 0;
  for (const b of program) {
    acc = (acc << 8) | b;
    bits += 8;
    while (bits >= 5) {
      bits -= 5;
      words.push((acc >> bits) & 31);
    }
  }
  if (bits > 0) words.push((acc << (5 - bits)) & 31);
  const codes = [...hrp].map((c) => c.charCodeAt(0));
  const expanded = [...codes.map((c) => c >> 5), 0, ...codes.map((c) => c & 31)];
  const constant = version === 0 ? 1 : 0x2bc830a3;
  const mod = polymod([...expanded, ...words, 0, 0, 0, 0, 0, 0]) ^ constant;
  const checksum = [0, 1, 2, 3, 4, 5].map((i) => (mod >>> (5 * (5 - i))) & 31);
  return hrp + '1' + [...words, ...checksum].map((w) => CHARSET[w]).join('');
}

const h20 = randomBytes(20);
const h32 = randomBytes(32);

// --- Litecoin mainnet rules

test('accepts the configured donation address', () => {
  assert.equal(isMainnetAddress('ltc1q3cr95mcdzvyecq7w9n9ac2h05d2x8kpjfyqqph'), true);
});

test('accepts every mainnet address type', () => {
  const addresses = {
    'P2PKH (L…)': base58Check(0x30, h20),
    'P2SH (M…)': base58Check(0x32, h20),
    'legacy P2SH (3…)': base58Check(0x05, h20),
    'P2WPKH (ltc1q…)': segwit('ltc', 0, h20),
    'P2WSH (ltc1q…)': segwit('ltc', 0, h32),
    'P2TR (ltc1p…)': segwit('ltc', 1, h32),
  };
  for (const [kind, address] of Object.entries(addresses)) {
    assert.equal(isMainnetAddress(address), true, `${kind}: ${address}`);
  }
  assert.equal(isMainnetAddress(segwit('ltc', 0, h20).toUpperCase()), true);
});

test('rejects testnet and Bitcoin addresses', () => {
  const addresses = {
    'testnet P2PKH (m…/n…)': base58Check(0x6f, h20),
    'testnet P2SH (Q…)': base58Check(0x3a, h20),
    'testnet bech32 (tltc1…)': segwit('tltc', 0, h20),
    'Bitcoin P2PKH (1…)': base58Check(0x00, h20),
    'Bitcoin bech32 (bc1…)': segwit('bc', 0, h20),
  };
  for (const [kind, address] of Object.entries(addresses)) {
    assert.equal(isMainnetAddress(address), false, `${kind}: ${address}`);
  }
});

test('rejects single-character typos', () => {
  for (const address of [
    base58Check(0x30, h20),
    segwit('ltc', 0, h20),
    'ltc1q3cr95mcdzvyecq7w9n9ac2h05d2x8kpjfyqqph',
  ]) {
    // Change one character in the middle to another valid character.
    const i = Math.floor(address.length / 2);
    const alphabet = address.startsWith('ltc1') ? CHARSET : BASE58;
    const replacement = alphabet[(alphabet.indexOf(address[i] as string) + 1) % alphabet.length];
    const typo = address.slice(0, i) + replacement + address.slice(i + 1);
    assert.equal(isMainnetAddress(typo), false, typo);
  }
});

test('rejects wrong segwit encoding and program lengths', () => {
  // v0 must use bech32, v1+ bech32m
  const v0WithBech32m = segwit('ltc', 0, h20).slice(0, -6);
  assert.equal(isMainnetAddress(v0WithBech32m + 'qqqqqq'), false);
  // v0 programs must be 20 or 32 bytes
  assert.equal(isMainnetAddress(segwit('ltc', 0, randomBytes(25))), false);
});

test('rejects junk', () => {
  for (const s of ['', 'ltc1', 'L', 'not an address', '0OIl'.repeat(9)]) {
    assert.equal(isMainnetAddress(s), false, JSON.stringify(s));
  }
});
