#!/usr/bin/env node
/**
 * Black-box checks for the Cinder native devnet. No server is started here.
 * CINDER_URL=http://127.0.0.1:8898 node scripts/native-smoke.mjs
 * Four wallets are registered; only the payer claims the fixed-reserve faucet.
 * CINDER_TEST_AI=1 adds one real, bounded Meta Llama inference.
 * CINDER_MAX_BLOCKS=200 limits full public-ledger replay (raise for older ledgers).
 */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { setTimeout as pause } from 'node:timers/promises';
import { nativeGenerateKey, nativeSign, nativeVerify, nativeAddress, nativeHash, nativeCanonical } from '../src/native-crypto.ts';

const origin = new URL(process.env.CINDER_URL || 'http://127.0.0.1:8898');
assert.ok(['http:', 'https:'].includes(origin.protocol));
const maximumBlocks = Number(process.env.CINDER_MAX_BLOCKS || 200);
assert.ok(Number.isSafeInteger(maximumBlocks) && maximumBlocks > 0);
const api = '/api/native';
const atomPattern = /^(0|[1-9][0-9]*)$/;
const deltaPattern = /^(0|-?[1-9][0-9]*)$/;
const hashPattern = /^[a-f0-9]{96}$/;
const contentHash = value => createHash('sha384').update(nativeCanonical(value), 'utf8').digest('hex');
const textHash = value => createHash('sha384').update(value, 'utf8').digest('hex');
const publicKeys = new Map();
const committed = new Map();
const stages = [];
let requests = 0;
let info, genesis, payer, artist, producer, platform;

async function request(path, body) {
  requests++;
  const response = await fetch(new URL(path, origin), {
    method: body === undefined ? 'GET' : 'POST',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal: AbortSignal.timeout(30000),
  });
  const raw = await response.text();
  let data;
  try { data = JSON.parse(raw); }
  catch { throw new Error(`${path}: HTTP ${response.status} returned non-JSON ${raw.slice(0, 160)}`); }
  assert.equal(response.headers.get('cache-control'), 'no-store', 'Native API must not cache account or receipt responses');
  return { status: response.status, data };
}
function expect(response, status, error) {
  assert.equal(response.status, status, `Expected HTTP ${status}, received ${response.status}: ${JSON.stringify(response.data)}`);
  if (error) assert.equal(response.data.error, error);
  return response.data;
}
async function checked(label, action) {
  await action(); stages.push(label); console.log(`PASS ${label}`);
}
async function account(wallet) {
  const address = typeof wallet === 'string' ? wallet : wallet.address;
  const data = expect(await request(`${api}/accounts/${address}`), 200);
  assert.equal(data.address, address);
  assert.equal(nativeAddress(data.publicKey), address);
  assert.match(data.balanceAtoms, atomPattern);
  assert.ok(Number.isSafeInteger(data.nonce) && data.nonce >= 0);
  assert.equal(data.secretKey, undefined);
  publicKeys.set(address, data.publicKey);
  return data;
}
async function register(wallet) {
  const payload = { domain: 'cinder.account.v1', chainId: info.chainId, publicKey: wallet.publicKey };
  const body = { publicKey: wallet.publicKey, proof: nativeSign(payload, wallet.secretKey) };
  const result = expect(await request(`${api}/accounts`, body), 201);
  assert.equal(result.address, wallet.address);
  assert.equal(result.publicKey, wallet.publicKey);
  assert.equal(result.balanceAtoms, '0');
  assert.equal(result.nonce, 0);
  assert.equal(result.claimedFaucet, false);
  publicKeys.set(wallet.address, wallet.publicKey);
  return body;
}
async function transaction(wallet, actions, overrides = {}) {
  const current = await account(wallet);
  const faucet = actions.length === 1 && actions[0].type === 'faucet';
  let debit = faucet ? 0n : 10n + 2n * BigInt(actions.length);
  for (const action of actions) {
    if (action.type === 'transfer' || action.type === 'split') debit += BigInt(action.amountAtoms);
    else if (action.type === 'compute') debit += BigInt(info.services.find(service => service.id === action.service).amountAtoms);
  }
  return { domain: 'cinder.transaction.v1', chainId: info.chainId, sender: wallet.address,
    nonce: current.nonce + 1, validUntil: new Date(Date.now() + 120000).toISOString(), maxDebitAtoms: debit.toString(), actions, ...overrides };
}
function authorization(tx, wallet, extras = {}) {
  return { transaction: tx, signature: nativeSign(tx, wallet.secretKey), ...extras };
}
async function submit(tx, wallet, extras = {}) { return request(`${api}/submit`, authorization(tx, wallet, extras)); }
async function senderKey(address) {
  if (!publicKeys.has(address)) await account(address);
  return publicKeys.get(address);
}
function verifyCheckpoint(checkpoint, signature) {
  assert.equal(checkpoint.domain, 'cinder.checkpoint.v1');
  assert.equal(checkpoint.chainId, info.chainId);
  assert.equal(checkpoint.mode, 'single-operator-devnet');
  assert.ok(Number.isSafeInteger(checkpoint.height) && checkpoint.height > 0);
  for (const value of [checkpoint.previousHash, checkpoint.transactionHash, checkpoint.postingsHash, checkpoint.resultHash]) assert.match(value, hashPattern);
  assert.equal(nativeVerify(checkpoint, signature, info.signer.publicKey), true, 'Operator ML-DSA checkpoint signature');
  assert.equal(nativeVerify({ ...checkpoint, resultHash: '0'.repeat(96) }, signature, info.signer.publicKey), false, 'Checkpoint tampering must fail');
  return contentHash(checkpoint);
}
async function verifyReceipt(receipt, expectedTransactionHash) {
  assert.ok(receipt && typeof receipt === 'object');
  const hash = contentHash(receipt.transaction);
  if (expectedTransactionHash) assert.equal(hash, expectedTransactionHash);
  assert.equal(receipt.checkpoint.transactionHash, hash);
  assert.equal(receipt.checkpoint.postingsHash, contentHash(receipt.postings));
  assert.equal(receipt.checkpoint.resultHash, contentHash(receipt.result));
  verifyCheckpoint(receipt.checkpoint, receipt.checkpointSignature);
  if (receipt.transaction.domain === 'cinder.transaction.v1') {
    assert.equal(nativeVerify(receipt.transaction, receipt.signature, await senderKey(receipt.transaction.sender)), true, 'Payer ML-DSA transaction signature');
  } else {
    assert.ok(['cinder.compute-settlement.v1','cinder.channel-expiry.v1'].includes(receipt.transaction.domain));
    assert.equal(receipt.signature, null, 'Compute settlements are authorized by the operator checkpoint');
  }
  assert.equal(receipt.transaction.chainId, info.chainId);
  assert.ok(Array.isArray(receipt.postings));
  let total = 0n;
  for (const posting of receipt.postings) {
    assert.equal(typeof posting.account, 'string');
    assert.match(posting.deltaAtoms, deltaPattern);
    total += BigInt(posting.deltaAtoms);
  }
  assert.equal(total, 0n, 'Each receipt must conserve every native atom');
  return hash;
}
async function accept(response, tx, status = 200) {
  const data = expect(response, status);
  assert.equal(data.txHash, contentHash(tx), 'Transaction IDs must hash payloads, never randomized signatures');
  await verifyReceipt(data.receipt, data.txHash);
  if (data.head) {
    assert.equal(data.head.height, data.receipt.checkpoint.height);
    assert.equal(data.head.hash, contentHash(data.receipt.checkpoint));
  }
  committed.set(data.txHash, data.receipt);
  return data;
}
function netPostings(receipt) {
  const values = new Map();
  for (const posting of receipt.postings) values.set(posting.account, (values.get(posting.account) || 0n) + BigInt(posting.deltaAtoms));
  return values;
}
async function expectUnchanged(wallet, before) {
  const after = await account(wallet);
  assert.equal(after.nonce, before.nonce, 'Rejected requests must not consume nonce');
  assert.equal(after.balanceAtoms, before.balanceAtoms, 'Rejected requests must not debit fees or balance');
  return after;
}
async function pollJob(hash) {
  const deadline = Date.now() + 105000;
  while (Date.now() < deadline) {
    const job = expect(await request(`${api}/jobs/${hash}`), 200);
    assert.equal(job.txHash, hash);
    if (job.status !== 'pending') return job;
    await pause(500);
  }
  throw new Error('Compute did not finish within the bounded integration-test wait');
}
async function compute(service, input) {
  const before = await account(payer);
  const catalog = info.services.find(item => item.id === service);
  assert.ok(catalog, `Missing ${service} service`);
  const tx = await transaction(payer, [{ type: 'compute', service, inputHash: nativeHash(input) }]);
  assert.equal(nativeHash(input), textHash(input));
  const start = await accept(await submit(tx, payer, { computeInput: input }), tx, 202);
  assert.equal(start.job.status, 'pending');
  assert.equal(start.receipt.result.feeAtoms, '12');
  const escrow = 'system:escrow:' + start.txHash;
  assert.equal(start.job.escrow, escrow);
  const reservationPostings = netPostings(start.receipt);
  assert.equal(reservationPostings.get(escrow), BigInt(catalog.amountAtoms));
  assert.equal(reservationPostings.get('system:fees'), 12n);
  assert.equal(reservationPostings.get(payer.address), -(BigInt(catalog.amountAtoms) + 12n));
  const job = await pollJob(start.txHash);
  assert.equal(job.status, 'complete', `Expected successful ${service} execution: ${JSON.stringify(job)}`);
  assert.equal(job.refundAtoms, '0');
  assert.equal(typeof job.output, 'string');
  assert.ok(job.output.trim());
  if (service === 'hash') assert.equal(job.output, textHash(input), 'Native hash compute must execute real SHA-384');
  await verifyReceipt(job.receipt);
  assert.equal(job.receipt.transaction.requestTxHash, start.txHash);
  assert.equal(job.receipt.transaction.outputHash, textHash(job.output));
  assert.equal(job.receipt.transaction.status, 'complete');
  assert.equal(job.receipt.result.output, job.output);
  assert.equal(job.receipt.result.model, catalog.model);
  const settlementPostings = netPostings(job.receipt);
  assert.equal(settlementPostings.get(escrow), -BigInt(catalog.amountAtoms));
  assert.equal(settlementPostings.get('system:provider'), BigInt(catalog.amountAtoms));
  assert.equal(settlementPostings.has(payer.address), false, 'Completion must not debit the payer a second time');
  const after = await account(payer);
  assert.equal(after.nonce, before.nonce + 1, 'Only the reservation consumes a payer nonce');
  assert.equal(BigInt(after.balanceAtoms), BigInt(before.balanceAtoms) - BigInt(catalog.amountAtoms) - 12n);
  committed.set(contentHash(job.receipt.transaction), job.receipt);
  const replay = await accept(await submit(tx, payer, { computeInput: input }), tx);
  assert.equal(replay.replayed, true);
  assert.equal(replay.job.status, 'complete');
  await expectUnchanged(payer, after);
  console.log(`COMPUTE ${service}: ${job.output}`);
  console.log(`VERIFIED ${service} request ${start.txHash}; settlement checkpoint ${job.receipt.checkpoint.height}`);
  return job;
}

try {
  console.log(`Cinder native devnet HTTP checks: ${origin.origin}`);
  await checked('native chain info and genesis carry verifiable ML-DSA-65 provenance', async () => {
    info = expect(await request(`${api}/info`), 200);
    assert.equal(info.chainId, process.env.CINDER_EXPECTED_CHAIN || 'cinder-devnet-1');
    assert.equal(info.symbol, 'CINDER');
    assert.equal(info.assetId, info.chainId + '/native');
    assert.equal(info.decimals, 6);
    assert.equal(info.signatureAlgorithm, 'ML-DSA-65');
    assert.equal(info.hashAlgorithm, 'SHA-384');
    assert.equal(info.consensus, 'single-operator-devnet');
    assert.equal(info.mainnet, false);
    assert.equal(info.feeBaseAtoms, '10');
    assert.equal(info.feePerActionAtoms, '2');
    assert.equal(info.maxBatchActions, 16);
    assert.equal(info.signer.address, nativeAddress(info.signer.publicKey));
    assert.equal(info.signer.secretKey, undefined);
    for (const value of [info.supplyAtoms, info.reserveAtoms, info.circulatingTestAtoms, info.faucetAtoms]) assert.match(value, atomPattern);
    assert.equal(BigInt(info.reserveAtoms) + BigInt(info.circulatingTestAtoms), BigInt(info.supplyAtoms));
    genesis = expect(await request(`${api}/genesis`), 200);
    assert.equal(genesis.genesis.domain, 'cinder.genesis.v1');
    assert.equal(genesis.genesis.chainId, info.chainId);
    assert.equal(genesis.genesis.operatorPublicKey, info.signer.publicKey);
    assert.equal(genesis.genesis.supplyAtoms, info.supplyAtoms);
    assert.equal(genesis.genesis.allocation, 'system:reserve');
    assert.equal(genesis.hash, contentHash(genesis.genesis));
    assert.equal(nativeVerify(genesis.genesis, genesis.signature, info.signer.publicKey), true);
    assert.equal(nativeVerify({ ...genesis.genesis, supplyAtoms: '1' }, genesis.signature, info.signer.publicKey), false);
  });

  await checked('malformed registration and wrong proof fail; four fresh native wallets register', async () => {
    [payer, artist, producer, platform] = Array.from({ length: 4 }, () => nativeGenerateKey());
    expect(await request(`${api}/accounts`, { publicKey: 'invalid', proof: 'invalid' }), 400);
    const payload = { domain: 'cinder.account.v1', chainId: info.chainId, publicKey: payer.publicKey };
    expect(await request(`${api}/accounts`, { publicKey: payer.publicKey, proof: nativeSign(payload, artist.secretKey) }), 401, 'invalid_signature');
    const payerRegistration = await register(payer);
    for (const wallet of [artist, producer, platform]) await register(wallet);
    const existing = expect(await request(`${api}/accounts`, payerRegistration), 200);
    assert.equal(existing.address, payer.address);
    assert.equal(existing.balanceAtoms, '0');
    expect(await request(`${api}/accounts/not-a-native-address`), 404);
    expect(await request(`${api}/accounts/${nativeGenerateKey().address}`), 404, 'account_missing');
  });

  let faucetTx;
  await checked('one native faucet claim moves a finite reserve and fresh-signature replay is idempotent', async () => {
    const beforeInfo = expect(await request(`${api}/info`), 200);
    faucetTx = await transaction(payer, [{ type: 'faucet' }]);
    const signed = authorization(faucetTx, payer);
    const fresh = authorization(faucetTx, payer);
    assert.notEqual(signed.signature, fresh.signature, 'Hedged ML-DSA signatures should differ');
    const granted = await accept(await request(`${api}/submit`, signed), faucetTx);
    assert.equal(granted.account.balanceAtoms, info.faucetAtoms);
    assert.equal(granted.account.nonce, 1);
    assert.equal(granted.account.claimedFaucet, true);
    assert.equal(granted.receipt.result.feeAtoms, '0');
    const postings = netPostings(granted.receipt);
    assert.equal(postings.get('system:reserve'), -BigInt(info.faucetAtoms));
    assert.equal(postings.get(payer.address), BigInt(info.faucetAtoms));
    assert.equal(postings.has('system:fees'), false);
    const afterInfo = expect(await request(`${api}/info`), 200);
    assert.equal(afterInfo.supplyAtoms, beforeInfo.supplyAtoms);
    assert.ok(BigInt(afterInfo.reserveAtoms) <= BigInt(beforeInfo.reserveAtoms) - BigInt(info.faucetAtoms));
    assert.ok(BigInt(afterInfo.reserveAtoms) >= 0n);
    const replay = await accept(await request(`${api}/submit`, fresh), faucetTx);
    assert.equal(replay.replayed, true);
    assert.equal(replay.receipt.checkpoint.height, granted.receipt.checkpoint.height);
    assert.equal(replay.account.balanceAtoms, info.faucetAtoms);
    expect(await submit(await transaction(payer, [{ type: 'faucet' }]), payer), 409, 'faucet_claimed');
    for (const wallet of [artist, producer, platform]) assert.equal((await account(wallet)).claimedFaucet, false);
  });

  await checked('network/domain/nonce/signature/deadline/amount and unknown-account failures preserve state', async () => {
    const before = await account(payer);
    const base = await transaction(payer, [{ type: 'transfer', to: artist.address, amountAtoms: '1' }]);
    expect(await submit({ ...base, chainId: 'another-native-network' }, payer), 400, 'wrong_network');
    expect(await submit({ ...base, domain: 'cinder.checkpoint.v1' }, payer), 400, 'wrong_network');
    expect(await submit({ ...base, nonce: base.nonce + 1 }, payer), 409, 'wrong_nonce');
    expect(await submit({ ...base, nonce: 'unknown' }, payer), 400, 'invalid_sender');
    expect(await submit({ ...base, nonce: null }, payer), 400, 'invalid_sender');
    expect(await submit({ ...base, sender: [payer.address] }, payer), 400, 'invalid_sender');
    expect(await submit(base, artist), 401, 'invalid_signature');
    const signed = authorization(base, payer);
    expect(await request(`${api}/submit`, { ...signed, signature: 'not-a-signature' }), 401, 'invalid_signature');
    expect(await request(`${api}/submit`, { ...signed, transaction: { ...base, actions: [{ ...base.actions[0], amountAtoms: '2' }] } }), 401, 'invalid_signature');
    expect(await submit({ ...base, validUntil: new Date(Date.now() - 1000).toISOString() }, payer), 410, 'expired');
    expect(await submit({ ...base, maxDebitAtoms: info.supplyAtoms, actions: [{ ...base.actions[0], amountAtoms: before.balanceAtoms }] }, payer), 402, 'insufficient_balance');
    expect(await submit({ ...base, maxDebitAtoms: '12' }, payer), 402, 'spending_cap');
    const unknown = nativeGenerateKey();
    expect(await submit({ ...base, actions: [{ ...base.actions[0], to: unknown.address }] }, payer), 404, 'unknown_recipient');
    expect(await submit({ ...base, sender: unknown.address, nonce: 1 }, unknown), 401, 'invalid_signature');
    expect(await submit({ ...base, actions: [{ ...base.actions[0], to: 'cin1bad' }] }, payer), 400, 'invalid_recipient');
    expect(await submit({ ...base, actions: [{ ...base.actions[0], to: [artist.address] }] }, payer), 400, 'invalid_recipient');
    expect(await submit({ ...base, actions: [{ ...base.actions[0], amountAtoms: '01' }] }, payer), 400, 'invalid_amount');
    expect(await submit({ ...base, actions: [{ ...base.actions[0], amountAtoms: '1.1' }] }, payer), 400, 'invalid_amount');
    await expectUnchanged(payer, before);
  });

  await checked('signed native transfers commit exactly one debit, one credit and a 12-atom fee', async () => {
    const before = await account(payer);
    const recipientBefore = await account(artist);
    const tx = await transaction(payer, [{ type: 'transfer', to: artist.address, amountAtoms: '1000' }]);
    const result = await accept(await submit(tx, payer), tx);
    assert.equal(result.receipt.result.feeAtoms, '12');
    const postings = netPostings(result.receipt);
    assert.equal(postings.get(payer.address), -1012n);
    assert.equal(postings.get(artist.address), 1000n);
    assert.equal(postings.get('system:fees'), 12n);
    assert.equal(BigInt((await account(payer)).balanceAtoms), BigInt(before.balanceAtoms) - 1012n);
    assert.equal(BigInt((await account(artist)).balanceAtoms), BigInt(recipientBefore.balanceAtoms) + 1000n);
    assert.equal(result.account.nonce, before.nonce + 1);
    const publicReceipt = expect(await request(`${api}/transactions/${result.txHash}`), 200);
    await verifyReceipt(publicReceipt.receipt, result.txHash);
    assert.deepEqual(publicReceipt.receipt, result.receipt);
  });

  await checked('101-atom music split allocates 71/20/10 by largest remainder and charges 12 atoms', async () => {
    const before = await account(payer);
    const recipients = [artist, producer, platform];
    const balances = await Promise.all(recipients.map(account));
    const action = { type: 'split', app: 'music', referenceHash: nativeHash('integration-test-track'), units: 1,
      amountAtoms: '101', recipients: recipients.map((wallet, index) => ({ address: wallet.address, bps: [7000, 2000, 1000][index] })) };
    const tx = await transaction(payer, [action]);
    const result = await accept(await submit(tx, payer), tx);
    const split = result.receipt.result.events.find(event => event.type === 'split');
    assert.deepEqual(split.recipients.map(part => part.amountAtoms), ['71', '20', '10']);
    assert.equal(split.recipients.reduce((sum, part) => sum + BigInt(part.amountAtoms), 0n), 101n);
    assert.equal(split.referenceHash, action.referenceHash);
    assert.equal(split.app, 'music');
    assert.equal(result.receipt.result.feeAtoms, '12');
    assert.equal(BigInt((await account(payer)).balanceAtoms), BigInt(before.balanceAtoms) - 113n);
    for (let index = 0; index < recipients.length; index++)
      assert.equal(BigInt((await account(recipients[index])).balanceAtoms), BigInt(balances[index].balanceAtoms) + [71n, 20n, 10n][index]);
  });

  await checked('same-nonce concurrent batches allow at most one atomic commit', async () => {
    const before = await account(payer);
    const first = await transaction(payer, [
      { type: 'transfer', to: artist.address, amountAtoms: '3' },
      { type: 'transfer', to: producer.address, amountAtoms: '5' },
    ]);
    const second = { ...first, maxDebitAtoms: '32', actions: [
      { type: 'transfer', to: artist.address, amountAtoms: '7' },
      { type: 'transfer', to: producer.address, amountAtoms: '11' },
    ] };
    const responses = await Promise.all([submit(first, payer), submit(second, payer)]);
    assert.equal(responses.filter(response => response.status === 200).length, 1);
    assert.equal(responses.filter(response => response.status === 409 && response.data.error === 'wrong_nonce').length, 1);
    const winner = responses[0].status === 200 ? first : second;
    const result = await accept(responses.find(response => response.status === 200), winner);
    assert.equal(result.receipt.result.actionCount, 2);
    assert.equal(result.receipt.result.feeAtoms, '14');
    const amount = winner.actions.reduce((sum, action) => sum + BigInt(action.amountAtoms), 0n);
    const after = await account(payer);
    assert.equal(after.nonce, before.nonce + 1);
    assert.equal(BigInt(after.balanceAtoms), BigInt(before.balanceAtoms) - amount - 14n);
    const replay = await accept(await submit(winner, payer), winner);
    assert.equal(replay.replayed, true);
    await expectUnchanged(payer, after);
  });

  await checked('compute input mismatch rejects before escrow or nonce is committed', async () => {
    const before = await account(payer);
    const tx = await transaction(payer, [{ type: 'compute', service: 'hash', inputHash: nativeHash('exact-input') }]);
    expect(await submit(tx, payer, { computeInput: 'changed-input' }), 400, 'input_mismatch');
    await expectUnchanged(payer, before);
  });

  await checked('native SHA-384 compute reserves 202 escrow, settles once and verifies output provenance', async () => {
    await compute('hash', 'Cinder native compute: 火 🔥, exact UTF-8 execution.');
  });

  if (process.env.CINDER_TEST_AI === '1') {
    await checked('optional real Meta Llama inference is paid in native atoms and settles signed provenance', async () => {
      await compute('inference', 'In one sentence, explain why a signature proves who signed a receipt but not that an AI answer is correct.');
    });
  } else console.log('SKIP real AI inference (set CINDER_TEST_AI=1 for one bounded call)');

  await checked('public block pages and signed receipts reconstruct a conserved native supply at a pinned head', async () => {
    const snapshot = expect(await request(`${api}/info`), 200);
    assert.equal(snapshot.supplyAtoms, info.supplyAtoms);
    assert.equal(snapshot.signer.publicKey, info.signer.publicKey);
    assert.ok(snapshot.head.height <= maximumBlocks,
      `Head ${snapshot.head.height} exceeds CINDER_MAX_BLOCKS=${maximumBlocks}; increase explicitly to replay the complete public chain`);
    const balances = new Map([['system:reserve', BigInt(genesis.genesis.supplyAtoms)], ['system:fees', 0n], ['system:provider', 0n]]);
    const seen = new Set();
    let cursor = 0, previous = genesis.hash;
    while (cursor < snapshot.head.height) {
      const page = expect(await request(`${api}/blocks?after=${cursor}`), 200);
      assert.ok(Array.isArray(page.blocks) && page.blocks.length > 0 && page.blocks.length <= 20);
      const selected = page.blocks.filter(block => block.height <= snapshot.head.height);
      assert.ok(selected.length > 0);
      for (const block of selected) {
        assert.equal(block.height, cursor + 1, 'No skipped or duplicated ledger heights');
        assert.equal(block.checkpoint.height, block.height);
        assert.equal(block.checkpoint.previousHash, previous, 'Every block must extend the prior signed checkpoint');
        assert.equal(block.hash, verifyCheckpoint(block.checkpoint, block.checkpointSignature));
        assert.equal(block.txHash, block.checkpoint.transactionHash);
        assert.equal(seen.has(block.txHash), false, 'The same transaction must not create multiple blocks');
        seen.add(block.txHash);
        const data = expect(await request(`${api}/transactions/${block.txHash}`), 200);
        await verifyReceipt(data.receipt, block.txHash);
        assert.deepEqual(data.receipt.checkpoint, block.checkpoint);
        assert.equal(data.receipt.checkpointSignature, block.checkpointSignature);
        for (const posting of data.receipt.postings) {
          const next = (balances.get(posting.account) || 0n) + BigInt(posting.deltaAtoms);
          assert.ok(next >= 0n, 'Reconstructed account balance cannot become negative');
          balances.set(posting.account, next);
        }
        assert.equal([...balances.values()].reduce((sum, amount) => sum + amount, 0n), BigInt(info.supplyAtoms));
        cursor = block.height; previous = block.hash;
      }
      assert.equal(page.next, page.blocks.at(-1).height, 'Public cursor must identify the last returned height');
    }
    assert.equal(previous, snapshot.head.hash);
    assert.equal(balances.get('system:reserve').toString(), snapshot.reserveAtoms);
    assert.equal(BigInt(snapshot.supplyAtoms) - balances.get('system:reserve'), BigInt(snapshot.circulatingTestAtoms));
    for (const [hash] of committed) assert.equal(seen.has(hash), true, 'Each test commit must appear once in the public ledger');
    for (const wallet of [payer, artist, producer, platform]) {
      const current = await account(wallet);
      assert.equal(BigInt(current.balanceAtoms), balances.get(wallet.address) || 0n, 'Known live balances must match public posting replay');
    }
    const invalidCursor = await request(`${api}/blocks?after=-1`);
    expect(invalidCursor, 400, 'invalid_cursor');
    console.log(`LEDGER PROOF: ${cursor} linked blocks; ${balances.size} reconstructed accounts; total ${snapshot.supplyAtoms} atoms; reserve ${snapshot.reserveAtoms}; head ${snapshot.head.hash}`);
  });

  const final = await account(payer);
  console.log(`PASS ${stages.length} native integration stages; ${requests} HTTP requests; ${committed.size} independently checked test commits; payer nonce ${final.nonce}.`);
  console.log('Four test wallets, one finite-reserve faucet claim. CINDER remains a single-operator devnet with no redemption or market-value claim.');
} catch (error) {
  console.error(`FAIL after ${stages.length} stages: ${error?.stack ?? error}`);
  if (String(error?.message).includes('fetch failed')) console.error('Check the running server, CINDER_URL, and required network proxy; no server is started by this script.');
  process.exitCode = 1;
}
