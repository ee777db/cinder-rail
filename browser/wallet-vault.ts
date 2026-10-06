import { nativeAddress, nativeBase64url, nativeUnbase64url, nativeCanonical, nativeSign, nativeVerify, type NativeKey } from '../src/native-crypto.ts';

export const VAULT_ITERATIONS = 310000;
export interface WalletVault {
  format: 'cinder.wallet.v1';
  version: 1;
  kdf: { name: 'PBKDF2'; hash: 'SHA-384'; iterations: number; salt: string };
  cipher: { name: 'AES-256-GCM'; iv: string };
  ciphertext: string;
}
const encode = (value: string) => new TextEncoder().encode(value);
const buffer = (value: Uint8Array) => new Uint8Array(value).buffer;
function requirePassword(password: string): void {
  if (typeof password !== 'string' || Array.from(password).length < 12 || password.length > 1024)
    throw new Error('备份密码需要至少 12 个字符，且不超过 1,024 个字符。');
}
function validateKey(wallet: NativeKey, chainId: string): void {
  if (wallet?.algorithm !== 'ML-DSA-65' || typeof wallet.publicKey !== 'string' || typeof wallet.secretKey !== 'string' || nativeAddress(wallet.publicKey) !== wallet.address)
    throw new Error('钱包密钥或公开地址无效。');
  const challenge = { domain: 'cinder.wallet-check.v1', chainId, publicKey: wallet.publicKey };
  if (!nativeVerify(challenge, nativeSign(challenge, wallet.secretKey), wallet.publicKey)) throw new Error('备份中的私钥与公钥不匹配。');
}
async function derive(password: string, salt: Uint8Array, iterations: number): Promise<CryptoKey> {
  const material = encode(password);
  try {
    const key = await crypto.subtle.importKey('raw', buffer(material), 'PBKDF2', false, ['deriveKey']);
    return await crypto.subtle.deriveKey({ name: 'PBKDF2', hash: 'SHA-384', salt: buffer(salt), iterations }, key, { name: 'AES-GCM', length: 256 }, false, ['encrypt', 'decrypt']);
  } finally { material.fill(0); }
}
function header(vault: WalletVault) { return { format: vault.format, version: vault.version, kdf: vault.kdf, cipher: vault.cipher }; }

export async function encryptWallet(wallet: NativeKey, password: string, chainId: string): Promise<WalletVault> {
  requirePassword(password); validateKey(wallet, chainId);
  const salt = crypto.getRandomValues(new Uint8Array(32));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const vault: WalletVault = { format: 'cinder.wallet.v1', version: 1, kdf: { name: 'PBKDF2', hash: 'SHA-384', iterations: VAULT_ITERATIONS, salt: nativeBase64url(salt) }, cipher: { name: 'AES-256-GCM', iv: nativeBase64url(iv) }, ciphertext: '' };
  const plaintext = encode(nativeCanonical({ chainId, wallet: { algorithm: wallet.algorithm, publicKey: wallet.publicKey, secretKey: wallet.secretKey, address: wallet.address } }));
  try {
    const key = await derive(password, salt, VAULT_ITERATIONS);
    const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(encode(nativeCanonical(header(vault)))), tagLength: 128 }, key, buffer(plaintext));
    vault.ciphertext = nativeBase64url(new Uint8Array(ciphertext));
    return vault;
  } finally { plaintext.fill(0); }
}

export async function decryptWallet(input: string, password: string, expectedChainId: string): Promise<NativeKey> {
  requirePassword(password);
  if (typeof input !== 'string' || input.length > 32768) throw new Error('备份文件过大或格式无效。');
  let vault: WalletVault;
  try { vault = JSON.parse(input); } catch { throw new Error('请选择有效的 Cinder 加密钱包 JSON 文件。'); }
  if (vault?.format !== 'cinder.wallet.v1' || vault.version !== 1 || vault.kdf?.name !== 'PBKDF2' || vault.kdf.hash !== 'SHA-384' || !Number.isSafeInteger(vault.kdf.iterations) || vault.kdf.iterations < 210000 || vault.kdf.iterations > 1000000 || vault.cipher?.name !== 'AES-256-GCM' || typeof vault.ciphertext !== 'string' || vault.ciphertext.length < 32 || vault.ciphertext.length > 24000)
    throw new Error('备份算法、版本或加密参数不受支持。');
  let plaintext: Uint8Array | undefined;
  try {
    const salt = nativeUnbase64url(vault.kdf.salt, 32);
    const iv = nativeUnbase64url(vault.cipher.iv, 12);
    const ciphertext = nativeUnbase64url(vault.ciphertext, Math.floor(vault.ciphertext.length * 3 / 4));
    const key = await derive(password, salt, vault.kdf.iterations);
    plaintext = new Uint8Array(await crypto.subtle.decrypt({ name: 'AES-GCM', iv: buffer(iv), additionalData: buffer(encode(nativeCanonical(header(vault)))), tagLength: 128 }, key, buffer(ciphertext)));
  } catch { throw new Error('密码错误或备份文件已被改动。'); }
  try {
    const decoded = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(plaintext));
    if (decoded.chainId !== expectedChainId) throw new Error('此备份属于不同的 Cinder 网络。');
    validateKey(decoded.wallet, expectedChainId);
    return { algorithm: 'ML-DSA-65', publicKey: decoded.wallet.publicKey, secretKey: decoded.wallet.secretKey, address: decoded.wallet.address };
  } finally { plaintext.fill(0); }
}
