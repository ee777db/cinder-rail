# Privacy and data retention

Version 0.2 · 5 October 2026

CINDER's native testnet is a public accounting system. Wallet addresses are pseudonyms, not anonymity. Transfers, creator payments, market actions and signed computation records can link activity across applications. Use sample inputs and audio you have the right to publish; do not enter passwords, private prompts, personal records or other secrets.

## Native network: public, retained records

The native service stores account public keys and addresses, balances, nonces, faucet status, signed transactions, timestamps, monetary postings, results and operator-signed checkpoints. These are readable through public native APIs. The ledger is hash-linked and replayable, but one operator controls its storage and availability. Public history is not a guarantee of permanent independent archiving.

Native records have **no automatic 24-hour deletion policy**. They are retained for the life of the current testnet storage unless the operator resets or removes it. There is no user endpoint that erases a transaction. Anyone can copy public records, so later deletion by the operator would not delete those copies.

Compute input text is processed for validation and execution. The implementation persists input hashes rather than raw inputs in native transactions and channel journals. Hashing is not encryption: short or predictable inputs can be guessed. Completed ordinary compute outputs are public in settlement receipts and job endpoints; they may reproduce input text. Channel journals expose signed input commitments, deterministic hash outputs, their hashes and timing.

For inference, raw input is sent to the configured Meta Llama service through Cloudflare Workers AI. Cloudflare's handling of inputs, network metadata and infrastructure records is an additional provider boundary. CINDER does not promise that upstream logs or backups are erased when local application records change. No OpenAI inference endpoint is used by this application.

## Music

Published titles, artist labels, owner and recipient addresses, split percentages, content hashes, prices and publication/payment timestamps are public. The audio itself is stored in the operator's Durable Object storage and delivered after paid access authorization. It is not stored as raw audio in the public accounting journal.

Uploaded audio, including incomplete uploads, has no scheduled deletion in this release. Unpublishing stops new purchases and removes the track from the active catalog; it does not erase old metadata, payments or stored audio. Previously paid access remains usable until its original expiry. Upload and storage limits bound the development service.

Playback access lasts one hour from payment. Tokens and private token-recovery records are stored privately by the operator; expiry invalidates access but does not immediately delete those records. Public receipts and transaction replay responses never disclose tokens. A fresh payer signature is needed to recover a token. The playback URL contains that bearer token, so treat the complete URL as a secret and do not send it to analytics or publish it. A recipient of the audio can retain or redistribute downloaded bytes; this is not DRM.

The signed purchase records a paid access window. It does not prove a human listened, how long they listened or who they are. The current player does not produce a verified audience profile or sell an advertising identity.

## Wallet data

The web wallet's private key remains in browser memory. It is not sent to the server and is not automatically written to local storage. Reloading or closing the page loses an unbacked wallet. The optional encrypted wallet file is produced locally using the password you enter; restoring decrypts it locally. The application does not receive or keep a password-reset copy. Preserve the encrypted file and password separately if continued access matters.

Private keys, passwords, session signing keys and playback tokens should not appear in screenshots, public bug reports, repository commits or receipts shared with other people. An encrypted backup can still be attacked offline if its password is weak. A compromised browser or deployed page can access an active wallet despite encrypted backups.

The public explorer remembers the first observed public genesis hash and operator public key in browser local storage so it can flag a later identity change. This record contains public network identity, not a wallet key or account balance. First-use pinning cannot establish that the first identity seen was independently trustworthy; clearing browser site data removes the remembered pin.

## Connection information and quotas

Cloudflare necessarily handles normal request information, including network addresses, request paths and timing. The native application stores a daily randomly salted hash derived from the connection IP for quotas, rather than a permanent plaintext-IP identity. On the first request of a new UTC day, the current quota record is replaced with a new day and salt. This is request-triggered replacement, not an exact midnight deletion guarantee or a statement about infrastructure backups.

There is no third-party advertising or analytics SDK in the native interface. Cloudflare observability is disabled in the repository configuration. Those choices do not mean the hosting provider processes no operational metadata, nor that a future deployment cannot change its configuration. Requests to an external integration or a copied playback URL are subject to that recipient's data handling.

## Legacy `/compute` sandbox

The older standalone compute sandbox is a different protocol. It uses expiring sessions, a private session capability and P-256 agent signatures. That service retains quote metadata, outputs and receipts for session retries, and schedules deletion of session storage after its 24-hour lifetime. It also checks expiry on subsequent access. This deletion policy applies only to legacy sandbox session data, not native CINDER records, media, channels, wallets or the operator's keys.

Legacy deletion is an application policy, not a promise about every hosting backup or upstream inference record. Legacy receipt exports can themselves contain sensitive output text. Keep the `X-Cinder-Session` capability private; it is not included in exported receipts.

## Questions and corrections

For non-sensitive issues, use [the source repository](https://github.com/ee777db/cinder-rail/issues). Do not put private keys, paid-access URLs or personal data in a public issue. This document describes the implementation in the 0.2 source; it does not assert a completed legal compliance program, a human identity service or an independently audited privacy guarantee.
