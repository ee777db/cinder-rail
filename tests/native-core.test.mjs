import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  NATIVE_CHAIN, NATIVE_SUPPLY, NATIVE_FAUCET, NATIVE_SERVICES,
  NativeError, atoms, allocateSplit, touchedAccounts, txHash,
  validateTransaction, applyNativeTransaction,
} from '../src/native-core.ts';

// This suite exercises ledger rules only. Signature verification and persistence
// are deliberately outside applyNativeTransaction and have separate tests.
const NOW = Date.parse('2026-09-06T12:00:00.000Z');
const CREATED = new Date(NOW).toISOString();
const address = digit => 'cin1' + digit.repeat(96);
const ALICE = address('a');
const BOB = address('b');
const CAROL = address('c');
const DAVE = address('d');
const REF = 'e'.repeat(96);
const clone = value => structuredClone(value);

function account(id, balanceAtoms = '0', registered = true) {
  return { address: id, ...(registered ? { publicKey: 'fixture-public-key-' + id } : {}),
    balanceAtoms, nonce: 0, claimedFaucet: false, createdAt: CREATED };
}

function genesis() {
  return {
    'system:reserve': account('system:reserve', NATIVE_SUPPLY, false),
    'system:fees': account('system:fees', '0', false),
    'system:provider': account('system:provider', '0', false),
    [ALICE]: account(ALICE), [BOB]: account(BOB), [CAROL]: account(CAROL), [DAVE]: account(DAVE),
  };
}

function transaction(snapshot, actions, overrides = {}) {
  return { domain: 'cinder.transaction.v1', chainId: NATIVE_CHAIN, sender: ALICE,
    nonce: snapshot[ALICE].nonce + 1, maxDebitAtoms: NATIVE_SUPPLY,
    validUntil: new Date(NOW + 60_000).toISOString(),
    actions, ...overrides };
}

const transfer = (to, amountAtoms) => ({ type: 'transfer', to, amountAtoms });
const split = (amountAtoms, recipients, overrides = {}) => ({ type: 'split', amountAtoms,
  recipients, app: 'music', referenceHash: REF, units: 1, ...overrides });

function total(snapshot) {
  return Object.values(snapshot).reduce((sum, entry) => sum + BigInt(entry.balanceAtoms), 0n);
}

function succeeds(snapshot, tx) {
  const before = clone(snapshot);
  const result = applyNativeTransaction(snapshot, tx, NOW);
  assert.deepEqual(snapshot, before, 'A successful pure transition must not mutate its input');
  assert.equal(total(result.accounts), total(before), 'Account balances must conserve all atoms');
  assert.equal(total(result.accounts), BigInt(NATIVE_SUPPLY), 'The finite fixture supply cannot grow');
  assert.equal(result.postings.reduce((sum, p) => sum + BigInt(p.deltaAtoms), 0n), 0n);
  for (const entry of Object.values(result.accounts)) {
    assert.match(entry.balanceAtoms, /^(0|[1-9][0-9]*)$/);
    assert.ok(BigInt(entry.balanceAtoms) >= 0n);
    assert.ok(BigInt(entry.balanceAtoms) <= BigInt(NATIVE_SUPPLY));
  }
  return result;
}

function rejects(snapshot, tx, code) {
  const before = clone(snapshot);
  assert.throws(() => applyNativeTransaction(snapshot, tx, NOW), error => {
    if (code) {
      assert.ok(error instanceof NativeError, 'Expected a classified native ledger rejection');
      assert.equal(error.code, code);
    }
    return true;
  });
  assert.deepEqual(snapshot, before, 'A rejected batch must leave all balances and nonces unchanged');
}

function funded() {
  const snapshot = genesis();
  return succeeds(snapshot, transaction(snapshot, [{ type: 'faucet' }])).accounts;
}

test('finite genesis faucet transfers exactly 100000000 atoms once without minting or fees', () => {
  assert.equal(NATIVE_SUPPLY, '1000000000000');
  assert.equal(NATIVE_FAUCET, '100000000');
  const snapshot = genesis();
  const tx = transaction(snapshot, [{ type: 'faucet' }], { maxDebitAtoms: '0' });
  const result = succeeds(snapshot, tx);
  assert.equal(result.accounts[ALICE].balanceAtoms, NATIVE_FAUCET);
  assert.equal(result.accounts['system:reserve'].balanceAtoms, '999900000000');
  assert.equal(result.accounts['system:fees'].balanceAtoms, '0');
  assert.equal(result.accounts[ALICE].nonce, 1);
  assert.equal(result.accounts[ALICE].claimedFaucet, true);
  assert.equal(result.result.feeAtoms, '0');
  assert.deepEqual(result.result.events, [{ type: 'faucet', amountAtoms: NATIVE_FAUCET }]);
  rejects(result.accounts, tx, 'wrong_nonce');
  rejects(result.accounts, transaction(result.accounts, [{ type: 'faucet' }]), 'faucet_claimed');
});

test('faucet cannot combine with another action or exceed a depleted reserve', () => {
  const snapshot = funded();
  rejects(snapshot, transaction(snapshot, [{ type: 'faucet' }, transfer(BOB, '1')]), 'faucet_claimed');
  const depleted = genesis();
  depleted['system:reserve'].balanceAtoms = '99999999';
  depleted[BOB].balanceAtoms = (BigInt(NATIVE_SUPPLY) - 99_999_999n).toString();
  rejects(depleted, transaction(depleted, [{ type: 'faucet' }]), 'insufficient_balance');
});

test('ordinary transfers charge 10 + 2 per action and update only the sending nonce', () => {
  const snapshot = funded();
  const result = succeeds(snapshot, transaction(snapshot, [transfer(BOB, '100'), transfer(CAROL, '250')]));
  assert.equal(result.result.feeAtoms, '14');
  assert.equal(result.result.actionCount, 2);
  assert.equal(result.accounts[ALICE].balanceAtoms, '99999636');
  assert.equal(result.accounts[BOB].balanceAtoms, '100');
  assert.equal(result.accounts[CAROL].balanceAtoms, '250');
  assert.equal(result.accounts['system:fees'].balanceAtoms, '14');
  assert.equal(result.accounts[ALICE].nonce, 2);
  assert.equal(result.accounts[BOB].nonce, 0);
  assert.equal(result.accounts['system:reserve'].balanceAtoms, snapshot['system:reserve'].balanceAtoms);
});

test('signed maximum debit bounds all gross action amounts plus fees, including self-payments', () => {
  const snapshot = funded();
  const payment = [transfer(BOB, '100')];
  const bounded = succeeds(snapshot, transaction(snapshot, payment, { maxDebitAtoms: '112' }));
  assert.equal(bounded.accounts[ALICE].balanceAtoms, '99999888');
  rejects(snapshot, transaction(snapshot, payment, { maxDebitAtoms: '111' }), 'spending_cap');
  rejects(snapshot, transaction(snapshot, payment, { maxDebitAtoms: '0' }), 'spending_cap');
  rejects(snapshot, transaction(snapshot, [transfer(ALICE, '100')], { maxDebitAtoms: '111' }), 'spending_cap');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '100'), transfer(CAROL, '200')], { maxDebitAtoms: '313' }), 'spending_cap');
  succeeds(snapshot, transaction(snapshot, [transfer(BOB, '100'), transfer(CAROL, '200')], { maxDebitAtoms: '314' }));
  const recipients = [{ address: ALICE, bps: 9000 }, { address: BOB, bps: 1000 }];
  rejects(snapshot, transaction(snapshot, [split('100', recipients)], { maxDebitAtoms: '111' }), 'spending_cap');
  const compute = [{ type: 'compute', service: 'hash', inputHash: REF }];
  rejects(snapshot, transaction(snapshot, compute, { maxDebitAtoms: '111' }), 'spending_cap');
  succeeds(snapshot, transaction(snapshot, compute, { maxDebitAtoms: '112' }));
});

test('maximum debit is required and uses the same canonical atom encoding', () => {
  const snapshot = funded();
  const missing = transaction(snapshot, [transfer(BOB, '1')]); delete missing.maxDebitAtoms;
  rejects(snapshot, missing, 'invalid_fields');
  for (const maxDebitAtoms of ['01', '-1', '1.5', '1e3', '1000000000001', 100, 1.5, null, [NATIVE_SUPPLY]]) {
    rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { maxDebitAtoms }));
  }
});

test('same-account transfers preserve principal, require available funds, and charge the fee once', () => {
  const snapshot = funded();
  const result = succeeds(snapshot, transaction(snapshot, [transfer(ALICE, '99999988')]));
  assert.equal(result.accounts[ALICE].balanceAtoms, '99999988');
  assert.equal(result.accounts['system:fees'].balanceAtoms, '12');
  assert.equal(result.result.events[0].amountAtoms, '99999988');
  rejects(snapshot, transaction(snapshot, [transfer(ALICE, NATIVE_FAUCET)]), 'insufficient_balance');
});

test('largest-remainder splits allocate all 101 atoms exactly and record paid events', () => {
  const recipients = [{ address: BOB, bps: 7000 }, { address: CAROL, bps: 2000 }, { address: DAVE, bps: 1000 }];
  assert.deepEqual(allocateSplit(101n, recipients).map(p => p.amountAtoms), ['71', '20', '10']);
  const snapshot = funded();
  const result = succeeds(snapshot, transaction(snapshot, [split('101', recipients)]));
  assert.equal(result.accounts[ALICE].balanceAtoms, '99999887');
  assert.equal(result.accounts[BOB].balanceAtoms, '71');
  assert.equal(result.accounts[CAROL].balanceAtoms, '20');
  assert.equal(result.accounts[DAVE].balanceAtoms, '10');
  assert.equal(result.result.events[0].units, 1);
  assert.match(result.result.events[0].evidence, /not proof of listening/);
});

test('largest-remainder ties use address ordering, independent of recipient array ordering', () => {
  const forward = [{ address: BOB, bps: 5000 }, { address: CAROL, bps: 5000 }];
  const byAddress = value => Object.fromEntries(value.map(p => [p.address, p.amountAtoms]));
  assert.deepEqual(byAddress(allocateSplit(1n, forward)), { [BOB]: '1', [CAROL]: '0' });
  assert.deepEqual(byAddress(allocateSplit(1n, [...forward].reverse())), { [CAROL]: '0', [BOB]: '1' });
});

test('split rounding conserves atoms across small values, awkward weights, and supply-sized values', () => {
  const weights = [[1, 9999], [3333, 3333, 3334], [7000, 2000, 1000], [5000, 5000]];
  for (const bps of weights) {
    const recipients = bps.map((value, index) => ({ address: [BOB, CAROL, DAVE][index], bps: value }));
    for (const amount of [1n, 2n, 3n, 7n, 99n, 101n, 10000n, BigInt(NATIVE_SUPPLY)]) {
      const allocated = allocateSplit(amount, recipients);
      assert.equal(allocated.reduce((sum, p) => sum + BigInt(p.amountAtoms), 0n), amount);
      allocated.forEach((p, index) => {
        const floor = amount * BigInt(bps[index]) / 10000n;
        assert.ok(BigInt(p.amountAtoms) === floor || BigInt(p.amountAtoms) === floor + 1n);
      });
    }
  }
});

test('self-recipient splits cannot use netting to authorize more than the full available amount', () => {
  const snapshot = funded();
  const recipients = [{ address: ALICE, bps: 9000 }, { address: BOB, bps: 1000 }];
  rejects(snapshot, transaction(snapshot, [split(NATIVE_FAUCET, recipients)]), 'insufficient_balance');
  const result = succeeds(snapshot, transaction(snapshot, [split('100', recipients)]));
  assert.equal(result.accounts[ALICE].balanceAtoms, '99999978');
  assert.equal(result.accounts[BOB].balanceAtoms, '10');
});

test('usage counts and reference repetition do not mint coins or prove external events', () => {
  const snapshot = funded();
  const recipients = [{ address: BOB, bps: 10000 }];
  const one = succeeds(snapshot, transaction(snapshot, [split('101', recipients, { units: 1 })]));
  const million = succeeds(snapshot, transaction(snapshot, [split('101', recipients, { units: 1_000_000 })]));
  assert.deepEqual(one.accounts, million.accounts);
  assert.deepEqual(one.postings, million.postings);
  for (const app of ['music', 'agent', 'trade']) {
    const result = succeeds(snapshot, transaction(snapshot, [split('101', recipients, { app })]));
    assert.match(result.result.events[0].evidence, /not proof of listening, identity or trade execution/);
  }
  const again = succeeds(one.accounts, transaction(one.accounts, [split('101', recipients)]));
  assert.equal(again.accounts[BOB].balanceAtoms, '202', 'The same reference with a new nonce is a second paid event, not a unique-listener claim');
});

test('atom parser accepts only canonical bounded integer strings', () => {
  assert.equal(atoms('1'), 1n);
  assert.equal(atoms(NATIVE_SUPPLY), 1_000_000_000_000n);
  assert.equal(atoms('0', true), 0n);
  for (const invalid of ['0', '', '00', '01', '-1', '+1', '1.0', '0.5', '1e2', '0x10', ' 1', '1 ',
    '1000000000001', '99999999999999', 1, 1.5, 1n, NaN, Infinity, null, undefined, {}, []]) {
    assert.throws(() => atoms(invalid), error => error instanceof NativeError && error.code === 'invalid_amount');
  }
  const snapshot = funded();
  for (const invalid of ['0', '01', '-1', '1.2', '1e3', '1000000000001', 1, 1.5, null]) {
    rejects(snapshot, transaction(snapshot, [transfer(BOB, invalid)]));
  }
});

test('unknown or missing fields cannot silently change a signed transaction or its actions', () => {
  const snapshot = funded();
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { extra: 'ignored?' }), 'invalid_fields');
  const missing = transaction(snapshot, [transfer(BOB, '1')]); delete missing.validUntil;
  rejects(snapshot, missing, 'invalid_fields');
  rejects(snapshot, transaction(snapshot, [{ ...transfer(BOB, '1'), memo: 'ignored?' }]), 'invalid_fields');
  rejects(snapshot, transaction(snapshot, [{ type: 'transfer', to: BOB }]), 'invalid_fields');
  rejects(snapshot, transaction(snapshot, [split('1', [{ address: BOB, bps: 10000, extra: true }])]), 'invalid_fields');
  rejects(snapshot, transaction(snapshot, [{ type: 'mint', amountAtoms: '1' }]), 'invalid_action');
});

test('wrong domain, chain, sender and nonce fail without consuming fees', () => {
  const snapshot = funded();
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { domain: 'cinder.checkpoint.v1' }), 'wrong_network');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { chainId: 'another-chain' }), 'wrong_network');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { sender: 'system:reserve' }), 'invalid_sender');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { sender: address('f') }), 'unknown_sender');
  for (const nonce of [0, -1, 1.5, '2', Number.MAX_SAFE_INTEGER + 1]) {
    rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { nonce }), 'invalid_sender');
  }
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { nonce: 1 }), 'wrong_nonce');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { nonce: 3 }), 'wrong_nonce');
  const tx = transaction(snapshot, [transfer(BOB, '1')]);
  rejects(succeeds(snapshot, tx).accounts, tx, 'wrong_nonce');
});

test('deadlines are canonical, strictly future, and at most five minutes', () => {
  const snapshot = funded();
  for (const validUntil of [new Date(NOW).toISOString(), new Date(NOW - 1).toISOString()]) {
    rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { validUntil }), 'expired');
  }
  for (const validUntil of ['not-a-date', '2026-09-06T12:01:00Z', new Date(NOW + 300_001).toISOString(), NOW + 1000]) {
    rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { validUntil }), 'invalid_deadline');
  }
  validateTransaction(transaction(snapshot, [transfer(BOB, '1')], { validUntil: new Date(NOW + 300_000).toISOString() }), NOW);
});

test('overdraw and exhausted later batch actions are atomic, including the network fee', () => {
  const snapshot = funded();
  rejects(snapshot, transaction(snapshot, [transfer(BOB, NATIVE_FAUCET)]), 'insufficient_balance');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '60000000'), transfer(CAROL, '60000000')]), 'insufficient_balance');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1'), transfer(address('f'), '1')]), 'unknown_recipient');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1'), { type: 'unknown' }]), 'invalid_action');
  const empty = genesis();
  rejects(empty, transaction(empty, [transfer(BOB, '1')]), 'insufficient_balance');
});

test('batch action count is bounded and all 16 accepted actions contribute to the fee', () => {
  const snapshot = funded();
  rejects(snapshot, transaction(snapshot, []), 'batch_limit');
  rejects(snapshot, transaction(snapshot, Array.from({ length: 17 }, () => transfer(BOB, '1'))), 'batch_limit');
  const result = succeeds(snapshot, transaction(snapshot, Array.from({ length: 16 }, () => transfer(BOB, '1'))));
  assert.equal(result.result.feeAtoms, '42');
  assert.equal(result.accounts[BOB].balanceAtoms, '16');
  assert.equal(result.accounts[ALICE].balanceAtoms, '99999942');
});

test('split configuration rejects duplicate recipients, bad weights and unsupported metadata', () => {
  const snapshot = funded();
  const good = [{ address: BOB, bps: 10000 }];
  for (const recipients of [
    [{ address: BOB, bps: 9999 }], [{ address: BOB, bps: 10001 }],
    [{ address: BOB, bps: 5000 }, { address: BOB, bps: 5000 }],
    [{ address: BOB, bps: 0 }, { address: CAROL, bps: 10000 }],
    [{ address: BOB, bps: '10000' }], [{ address: BOB, bps: 9999.5 }],
    [{ address: 'system:reserve', bps: 10000 }],
  ]) rejects(snapshot, transaction(snapshot, [split('101', recipients)]));
  for (const overrides of [{ app: 'ad-subsidy' }, { referenceHash: 'e'.repeat(64) }, { referenceHash: 'E'.repeat(96) },
    { units: 0 }, { units: -1 }, { units: 1_000_001 }, { units: 1.5 }, { units: '1' }]) {
    rejects(snapshot, transaction(snapshot, [split('101', good, overrides)]));
  }
});

test('pure transition enforces native recipient addresses, not only the account-loading helper', () => {
  const snapshot = funded();
  for (const to of ['system:reserve', 'system:fees', 'system:provider', 'bad-address']) {
    rejects(snapshot, transaction(snapshot, [transfer(to, '1')]), 'invalid_recipient');
  }
});

test('native address and digest fields reject arrays rather than relying on regex string coercion', () => {
  const snapshot = funded();
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1')], { sender: [ALICE] }), 'invalid_sender');
  rejects(snapshot, transaction(snapshot, [transfer([BOB], '1')]), 'invalid_recipient');
  rejects(snapshot, transaction(snapshot, [split('1', [{ address: [BOB], bps: 10000 }])]), 'invalid_recipient');
  rejects(snapshot, transaction(snapshot, [split('1', [{ address: BOB, bps: 10000 }], { referenceHash: [REF] })]), 'invalid_usage');
  rejects(snapshot, transaction(snapshot, [{ type: 'compute', service: 'hash', inputHash: [REF] }]), 'invalid_compute');
});

test('pure transition enforces the maximum of eight split recipients', () => {
  const snapshot = funded();
  const recipients = Array.from({ length: 9 }, (_, i) => ({
    address: 'cin1' + (i + 1).toString(16).padStart(96, '0'), bps: i === 8 ? 1112 : 1111,
  }));
  for (const recipient of recipients) snapshot[recipient.address] = account(recipient.address);
  rejects(snapshot, transaction(snapshot, [split('101', recipients)]), 'split_limit');
  rejects(snapshot, transaction(snapshot, [split('101', [])]));
});

test('compute reserves its published price in transaction-specific escrow and does not pay a provider early', () => {
  const snapshot = funded();
  for (const service of NATIVE_SERVICES) {
    const tx = transaction(snapshot, [{ type: 'compute', service: service.id, inputHash: REF }]);
    const escrow = 'system:escrow:' + txHash(tx);
    const result = succeeds(snapshot, tx);
    assert.equal(result.accounts[escrow].balanceAtoms, service.amountAtoms);
    assert.equal(result.accounts['system:provider'].balanceAtoms, '0');
    assert.equal(result.accounts['system:fees'].balanceAtoms, '12');
    assert.equal(result.accounts[ALICE].balanceAtoms, (BigInt(NATIVE_FAUCET) - 12n - BigInt(service.amountAtoms)).toString());
    assert.equal(result.compute.escrow, escrow);
    assert.ok(touchedAccounts(tx).includes(escrow));
  }
  rejects(snapshot, transaction(snapshot, [{ type: 'compute', service: 'unknown', inputHash: REF }]), 'invalid_service');
  rejects(snapshot, transaction(snapshot, [{ type: 'compute', service: 'hash', inputHash: 'e'.repeat(64) }]), 'invalid_compute');
  rejects(snapshot, transaction(snapshot, [transfer(BOB, '1'), { type: 'compute', service: 'hash', inputHash: REF }]), 'invalid_compute');
});

test('stateful transfer sequence preserves supply and commits exactly one nonce per accepted transaction', () => {
  let snapshot = funded();
  for (let index = 0; index < 64; index++) {
    const oldNonce = snapshot[ALICE].nonce;
    const to = [BOB, CAROL, DAVE, ALICE][index % 4];
    const amount = String((index * 7919) % 1000 + 1);
    const tx = transaction(snapshot, [transfer(to, amount)]);
    const next = succeeds(snapshot, tx);
    assert.equal(next.accounts[ALICE].nonce, oldNonce + 1);
    rejects(next.accounts, tx, 'wrong_nonce');
    snapshot = next.accounts;
  }
  assert.equal(snapshot['system:fees'].balanceAtoms, String(64 * 12));
  assert.equal(snapshot[ALICE].nonce, 65);
});
