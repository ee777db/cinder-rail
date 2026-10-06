# Research update — 7 September 2026

The product decision remains a native CINDER development ledger with application-specific authorization and bounded spending. Its concrete scope is paid compute and content access with independently inspectable receipts. A hosted operator, a new coin and a post-quantum signature library do not by themselves create permissionless consensus, stable purchasing power or proof of correct inference.

## Post-quantum claims need a precise boundary

NIST's final FIPS 204 defines ML-DSA digital signatures. Its publication page now includes a **31 July 2026 errata notice** for potential corrections; implementing a standardized primitive therefore still requires version tracking, test vectors and implementation review. ML-DSA authenticates a signed message under a key. It does not certify who owns music rights or whether an inference result is true. [NIST FIPS 204](https://csrc.nist.gov/pubs/fips/204/final).

CINDER's current native implementation pins `@noble/post-quantum` 0.7.1 and uses ML-DSA-65. The upstream version explicitly says that it has not been independently audited and does not claim constant-time JavaScript execution. This supports a useful devnet experiment, not an audited high-value wallet claim. Secret-key handling, runtime isolation and software supply-chain controls remain separate engineering work. [Pinned library security notes](https://github.com/paulmillr/noble-post-quantum/tree/0.7.1#security).

Existing networks are actively working on this migration. The Ethereum Foundation's PQ team describes execution-layer account migration, replacement of BLS consensus signatures, proof-based signature aggregation, and data-layer work. Its roadmap is directional and subject to governance and research; it is neither a claim that Ethereum is already fully post-quantum nor evidence that it cannot migrate. CINDER's smaller initial state avoids migration of an existing user base, while assuming the cost of building its own ecosystem and security evidence. [Ethereum PQ program](https://pq.ethereum.org/).

Cloudflare's documentation distinguishes key agreement from certificate authentication. Hybrid key agreement can protect supported TLS connections against later decryption; it does not automatically make authentication, account administration, every internal connection, or application deployment post-quantum. The documented visitor-to-edge and internal authentication migrations are still in development. CINDER must describe its application-level ML-DSA signatures separately from hosting security. [Cloudflare PQ deployment boundaries](https://developers.cloudflare.com/ssl/post-quantum-cryptography/).

## Machine payments and batching already exist

The current x402 v2 specification lists `exact`, `upto` and `batch-settlement` payment schemes. It distinguishes resource request, payment requirements, signed authorization, verification and settlement, and accommodates different execution/settlement orderings. Its core scope excludes client budget management and session handling. CINDER must not claim to have invented HTTP payments, maximum-spend authorization or batching, and its native wire format must not be advertised as x402 compliant without an implemented, tested adapter. [x402 v2 specification](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md).

An x402 facilitator verifies payment requirements and submits settlement. It does not thereby verify the service's substantive correctness. For CINDER, a valid payer signature establishes permission to spend; a valid operator receipt establishes the operator's signed claim about execution and accounting. The deterministic hash service can be independently recomputed. A hosted Llama response is still operator/provider provenance without a model-execution proof. [x402 facilitator responsibilities](https://docs.x402.org/core-concepts/facilitator).

Our proposed fee amortization is straightforward accounting rather than a new consensus result. With fixed opening and closing fees totaling `F`, `n` paid calls and per-call resource price `p`, average user cost is `p + F/n`, excluding any separately disclosed service charges. It falls only when more calls share the fixed cost. Servers still incur signature verification, bandwidth, storage and availability costs. Signatures and persisted records do not disappear merely because the per-call coin fee is zero.

## Acknowledgment is not consensus finality

Solana RPC distinguishes `processed`, `confirmed` and `finalized` commitment. Its current documentation defines confirmed blocks through a supermajority of stake and finalized blocks through maximum lockout. Reporting a fast processed response as finalized would erase that distinction. CINDER's single-operator response has its own trust model and is not interchangeable with any of these states. [Solana commitment definitions](https://solana.com/docs/rpc#configuring-state-commitment).

OP Mainnet likewise distinguishes sequencer preconfirmation, L2 inclusion and the later point at which published data is protected by Ethereum finality. The withdrawal challenge period is another concept; it should not be used as a blanket transaction-finality time. CINDER should compare like-for-like confirmation states and measured workloads, rather than promising to outperform a network by timing only its own HTTP acknowledgment. [OP Mainnet transaction finality](https://docs.optimism.io/op-mainnet/network-information/transaction-finality).

For the hosted devnet, durable storage protects recovery while the operator controls ordering and execution. Cloudflare alarms provide retryable scheduling, but alarm execution is not an exact economic deadline; deadline checks belong inside settlement. The documented alarm retries are bounded, so application recovery must also tolerate interruption and authenticated retries. These are liveness details, not substitutes for validator consensus. [Durable Object alarms](https://developers.cloudflare.com/durable-objects/api/alarms/).

## What makes the present product useful

The defensible promise is specific: a creator publishes a file with immutable pricing and splits; a listener authorizes a bounded native payment; every atom goes to the specified accounts; the listener receives access and a receipt. A compute agent similarly buys a bounded resource call. Repeated identifiers cannot silently charge twice. This is a measurable application outcome.

Music activity records are paid-access events. Bots can pay, publishers can self-fund activity, recipients can share files, and keys can belong to agents. Those events are not human-listen proofs, reputation scores or grounds for minting extra supply. Rights declarations remain self-assertions. Public marketing should show actual available features, documented limits and tests; adoption and traffic should be reported only from real observations.

A suitable public sentence is: **“CINDER pays for agent work and creator access, with exact splits, spending limits and post-quantum transaction signatures.”** The adjacent status must say **“single-operator native devnet; test coins have no redemption or claimed market value.”** Sustainable fees, permissionless validators, audited key custody, interoperable payment adapters and model-execution proofs each require their own implementation and evidence.
