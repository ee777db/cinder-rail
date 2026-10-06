import { nativeAddress, nativeCanonical, nativeHash, nativeVerify } from './native-crypto.ts';
import {
  NATIVE_ADDRESS, NATIVE_CHAIN, NATIVE_DIGEST, NativeError, atoms, exact, txHash, validateTransaction,
  type NativeAccount, type Posting,
} from './native-core.ts';

export const CHANNEL_PRICE_ATOMS = '100';
export const CHANNEL_FEE_ATOMS = '12';
export const CHANNEL_MAX_CAPACITY = 10000;
export const CHANNEL_MAX_LIFETIME_MS = 86400000;
export interface NativeChannel {
  version: 1; channelId: string; owner: string; sessionPublicKey: string; service: 'hash';
  priceAtoms: string; capacity: number; sequence: number; depositAtoms: string;
  spentAtoms: string; remainingAtoms: string; escrow: string; openedAt: string;
  expiresAt: string; status: 'open' | 'closed'; journalHead: string; closedAt?: string; closeReason?: 'owner' | 'expired';
}
export interface ChannelMessage {
  domain: 'cinder.channel-call.v1'; chainId: string; channelId: string; sequence: number; inputHash: string;
}
const isDigest = (value: unknown): value is string => typeof value === 'string' && NATIVE_DIGEST.test(value);

function openAction(action: any) {
  exact(action, ['type', 'sessionPublicKey', 'capacity', 'expiresAt', 'service']);
  if (action.type !== 'channel.open' || action.service !== 'hash' || !Number.isSafeInteger(action.capacity)
    || action.capacity < 1 || action.capacity > CHANNEL_MAX_CAPACITY)
    throw new NativeError('invalid_channel', 'Open a hash channel for 1–10000 calls.');
  try { nativeAddress(action.sessionPublicKey); }
  catch { throw new NativeError('invalid_session_key', 'Use a canonically encoded ML-DSA-65 session public key.'); }
  const expiry = typeof action.expiresAt === 'string' ? Date.parse(action.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== action.expiresAt)
    throw new NativeError('invalid_channel_expiry', 'Use a canonical ISO channel expiry.');
}
function closeAction(action: any) {
  exact(action, ['type', 'channelId']);
  if (action.type !== 'channel.close' || !isDigest(action.channelId))
    throw new NativeError('invalid_channel', 'Use a valid channel close action.');
}
function envelope(snapshot: Record<string, NativeAccount>, tx: any, now: number) {
  validateTransaction(tx, now);
  if (tx.actions.length !== 1) throw new NativeError('channel_batch', 'Channel open and close each require a separate transaction.');
  const sender = snapshot[tx.sender];
  if (!sender?.publicKey) throw new NativeError('unknown_sender', 'Register this native account first.', 404);
  if (tx.nonce !== sender.nonce + 1) throw new NativeError('wrong_nonce', 'The signed nonce is not the next account nonce.', 409);
  return sender;
}
function checkChannel(channel: NativeChannel) {
  if (!channel || channel.version !== 1 || !isDigest(channel.channelId) || !isDigest(channel.journalHead)
    || channel.escrow !== 'system:channel:' + channel.channelId || channel.service !== 'hash'
    || channel.priceAtoms !== CHANNEL_PRICE_ATOMS || !Number.isSafeInteger(channel.capacity)
    || channel.capacity < 1 || channel.capacity > CHANNEL_MAX_CAPACITY
    || !Number.isSafeInteger(channel.sequence) || channel.sequence < 0 || channel.sequence > channel.capacity
    || !['open', 'closed'].includes(channel.status) || typeof channel.owner !== 'string' || !NATIVE_ADDRESS.test(channel.owner))
    throw new NativeError('invalid_channel_state', 'Channel state failed its integrity checks.', 503);
  const expiry = typeof channel.expiresAt === 'string' ? Date.parse(channel.expiresAt) : NaN;
  if (!Number.isFinite(expiry) || new Date(expiry).toISOString() !== channel.expiresAt)
    throw new NativeError('invalid_channel_state', 'Channel expiry is invalid.', 503);
  const deposit = BigInt(channel.capacity) * BigInt(CHANNEL_PRICE_ATOMS);
  const spent = BigInt(channel.sequence) * BigInt(CHANNEL_PRICE_ATOMS);
  if (channel.depositAtoms !== deposit.toString() || channel.spentAtoms !== spent.toString()
    || channel.remainingAtoms !== (deposit - spent).toString())
    throw new NativeError('invalid_channel_state', 'Channel accounting does not match its authorized call count.', 503);
}
function move(accounts: Record<string, NativeAccount>, postings: Posting[], from: string, to: string, amount: bigint) {
  if (amount === 0n) return;
  const a = accounts[from], b = accounts[to];
  if (!a || !b) throw new NativeError('unknown_recipient', 'Required native channel accounts are missing.', 404);
  if (BigInt(a.balanceAtoms) < amount) throw new NativeError('insufficient_balance', 'Insufficient balance for this channel transaction.', 402);
  a.balanceAtoms = (BigInt(a.balanceAtoms) - amount).toString();
  b.balanceAtoms = (BigInt(b.balanceAtoms) + amount).toString();
  postings.push({ account: from, deltaAtoms: (-amount).toString() }, { account: to, deltaAtoms: amount.toString() });
}
function conserved(postings: Posting[]) {
  if (postings.reduce((sum, posting) => sum + BigInt(posting.deltaAtoms), 0n) !== 0n)
    throw new Error('Channel posting conservation invariant failed');
}

export function channelAccounts(tx: any, channel?: NativeChannel): string[] {
  if (!Array.isArray(tx?.actions) || tx.actions.length !== 1)
    throw new NativeError('channel_batch', 'Use exactly one channel action.');
  const action = tx.actions[0];
  if (action?.type === 'channel.open') {
    openAction(action);
    return [tx.sender, 'system:fees', 'system:provider', 'system:channel:' + txHash(tx)];
  }
  closeAction(action);
  if (channel && channel.channelId !== action.channelId) throw new NativeError('wrong_channel', 'Loaded channel does not match this transaction.');
  return [...new Set([tx.sender, ...(channel ? [channel.owner] : []), 'system:fees', 'system:provider', 'system:channel:' + action.channelId])];
}
export function channelCallAccounts(channel: NativeChannel): string[] {
  checkChannel(channel);
  return [channel.escrow];
}

/** Root verifies the owner's transaction signature and persists this with an opening checkpoint. */
export function openChannel(snapshot: Record<string, NativeAccount>, tx: any, now: number) {
  const owner = envelope(snapshot, tx, now);
  const action = tx.actions[0]; openAction(action);
  if (action.sessionPublicKey === owner.publicKey)
    throw new NativeError('separate_session_key', 'Generate a separate bounded session key for this channel.');
  const expiry = Date.parse(action.expiresAt);
  if (expiry <= now || expiry > now + CHANNEL_MAX_LIFETIME_MS)
    throw new NativeError('invalid_channel_expiry', 'Channel expiry must be future and at most 24 hours away.');
  const deposit = BigInt(action.capacity) * BigInt(CHANNEL_PRICE_ATOMS);
  const debit = deposit + BigInt(CHANNEL_FEE_ATOMS);
  if (debit > atoms(tx.maxDebitAtoms, true)) throw new NativeError('spending_cap', 'Channel reservation exceeds its signed spending cap.', 402);
  if (BigInt(owner.balanceAtoms) < debit) throw new NativeError('insufficient_balance', 'Fund the full channel reservation and opening fee.', 402);
  const accounts = structuredClone(snapshot), postings: Posting[] = [];
  const channelId = txHash(tx), escrow = 'system:channel:' + channelId;
  if (accounts[escrow]) throw new NativeError('channel_exists', 'This channel escrow already exists.', 409);
  accounts[escrow] = { address: escrow, balanceAtoms: '0', nonce: 0, claimedFaucet: false, createdAt: new Date(now).toISOString() };
  const opening = {
    domain: 'cinder.channel.journal-genesis.v1', chainId: NATIVE_CHAIN, channelId, owner: tx.sender,
    sessionPublicKey: action.sessionPublicKey, service: 'hash', priceAtoms: CHANNEL_PRICE_ATOMS,
    capacity: action.capacity, depositAtoms: deposit.toString(), expiresAt: action.expiresAt,
  };
  const channel: NativeChannel = {
    version: 1, channelId, owner: tx.sender, sessionPublicKey: action.sessionPublicKey, service: 'hash',
    priceAtoms: CHANNEL_PRICE_ATOMS, capacity: action.capacity, sequence: 0, depositAtoms: deposit.toString(),
    spentAtoms: '0', remainingAtoms: deposit.toString(), escrow, openedAt: new Date(now).toISOString(),
    expiresAt: action.expiresAt, status: 'open', journalHead: nativeHash(nativeCanonical(opening)),
  };
  move(accounts, postings, tx.sender, escrow, deposit);
  move(accounts, postings, tx.sender, 'system:fees', BigInt(CHANNEL_FEE_ATOMS));
  accounts[tx.sender].nonce = tx.nonce;
  conserved(postings);
  return { accounts, postings, channel, result: { kind: 'native-channel-open', channelId, channel, opening,
    feeAtoms: CHANNEL_FEE_ATOMS, reservedAtoms: deposit.toString(), evidence: 'prefunded operator channel; calls settle in a later checkpoint' } };
}

export function channelMessageHash(message: any): string {
  exact(message, ['domain', 'chainId', 'channelId', 'sequence', 'inputHash']);
  if (message.domain !== 'cinder.channel-call.v1' || message.chainId !== NATIVE_CHAIN)
    throw new NativeError('wrong_network', 'Wrong native channel-call domain or network.');
  if (!isDigest(message.channelId) || !isDigest(message.inputHash) || !Number.isSafeInteger(message.sequence)
    || message.sequence < 1 || message.sequence > CHANNEL_MAX_CAPACITY)
    throw new NativeError('invalid_channel_call', 'Use a channel ID, input hash and bounded integer sequence.');
  return nativeHash(nativeCanonical(message));
}

/** Authentication only: callers may use this before returning an exact persisted replay after expiry or close. */
export function authenticateChannelCall(channel: NativeChannel, message: any, signature: string, input: string): string {
  checkChannel(channel);
  const messageHash = channelMessageHash(message);
  if (message.channelId !== channel.channelId) throw new NativeError('wrong_channel', 'Authorization names a different channel.');
  if (!nativeVerify(message, signature, channel.sessionPublicKey))
    throw new NativeError('invalid_signature', 'A channel call needs its authorized ML-DSA session signature.', 401);
  if (typeof input !== 'string' || input.length < 1 || input.length > 4000 || nativeHash(input) !== message.inputHash)
    throw new NativeError('input_mismatch', 'Input must match its signed hash and contain 1–4000 characters.');
  return messageHash;
}

/**
 * Calls consume reserved entitlement, not ledger balances. Persist the returned
 * channel and journal atomically; append no global checkpoint for this call.
 * Exact saved replays are authenticated and returned by the transport layer.
 */
export function applyChannelCall(snapshot: Record<string, NativeAccount>, channel: NativeChannel, message: any, signature: string, input: string, now: number) {
  const messageHash = authenticateChannelCall(channel, message, signature, input);
  if (channel.status !== 'open') throw new NativeError('channel_closed', 'This channel is closed.', 409);
  if (Date.parse(channel.expiresAt) <= now) throw new NativeError('channel_expired', 'This channel has expired; close it to settle and refund.', 410);
  if (message.sequence !== channel.sequence + 1) throw new NativeError('channel_sequence', 'This is not the next unused channel sequence.', 409);
  if (message.sequence > channel.capacity) throw new NativeError('channel_exhausted', 'All reserved channel calls have been used.', 402);
  if (snapshot[channel.escrow]?.balanceAtoms !== channel.depositAtoms)
    throw new NativeError('invalid_channel_escrow', 'The full published collateral is not present.', 503);
  const output = nativeHash(input);
  const journal = {
    domain: 'cinder.channel.journal.v1', chainId: NATIVE_CHAIN, channelId: channel.channelId,
    sequence: message.sequence, previousHash: channel.journalHead, messageHash,
    authorization: structuredClone(message), signature, inputHash: message.inputHash,
    output, outputHash: nativeHash(output), amountAtoms: CHANNEL_PRICE_ATOMS,
    recordedAt: new Date(now).toISOString(),
  };
  const journalHash = nativeHash(nativeCanonical(journal));
  const spent = BigInt(message.sequence) * BigInt(CHANNEL_PRICE_ATOMS);
  const next: NativeChannel = { ...structuredClone(channel), sequence: message.sequence,
    spentAtoms: spent.toString(), remainingAtoms: (BigInt(channel.depositAtoms) - spent).toString(), journalHead: journalHash };
  return { accounts: structuredClone(snapshot), postings: [] as Posting[], channel: next, journal,
    result: { kind: 'native-channel-call', channelId: channel.channelId, sequence: message.sequence, messageHash,
      output, outputHash: journal.outputHash, authorizedAtoms: CHANNEL_PRICE_ATOMS, settledAtoms: '0',
      feeAtoms: '0', spentAtoms: next.spentAtoms, remainingAtoms: next.remainingAtoms, journalHash,
      evidence: 'operator provisional acknowledgment of collateral-backed authorization; final accounting at channel close' } };
}

/** Owner-authorized close cannot cancel consumed calls and remains available after expiry. */
export function closeChannel(snapshot: Record<string, NativeAccount>, channel: NativeChannel, tx: any, now: number) {
  envelope(snapshot, tx, now); closeAction(tx.actions[0]); checkChannel(channel);
  if (tx.actions[0].channelId !== channel.channelId) throw new NativeError('wrong_channel', 'Wrong channel for this close.');
  if (channel.owner !== tx.sender) throw new NativeError('channel_owner_required', 'Only the channel owner may authorize this close.', 403);
  if (channel.status !== 'open') throw new NativeError('channel_closed', 'This channel was already closed.', 409);
  if (BigInt(CHANNEL_FEE_ATOMS) > atoms(tx.maxDebitAtoms, true))
    throw new NativeError('spending_cap', 'Channel closing fee exceeds its signed cap.', 402);
  if (snapshot[channel.escrow]?.balanceAtoms !== channel.depositAtoms)
    throw new NativeError('invalid_channel_escrow', 'Channel collateral does not match its opening deposit.', 503);
  const accounts = structuredClone(snapshot), postings: Posting[] = [];
  // Debit the explicit closing fee before refund, matching other native actions.
  move(accounts, postings, tx.sender, 'system:fees', BigInt(CHANNEL_FEE_ATOMS));
  move(accounts, postings, channel.escrow, 'system:provider', BigInt(channel.spentAtoms));
  move(accounts, postings, channel.escrow, channel.owner, BigInt(channel.remainingAtoms));
  accounts[tx.sender].nonce = tx.nonce;
  const next: NativeChannel = { ...structuredClone(channel), status: 'closed', closedAt: new Date(now).toISOString(), closeReason: 'owner' };
  conserved(postings);
  return { accounts, postings, channel: next, result: { kind: 'native-channel-close', channelId: channel.channelId,
    feeAtoms: CHANNEL_FEE_ATOMS, reason: 'owner', settledAtoms: channel.spentAtoms, refundedAtoms: channel.remainingAtoms,
    callCount: channel.sequence, journalHead: channel.journalHead, depositAtoms: channel.depositAtoms,
    evidence: 'operator checkpoint settlement of the committed authorization journal' } };
}

/** Deterministic system transaction; does not use an operator wall-clock nonce. */
export function channelExpiryTransaction(channel: NativeChannel) {
  checkChannel(channel);
  return { domain: 'cinder.channel-expiry.v1', chainId: NATIVE_CHAIN, channelId: channel.channelId,
    sequence: channel.sequence, journalHead: channel.journalHead, expiredAt: channel.expiresAt };
}

/** Permissionless maturity settlement removes reliance on the owner's availability or liquid fee balance. */
export function expireChannel(snapshot: Record<string, NativeAccount>, channel: NativeChannel, now: number) {
  checkChannel(channel);
  if (channel.status !== 'open') throw new NativeError('channel_closed', 'This channel was already closed.', 409);
  if (now < Date.parse(channel.expiresAt)) throw new NativeError('channel_not_expired', 'The channel has not reached its settlement deadline.', 409);
  if (snapshot[channel.escrow]?.balanceAtoms !== channel.depositAtoms)
    throw new NativeError('invalid_channel_escrow', 'Channel collateral does not match its opening deposit.', 503);
  const accounts = structuredClone(snapshot), postings: Posting[] = [];
  move(accounts, postings, channel.escrow, 'system:provider', BigInt(channel.spentAtoms));
  move(accounts, postings, channel.escrow, channel.owner, BigInt(channel.remainingAtoms));
  const next: NativeChannel = { ...structuredClone(channel), status: 'closed', closedAt: new Date(now).toISOString(), closeReason: 'expired' };
  conserved(postings);
  return { accounts, postings, channel: next, transaction: channelExpiryTransaction(channel),
    result: { kind: 'native-channel-close', reason: 'expired', channelId: channel.channelId, feeAtoms: '0',
      settledAtoms: channel.spentAtoms, refundedAtoms: channel.remainingAtoms, callCount: channel.sequence,
      journalHead: channel.journalHead, depositAtoms: channel.depositAtoms,
      evidence: 'operator checkpoint maturity settlement of the committed authorization journal' } };
}
