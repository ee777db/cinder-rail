# Launch kit

Version 0.1 · 5 September 2026

These assets describe the 0.1 sandbox. A public launch announcement should link to a successfully smoke-tested deployment and the public source repository. Do not substitute an unverified URL or claim that funds or proof systems are live.

## Positioning

**Name:** Cinder Rail

**Short description:** A transparent sandbox for agents to authorize compute and verify signed receipts.

**Product sentence:** Quote the work. Bound the spend. Keep the receipt.

**First audience:** Developers building paid API services or software agents that need inspectable purchase authorization and a portable result record.

**What to demonstrate:** A browser-generated signing key, a sub-cent test quote, a completed SHA-256 or Meta Llama request, a debited test balance, and an issuer signature the client can verify.

## Release article

### Cinder Rail: make a machine purchase inspectable

An agent calling a paid API needs a few things to be explicit: the requested work, the maximum price, the authority to spend, and the evidence that comes back.

Cinder Rail brings those steps into a small working sandbox. Create an agent session, choose a deterministic digest or a short Meta Llama request, and inspect the quote before the client signs it. The service checks the authorization, performs the work, updates the test balance and returns a signed receipt binding the charge to the input and output digests.

The receipt is portable. Its signature can be checked with the issuer's public key, and changing its contents breaks verification. The digest service can also be recomputed independently. The Llama receipt records what the provider says it executed; it does not pretend to be a zero-knowledge proof of model execution.

The initial rail runs on Cloudflare Workers and Durable Objects, with Meta Llama on Workers AI. It uses nonredeemable test credits, no speculative token and no live customer deposits. Its custom HTTP 402 flow is documented as a sandbox protocol. A funded release is designed around existing USDC settlement and canonical x402, with cumulative channels where repeated purchases make their overhead worthwhile.

The distinction matters. A signature proves who made a statement. A compute proof establishes a specified execution relation. A ledger acknowledgment and a blockchain's finality are different events. Cinder exposes those boundaries so developers can see exactly which assurance they are buying.

This release includes the product, source, protocol documentation, reference contract interfaces and a path to a capped testnet integration. There are no claimed customers, invented transaction totals or promises of guaranteed returns. The invitation is practical: complete one request, inspect its authorization and verify its receipt.

The long-term opportunity is reliable machine commerce. The first useful unit is one well-defined purchase.

## Short announcement

Cinder Rail is a sandbox for machine purchases: bounded compute quotes, agent-signed authorizations, and verifiable issuer receipts. Try SHA-256 or Meta Llama, inspect the charge, and export the evidence. Test credits only. Source and the exact trust model are available with the release.

## Chinese announcement

Cinder Rail 做的是让机器之间的一笔购买讲得清楚：先报价，Agent 在额度内签名授权，服务执行，再返回绑定输入、输出和费用的签名收据。首版可体验 SHA-256 和 Meta Llama，使用无货币价值的测试额度。收据能验证签名与内容完整性；不会把它包装成已经实现的零知识推理证明。代码、协议和真实边界一起公开。

## Existing work and honest differentiation

x402 already supplies a stablecoin payment-over-HTTP protocol. Its current extensions include discovery, idempotency identifiers and signed offer/receipt support. Cinder should integrate that work, not claim to have invented agent payments or signed commercial receipts. [x402 FAQ](https://docs.cdp.coinbase.com/x402/support/faq).

a402 publicly positions itself around agent identity/reputation checks, payment policies and Arc settlement. That is the vendor's positioning; its marketing page alone is not independent evidence of adoption or every capability's production readiness. [a402 product site](https://a402.finance/).

Cinder's present differentiator is a small, inspectable learning and integration surface linking a bounded authorization to a compute result, with explicit evidence semantics. This is a product focus to test with users, not a defensible claim that no competing system can do the same thing. Winning requires reliable implementation and useful integrations.

## Distribution checklist

| Channel | Concrete artifact | Completion evidence |
| --- | --- | --- |
| Public product | Working landing page, demo, trust boundary and source link | Public URL and successful live purchase smoke test |
| Source repository | Readme, license, contract warnings, setup, protocol and tests | Public repository URL and downloadable revision |
| Search discovery | Descriptive title, metadata, canonical URL, sitemap, robots and social image | Assets served at the actual deployed origin |
| Agent discovery | Accurate machine-readable catalog and developer documentation | Fetchable schema and sample request that works |
| Release announcement | The article above attached to the public project release | Published release URL, if publication succeeds |
| Communities | One relevant technical post with a runnable example and clear sandbox label | Actual post URL; drafts do not count as distribution |
| x402 discovery | Only after a conformant paid/testnet route is implemented and validated | Accepted discovery entry with working payment path |

Publish only through accounts the operator can actually access. Do not impersonate an unaffiliated developer, manufacture endorsements, buy fake activity, or treat preparing this copy as proof it was broadcast. A public repository and discoverable site are an initial distribution surface; search engines may take time to index them and indexing is not guaranteed.

## Where the founder is the natural choice

Engineering and publishing can be handled by an authorized operator. The founder contributes most when using an existing relationship to secure a real paid-API design partner, taking legal responsibility for the operating business, or authorizing a defined budget and financial exposure. These are concrete human advantages, not a request to manually wire every deployment setting.

