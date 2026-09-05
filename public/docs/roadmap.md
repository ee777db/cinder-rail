# Four-week engineering plan with release gates

Version 0.1 · 5 September 2026

The sandbox establishes the observable quote → authorize → execute → receipt loop. The next milestone is a capped testnet purchase using a real wallet-signature and settlement path. A four-week schedule organizes the work; it cannot make an audit finish or turn incomplete verification into a production guarantee.

## Week 1: make the protocol independently reproducible

Freeze the sandbox schema and canonicalization rules. Publish machine-readable request/receipt schemas, positive and negative signature fixtures, a dependency-light client and an offline verifier. Demonstrate wrong-key, changed-input, expired-quote, stale-total, simultaneous-request and replay behavior.

Instrument successful execution, failures, reservation recovery and total billed upstream use without collecting prompt contents unnecessarily. Run a workload with a disclosed duration, concurrency and geographic location. Record p50/p95/p99 application duration and error rate; keep inference latency separate from authorization overhead.

**Exit evidence:** another developer can reproduce one digest and one Llama purchase, verify their receipt without trusting the website's verifier, and demonstrate that changing a signed field fails verification. No live money is required.

## Week 2: canonical x402 testnet integration

Add an adapter using the canonical x402 v2 schema and official package family. Keep the sandbox protocol names distinct. Use Base Sepolia test assets and a supported testnet facilitator; hard-code the expected network and asset allowlist in test configuration, never infer them from an untrusted payment response.

Exercise quote/offer binding, expired authorizations, payment identifiers, duplicate HTTP retries, provider errors after authorization, facilitator unavailability and settlement reconciliation. Store the chain transaction identifier with the application receipt while distinguishing submitted, included and finalized status.

**Exit evidence:** a repeatable trace shows testnet funds leaving a controlled buyer wallet, arriving at the intended seller, a single delivered result, and a receipt bound to that purchase. A negative test proves an altered amount or recipient is rejected. Publish the trace with test addresses and no keys.

## Week 3: channel hardening and external provider evidence

Measure real per-purchase settlement costs and buyer repeat behavior before adding a channel. If amortization is worthwhile, implement the cumulative voucher design using a narrowly supported token. Cover partial claims, stale vouchers, cross-chain and cross-contract replay, provider claim during payer exit, deadline boundaries, token-transfer failure and malformed signatures.

Use stateful fuzzing and independent review. Separate browser session keys from supported EVM signers. Add a watcher and disaster-recovery drill for open channels. Connect a second independently operated provider with its actual evidence capabilities; two routing aliases to one upstream are not two independent operators.

**Exit evidence:** conservation and no-double-payment properties hold across randomized operation sequences; the exit path remains usable during application outage; the external reviewer has a concrete code revision and finding log. Testnet only while material findings remain.

## Week 4: bounded pilot decision

Choose one narrow paid service and a maximum aggregate financial exposure. Complete the necessary contract review, terms and operating responsibilities, signer rotation, alerts and support ownership. Run an end-to-end incident exercise. Confirm product copy matches the exact evidence tier and settlement state.

If a TEE pilot is available, validate real attestation evidence including workload/key binding and nonce freshness. Otherwise continue the signed-receipt tier; do not promote its label. ZK verification should begin as a separately benchmarked small-model service, not an unverified promise attached to the existing Llama route.

**Exit evidence:** an accountable operator signs off on measured loss limits and readiness, independent review has no unresolved blocking findings, settlement reconciliation balances, and the user interface accurately describes custody, finality and verification. If any gate fails, retain the public sandbox and testnet deployment until it passes.

## Commercial validation alongside engineering

The first target is a developer selling a bounded API function to another program. Measure: successful authorized purchases, verified receipts, repeat integrations, completion rate, cost per fulfilled request, refund rate, provider concentration and developer time to first verified response. Define a repeat integration by observed use; do not count automated demo tests as customer adoption.

Publish one practical integration walkthrough and the limitation table with the public release. Offer the source and protocol for inspection. A managed service becomes a credible business when it saves customers implementation time or reduces real reconciliation problems. Raw traffic, token price and a waitlist count do not demonstrate that result.

