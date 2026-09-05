#!/usr/bin/env node
/**
 * Independent black-box integration checks for a running Cinder Rail Worker.
 * Run: CINDER_URL=http://127.0.0.1:8787 node scripts/smoke.mjs
 * Defaults: two short-lived sessions, deterministic hashing only, no AI calls.
 * Optional: CINDER_TEST_AI=1 or CINDER_TEST_EXPIRY=1 (waits for actual quote expiry).
 * To save public AI receipt evidence, also set CINDER_PROOF_PATH=artifacts/live-proof.json.
 */
import assert from 'node:assert/strict';
import { webcrypto } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';

const crypto = globalThis.crypto ?? webcrypto;
const base = new URL(process.env.CINDER_URL || 'http://127.0.0.1:8787');
assert.ok(['http:', 'https:'].includes(base.protocol), 'CINDER_URL must use HTTP or HTTPS');
const encoder = new TextEncoder();
const checks = [];
let httpRequests = 0;

// Kept independent from src/protocol.ts so server canonicalization is checked
// against a separately implemented JSON encoding, not imported back into itself.
function canonical(value) {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.entries(value).sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0)
      .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}
async function digest(value) {
  return Buffer.from(await crypto.subtle.digest('SHA-256', encoder.encode(value))).toString('hex');
}
function encode64(value) { return Buffer.from(value).toString('base64url'); }
async function request(path, body, { method, timeout = 20000, headers = {} } = {}) {
  httpRequests++;
  const response = await fetch(new URL(path, base), {
    method: method ?? (body === undefined ? 'GET' : 'POST'),
    headers: body === undefined ? headers : { 'content-type': 'application/json', ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(timeout),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path}: expected JSON, received HTTP ${response.status}: ${raw.slice(0, 180)}`); }
  assert.equal(response.headers.get('cache-control'), 'no-store', `${path}: API responses must not be cached`);
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
  return { status: response.status, data, response };
}
function expect(result, status, error) {
  assert.equal(result.status, status, `Expected HTTP ${status}; received ${result.status}: ${JSON.stringify(result.data)}`);
  if (error) assert.equal(result.data.error, error);
  return result.data;
}
async function checked(label, action) {
  await action();
  checks.push(label);
  console.log(`PASS ${label}`);
}
async function keypair() {
  return crypto.subtle.generateKey({ name: 'ECDSA', namedCurve: 'P-256' }, true, ['sign', 'verify']);
}
async function createAgent(keys) {
  const publicKey = await crypto.subtle.exportKey('jwk', keys.publicKey);
  const session = expect(await request('/api/sessions', { publicKey }), 201);
  assert.match(session.sessionId, /^[a-f0-9]{64}$/);
  assert.equal(typeof session.sessionToken, 'string');
  assert.ok(session.sessionToken.length >= 32, 'Session read/quote capability must be unguessable');
  assert.notEqual(session.sessionToken, session.sessionId, 'Public receipt session ID must not be the secret capability');
  assert.equal(session.balanceMicros, 10000);
  assert.equal(session.unit, 'sandbox-microUSD');
  assert.ok(Date.parse(session.expiresAt) > Date.now());
  return { ...session, keys };
}
async function state(agent) {
  const current = expect(await request(`/api/sessions/${agent.sessionId}`, undefined,
    { headers: { 'X-Cinder-Session': agent.sessionToken } }), 200);
  assert.equal(current.sessionToken, undefined, 'State responses must not re-expose the session capability');
  assert.equal(current.balanceMicros + current.spentMicros, 10000, 'Ledger conservation');
  assert.ok(current.balanceMicros >= 0 && current.spentMicros >= 0);
  return current;
}
async function quote(agent, input, service = 'hash') {
  const result = await request('/api/execute', { sessionId: agent.sessionId, service, input },
    { headers: { 'X-Cinder-Session': agent.sessionToken } });
  const data = expect(result, 402, 'payment_required');
  const value = data.quote;
  assert.equal(data.protocol, 'cinder-sandbox-v1');
  assert.equal(data.unit, 'sandbox-microUSD');
  assert.equal(value.sessionId, agent.sessionId);
  assert.equal(value.sessionToken, undefined, 'The secret capability must not be included in signed quotes');
  assert.equal(value.service, service);
  assert.equal(value.inputHash, await digest(input));
  assert.equal(data.signingPayload, canonical(value), 'Server quote encoding must be canonical');
  assert.ok(Number.isSafeInteger(value.amountMicros) && value.amountMicros > 0);
  assert.ok(Number.isSafeInteger(value.cumulativeMicros) && value.cumulativeMicros >= value.amountMicros);
  assert.ok(Date.parse(value.expiresAt) > Date.parse(value.issuedAt));
  assert.ok(value.id && value.nonce);
  return value;
}
async function authorize(agent, value, input, keys = agent.keys) {
  return { sessionId: agent.sessionId, quoteId: value.id, input,
    signature: encode64(await crypto.subtle.sign({ name: 'ECDSA', hash: 'SHA-256' }, keys.privateKey, encoder.encode(canonical(value)))) };
}
async function execute(body) { return request('/api/execute', body, { timeout: 90000 }); }
async function retrieve(body, result) {
  for (let attempt = 0; result.status === 409 && result.data.error === 'in_progress' && attempt < 20; attempt++) {
    await pause(100);
    result = await execute(body);
  }
  return result;
}
async function verifyResult(result, value, input, issuer, { deterministic = true } = {}) {
  const data = expect(result, 200);
  assert.equal(typeof data.output, 'string');
  assert.ok(data.output.length > 0);
  if (deterministic) assert.equal(data.output, await digest(input), 'Hash service must execute real SHA-256');
  const receipt = data.receipt;
  assert.equal(receipt.sessionToken, undefined, 'Publicly shareable receipts must not expose session capabilities');
  assert.equal(receipt.sessionId, value.sessionId);
  assert.equal(receipt.quoteId, value.id);
  assert.equal(receipt.inputHash, value.inputHash);
  assert.equal(receipt.outputHash, await digest(data.output));
  assert.equal(receipt.amountMicros, value.amountMicros);
  assert.equal(receipt.cumulativeMicros, value.cumulativeMicros);
  assert.equal(receipt.keyId, issuer.keyId);
  assert.equal(receipt.service, value.service);
  assert.equal(receipt.verification, 'signed-receipt');
  assert.equal(receipt.mode, 'sandbox');
  assert.equal(receipt.unit, 'sandbox-microUSD');
  assert.equal(data.signingPayload, canonical(receipt));
  if (deterministic) {
    assert.equal(receipt.model, 'sha256-v1');
    assert.equal(receipt.usage.inputBytes, encoder.encode(input).length);
  }
  const signature = Buffer.from(data.signature, 'base64url');
  assert.equal(signature.length, 64, 'P-256 WebCrypto signature must use 64-byte IEEE P1363 encoding');
  const publicKey = await crypto.subtle.importKey('jwk', issuer.publicKey,
    { name: 'ECDSA', namedCurve: 'P-256' }, false, ['verify']);
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey,
    signature, encoder.encode(canonical(receipt))), true, 'Receipt signature must verify independently');
  assert.equal(await crypto.subtle.verify({ name: 'ECDSA', hash: 'SHA-256' }, publicKey,
    signature, encoder.encode(canonical({ ...receipt, outputHash: '0'.repeat(64) }))), false,
  'Changed receipt must fail cryptographic verification');
  return data;
}

try {
  console.log(`Cinder Rail HTTP integration checks: ${base.origin}`);
  let health, catalog, issuer, main, other, initialQuote, initialAuthorization, firstResult;
  const mainKeys = await keypair();
  const wrongKeys = await keypair();
  const input = 'Cinder Rail: verify the work. 火之运 🔥\nExact UTF-8 bytes matter.';

  await checked('health, catalog, security headers and public issuer key', async () => {
    health = expect(await request('/api/health'), 200);
    assert.equal(health.status, 'ok');
    assert.equal(health.mode, 'sandbox');
    assert.equal(health.chainDeployed, false);
    assert.equal(health.settlement, 'nonredeemable-test-ledger');
    catalog = expect(await request('/api/catalog'), 200);
    assert.equal(catalog.unit, 'sandbox-microUSD');
    assert.equal(catalog.services.find(item => item.id === 'hash')?.amountMicros, 10);
    issuer = expect(await request('/api/key'), 200);
    assert.equal(issuer.algorithm, 'ECDSA-P256-SHA256');
    assert.equal(issuer.publicKey.kty, 'EC');
    assert.equal(issuer.publicKey.crv, 'P-256');
    assert.equal(issuer.publicKey.d, undefined, 'Public API must not expose private key material');
  });

  await checked('invalid keys rejected; two isolated agent sessions created', async () => {
    expect(await request('/api/sessions', { publicKey: {} }), 400, 'invalid_key');
    const privateJwk = await crypto.subtle.exportKey('jwk', mainKeys.privateKey);
    expect(await request('/api/sessions', { publicKey: privateJwk }), 400, 'invalid_key');
    main = await createAgent(mainKeys);
    // Reuse the same public key to check session isolation independently of key mismatch.
    other = await createAgent(mainKeys);
    assert.notEqual(main.sessionId, other.sessionId);
    assert.equal((await state(main)).spentMicros, 0);
    assert.equal((await state(other)).spentMicros, 0);
  });

  await checked('session state and unsigned quotes require the separate secret capability', async () => {
    expect(await request(`/api/sessions/${main.sessionId}`), 401);
    expect(await request(`/api/sessions/${main.sessionId}`, undefined,
      { headers: { 'X-Cinder-Session': other.sessionToken } }), 401);
    expect(await request('/api/execute', { sessionId: main.sessionId, service: 'hash', input }), 401);
    expect(await request('/api/execute', { sessionId: main.sessionId, service: 'hash', input },
      { headers: { 'X-Cinder-Session': other.sessionToken } }), 401);
    assert.equal((await state(main)).spentMicros, 0);
  });

  await checked('HTTP 402 quote commits to exact input, session, price and cumulative spend', async () => {
    initialQuote = await quote(main, input);
    assert.equal(initialQuote.amountMicros, 10);
    assert.equal(initialQuote.cumulativeMicros, 10);
    initialAuthorization = await authorize(main, initialQuote, input);
    const current = await state(main);
    assert.equal(current.spentMicros, 0, 'Getting a quote must not charge credits');
    assert.equal(current.receipts.length, 0);
  });

  await checked('invalid signature and input mismatch cause no charge', async () => {
    expect(await execute(await authorize(main, initialQuote, input, wrongKeys)), 401, 'invalid_signature');
    expect(await execute({ ...initialAuthorization, signature: '%%%not-base64%%%' }), 401, 'invalid_signature');
    expect(await execute({ ...initialAuthorization, input: input + ' changed' }), 400, 'input_mismatch');
    assert.equal((await state(main)).spentMicros, 0);
  });

  await checked('cross-session replay fails even when the agent public key is shared', async () => {
    expect(await execute({ ...initialAuthorization, sessionId: other.sessionId }), 404, 'quote_missing');
    const otherQuote = await quote(other, input);
    expect(await execute({ ...initialAuthorization, sessionId: other.sessionId, quoteId: otherQuote.id }), 401, 'invalid_signature');
    assert.equal((await state(main)).spentMicros, 0);
    assert.equal((await state(other)).spentMicros, 0);
  });

  await checked('authorized real SHA-256 execution produces an independently valid signed receipt', async () => {
    firstResult = await verifyResult(await execute(initialAuthorization), initialQuote, input, issuer);
    assert.equal(firstResult.balanceMicros, 9990);
    const current = await state(main);
    assert.equal(current.spentMicros, 10);
    assert.equal(current.receipts.length, 1);
    assert.equal(current.pending, false);
  });

  await checked('signed replay needs no session token and never creates a second receipt or debit', async () => {
    const replay = await verifyResult(await execute(initialAuthorization), initialQuote, input, issuer);
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.id, firstResult.receipt.id);
    assert.equal(replay.signature, firstResult.signature);
    const current = await state(main);
    assert.equal(current.spentMicros, 10);
    assert.equal(current.receipts.length, 1);
  });

  await checked('an unconsumed quote becomes stale after another quote changes cumulative spend', async () => {
    const before = await state(main);
    const first = await quote(main, 'stale-quote winner');
    const stale = await quote(main, 'stale-quote loser');
    assert.equal(first.cumulativeMicros, stale.cumulativeMicros);
    await verifyResult(await execute(await authorize(main, first, 'stale-quote winner')), first, 'stale-quote winner', issuer);
    expect(await execute(await authorize(main, stale, 'stale-quote loser')), 409, 'stale_quote');
    assert.equal((await state(main)).spentMicros, before.spentMicros + first.amountMicros);
  });

  await checked('concurrent copies of one authorization debit at most once', async () => {
    const before = await state(main);
    const value = await quote(main, 'concurrent identical requests');
    const body = await authorize(main, value, 'concurrent identical requests');
    const results = await Promise.all([execute(body), execute(body), execute(body)]);
    const completed = [];
    for (const result of results) {
      assert.ok(result.status === 200 || (result.status === 409 && result.data.error === 'in_progress'),
        `Unexpected concurrent response: ${JSON.stringify(result.data)}`);
      completed.push(await verifyResult(await retrieve(body, result), value, 'concurrent identical requests', issuer));
    }
    assert.equal(new Set(completed.map(result => result.receipt.id)).size, 1);
    const current = await state(main);
    assert.equal(current.spentMicros, before.spentMicros + value.amountMicros);
    assert.equal(current.receipts.length, before.receipts.length + 1);
    assert.equal(current.pending, false);
  });

  await checked('concurrent distinct quotes for one cumulative amount cannot both charge', async () => {
    const before = await state(main);
    const values = await Promise.all([quote(main, 'distinct race A'), quote(main, 'distinct race B')]);
    assert.equal(values[0].cumulativeMicros, values[1].cumulativeMicros);
    const inputs = ['distinct race A', 'distinct race B'];
    const bodies = await Promise.all(values.map((value, index) => authorize(main, value, inputs[index])));
    const raw = await Promise.all(bodies.map(execute));
    const results = await Promise.all(raw.map((result, index) => retrieve(bodies[index], result)));
    assert.equal(results.filter(result => result.status === 200).length, 1);
    assert.equal(results.filter(result => result.status === 409 && result.data.error === 'stale_quote').length, 1);
    for (let index = 0; index < results.length; index++) if (results[index].status === 200)
      await verifyResult(results[index], values[index], inputs[index], issuer);
    const current = await state(main);
    assert.equal(current.spentMicros, before.spentMicros + values[0].amountMicros);
    assert.equal(current.receipts.length, before.receipts.length + 1);
    assert.equal(current.pending, false);
  });

  await checked('issuer key remains stable and old receipt replay reports the current balance', async () => {
    const currentIssuer = expect(await request('/api/key'), 200);
    assert.equal(currentIssuer.keyId, issuer.keyId);
    assert.deepEqual(currentIssuer.publicKey, issuer.publicKey);
    const before = await state(main);
    const replay = await verifyResult(await execute(initialAuthorization), initialQuote, input, issuer);
    assert.equal(replay.receipt.id, firstResult.receipt.id);
    assert.equal(replay.balanceMicros, before.balanceMicros);
    assert.equal((await state(main)).spentMicros, before.spentMicros);
    assert.equal((await state(other)).spentMicros, 0);
  });

  if (process.env.CINDER_TEST_AI === '1') {
    await checked('optional live non-OpenAI inference and signed receipt', async () => {
      assert.equal(health.inferenceEnabled, true, 'CINDER_TEST_AI requested but inference is disabled');
      const prompt = 'In one sentence, define a cryptographic hash.';
      const before = await state(main);
      const value = await quote(main, prompt, 'inference');
      const result = await verifyResult(await execute(await authorize(main, value, prompt)), value, prompt, issuer, { deterministic: false });
      assert.equal((await state(main)).spentMicros, before.spentMicros + value.amountMicros);
      const proof = {
        testedAt: new Date().toISOString(), origin: base.origin, prompt, output: result.output,
        quote: value, receipt: result.receipt, signature: result.signature,
        signingPayload: result.signingPayload, issuerPublicKey: issuer.publicKey, issuerKeyId: issuer.keyId,
        checks: { receiptSignatureValid: true, alteredReceiptRejected: true, inputHashValid: true, outputHashValid: true },
        scope: 'An actual provider response with a verified operator-issued P-256 signature. This does not establish inference correctness, prove model execution cryptographically, or settle real money.',
      };
      console.log(`LIVE OUTPUT: ${result.output}`);
      console.log(`VERIFIED RECEIPT: ${result.receipt.id}; issuer ${issuer.keyId}; signature ECDSA-P256-SHA256`);
      if (process.env.CINDER_PROOF_PATH) {
        const proofPath = resolve(process.env.CINDER_PROOF_PATH);
        mkdirSync(dirname(proofPath), { recursive: true });
        writeFileSync(proofPath, JSON.stringify(proof, null, 2) + '\n', { mode: 0o644 });
        console.log(`Public verification artifact: ${proofPath}`);
      }
    });
  } else {
    console.log('SKIP live inference (set CINDER_TEST_AI=1 to make one real provider call)');
  }

  if (process.env.CINDER_TEST_EXPIRY === '1') {
    await checked('optional real quote expiry rejects authorization without charging', async () => {
      const before = await state(main);
      const value = await quote(main, 'expiry check');
      const body = await authorize(main, value, 'expiry check');
      let remaining = Date.parse(value.expiresAt) - Date.now() + 1000;
      while (remaining > 0) {
        console.log(`Waiting for actual quote expiry (${Math.ceil(remaining / 1000)} seconds remaining)`);
        await pause(Math.min(remaining, 30000));
        remaining = Date.parse(value.expiresAt) - Date.now() + 1000;
      }
      expect(await execute(body), 410, 'quote_expired');
      assert.equal((await state(main)).spentMicros, before.spentMicros);
    });
  } else {
    console.log('SKIP elapsed quote expiry (set CINDER_TEST_EXPIRY=1; requires about two minutes)');
  }

  const finalState = await state(main);
  console.log(`PASS ${checks.length} integration checks; ${httpRequests} HTTP requests; ${finalState.spentMicros} nonredeemable test microcredits spent.`);
  console.log('No wallet, token transaction, mainnet deployment or inference-correctness claim is involved.');
} catch (error) {
  console.error(`FAIL after ${checks.length} checks: ${error?.stack ?? error}`);
  if (String(error?.message).includes('fetch failed')) {
    console.error('Start the Worker separately and set CINDER_URL to its reachable origin before running this script.');
  }
  process.exitCode = 1;
}
