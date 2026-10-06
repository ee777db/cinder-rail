# CINDER 0.2 — native testnet release notes

5 October 2026 · deployed native testnet

[CINDER is live](https://cinder-rail.ee777db.workers.dev): create a wallet, send native test CINDER, pay for original music access, inspect creator allocations, redeem WORK or exchange the native CINDER/WORK pair. Agents can use separate session signing keys and prefunded channels. The [explorer](https://cinder-rail.ee777db.workers.dev/explorer) lets anyone inspect actual transactions and verify their receipt signatures locally.

The network is operated by one host and uses test assets. Independent validator consensus, cash redemption, a dollar peg and proof of correct LLM inference are not deployed. These notes describe a verified running testnet, not a claim that the full currency, music ecosystem or trading platform is complete.

## What changed

- Self-issued native CINDER balances, a finite reserve faucet, ML-DSA-65 authorizations, integer fees and publicly replayable signed checkpoints replace the former credit-only front page.
- Prefunded channels separate wallet authority from a bounded service allowance, with authenticated retries, signed call journals, consumed-payment settlement and unused-principal refunds.
- Music now follows an actual upload → publication → payment → playback flow, with file-hash commitments, immutable creator splits and exact public allocations.
- Native WORK units can be bought, transferred and redeemed for a specified deterministic operation. A funded CINDER/WORK spot pool supports shares, deposits, swaps and withdrawals.
- Browser wallets support local encrypted backups. The native SDK, public receipt explorer and semantic replay tools expose the same underlying accounting.
- One real, bounded Meta Llama request through Cloudflare Workers AI has completed with native reservation and settlement. Its signed response establishes attribution and delivery, not execution correctness.
- [Chinese research](https://cinder-rail.ee777db.workers.dev/research) analyzes the 48 requested ticker identities, with primary sources and explicit ambiguity where a symbol alone is insufficient.

## Try a complete public flow

The catalog contains **First Light · Cinder demo**, an original 12-second synthesized recording. Its price is 0.001 test CINDER per access window, with 70/20/10 recipient shares. The recipients are demo-operated accounts. The browser has successfully purchased access and received playable audio from the deployed service. This is transparent test content, not a claim of outside artists or a real audience.

The initial spot pool holds liquidity deposited as **2 test CINDER and 20,000 WORK** bought from actual faucet-funded balances. The pool uses actual inventory and LP ownership; its reserves may change through later trades. It does not support a fiat price or promise a financial return. The [demo manifest](../public/examples/native-demo.json) publishes the content hash, recipient addresses and funding transaction identifiers without private keys.

## Verification and measured performance

The complete automated suite passes **192/192 tests**. Main-project and browser/SDK type checks pass. Public native smoke completed 11 stages across 102 HTTP requests and eight new checkpoints, including the live Llama call. The [application report](../public/examples/native-apps-public.json) records ten stages and eleven transactions covering audio ranges, precise 71/30 payouts from a 101-atom purchase, duplicate rejection, funded liquidity, slippage protection, WORK redemption and withdrawal.

| Environment | Accepted calls | Total elapsed | Calls/second | Median | p95 |
| --- | ---: | ---: | ---: | ---: | ---: |
| [Localhost](../public/examples/native-channel-local.json) | 10,000 | 169.244 s | 59.09 | 14.87 ms | 30.19 ms |
| [Public endpoint, sequential client](../public/examples/native-channel-public.json) | 100 | 38.819 s | 2.58 | 353.3 ms | 519.7 ms |

Each measured channel used two global checkpoints and 24 total network-fee atoms, plus 100 resource atoms per accepted call. Both reports include signing and verification at the client. Intermediate calls receive collateral-backed operator acknowledgments; native settlement happens at close. Local timing is not public-network timing, and neither result establishes dollar sub-cent cost, decentralized finality or a production throughput ceiling. The public sequential measurement does not establish the requested 10,000 calls/hour workload.

The [public network identity](../public/examples/native-network.json), [live inference record](../public/examples/native-live-inference.json), [public ledger replay](../public/examples/native-audit-public.json) and [local replay](../public/examples/native-audit-local.json) provide dated evidence. Audit counts and observed heads are in those files because the network continues to change. The additional [four-channel public benchmark](../public/examples/native-throughput-public.json) completed and settled 1,000 calls in a 511.553-second call window: **1.954832 calls/second**, median 1,506.197 ms and p95 3,913.196 ms, plus 10.282 seconds of setup and cleanup. It used 96 network-fee atoms and 100,000 resource atoms. One exact retry was handled without duplicate charging. This route includes the client's HTTPS proxy and did not meet 10,000 calls/hour; it is recorded as measured, not replaced with the faster localhost result. [The completion report](completion-gate.md) maps the broader requested capabilities to verified behavior and remaining gaps.

## Announcement

> CINDER's native testnet is live. Create a wallet, send native test CINDER, publish original audio with recipient splits, redeem a WORK unit or try a CINDER/WORK spot trade. Agents can use scoped signing keys and prefunded channels; the public explorer checks receipts and exposes the actual accounting. Native signatures use ML-DSA-65. The testnet currently has one operator and test assets: no dollar peg, independent-validator finality or proof of correct LLM inference is claimed. The website publishes developer examples, sourced Chinese research and measured verification reports.

## Who it serves, and what remains

Agent developers can integrate bounded spending, scoped keys and receipts. Independent creators can inspect explicit paid-access allocations. Application builders can examine one native accounting path for access, resource consumption and spot exchange. Testnet demonstrations do not establish that agents already prefer CINDER or that it replaces Spotify, YouTube, Hyperliquid or established settlement networks.

The website, explorer, developer guide, research and machine-readable API description are available public discovery surfaces. These notes can also be used for a versioned source release; a GitHub tag or external social publication is a separate action and is not implied by the existence of this page.

No exchange listing, partner endorsement, independent artist adoption, organic liquidity, independent audit or promised token value is claimed. Independent network operation, robust key recovery, independently reviewed cryptography and implementation, useful reserved compute capacity, economic sustainability, execution proofs, application rights handling and a real derivatives engine remain substantive work. The testnet makes the implemented behavior inspectable without calling those missing properties complete.
