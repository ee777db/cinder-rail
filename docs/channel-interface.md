# Prefunded native compute channels

A channel reserves native CINDER for a bounded number of deterministic hash calls. Each call carries its own ML-DSA session authorization and consumes a portion of that collateral entitlement. **The native escrow balance stays intact until a closing checkpoint** pays the provider and returns the unused amount. This preserves public ledger replay: no balance moves are hidden between checkpoints.

The initial service is SHA-384 over an exact UTF-8 string of 1–4,000 UTF-16 code units. The caller can reproduce it; indeed the output equals the signed SHA-384 input commitment. This is a small, auditable compute/payment exercise, not a claim that a hash endpoint provides new information to a client that already hashed its input. LLM inference and other services are not supported by this channel implementation.

## Opening and bounded authority

The account owner signs the normal `cinder.transaction.v1` envelope with one action:

```json
{
  "type": "channel.open",
  "sessionPublicKey": "<canonical ML-DSA-65 public key>",
  "capacity": 100,
  "expiresAt": "<canonical ISO time within the next 24 hours>",
  "service": "hash"
}
```

Capacity is an integer from 1 to 10,000. The session public key must differ from the owner's account key. The opening transfers `capacity × 100` atoms into `system:channel:<channelId>` and charges a 12-atom network fee. The signed `maxDebitAtoms` must cover both. The owner must have the full gross balance; no negative or floating amounts are accepted. `channelId` is the SHA-384 transaction hash, and the accepted opening consumes one owner nonce.

The opening checkpoint commits to the service, 100-atom price, capacity, session public key, expiry, collateral amount and initial journal hash. A session key authorizes calls only for that channel and service. It cannot transfer the owner's wallet balance, change the price, unilaterally close the channel or exceed its capacity. It remains a valuable key because stealing it permits spending the reserved allowance.

The host also enforces a **100,000-call lifetime journal budget**. Let `A` be all accepted calls and `R` all remaining capacity in open channels. Opening capacity `C` requires `A + R + C <= 100000` and reserves those slots. Each newly accepted call atomically moves one slot from `R` to `A`; an exact replay changes neither. Owner close or expiry releases only unused slots, never accepted history. This storage budget is separate from native escrow, the maximum of 32 open channels, and daily request quotas. `/api/native/info.limits` exposes accepted, reserved and available lifetime calls.

## Calling the service

Each call signs this exact message under the channel's session key:

```json
{
  "domain": "cinder.channel-call.v1",
  "chainId": "cinder-devnet-1",
  "channelId": "<96 lowercase hex characters>",
  "sequence": 1,
  "inputHash": "<SHA-384 of the exact UTF-8 input>"
}
```

Send the raw input separately. New calls require the next sequence, an open unexpired channel, a matching input hash, a valid session signature, available capacity and the full recorded escrow collateral. A successful transition advances `sequence`, `spentAtoms`, `remainingAtoms` and `journalHead`. It returns the deterministic output and a journal record. It charges **zero additional network fee per call** and makes **zero native-account postings**.

Each journal record includes its authorization and signature, message hash, sequence, previous journal hash, input commitment, output, output hash, 100-atom amount and record time. Its hash becomes the next journal head. Persist the journal row and updated channel atomically before responding; do not release an output as an accepted paid call if that commit failed. The raw input is not part of the persisted journal. A hash is a commitment, not encryption, and short or guessable input can be recovered by guessing.

The acknowledgment is **provisional authorization backed by collateral**. It is not yet provider settlement, a global checkpoint, proof of decentralized consensus or a guarantee of zero latency. The call result deliberately reports `settledAtoms: "0"`. Calls still require signature verification, computation, transport and storage.

## Retries and crash recovery

Use storage keys scoped by channel and sequence. On a retry, first call `authenticateChannelCall` to verify the signature, network, channel and exact input. Compare its returned message hash with the saved journal's `messageHash`. Return that original record only on an exact match. A different valid authorization using the same sequence is a conflict and must not run or charge again.

Authentication deliberately permits replay of a previously saved call after channel expiry or closure. Applying a **new** call does not: `applyChannelCall` enforces status, deadline and the next sequence. The pure function never attempts to reconstruct a lost dedup store or silently accept an old sequence.

Channel and journal must share the same durable commit. Losing the HTTP response after a successful commit is recoverable by exact retry. A write failure must leave both rows unchanged. Store records individually rather than one ever-growing value. Public journals contain signed authorizations, output commitments and deterministic hash outputs; they contain no session private key.

The SDK retains an uncertain `openChannel()` envelope and generated session key in the same client instance. Retrying the same owner, capacity and lifetime reuses them instead of funding another channel; concurrent identical opening calls share the in-flight operation. An error exposes `pendingTransactionHash`, not the session secret. This is in-memory recovery, not durable key backup. If the process exits before the key is safely saved, the owner can still close or await expiry, but the lost session key cannot be reconstructed from the public opening.

Before trusting a call, the SDK verifies and caches the signed opening receipt and the owner's public-key/address binding and signature. A fresh client recovers that opening through `/transactions/:channelId`. It checks every returned journal field, the fixed price, service, immutable channel terms, input/output commitments, zero call fee, zero settled amount and exact consumed/remaining arithmetic. A terminal-looking response does not bypass these checks.

Sequence one must link to the opening's genesis journal. Later calls are linked to an explicitly supplied predecessor or a predecessor already accepted by that client. Keep passing `previousHash` across calls and persist it across restarts; without either source, validating one later record does not authenticate the missing earlier history. The SDK remembers accepted hashes to detect altered same-client replays. Full replay of the journal and its closing checkpoint is still needed to verify final accounting. `channel()` validates terms and arithmetic but does not prove it received the newest state.

## Closing and maturity settlement

The owner can sign `{type:"channel.close",channelId}` in a fresh normal envelope before or after channel expiry. `closeChannel` charges 12 atoms from the owner's liquid balance, consumes one owner nonce, transfers consumed collateral to `system:provider`, and refunds unused collateral to the owner. The signed close cap must cover that explicit fee. Consumed calls cannot be canceled by closing.

At expiry, `expireChannel` permits system-triggered settlement with no owner signature, no closing fee and no account nonce changes. It performs the same consumed/refund allocation and records `closeReason: "expired"`. Thus an absent owner or one with no liquid fee balance cannot indefinitely block provider redemption. The deterministic system transaction is:

```ts
{ domain: 'cinder.channel-expiry.v1', chainId, channelId,
  sequence, journalHead, expiredAt: channel.expiresAt }
```

The closing checkpoint binds the journal head and count, total deposit, consumed amount, refund and conserved postings. Each call signature and hash link must be checked when replaying that journal; a head hash alone is not an independent validator's approval. Closed channels cannot settle again. Record closure, final account balances and checkpoint together.

The host must arm recovery before committing an opening reservation, retain enough ledger capacity to close every open channel, and recover mature channels through alarms and authenticated reads/retries. An alarm can run late; acceptance of a new call checks the actual expiry directly. Manual close, a final call and expiry settlement must serialize over the same channel state. The host's availability remains a dependency of this single-operator devnet.

The current ledger stops new ordinary work at height 9,900 and all checkpoints at 10,000, reserving the final 100 entries for completion and recovery. Owner-authorized channel closure is an explicit exception to the ordinary cutoff; both it and expiry settlement can use the reserved headroom. Lifetime journal counters, pending-channel records, closure and native settlement update together. Journal reads share the history-export allowance of 20,000 requests per IP and 100,000 globally per day, separate from ordinary read quotas.

## Cost and public interfaces

For `n > 0` accepted calls, the resource charge is `100n` atoms. Owner close adds 24 total network-fee atoms across open and close, so average cost is `100 + 24/n` atoms per call. Automatic expiry adds only the 12-atom opening fee, averaging `100 + 12/n`. For 100 calls followed by owner close, the total is 10,024 atoms and the average is 100.24 atoms. Unused principal is refunded. These are native-unit arithmetic examples, not dollar prices or a stable-value promise.

Exports from `src/native-channel.ts`:

```ts
channelAccounts(transaction, channel?) // owner/fee/provider/escrow rows
channelCallAccounts(channel)           // escrow row; calls do not modify it
openChannel(snapshot, transaction, now)
applyChannelCall(snapshot, channel, message, signature, input, now)
closeChannel(snapshot, channel, transaction, now)
expireChannel(snapshot, channel, now)
channelExpiryTransaction(channel)
channelMessageHash(message)
authenticateChannelCall(channel, message, signature, input) // returns messageHash
```

Transitions return `{accounts,postings,result,channel}`. Calls additionally return `journal`; expiry additionally returns its deterministic `transaction`. Opening and owner close require signature verification by the caller; call signatures are verified inside this module. Public channel state includes its session public key, owner, price, capacity, consumption, status, expiry and journal head, never a private key.

The unit and host regression suites cover conserved supply, bounded authority, input binding, sequence conflicts, cross-network rejection, separate keys, expiry, exact replay authentication, refund allocation, atomic write failure, alarm recovery and lifetime reservation accounting. SDK tests additionally alter unsigned response metadata, simulate lost opening responses and recover exact calls after expiry. These checks are evidence for the exercised cases, not an independent audit or coverage of every platform fault.

## Measured deployment evidence

The [public channel run](https://cinder-rail.ee777db.workers.dev/examples/native-channel-public.json) recorded 100 calls on the deployed Worker at `2026-10-06T02:23:58.650Z`, with client signing and verification included: median 353.3 ms, p95 519.7 ms, 38,819 ms total, and two opening/closing checkpoints costing 24 network-fee atoms. The [local run](https://cinder-rail.ee777db.workers.dev/examples/native-channel-local.json) recorded 10,000 calls with median 14.87 ms and p95 30.19 ms. These are different workloads and environments; neither report establishes public-network consensus finality, a production throughput ceiling, dollar cost or a latency guarantee.

The [network snapshot](https://cinder-rail.ee777db.workers.dev/examples/native-network.json) records the operator identity and signed genesis used by the public deployment. Pin a previously trusted identity rather than treating a fresh response from that same endpoint as independent authentication.

A later [four-channel public run](https://cinder-rail.ee777db.workers.dev/examples/native-throughput-public.json) accepted and settled 1,000 calls at 1.954832 verified calls/second during a 511.553-second call window. Median was 1,506.197 ms and p95 3,913.196 ms; setup and cleanup added 10.282 seconds. All four channels closed, charging 96 total network-fee atoms plus 100,000 resource atoms. One exact retry did not double-charge. The client used an HTTPS proxy; this result is below 10,000 calls/hour and does not establish its cause or a universal ceiling.
