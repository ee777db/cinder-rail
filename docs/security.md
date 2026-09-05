# Security model and operational boundaries

Version 0.1 · 5 September 2026

Cinder Rail 0.1 is a public sandbox. Its nonredeemable credits isolate the demo from customer funds while exposing the actual authorization and receipt mechanics. The code and contracts have not received an independent security audit. Reference contracts are not an invitation to deposit assets.

## Assets, actors and trust

The sandbox protects the integrity of per-session authorizations, spending totals and receipts, plus the operator's finite compute allowance. Its adversaries include callers with malformed requests, stolen session capabilities, replayed signatures, competing concurrent requests, and clients attempting to exhaust free resources.

The operator controls deployment, accounting and the issuer private key. Cloudflare operates the hosting, durable storage and inference infrastructure. A valid operator signature does not protect a client against an operator willing to lie about execution. A browser compromise can use any key accessible to the page; an export restriction does not stop malicious code from invoking the key.

## Implemented application controls

The service validates supported P-256 public keys and rejects submitted private-key material. A quote binds a random identifier and nonce, session, service, input hash, fixed charge, cumulative spend and expiry. A caller must sign the server's canonical quote. Input substitution, signature mismatch, expired authorizations and stale cumulative totals are rejected.

The session ledger reserves credits before compute and records a completed result before successful delivery. Repeating a successfully completed signed request returns the existing result rather than charging again. Detected compute failures restore the reservation. One active operation per session bounds concurrency and simplifies accounting. A reservation that remains pending for two minutes is recovered through an alarm or subsequent request: its test charge is refunded and its quote cannot run again. An upstream service might still have executed; this is not exactly-once execution across an arbitrary provider.

The gateway bounds JSON request bodies, input sizes and output length, checks browser origins on writes, and sends restrictive security headers. It does not fetch arbitrary user-supplied URLs. Operator-configured daily session, request, compute and inference limits bound intended sandbox activity. Per-IP request controls also apply to session reads and limit one caller's ability to exhaust the shared allowance. IP-based controls are an abuse signal, not personhood. Limits may reject legitimate users sharing a network or during a traffic spike.

The deployed values in the configuration are the authority for quotas. Quotas limit application calls, not every possible hosting bill; malicious traffic, platform charges and upstream behavior still need observation. Never describe a request quota as a provider-enforced dollar spending cap.

## Data handling

Prompts are sent to the configured compute provider for inference. The application retains quote metadata and input digests, and stores outputs with receipts so a retry can return the original result. Hashing is not encryption: a short or predictable input can sometimes be guessed from its digest.

The public session identifier and the secret session capability are separate. Reading session state or requesting an unsigned quote requires the `X-Cinder-Session` header containing the session token. A receipt can include its session identifier without revealing that token. The token remains sensitive: it can reveal retained session results and permits quote requests, although it cannot sign spending authorizations. Do not export or publish it. Receipt and output contents themselves may still be sensitive, so the demo should be used with nonsensitive sample text.

The session lifetime is 24 hours, with scheduled deletion of session storage. Deletion is an application-level retention policy, not a guarantee about every infrastructure backup or upstream provider log. The rate-limiting control stores a daily salted hash derived from a connection IP, not a global permanent identity. Hosting providers still handle normal connection information.

The issuer private key is stored in the provider control object's storage in this version. Cloudflare access and deployment permissions are therefore part of the key-security boundary. A funded release needs a documented rotation and compromise process, retained historic public keys, restricted signing authority, and an assessed key-management solution. No independent time-stamping or public append-only receipt log exists here.

## Important failure semantics

| Failure | Required interpretation |
| --- | --- |
| Browser loses the response after success | Retry the same signed quote to retrieve its result while the session remains available |
| Compute reports an error | No successful receipt; reservation is refunded by the handled failure path |
| Worker terminates during upstream compute | Execution may have occurred without a delivered result; observe recovery state, never claim universal exactly-once service |
| Public issuer key changes | Verify against a previously trusted key; investigate rotation rather than automatically trusting a new history |
| Provider reports a model name | Treat it as a provider assertion unless independently accepted execution evidence accompanies it |
| Session expires | Test credits and stored results are ephemeral; retain exported evidence when needed |
| Receipt signature verifies | Content is attributable to the pinned signing key; model correctness and answer quality remain separate |

## Requirements before customer funds

1. Independently review contract authorization, cumulative settlement, refund races, timeout behavior and token-transfer handling. Resolve critical and high-severity findings.
2. Demonstrate conservation of funds, no duplicate claims, domain-bound signatures and safe exits through stateful property tests and adversarial integration tests.
3. Prove funded-deposit detection, chain reorganization handling, finality policy, RPC failure behavior and facilitator settlement reconciliation on testnet.
4. Separate provider accounting from the on-chain money path; define liability for paid-but-undelivered work and a bounded refund process.
5. Set capped pilot exposure, signer revocation, operational alerts, recovery procedures and an accountable on-call owner.
6. Define supported jurisdictions, service terms, privacy handling and the legal responsibilities of the chosen business and settlement arrangement with appropriate specialists.

These are release requirements, not claims that a token or payment service becomes lawful or secure by passing a generic checklist. The precise operating model determines the analysis. A centralized ledger with a USDC label is not an audited escrow.

## Reporting

Use the source repository's private vulnerability reporting channel if enabled. Otherwise contact the repository owner privately before publishing exploit details. Public issues are appropriate for non-sensitive documentation or integration bugs. No guaranteed response time, paid bounty or independent audit is represented by this document.
