import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';
import { nativeGenerateKey, nativeSign, nativeHash } from '../src/native-crypto.ts';
import { NATIVE_CHAIN, NATIVE_SUPPLY, NATIVE_FAUCET, txHash } from '../src/native-core.ts';

// Exercise the actual ledger class, substituting only Cloudflare's runtime base
// class and storage. This harness tests application state transitions; it does
// not assert that this in-memory store reproduces Cloudflare failure semantics.
let source = await readFile(new URL('../src/native-ledger.ts', import.meta.url), 'utf8');
assert.match(source, /import \{DurableObject\} from 'cloudflare:workers';/);
source = source.replace("import {DurableObject} from 'cloudflare:workers';", `
class DurableObject {
  ctx: any; env: any;
  constructor(ctx: any, env: any) { this.ctx = ctx; this.env = env; }
}`);
for (const name of ['native-crypto', 'native-core']) {
  source = source.replace(`from './${name}'`, `from '${new URL('../src/' + name + '.ts', import.meta.url).href}'`);
}
const compiled = ts.transpileModule(source, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ESNext },
}).outputText;
const { NativeLedger } = await import('data:text/javascript;base64,' + Buffer.from(compiled).toString('base64'));

class MemoryStorage {
  values = new Map();
  alarm = null;
  failNextAlarm = false;
  failNextReservation = false;
  failNextSettlement = false;

  async get(key) {
    if (Array.isArray(key)) return new Map(key.filter(k => this.values.has(k)).map(k => [k, structuredClone(this.values.get(k))]));
    return structuredClone(this.values.get(key));
  }

  async put(key, value) {
    const entries = typeof key === 'string' ? [[key, value]] : Object.entries(key);
    for (const [name, item] of entries) {
      if (!name.startsWith('transaction:')) continue;
      if (this.failNextReservation && item.transaction.domain === 'cinder.transaction.v1') {
        this.failNextReservation = false;
        throw new Error('Injected reservation batch write failure');
      }
      if (this.failNextSettlement && item.transaction.domain === 'cinder.compute-settlement.v1') {
        this.failNextSettlement = false;
        throw new Error('Injected settlement batch write failure');
      }
    }
    // A batch is all-or-nothing, like the application's required storage contract.
    const copies = entries.map(([k, v]) => [k, structuredClone(v)]);
    for (const [k, v] of copies) this.values.set(k, v);
  }

  async setAlarm(time) {
    if (this.failNextAlarm) {
      this.failNextAlarm = false;
      throw new Error('Injected alarm write failure');
    }
    this.alarm = time;
  }
  async getAlarm() { return this.alarm; }
  async deleteAlarm() { this.alarm = null; }
}

// One real signing identity is sufficient for these targeted recovery tests.
const identity = nativeGenerateKey();
const accountKey = 'account:' + identity.address;
const input = 'A short compute recovery test';

function harness(run = async () => ({ response: 'Provider output' })) {
  const storage = new MemoryStorage();
  const tasks = [];
  let tail = Promise.resolve();
  const context = {
    storage,
    blockConcurrencyWhile(callback) {
      const current = tail.then(callback);
      tail = current.catch(() => {});
      return current;
    },
    waitUntil(task) { tasks.push(task); task.catch(() => {}); },
  };
  return { ledger: new NativeLedger(context, { AI: { run } }), storage, tasks };
}

async function request(h, path, body) {
  const response = await h.ledger.fetch(new Request('https://test.invalid/api/native/' + path, body === undefined ? {} : {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
  }));
  return { status: response.status, body: await response.json() };
}

function payload(actions, nonce, maxDebitAtoms, extra = {}) {
  const transaction = {
    domain: 'cinder.transaction.v1', chainId: NATIVE_CHAIN, sender: identity.address,
    nonce, validUntil: new Date(Date.now() + 60000).toISOString(), maxDebitAtoms, actions,
  };
  return { transaction, signature: nativeSign(transaction, identity.secretKey), ...extra };
}

function computePayload(service = 'inference') {
  return payload([{ type: 'compute', service, inputHash: nativeHash(input) }], 2, '1000', { computeInput: input });
}

async function funded(h) {
  const registration = { domain: 'cinder.account.v1', chainId: NATIVE_CHAIN, publicKey: identity.publicKey };
  const created = await request(h, 'accounts', { publicKey: identity.publicKey, proof: nativeSign(registration, identity.secretKey) });
  assert.equal(created.status, 201);
  const minted = await request(h, 'submit', payload([{ type: 'faucet' }], 1, '0'));
  assert.equal(minted.status, 200);
  assert.equal(minted.body.account.balanceAtoms, NATIVE_FAUCET);
}

function assertConserved(h) {
  const accounts = [...h.storage.values.entries()].filter(([key]) => key.startsWith('account:')).map(([, value]) => value);
  assert.equal(accounts.reduce((sum, account) => sum + BigInt(account.balanceAtoms), 0n), BigInt(NATIVE_SUPPLY));
  for (const account of accounts) assert.ok(BigInt(account.balanceAtoms) >= 0n);
}

async function assertRefunded(h, hash, price = '500') {
  const job = await h.storage.get('job:' + hash);
  assert.equal(job.status, 'failed');
  assert.equal(job.refundAtoms, price);
  assert.equal(job.output, undefined);
  assert.equal((await h.storage.get(accountKey)).balanceAtoms, (BigInt(NATIVE_FAUCET) - 12n).toString());
  assert.equal((await h.storage.get('account:' + job.escrow)).balanceAtoms, '0');
  assert.equal((await h.storage.get('account:system:provider')).balanceAtoms, '0');
  assert.deepEqual(await h.storage.get('pending'), []);
  assert.equal(h.storage.alarm, null);
  assertConserved(h);
  return job;
}

test('alarm scheduling failure cannot commit a reservation, debit, nonce or orphan job', async () => {
  const h = harness();
  await funded(h);
  const before = await h.storage.get(accountKey);
  const body = computePayload('hash');
  const hash = txHash(body.transaction);
  h.storage.failNextAlarm = true;
  const rejected = await request(h, 'submit', body);
  assert.equal(rejected.status, 400);
  assert.deepEqual(await h.storage.get(accountKey), before);
  assert.equal(await h.storage.get('transaction:' + hash), undefined);
  assert.equal(await h.storage.get('job:' + hash), undefined);
  assert.equal(h.tasks.length, 0);
  assertConserved(h);
  const retried = await request(h, 'submit', body);
  assert.equal(retried.status, 202);
  assert.equal(retried.body.replayed, undefined);
  await Promise.all(h.tasks);
  assert.equal((await h.storage.get('job:' + hash)).status, 'complete');
  assert.equal((await h.storage.get('account:system:provider')).balanceAtoms, '100');
  const height = (await h.storage.get('meta')).height;
  const replay = await request(h, 'submit', body);
  assert.equal(replay.body.replayed, true);
  assert.equal((await h.storage.get('meta')).height, height);
  assertConserved(h);
});

test('reservation batch persistence failure leaves only a harmless recovery alarm', async () => {
  const h = harness();
  await funded(h);
  const before = await h.storage.get(accountKey);
  const body = computePayload('hash');
  h.storage.failNextReservation = true;
  const rejected = await request(h, 'submit', body);
  assert.equal(rejected.status, 400);
  assert.deepEqual(await h.storage.get(accountKey), before);
  assert.equal(await h.storage.get('job:' + txHash(body.transaction)), undefined);
  assert.equal(h.tasks.length, 0);
  await h.ledger.alarm();
  assert.equal(h.storage.alarm, null);
  assertConserved(h);
});

test('provider output at the two-minute deadline is refunded even before the alarm runs', async t => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  await funded(h);
  const pending = await request(h, 'submit', computePayload());
  assert.equal(pending.status, 202);
  t.mock.method(Date, 'now', () => pending.body.job.startedAt + 120000);
  finish({ response: 'Too late to charge' });
  await Promise.all(h.tasks);
  await assertRefunded(h, pending.body.txHash);
});

test('alarm refund and subsequent provider completion cannot settle the same escrow twice', async t => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  await funded(h);
  const pending = await request(h, 'submit', computePayload());
  t.mock.method(Date, 'now', () => pending.body.job.startedAt + 120001);
  await h.ledger.alarm();
  const job = await assertRefunded(h, pending.body.txHash);
  const head = await h.storage.get('meta');
  finish({ response: 'Late success must be ignored' });
  await Promise.all(h.tasks);
  await h.ledger.alarm();
  assert.deepEqual(await h.storage.get('job:' + pending.body.txHash), job);
  assert.deepEqual(await h.storage.get('meta'), head);
  assertConserved(h);
});

test('authenticated replay recovers expired jobs and returns the refunded account balance', async t => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  await funded(h);
  const body = computePayload();
  const pending = await request(h, 'submit', body);
  t.mock.method(Date, 'now', () => pending.body.job.startedAt + 120001);
  const replay = await request(h, 'submit', body);
  assert.equal(replay.status, 200);
  assert.equal(replay.body.replayed, true);
  assert.equal(replay.body.job.status, 'failed');
  assert.equal(replay.body.account.balanceAtoms, (BigInt(NATIVE_FAUCET) - 12n).toString());
  await assertRefunded(h, pending.body.txHash);
  finish({ response: 'Late completion' });
  await Promise.all(h.tasks);
});

test('provider failure refunds principal while retaining exactly one published network fee', async () => {
  const h = harness(async () => { throw new Error('Provider unavailable'); });
  await funded(h);
  const pending = await request(h, 'submit', computePayload());
  await Promise.all(h.tasks);
  await assertRefunded(h, pending.body.txHash);
  assert.equal((await h.storage.get('account:system:fees')).balanceAtoms, '12');
});

test('failed settlement batch cannot expose a terminal job without its balance update and receipt', async t => {
  let finish;
  const h = harness(() => new Promise(resolve => { finish = resolve; }));
  await funded(h);
  const pending = await request(h, 'submit', computePayload());
  const beforeHead = await h.storage.get('meta');
  h.storage.failNextSettlement = true;
  finish({ response: 'Output before injected persistence failure' });
  const settled = await Promise.allSettled(h.tasks);
  assert.equal(settled[0].status, 'rejected');
  const stillPending = await h.storage.get('job:' + pending.body.txHash);
  assert.equal(stillPending.status, 'pending');
  assert.equal(stillPending.receipt, undefined);
  assert.equal((await h.storage.get('account:' + stillPending.escrow)).balanceAtoms, '500');
  assert.equal((await h.storage.get('account:system:provider')).balanceAtoms, '0');
  assert.deepEqual(await h.storage.get('meta'), beforeHead);
  assertConserved(h);
  t.mock.method(Date, 'now', () => pending.body.job.startedAt + 120001);
  await h.ledger.alarm();
  const refunded = await assertRefunded(h, pending.body.txHash);
  assert.ok(refunded.receipt.checkpointSignature);
  assert.equal((await h.storage.get('meta')).height, beforeHead.height + 1);
});
