import { nativeCanonical, nativeHash } from './native-crypto.ts';
import {
  NATIVE_ADDRESS, NATIVE_CHAIN, NATIVE_DIGEST, NATIVE_SUPPLY, NativeError,
  allocateSplit, atoms, exact, txHash, validateTransaction,
  type NativeAccount, type Posting,
} from './native-core.ts';

export const MUSIC_FEE_ATOMS = '12';
export const MUSIC_MAX_TRACKS = 200;
export const MUSIC_MAX_OWNER_TRACKS = 10;
export const MUSIC_MAX_BYTES = 4 * 1024 * 1024;
export const MUSIC_MAX_PRICE_ATOMS = (BigInt(NATIVE_SUPPLY) - BigInt(MUSIC_FEE_ATOMS)).toString();
export const MUSIC_MIME_TYPES = ['audio/mpeg', 'audio/wav', 'audio/ogg'] as const;
export interface MusicRecipient { address: string; bps: number; }
export interface MusicTrack {
  trackId: string; owner: string; publishNonce: number; audioHash: string;
  title: string; artist: string; mime: string; bytes: number;
  recipients: MusicRecipient[]; priceAtoms: string; rightsDeclared: true;
  publishedAt: string; active: boolean; unpublishedAt?: string;
}
export interface MusicAccess {
  dedupKey: string; sender: string; listenId: string; trackId: string;
  audioHash: string; paidAtoms: string; transactionHash: string; createdAt: string;
}
/** Partial rows are deliberate: persist tracks and dedup entries as separate keys. */
export interface MusicState {
  version: 1; totalTracks: number; ownerCounts: Record<string, number>;
  tracks: Record<string, MusicTrack>; listens: Record<string, MusicAccess>;
}

function address(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_ADDRESS.test(value);
}
function digest(value: unknown): value is string {
  return typeof value === 'string' && NATIVE_DIGEST.test(value);
}
function label(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= limit
    && value.trim() === value && !/[\u0000-\u001f\u007f-\u009f]/.test(value);
}
function validateAction(action: any) {
  if (!action || typeof action !== 'object' || Array.isArray(action))
    throw new NativeError('invalid_music_action', 'Use a supported music action.');
  if (action.type === 'music.publish') {
    exact(action, ['type', 'audioHash', 'title', 'artist', 'mime', 'bytes', 'recipients', 'priceAtoms', 'rightsDeclared']);
    if (action.rightsDeclared !== true)
      throw new NativeError('rights_required', 'The publisher must explicitly declare the right to distribute this audio.');
    if (!digest(action.audioHash) || !label(action.title, 120) || !label(action.artist, 80)
      || !MUSIC_MIME_TYPES.includes(action.mime) || !Number.isSafeInteger(action.bytes)
      || action.bytes < 1 || action.bytes > MUSIC_MAX_BYTES)
      throw new NativeError('invalid_music_metadata', 'Use a SHA-384 audio hash, bounded text, an allowed audio type and 1–4194304 bytes.');
    if (atoms(action.priceAtoms) > BigInt(MUSIC_MAX_PRICE_ATOMS))
      throw new NativeError('invalid_music_price', 'The price must leave room for the network fee within the native supply.');
    allocateSplit(0n, action.recipients);
  } else if (action.type === 'music.listen') {
    exact(action, ['type', 'trackId', 'listenId']);
    if (!digest(action.trackId) || typeof action.listenId !== 'string' || !/^[a-f0-9]{32}$/.test(action.listenId))
      throw new NativeError('invalid_music_access', 'Use a track ID and a fresh 16-byte random listen ID encoded as lowercase hex.');
  } else if (action.type === 'music.unpublish') {
    exact(action, ['type', 'trackId']);
    if (!digest(action.trackId)) throw new NativeError('invalid_music_track', 'Use a valid music track ID.');
  } else throw new NativeError('invalid_music_action', 'Unknown music action.');
  nativeCanonical(action);
}

export function musicListenKey(sender: string, listenId: string): string {
  if (!address(sender) || typeof listenId !== 'string' || !/^[a-f0-9]{32}$/.test(listenId))
    throw new NativeError('invalid_music_access', 'Invalid paid access identifier.');
  return nativeHash(nativeCanonical({ domain: 'cinder.music.listen-key.v1', chainId: NATIVE_CHAIN, sender, listenId }));
}

export function musicTrack(state: MusicState | undefined, trackId: string): MusicTrack | undefined {
  if (!digest(trackId)) throw new NativeError('invalid_music_track', 'Use a valid music track ID.');
  const track = state?.tracks[trackId];
  return track ? structuredClone(track) : undefined;
}

/** Catalog of loaded rows only. The persistence layer owns pagination and completeness. */
export function musicCatalog(state: MusicState | undefined): MusicTrack[] {
  return Object.values(state?.tracks || {}).filter(track => track.active)
    .sort((a, b) => a.publishedAt === b.publishedAt ? a.trackId.localeCompare(b.trackId) : b.publishedAt.localeCompare(a.publishedAt))
    .map(track => structuredClone(track));
}

/** Listen requires the loaded track state to resolve its immutable split recipients. */
export function musicAccounts(action: any, sender: string, state?: MusicState): string[] {
  if (!address(sender)) throw new NativeError('invalid_sender', 'Invalid music sender.');
  validateAction(action);
  const result = new Set([sender, 'system:fees']);
  if (action.type === 'music.publish') for (const recipient of action.recipients) result.add(recipient.address);
  if (action.type === 'music.listen') {
    const track = state?.tracks[action.trackId];
    if (!track) throw new NativeError('music_missing', 'This music track is not published.', 404);
    for (const recipient of track.recipients) result.add(recipient.address);
  }
  return [...result];
}

/**
 * Pure atomic transition; callers authenticate the signature, verify uploaded
 * bytes before publication, and atomically persist these rows with the receipt.
 * Every accepted music action costs 12 atoms and consumes one sender nonce.
 */
export function applyMusic(snapshot: Record<string, NativeAccount>, state: MusicState | undefined, tx: any, now: number) {
  validateTransaction(tx, now);
  if (tx.actions.length !== 1) throw new NativeError('music_batch', 'Each music transaction must contain exactly one action.');
  const action = tx.actions[0];
  validateAction(action);
  const next: MusicState = structuredClone(state || { version: 1, totalTracks: 0, ownerCounts: {}, tracks: {}, listens: {} });
  if (next.version !== 1 || !Number.isSafeInteger(next.totalTracks) || next.totalTracks < 0 || next.totalTracks > MUSIC_MAX_TRACKS)
    throw new NativeError('invalid_music_state', 'Music catalog counters are invalid.', 503);
  const accounts = structuredClone(snapshot);
  const sender = accounts[tx.sender];
  if (!sender?.publicKey) throw new NativeError('unknown_sender', 'Register this native account first.', 404);
  if (tx.nonce !== sender.nonce + 1) throw new NativeError('wrong_nonce', 'The signed nonce is not the next account nonce.', 409);
  for (const required of musicAccounts(action, tx.sender, next)) {
    if (!accounts[required] || (required !== 'system:fees' && !accounts[required].publicKey))
      throw new NativeError('unknown_recipient', 'All music recipients must be registered first.', 404);
  }
  const fee = BigInt(MUSIC_FEE_ATOMS);
  const track = action.trackId ? next.tracks[action.trackId] : undefined;
  let gross = fee;
  if (action.type === 'music.listen') gross += atoms(track!.priceAtoms);
  if (gross > atoms(tx.maxDebitAtoms, true)) throw new NativeError('spending_cap', 'Music payment exceeds its signed maximum debit.', 402);
  if (BigInt(sender.balanceAtoms) < gross) throw new NativeError('insufficient_balance', 'Insufficient balance for the full music payment and fee.', 402);
  const postings: Posting[] = [];
  const move = (to: string, amount: bigint) => {
    if (amount === 0n) return;
    const recipient = accounts[to];
    sender.balanceAtoms = (BigInt(sender.balanceAtoms) - amount).toString();
    recipient.balanceAtoms = (BigInt(recipient.balanceAtoms) + amount).toString();
    postings.push({ account: tx.sender, deltaAtoms: (-amount).toString() }, { account: to, deltaAtoms: amount.toString() });
  };
  const timestamp = new Date(now).toISOString();
  let result: any;
  if (action.type === 'music.publish') {
    const owned = next.ownerCounts[tx.sender] || 0;
    if (!Number.isSafeInteger(owned) || owned < 0) throw new NativeError('invalid_music_state', 'Publisher counter is invalid.', 503);
    if (next.totalTracks >= MUSIC_MAX_TRACKS || owned >= MUSIC_MAX_OWNER_TRACKS)
      throw new NativeError('music_capacity', 'The development catalog allows 200 lifetime tracks and 10 per publisher.', 429);
    const metadata = {
      domain: 'cinder.music.track.v1', chainId: NATIVE_CHAIN, owner: tx.sender, publishNonce: tx.nonce,
      audioHash: action.audioHash, title: action.title, artist: action.artist, mime: action.mime, bytes: action.bytes,
      recipients: [...action.recipients].sort((a, b) => a.address < b.address ? -1 : 1),
      priceAtoms: action.priceAtoms, rightsDeclared: true as const,
    };
    const trackId = nativeHash(nativeCanonical(metadata));
    if (next.tracks[trackId]) throw new NativeError('music_exists', 'This immutable track already exists.', 409);
    const { domain: _domain, chainId: _chainId, ...publicMetadata } = metadata;
    const published: MusicTrack = { trackId, ...publicMetadata, publishedAt: timestamp, active: true };
    next.tracks[trackId] = published;
    next.totalTracks++;
    next.ownerCounts[tx.sender] = owned + 1;
    result = { trackId, track: published, events: [{ type: 'music-published', trackId, rightsEvidence: 'publisher self-declaration; not verified ownership' }] };
  } else if (action.type === 'music.listen') {
    const dedupKey = musicListenKey(tx.sender, action.listenId);
    if (next.listens[dedupKey]) throw new NativeError('music_access_used', 'This sender has already paid with this listen ID.', 409);
    if (!track!.active) throw new NativeError('music_unpublished', 'This track is no longer available for new paid access.', 410);
    const parts = allocateSplit(atoms(track!.priceAtoms), track!.recipients);
    const access: MusicAccess = {
      dedupKey, sender: tx.sender, listenId: action.listenId, trackId: action.trackId,
      audioHash: track!.audioHash, paidAtoms: track!.priceAtoms, transactionHash: txHash(tx), createdAt: timestamp,
    };
    next.listens[dedupKey] = access;
    for (const part of parts) move(part.address, BigInt(part.amountAtoms));
    result = { trackId: action.trackId, access, events: [{ type: 'music-paid-access', ...access, recipients: parts,
      evidence: 'payer-authorized audio access; not proof of human listening, unique audience or copyright ownership' }] };
  } else {
    if (!track) throw new NativeError('music_missing', 'Music track not found.', 404);
    if (track.owner !== tx.sender) throw new NativeError('music_owner_required', 'Only the publishing account may unpublish this track.', 403);
    if (!track.active) throw new NativeError('music_unpublished', 'This track was already unpublished.', 409);
    next.tracks[action.trackId] = { ...track, active: false, unpublishedAt: timestamp };
    result = { trackId: action.trackId, track: next.tracks[action.trackId], events: [{ type: 'music-unpublished', trackId: action.trackId }] };
  }
  move('system:fees', fee);
  sender.nonce = tx.nonce;
  if (postings.reduce((sum, posting) => sum + BigInt(posting.deltaAtoms), 0n) !== 0n)
    throw new Error('Music posting conservation invariant failed');
  return { accounts, postings, result: { kind: 'native-music', action: action.type, feeAtoms: MUSIC_FEE_ATOMS, ...result }, state: next };
}
