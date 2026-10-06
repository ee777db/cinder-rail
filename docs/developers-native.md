# Native developer guide

Version 0.2 · 5 October 2026

The native API operates `cinder-devnet-1`. CINDER is its own asset, identified by `cinder-devnet-1/native`, with six decimals. One CINDER is 1,000,000 integer atoms. All monetary quantities in JSON are canonical decimal strings: `"100"`, not `100`, `"0100"` or `"1e2"`. No endpoint accepts another chain's assets.

The operator orders requests and signs checkpoints with ML-DSA-65. Native signatures authenticate actions and checkpoints; they do not create independent consensus, prove LLM correctness or authenticate a real-world person. Consult [the completion report](completion-gate.md) for deployment evidence.

## Start an agent

Build the bundled SDK with `node scripts/build-native.mjs`. Save the following as `agent-example.mjs` in the repository root and run `CINDER_URL=http://127.0.0.1:8787 node agent-example.mjs` while the local server is running. Setting `CINDER_URL` to a native deployment uses that actual test network instead.

```js
import { CinderNativeClient } from './public/native-sdk.js';

const client = new CinderNativeClient(
  process.env.CINDER_URL || 'http://127.0.0.1:8787',
  process.env.CINDER_OPERATOR_KEY || undefined,
);
const network = await client.connect();
const payer = await client.createWallet();
const recipient = await client.createWallet();
await client.claimFaucet(payer);

// Send 0.001 CINDER; the signed gross ceiling includes the 12-atom fee.
const transfer = await client.transfer(payer, recipient.address, '1000', '1012');
console.log({ network: network.chainId, transaction: transfer.txHash });

// One SHA-384 job costs 100 resource atoms plus 12 fee atoms.
const reserved = await client.compute(payer, 'hash', 'A bounded agent job.', '112');
for (let attempt = 0; attempt < 120; attempt++) {
  const job = await client.job(reserved.txHash);
  if (job.status !== 'pending') {
    console.log({ status: job.status, output: job.output, refundAtoms: job.refundAtoms });
    break;
  }
  await new Promise(resolve => setTimeout(resolve, 1000));
}
```

Do not print, commit or upload `payer` or `recipient`: these objects contain private keys. The example holds ephemeral keys in process memory. Applications need a deliberate secret-storage and recovery policy. The web wallet supplies a local encrypted-backup flow; the SDK does not silently save keys to disk.

Passing a previously trusted `CINDER_OPERATOR_KEY` makes `connect()` reject a changed operator key. Omitting it uses the first observed key, which is trust on first use. Learning the key from the same untrusted response whose signature you verify is not independent authentication.

## Authorization, fees and retries

The signed transaction shape is:

```js
{
  domain: 'cinder.transaction.v1',
  chainId: 'cinder-devnet-1',
  sender: 'cin1' + '<96 lowercase hex characters>',
  nonce: 1,
  validUntil: '<canonical ISO timestamp within five minutes>',
  maxDebitAtoms: '1012',
  actions: [{ type: 'transfer', to: '<registered address>', amountAtoms: '1000' }],
}
```

Each accepted ordinary transaction consumes exactly the next account nonce. A standard batch fee is `10 + 2 × actionCount` atoms, with at most 16 core actions. Music, economy and channel transitions each require one action and charge 12 atoms; faucet issuance is the exception with zero fee. `maxDebitAtoms` bounds **gross CINDER debits**, including fees, regardless of refunds or amounts the same action might credit back. Resource quantities, recipients, slippage limits and service commitments are also signed.

For safe delivery, separate authorization from submission and retain the envelope while the result is uncertain:

```js
const envelope = await client.authorize(payer, [
  { type: 'transfer', to: recipient.address, amountAtoms: '1000' },
], '1012');
const result = await client.submit(envelope);
// If delivery fails ambiguously, retry this exact envelope.
// Do not create a new nonce until the original outcome is resolved.
```

Submission is `POST /api/native/submit` with `{transaction,signature,computeInput?}`. An exact successful replay returns the original receipt without a second debit, after authenticating the original signature again. A modified payload or conflicting nonce is not an idempotent retry. Serialize mutations from a given wallet: two independently authorized concurrent transactions can choose the same nonce.

`submit()` verifies the expected transaction and submitted authorization, transaction hash, operator checkpoint signature, committed transaction/postings/result hashes, zero-sum native postings and the maximum gross debit. A separate credit back to the sender does not hide an excessive gross debit. This is receipt verification, not complete ledger replay. A receipt could still be semantically invalid within those checks; the auditor re-executes the full history to detect that.

`job()` additionally retrieves the original compute reservation, verifies the payer public key derives the recorded address and authenticates the original signature, then recomputes that reservation. Completed or failed jobs must carry a valid settlement receipt with the expected domain, network, request, service, model, output commitment, refund and destination postings. Unknown states/domains, missing receipts and mismatching unsigned response fields are rejected. A deterministic hash completion must equal the original authorized input hash. These checks do not prove the correctness of model execution.

Convenience calls such as `compute()` create an authorization internally. If an application must survive uncertain delivery or process restart, use `authorize()` and `submit()` explicitly, save the exact envelope and input under the application's retention policy, and keep the resulting transaction hash. Do not log private keys or playback credentials with an error object.

## High-frequency channels

Opening a channel reserves `capacity × 100` atoms for hash calls; capacity is 1–10,000 and expiry at most 24 hours away. The session signing key differs from the wallet key. It can spend only that channel's allowance, with increasing sequence numbers. It cannot transfer the rest of the wallet.

The network also reserves lifetime journal slots when opening: accepted calls plus all unused open-channel capacity cannot exceed 100,000. A new call moves one reserved slot to accepted history, an exact retry consumes none, and closure releases unused slots. Inspect `/info.limits.channelAvailableCalls` before planning a batch; the query does not itself reserve capacity. At most 32 channels may remain open.

```js
const opened = await client.openChannel(payer, 100, 60 * 60 * 1000);
const { channel, sessionKey } = opened;
let previousHash = channel.journalHead;

for (let sequence = 1; sequence <= 100; sequence++) {
  const envelope = client.authorizeChannelCall(
    sessionKey, channel.channelId, sequence, `request ${sequence}`,
  );
  const call = await client.submitChannelCall(
    envelope, sessionKey.publicKey, previousHash,
  );
  previousHash = call.result.journalHash;
}
const closed = await client.closeChannel(payer, channel.channelId);
console.log({ settlement: closed.txHash });
```

Protect the session key as a spending capability. Save the last accepted sequence, journal hash and any uncertain signed envelope. Exact call retries authenticate the original signature and input; they do not increment consumption. Same-sequence substitution is rejected. Accepted call state and journal rows persist atomically.

`openChannel()` retains an uncertain signed opening and its generated session key in the **same client instance**. Retry the same owner, capacity and lifetime to resume it; do not create another client merely because the response was lost. Identical concurrent openings share one in-flight operation. Opening errors expose `pendingTransactionHash` without a private key. The cache is not durable: if the process exits before the session key is saved, that key cannot be recovered from the public chain. The account owner can still close the channel or await expiry.

The SDK validates and caches terms from the signed opening receipt, including the owner's key/address binding and original authorization. Fresh clients fetch that receipt using the channel ID. Every call response is checked for exact authorization, journal domain, valid original recording time, service, price, input/output, fixed zero call fee, zero settled amount and all immutable channel fields and balance arithmetic. An exact saved response remains recoverable after expiry or close; its original recording time must fall within the channel lifetime.

Keep supplying `previousHash` as the example does. Sequence one is checked against the opening journal head; later calls check a supplied or cached predecessor. A fresh client with neither cannot establish the missing history from one later record. `channelJournal()` verifies returned records and continuity within the available page; reconstruct the full chain from genesis for complete verification. `channel()` checks terms and arithmetic but does not prove the state is the newest one served by the operator.

Each call consumes a 100-atom entitlement but has no additional network fee and no global native postings. The full deposit remains in escrow until a closing checkpoint pays consumed calls and refunds unused principal. The owner pays a 12-atom close fee; automatic expiry settles without that fee. Host availability still determines when an expired channel is processed. A provisional call acknowledgment is not decentralized finality.

Only the deterministic SHA-384 service uses this path today. Because the caller already hashes the input for authorization, this operation is a transparent transport/accounting test, not a claim to useful outsourced AI work. The [channel interface](channel-interface.md) specifies journals, deadlines, recovery and exact costs.

## Publish music and pay recipients

Audio upload supports MPEG, WAV and Ogg up to 4 MiB. The SDK signs 24 KiB chunks and verifies final upload completion. Audio bytes reside in the operator's durable storage; the public ledger commits their SHA-384 hash and publication metadata. Upload only material you have the right to distribute. `rightsDeclared:true` is a publisher assertion, not an ownership adjudication.

The following continues the agent example, using an existing local `my-original.wav`. The funded payer publishes; the registered recipient also receives royalties.

```js
import { readFile } from 'node:fs/promises';

const audio = new Uint8Array(await readFile('./my-original.wav'));
const uploaded = await client.uploadAudio(payer, audio, 'audio/wav');
const published = await client.transact(payer, {
  type: 'music.publish',
  audioHash: uploaded.audioHash,
  mime: uploaded.mime,
  bytes: uploaded.bytes,
  title: 'My original recording',
  artist: 'Independent artist',
  recipients: [
    { address: payer.address, bps: 7000 },
    { address: recipient.address, bps: 3000 },
  ],
  priceAtoms: '101',
  rightsDeclared: true,
}, '12');

// The earlier transfer funded this listener. Total debit is 101 + 12 atoms.
const paid = await client.listen(recipient, published.receipt.result.trackId, '113');
const playbackUrl = client.playbackUrl(uploaded.audioHash, paid.playbackToken);
const response = await fetch(playbackUrl);
if (!response.ok) throw new Error('Playback unavailable');
const receivedAudio = new Uint8Array(await response.arrayBuffer());
console.log({ paidTransaction: paid.txHash, receivedBytes: receivedAudio.length });
```

Recipient weights must total 10,000 basis points. Largest-remainder allocation conserves every atom; 101 atoms at 70/30 allocate 71 and 30. Payment buys a one-hour access window, not a certified human play. Repeated play requests with the same payer and `listenId` cannot debit again under a new transaction.

If `listen()` loses a response, calling it again on the same client with the same payer/track and compatible terms retries the retained authorization. If payment already succeeded, it only repeats the separate access request. An error includes `pendingTransactionHash`, `listenId`, `authorization` and an existing `paid` receipt when known. Save those recovery records deliberately; after restoring a client, submit that original authorization if payment is uncertain, then call `client.musicAccess(payerKey, pendingTransactionHash)`. A public transaction hash does not itself grant private access. Generating another `listenId` after losing the original state authorizes another purchase, so it is not a recovery procedure.

`listen()` first pays and verifies the public receipt, then signs a **separate private** `/music/access` request. Public payment receipts, transaction replays and journal exports never contain the playback token. The private proof binds the owner, paid transaction, fresh nonce and deadline; the server verifies that the owner paid. The server does not maintain a consumed-nonce table for these short-lived proofs, so one may retrieve the same token again during its validity window. Keep the proof private. Recovering the token does not extend the original one-hour window.

The playback URL contains a bearer token: do not log, publish or include it in analytics. Anyone possessing it can fetch that audio until expiry. Media supports HTTP byte ranges and sends private/no-store caching headers. Paying for access does not impose DRM on downloaded bytes. `music.unpublish` stops new purchases; it does not erase public history or immediately revoke already-paid access.

## WORK and the native spot market

WORK is a self-issued native resource entitlement, not an ERC-20, stablecoin or dollar promise. One WORK consumes one 1–4,000-character SHA-384 operation. The current posted offer is 100 CINDER atoms per WORK while inventory remains.

```js
import { nativeHash } from './public/native-sdk.js';

await client.transact(payer, {
  type: 'economy.buy', workUnits: '100', maxCinderAtoms: '10000',
}, '10012');
const input = 'Redeem one specified unit of work.';
const redeemed = await client.transact(payer, {
  type: 'economy.redeem', inputHash: nativeHash(input),
}, '12', input);
if (redeemed.receipt.result.output !== nativeHash(input)) {
  throw new Error('Incorrect deterministic output');
}
console.log((await client.economy(payer.address)).wallet);
```

Liquidity is funded from real test balances; no synthetic reserves are inserted. First LP shares are `floor(sqrt(CINDER atoms × WORK units))`. The constant-product pool retains a 30-basis-point trading fee. A swap input `a` with reserves `x,y` produces `floor(a × 9970 × y / (x × 10000 + a × 9970))`. The network fee is separate. Quotes do not reserve execution: signed `minOut` and deadlines protect against worse fills, and rejection commits nothing.

An example CINDER-input swap after someone has supplied liquidity:

```js
const { state } = await client.economy(payer.address);
const amountIn = 1000n;
const x = BigInt(state.pool.cinderAtoms);
const y = BigInt(state.pool.workUnits);
if (x === 0n || y === 0n) throw new Error('This pool has no liquidity');
const expected = amountIn * 9970n * y / (x * 10000n + amountIn * 9970n);
if (expected < 1n) throw new Error('Trade is smaller than one resource unit');
await client.transact(payer, {
  type: 'economy.swap', assetIn: 'CINDER', amountIn: amountIn.toString(),
  minOut: expected.toString(),
  deadline: new Date(Date.now() + 120000).toISOString(),
}, '1012');
```

Use the full [economy interface](economy-interface.md) for liquidity addition/removal, WORK transfer, rounding and bounds. There is one spot pair, no borrowing, leverage, liquidation, perpetual contract, cross-chain bridge or oracle-enforced dollar price. Liquidity provision can lose relative value and does not promise a return.

## Inference

`client.compute(key,'inference',input,'512')` reserves 500 resource atoms plus 12 fee atoms. The configured Meta Llama provider receives the raw input through Cloudflare Workers AI. A successful settlement publishes the output and provider/model assertion in the signed public ledger. Failed or expired jobs refund 500 resource atoms; the network fee remains charged. The timeout is two minutes. An upstream service may have executed before a timeout, so recovery is not a universal exactly-once guarantee.

A verified Llama receipt proves attribution and integrity under the operator key. It does not prove the claimed model weights executed, that no other input affected the answer, or that the answer is true. Do not submit private prompts: even though raw inputs are not stored in native ledger records, commitments can reveal guessable inputs and the output may repeat the prompt.

## Public API map

Prefix every path below with `/api/native`. Successful response contents, including amounts and model configuration, should be read from the running environment.

| Method and path | Purpose |
| --- | --- |
| `GET /info`, `GET /genesis` | Network identity, limits, prices, operator key and signed genesis |
| `POST /accounts` | Register an ML-DSA public key with proof of possession |
| `GET /accounts/:address` | Public balance, nonce, key and faucet state |
| `POST /submit` | Submit a signed atomic transaction or replay the exact envelope |
| `GET /transactions/:hash`, `GET /jobs/:hash` | Public receipt and compute completion/refund state |
| `GET /blocks?after=0`, `GET /export?after=0` | Pages of 20 checkpoint headers or full receipts with account public keys |
| `POST /channels/call` | Signed bounded session call with raw input |
| `GET /channels/:id`, `GET /channels/:id/journal?after=0` | Channel and pages of 20 signed call records |
| `POST /media/upload` | Signed sequential audio chunk upload |
| `GET /music/catalog`, `GET /music/tracks/:id` | Public publication metadata and splits |
| `POST /music/access` | Private payer authorization to obtain an existing unexpired token |
| `GET /media/:audioHash?token=...` | Authorized audio delivery, including byte ranges |
| `GET /economy?address=...` | Global WORK/pool state and optional wallet entitlements |

Native APIs allow cross-origin requests; spending requires signatures rather than browser cookies. Keep JSON requests below 48,000 bytes. Current native daily bounds are 30 inferences globally; 300 ordinary writes, 20 registrations, 1,800 reads and 250,000 channel-call requests per daily salted IP identity; global caps also apply. Request limits include attempts and retries, not just successful calls.

Lifetime limits are separate: 10,000 global checkpoints, new ordinary work stopped at existing height 9,900, and 100,000 accepted-plus-reserved channel journal slots. Owner-authorized channel close is an explicit recovery exception; both it and system expiry can consume the remaining checkpoint headroom. Already accepted journal records never become reusable lifetime slots. `/info.limits` reports these values and current channel usage. Upload and account bounds also apply. Limits are operational abuse controls, not proof of unique users or a guarantee of capacity.

`/export` and channel-journal pages use a separate history-read allowance: 20,000 requests per IP and 100,000 globally each day. Ordinary `/info`, account and transaction reads retain their ordinary limits. Treat pagination and polling as bounded operations rather than assuming unlimited public reads.

## Public deployment evidence

The public test network is [Cinder Rail](https://cinder-rail.ee777db.workers.dev). These files preserve observed results at the timestamps they contain:

| Report | What it records |
| --- | --- |
| [Network and genesis](https://cinder-rail.ee777db.workers.dev/examples/native-network.json) | Operator public key, signed genesis and genesis hash; compare with your previously trusted pin |
| [Application workflow](https://cinder-rail.ee777db.workers.dev/examples/native-apps-public.json) | Ten stages covering upload, publication, paid original bytes, exact 101-atom 71/30 split, duplicate rejection, real test-asset liquidity, exchange, WORK redemption, LP withdrawal and unpublication |
| [Public channel run](https://cinder-rail.ee777db.workers.dev/examples/native-channel-public.json) | 100 calls; median 353.3 ms, p95 519.7 ms, signing and verification included; two open/close checkpoints and 24 network-fee atoms |
| [Local channel run](https://cinder-rail.ee777db.workers.dev/examples/native-channel-local.json) | 10,000 calls; median 14.87 ms, p95 30.19 ms on the local test path; a different environment and sample size |
| [Live inference](https://cinder-rail.ee777db.workers.dev/examples/native-live-inference.json) | One real provider response with native reservation and settlement; no proof of model execution or factual accuracy |
| [Original audio demonstration](https://cinder-rail.ee777db.workers.dev/examples/native-demo.json) | Original synthesized test audio, publication and three demonstration-operated recipient wallets; user-funded test liquidity, not independent artist adoption |

The public channel report is an end-to-end request observation, not consensus finality or a throughput guarantee. Neither public nor local results establish an SLA. A successful past workflow does not automatically validate later code changes; retain the environment, report and release version when reproducing it.

## Independently replay the journal

```sh
CINDER_URL=http://127.0.0.1:8787 node scripts/audit-native.mjs
```

Set `CINDER_OPERATOR_KEY` to an independently trusted key and optionally `CINDER_REPORT=report.json`. The auditor pins genesis, verifies checkpoint signatures and hash links, binds public keys to addresses, authenticates client actions, re-executes monetary transitions, verifies closed channel journals and reconstructs CINDER and WORK supply. A large channel requires paginating its full journal and consumes the separate history-read quota; initial identity lookups still consume ordinary read quota.

Successful replay establishes that the presented history obeys these rules. It cannot prove there is no alternate signed history, force an unavailable operator to answer, recover deleted storage or establish independent validator agreement. Save previously observed heads and compare them across independent observers for evidence of equivocation.
