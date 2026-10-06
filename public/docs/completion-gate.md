# Implementation and completion evidence

Version 0.2 deployed native testnet · 5 October 2026

CINDER is running at [cinder-rail.ee777db.workers.dev](https://cinder-rail.ee777db.workers.dev). Actual public transfers, audio upload and paid access, creator splits, resource redemption, spot trades, channel settlement and one real Meta Llama request have completed. This is a deployed native testnet, not a whitepaper-only or credit-only demonstration.

The broader acceptance condition is **not fully satisfied**. The deployed network uses one operator, test assets and bounded services. It does not yet provide independent consensus, a dollar-stability mechanism, proof of correct LLM inference, the requested perpetual exchange or established agent adoption. The matrix below makes that distinction explicit.

A verified Cloudflare deployment was `bcf7f445-fde1-4de0-8599-77c8d10e6f40`; later deployments may supersede that application version while retaining its native identity and history. The [public identity record](../public/examples/native-network.json) records the chain ID, signed genesis, genesis hash, operator public key and observation time. Reports below identify their actual network and time. They are snapshots, not a hard-coded claim about the network's current head.

## Verified implementation and public flows

| Check | Observed result | Evidence and scope |
| --- | --- | --- |
| Complete automated suite | 192/192 passed | Native cryptography, account/application transitions, failure recovery, channel limits, wallet vault, semantic replay, legacy protocol and reference contract checks |
| Type checking | Main project and browser/SDK checks passed | Source interfaces and DOM usage |
| Public native smoke | 11 stages, 102 HTTP requests, eight new checkpoints | Actual native transfers, authorization/replay checks, computation and one bounded external Meta Llama request |
| Public application smoke | 10 stages, 11 transactions | [Report](../public/examples/native-apps-public.json): original audio upload, full/byte-range delivery, 71/30 royalty allocation from 101 atoms, duplicate rejection, WORK redemption, funded liquidity, slippage limits and withdrawal |
| Live inference | One real Meta Llama provider request completed and settled | [Signed request and result](../public/examples/native-live-inference.json); establishes provenance and delivery, not correct model execution or answer quality |
| Public semantic ledger replay | Passed through the complete observed head recorded in the report | [Current saved audit snapshot](../public/examples/native-audit-public.json) includes checkpoint/signature counts, genesis identity and head hash; later transactions require a fresh replay |
| Local semantic ledger replay | 43 checkpoints and 10,085 signatures verified | [Local report](../public/examples/native-audit-local.json); includes the 10,000-call authorization journal |
| Local browser market | Actual purchase, swap, liquidity addition/removal and redemption verified | Browser UI and signed local transactions |
| Public browser paid access | Original 12-second demo became playable; media ready state 4 and no media error | [Paid-access receipt](https://cinder-rail.ee777db.workers.dev/explorer?tx=9c190bdc3642c58be9e24ac08468d764461d004486132dbec3f2aa426bd753e3b0ebbbb5072bb82c6a0db934404b40d7), recorded at checkpoint 30; this is a paid access event, not proof of a unique human listening |
| Public explorer | Live checkpoint pagination, receipt lookup, local ML-DSA checks and JSON download | [Explorer](https://cinder-rail.ee777db.workers.dev/explorer); first-observed operator trust is disclosed and distinct from independent consensus |
| Public research | Chinese analysis of all 48 requested ticker identities with sources | [Research](https://cinder-rail.ee777db.workers.dev/research); ambiguous symbols are labeled rather than silently assigned |

The [public demonstration manifest](../public/examples/native-demo.json) identifies **First Light · Cinder demo**, a 12-second original synthesized recording with 70/20/10 recipient shares. All three recipient wallets are controlled by the demonstration. The seed script bought WORK from actual test balances and deposited **2 CINDER plus 20,000 WORK** into a previously empty pool. These are funded test reserves; they are not independent artists, outside adoption, a fiat price or evidence of organic market demand. Pool reserves can change after that initial deposit.

## Measured channel performance

| Measurement | Localhost | Public endpoint, sequential client |
| --- | ---: | ---: |
| Accepted calls | 10,000 | 100 |
| Total elapsed time | 169,244 ms | 38,819 ms |
| Calls/second | 59.09 | 2.58 |
| Median end-to-end call | 14.87 ms | 353.3 ms |
| p95 end-to-end call | 30.19 ms | 519.7 ms |
| Opening + closing checkpoints | 2 | 2 |
| Total opening + owner-close network fee | 24 atoms | 24 atoms |
| Resource entitlement consumed per call | 100 atoms | 100 atoms |
| Network fee averaged per accepted call | 0.0024 atoms | 0.24 atoms |

Sources: [local 10,000-call report](../public/examples/native-channel-local.json), [public 100-call report](../public/examples/native-channel-public.json). Both include client signing and verification. UTC report timestamps fall on 6 October; the local release date is 5 October in America/New_York.

Intermediate channel responses are provisional operator acknowledgments against a prefunded allowance. Native balances settle only at a closing checkpoint. Neither sample measures independent validator finality or dollar-denominated fees. The slower public sequential result is included rather than substituting localhost timing for public latency. It does not establish 10,000 calls/hour on the public service, and it is not a universal throughput ceiling. The completed four-channel [1,000-call public run](../public/examples/native-throughput-public.json) accepted and settled every call: 511.553 seconds for the call window, **1.954832 verified calls/second**, 1,506.197 ms median and 3,913.196 ms p95. Setup took 5.023 seconds and cleanup 5.258 seconds; total elapsed was 521.835 seconds. One exact retry produced 1,001 network attempts, with no duplicate charge. Eight open/close checkpoints charged 96 network atoms; resource settlement was 100,000 atoms. These Internet measurements include the client's configured HTTPS proxy. Concurrency did not improve observed throughput; this run falls below 10,000 calls/hour (2.778 calls/second), and no cause or production ceiling is inferred from this one route.

## Capability and acceptance matrix

| Requested capability | Implemented and verified now | Remaining boundary |
| --- | --- | --- |
| Own coin and accounting | Public `cinder-devnet-1/native`, six decimals, finite genesis reserve, signed transfers and supply replay | Test asset; no mainnet issuance/distribution, cash redemption or external monetary value |
| Lightweight high-frequency payment | Prefunded session channels, scoped keys, public journals, native closing settlement, local 10,000-call, public 100-call and four-channel 1,000-call samples | One operator and bounded hash workload; sustained public 10,000 calls/hour and decentralized finality are not established |
| Sub-cent cost and negligible fees | Exact native accounting; 24 network-fee atoms across each measured open/close pair | No fiat exchange rate, demonstrated dollar sub-cent cost, zero transport-cost claim or provider-cost benchmark |
| Resource price stability | Finite WORK inventory, specified operation per unit, deterministic burn/redemption | Operator capacity promise; no dollar peg, audited physical backing, general GPU/LLM entitlement or assured indefinite service |
| Post-quantum foundation | ML-DSA-65 native signatures, SHA-384 commitments, selected NIST vectors | Hosting, administration, recovery and the JavaScript implementation are not end-to-end independently audited PQ infrastructure |
| Nonpunitive circulation | Service payments, resource consumption and LP fees from actual trades; no holding tax or wash-volume mining | No demonstrated mature economy or sustainable demand; trading fees do not guarantee LP return |
| Music upload → payment → access → royalties | Public original upload, hash commitment, immutable splits, paid media delivery, browser playback and exact allocations | No rights adjudication, proof of human attention, advertising meter or integration with the user's separate music site |
| Native trading pair | Public CINDER/WORK funded spot pool, LP shares, deposits, swaps and withdrawals | No perpetual exchange, orderbook, margin, liquidations, bridges, other-chain assets or external listing |
| Agent identity | ML-DSA account authorization and bounded channel session keys | Key identity is not human identity or proof that a claimed model executed |
| Verifiable inference | Actual bounded Llama response, signed attribution and native settlement; reproducible hash execution | No ZKML proof, validated TEE attestation or proof of correct LLM execution |
| Network consensus | Serialized durable state, signed hash-linked checkpoints and public semantic replay | No deployed independent validators, BFT finality or permissionless self-hosted shared network |
| Wallet usability | Browser creation, local encrypted backup/restore, native SDK | No social recovery, passkey/hardware signer, password reset or universal wallet interoperability |
| Whitepaper and documentation | Public protocol, interfaces, developer/security/privacy material and sourced comparative research | Describing a missing mechanism does not make it implemented |
| Deployment and discoverability | Live native testnet, website, explorer, API discovery and dated verification reports | A versioned GitHub release or external social announcement is a separate publication action, not inferred from deployment |
| Adoption | Working public demo and integration examples | Operator-owned demo wallets and seeded reserves are not outside users, artists, partners, independent liquidity or agent preference |

## Reproduce

```sh
npm ci
node scripts/build-native.mjs
node scripts/build-docs.mjs
npm run dev
```

With the local server running:

```sh
npm test
npm run check
CINDER_URL=http://127.0.0.1:8787 node scripts/native-smoke.mjs
CINDER_URL=http://127.0.0.1:8787 node scripts/native-apps-smoke.mjs
CINDER_URL=http://127.0.0.1:8787 CINDER_CALLS=10000 node scripts/native-channel-smoke.mjs
CINDER_URL=http://127.0.0.1:8787 node scripts/audit-native.mjs
npm run build
```

For read-only replay of the deployed testnet, run:

```sh
CINDER_URL=https://cinder-rail.ee777db.workers.dev node scripts/audit-native.mjs
```

Use `CINDER_OPERATOR_KEY` to supply a previously trusted public key. The audit script otherwise observes the endpoint's current identity. HTTP smoke and application tests mutate finite test state and consume quotas. `CINDER_TEST_AI=1` explicitly adds a bounded external inference call. Preserve reports with their environment, timestamp and operator identity; a local pass must not be relabeled a public pass.

Only native test assets were transferred. No sale was performed, and the development supply assigns no future token entitlement. The deployed implementation is real; the unfulfilled economic, consensus and adoption requirements remain unfulfilled.
