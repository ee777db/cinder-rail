/**
 * Cinder native devnet cryptography: standardized ML-DSA-65 (FIPS 204) and SHA-384.
 * The primitive is implemented by @noble/post-quantum 0.7.1, not by this module.
 * Upstream is self-audited, not independently audited, and does not claim that
 * JavaScript signing is constant-time. This module is not an audited wallet,
 * consensus protocol, secure key store, or claim of complete quantum security.
 * Source: https://github.com/paulmillr/noble-post-quantum/tree/0.7.1
 */
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import { sha384 } from '@noble/hashes/sha2.js';

export const NATIVE_ALGORITHM = 'ML-DSA-65' as const;
export const NATIVE_SIGNATURE_CONTEXT = 'cinder-native-v1';
export const NATIVE_CRYPTO_SIZES = Object.freeze({ publicKey: 1952, secretKey: 4032, signature: 3309, hash: 48 });
export const NATIVE_MAX_PAYLOAD_BYTES = 65536;
const encoder = new TextEncoder();
const context = encoder.encode(NATIVE_SIGNATURE_CONTEXT);
const domainPattern = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,95}$/;

export type NativeJson = null | boolean | number | string | NativeJson[] | { [key: string]: NativeJson };
export interface NativeKey {
  algorithm: typeof NATIVE_ALGORITHM;
  publicKey: string;
  secretKey: string;
  address: string;
}

function wellFormed(value: string): void {
  for (let i = 0; i < value.length; i++) {
    const code = value.charCodeAt(i);
    if (code >= 0xd800 && code <= 0xdbff) {
      const next = value.charCodeAt(++i);
      if (!(next >= 0xdc00 && next <= 0xdfff)) throw new TypeError('Unpaired Unicode surrogate');
    } else if (code >= 0xdc00 && code <= 0xdfff) throw new TypeError('Unpaired Unicode surrogate');
  }
}

/**
 * Recursively sorted JSON with UTF-16 property ordering, exact Unicode strings,
 * dense arrays, and safe integer numbers only. No normalization is applied.
 * Coin amounts must be canonical decimal strings checked by the ledger schema.
 * Rejects lossy JSON values, cycles, getters, non-plain objects, and oversized
 * inputs rather than silently changing what the caller believes they signed.
 * This is Cinder's restricted JSON encoding, not a general RFC 8785 claim.
 */
export function nativeCanonical(value: unknown): string {
  const ancestors = new WeakSet<object>();
  let nodes = 0;
  function encode(item: unknown, depth: number): string {
    if (++nodes > 20000 || depth > 64) throw new RangeError('Canonical payload is too complex');
    if (item === null) return 'null';
    if (typeof item === 'string') {
      if (item.length > NATIVE_MAX_PAYLOAD_BYTES) throw new RangeError('Canonical payload is too large');
      wellFormed(item);
      return JSON.stringify(item);
    }
    if (typeof item === 'boolean') return item ? 'true' : 'false';
    if (typeof item === 'number') {
      if (!Number.isSafeInteger(item) || Object.is(item, -0)) throw new TypeError('Only safe integer numbers are supported');
      return String(item);
    }
    if (typeof item !== 'object') throw new TypeError('Only strict JSON values are supported');
    if (ancestors.has(item)) throw new TypeError('Cyclic payload');
    ancestors.add(item);
    try {
      if (Array.isArray(item)) {
        if (item.length > 20000 || Reflect.ownKeys(item).length !== item.length + 1)
          throw new TypeError('Arrays must be dense and contain no extra properties');
        const values: string[] = [];
        for (let i = 0; i < item.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(item, String(i));
          if (!descriptor || !descriptor.enumerable || !('value' in descriptor))
            throw new TypeError('Arrays must contain plain values');
          values.push(encode(descriptor.value, depth + 1));
        }
        return '[' + values.join(',') + ']';
      }
      const prototype = Object.getPrototypeOf(item);
      if (prototype !== Object.prototype && prototype !== null) throw new TypeError('Only plain JSON objects are supported');
      const keys = Reflect.ownKeys(item);
      if (keys.some(key => typeof key !== 'string')) throw new TypeError('Symbol keys are not supported');
      const values = (keys as string[]).sort().map(key => {
        wellFormed(key);
        const descriptor = Object.getOwnPropertyDescriptor(item, key)!;
        if (!descriptor.enumerable || !('value' in descriptor)) throw new TypeError('Only enumerable plain properties are supported');
        return JSON.stringify(key) + ':' + encode(descriptor.value, depth + 1);
      });
      return '{' + values.join(',') + '}';
    } finally { ancestors.delete(item); }
  }
  const result = encode(value, 0);
  if (encoder.encode(result).length > NATIVE_MAX_PAYLOAD_BYTES) throw new RangeError('Canonical payload is too large');
  return result;
}

/** Strict unpadded base64url serialization, usable in browsers and Workers. */
export function nativeBase64url(bytes: Uint8Array): string {
  if (!(bytes instanceof Uint8Array)) throw new TypeError('Expected raw bytes');
  let binary = '';
  for (let i = 0; i < bytes.length; i += 8192)
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

/** Rejects padded/aliased encodings and checks the raw byte length before use. */
export function nativeUnbase64url(value: string, expectedBytes: number): Uint8Array {
  if (!Number.isSafeInteger(expectedBytes) || expectedBytes < 1 || expectedBytes > NATIVE_MAX_PAYLOAD_BYTES)
    throw new TypeError('Invalid expected byte length');
  if (typeof value !== 'string' || value.length !== Math.ceil(expectedBytes * 8 / 6) || !/^[A-Za-z0-9_-]+$/.test(value))
    throw new TypeError('Invalid base64url encoding or byte length');
  const binary = atob(value.replace(/-/g, '+').replace(/_/g, '/'));
  const bytes = Uint8Array.from(binary, char => char.charCodeAt(0));
  if (bytes.length !== expectedBytes || nativeBase64url(bytes) !== value)
    throw new TypeError('Noncanonical base64url encoding');
  return bytes;
}

function hex(bytes: Uint8Array): string {
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** SHA-384 over the exact well-formed UTF-8 text, returned as 96 lowercase hex characters. */
export function nativeHash(text: string): string {
  if (typeof text !== 'string') throw new TypeError('Hash input must be text');
  wellFormed(text);
  return hex(sha384(encoder.encode(text)));
}

/** Full SHA-384 public-key commitment; this prefix is not a Bech32 checksum. */
export function nativeAddress(publicKeyB64: string): string {
  return 'cin1' + hex(sha384(nativeUnbase64url(publicKeyB64, NATIVE_CRYPTO_SIZES.publicKey)));
}

function message(payload: unknown): Uint8Array {
  const serialized = nativeCanonical(payload);
  if (payload === null || typeof payload !== 'object' || Array.isArray(payload))
    throw new TypeError('Signed payload must be an object with domain and chainId');
  const domain = Object.getOwnPropertyDescriptor(payload, 'domain')?.value;
  const chainId = Object.getOwnPropertyDescriptor(payload, 'chainId')?.value;
  if (typeof domain !== 'string' || !domainPattern.test(domain) || typeof chainId !== 'string' || !domainPattern.test(chainId))
    throw new TypeError('Signed payload requires explicit domain and chainId strings');
  return encoder.encode(serialized);
}

/** Fresh 32-byte CSPRNG seed is generated by noble via crypto.getRandomValues. */
export function nativeGenerateKey(): NativeKey {
  const pair = ml_dsa65.keygen();
  try {
    const publicKey = nativeBase64url(pair.publicKey);
    return { algorithm: NATIVE_ALGORITHM, publicKey, secretKey: nativeBase64url(pair.secretKey), address: nativeAddress(publicKey) };
  } finally {
    // Best effort only: JS engines may copy memory and returned strings cannot be erased.
    pair.secretKey.fill(0);
  }
}

/**
 * Pure ML-DSA (not HashML-DSA), standardized context separation, and fresh hedged
 * randomness on every signature. The caller supplies transaction/checkpoint
 * domain, chainId, nonce and all authorization fields inside the signed payload.
 */
export function nativeSign(payload: unknown, secretKeyB64: string): string {
  const bytes = message(payload);
  const secretKey = nativeUnbase64url(secretKeyB64, NATIVE_CRYPTO_SIZES.secretKey);
  try { return nativeBase64url(ml_dsa65.sign(bytes, secretKey, { context })); }
  finally { secretKey.fill(0); }
}

/** Invalid signatures, malformed payloads, and wrong-sized keys fail closed. */
export function nativeVerify(payload: unknown, signatureB64: string, publicKeyB64: string): boolean {
  try {
    const bytes = message(payload);
    const signature = nativeUnbase64url(signatureB64, NATIVE_CRYPTO_SIZES.signature);
    const publicKey = nativeUnbase64url(publicKeyB64, NATIVE_CRYPTO_SIZES.publicKey);
    return ml_dsa65.verify(signature, bytes, publicKey, { context });
  } catch { return false; }
}
