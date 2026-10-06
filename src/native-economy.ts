/** Atomic, bounded resource inventory and CINDER/WORK spot market for the native devnet.
 * Pure transition only: caller authenticates, serializes, persists all returned records
 * atomically, and executes deterministic redemption before committing its WORK burn.
 */
import { NATIVE_SUPPLY, NATIVE_ADDRESS, NATIVE_DIGEST, NativeError, validateTransaction, type NativeAccount, type Posting } from './native-core.ts';

export const WORK_SUPPLY = '1000000';
export const WORK_PRICE_ATOMS = '100';
export const ECONOMY_FEE_ATOMS = '12';
export const ECONOMY_POOL = 'system:economy-pool';
export const ECONOMY_PROVIDER = 'system:economy-provider';
export const ECONOMY_SWAP_FEE_BPS = 30;
export const ECONOMY_MAX_WALLETS = 5000;
export const ECONOMY_MAX_WORK_PER_ACTION = '10000';
export const ECONOMY_MAX_WORK_PER_WALLET = '100000';
export const ECONOMY_MAX_CINDER_PER_ACTION = '1000000000';
export interface EconomyWallet { workUnits: string; lpUnits: string; }
export interface EconomyState {
  version: 1;
  inventoryWork: string;
  burnedWork: string;
  walletWorkTotal: string;
  walletLpTotal: string;
  walletCount: number;
  pool: { cinderAtoms: string; workUnits: string; lpSupply: string };
  /** Partial loaded wallet records only. Persist each record separately from globals. */
  wallets: Record<string, EconomyWallet>;
}
export type EconomyAction =
  | { type: 'economy.buy'; workUnits: string; maxCinderAtoms: string }
  | { type: 'economy.transfer'; to: string; workUnits: string }
  | { type: 'economy.redeem'; inputHash: string }
  | { type: 'economy.addLiquidity'; maxCinderAtoms: string; maxWorkUnits: string; minLpUnits: string; deadline: string }
  | { type: 'economy.removeLiquidity'; lpUnits: string; minCinderAtoms: string; minWorkUnits: string; deadline: string }
  | { type: 'economy.swap'; assetIn: 'CINDER' | 'WORK'; amountIn: string; minOut: string; deadline: string };

const zeroWallet = (): EconomyWallet => ({ workUnits: '0', lpUnits: '0' });
const fail = (code: string, message: string, status = 400): never => { throw new NativeError(code, message, status); };
const min = (a: bigint, b: bigint) => a < b ? a : b;
const ceil = (n: bigint, d: bigint) => (n + d - 1n) / d;
function quantity(value: unknown, maximum: string, zero = false): bigint {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,12})$/.test(value)) return fail('economy_amount', 'Use canonical nonnegative integer strings.');
  const n = BigInt(value);
  if (n < (zero ? 0n : 1n) || n > BigInt(maximum)) return fail('economy_amount', 'The resource or native amount exceeds its allowed bound.');
  return n;
}
function exact(value: unknown, fields: string[]): asserts value is Record<string, any> {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) return fail('economy_fields', 'Expected a plain economy object.');
  const keys = Reflect.ownKeys(value);
  if (keys.length !== fields.length || keys.some(key => typeof key !== 'string' || !fields.includes(key))) return fail('economy_fields', 'Missing or unknown economy fields.');
  for (const field of fields) {
    const descriptor = Object.getOwnPropertyDescriptor(value, field);
    if (!descriptor || !descriptor.enumerable || !('value' in descriptor)) return fail('economy_fields', 'Economy fields must be ordinary JSON values.');
  }
}
function address(value: unknown): asserts value is string {
  if (typeof value !== 'string' || !NATIVE_ADDRESS.test(value)) return fail('economy_address', 'Use a registered native account address.');
}
function deadline(value: unknown, now?: number): void {
  const timestamp = typeof value === 'string' ? Date.parse(value) : NaN;
  if (!Number.isFinite(timestamp) || new Date(timestamp).toISOString() !== value) return fail('economy_deadline', 'Use a canonical ISO deadline.');
  if (now !== undefined && (timestamp <= now || timestamp > now + 300000)) return fail('economy_expired', 'Market deadline must be live and within five minutes.', 410);
}
function validatedAction(value: unknown, now?: number): EconomyAction {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return fail('economy_fields', 'Expected one economy action.');
  const descriptor = Object.getOwnPropertyDescriptor(value, 'type');
  const type = descriptor && 'value' in descriptor ? descriptor.value : undefined;
  const action: any = value;
  switch (type) {
    case 'economy.buy': exact(action, ['type', 'workUnits', 'maxCinderAtoms']); quantity(action.workUnits, ECONOMY_MAX_WORK_PER_ACTION); quantity(action.maxCinderAtoms, ECONOMY_MAX_CINDER_PER_ACTION); break;
    case 'economy.transfer': exact(action, ['type', 'to', 'workUnits']); address(action.to); quantity(action.workUnits, ECONOMY_MAX_WORK_PER_ACTION); break;
    case 'economy.redeem': exact(action, ['type', 'inputHash']); if (typeof action.inputHash !== 'string' || !NATIVE_DIGEST.test(action.inputHash)) return fail('economy_input', 'Redemption requires the SHA-384 digest of its bounded hash-compute input.'); break;
    case 'economy.addLiquidity': exact(action, ['type', 'maxCinderAtoms', 'maxWorkUnits', 'minLpUnits', 'deadline']); quantity(action.maxCinderAtoms, ECONOMY_MAX_CINDER_PER_ACTION); quantity(action.maxWorkUnits, ECONOMY_MAX_WORK_PER_ACTION); quantity(action.minLpUnits, NATIVE_SUPPLY); deadline(action.deadline, now); break;
    case 'economy.removeLiquidity': exact(action, ['type', 'lpUnits', 'minCinderAtoms', 'minWorkUnits', 'deadline']); quantity(action.lpUnits, NATIVE_SUPPLY); quantity(action.minCinderAtoms, NATIVE_SUPPLY); quantity(action.minWorkUnits, WORK_SUPPLY); deadline(action.deadline, now); break;
    case 'economy.swap': exact(action, ['type', 'assetIn', 'amountIn', 'minOut', 'deadline']);
      if (action.assetIn !== 'CINDER' && action.assetIn !== 'WORK') return fail('economy_asset', 'The spot pair is CINDER/WORK.');
      quantity(action.amountIn, action.assetIn === 'CINDER' ? ECONOMY_MAX_CINDER_PER_ACTION : ECONOMY_MAX_WORK_PER_ACTION);
      quantity(action.minOut, action.assetIn === 'CINDER' ? WORK_SUPPLY : NATIVE_SUPPLY); deadline(action.deadline, now); break;
    default: return fail('economy_action', 'Unknown resource or market action.');
  }
  return action as EconomyAction;
}
export function initialEconomyState(): EconomyState {
  return { version: 1, inventoryWork: WORK_SUPPLY, burnedWork: '0', walletWorkTotal: '0', walletLpTotal: '0', walletCount: 0,
    pool: { cinderAtoms: '0', workUnits: '0', lpSupply: '0' }, wallets: {} };
}

/** Aggregate supply audit works with partial wallets; full audit additionally checks all shards. */
export function auditEconomy(input?: EconomyState, poolNativeBalance?: string, options: { completeWalletSet?: boolean } = {}) {
  const state = input ?? initialEconomyState();
  exact(state, ['version', 'inventoryWork', 'burnedWork', 'walletWorkTotal', 'walletLpTotal', 'walletCount', 'pool', 'wallets']);
  if (state.version !== 1 || !Number.isSafeInteger(state.walletCount) || state.walletCount < 0 || state.walletCount > ECONOMY_MAX_WALLETS) return fail('economy_state', 'Invalid bounded economy state.', 500);
  exact(state.pool, ['cinderAtoms', 'workUnits', 'lpSupply']);
  const inventory = quantity(state.inventoryWork, WORK_SUPPLY, true), burned = quantity(state.burnedWork, WORK_SUPPLY, true);
  const walletWork = quantity(state.walletWorkTotal, WORK_SUPPLY, true), walletLp = quantity(state.walletLpTotal, NATIVE_SUPPLY, true);
  const poolWork = quantity(state.pool.workUnits, WORK_SUPPLY, true), poolCinder = quantity(state.pool.cinderAtoms, NATIVE_SUPPLY, true), lpSupply = quantity(state.pool.lpSupply, NATIVE_SUPPLY, true);
  if (inventory + burned + walletWork + poolWork !== BigInt(WORK_SUPPLY) || walletLp !== lpSupply) return fail('economy_conservation', 'WORK or LP aggregate supply does not reconcile.', 500);
  if ((lpSupply === 0n) !== (poolWork === 0n && poolCinder === 0n) || (lpSupply > 0n && (poolWork === 0n || poolCinder === 0n))) return fail('economy_pool', 'Pool reserves and LP supply are inconsistent.', 500);
  if (!state.wallets || typeof state.wallets !== 'object' || Array.isArray(state.wallets) || ![Object.prototype, null].includes(Object.getPrototypeOf(state.wallets))) return fail('economy_state', 'Wallet records must be a partial object.', 500);
  const keys = Object.keys(state.wallets);
  if (keys.length > state.walletCount) return fail('economy_state', 'More loaded wallets than registered economy wallets.', 500);
  let loadedWork = 0n, loadedLp = 0n;
  for (const key of keys) {
    address(key); const wallet = state.wallets[key]; exact(wallet, ['workUnits', 'lpUnits']);
    loadedWork += quantity(wallet.workUnits, ECONOMY_MAX_WORK_PER_WALLET, true);
    loadedLp += quantity(wallet.lpUnits, NATIVE_SUPPLY, true);
  }
  if (loadedWork > walletWork || loadedLp > walletLp) return fail('economy_conservation', 'Loaded wallet balances exceed global totals.', 500);
  if (options.completeWalletSet && (keys.length !== state.walletCount || loadedWork !== walletWork || loadedLp !== walletLp)) return fail('economy_incomplete_audit', 'Complete wallet audit requires every persisted economy wallet.', 500);
  if (poolNativeBalance !== undefined && quantity(poolNativeBalance, NATIVE_SUPPLY, true) !== poolCinder) return fail('economy_backing', 'Pool CINDER reserves do not match the actual native holding account.', 500);
  return { workSupply: WORK_SUPPLY, inventoryWork: inventory.toString(), burnedWork: burned.toString(), walletWorkTotal: walletWork.toString(), poolWork: poolWork.toString(),
    lpSupply: lpSupply.toString(), walletLpTotal: walletLp.toString(), workConserved: true, lpConserved: true,
    poolCinderBacked: poolNativeBalance === undefined ? null : true, loadedWallets: keys.length, walletCount: state.walletCount, completeWalletAudit: options.completeWalletSet === true };
}
export function economyWallet(state: EconomyState | undefined, owner: string): EconomyWallet {
  address(owner); return { ...(state?.wallets[owner] ?? zeroWallet()) };
}
export function economyInfo(input?: EconomyState) {
  const state = input ?? initialEconomyState(); const audit = auditEconomy(state);
  return { asset: { symbol: 'WORK', decimals: 0, definition: 'One SHA-384 hash computation of one well-formed UTF-8 text, 1 to 4000 JavaScript characters.', backing: 'Finite operator-promised devnet compute capacity; no dollar peg or redemption for money.' },
    offer: { priceCinderAtoms: WORK_PRICE_ATOMS, inventoryWork: state.inventoryWork, maxWorkPerAction: ECONOMY_MAX_WORK_PER_ACTION },
    pool: { ...state.pool }, swapFeeBps: ECONOMY_SWAP_FEE_BPS, transactionFeeAtoms: ECONOMY_FEE_ATOMS,
    maxWorkPerWallet: ECONOMY_MAX_WORK_PER_WALLET, audit,
    state: { ...state, pool: { ...state.pool }, wallets: {} } };
}
export function quoteWork(workUnits: string, input?: EconomyState) {
  const state = input ?? initialEconomyState(); auditEconomy(state);
  const work = quantity(workUnits, ECONOMY_MAX_WORK_PER_ACTION);
  if (work > BigInt(state.inventoryWork)) return fail('economy_inventory', 'The finite posted WORK inventory is exhausted.', 409);
  return { workUnits, cinderAtoms: (work * BigInt(WORK_PRICE_ATOMS)).toString(), priceCinderAtoms: WORK_PRICE_ATOMS };
}
function livePool(input?: EconomyState): EconomyState {
  const state = input ?? initialEconomyState(); auditEconomy(state);
  if (state.pool.lpSupply === '0') return fail('economy_no_liquidity', 'Users must deposit both assets before this pool can trade.', 409);
  return state;
}
export function quoteSwap(input: EconomyState | undefined, assetIn: 'CINDER' | 'WORK', amountIn: string) {
  const state = livePool(input);
  if (assetIn !== 'CINDER' && assetIn !== 'WORK') return fail('economy_asset', 'The spot pair is CINDER/WORK.');
  const amount = quantity(amountIn, assetIn === 'CINDER' ? ECONOMY_MAX_CINDER_PER_ACTION : ECONOMY_MAX_WORK_PER_ACTION);
  const reserveIn = BigInt(assetIn === 'CINDER' ? state.pool.cinderAtoms : state.pool.workUnits);
  const reserveOut = BigInt(assetIn === 'CINDER' ? state.pool.workUnits : state.pool.cinderAtoms);
  const adjusted = amount * BigInt(10000 - ECONOMY_SWAP_FEE_BPS);
  const output = adjusted * reserveOut / (reserveIn * 10000n + adjusted);
  if (output === 0n || output >= reserveOut) return fail('economy_dust', 'Input is too small for a positive integer output.', 409);
  return { assetIn, assetOut: assetIn === 'CINDER' ? 'WORK' : 'CINDER', amountIn, amountOut: output.toString(), swapFeeBps: ECONOMY_SWAP_FEE_BPS };
}
function sqrt(n: bigint): bigint {
  if (n < 2n) return n;
  let x = n, y = (x + 1n) / 2n;
  while (y < x) { x = y; y = (x + n / x) / 2n; }
  return x;
}
export function quoteAddLiquidity(input: EconomyState | undefined, maxCinderAtoms: string, maxWorkUnits: string) {
  const state = input ?? initialEconomyState(); auditEconomy(state);
  const maxC = quantity(maxCinderAtoms, ECONOMY_MAX_CINDER_PER_ACTION), maxW = quantity(maxWorkUnits, ECONOMY_MAX_WORK_PER_ACTION);
  const lp = BigInt(state.pool.lpSupply);
  const minted = lp === 0n ? sqrt(maxC * maxW) : min(maxC * lp / BigInt(state.pool.cinderAtoms), maxW * lp / BigInt(state.pool.workUnits));
  if (minted === 0n) return fail('economy_dust', 'Deposit is too small to create one LP unit.', 409);
  const cinder = lp === 0n ? maxC : ceil(minted * BigInt(state.pool.cinderAtoms), lp);
  const work = lp === 0n ? maxW : ceil(minted * BigInt(state.pool.workUnits), lp);
  if (lp + minted > BigInt(NATIVE_SUPPLY)) return fail('economy_limit', 'LP supply bound exceeded.', 409);
  return { cinderAtoms: cinder.toString(), workUnits: work.toString(), lpUnits: minted.toString(), unusedCinderAtoms: (maxC - cinder).toString(), unusedWorkUnits: (maxW - work).toString() };
}
export function quoteRemoveLiquidity(input: EconomyState | undefined, lpUnits: string) {
  const state = livePool(input); const shares = quantity(lpUnits, NATIVE_SUPPLY), total = BigInt(state.pool.lpSupply);
  if (shares > total) return fail('economy_lp', 'Requested LP amount exceeds pool supply.', 402);
  const cinder = shares * BigInt(state.pool.cinderAtoms) / total, work = shares * BigInt(state.pool.workUnits) / total;
  if (cinder === 0n || work === 0n) return fail('economy_dust', 'Withdrawal must return at least one unit of both assets.', 409);
  return { lpUnits, cinderAtoms: cinder.toString(), workUnits: work.toString() };
}

/** Native-account keys root must load; WORK/LP wallet shards use the native addresses in this list. */
export function economyAccounts(action: unknown, sender: string): string[] {
  address(sender); const valid = validatedAction(action);
  return [...new Set([sender, 'system:fees', ECONOMY_POOL, ECONOMY_PROVIDER, ...(valid.type === 'economy.transfer' ? [valid.to] : [])])];
}

/** Handles fee, next nonce, exact fields, gross CINDER spending cap and all atomic transitions. */
export function applyEconomy(snapshot: Record<string, NativeAccount>, input: EconomyState | undefined, tx: any, now: number) {
  if (!Number.isSafeInteger(now) || now < 0) return fail('economy_time', 'Invalid ledger clock.');
  validateTransaction(tx, now);
  if (tx.actions.length !== 1) return fail('economy_batch', 'Use exactly one economy action per transaction.');
  const action = validatedAction(tx.actions[0], now);
  const required = economyAccounts(action, tx.sender);
  for (const key of required) if (!snapshot[key]) return fail('economy_account', 'Load all native holding accounts and registered recipients.', 404);
  for (const [key, value] of Object.entries(snapshot)) {
    if (value.address !== key) return fail('economy_account', 'Native snapshot address mismatch.', 500);
    quantity(value.balanceAtoms, NATIVE_SUPPLY, true);
  }
  if (!snapshot[tx.sender].publicKey) return fail('unknown_sender', 'Register the sender first.', 404);
  if (snapshot[tx.sender].nonce + 1 !== tx.nonce) return fail('wrong_nonce', 'The transaction must use the next native account nonce.', 409);
  if (action.type === 'economy.transfer' && !snapshot[action.to].publicKey) return fail('unknown_recipient', 'Register the resource recipient first.', 404);
  auditEconomy(input, snapshot[ECONOMY_POOL].balanceAtoms);
  const state = structuredClone(input ?? initialEconomyState());
  const accounts = structuredClone(snapshot);
  const postings: Posting[] = [], workPostings: Array<{ account: string; deltaUnits: string }> = [], lpPostings: Array<{ account: string; deltaUnits: string }> = [];
  const nativeBefore = Object.values(accounts).reduce((sum, value) => sum + BigInt(value.balanceAtoms), 0n);
  if (nativeBefore > BigInt(NATIVE_SUPPLY)) return fail('economy_conservation', 'Loaded native balances exceed total CINDER supply.', 500);
  const wallet = (owner: string): EconomyWallet => {
    if (!state.wallets[owner]) {
      if (state.walletCount >= ECONOMY_MAX_WALLETS) return fail('economy_capacity', 'The bounded resource-wallet capacity is exhausted.', 429);
      state.wallets[owner] = zeroWallet(); state.walletCount++;
    }
    return state.wallets[owner];
  };
  const workDebit = (owner: string, amount: bigint) => {
    const value = wallet(owner);
    if (BigInt(value.workUnits) < amount) return fail('economy_work_balance', 'Insufficient WORK balance.', 402);
    value.workUnits = (BigInt(value.workUnits) - amount).toString(); state.walletWorkTotal = (BigInt(state.walletWorkTotal) - amount).toString();
    workPostings.push({ account: owner, deltaUnits: (-amount).toString() });
  };
  const workCredit = (owner: string, amount: bigint) => {
    const value = wallet(owner); const next = BigInt(value.workUnits) + amount;
    if (next > BigInt(ECONOMY_MAX_WORK_PER_WALLET)) return fail('economy_wallet_limit', 'This devnet wallet would exceed its WORK capacity.', 409);
    value.workUnits = next.toString(); state.walletWorkTotal = (BigInt(state.walletWorkTotal) + amount).toString();
    workPostings.push({ account: owner, deltaUnits: amount.toString() });
  };
  const move = (from: string, to: string, amount: bigint) => {
    if (amount === 0n) return;
    if (BigInt(accounts[from].balanceAtoms) < amount) return fail('insufficient_balance', 'Insufficient CINDER for the fee and resource or market action.', 402);
    accounts[from].balanceAtoms = (BigInt(accounts[from].balanceAtoms) - amount).toString();
    accounts[to].balanceAtoms = (BigInt(accounts[to].balanceAtoms) + amount).toString();
    postings.push({ account: from, deltaAtoms: (-amount).toString() }, { account: to, deltaAtoms: amount.toString() });
  };
  let quote: any;
  let gross = BigInt(ECONOMY_FEE_ATOMS);
  if (action.type === 'economy.buy') { quote = quoteWork(action.workUnits, state); if (BigInt(quote.cinderAtoms) > BigInt(action.maxCinderAtoms)) return fail('economy_slippage', 'Posted purchase exceeds the signed CINDER price cap.', 409); gross += BigInt(quote.cinderAtoms); }
  if (action.type === 'economy.addLiquidity') { quote = quoteAddLiquidity(state, action.maxCinderAtoms, action.maxWorkUnits); if (BigInt(quote.lpUnits) < BigInt(action.minLpUnits)) return fail('economy_slippage', 'Liquidity quote is below the signed minimum LP amount.', 409); gross += BigInt(quote.cinderAtoms); }
  if (action.type === 'economy.removeLiquidity') { quote = quoteRemoveLiquidity(state, action.lpUnits); if (BigInt(quote.cinderAtoms) < BigInt(action.minCinderAtoms) || BigInt(quote.workUnits) < BigInt(action.minWorkUnits)) return fail('economy_slippage', 'Withdrawal is below a signed asset minimum.', 409); }
  if (action.type === 'economy.swap') { quote = quoteSwap(state, action.assetIn, action.amountIn); if (BigInt(quote.amountOut) < BigInt(action.minOut)) return fail('economy_slippage', 'Swap output is below the signed minimum.', 409); if (action.assetIn === 'CINDER') gross += BigInt(action.amountIn); }
  if (gross > quantity(tx.maxDebitAtoms, NATIVE_SUPPLY, true)) return fail('spending_cap', 'Resource or market action exceeds its signed gross CINDER debit.', 402);
  if (BigInt(accounts[tx.sender].balanceAtoms) < gross) return fail('insufficient_balance', 'Fund the entire CINDER debit and fee before execution.', 402);
  move(tx.sender, 'system:fees', BigInt(ECONOMY_FEE_ATOMS));
  let event: any = { type: action.type };
  let redemption: { service: 'hash'; inputHash: string; workUnits: string; maxInputChars: number } | undefined;
  switch (action.type) {
    case 'economy.buy': {
      const work = BigInt(action.workUnits);
      move(tx.sender, ECONOMY_PROVIDER, BigInt(quote.cinderAtoms));
      state.inventoryWork = (BigInt(state.inventoryWork) - work).toString(); workPostings.push({ account: 'system:work-inventory', deltaUnits: (-work).toString() }); workCredit(tx.sender, work);
      event = { ...event, ...quote }; break;
    }
    case 'economy.transfer': {
      const work = BigInt(action.workUnits); workDebit(tx.sender, work); workCredit(action.to, work);
      event = { ...event, to: action.to, workUnits: action.workUnits }; break;
    }
    case 'economy.redeem': {
      workDebit(tx.sender, 1n); state.burnedWork = (BigInt(state.burnedWork) + 1n).toString(); workPostings.push({ account: 'system:work-consumed', deltaUnits: '1' });
      redemption = { service: 'hash', inputHash: action.inputHash, workUnits: '1', maxInputChars: 4000 };
      event = { ...event, ...redemption, requirement: 'Operator must complete the matching deterministic hash before atomically committing this burn.' }; break;
    }
    case 'economy.addLiquidity': {
      const cinder = BigInt(quote.cinderAtoms), work = BigInt(quote.workUnits), lp = BigInt(quote.lpUnits);
      move(tx.sender, ECONOMY_POOL, cinder); workDebit(tx.sender, work); workPostings.push({ account: ECONOMY_POOL, deltaUnits: work.toString() });
      state.pool.cinderAtoms = (BigInt(state.pool.cinderAtoms) + cinder).toString(); state.pool.workUnits = (BigInt(state.pool.workUnits) + work).toString();
      state.pool.lpSupply = (BigInt(state.pool.lpSupply) + lp).toString(); state.walletLpTotal = (BigInt(state.walletLpTotal) + lp).toString(); wallet(tx.sender).lpUnits = (BigInt(wallet(tx.sender).lpUnits) + lp).toString();
      lpPostings.push({ account: tx.sender, deltaUnits: lp.toString() }); event = { ...event, ...quote }; break;
    }
    case 'economy.removeLiquidity': {
      const lp = BigInt(action.lpUnits), value = wallet(tx.sender);
      if (BigInt(value.lpUnits) < lp) return fail('economy_lp_balance', 'Only the owner can redeem its LP balance.', 402);
      const cinder = BigInt(quote.cinderAtoms), work = BigInt(quote.workUnits);
      value.lpUnits = (BigInt(value.lpUnits) - lp).toString(); state.pool.lpSupply = (BigInt(state.pool.lpSupply) - lp).toString(); state.walletLpTotal = (BigInt(state.walletLpTotal) - lp).toString();
      move(ECONOMY_POOL, tx.sender, cinder); state.pool.cinderAtoms = (BigInt(state.pool.cinderAtoms) - cinder).toString();
      state.pool.workUnits = (BigInt(state.pool.workUnits) - work).toString(); workPostings.push({ account: ECONOMY_POOL, deltaUnits: (-work).toString() }); workCredit(tx.sender, work);
      lpPostings.push({ account: tx.sender, deltaUnits: (-lp).toString() }); event = { ...event, ...quote }; break;
    }
    case 'economy.swap': {
      const beforeK = BigInt(state.pool.cinderAtoms) * BigInt(state.pool.workUnits), amount = BigInt(action.amountIn), output = BigInt(quote.amountOut);
      if (action.assetIn === 'CINDER') {
        move(tx.sender, ECONOMY_POOL, amount); state.pool.cinderAtoms = (BigInt(state.pool.cinderAtoms) + amount).toString(); state.pool.workUnits = (BigInt(state.pool.workUnits) - output).toString();
        workPostings.push({ account: ECONOMY_POOL, deltaUnits: (-output).toString() }); workCredit(tx.sender, output);
      } else {
        workDebit(tx.sender, amount); state.pool.workUnits = (BigInt(state.pool.workUnits) + amount).toString(); state.pool.cinderAtoms = (BigInt(state.pool.cinderAtoms) - output).toString();
        workPostings.push({ account: ECONOMY_POOL, deltaUnits: amount.toString() }); move(ECONOMY_POOL, tx.sender, output);
      }
      if (BigInt(state.pool.cinderAtoms) * BigInt(state.pool.workUnits) < beforeK) return fail('economy_invariant', 'Constant-product invariant decreased.', 500);
      event = { ...event, ...quote }; break;
    }
  }
  accounts[tx.sender].nonce = tx.nonce;
  for (const value of Object.values(accounts)) quantity(value.balanceAtoms, NATIVE_SUPPLY, true);
  if (postings.reduce((sum, posting) => sum + BigInt(posting.deltaAtoms), 0n) !== 0n || Object.values(accounts).reduce((sum, value) => sum + BigInt(value.balanceAtoms), 0n) !== nativeBefore) return fail('economy_conservation', 'Native CINDER conservation failed.', 500);
  if (workPostings.reduce((sum, posting) => sum + BigInt(posting.deltaUnits), 0n) !== 0n) return fail('economy_conservation', 'WORK posting conservation failed.', 500);
  const audit = auditEconomy(state, accounts[ECONOMY_POOL].balanceAtoms);
  const globalState = { version: state.version, inventoryWork: state.inventoryWork, burnedWork: state.burnedWork,
    walletWorkTotal: state.walletWorkTotal, walletLpTotal: state.walletLpTotal, walletCount: state.walletCount, pool: { ...state.pool } };
  return { accounts, postings, result: { kind: 'native-economy', feeAtoms: ECONOMY_FEE_ATOMS, actionCount: 1, grossDebitAtoms: gross.toString(), events: [event], workPostings, lpPostings, audit, globalState, ...(redemption ? { redemption } : {}) }, state };
}
