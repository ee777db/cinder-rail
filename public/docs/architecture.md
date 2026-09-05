# Cinder Rail: architecture and decisions

Version 0.1 · 5 September 2026 · Public sandbox and reference design

Cinder Rail makes one machine purchase inspectable: a service quotes a bounded price, an agent signs the authorization, the service performs work, and the operator signs a receipt binding the charge to input and output digests. The initial deployment uses nonredeemable test credits. It does not move USDC, issue a token, operate a blockchain, or prove Llama inference mathematically.

The product thesis is that buyers need a clear answer to **what did this agent authorize, what did it receive, and what evidence supports the charge?** A new speculative asset does not answer those questions. A useful rail can begin with signed authorizations, strict spending limits, transparent evidence, and an interoperable settlement adapter.

## What runs now

| Component | Implementation | Trust boundary |
| --- | --- | --- |
| Browser client | Static HTML, CSS, JavaScript; native WebCrypto P-256 agent keys | Website code and the user's browser |
| Public gateway | Cloudflare Worker; same-origin API and static assets | Cloudflare and deployment operator |
| Session accounting | One Durable Object per session; persistent ledger, quotes, receipts | Centralized operator-managed database |
| Signing and limits | Separate provider control object; P-256 issuer key and daily quotas | Operator controls the signing key |
| Deterministic service | SHA-256 over UTF-8 text | Client can recompute the digest |
| Inference service | Meta Llama 3.1 8B Instruct FP8 Fast through Workers AI | Provider assertion of which model ran |
| Settlement | Integer test ledger, `sandbox-microUSD` | No monetary value or redemption |

Cloudflare's per-object durable, transactional storage is a practical coordination primitive for an isolated agent session. External asynchronous calls can still interleave; persistence and explicit state transitions remain necessary. Cloudflare's storage guarantees are infrastructure guarantees, not decentralized consensus. [Durable Objects concepts](https://developers.cloudflare.com/durable-objects/concepts/what-are-durable-objects/), [concurrency guidance](https://developers.cloudflare.com/durable-objects/best-practices/rules-of-durable-objects/).

The runtime uses no ChatGPT, GPT model, or GPT Sites service. The inference dependency is Meta Llama served by Cloudflare. Source code, assets, and deployment configuration are ordinary files that can be moved to another host. Replacing Durable Objects requires a transactional store with equivalent application invariants; portability does not mean identical deployment commands.

```mermaid
sequenceDiagram
    participant A as Agent client
    participant W as Worker / session ledger
    participant C as Compute provider
    participant S as Receipt signer
    A->>W: Register public session key
    W-->>A: Test balance and expiry
    A->>W: Service request
    W-->>A: HTTP 402 + bounded quote
    A->>A: Check price, input digest, expiry; sign quote
    A->>W: Same input + signed quote
    W->>W: Verify; reserve test credits
    W->>C: Execute bounded work
    C-->>W: Output
    W->>S: Bind output digest and charge in receipt
    S-->>W: Issuer signature
    W->>W: Persist result and final charge
    W-->>A: Output + signed receipt
    A->>A: Verify signature and output digest
```

The sandbox protocol is named `cinder-sandbox-v1`. HTTP 402 is an HTTP status used in this custom flow. It is **not an assertion of x402 compatibility**. Browser P-256 authorizations cannot be submitted as ordinary EVM wallet payments.

Session creation returns a public session identifier and a separate secret session token. The token is sent in `X-Cinder-Session` to read session state or obtain an unsigned quote; the identifier alone is safe to include in a receipt. Spending additionally requires the agent's valid signature. Receipt exports must omit the secret token and private key.

## Settlement choice for a funded release

Choose an existing Ethereum L2, initially Base, with native USDC. Start with canonical x402 v2 for sufficiently priced individual purchases. Add a separately specified, audited cumulative channel adapter when measured repeat traffic justifies it. Keep proof verification independent of chain choice.

| Candidate | Benefits | Costs and assumptions | Decision |
| --- | --- | --- | --- |
| Existing EVM L2 / Base | Established EVM tools, USDC and x402 integration; reusable wallet and contract ecosystem | Sequencer availability; chain fees; issuer risk; wallet/facilitator integration | First funded target after gates pass |
| Own Arbitrum Orbit or OP Stack L2/L3, optional Celestia DA | Control execution settings, fee policy, ordering and capacity | Operate sequencer, batcher, monitoring, bridges, upgrades, proof infrastructure and DA integration; fragment liquidity | Unjustified for this launch |
| Existing Solana / SVM | Parallel execution, existing stablecoin ecosystem, x402 support | Separate wallet and program implementation; contention, fees and commitment policy still matter | Good second adapter if users need it |
| Own SVM chain | Execution customization | A runtime is not a validator set, bridge, DA guarantee or reliable operating team | No present need |
| EigenLayer AVS | Can organize economically accountable verification operators | Must define objective faults, slashing, capital exposure, operator independence and monitoring; does not supply inference correctness by itself | Revisit only for a concrete verifier service |

These decisions are engineering judgments about this project's size and needs, not universal rankings of the networks. OP Stack transaction fees include execution and L1 data components; its chain heads express different finality states. [OP Stack differences](https://docs.optimism.io/op-stack/protocol/differences). Arbitrum's AnyTrust design trades some DA assumptions for cost; deploying a chain still requires making those assumptions explicit. [Arbitrum Nitro whitepaper](https://docs.arbitrum.io/nitro-whitepaper.pdf).

Celestia supplies data availability and blob ordering; execution and settlement remain separate responsibilities. Adding its name to an architecture does not provide a bridge or a valid compute verifier. [Celestia data availability](https://docs.celestia.org/learn/celestia-101/data-availability/). EigenLayer restaking can support a service's defined economic penalties; the service must still specify which behavior is attributable and punishable. [EigenLayer whitepaper](https://docs.eigencloud.xyz/assets/files/EigenLayer_WhitePaper-88c47923ca0319870c611decd6e562ad.pdf).

## Acknowledgment is not finality

The UI's request duration measures the application path. It is not blockchain finality, a guaranteed latency percentile, or an independently measured benchmark.

Base documentation currently distinguishes approximately 200 ms Flashblock preconfirmation, 2 s L2 block inclusion, 2 minutes L1 batch inclusion and 20 minutes L1 batch finality. These are different assurances, not an unconditional 200 ms settlement promise. The approximately seven-day withdrawal process concerns movement back to Ethereum L1. [Base transaction finality](https://docs.base.org/specifications/transactions/transaction-finality).

Solana similarly distinguishes `processed`, `confirmed` and `finalized`; a recent processed block can roll back, while finalized is the strongest network commitment. Never present a lower commitment level as an irreversible settlement. [Solana RPC commitment](https://solana.com/docs/rpc#configuring-state-commitment).

For a future channel, a successful signature check is an **off-chain acceptance of a claim** against previously funded collateral. The recipient accepts chain, timeout, enforcement and signer risks until the claim is settled. The principal benefit is fewer on-chain actions, not removal of every trust assumption or cost.

## Funded channel design

This section specifies an intended production design. Consult the contracts' own documentation for the narrower capabilities of the unaudited reference implementation.

An agent funds a unidirectional escrow for one asset, chain, provider and authorized signer. A voucher contains channel ID, cumulative amount, sequence or unique authorization ID, expiry and domain separation. The provider accepts a voucher only if it increases the authorized total, does not exceed funded collateral, and leaves sufficient time to claim it. A channel is not a transferable credit and cannot be spent at unrelated providers.

If the highest valid total is `A` and the contract already paid `P`, a claim transfers `A − P`, subject to `0 ≤ P ≤ A ≤ D`, where `D` is the channel's funded amount. Resubmitting the same voucher cannot pay again. Domain separation binds the signature to the chain and contract. Nonces, state and deadlines prevent replay; typed-data signing alone does not. [EIP-712 security considerations](https://eips.ethereum.org/EIPS/eip-712#security-considerations).

The refund path requires a challenge period or a claim deadline that providers can enforce while the payer exits. A watchtower can improve availability but introduces monitoring and incentive questions. Economic exposure must be capped during outages. A provider must not deliver unlimited work against a merely broadcast deposit.

Settlement and delivery are not automatically atomic. With preauthorization, an authorized provider may be paid before the buyer is satisfied. With postdelivery signatures, a buyer may refuse to sign. Small exposure windows, service-level refunds and objective proof conditions can limit this problem; a signed receipt alone cannot solve fair exchange or a subjective answer-quality dispute.

## Interoperability and scope

Canonical x402 v2 standardizes versioned payment requirements, chain identifiers and payment payloads. Use its actual schema and SDK fixtures; do not relabel Cinder's custom JSON as an accepted scheme. The future adapter must pin a specification version and pass both successful-payment and failure-path integration tests. [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

Cinder's own small protocol has a deliberately narrower surface: one session, bounded input, a fixed quote, one active operation and an issuer receipt. It does not offer decentralized provider discovery, general agent autonomy, cross-chain settlement, live deposits or production compute proofs. Those features require their own evidence, not a larger landing page.
