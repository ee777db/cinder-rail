import test from 'node:test';
import assert from 'node:assert/strict';
import { NATIVE_CHAIN, NATIVE_SUPPLY, NativeError } from '../src/native-core.ts';
import { nativeHash } from '../src/native-crypto.ts';
import {
  initialEconomyState, applyEconomy, economyAccounts, economyInfo, economyWallet, auditEconomy,
  quoteWork, quoteSwap, quoteAddLiquidity, quoteRemoveLiquidity,
  WORK_SUPPLY, WORK_PRICE_ATOMS, ECONOMY_POOL, ECONOMY_PROVIDER, ECONOMY_MAX_WALLETS,
} from '../src/native-economy.ts';

const now = Date.parse('2026-09-07T12:00:00.000Z');
const deadline = new Date(now + 60000).toISOString();
const address = index => 'cin1' + nativeHash('test-account-' + index);
const A = address(0), B = address(1), C = address(2), D = address(3);
function fixture(count = 4) {
  const accounts = {};
  for (let i = 0; i < count; i++) accounts[address(i)] = { address: address(i), publicKey: 'test-only-authentication-is-the-caller-responsibility', balanceAtoms: '100000000', nonce: 0, claimedFaucet: true, createdAt: new Date(now).toISOString() };
  for (const id of ['system:fees', ECONOMY_POOL, ECONOMY_PROVIDER]) accounts[id] = { address: id, balanceAtoms: '0', nonce: 0, claimedFaucet: false, createdAt: new Date(now).toISOString() };
  accounts['system:reserve'] = { address: 'system:reserve', balanceAtoms: (BigInt(NATIVE_SUPPLY) - BigInt(count) * 100000000n).toString(), nonce: 0, claimedFaucet: false, createdAt: new Date(now).toISOString() };
  return { accounts, state: undefined };
}
function tx(f, action, sender = A, overrides = {}) {
  return { domain: 'cinder.transaction.v1', chainId: NATIVE_CHAIN, sender, nonce: f.accounts[sender].nonce + 1,
    validUntil: deadline, maxDebitAtoms: NATIVE_SUPPLY, actions: [action], ...overrides };
}
function sumNative(accounts) { return Object.values(accounts).reduce((sum, account) => sum + BigInt(account.balanceAtoms), 0n); }
function audited(f) {
  const audit = auditEconomy(f.state, f.accounts[ECONOMY_POOL].balanceAtoms, { completeWalletSet: true });
  assert.equal(audit.workConserved, true); assert.equal(audit.lpConserved, true); assert.equal(audit.poolCinderBacked, true);
  assert.equal(sumNative(f.accounts), BigInt(NATIVE_SUPPLY));
  return audit;
}
function run(f, action, sender = A, overrides = {}) {
  const before = structuredClone(f);
  const value = applyEconomy(f.accounts, f.state, tx(f, action, sender, overrides), now);
  assert.deepEqual(f, before, 'Pure transition must not mutate its caller snapshots');
  assert.equal(value.postings.reduce((sum, posting) => sum + BigInt(posting.deltaAtoms), 0n), 0n);
  assert.equal(value.result.workPostings.reduce((sum, posting) => sum + BigInt(posting.deltaUnits), 0n), 0n);
  assert.equal(value.result.feeAtoms, '12');
  assert.equal(value.accounts[sender].nonce, before.accounts[sender].nonce + 1);
  f.accounts = value.accounts; f.state = value.state;
  audited(f);
  return value;
}
function rejects(f, action, code, sender = A, overrides = {}) {
  const before = structuredClone(f);
  assert.throws(() => applyEconomy(f.accounts, f.state, tx(f, action, sender, overrides), now), error => error instanceof NativeError && error.code === code);
  assert.deepEqual(f, before, 'Rejected transitions must not charge fees, consume nonces, or change resource state');
}
const buy = units => ({ type: 'economy.buy', workUnits: String(units), maxCinderAtoms: String(BigInt(units) * 100n) });
const add = (cinder, work, minimum = '1') => ({ type: 'economy.addLiquidity', maxCinderAtoms: String(cinder), maxWorkUnits: String(work), minLpUnits: minimum, deadline });
const remove = (lp, minC = '1', minW = '1') => ({ type: 'economy.removeLiquidity', lpUnits: String(lp), minCinderAtoms: minC, minWorkUnits: minW, deadline });
const swap = (assetIn, amount, minimum = '1') => ({ type: 'economy.swap', assetIn, amountIn: String(amount), minOut: minimum, deadline });
function seedPool(f) { run(f, buy(200)); return run(f, add(10000, 100)); }

test('finite WORK genesis creates inventory only; empty pool has no fabricated liquidity or quote', () => {
  const f = fixture(), state = initialEconomyState();
  assert.equal(state.inventoryWork, '1000000'); assert.equal(WORK_SUPPLY, '1000000'); assert.equal(WORK_PRICE_ATOMS, '100');
  assert.deepEqual(state.pool, { cinderAtoms: '0', workUnits: '0', lpSupply: '0' });
  assert.deepEqual(state.wallets, {}); audited(f);
  assert.throws(() => quoteSwap(state, 'CINDER', '100'), error => error.code === 'economy_no_liquidity');
  assert.throws(() => quoteRemoveLiquidity(state, '1'), error => error.code === 'economy_no_liquidity');
  rejects(f, { type: 'economy.mint', workUnits: '1' }, 'economy_action');
  assert.deepEqual(economyAccounts(buy(1), A), [A, 'system:fees', ECONOMY_POOL, ECONOMY_PROVIDER]);
});

test('posted WORK purchase debits real CINDER, provider inventory and exactly one base fee', () => {
  const f = fixture(), before = BigInt(f.accounts[A].balanceAtoms);
  assert.deepEqual(quoteWork('3'), { workUnits: '3', cinderAtoms: '300', priceCinderAtoms: '100' });
  const result = run(f, buy(3));
  assert.equal(f.accounts[A].balanceAtoms, (before - 312n).toString());
  assert.equal(f.accounts[ECONOMY_PROVIDER].balanceAtoms, '300'); assert.equal(f.accounts['system:fees'].balanceAtoms, '12');
  assert.equal(f.state.inventoryWork, '999997'); assert.equal(f.state.walletWorkTotal, '3');
  assert.deepEqual(economyWallet(f.state, A), { workUnits: '3', lpUnits: '0' });
  assert.equal(result.result.grossDebitAtoms, '312'); assert.equal(result.result.globalState.inventoryWork, '999997');
  assert.equal(result.result.globalState.wallets, undefined);
});

test('WORK transfers require ownership and a registered recipient; self transfer conserves units', () => {
  const f = fixture(); run(f, buy(10));
  run(f, { type: 'economy.transfer', to: B, workUnits: '4' });
  assert.equal(economyWallet(f.state, A).workUnits, '6'); assert.equal(economyWallet(f.state, B).workUnits, '4');
  run(f, { type: 'economy.transfer', to: B, workUnits: '4' }, B);
  assert.equal(economyWallet(f.state, B).workUnits, '4'); assert.equal(f.state.walletWorkTotal, '10');
  rejects(f, { type: 'economy.transfer', to: A, workUnits: '5' }, 'economy_work_balance', B);
  rejects(f, { type: 'economy.transfer', to: address(99), workUnits: '1' }, 'economy_account');
  rejects(f, { type: 'economy.transfer', to: B, workUnits: '1', from: A }, 'economy_fields');
});

test('redemption burns exactly one owned WORK and exposes a bounded compute completion contract', () => {
  const f = fixture(); run(f, buy(2));
  const inputHash = nativeHash('one actual hash computation');
  const result = run(f, { type: 'economy.redeem', inputHash });
  assert.equal(f.state.burnedWork, '1'); assert.equal(f.state.inventoryWork, '999998'); assert.equal(f.state.walletWorkTotal, '1');
  assert.equal(economyWallet(f.state, A).workUnits, '1');
  assert.deepEqual(result.result.redemption, { service: 'hash', inputHash, workUnits: '1', maxInputChars: 4000 });
  assert.equal(result.result.grossDebitAtoms, '12');
  run(f, { type: 'economy.redeem', inputHash });
  rejects(f, { type: 'economy.redeem', inputHash }, 'economy_work_balance');
  rejects(f, { type: 'economy.redeem', inputHash, workUnits: '2' }, 'economy_fields');
  rejects(f, { type: 'economy.redeem', inputHash: ['a'.repeat(96)] }, 'economy_input');
});

test('first LP shares require both user-funded assets; reserve CINDER matches its native account', () => {
  const f = fixture(); rejects(f, add(10000, 100), 'economy_work_balance');
  const result = seedPool(f);
  assert.deepEqual(f.state.pool, { cinderAtoms: '10000', workUnits: '100', lpSupply: '1000' });
  assert.equal(f.accounts[ECONOMY_POOL].balanceAtoms, '10000');
  assert.equal(economyWallet(f.state, A).lpUnits, '1000'); assert.equal(economyWallet(f.state, A).workUnits, '100');
  assert.equal(result.result.events[0].lpUnits, '1000');
  assert.equal(f.state.walletLpTotal, '1000');
});

test('proportional LP addition uses only required assets and leaves unused maxima in the user wallet', () => {
  const f = fixture(); seedPool(f); run(f, buy(50), B);
  assert.deepEqual(quoteAddLiquidity(f.state, '20000', '10'), { cinderAtoms: '1000', workUnits: '10', lpUnits: '100', unusedCinderAtoms: '19000', unusedWorkUnits: '0' });
  const before = BigInt(f.accounts[B].balanceAtoms);
  run(f, add(20000, 10, '100'), B, { maxDebitAtoms: '1012' });
  assert.equal(f.accounts[B].balanceAtoms, (before - 1012n).toString());
  assert.equal(economyWallet(f.state, B).workUnits, '40'); assert.equal(economyWallet(f.state, B).lpUnits, '100');
  assert.deepEqual(f.state.pool, { cinderAtoms: '11000', workUnits: '110', lpSupply: '1100' });
  run(f, remove(100, '1000', '10'), B);
  assert.deepEqual(f.state.pool, { cinderAtoms: '10000', workUnits: '100', lpSupply: '1000' });
  assert.equal(economyWallet(f.state, B).lpUnits, '0');
});

test('LP integer rounding uses ceil inputs and floor outputs without silent over-deposits', () => {
  const f = fixture(); run(f, buy(20)); run(f, add(101, 10)); run(f, buy(20), B);
  const quote = quoteAddLiquidity(f.state, '100', '10');
  assert.deepEqual(quote, { cinderAtoms: '98', workUnits: '10', lpUnits: '30', unusedCinderAtoms: '2', unusedWorkUnits: '0' });
  run(f, add(100, 10, '30'), B);
  assert.deepEqual(quoteRemoveLiquidity(f.state, '30'), { lpUnits: '30', cinderAtoms: '97', workUnits: '9' });
  run(f, remove(30, '97', '9'), B);
  assert.equal(f.state.pool.cinderAtoms, '102'); assert.equal(f.state.pool.workUnits, '11');
});

test('constant-product swaps execute both directions with integer outputs and retained 30bps fees', () => {
  const f = fixture(); seedPool(f);
  const first = quoteSwap(f.state, 'CINDER', '1000');
  assert.equal(first.amountOut, '9'); assert.equal(first.swapFeeBps, 30);
  const k0 = BigInt(f.state.pool.cinderAtoms) * BigInt(f.state.pool.workUnits);
  run(f, swap('CINDER', 1000, '9'), B);
  assert.deepEqual(f.state.pool, { cinderAtoms: '11000', workUnits: '91', lpSupply: '1000' });
  assert.equal(economyWallet(f.state, B).workUnits, '9');
  assert.ok(BigInt(f.state.pool.cinderAtoms) * BigInt(f.state.pool.workUnits) >= k0);
  assert.equal(quoteSwap(f.state, 'WORK', '5').amountOut, '571');
  const before = BigInt(f.accounts[B].balanceAtoms);
  run(f, swap('WORK', 5, '571'), B, { maxDebitAtoms: '12' });
  assert.equal(f.accounts[B].balanceAtoms, (before + 571n - 12n).toString());
  assert.equal(economyWallet(f.state, B).workUnits, '4');
  assert.deepEqual(f.state.pool, { cinderAtoms: '10429', workUnits: '96', lpSupply: '1000' });
});

test('slippage, quoted purchase caps, deadlines, dust and gross CINDER budgets fail atomically', () => {
  const f = fixture(); seedPool(f);
  rejects(f, { ...buy(1), maxCinderAtoms: '99' }, 'economy_slippage');
  rejects(f, buy(1), 'spending_cap', A, { maxDebitAtoms: '111' });
  rejects(f, swap('CINDER', 1000, '10'), 'economy_slippage', B);
  rejects(f, swap('CINDER', 1000, '9'), 'spending_cap', B, { maxDebitAtoms: '1011' });
  rejects(f, swap('CINDER', 1), 'economy_dust');
  rejects(f, add(1000, 10, '101'), 'economy_slippage');
  rejects(f, remove(100, '1001', '10'), 'economy_slippage');
  rejects(f, { ...swap('CINDER', 1000), deadline: new Date(now).toISOString() }, 'economy_expired');
  rejects(f, { ...swap('CINDER', 1000), deadline: new Date(now + 300001).toISOString() }, 'economy_expired');
  rejects(f, { ...swap('CINDER', 1000), deadline: 'not-a-date' }, 'economy_deadline');
  rejects(f, buy(1), 'expired', A, { validUntil: new Date(now - 1).toISOString() });
});

test('LP ownership is enforced and complete withdrawal empties rather than strands the pool', () => {
  const f = fixture(); seedPool(f);
  rejects(f, remove(100), 'economy_lp_balance', B);
  rejects(f, remove(1001), 'economy_lp');
  run(f, remove(1000, '10000', '100'));
  assert.deepEqual(f.state.pool, { cinderAtoms: '0', workUnits: '0', lpSupply: '0' });
  assert.equal(f.accounts[ECONOMY_POOL].balanceAtoms, '0'); assert.equal(f.state.walletLpTotal, '0');
  assert.equal(economyWallet(f.state, A).workUnits, '200');
  assert.throws(() => quoteSwap(f.state, 'WORK', '1'), error => error.code === 'economy_no_liquidity');
  run(f, add(500, 5)); assert.equal(f.state.pool.lpSupply, '50');
});

test('fees must be funded before LP withdrawal or WORK-to-CINDER swap proceeds become available', () => {
  const f = fixture(); seedPool(f);
  const original = BigInt(f.accounts[A].balanceAtoms);
  f.accounts['system:reserve'].balanceAtoms = (BigInt(f.accounts['system:reserve'].balanceAtoms) + original).toString();
  f.accounts[A].balanceAtoms = '0';
  rejects(f, remove(100), 'insufficient_balance');
  rejects(f, swap('WORK', 5), 'insufficient_balance');
  audited(f);
});

test('native signature caller contract still enforces next nonce, one action and correct network', () => {
  const f = fixture(), action = buy(1), originalTx = tx(f, action);
  const result = run(f, action);
  assert.equal(result.accounts[A].nonce, 1);
  const before = structuredClone(f);
  assert.throws(() => applyEconomy(f.accounts, f.state, originalTx, now), error => error.code === 'wrong_nonce');
  assert.deepEqual(f, before);
  rejects(f, action, 'economy_batch', A, { actions: [action, action] });
  rejects(f, action, 'wrong_network', A, { chainId: 'other-chain' });
  rejects(f, action, 'wrong_nonce', A, { nonce: 999 });
});

test('strict action schemas reject type coercions, bad amounts, hidden fields and public mint paths', () => {
  const f = fixture();
  for (const value of ['01', '-1', '1.0', 1, null, ['1'], '10001']) rejects(f, { type: 'economy.buy', workUnits: value, maxCinderAtoms: '1000000' }, 'economy_amount');
  rejects(f, { ...buy(1), recipient: B }, 'economy_fields');
  rejects(f, { type: 'economy.transfer', to: [B], workUnits: '1' }, 'economy_address');
  rejects(f, { type: 'economy.swap', assetIn: 'USD', amountIn: '1', minOut: '1', deadline }, 'economy_asset');
  rejects(f, { type: 'economy.issue', workUnits: '1' }, 'economy_action');
  assert.throws(() => economyAccounts({ type: 'economy.buy', workUnits: '1' }, A), error => error.code === 'economy_fields');
  const inherited = Object.create({ type: 'economy.buy' }); inherited.workUnits = '1'; inherited.maxCinderAtoms = '100';
  assert.throws(() => economyAccounts(inherited, A));
  let invoked = false;
  const accessor = { ...buy(1) }; Object.defineProperty(accessor, 'workUnits', { enumerable: true, get() { invoked = true; return '1'; } });
  assert.throws(() => economyAccounts(accessor, A)); assert.equal(invoked, false);
});

test('per-wallet and per-action capacity bounds hold while finite inventory can be fully exhausted', () => {
  const f = fixture(10);
  for (let owner = 0; owner < 10; owner++) for (let purchase = 0; purchase < 10; purchase++) run(f, buy(10000), address(owner));
  assert.equal(f.state.inventoryWork, '0'); assert.equal(f.state.walletWorkTotal, WORK_SUPPLY);
  assert.equal(f.state.walletCount, 10);
  rejects(f, buy(1), 'economy_inventory');
  assert.throws(() => quoteWork('1', f.state), error => error.code === 'economy_inventory');
  rejects(f, { type: 'economy.transfer', to: B, workUnits: '1' }, 'economy_wallet_limit');
  const bounded = fixture(); bounded.state = initialEconomyState(); bounded.state.walletCount = ECONOMY_MAX_WALLETS;
  rejects(bounded, buy(1), 'economy_capacity');
});

test('partial wallet shards preserve untouched owners and support a separate complete supply audit', () => {
  const f = fixture(); run(f, buy(20)); run(f, buy(30), B); seedPool(f);
  const completeBefore = structuredClone(f.state), accountsBefore = structuredClone(f.accounts);
  const action = { type: 'economy.transfer', to: C, workUnits: '5' };
  const needed = economyAccounts(action, A);
  const partialAccounts = Object.fromEntries(needed.map(key => [key, f.accounts[key]]));
  const partialState = { ...f.state, wallets: { [A]: f.state.wallets[A] } };
  const partial = applyEconomy(partialAccounts, partialState, tx(f, action), now);
  assert.equal(partial.state.wallets[B], undefined);
  assert.equal(partial.state.wallets[C].workUnits, '5');
  assert.equal(partial.result.audit.completeWalletAudit, false);
  assert.throws(() => auditEconomy(partial.state, partial.accounts[ECONOMY_POOL].balanceAtoms, { completeWalletSet: true }), error => error.code === 'economy_incomplete_audit');
  f.accounts = { ...f.accounts, ...partial.accounts };
  f.state = { ...partial.state, wallets: { ...f.state.wallets, ...partial.state.wallets } };
  assert.deepEqual(f.state.wallets[B], completeBefore.wallets[B]);
  assert.deepEqual(f.accounts[B], accountsBefore[B]); audited(f);
  const info = economyInfo(f.state);
  assert.deepEqual(info.state.wallets, {});
  assert.ok(JSON.stringify({ ...f.state, wallets: undefined }).length < 1000, 'Global record remains small regardless of wallet count');
  assert.equal(quoteSwap(info.state, 'CINDER', '1000').amountOut, quoteSwap(f.state, 'CINDER', '1000').amountOut);
});

test('corrupt supply counters, LP totals, missing backing and incomplete full audits fail closed', () => {
  const f = fixture(); seedPool(f);
  const corrupt = structuredClone(f.state); corrupt.inventoryWork = (BigInt(corrupt.inventoryWork) + 1n).toString();
  assert.throws(() => auditEconomy(corrupt), error => error.code === 'economy_conservation');
  const lp = structuredClone(f.state); lp.walletLpTotal = '0';
  assert.throws(() => auditEconomy(lp), error => error.code === 'economy_conservation');
  const wallet = structuredClone(f.state); wallet.wallets[A].workUnits = '99999';
  assert.throws(() => auditEconomy(wallet), error => error.code === 'economy_conservation');
  assert.throws(() => auditEconomy(f.state, '9999'), error => error.code === 'economy_backing');
  const empty = fixture(); empty.accounts[ECONOMY_POOL].balanceAtoms = '1'; empty.accounts['system:reserve'].balanceAtoms = (BigInt(empty.accounts['system:reserve'].balanceAtoms) - 1n).toString();
  rejects(empty, buy(1), 'economy_backing');
  const sparse = { ...f.state, wallets: {} };
  assert.throws(() => auditEconomy(sparse, undefined, { completeWalletSet: true }), error => error.code === 'economy_incomplete_audit');
});

test('published WORK and LP postings reconstruct all wallet shards and global state', () => {
  const f = fixture(), records = [];
  records.push(run(f, buy(200)), run(f, add(10000, 100)), run(f, swap('CINDER', 1000), B));
  records.push(run(f, { type: 'economy.transfer', to: C, workUnits: '2' }, B));
  records.push(run(f, { type: 'economy.redeem', inputHash: nativeHash('paid computation') }, C));
  records.push(run(f, remove(100)));
  const work = new Map([['system:work-inventory', BigInt(WORK_SUPPLY)]]), lp = new Map();
  for (const record of records) {
    for (const post of record.result.workPostings) work.set(post.account, (work.get(post.account) || 0n) + BigInt(post.deltaUnits));
    for (const post of record.result.lpPostings) lp.set(post.account, (lp.get(post.account) || 0n) + BigInt(post.deltaUnits));
    assert.equal([...work.values()].reduce((sum, units) => sum + units, 0n), BigInt(WORK_SUPPLY));
    assert.equal([...lp.values()].reduce((sum, units) => sum + units, 0n).toString(), record.result.globalState.pool.lpSupply);
  }
  for (const [owner, wallet] of Object.entries(f.state.wallets)) {
    assert.equal((work.get(owner) || 0n).toString(), wallet.workUnits);
    assert.equal((lp.get(owner) || 0n).toString(), wallet.lpUnits);
  }
  assert.equal(work.get(ECONOMY_POOL).toString(), f.state.pool.workUnits);
  assert.equal(work.get('system:work-inventory').toString(), f.state.inventoryWork);
  assert.equal(work.get('system:work-consumed').toString(), f.state.burnedWork);
});

test('200 deterministic market transitions conserve both assets and never reduce swap product', () => {
  const f = fixture(); run(f, buy(1000)); run(f, add(100000, 1000)); run(f, buy(1000), B);
  let random = 123456789;
  for (let i = 0; i < 200; i++) {
    random = (Math.imul(random, 1664525) + 1013904223) >>> 0;
    const asset = random % 2 ? 'CINDER' : 'WORK';
    const amount = asset === 'CINDER' ? String(500 + random % 5000) : String(1 + random % 9);
    const beforeK = BigInt(f.state.pool.cinderAtoms) * BigInt(f.state.pool.workUnits);
    const quote = quoteSwap(f.state, asset, amount);
    run(f, swap(asset, amount, quote.amountOut), B);
    assert.ok(BigInt(f.state.pool.cinderAtoms) * BigInt(f.state.pool.workUnits) >= beforeK);
    assert.ok(BigInt(f.state.pool.cinderAtoms) > 0n && BigInt(f.state.pool.workUnits) > 0n);
  }
  audited(f);
});
