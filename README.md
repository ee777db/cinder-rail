# CINDER

**让机器付工作的钱，让创作者收到每一次付费访问的钱。**

CINDER is a self-issued native test currency for machine work, paid music access and resource exchange. The implementation has ML-DSA-65 account signatures, exact integer accounting, bounded compute channels, an audio publication/payment flow and a CINDER/WORK spot market. It uses Cloudflare Workers and a SQLite-backed Durable Object; no GPT Sites or OpenAI inference service is involved.

This repository contains the **0.2 deployed native testnet**. Public native transfers, music access, resource trading, bounded channels and one real Meta Llama inference have been verified. The complete automated suite passes 192 tests, with main-project and browser/SDK type checks passing. Deployment evidence is recorded in [the completion report](docs/completion-gate.md). CINDER and WORK are test assets without cash redemption or a claimed dollar price. The operator sequences and stores this network. Independent validator consensus is not deployed.

## Use it

The project address is [cinder-rail.ee777db.workers.dev](https://cinder-rail.ee777db.workers.dev). The native interface lets you create a wallet, receive test CINDER from the finite reserve, send it, publish your own audio with recipient splits, pay for access, buy/redeem WORK and exchange CINDER/WORK. Private wallet keys stay in browser memory; an encrypted backup can be downloaded and restored. Losing the key and backup loses access. No password reset or social recovery service exists.

The catalog includes **First Light**, an original 12-second synthesized demonstration. Its three recipient wallets are operated by the demo, with a 70/20/10 split. The initial spot pool was funded with 2 test CINDER and 20,000 WORK purchased from actual test balances. This is transparent demonstration inventory, not outside artist adoption or independent market liquidity. [Public demo manifest](public/examples/native-demo.json).

For agents, [the native developer guide](docs/developers-native.md) includes runnable SDK examples, bounded session keys, safe retries, media access and ledger verification. Native API discovery begins at `/api/native/info` and `/api/native/genesis`.

## What the two assets do

| Asset | Actual implementation | Boundary |
| --- | --- | --- |
| CINDER | Native transferable six-decimal balance; pays network fees, compute, creator splits and spot trades | Finite test genesis of 1,000,000 CINDER. No mainnet allocation, sale, market-price or redemption promise |
| WORK | Native transferable integer entitlement; consuming one unit executes a bounded SHA-384 text operation | Finite 1,000,000-unit inventory promised by this operator. It is neither dollars nor a general LLM/GPU credit |

WORK separates a specified service entitlement from the currency used to acquire it. Buying 100 WORK gives 100 specified operations under the testnet's availability and capacity limits; it does not freeze the future dollar cost of acquiring CINDER. The current hash workload tests the payment machinery and is independently reproducible; it is not a new inference-verification invention or a commercially valuable AI service.

## Run and verify locally

Requires Node.js 22.18+ and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
node scripts/build-native.mjs
node scripts/build-docs.mjs
npm run dev
```

Open `http://127.0.0.1:8787`. Deterministic computation, audio and the native market work locally. Cloudflare Workers AI is required for Meta Llama inference.

In another terminal:

```sh
npm test
npm run check
CINDER_URL=http://127.0.0.1:8787 node scripts/native-smoke.mjs
CINDER_URL=http://127.0.0.1:8787 npm run test:apps
CINDER_URL=http://127.0.0.1:8787 CINDER_CALLS=100 node scripts/native-channel-smoke.mjs
CINDER_URL=http://127.0.0.1:8787 npm run test:audit
npm run build
```

These HTTP tests create actual testnet accounts and state. Repeated runs consume finite faucet inventory and quotas. Set `CINDER_TEST_AI=1` for one bounded external inference in `native-smoke.mjs`; that consumes provider resources. Contract tests use a local EVM with mock assets. The Solidity contracts are a separate reference path, not the native CINDER consensus or issuance system.

Measured results include client signing, HTTP transport and response verification:

| Environment | Calls | Elapsed | Calls/second | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Localhost](public/examples/native-channel-local.json) | 10,000 | 169.244 s | 59.09 | 14.87 ms | 30.19 ms |
| [Public endpoint, sequential client](public/examples/native-channel-public.json) | 100 | 38.819 s | 2.58 | 353.3 ms | 519.7 ms |

Each channel used two global opening/closing checkpoints and 24 total network-fee atoms, plus 100 resource atoms per accepted call. Intermediate responses are collateral-backed operator acknowledgments; native balances settle at closing. These measurements do not establish independent-validator finality, a dollar price or a production capacity ceiling. The public sequential sample does not establish the requested 10,000 calls/hour workload.

The [public application checks](public/examples/native-apps-public.json) exercise uploaded audio, byte ranges, exact royalties, funded liquidity, swaps and resource redemption. The [public Llama result](public/examples/native-live-inference.json) records one actual provider response and native settlement. [Public ledger replay](public/examples/native-audit-public.json) reconstructs the presented history; its timestamp, verified count and observed head are included in the report.

## Deploy on Cloudflare

```sh
npx wrangler login
npm run deploy
```

Deployment uses one Worker, the native `NativeLedger` Durable Object and two retained legacy sandbox classes, plus a Workers AI binding. It does not require a purchased domain. Hosting and inference can incur charges on the connected account. Source quotas bound intended activity, not all possible platform costs.

The native operator signing key is generated inside the native Durable Object and stays in its private storage. Preserve that storage to preserve identity and history. After deployment, record the genesis hash and operator public key through a trusted channel; clients can pin that key. A self-hosted copy is a different ledger unless its history and keys are deliberately migrated. It does not automatically become another validator of this network.

Public receipt inspection with local signature verification is available at [the explorer](https://cinder-rail.ee777db.workers.dev/explorer); [Chinese research](https://cinder-rail.ee777db.workers.dev/research) covers all 48 requested ticker identities, with explicit ambiguity where a symbol does not uniquely identify an asset.

## Read and inspect

- [Native developer guide](docs/developers-native.md): SDK, API and operational semantics.
- [Native design](docs/native-design.md), [channels](docs/channel-interface.md) and [resource market](docs/economy-interface.md): protocol details.
- [Security](docs/security.md) and [privacy](docs/privacy.md): exact trust and data boundaries.
- [Completion report](docs/completion-gate.md) and [0.2 launch notes](docs/launch-v0.2.md): demonstrated capabilities and outstanding conditions.
- `src/native-*`: deterministic transitions, cryptographic authorization, media and durable sequencing.
- `sdk/native-client.ts`, `browser/`: client verification, wallet vault and application interface.
- `scripts/audit-native.mjs`: replay of authorized state transitions, native supply, WORK accounting, creator allocations and channel journals.

The old `/compute` sandbox uses P-256 signatures and expiring nontransferable credits. Its 24-hour retention policy applies to that sandbox only. The native ledger, compute outputs, published metadata and signed journals are public and have no automatic deletion schedule. Do not submit private material. [Privacy details](docs/privacy.md).

MIT licensed. Provider/model terms apply separately. Report non-sensitive bugs through [GitHub issues](https://github.com/ee777db/cinder-rail/issues); do not publish private keys, playback tokens or sensitive exploit details. No independent audit, complete quantum-safe infrastructure, proof of correct LLM inference, perpetual exchange or external music-site integration is represented by this release.
