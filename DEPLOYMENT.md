# Cinder Rail release record

- Live application: https://cinder-rail.ee777db.workers.dev
- Source: https://github.com/ee777db/cinder-rail
- Release: https://github.com/ee777db/cinder-rail/releases/tag/v0.1.0 (public alpha)
- Deployed: 2026-09-05 UTC
- Cloudflare Worker version: `17aad063-259a-4722-a7d9-97f92dc55507`
- Runtime: Cloudflare Workers, SQLite-backed Durable Objects, Workers AI
- Model: `@cf/meta/llama-3.1-8b-instruct-fp8-fast`

## Verified evidence

1. Four protocol tests passed: canonicalization, SHA-256 test vector, P-256 signature/tamper handling, service/input constraints.
2. Eight Solidity tests compiled and passed on a local EVM with mock assets.
3. Thirteen local HTTP checks passed, including the full two-minute authorization expiry.
4. Thirteen public HTTP checks passed, including one real Meta Llama call and independent receipt verification. A separate live request passed the shipped command-line agent and offline verifier against an independently fetched issuer key.
5. Seventeen public page, asset, JSON discovery and missing-page checks passed after correcting static route handling.
6. Desktop and 390px mobile console were visually inspected locally; hash purchase, spending-cap refusal, provider failure/refund and documentation navigation were exercised. The in-app browser blocked the workers.dev origin, so public visual inspection was not claimed. Public endpoints and assets were verified with an independent HTTP client.

## Reproduce

```sh
npm ci
npm test
npm run check
npm run test:contracts
CINDER_URL=https://cinder-rail.ee777db.workers.dev npm run test:public
CINDER_URL=https://cinder-rail.ee777db.workers.dev npm run test:e2e
node scripts/verify-receipt.mjs public/examples/live-inference-receipt.json docs/issuer-key.json
```

Public tests consume the shared bounded sandbox allowance. Set `CINDER_TEST_AI=1` only to exercise actual provider inference. Normal HTTP tests use SHA-256 only.

## Published scope

Public compute sandbox, source code, protocol/economics/security documentation, agent client, receipt verifier and signed sample. Real-money settlement and Solidity contracts are not deployed; no token, customer deposit, ZK inference proof or TEE attestation is offered. Publication is not evidence of paying customers or adoption.

No private key, session token or account credential is included in the published source or example receipt. The issuer key JSON is public and pins this deployment's signer. Service quotas are application limits rather than an account-wide billing cap.

## Distribution completed

Public GitHub repository, public alpha release announcement in English and Chinese, attached signed inference evidence, live homepage linked from the repository, accurate discovery topics, website launch page, sitemap, robots file and machine-readable service discovery are published. No direct messages, paid ads or claimed customer acquisition were part of this release.
