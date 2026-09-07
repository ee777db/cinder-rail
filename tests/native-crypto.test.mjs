import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { cpus } from 'node:os';
import { ml_dsa65 } from '@noble/post-quantum/ml-dsa.js';
import {
  nativeGenerateKey, nativeSign, nativeVerify, nativeAddress, nativeHash,
  nativeCanonical, nativeBase64url, nativeUnbase64url,
  NATIVE_ALGORITHM, NATIVE_SIGNATURE_CONTEXT, NATIVE_CRYPTO_SIZES, NATIVE_MAX_PAYLOAD_BYTES,
} from '../src/native-crypto.ts';

const bytes = text => new TextEncoder().encode(text);
const independentHash = raw => createHash('sha384').update(raw).digest('hex');
const key = nativeGenerateKey();
const other = nativeGenerateKey();
const transfer = {
  domain: 'cinder.transaction.v1', chainId: 'cinder-native-devnet-1',
  nonce: 1, from: key.address, to: other.address,
  amount: '100000000000000000000', fee: '1', memo: '火 🔥',
};

test('native canonical encoding sorts recursively and preserves exact integer/string semantics', () => {
  assert.equal(nativeCanonical({ z: [3, { b: '火', a: 2 }], a: '001' }), '{"a":"001","z":[3,{"a":2,"b":"火"}]}');
  assert.equal(nativeCanonical({ n: Number.MAX_SAFE_INTEGER, b: true, a: null }), '{"a":null,"b":true,"n":9007199254740991}');
  assert.equal(nativeCanonical(JSON.parse('{"__proto__":{"safe":true},"2":2,"10":10}')), '{"10":10,"2":2,"__proto__":{"safe":true}}');
  assert.equal(nativeCanonical(Object.assign(Object.create(null), { b: 2, a: 1 })), '{"a":1,"b":2}');
  const shared = { x: 1 };
  assert.equal(nativeCanonical([shared, shared]), '[{"x":1},{"x":1}]');
  assert.notEqual(nativeCanonical('é'), nativeCanonical('e\u0301'), 'No hidden Unicode normalization');
});

test('native canonical encoding rejects values JSON would silently coerce, skip or execute', () => {
  for (const value of [0.1, NaN, Infinity, -Infinity, -0, Number.MAX_SAFE_INTEGER + 1, 1n, undefined,
    () => 1, Symbol('x'), new Date(), new Map(), new Uint8Array([1]), { x: undefined }, [undefined], [, 1], '\ud800', '\udc00']) {
    assert.throws(() => nativeCanonical(value));
  }
  const cycle = {}; cycle.self = cycle;
  assert.throws(() => nativeCanonical(cycle), /Cyclic/);
  let called = false;
  const getter = Object.defineProperty({}, 'value', { enumerable: true, get() { called = true; return 1; } });
  assert.throws(() => nativeCanonical(getter));
  assert.equal(called, false, 'Canonicalization must not invoke accessors');
  assert.throws(() => nativeCanonical({ toJSON() { called = true; return 'changed'; } }));
  assert.equal(called, false);
  const symbol = { [Symbol('secret')]: 1 };
  assert.throws(() => nativeCanonical(symbol));
  const extra = [1]; extra.extra = 2;
  assert.throws(() => nativeCanonical(extra));
  assert.throws(() => nativeCanonical(Object.defineProperty({}, 'hidden', { value: 1 })));
  assert.throws(() => nativeCanonical({ ['\ud800']: 1 }));
  assert.throws(() => nativeCanonical('x'.repeat(NATIVE_MAX_PAYLOAD_BYTES)), /too large/);
  let deep = 0; for (let i = 0; i < 70; i++) deep = [deep];
  assert.throws(() => nativeCanonical(deep), /too complex/);
});

test('SHA-384 and complete native addresses match an independent Node crypto implementation', () => {
  assert.equal(nativeHash('abc'), 'cb00753f45a35e8bb5a03d699ac65007272c32ab0eded1631a8b605a43ff5bed8086072ba1e7cc2358baeca134c825a7');
  assert.equal(nativeHash('火 🔥'), independentHash(bytes('火 🔥')));
  assert.equal(nativeHash(''), independentHash(new Uint8Array()));
  assert.throws(() => nativeHash('\ud800'));
  assert.equal(nativeAddress(key.publicKey), 'cin1' + independentHash(Buffer.from(key.publicKey, 'base64url')));
  assert.match(key.address, /^cin1[a-f0-9]{96}$/);
  assert.equal(key.address.length, 100);
  assert.notEqual(key.address, other.address);
  const changed = Buffer.from(key.publicKey, 'base64url'); changed[0] ^= 1;
  assert.notEqual(nativeAddress(changed.toString('base64url')), key.address);
});

test('ML-DSA-65 uses exact standardized raw sizes and canonical unpadded base64url', () => {
  assert.equal(key.algorithm, NATIVE_ALGORITHM);
  assert.equal(Buffer.from(key.publicKey, 'base64url').length, NATIVE_CRYPTO_SIZES.publicKey);
  assert.equal(Buffer.from(key.secretKey, 'base64url').length, NATIVE_CRYPTO_SIZES.secretKey);
  assert.equal(key.publicKey.length, 2603);
  assert.equal(key.secretKey.length, 5376);
  assert.equal(ml_dsa65.lengths.publicKey, 1952);
  assert.equal(ml_dsa65.lengths.secretKey, 4032);
  assert.equal(ml_dsa65.lengths.signature, 3309);
  const signature = nativeSign(transfer, key.secretKey);
  assert.equal(Buffer.from(signature, 'base64url').length, NATIVE_CRYPTO_SIZES.signature);
  assert.equal(signature.length, 4412);
  for (const value of [key.publicKey, key.secretKey, signature]) assert.match(value, /^[A-Za-z0-9_-]+$/);
  assert.deepEqual(nativeUnbase64url(nativeBase64url(new Uint8Array([0, 255, 128])), 3), new Uint8Array([0, 255, 128]));
});

test('native signatures authenticate complete payloads and use fresh hedged signing randomness', () => {
  const first = nativeSign(transfer, key.secretKey);
  const second = nativeSign(transfer, key.secretKey);
  assert.notEqual(first, second, 'Production signing must retain upstream fresh randomized entropy');
  assert.equal(nativeVerify(transfer, first, key.publicKey), true);
  assert.equal(nativeVerify(transfer, second, key.publicKey), true);
  assert.equal(nativeVerify({ ...transfer, amount: '100000000000000000001' }, first, key.publicKey), false);
  assert.equal(nativeVerify({ ...transfer, to: key.address }, first, key.publicKey), false);
  assert.equal(nativeVerify({ ...transfer, nonce: 2 }, first, key.publicKey), false);
  assert.equal(nativeVerify(transfer, first, other.publicKey), false);
  const tampered = Buffer.from(first, 'base64url'); tampered[500] ^= 1;
  assert.equal(nativeVerify(transfer, tampered.toString('base64url'), key.publicKey), false);
  const reordered = Object.fromEntries(Object.entries(transfer).reverse());
  assert.equal(nativeVerify(reordered, first, key.publicKey), true);
});

test('transaction domain, checkpoint domain, chain ID and FIPS context are separate commitments', () => {
  const signature = nativeSign(transfer, key.secretKey);
  assert.equal(nativeVerify({ ...transfer, domain: 'cinder.checkpoint.v1' }, signature, key.publicKey), false);
  assert.equal(nativeVerify({ ...transfer, chainId: 'cinder-native-devnet-2' }, signature, key.publicKey), false);
  const rawSignature = Buffer.from(signature, 'base64url');
  const rawKey = Buffer.from(key.publicKey, 'base64url');
  const payload = bytes(nativeCanonical(transfer));
  assert.equal(ml_dsa65.verify(rawSignature, payload, rawKey, { context: bytes(NATIVE_SIGNATURE_CONTEXT) }), true);
  assert.equal(ml_dsa65.verify(rawSignature, payload, rawKey), false, 'Context-free signatures must be isolated');
  assert.equal(ml_dsa65.verify(rawSignature, payload, rawKey, { context: bytes('other-application-v1') }), false);
  for (const invalid of [{}, { domain: 'x' }, { chainId: 'x' }, { domain: '', chainId: 'x' },
    { domain: 'x', chainId: 1 }, { domain: 'x\0y', chainId: 'x' }]) {
    assert.throws(() => nativeSign(invalid, key.secretKey));
    assert.equal(nativeVerify(invalid, signature, key.publicKey), false);
  }
  assert.notEqual(nativeHash(nativeCanonical(transfer)), nativeHash(nativeCanonical({ ...transfer, domain: 'cinder.checkpoint.v1' })));
});

test('wrong lengths, base64 aliases, padding, invalid encodings and malformed payloads fail closed', () => {
  const signature = nativeSign(transfer, key.secretKey);
  for (const bad of ['', 'abc', signature + '=', signature.slice(1), '!'.repeat(4412), 'A'.repeat(100000)])
    assert.equal(nativeVerify(transfer, bad, key.publicKey), false);
  for (const bad of ['', key.publicKey + '=', key.publicKey.slice(1), key.secretKey, 'A'.repeat(100000)]) {
    assert.throws(() => nativeAddress(bad));
    assert.equal(nativeVerify(transfer, signature, bad), false);
  }
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';
  const last = alphabet.indexOf(key.publicKey.at(-1));
  const alias = key.publicKey.slice(0, -1) + alphabet[last + 1];
  assert.deepEqual(Buffer.from(alias, 'base64url'), Buffer.from(key.publicKey, 'base64url'), 'Test fixture must be a real decoder alias');
  assert.throws(() => nativeAddress(alias), /Noncanonical/);
  assert.equal(nativeVerify(transfer, signature, alias), false);
  assert.equal(nativeVerify({ ...transfer, fee: 0.1 }, signature, key.publicKey), false);
  assert.throws(() => nativeSign(transfer, key.publicKey));
  assert.throws(() => nativeSign(transfer, key.secretKey + '='));
});

test('native wrapper benchmark records actual local runtime timings without a performance guarantee', t => {
  const rounds = 30;
  const measurement = fn => {
    for (let i = 0; i < 5; i++) fn();
    const samples = [];
    for (let i = 0; i < rounds; i++) {
      const start = performance.now(); fn(); samples.push(performance.now() - start);
    }
    samples.sort((a, b) => a - b);
    return { meanMs: +(samples.reduce((a, b) => a + b, 0) / rounds).toFixed(3), medianMs: +samples[15].toFixed(3), p95Ms: +samples[28].toFixed(3) };
  };
  const signature = nativeSign(transfer, key.secretKey);
  const results = {
    runtime: process.version, platform: process.platform, arch: process.arch, cpu: cpus()[0]?.model,
    algorithm: NATIVE_ALGORITHM, dependency: '@noble/post-quantum@0.7.1', rounds,
    payloadBytes: bytes(nativeCanonical(transfer)).length, rawBytes: NATIVE_CRYPTO_SIZES,
    keygen: measurement(nativeGenerateKey), sign: measurement(() => nativeSign(transfer, key.secretKey)),
    verify: measurement(() => assert.equal(nativeVerify(transfer, signature, key.publicKey), true)),
    scope: 'Local JS measurements include wrapper encoding; no network, consensus, finality, audit or side-channel guarantee.',
  };
  t.diagnostic('NATIVE_CRYPTO_BENCHMARK ' + JSON.stringify(results));
});

// Official independent NIST ACVP vectors pinned at repository commit
// 975de31eb83d87039ec88934fdc47d8c312b892d, fetched 2026-09-06.
// KeyGen: https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-keyGen-FIPS204/internalProjection.json
// SigVer: https://github.com/usnistgov/ACVP-Server/blob/975de31eb83d87039ec88934fdc47d8c312b892d/gen-val/json-files/ML-DSA-sigVer-FIPS204/internalProjection.json
// Source Git blob identities were verified when embedding these offline fixtures.
// Only public verification data and an explicitly public NIST keygen seed appear below.
// Passing selected vectors is not an ACVP validation certificate or a system audit.
const NIST_KEYGEN_26 = {
  "seed": "A991FD42B071D49C48AE3E75C647459E0DAAD1E1BA356A04801912D3294BCFF8",
  "publicKeySha384": "847838941cd0c0f6c69a98f1feecdd95e0c8105600d6c8063a1a3b346379064f67884da7fc444b9344d35ee10a93d3fd",
  "secretKeySha384": "f2ece23225541eb1b23cf7044b66c2d9230a127b47688adcb4df6f5a37d7b10dc3740d2666659b7dd5a8d21465050907"
};
const NIST_SIGNATURE_VECTORS = [
  {
    "tcId": 38,
    "expected": false,
    "reason": "modified signature - hint",
    "publicKey": "OJSs7xhnfbHQCDWfDKF4ir99WVVpC0e7ASpnc1LvtWX2x6fHBwa2RGB5NdrqHO3njQK3wyZvrv0Vsi73bYZdTw889XkH7FrZ0lsSDt8LBmwkRnPQsZ2e9cuCIv6DU-a-72o0__yA8fpCzK0YegemskeiSAxjEXaCwp37YQXuaJVr9StDXNxu6QIdO9R_tmKYDFNxQqgCKhreQcOkyfBmPjCXrSCoI1eO2HdG1n3PFNBFrbasUMXCqffv5_cSqHzDN3kIwaYh9F_ZTLDCFbROPLEU6PKeA_ZdBLqc_KJSqOD4Y0FSxtWgNmhRsVfB_aQ9ZfseNURp_0i31bD5XGGSx4rKUeZxQbackOIlT-F23d6JgFssP2pY4-f7Yaqtxg5cwqGX6mbSBcMBlwL6Scn1EUfBBekAagF_GQjvoJaCPdCqg-hAw3URzUPCXplRMtb-fcjPiIw0YHYnsjWf9nZ-2Tzj3zOkNq9mv64iBO8nCmLtdE1yd-zU5R9_Go_HdsW-W-Jcv1qSy0GamsUInGoaf0QtqxXSwyo4qC1bZpFDqXkoTvu6pP1YogtmdHnZHu3WosQKEe_BPGycdxNPaPRquarD0VAaWv9EMde4e5eKGEeyRZHDuAC5I8blpPmehahmGfUvwWo9mnu9q3KK_ZH07I_QiDZxBmOBfXL6uFou1dvuj9B_ZxWVVU30bd4lBmXH-KGqF8sGiZWES2yyZKLZenpS3EsvOGIn-QupLXwyGgHjpuK5APJotCiDtWn6chAd0XQhaq51emtzGbfwdwN3j8lKZl8tEUV1Zw1NLH3oKmFSEg8P0XVCnSNBOzvh2sOEsjtXAJWvQqFwZmRn5BVZa6fR1JDoE4_lpdLtKTJN5--fqIwlreRLRfl-9WdOnbImNO8LZIYFq0Hnb0aI70m5gnhHo5s8muK5DgsWpm5ummQKQWPRMLiZ2BLEakeK2QjvLw4tYsNIPhFBYLBS7xTJ0sxcjlMU_lmbEe-w2evsvPhu873FEOtOeZFIj6kLh0HQDMJq7mdLFQHkIi5JmKHhmX7eoJJnN4CNPX0HrlQ2q0fXZyGP1kbJScqzpsNPHSPThWBVE7LrnxCmIwEsa1dTdD6poMnOn7ms3Jvmh8c0TJDSYdH9581CATYsDIOOWDGFVHRlxaH0N5sj9v0UMdkvnmQYE61OZp61PQY3kLLc8NoDS7HKRniLZKWkMKXgXgUD3dsFzlQx_wJHX4RABdxxk5Ds9j1MQTRdi34C_0YpoCwMXfOHK_JvV3ScrAWME8ogeNr8oK_NSUv1ZTUJwPT3ROtXmjRTMilg7yBu29WiJb_y-knIkrXij0D66ojNPbfe8PaF7pQsLnKlxflvwPutgGAPvxrXUweefRwlv9VLqqj7tpmvdd2SUApb3X4uT3O13Q6C3SHy9ykH_cVF4rYMW5t1lF9ypwjpdhZOKoCYdFzApOMETqiTdNEYWQkekmq-vNw7lwm16bIzUylXjvwhbM75fJ8wHlyld3aWuQBMsuYUpb9okMOnchv3ILkm3mfnniRSnB1wOXriYem93wmkqEZw5kMpigRKPcgvkk11XCtBsAVfKYxG6_IDshVmVqwh75ucUSqqMidlELufbq2yoH0mOEjPtCzluhlP3O9ljHQvzAM-i3EYCnEFM640q0eMwPGPSUJRSGCn2MfrsjsgwWf6lZfOQugghf8K4cRDSIcbOQLEiNxhWizOkVWEPpmSe6R9KYKK1yHxxs-aukcKI1_BLQMRzSQqTiietFOZm-uuhCrSCTfHPr8-FuUfonwjpwUwBGHhlVl7e47C2JTWDUT0cl5rZfuP-zU7uRoc4_ovoExXy6JGPuGVld2sHcWa_C_E70ebc1xdc5w8N2PKXcdN8_TxiC2PFHyAVpFLLsx9et2seD8N9BvKoI0hdZ8JZevlSww5P5ShXkg8Dw4ZSk6ULvvvyGf5YBtYqiswZHatXJzvTFWHL8L296nUvMPMuwxHY4fLf88_f1P7cZVPxAFN9DHPCvGtd2V7b2m-yOcel7OVDL1iRkb92PJGC8rQ7Mqhcvm4yaAI12HXEhtuT5S40kQZoFQNwaGaWt8vRuMMACg7WUgI32uG7YMCb-PncUNctgCI2YCk67fUzrtL34w9gEPzHnYX-Elrx_OvHCwDTVAe9N5vO8CoP9BIP0qHiwTKbJn7qGofZ7idlqwCZkD6sWiFX7phCAzPFIj6RKsxnZ6b9HDA8Qa5SSV34DnLA1tZJyaasE113AEuedXySnPP_LLaUMlplwDo16J0LVP9sr0dJVUpw3I2foNy15zVtYRKlbBC1bt0yExXpnFRVRmyA1Rf4oQLaiCnG3ZrgspbNwUzjuIGI1SBqFHpD0xXwh7y7UbC84T8wBgoqSrww8t5Yl8lgIL7UnDUVNoQvGiUDgjPB-pHlo3_FlLZDzpQkMZE-1SSwL5HnmYZdVrYu-pooMGS94evMRyw_79iECY55cs6M1Roy78ulpYks_qf7F-3-vC45_x-NCcKRDdHULMuRvEr1nSoNS3jIiX85-6rgSP1OkK3TnpczFPuMH8guD5YjnRC9gSa0oqGFLJWkvu_qU0UhGBS_VSe6Pdc0K8",
    "signature": "wo2KD20D0tSskjPETOPhZdse-eurWrAITHhxxh9OU0nzcqLvoCz0PrZh-cQWjCaMFS2zYZlBRv6l1r2HvbXrzpxmt6R4BsCWA5enxd8QMhNYkkg6AZuTXl-buSr-eoTk4sdMHcCsJFMZNboeSanhdMzVR4e6k1-fYZXgqphtsHITv6vNeXHXPA-pOBfFhw5s6Dfffo3ePbkx0IBsR2mieszp6Cc_MyN4NSyiHA0_VLRG3UGTVZ3wxEG4ryztXoUvX_vOTLiYag17GuVZnp8wrWWZmL4B0QigzKixn0IHTrxRkoFaaEXW3cjy54ENix6uyUCfe13xM6iFDBKs2Co-VirLQgsiY9ZruP6V-TYP5gZJt42uZ_C1Vzue22tdT4tS7jDPe6On8jKdxZCS2EwxNury6CqISNabnkvUppXLH0DiXNsWYH1XZGPQ1imFPqWm95X-97X_ywzstfzAnf18zEINC8CfUAKiOX5FfJFm0Pt_jVs9RFdQxSQA7Gr5Nj7xay0LCi8aTkDbNpPpX0OkhdvY1ninYyERam2wlLvHiOMWqs2w3ktsgwJ5awtXjho32yvgaO9sel6vP8ePeecxAkhESFx9kha6krErRmqMqB4W4QjhEbUC0k4_CxHh7GpJE9bWyRZifQGchXG_6w47G_gQlSyDUfCQYwEYkz3eddR7WwBeUvgRrAlonbMB4DvOrQr-y5EgTmnY_fL91PxD-XLReorPmsmOhvvUFlMyRt8KQqLLQH3CzB0OnelQy2TNWx-XwDFC9mxDt0N4knSm0XtEz4zigVh7M0LDHqmgmzvbefJSi5_9lVW_ZPMmA458LHJx5Eqjn38f9XYRjYoYwYh6nhdTWCDox7pOukoaUkUHA1cQxLUblLMDSFm3-V7g674x_etAJhcP_Dsb3cD4jUVotvz68GR5M94CE4P795II7ciNhe9eu5cB-FXnslVEjtR6kqPRZl2q5PIKeiVl_pmX4Mwf-95w2fAzy5ozdheHv_ir4os2W2jVbr-t-rAHnzJ6xNI5W6NIIyQYL2nl9SyllDUplH1zgkFh7l1ApXgdDSXxtxFLE75M209CHfYvBDYT7qYXk0SpMWlSIJQvSvb-pUYL_H2a042ipKoAcg0qlnY-SMkX_KXp_7UKowfPLQ6JEirrKW9F_lzkxfZF20lFulnfng2g3ebeQ5qQBB7SCqDxCdyyRqR516IEaDmahac1VV1NwCrFcoN4er_4vULq5j7quvWDEk7ePUhQscqNtI16DLtEI76uU1etNEoGPu2AdQ0TnAxf9z6MrS9GjihgYtqw3bZry2b_c5WMkCeLlEunm1t3XRxwydtFH1X88T_vb0DW8A_cJ376e4dgdNiVa_CxJ3x2H2oOV0FfIWpxj81uOlgv66YFnMICBWpzH0TBtWlRjgMGDcf94slc6ZKjHr7BTwm4OUGb66xEsXV-sQ8KuqpS7PdTlzcTIGt0Y4cgdN9KFfwVF1bQ-Fs_NxW1UqMfWUsZNhASUNqdupprWRxfNFjSIGRehnK3oPteCyUqhvy81MPdk_QccGkFGbeJyj3KsidQiYnTYAdYTNafrX-VxOukI6oh5KOh5sSSWdy9Dbx5EZAAybq2StAUZqdAZIVS0RfN6d4Q8DgzTe1bPfo100D2b70zCsxdLwLOtykyerhGfwsufe9ffOlBjqfo3WLI5j-daP81QyzvDeBQlO8hnKno36Aa5O_tXlZ81fsUs9_4M8wnBZPYdxcqcCt-w9ESJCcdcgWooe8gXKnWhVhWQwrYRYXnhaCq0ql-J0dE3sgGSJss0JG6jZUrO2pYtSmAiVfZTMK4JQ5j0Soesco55XHyoCGUE93Ru7gYaImxVEwnvSc16NpjRPvbY22vV7F2Q4Sgmm17f1rDqxTd8aD13S5oi-0TBlLStqWvl37MBCQl2jwQ-e4RYyh-iGF_eg-AkLjAGC_SFGmnjpojJGAP6dFRo1PFfCJpp4OLoUhD96BncQn9w4hAdGvKP2mgYbcjV5en4RM5aI8u035SzNxIctZLi2bU03g8-3TTxWFXR8Dkbk885OltT7h150H4hFaYBnvb2kCi1L9bnK_RWsp71Lk_Hsfv-RmDk9LMQLcLeNLiJkkQZpVpSoCqS-3QoJHDFRIuxRpXzejzp9yYT_R6vNRIAJCFtGP6j8GPGg2R6LmvQLZJZqOsCPfxzv9A0UjeyBIpalHSnMJG4tDujE0NC13PeVn3toROM7qjgbN6QAbJkcCKe4M8Mw-XMDf_eriQ5vkgdEWN72JIFPwMbllM-65oBEk_wF7hP0nN7AcrfNsyMBe3-gFvA0T5DdCY7x9OFCSCWKnLWykGYCxOniFus1Zam0K_fzy3KXJNUvH-is6JqpDB21yxE66n6a8j2HHJ2AzQgsSD9j92RgM6xNd0r8Win5JcATL1qdyP_PA56Y-iYON4BFCsQgB6qL6L-dPR3oS-xLnIAL6a_5N64iq3-v1uxzPfPYDQEzSPZCJ2S7_p4vcdTzGuRpU0vUIK58jsBhBu8usKjpGuOHrRr2G21iUTC2kmMYoTYERD1KftkmYjdMIAmK6HhndNKMaz7STtiMCrpYO-fU7pgY7bB4C2Zd5tAivQ22ZTxP50jR8WIBIiPGO3BgQKnB8XeqF9y4BLZsp7e2jH4hyxQdb7uDDsnfnOiH0i5v1YLPPU7pU3uHkuC9xCfiUkRlLrSRWTOqHit6SHO6g4Bd5WsuHXlCV93v5o_k1h6G4lyx9Z4XIJon8_st2XQ8L85ZIKbqo3YriUBN-qAsYH3a_ZJX_xQ38PHNIXsmmjM5ZO4zNeXHoZxNHwTrOaEtNC_Nq61Ay0_9vCdvgBOaq4AvmTf9bgYbyJFoD-DklNRljVYNCN6m5ln5youo7ATs48YqTTyogAAXwWf8MAtk_9UKXLnpLKhc92MtPtoHNCx5TYHhEE30yfIq5lE6He3becLur_EgkoipReUHh1ZK-LporCJh1dXBZZFySNq-uaxdqtv9yXW_xpyP6MCAPjydiTwZZ06dyGUOP4nhwKlZeq1x4lfPTecBhrnwfntloUvdkMYzokEtHbUDm2K2tFV-0MVxu3aJljQ1A5Kk3wvBs8xsGUMcuuWydhNqLQYdL1w9sNCla3mCtOV_Run0e_dA5hszYbPshHjtADgRrJv6gOePWAT9bECaqvZtvCp9ufpJW7ThhKPxd_qZvEY8jm-QKwMZQGPSz6EqRrISzDhjaAn0VlowGoE7zVvZxboWiY72R7kdKtt1oPoO73_Bvial0b2uDOY_BNDLk5s7wX5PNsolaf9yUOiyYt6p9jlkyWKvIxIiLTpWFDtrZNQw7-E3seyQoyHuRwCr3O5sV4J70be0OaLShypE4McDjjJckXL_YwlPrCZzTMDdcy_e4V2AsGkP3kcUbcuOIkjgOU8IDqVhUHtFH7eWOm3WqrAjgHaMsSrDYLWTA4VLyPhA3CXg_qiiIoT32-CqRa49DSkt2cA0GA0XEyFMjcpMZ7UJzwe6LK0YhN-UH8__g23-Mq6r6_mzJtpNntHXKEKfwh8gpIwHBWOsfUQzVTrGr6A_fS_EvTHOUqTiaoxEbXzuw76K36FwvKGlIlfwznN_I591rNm3Srcc70TOqWQk5RgWFYhh_X0t0XY7Xeob83VyeEZlYBtLQIOtiu3GB547KpunyRIQo2aWgbO9yZzHB-n0qR5Ic3dbaUyT11Lcqmgc05dvVQ6uA4SUXSd-i4amZT2_yPIlQaNEUiqTBLkE8rzknmeRQ2DWHfTqaKqQYIROJARmLkTAbFgyP4nYFjnsd8ULUZXzj8oSQjs1JDVyAm5Ql8RWpVoX3ggNCDEgWux9YoF_sqFESSfwJJZJjAmsoTat84KuwBIgWd9fol-pNQ9kuMXePQzKJbB8wQt6JVqLfMvx8CJ5VoQ2w3NgIWzxbOIvfQdiMGMca4ARN3bbiIcMV2-R_3Y7cwP3Wf2lAJ93M2IRb7nWilf_BdtjmzjaiUr3OvBghWGA2h0IvIbOWKyaNGHidyQOF6bmf384nhxnd0CLv7nTk46BiEjjCJEoVhyKDup1p_q1CROnGP_1krpKugxNdf3WZYJPTfEIhS40ISpn0iu_TZcmhN_BvEloc8883CH2EV1e_ooWKvCs_W6CP_o4Y_YoTDAkzPkWFwM-yAKQyb39zPd3NNMuifWoIZ_uiAXgvzI-ujpRdYrEkLc2Ft-GZiH8U6NTYUCFXe7txDapmJgyH7h9Q02pEBnclnRR03EKzKTjbOgOStSd0hn83HLcHL8dDmrGZlXXSVcW5rrzkPqZMrZ5Geltg29J4mMJA48VK6lzIuOm2HxswEbn7L1_oRLz5cFR0jdckmYcj9V3J7z9EAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAABgwQFRkf",
    "message": "iw",
    "context": "u27UFMkKfpa0Z6sqI8OF4wHdkI1L0Om8Jxjh69e32FluegdZkJNPA-MD2q4Ae6299HiLu8Sdy8LHZagZDmKZjxasptCAeVyNmFQrF5OxIdAx8E1xRu4FFEuH0-0g6FgOGm1gIkzfrkLq0anKshdKmlPJAWdxtP12zvKwLrtHX0Ie3S_dTHWZM1i-JkNl1Af7to40fyp37EpLrJflEgYAERUOng"
  },
  {
    "tcId": 43,
    "expected": true,
    "reason": "valid signature and message - signature should verify successfully",
    "publicKey": "jLH3CxZ0xMeMRkkhiofDTendPp-RMMTXWU5-3JIlj_7xCbsEeNu4BhLA3_MKi_Jrbl-frwuCxiNU0vqaZ3KicvRXSp6iw6YMWJX_nioc6ir6xWA4SSrDc6_zPIyFtGJ8Q4BD49mn-c8ONzpdwQwk5Oj22HD8R2MmFDD2Rf9dwGR7ZRoL2ioMy6kYCXgRAUVNXuhB-sXaolGV2VQtl7XfO0uCJWdj8WBJ8vzXdUnHduubtuPgei1C9xDKugQwmg90nvfXFhBh2E3pTl11u8n8WQkHnUSBTSbPuwp7JT_WqdTsP6NM6tuk4no6funCRCd1HisgD81UlrPeENHKLz3B7-XX-qFTW_nThiSA6wbqwWqyW6n7CyyhFOwA2lGylVIOLGZ1rSoAiz7OeNpZo3OsyvtfzGMQa6zdp6IoxyF9XGQkHHnRcHU24BTlaN92a45v0GJbS8SY3FEGwr4TmcVlIc0xenEghIuujIeYnHE34s5CzX-HqTSVthvdMMBmQG_Be05lMCTCyOVQnUgmCj3uUBoQ1SJRqoSum0NXfGXmMJQc6sOAmWYR90b309tGe1PDmv3OzrxSfuPYF3-scS189j8ZZ3tBdb2x1YcTJ1e7xsYFwdjZYOFdG5MBGcd7iOOvl5Zr5XRgrez1ti_92A5wAmVFbCbmF5i_Gq3JtOn1fj4ruG-O9lKpjUFs0P9jfhYV6GB42iNQDsbAWTODwnkmCZbfg6mevwGKqLVa3KLkVF3zf1XFj9ojAIIBoHWNrkqSwUYqvW_dMv6ufLidU8K2vFvZDUG7vs2DmQe8hbPhINKStLqPQ8MJDW2xSpgMW4Ka62r-1wujLpFZ-DzI1sKqwbssx4HXwIXM9QNdyboE5eHIdBzIDgTaDhtDhIkJ7Wj7A6QUqPtfGa8FrF3XLX7wRW6SmyrXD81xhWPyXOqIrHM6GrDsryhu4fbdQ9pcptp4TrZIwLL2ji8IhEYO88E0V6-AtumZqfXdMuLLlURczTpRgIUc6WINRLiknFD86tMyrvyZmMy0rIisP4T9v8KfU0Qlh1Qt8BdL1WPfprXjsFCDHgZDto3oYbfMQnOu4L_ZONTfNnXeB1pA-3YOSAx1Fs5mlf1Elray_WMU-d_xXgWoQUw6POsPwTInCRNIkAZRKUC1Y-_xwqLhrHqSJW1kfj-bSu7GjqlRa0ovKplz984vKfK_rfE8TzyN56KNen9RteyYjtKbKly61g8lxq8gvtBJOM5_uqDrNQEKveIqHiInshawucmPyzZGeDp279WEpEGf-5gtl-neiFQOiICvmDZqTuBiwW7RlYKXUuwBS28RpGM91xLYfngiaKtuD0960ZfVdgernmxsQ0iyXXN-uZRClfrJJ4e6Ox6Fv5JkwkMxKQhLYiUo4G6Cv24CyLnpQ2szrVbugAVokKeIRtugOKblGKWRICZykm81Am75QcBIpx2HVHgXc0yqwCprxCD5IrukXXEMkZXWy6Qwp-t9AuJs1528eGYNxdE0T6JmVxJdtadoizAS-CWDAOyBF3fP1fe8PIozKtnrs1EwBjO-ZosAsy0jkMYQ2NgDDyPuUPL3M4dcPtInaZ_onogHgq9yYCdSCK1iNVYeoE-6zLdYS9NPSabunBrPktJ-uXu08B8dbZIgzeF8DYwstAEOrDNZdIPSbcvRlH16LbeS3uMc4nSJodfJXmtwlqvMzbYQ8KuAC6nGOJ7ByDCj5MLBiolDn7dXnTKCpedGIwjIWMTK57yKPq3WYSIdtLE10J3c9KKxZdRhR7gQzCihxXj4A0XSUz5Lh9TjzIkqxbQguUQhBFIqytWfz_iiRTEqTRgxFIrVGoLhYb6ZhVv5eg_7m3KYZKw9FjOBPUAI93K4gaorZ6ofzMWFTJS_b8hiJULjK9xk-6NjnlWiJh9a_gcg_GxE9UMb92bgp7VjA_kf2Y5N3j7hImhAKX5vycAT4ovnLBguitC7ImtzqsjE60lyevE1XzI2s67XMgEAdN9ueemUNtw6-dV41-ilNTpqlRH2AnOLoMAGkwTP5lS3LDjQWT9sot-ynRK8spNTeN5tD7Xz4QlHz163BH0MkquoRFN0_zXu2S-zPuyYODe4PWZua5SQLN0AdHu0Z-aUGAGd3KPuxRamlSNkHTPZer4_PS1KF7xSqb_dfMzcFWMAOIo11RxaDT-nhAp_PKwf9EYN2Jn1il1LpqllxjfY69wEAnkXsqMPa3Zq5q3FdOtzjUlij99I0_U9Eb0VhxEnJJx9QwWK1sTjHyLcu1byZ2gVIt3JbyvKDuvkG2Lu5Z9Iu1xsc50ndsV03_C7FS1cQgJe-lHmEPM5pwdyymh3JnGc2aqf7yat7T7SrFLikaooMJ2URpMzBbabNWD3_sraMYcuTqk7lJnQWtU73lPRlaGNHXqeK5lTnqO7oex62bz8k-l83fTKOSvynkJ4qBTJIq28iEhpuLArAX3DFhrslP0ztbtMaQD4jnkaAviYqqe_z_xymXSj6j4We_fOcoE1Pr3_AfWWhqSo-rjQO2ej15Hz8SZg_kX6oz3TRcBACB9pA_H5H-g2RA0PfzsD4c5H7TUFz24ni74XrVuUqXTyS1-mxDV_Pic",
    "signature": "mtG2W7_COJDkWq-hW3hAp7rAwhAjbgXcSNfowC3rpKLzhi2Da67bJV34jKr68XCn3VB-n1r1vRB4Twvd_YzJdJ1FIcR_sRnAAsDL1OqEaWVfqzPWZNEu_JZOo0BVxNLCt_YetbLz7LL-jeXuiM0iQowO_zsjWCY20OWGBShoL6C5U8bjBMNEowZNRPW3J35P-fpNHbVHakIqOr-IzqX_lstnSXJUID1hRvacRJuxoODcl64ESq72exwKpbZUcgTH26a48F81mUkGCjKpZRWbwp6mFQPgugqrY4eB8UjF7glsmRzMwLDyfy_60dnr93Gbd6OWlkCd4p2O7LEJrWtyfAHLr38kKX-vAVLrDdX9YMJGrWPcEXG0WyEoohA6mKVrC5RZM1DNpf2_IvJLL3uAsYuub4fgpATX3afpvZfl5vlJ-8qRFmbYBvJgHvnd_4fOQY-i5zHo6NP9AOvudaSh3cAjZAX0Uf7Qq8GQn3goIfVhy7r-COkzHXWFQw74TnxDBRNz-B2qb9a1QJDj5nkndjKlpiZp5dWriNWMU3L7C0QglT9KatNCZfVhXCBo_7oagZECZ6wArQDzDDJQoguF6-VOt68hdfIOWssd3i6UPUQHN-wlt_Km9LqNYca0drSBUSA8wT5IlgcMlLFOUiYt_AEGN8t006hA1qm9oEwcSoiPKVCtTt__MFJayjufEPm5g-OaS_bKhz--Zfpy5n4TceLMb37q691xMsIixvQkPYXGBd6Acehiu7v76CWONLOT0X7vMUK-Ps1ZMrHYS2XYTR7j_b93HBwJ8N8S4zq258lbV4jZc2n22zw_SOEfpG6rOeWxWDr8oPpXRTKSQ1bhe3tewOScF2MFqGscb-HrTseCQMdaMLplimmVnIXTawuFLsUppgLJnnVFBHhmLCX2Cv1Pt7yKJMRCxNpb0s2ewRsRo1zdS9xUXfCtSeA9e-vU-5msmE-DCmeXhJBablGWfmxFdfNVVRlEi1cjkeBrGqPij5LTF0Gq0AYhML1XkgaWmh-a--Oavm4MGprf2wViYPKlpwAGTcJI2KEPwEkY1xcU6JLUF2oMOZBysULQk2dj607hnyqwX4iTa4GLXKztWiN9ZeLhwMe0mOL8x3dUllcVgEx6_CdE4eVKlczi8G5_gwHt5ki-l9ehFSSL3g97vrjqppo7TpawpQj2jahKjMFSVydwIclyCPowoNJ4so-UBY0TFGIx0RycF57UuJPj0Zgctvoh7l0_2lnNrdkqFx33pCptPXok0aeKQ7LJusLSAfBoA4eqe4MDzZ4ce0kl0IMJwnMubiPhOatAKjeHt3wVY3Io8Fa3P9GOFgCeWM7gLMpFSB85pdhLquwKPvfTDWpEvV3SsOziczyJAuz8Z1wAmCnGflZ20wbk7K5KxIquosrY7AZxhfOw8zMEw28EwYlr1kqBs20_dhDOrtSyIr0k-Qk5474YORLU0V0bXJ4RJWaHJ2Wo7fEN5rd_T-firoUBL37MVgv0LuwRv7oORdkMG_7Tsxc-J6oTT9MdQvyitmF9VTriskfIwQT0NtOJG_IscJrIbPmuOi1aH_24TlpxrEh_jMSrHfR6J3yWJz2KvvY6VF5wKoJ3HQVqichEtm4W-Gc2SpKLHiPxqpj4rcYPPnNPYqFjT7AmbqaUTJjlZtl0OOJd51L4-avYwdUVoRQH1qBM6vXx99wLlP-d7x_RfG4ZVlWZJ0pc9SYjV_yj5jW8_SLGnufgxbMykltfU-9QAtT6eErxXDz7m2Z7fqhmBXxZVCwch_AV_aRnCF5OLTcPjra8bI4c8jLCyObTDQ-UOa4Fmfo16eCg7ZPZBWK_oS2hJqEMkIofwPEckt53tzoRV3mW0GFTK9vsjYqHofgkCeKy22ITR7XsPs8fFmvz3yQkTAOb92cUh-QZ4QmLqqVHpOOHkP2CoF2wiM51e164AO1wnR46iDA9gHm24L6_jNtjF8emLJRL_3wqYrtpY5ycLEIjpZnqTmnLan6FkoX4J9YCvA0NZxIKYPi3kSSkHew2LYx6VNq_s10qVKhw9y2VRP2fJnYISHYwwnNRLlnizEmYxnfnTiwzB1qk3vEhicdTYKeiT_nZvipLoWMvWzJYcB9qwdIq2ybAERx_XUOB0KWy9g6mmaP9eFEGOqd3OKS5gZy95iyrhk7ZGPzHMwcwBhqoQybKbTkFP98WUKX9e_SuZPbkmQtyXK6Pf5LBnFbQr5T4F3fbT-w8barS3-yEhVeJeUBAOtb5FKNCZOlZUjqxo6RE_8qnmiklaOQ4uUVF8Psf-spq6V_xVdI9yX-j7g7tHdP92Hkqhs58f4KJ0oi3ksMuiLfGGrUIaODNNaGBHQT8xhxHn1SJYWMXzfh2Munc5DXdP9RoldFnkVAu9HCl4a25DZ4g4ZDzpSe7vEoQSkjeKNWyCMUlfJQxUM9VDDbF-m40eJRuLJCiv5Fr-NLOft9vNJo40CqqXjYUn-bdFVqHR8lNRMSZxbVxcwefyMwQ24utCGPf-ZzBP3vFplxNJ3QIdv_y77vdHyU_47Ro3CpaSJyc6mRWef4mVxeT8EL8qclDXYhjj8QnDeYP4Sf59vrf9Imygcrm_R-ouk8kqqBbwmKmfdwZLHg0I-SkElkvLwy_TwOgRxYFvaaJTRnWHkdBlSXFQ3sL7UBpvRNcMMjyBJYkMiwdtNtvVOHMepJ-DdTpexpsKeTHp2yKqpUbtuQXRMH9U1KlliVh-bY7ZKexZ1SHsqbEVJYkjdy0u_A-xqICv677-zLwSqtYZciOBoTTay76l-qWy5Tvf8Dm_sA5aNHyrFSWQl_JOsPh38R7cFwkfvy1YFvdjgXL6xHjzaCYtpH45xES3V7X2Ew-Am3fqpYn2rUm7WtfVfeY9Xi4xfa5RvYfEWI1iSyisJPt-X2iMmZJfT-jxiJoV5B0vBzIuPexO9n-9DXwS-lyu4T0AX51iXHrm9oSaMVqRqMC9Ls0ZaEHegNqPDEGus2fS8fvEXfQNAUdLl2nZquMQYOL9rMSCANOVoZt2K_PxluOreNXQ7Isfc14frCrx32RK3-wycolEf_65F-Zm4OAsReaHxigzp4ZturnrI19eP6fQe-Ns5zPwjpMHacZKgz-e7kW--HMy-Hs82_6_IEhf4A-W3sz8cBkkBjMPCIJnzJTOCVbcY-4UPdxijMM-y60sU6pkDiMnI6cm2KmYqxqMS-NK6y-_AMjZFl77Z8K4UUUSggE8r8YaUEYt69-FZ-eetIrGyGCbjyvZ525sKxytrTrUP5DuwWSgtMM6tZw-ZnTwB8fysA8p3ADCDiizsBkZixsU9EMYBGP4KdLI2GL-5j88ifhcR2A-9wFcRHm4yA_U8sEOymU2Q9zIAD0QLLaXnxlwsEHOPU09VVi3hagPfLykJ5XB4qxAqX2FkuLb0OXq7UvIl0yISh8QKHrQGdlankAaiqdDcZKKdDniW_jPelMJhvRRpbxsz_xmyK8LB-QMmNtMj2Lh1PwTw3QmdoLMSxlp9qB1mZWhiKG3yBd2CQ5sLY884fpXJTr_EBuXDfP_Mhakw3vjrl3CrfGLK1-WP3bALcNiI6binjwNyUJ8iEVTUwtRvuzUhuYEm92rBcd1fcelsZDGMYi7CGRZHT0m-HMPDNAZRg593xKVOAHxOgrCxMsc0zhNdVcOunFFwpVRdOwPlJDI-c-TRXcxVpxSKQl3m8IHg896aAa7GobLxB5pDzSL0g1ktKHW6BQ2eFwi9CqGuwLcUOHErS0V98jWEAcw9e8_bv0IWKEt5VlBAVX1aZXIc-Nw2ToeWrdc8KsDmYzxgI3C_6P_FSuZm1k7CMB7QxQoO5hz-J7NO8bjqYF4p6m7h9jSD-483vECFqysoz8Yxexa0cKM0RbB9dqSlNkl2OvoYzgAZhVEc8GB0dKnFIGfuy5bYpVrbXuR-x2qOb-P_RXRzahTPZsJgfhTITdKM6y9dYmmljwOgN-wylcoPmW-QfIxtoODvRYOYkPgRJ85eGReymJMY97ZHlG6ZI48b_H3PUx_aSXKI0SbvzfO7hPJH9hGMHPsnLAYw51GKzbxmCq2LlBLUP6Rqf2P0Paz727PsA1fySdpV32fMwPCaPfRg5gTh8D6lXMw-vTtrdm7H0zZzTkiO1VsQT1F_VhauH9hDfCJc-2gWcxTg0CWNrw3bmTWByxypQzKpe8D1ZKUlRpnqkt2h8bexe82aZMpMWhYZ9UH0BYOqB_UiuI_oHEAlLYfPqmqd22ZhhdHFcbG9FhtpeaR7NEfHlaert112MeTN294wDxm2hPfCGtJUV4QbD2cvvFqdgW0Ob8UermgW08K4_i_cc_YsfR2-keK1FUbKm4yjBEU3d6h5GmBxsvMTpS6u_xCQoPN0ZQV2yLr-L3HG6KngAAAAAAAAAABg4WHysv",
    "message": "OlEDlZ8Nr3gM_c3jOk3gtn-Yio3q_1FTvY0CnPCn3caArqGTi5UdVHJlLg-lxnpFyKmuO7Pt29zljiu9YiHeOg1zqrWTqWAu0z56xts34ulKZL7P4uo6KmM1PevE8JLsKwpGh6_Eqod4kCXtGD8RI3rwrvUOCURU-ll5PjDZv_grkgXtWlzZ-FrM2CY_NITdc27FhOm-fzD3oeSIvQVTUbdkIpwchQ",
    "context": "M5qNelH8FV5p_R3D_rE2qYd1xACMt2f2bgS1cywjMrBLL05KmRtwJgb8jGDAcUW8Cxg_UECXkYLkJ5XCIhxb9V7eNENtQsLGxgWYHjpMHQTH14-HGZGOgHO8jFviNyueGset3nYNlJugWOLOGAU_cYJ4-k66drwMvKpRAt5iH6jTsCN5vp99wiZK_tadSyvEvmq9AuA"
  }
];

test('ML-DSA-65 key generation matches independent NIST ACVP tgId2 tcId26', () => {
  const pair = ml_dsa65.keygen(Buffer.from(NIST_KEYGEN_26.seed, 'hex'));
  assert.equal(independentHash(pair.publicKey), NIST_KEYGEN_26.publicKeySha384);
  assert.equal(independentHash(pair.secretKey), NIST_KEYGEN_26.secretKeySha384);
  assert.deepEqual(ml_dsa65.getPublicKey(pair.secretKey), pair.publicKey);
});

test('ML-DSA-65 accepts NIST valid tcId43 and rejects modified-hint tcId38', () => {
  for (const vector of NIST_SIGNATURE_VECTORS) {
    assert.equal(ml_dsa65.verify(Buffer.from(vector.signature, 'base64url'), Buffer.from(vector.message, 'base64url'),
      Buffer.from(vector.publicKey, 'base64url'), { context: Buffer.from(vector.context, 'base64url') }), vector.expected,
      'Official NIST tcId ' + vector.tcId + ': ' + vector.reason);
  }
});
