# Cinder Rail

**Give machines a budget. Get a receipt for the work.**

Cinder Rail is an experimental, runnable machine-to-machine compute service. A client receives an HTTP 402 quote, checks its spending limit, signs with an ephemeral P-256 agent key, executes a bounded computation, and verifies the provider's signed receipt independently.

The current application supports deterministic SHA-256 computation and short Meta Llama responses through Cloudflare Workers AI. It uses no OpenAI inference service, GPT Sites, speculative token or customer funds.

> **Public sandbox.** Credits are nontransferable, nonredeemable test units. This release implements `cinder-sandbox-v1`, not x402 wire compatibility. A signed receipt establishes issuer provenance and content integrity; it does not establish LLM execution correctness. Solidity contracts are separately tested reference implementations, not audited or deployed financial infrastructure.

## Try it

Open the [live console](https://cinder-rail.ee777db.workers.dev), choose a service, inspect the spending limit and run it. Export a receipt to check outside the browser. No wallet or login is required. Agent signing keys are held in browser memory only.

A programmable client is included:

```sh
CINDER_URL=https://cinder-rail.ee777db.workers.dev node scripts/agent.mjs \
  --service hash --input 'Machines need budgets.' --budget 10 --out receipt.json
node scripts/verify-receipt.mjs receipt.json
```

For inference, use `--service inference --budget 500`. Prices and balances above are test micro-units, not actual charges. To establish issuer trust, download `/api/key` separately and pass the saved key JSON as the verifier's second argument.

## Run locally

Requires Node.js 22.18+ and npm. Dependencies are locked in `package-lock.json`.

```sh
npm ci
npm run dev
```

Open `http://localhost:8787`. Hash compute works locally. Workers AI requires an authenticated Cloudflare account; provider failures return reserved test credits.

```sh
npm test
npm run check
npm run test:contracts
npm run test:e2e
npm run build
```

The HTTP tests expect the local service on port 8787, or `CINDER_URL` pointing at another environment. Live AI testing is explicitly enabled with `CINDER_TEST_AI=1` and consumes bounded provider resources. Contract tests run entirely on an in-process local EVM with mock ERC-20 tokens.

## Deploy on your Cloudflare account

```sh
npx wrangler login
npm run deploy
```

This creates one Worker, two SQLite-backed Durable Object classes and a Workers AI binding. It uses the account's existing plan. No domain purchase or plan upgrade is required. Global defaults limit inference attempts to 200/day, total compute attempts to 5,000/day, sessions to 500/day, and session creation to 10/day per daily salted IP hash. Limits are in `wrangler.jsonc`; they are application bounds, not an account-wide billing guarantee.

The issuer signing key is generated once inside the provider Durable Object and stored in its private storage. No private key is checked into this repository. Preserve that object's storage to preserve issuer identity. Record the public key after deployment.

## What's here

- `src/`: quote validation, P-256 authorization, session ledger, idempotent responses, provider execution and receipt signing.
- `public/`: responsive console, protocol/developer pages, API discovery, downloadable receipts.
- `contracts/`: agent registry, EIP-712 cumulative ERC-20 channel, provenance receipt registry, explicit trust constraints.
- `scripts/`: autonomous caller, offline verifier, HTTP smoke tests, Solidity compile/adversarial tests, documentation build.
- `docs/`: [architecture](docs/architecture.md), [economics](docs/economics.md), [verification](docs/verification.md), [security](docs/security.md), [launch](docs/launch.md), [roadmap](docs/roadmap.md), [中文决策说明](docs/founder-memo-zh.md).

## Operating boundaries

One operator hosts the sandbox. There is no distributed consensus, live USDC settlement, customer custody, zero-knowledge inference proof, hardware attestation, reserve backing or open provider marketplace in this release. Standard x402 adapters and audited funded channels are production milestones, not current capabilities. Provider choice is fixed; no arbitrary remote URLs are fetched. Sessions, outputs and receipts expire after 24 hours. A separate private session token authorizes quotes and ledger reads; it is never exported with receipts. Interrupted pending requests have a two-minute recovery lease; an interrupted external inference is never automatically re-executed.

Public quotas may be exhausted by other visitors. These controls bound ordinary use and costs; they are not a Sybil-resistant identity system. See [security](docs/security.md) and the application's `/privacy` page.

## Contributing

Use a GitHub issue for reproducible non-sensitive bugs and provider-integration proposals. Never publish keys, session IDs, private prompts or exploit details affecting a live deployment. For a financial deployment, arrange an independent security audit and operational/legal review before accepting funds. See [CONTRIBUTING.md](CONTRIBUTING.md).

MIT licensed. Model services have their own applicable provider/model terms.

An optional GitHub Actions configuration is included at `docs/ci.example.yml`. It is supplied as a template because the publishing credential does not include GitHub workflow permissions. All release checks were run directly.
