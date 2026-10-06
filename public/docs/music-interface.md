# Native music: publication, paid access and creator splits

This module implements native CINDER accounting for music publication and paid audio access. It records what a signing account authorized, allocates every atom, and preserves publication and payment history. It does not establish copyright ownership, prove that a human listened, or turn paid events into verified audience counts.

## Signed actions

Use the existing `cinder.transaction.v1` envelope on `cinder-devnet-1`, with exactly one action, the next sender nonce, a canonical ISO authorization deadline within five minutes, and a canonical integer-string `maxDebitAtoms`.

| Action | Exact signed fields beyond `type` | Effect |
| --- | --- | --- |
| `music.publish` | `audioHash`, `title`, `artist`, `mime`, `bytes`, `recipients`, `priceAtoms`, `rightsDeclared` | Publish immutable metadata after the server verifies the uploaded audio. |
| `music.listen` | `trackId`, `listenId` | Pay the immutable price, allocate creator shares, record paid access. |
| `music.unpublish` | `trackId` | Owner stops new paid access; metadata and receipts remain. |

Every accepted action charges **12 atoms** and consumes exactly one sender nonce. Publication and unpublication require a cap of at least 12. Listening requires a cap of at least `priceAtoms + 12`, including when the payer is a royalty recipient. The payer must hold that full gross amount before the operation. Failed transitions change neither input state nor balances.

`audioHash` is lowercase SHA-384 of the **raw audio bytes**, not a base64 or text encoding. Allowed MIME values are `audio/mpeg`, `audio/wav`, and `audio/ogg`; length is 1–4,194,304 bytes. MIME metadata alone does not prove a decodable or safe file. Titles allow 1–120 UTF-16 code units and artist labels 1–80, with no surrounding whitespace or control characters. Display them through text rendering, never HTML interpolation.

`rightsDeclared` must be the literal boolean `true`. This is the publisher's distribution-rights statement, not an identity or rights verification. Recipients must be 1–8 distinct registered native accounts, with positive integer `bps` summing to 10,000. The price is a positive canonical atom string no larger than native supply minus 12 atoms. There is no fiat-price guarantee.

The track ID commits to domain `cinder.music.track.v1`, chain, owner, publication nonce and all immutable publication fields. Recipient addresses are sorted before hashing. Publication time and availability status are outside this metadata commitment. Changing a price or split requires a new publication. Limits are **200 lifetime publications in the devnet and 10 per publishing account**. Unpublication does not release a slot.

## Exact payment and duplicate handling

For total price `P` and recipient weights `wᵢ`, the base share is `floor(P × wᵢ / 10000)`. Remaining atoms go to the largest fractional remainders, with ascending address as the deterministic tie breaker. Thus `Σ shareᵢ = P` without fractional balances. A 101-atom price with 70/20/10 percent splits yields 71, 20 and 10 atoms. The network fee is additional and goes to `system:fees`.

The client generates `listenId` as 16 random bytes encoded into 32 lowercase hexadecimal characters. `musicListenKey(sender, listenId)` commits to the sender and ID under a separate domain; it deliberately excludes the track. Persist that key permanently for the retained devnet history. Reusing the same sender and ID rejects with `music_access_used`, even with a new nonce or a different track. A new ID represents another deliberate purchase, not a verified new listener.

An exact retry of a previously accepted signed transaction belongs to the enclosing ledger's authenticated idempotency path: return its existing receipt and existing access outcome without a second transition. Do not generate another charge to recover from a lost HTTP response.

## Integration contract

Exports from `src/native-music.ts`:

```ts
musicAccounts(action, sender, state?) // returns account keys required for transition
applyMusic(snapshot, state | undefined, transaction, now)
// -> { accounts, postings, result, state }
musicListenKey(sender, listenId)
musicTrack(state, trackId)
musicCatalog(state)
```

`musicAccounts` needs its optional third argument for listening: the signed action contains a track ID, so immutable recipients must be resolved from the loaded track. It rejects a listen when that track is absent. The pure transition repeats envelope, nonce and cap checks; ML-DSA verification remains the caller's responsibility.

State is `{version:1,totalTracks,ownerCounts,tracks,listens}`. It is a **partial row view**, not a replacement for the entire catalog. Publication loads the authoritative total and sender's lifetime count. Listening loads its track and the persisted sender/ID dedup row. Unpublication loads its track. Write changed track and listen rows separately under `music:track:` and `music:listen:`; never overwrite unrelated rows with a partial map. Atomically commit updated accounts, counters, metadata, dedup entry and signed ledger receipt. The catalog helper sorts and returns active loaded rows only; storage owns the paginated cursor and must not claim that one page is the full catalog.

The upload and delivery layer must complete these steps before calling publication accepted:

1. Authenticate uploads, bind the uploader, enforce byte and media limits, and assemble the complete file.
2. Hash raw bytes and match owner, hash, MIME and length to the signed publication.
3. Confirm media availability before accepting a paid listen.
4. Commit the paid access and an unguessable short-lived bearer capability together; release playback only after a successful commit.
5. Verify the ledger receipt in the client before playback. Keep bearer capabilities out of public receipts, catalog rows and logs.

The public `result.access` contains its dedup key, sender, listen ID, track ID, audio hash, price, transaction hash and creation time. It contains no playback secret. The audio endpoint must require the separate capability; knowing the public hash or transaction ID must not grant unpaid access. A capability can be shared or an authorized recipient can copy audio; this is access control, not DRM or proof of listening. The delivery layer defines capability lifetime and treatment of already-paid access after unpublication.

The pure tests establish accounting and authorization behavior. They do not demonstrate upload availability, browser decoding, capability secrecy or successful deployment. Those are integration checks for the running application.
