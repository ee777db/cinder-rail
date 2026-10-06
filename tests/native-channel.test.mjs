import test from 'node:test';
import assert from 'node:assert/strict';
import { nativeCanonical, nativeGenerateKey, nativeHash, nativeSign, nativeVerify } from '../src/native-crypto.ts';
import { NATIVE_CHAIN, NATIVE_SUPPLY, NativeError, txHash } from '../src/native-core.ts';
import {
  openChannel, applyChannelCall, closeChannel, expireChannel, channelExpiryTransaction,
  channelAccounts, channelCallAccounts, channelMessageHash, authenticateChannelCall,
} from '../src/native-channel.ts';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const ownerKey = nativeGenerateKey(), sessionKey = nativeGenerateKey(), wrongKey = nativeGenerateKey();
const OWNER = ownerKey.address, OTHER = wrongKey.address, FUNDS = 100000000n;
const EXPIRY = NOW + 3600000;
function account(address, balance, publicKey) {
  return { address, balanceAtoms: balance.toString(), nonce: 0, claimedFaucet: false,
    createdAt: new Date(NOW).toISOString(), ...(publicKey ? { publicKey } : {}) };
}
function snapshot() {
  return Object.fromEntries([
    account(OWNER, FUNDS, ownerKey.publicKey), account(OTHER, 10000n, wrongKey.publicKey),
    account('system:reserve', BigInt(NATIVE_SUPPLY) - FUNDS - 10000n),
    account('system:fees', 0n), account('system:provider', 0n),
  ].map(a => [a.address, a]));
}
function opening(overrides = {}) {
  return { type: 'channel.open', sessionPublicKey: sessionKey.publicKey, capacity: 3,
    expiresAt: new Date(EXPIRY).toISOString(), service: 'hash', ...overrides };
}
function tx(accounts, action, sender = OWNER, overrides = {}, now = NOW) {
  return { domain: 'cinder.transaction.v1', chainId: NATIVE_CHAIN, sender, nonce: accounts[sender].nonce + 1,
    validUntil: new Date(now + 60000).toISOString(), maxDebitAtoms: NATIVE_SUPPLY, actions: [action], ...overrides };
}
function check(result) {
  assert.equal(Object.values(result.accounts).reduce((sum, a) => sum + BigInt(a.balanceAtoms), 0n), BigInt(NATIVE_SUPPLY));
  assert.equal(result.postings.reduce((sum, p) => sum + BigInt(p.deltaAtoms), 0n), 0n);
  assert.ok(Object.values(result.accounts).every(a => BigInt(a.balanceAtoms) >= 0n));
  return result;
}
function opened(overrides = {}) {
  const accounts = snapshot(), transaction = tx(accounts, opening(overrides));
  const before = structuredClone(accounts);
  const result = check(openChannel(accounts, transaction, NOW));
  assert.deepEqual(accounts, before);
  return result;
}
function call(channel, input = 'A verifiable hash call', overrides = {}, key = sessionKey) {
  const message = { domain: 'cinder.channel-call.v1', chainId: NATIVE_CHAIN, channelId: channel.channelId,
    sequence: channel.sequence + 1, inputHash: nativeHash(input), ...overrides };
  return { message, signature: nativeSign(message, key.secretKey), input };
}
function consumed(current, input = 'A verifiable hash call', now = NOW) {
  const request = call(current.channel, input);
  const before = structuredClone(current);
  const result = check(applyChannelCall(current.accounts, current.channel, request.message, request.signature, input, now));
  assert.deepEqual(current, before, 'the call cannot mutate an input snapshot or channel');
  return { ...result, request };
}
function rejects(operation, values, code) {
  const before = structuredClone(values);
  assert.throws(operation, error => {
    if (code) { assert.ok(error instanceof NativeError); assert.equal(error.code, code); }
    return true;
  });
  assert.deepEqual(values, before, 'rejected operations must leave state untouched');
}

test('open escrows capacity times 100 atoms and charges one 12-atom fee with a distinct session key', () => {
  const accounts = snapshot(), transaction = tx(accounts, opening(), OWNER, { maxDebitAtoms: '312' });
  const result = check(openChannel(accounts, transaction, NOW));
  assert.equal(result.channel.channelId, txHash(transaction));
  assert.equal(result.channel.escrow, 'system:channel:' + txHash(transaction));
  assert.equal(result.accounts[OWNER].balanceAtoms, (FUNDS - 312n).toString());
  assert.equal(result.accounts[result.channel.escrow].balanceAtoms, '300');
  assert.equal(result.accounts['system:provider'].balanceAtoms, '0');
  assert.equal(result.accounts['system:fees'].balanceAtoms, '12');
  assert.equal(result.accounts[OWNER].nonce, 1);
  assert.equal(result.channel.sequence, 0);
  assert.equal(result.channel.journalHead, nativeHash(nativeCanonical(result.result.opening)));
  assert.deepEqual(new Set(channelAccounts(transaction)), new Set([OWNER, 'system:fees', 'system:provider', result.channel.escrow]));
  assert.deepEqual(channelCallAccounts(result.channel), [result.channel.escrow]);
});

test('channel calls consume bounded entitlement but never move ledger balances or append fees', () => {
  const open = opened();
  const result = consumed(open);
  assert.deepEqual(result.accounts, open.accounts);
  assert.deepEqual(result.postings, []);
  assert.equal(result.channel.sequence, 1);
  assert.equal(result.channel.spentAtoms, '100');
  assert.equal(result.channel.remainingAtoms, '200');
  assert.equal(result.accounts[result.channel.escrow].balanceAtoms, '300');
  assert.equal(result.accounts['system:provider'].balanceAtoms, '0');
  assert.equal(result.result.authorizedAtoms, '100');
  assert.equal(result.result.settledAtoms, '0');
  assert.equal(result.result.feeAtoms, '0');
  assert.match(result.result.evidence, /provisional/);
});

test('journal links bind the signed authorization, deterministic output, price and prior entry', () => {
  const open = opened();
  const one = consumed(open, 'first');
  const two = consumed(one, 'second');
  assert.equal(one.journal.previousHash, open.channel.journalHead);
  assert.equal(two.journal.previousHash, one.channel.journalHead);
  assert.equal(two.channel.journalHead, nativeHash(nativeCanonical(two.journal)));
  assert.equal(two.journal.messageHash, channelMessageHash(two.request.message));
  assert.equal(two.journal.output, nativeHash('second'));
  assert.equal(two.journal.outputHash, nativeHash(two.journal.output));
  assert.equal(two.journal.amountAtoms, '100');
  assert.ok(nativeVerify(two.journal.authorization, two.journal.signature, sessionKey.publicKey));
  assert.equal(two.channel.spentAtoms, '200');
});

test('owner close settles consumed calls, refunds unused collateral, and commits the journal head once', () => {
  const used = consumed(opened());
  const action = { type: 'channel.close', channelId: used.channel.channelId };
  const transaction = tx(used.accounts, action, OWNER, { maxDebitAtoms: '12' });
  const closed = check(closeChannel(used.accounts, used.channel, transaction, NOW));
  assert.equal(closed.accounts['system:provider'].balanceAtoms, '100');
  assert.equal(closed.accounts['system:fees'].balanceAtoms, '24');
  assert.equal(closed.accounts[OWNER].balanceAtoms, (FUNDS - 124n).toString());
  assert.equal(closed.accounts[closed.channel.escrow].balanceAtoms, '0');
  assert.equal(closed.accounts[OWNER].nonce, 2);
  assert.equal(closed.channel.status, 'closed');
  assert.equal(closed.result.callCount, 1);
  assert.equal(closed.result.journalHead, used.channel.journalHead);
  assert.equal(closed.result.refundedAtoms, '200');
  rejects(() => closeChannel(closed.accounts, closed.channel, tx(closed.accounts, action), NOW), closed, 'channel_closed');
});

test('expiry settles without the owner, without a closing fee and without changing any nonce', () => {
  const used = consumed(opened());
  const before = structuredClone(used);
  const expired = check(expireChannel(used.accounts, used.channel, EXPIRY));
  assert.deepEqual(used, before);
  assert.equal(expired.accounts['system:provider'].balanceAtoms, '100');
  assert.equal(expired.accounts['system:fees'].balanceAtoms, '12');
  assert.equal(expired.accounts[OWNER].balanceAtoms, (FUNDS - 112n).toString());
  assert.equal(expired.accounts[OWNER].nonce, used.accounts[OWNER].nonce);
  assert.equal(expired.channel.closeReason, 'expired');
  assert.equal(expired.result.refundedAtoms, '200');
  assert.deepEqual(expired.transaction, channelExpiryTransaction(used.channel));
  assert.equal(expired.transaction.expiredAt, new Date(EXPIRY).toISOString());
  const later = expireChannel(used.accounts, used.channel, EXPIRY + 60000);
  assert.deepEqual(later.transaction, expired.transaction, 'system transaction identity must not depend on recovery timing');
  rejects(() => expireChannel(expired.accounts, expired.channel, EXPIRY + 1), expired, 'channel_closed');
});

test('expiry pays earned provider amounts even after the owner has no liquid funds left', () => {
  const used = consumed(opened({ capacity: 1 }));
  const accounts = structuredClone(used.accounts);
  accounts['system:reserve'].balanceAtoms = (BigInt(accounts['system:reserve'].balanceAtoms) + BigInt(accounts[OWNER].balanceAtoms)).toString();
  accounts[OWNER].balanceAtoms = '0';
  const expired = check(expireChannel(accounts, used.channel, EXPIRY));
  assert.equal(expired.accounts['system:provider'].balanceAtoms, '100');
  assert.equal(expired.accounts[OWNER].balanceAtoms, '0');
  assert.equal(expired.accounts[used.channel.escrow].balanceAtoms, '0');
});

test('exact saved calls remain authenticatable after closure but cannot be applied twice', () => {
  const used = consumed(opened());
  rejects(() => applyChannelCall(used.accounts, used.channel, used.request.message, used.request.signature, used.request.input, NOW), used, 'channel_sequence');
  const closed = expireChannel(used.accounts, used.channel, EXPIRY);
  assert.equal(authenticateChannelCall(closed.channel, used.request.message, used.request.signature, used.request.input), used.journal.messageHash);
  rejects(() => applyChannelCall(closed.accounts, closed.channel, used.request.message, used.request.signature, used.request.input, EXPIRY), closed, 'channel_closed');
  const changed = call(used.channel, 'different input', { sequence: 1 });
  assert.notEqual(authenticateChannelCall(used.channel, changed.message, changed.signature, changed.input), used.journal.messageHash);
  rejects(() => applyChannelCall(used.accounts, used.channel, changed.message, changed.signature, changed.input, NOW), used, 'channel_sequence');
});

test('wrong session keys, altered signed content and mismatching input fail before consumption', () => {
  const open = opened();
  const wrong = call(open.channel, 'hello', {}, wrongKey);
  rejects(() => applyChannelCall(open.accounts, open.channel, wrong.message, wrong.signature, wrong.input, NOW), open, 'invalid_signature');
  const good = call(open.channel, 'hello');
  rejects(() => applyChannelCall(open.accounts, open.channel, good.message, good.signature, 'altered input', NOW), open, 'input_mismatch');
  const changed = { ...good.message, inputHash: nativeHash('altered input') };
  rejects(() => applyChannelCall(open.accounts, open.channel, changed, good.signature, 'altered input', NOW), open, 'invalid_signature');
  const large = call(open.channel, 'a'.repeat(4001));
  rejects(() => applyChannelCall(open.accounts, open.channel, large.message, large.signature, large.input, NOW), open, 'input_mismatch');
});

test('expired, skipped and exhausted sequences cannot use more than the funded capacity', () => {
  const open = opened({ capacity: 1 });
  const next = call(open.channel);
  rejects(() => applyChannelCall(open.accounts, open.channel, next.message, next.signature, next.input, EXPIRY), open, 'channel_expired');
  const skipped = call(open.channel, 'hello', { sequence: 2 });
  rejects(() => applyChannelCall(open.accounts, open.channel, skipped.message, skipped.signature, skipped.input, NOW), open, 'channel_sequence');
  const used = consumed(open), over = call(used.channel);
  rejects(() => applyChannelCall(used.accounts, used.channel, over.message, over.signature, over.input, NOW), used, 'channel_exhausted');
  rejects(() => expireChannel(open.accounts, open.channel, EXPIRY - 1), open, 'channel_not_expired');
});

test('opening and closing caps enforce the explicit user debit without netting the refund', () => {
  const accounts = snapshot();
  rejects(() => openChannel(accounts, tx(accounts, opening(), OWNER, { maxDebitAtoms: '311' }), NOW), accounts, 'spending_cap');
  const open = opened(), close = { type: 'channel.close', channelId: open.channel.channelId };
  rejects(() => closeChannel(open.accounts, open.channel, tx(open.accounts, close, OWNER, { maxDebitAtoms: '11' }), NOW), open, 'spending_cap');
  rejects(() => closeChannel(open.accounts, open.channel, tx(open.accounts, close, OTHER), NOW), open, 'channel_owner_required');
  const noCalls = check(closeChannel(open.accounts, open.channel, tx(open.accounts, close), NOW));
  assert.equal(noCalls.accounts[OWNER].balanceAtoms, (FUNDS - 24n).toString());
  assert.equal(noCalls.result.settledAtoms, '0');
  assert.equal(noCalls.result.refundedAtoms, '300');
});

test('manual close is allowed after expiry and never cancels already consumed calls', () => {
  const used = consumed(opened());
  const transaction = tx(used.accounts, { type: 'channel.close', channelId: used.channel.channelId }, OWNER, {}, EXPIRY + 1);
  const closed = check(closeChannel(used.accounts, used.channel, transaction, EXPIRY + 1));
  assert.equal(closed.accounts['system:provider'].balanceAtoms, '100');
  assert.equal(closed.channel.closeReason, 'owner');
});

test('strict open schema rejects malformed capacities, keys, expiry and unknown fields', () => {
  const accounts = snapshot();
  for (const capacity of [0, -1, 10001, '3', null])
    rejects(() => openChannel(accounts, tx(accounts, opening({ capacity })), NOW), accounts, 'invalid_channel');
  rejects(() => openChannel(accounts, tx(accounts, opening({ capacity: 1.5 })), NOW), accounts);
  for (const sessionPublicKey of ['', [sessionKey.publicKey], sessionKey.publicKey + '='])
    rejects(() => openChannel(accounts, tx(accounts, opening({ sessionPublicKey })), NOW), accounts, 'invalid_session_key');
  rejects(() => openChannel(accounts, tx(accounts, opening({ sessionPublicKey: ownerKey.publicKey })), NOW), accounts, 'separate_session_key');
  for (const expiresAt of [new Date(NOW).toISOString(), new Date(NOW + 86400001).toISOString(), 'not a date', new Date(EXPIRY).toISOString().replace('.000Z', 'Z')])
    rejects(() => openChannel(accounts, tx(accounts, opening({ expiresAt })), NOW), accounts, 'invalid_channel_expiry');
  rejects(() => openChannel(accounts, tx(accounts, opening({ service: 'inference' })), NOW), accounts, 'invalid_channel');
  rejects(() => openChannel(accounts, tx(accounts, opening({ feeAtoms: '0' })), NOW), accounts, 'invalid_fields');
  assert.equal(opened({ capacity: 10000, expiresAt: new Date(NOW + 86400000).toISOString() }).channel.depositAtoms, '1000000');
});

test('strict call schema rejects network confusion, malformed sequences and extra spending fields', () => {
  const open = opened();
  for (const overrides of [{ chainId: 'another-chain' }, { domain: 'cinder.transaction.v1' }]) {
    const request = call(open.channel, 'hello', overrides);
    rejects(() => applyChannelCall(open.accounts, open.channel, request.message, request.signature, request.input, NOW), open, 'wrong_network');
  }
  for (const sequence of [0, '1', [1], 10001]) {
    const request = call(open.channel, 'hello', { sequence });
    rejects(() => applyChannelCall(open.accounts, open.channel, request.message, request.signature, request.input, NOW), open, 'invalid_channel_call');
  }
  const extra = call(open.channel, 'hello', { amountAtoms: '1' });
  rejects(() => applyChannelCall(open.accounts, open.channel, extra.message, extra.signature, extra.input, NOW), open, 'invalid_fields');
  const other = call(open.channel, 'hello', { channelId: 'f'.repeat(96) });
  rejects(() => applyChannelCall(open.accounts, open.channel, other.message, other.signature, other.input, NOW), open, 'wrong_channel');
});

test('corrupt escrow or channel counters fail closed without partial settlement', () => {
  const used = consumed(opened());
  const corruptAccounts = structuredClone(used.accounts);
  corruptAccounts[used.channel.escrow].balanceAtoms = '299';
  const request = call(used.channel);
  rejects(() => applyChannelCall(corruptAccounts, used.channel, request.message, request.signature, request.input, NOW), { corruptAccounts, channel: used.channel }, 'invalid_channel_escrow');
  rejects(() => expireChannel(corruptAccounts, used.channel, EXPIRY), { corruptAccounts, channel: used.channel }, 'invalid_channel_escrow');
  const badChannel = { ...used.channel, spentAtoms: '0' };
  rejects(() => expireChannel(used.accounts, badChannel, EXPIRY), { accounts: used.accounts, badChannel }, 'invalid_channel_state');
  const badTime = { ...used.channel, expiresAt: 'invalid' };
  rejects(() => expireChannel(used.accounts, badTime, EXPIRY), { accounts: used.accounts, badTime }, 'invalid_channel_state');
});

test('multi-call settlement conserves finite supply across both the full-use and unused-capacity paths', () => {
  for (const calls of [0, 1, 4, 8]) {
    let current = opened({ capacity: 8 });
    for (let i = 0; i < calls; i++) current = consumed(current, 'call-' + i);
    const result = check(expireChannel(current.accounts, current.channel, EXPIRY));
    assert.equal(result.accounts['system:provider'].balanceAtoms, (100n * BigInt(calls)).toString());
    assert.equal(result.accounts[OWNER].balanceAtoms, (FUNDS - 12n - 100n * BigInt(calls)).toString());
    assert.equal(result.accounts[result.channel.escrow].balanceAtoms, '0');
    assert.equal(result.result.callCount, calls);
  }
});
