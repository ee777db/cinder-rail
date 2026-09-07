# Native CINDER application adapters

These adapters build explicit native devnet authorizations. They do not rewrite another application's balances or access its credentials. `sdk/native-client.ts` provides key generation, registration, local spending limits, atomic transfers/splits, compute reservations, and independent ML-DSA checkpoint verification.

## HEARD

The inspected HEARD project is a React/Vite + Fastify/PostgreSQL music product. Its public Worker currently publishes recruiting content. Local APIs include listen receipts, finalized settlement batches, and a separate double-entry ledger. `heard.ts` converts an explicitly closed settlement commitment into a CINDER devnet split authorization. The publisher must provide native recipient addresses and amount/percentage policy; the listener/player does not infer artist ownership. No fiat liability, subscription status or payout status is modified. Hashing a recorded play does not prove a human listened.

## Agents

Use `CinderNativeClient.compute` to authorize an input hash with a native spending cap, fund a transaction-specific escrow and receive a signed compute result. Agents can maintain separate devnet keys and accounts; existing Ed25519 identities or USDC-denominated app balances are not automatically converted. Save the exact signed envelope before submission, retry that envelope on delivery uncertainty, and reconcile the receipt before choosing the next nonce.

## Trading interfaces

`trade.ts` builds a native fee-allocation authorization. It does not execute brokerage orders, match trades, custody collateral, calculate margin, liquidate accounts or guarantee settlement of another asset. The inspected KITE/North applications focus on market data and the separate trader project has broker-specific paper/live gates. An exchange remains a distinct service; its risk engine and collateral policy cannot be replaced by a coin.

## Browser use

The hosted `/native-sdk.js` exports `CinderNativeClient` as an ES module and contains the PQ implementation. Cross-origin native API requests use public CORS without cookies; every mutation requires a scoped ML-DSA authorization. Generate keys on the client, never send secret keys to the API, and pin an independently obtained operator public key for stronger bootstrap trust. The browser runtime and hosting administrator remain part of the threat model.

The asset ID is `cinder-devnet-1/native`, with six decimal places. It is a native development asset with no redemption or market-price commitment. Mainnet issuance, governance, decentralized validator admission and monetary policy remain undecided.
