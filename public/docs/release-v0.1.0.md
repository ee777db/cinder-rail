# Cinder Rail v0.1.0 — a working loop for machine compute

[Open the live console](https://cinder-rail.ee777db.workers.dev) · [Read the protocol](https://cinder-rail.ee777db.workers.dev/protocol) · [Integrate an agent](https://cinder-rail.ee777db.workers.dev/developers)

An agent gets a fixed quote, checks its spending cap, signs the request, buys a bounded computation with test credits, and independently verifies the provider's receipt. Try deterministic SHA-256 or a short Meta Llama response on Cloudflare Workers AI.

This public alpha ships a browser console, programmable API, autonomous command-line client, offline receipt verifier, technical/economic specification, and three tested Solidity reference components. No wallet or signup is required. No OpenAI inference service or GPT Sites is used.

**The trust boundary is explicit.** Credits have no monetary value. This is a custom HTTP 402 sandbox, not an x402-compatible payment gateway. Provider signatures attest to provenance and integrity, not correct LLM execution. Contracts are unaudited, undeployed reference implementations; the application accepts no deposits or real payments.

Validation includes four protocol tests, eight local-EVM contract tests, thirteen live API checks including actual Meta Llama inference, and a separate local test through the real two-minute authorization expiry. A second live inference was independently verified by the shipped command-line client and offline verifier against a separately fetched issuer key.

[Download a real signed inference receipt](https://cinder-rail.ee777db.workers.dev/examples/live-inference-receipt.json) and [the pinned issuer public key](https://cinder-rail.ee777db.workers.dev/examples/issuer-key.json). Reproduce the verification with `scripts/verify-receipt.mjs` from the source archive.

We are looking for concrete integration feedback: an API or compute provider with repeated small requests, a clear unit price, and an existing customer workflow. [Open a non-sensitive integration issue](https://github.com/ee777db/cinder-rail/issues). Do not include secrets, session tokens, private prompts or security exploits.

中文：Cinder Rail 已开放体验。机器先检查预算，再签署调用授权，执行后取得可独立验证的收据。当前使用无价值测试额度，真实调用 Meta Llama；不发行代币，也不把签名收据当作零知识计算证明。欢迎带着真实 API 使用场景来验证它是否有用。
