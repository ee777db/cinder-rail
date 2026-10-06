import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_CHAIN, NATIVE_SUPPLY, NativeError } from '../src/native-core.ts';
import {
  applyMusic, musicAccounts, musicCatalog, musicTrack, musicListenKey,
  MUSIC_MAX_BYTES, MUSIC_MAX_PRICE_ATOMS,
} from '../src/native-music.ts';

const NOW = Date.parse('2026-09-07T12:00:00.000Z');
const OWNER = 'cin1' + 'a'.repeat(96), LISTENER = 'cin1' + 'b'.repeat(96);
const WRITER = 'cin1' + 'c'.repeat(96), PRODUCER = 'cin1' + 'd'.repeat(96);
const AUDIO = 'e'.repeat(96), LISTEN_ID = '1'.repeat(32);
const FUNDS = 100000000n;
function account(address, balance = 0n) {
  return { address, balanceAtoms: balance.toString(), nonce: 0, claimedFaucet: false,
    createdAt: new Date(NOW).toISOString(), ...(address.startsWith('cin1') ? { publicKey: 'verified-outside-pure-transition' } : {}) };
}
function accounts() {
  return Object.fromEntries([
    account(OWNER, FUNDS), account(LISTENER, FUNDS), account(WRITER), account(PRODUCER),
    account('system:reserve', BigInt(NATIVE_SUPPLY) - 2n * FUNDS), account('system:fees'),
  ].map(value => [value.address, value]));
}
function publish(overrides = {}) {
  return { type: 'music.publish', audioHash: AUDIO, title: 'First light', artist: 'Independent artist',
    mime: 'audio/mpeg', bytes: 4000, recipients: [{ address: OWNER, bps: 7000 }, { address: WRITER, bps: 2000 }, { address: PRODUCER, bps: 1000 }],
    priceAtoms: '101', rightsDeclared: true, ...overrides };
}
function tx(snapshot, action, sender = OWNER, overrides = {}) {
  return { domain: 'cinder.transaction.v1', chainId: NATIVE_CHAIN, sender,
    nonce: snapshot[sender].nonce + 1, validUntil: new Date(NOW + 60000).toISOString(),
    maxDebitAtoms: NATIVE_SUPPLY, actions: [action], ...overrides };
}
function accepted(snapshot, state, transaction, now = NOW) {
  const before = structuredClone({ snapshot, state, transaction });
  const result = applyMusic(snapshot, state, transaction, now);
  assert.deepEqual({ snapshot, state, transaction }, before, 'input snapshots must remain immutable');
  assert.equal(Object.values(result.accounts).reduce((sum, account) => sum + BigInt(account.balanceAtoms), 0n), BigInt(NATIVE_SUPPLY));
  assert.equal(result.postings.reduce((sum, posting) => sum + BigInt(posting.deltaAtoms), 0n), 0n);
  assert.ok(Object.values(result.accounts).every(account => BigInt(account.balanceAtoms) >= 0n));
  return result;
}
function rejected(snapshot, state, transaction, code, now = NOW) {
  const before = structuredClone({ snapshot, state, transaction });
  assert.throws(() => applyMusic(snapshot, state, transaction, now), error => {
    if (code) { assert.ok(error instanceof NativeError); assert.equal(error.code, code); }
    return true;
  });
  assert.deepEqual({ snapshot, state, transaction }, before, 'failed operation cannot mutate balances, nonce or metadata');
}
function published(overrides = {}) {
  const snapshot = accounts();
  return accepted(snapshot, undefined, tx(snapshot, publish(overrides)));
}
function listen(trackId, listenId = LISTEN_ID) { return { type: 'music.listen', trackId, listenId }; }

test('publish creates deterministic immutable metadata, consumes one nonce and charges exactly 12 atoms', () => {
  const snapshot = accounts(), transaction = tx(snapshot, publish(), OWNER, { maxDebitAtoms: '12' });
  const one = accepted(snapshot, undefined, transaction);
  const two = accepted(snapshot, undefined, transaction, NOW + 1000);
  assert.equal(one.result.trackId, two.result.trackId);
  assert.match(one.result.trackId, /^[a-f0-9]{96}$/);
  assert.equal(one.result.track.owner, OWNER);
  assert.equal(one.result.track.publishNonce, 1);
  assert.equal(one.result.track.active, true);
  assert.equal(one.accounts[OWNER].balanceAtoms, (FUNDS - 12n).toString());
  assert.equal(one.accounts[OWNER].nonce, 1);
  assert.equal(one.accounts['system:fees'].balanceAtoms, '12');
  assert.equal(one.state.totalTracks, 1);
  assert.equal(one.state.ownerCounts[OWNER], 1);
  assert.equal(one.result.events[0].rightsEvidence, 'publisher self-declaration; not verified ownership');
  const changed = published({ title: 'A different title' });
  assert.notEqual(one.result.trackId, changed.result.trackId);
});

test('publication requires an explicit boolean rights declaration', () => {
  const snapshot = accounts();
  for (const rightsDeclared of [false, 'true', 1, null, [], {}])
    rejected(snapshot, undefined, tx(snapshot, publish({ rightsDeclared })), 'rights_required');
  const action = publish(); delete action.rightsDeclared;
  rejected(snapshot, undefined, tx(snapshot, action), 'invalid_fields');
});

test('publication rejects unexpected fields and malformed metadata without charging', () => {
  const snapshot = accounts();
  const patches = [
    { audioHash: [AUDIO] }, { audioHash: AUDIO.toUpperCase() }, { title: '' }, { title: ' padded' },
    { title: 'bad\nlabel' }, { title: 'a'.repeat(121) }, { artist: 'a'.repeat(81) }, { mime: 'text/html' },
    { mime: ['audio/mpeg'] }, { bytes: 0 }, { bytes: MUSIC_MAX_BYTES + 1 }, { bytes: '4000' },
  ];
  for (const patch of patches) rejected(snapshot, undefined, tx(snapshot, publish(patch)), 'invalid_music_metadata');
  rejected(snapshot, undefined, tx(snapshot, publish({ bytes: 1.1 })));
  rejected(snapshot, undefined, tx(snapshot, publish({ callbackUrl: 'https://example.invalid' })), 'invalid_fields');
  const proto = JSON.parse(JSON.stringify(publish()).replace('"type":', '"__proto__":{"admin":true},"type":'));
  rejected(snapshot, undefined, tx(snapshot, proto), 'invalid_fields');
  const untrustedText = published({ title: '<script>alert(1)</script>' });
  assert.equal(untrustedText.result.track.title, '<script>alert(1)</script>', 'UI must render metadata as text, never execute it');
});

test('price is a positive canonical atom string with room for the network fee', () => {
  const snapshot = accounts();
  for (const priceAtoms of ['0', '-1', '01', '1.5', '1e3', 101, null, [101]])
    rejected(snapshot, undefined, tx(snapshot, publish({ priceAtoms })), 'invalid_amount');
  rejected(snapshot, undefined, tx(snapshot, publish({ priceAtoms: NATIVE_SUPPLY })), 'invalid_music_price');
  assert.equal(published({ priceAtoms: MUSIC_MAX_PRICE_ATOMS }).result.track.priceAtoms, MUSIC_MAX_PRICE_ATOMS);
});

test('split recipients must be unique registered accounts with integer basis points totaling 10000', () => {
  const snapshot = accounts();
  for (const recipients of [
    [{ address: OWNER, bps: 9999 }], [{ address: OWNER, bps: 5000 }, { address: OWNER, bps: 5000 }],
    [{ address: OWNER, bps: 10000.1 }], [{ address: 'system:fees', bps: 10000 }],
    [{ address: [OWNER], bps: 10000 }], [{ address: OWNER, bps: 10000, extra: true }],
  ]) rejected(snapshot, undefined, tx(snapshot, publish({ recipients })));
  const missing = 'cin1' + 'f'.repeat(96);
  rejected(snapshot, undefined, tx(snapshot, publish({ recipients: [{ address: OWNER, bps: 9999 }, { address: missing, bps: 1 }] })), 'unknown_recipient');
});

test('paid playback allocates every atom and records payment evidence without inventing listening counts', () => {
  const p = published();
  const payment = accepted(p.accounts, p.state, tx(p.accounts, listen(p.result.trackId), LISTENER, { maxDebitAtoms: '113' }));
  assert.equal(payment.accounts[LISTENER].balanceAtoms, (FUNDS - 113n).toString());
  assert.equal(payment.accounts[OWNER].balanceAtoms, (FUNDS - 12n + 71n).toString());
  assert.equal(payment.accounts[WRITER].balanceAtoms, '20');
  assert.equal(payment.accounts[PRODUCER].balanceAtoms, '10');
  assert.equal(payment.accounts['system:fees'].balanceAtoms, '24');
  assert.equal(payment.accounts[LISTENER].nonce, 1);
  assert.equal(payment.result.access.paidAtoms, '101');
  assert.equal(payment.result.access.audioHash, AUDIO);
  assert.match(payment.result.events[0].evidence, /not proof of human listening/);
  assert.equal(payment.result.listenCount, undefined);
  assert.deepEqual(payment.state.tracks[p.result.trackId], p.state.tracks[p.result.trackId]);
});

test('small prices preserve exact rounding including zero-share recipients', () => {
  const p = published({ priceAtoms: '1' });
  const payment = accepted(p.accounts, p.state, tx(p.accounts, listen(p.result.trackId), LISTENER));
  assert.deepEqual(payment.result.events[0].recipients.map(recipient => recipient.amountAtoms), ['1', '0', '0']);
  assert.equal(payment.accounts[OWNER].balanceAtoms, (FUNDS - 11n).toString());
  assert.equal(payment.accounts[LISTENER].balanceAtoms, (FUNDS - 13n).toString());
});

test('same sender and listen ID cannot charge again with a fresh nonce, even on another track', () => {
  const p = published();
  const paid = accepted(p.accounts, p.state, tx(p.accounts, listen(p.result.trackId), LISTENER));
  rejected(paid.accounts, paid.state, tx(paid.accounts, listen(p.result.trackId), LISTENER), 'music_access_used');
  const second = accepted(paid.accounts, paid.state, tx(paid.accounts, publish({ title: 'Second song' })));
  rejected(second.accounts, second.state, tx(second.accounts, listen(second.result.trackId), LISTENER), 'music_access_used');
  const otherSender = accepted(second.accounts, second.state, tx(second.accounts, listen(second.result.trackId), OWNER));
  assert.notEqual(otherSender.result.access.dedupKey, paid.result.access.dedupKey);
});

test('signed spending caps cover full listen price plus fee, including owner self-recipients', () => {
  const p = published();
  for (const sender of [OWNER, LISTENER])
    rejected(p.accounts, p.state, tx(p.accounts, listen(p.result.trackId), sender, { maxDebitAtoms: '112' }), 'spending_cap');
  const snapshot = accounts();
  rejected(snapshot, undefined, tx(snapshot, publish(), OWNER, { maxDebitAtoms: '11' }), 'spending_cap');
  rejected(snapshot, undefined, tx(snapshot, publish(), OWNER, { maxDebitAtoms: '01' }), 'invalid_amount');
});

test('insufficient full principal rejects atomically even if the payer receives most royalties', () => {
  const p = published();
  const poor = structuredClone(p.accounts);
  const removed = BigInt(poor[OWNER].balanceAtoms) - 112n;
  poor[OWNER].balanceAtoms = '112';
  poor['system:reserve'].balanceAtoms = (BigInt(poor['system:reserve'].balanceAtoms) + removed).toString();
  rejected(poor, p.state, tx(poor, listen(p.result.trackId)), 'insufficient_balance');
});

test('only publisher can unpublish; metadata, access history and lifetime counters remain', () => {
  const p = published();
  const paid = accepted(p.accounts, p.state, tx(p.accounts, listen(p.result.trackId), LISTENER));
  const action = { type: 'music.unpublish', trackId: p.result.trackId };
  rejected(paid.accounts, paid.state, tx(paid.accounts, action, LISTENER), 'music_owner_required');
  const removed = accepted(paid.accounts, paid.state, tx(paid.accounts, action));
  assert.equal(removed.state.tracks[p.result.trackId].active, false);
  assert.equal(removed.state.totalTracks, 1);
  assert.equal(removed.state.ownerCounts[OWNER], 1);
  assert.deepEqual(removed.state.listens, paid.state.listens);
  const { active, unpublishedAt, ...rest } = removed.state.tracks[p.result.trackId];
  const { active: previousActive, ...original } = p.state.tracks[p.result.trackId];
  assert.deepEqual(rest, original);
  assert.equal(unpublishedAt, new Date(NOW).toISOString());
  assert.deepEqual(musicCatalog(removed.state), []);
  rejected(removed.accounts, removed.state, tx(removed.accounts, listen(p.result.trackId, '2'.repeat(32)), LISTENER), 'music_unpublished');
  rejected(removed.accounts, removed.state, tx(removed.accounts, action), 'music_unpublished');
});

test('publication respects global and per-publisher lifetime limits from partial counters', () => {
  const snapshot = accounts();
  const base = { version: 1, totalTracks: 0, ownerCounts: {}, tracks: {}, listens: {} };
  rejected(snapshot, { ...base, totalTracks: 200 }, tx(snapshot, publish()), 'music_capacity');
  rejected(snapshot, { ...base, totalTracks: 10, ownerCounts: { [OWNER]: 10 } }, tx(snapshot, publish()), 'music_capacity');
  const last = accepted(snapshot, { ...base, totalTracks: 199, ownerCounts: { [OWNER]: 9 } }, tx(snapshot, publish()));
  assert.equal(last.state.totalTracks, 200);
  assert.equal(last.state.ownerCounts[OWNER], 10);
});

test('wrong network, replayed nonce, unsafe nonce and expired envelopes cannot consume fees', () => {
  const p = published();
  const action = listen(p.result.trackId);
  rejected(p.accounts, p.state, tx(p.accounts, action, OWNER, { nonce: 1 }), 'wrong_nonce');
  rejected(p.accounts, p.state, tx(p.accounts, action, OWNER, { chainId: 'wrong-network' }), 'wrong_network');
  rejected(p.accounts, p.state, tx(p.accounts, action, OWNER, { nonce: Number.MAX_SAFE_INTEGER + 1 }), 'invalid_sender');
  rejected(p.accounts, p.state, tx(p.accounts, action, OWNER, { validUntil: new Date(NOW).toISOString() }), 'expired');
  rejected(p.accounts, p.state, tx(p.accounts, action, OWNER, { actions: [action, action] }), 'music_batch');
});

test('malformed listen IDs, track IDs and extra paid-event fields are rejected', () => {
  const p = published();
  for (const listenId of ['', '0'.repeat(31), 'A'.repeat(32), [LISTEN_ID], 123])
    rejected(p.accounts, p.state, tx(p.accounts, listen(p.result.trackId, listenId), LISTENER), 'invalid_music_access');
  rejected(p.accounts, p.state, tx(p.accounts, listen([p.result.trackId]), LISTENER), 'invalid_music_access');
  rejected(p.accounts, p.state, tx(p.accounts, { ...listen(p.result.trackId), listens: 1000000 }, LISTENER), 'invalid_fields');
  rejected(p.accounts, p.state, tx(p.accounts, listen('9'.repeat(96)), LISTENER), 'music_missing');
  assert.throws(() => musicListenKey([OWNER], LISTEN_ID), NativeError);
});

test('account loading resolves immutable recipients and read helpers return detached loaded rows', () => {
  const p = published();
  assert.deepEqual(new Set(musicAccounts(listen(p.result.trackId), LISTENER, p.state)), new Set([LISTENER, 'system:fees', OWNER, WRITER, PRODUCER]));
  assert.throws(() => musicAccounts(listen(p.result.trackId), LISTENER), error => error.code === 'music_missing');
  const track = musicTrack(p.state, p.result.trackId); track.title = 'caller mutation';
  const catalog = musicCatalog(p.state); catalog[0].recipients[0].bps = 1;
  assert.equal(p.state.tracks[p.result.trackId].title, 'First light');
  assert.equal(p.state.tracks[p.result.trackId].recipients[0].bps, 7000);
  assert.equal(musicTrack(p.state, '9'.repeat(96)), undefined);
});

test('partial row state suffices for a listen while preserving authoritative counters', () => {
  const p = published();
  const partial = { version: 1, totalTracks: 100, ownerCounts: {}, tracks: { [p.result.trackId]: p.result.track }, listens: {} };
  const paid = accepted(p.accounts, partial, tx(p.accounts, listen(p.result.trackId), LISTENER));
  assert.equal(paid.state.totalTracks, 100);
  assert.deepEqual(paid.state.ownerCounts, {});
  assert.equal(Object.keys(paid.state.listens).length, 1);
  assert.equal(Object.keys(paid.state.tracks).length, 1);
});
