# Cinder Rail contract references

**Local reference implementation. Undeployed, unaudited, and unsuitable for real funds.** The public Cinder Rail application does not deploy these contracts, hold tokens, or settle cryptocurrency. These contracts are a separately tested design artifact for a future payment rail.

## Included

- `AgentRegistry.sol`: self-registered endpoints and capability hashes; owner-only updates; expiring, revocable session keys; permanent agent revocation. Registration establishes control of an address, not personhood, trustworthiness, endpoint availability, or legal identity.
- `MicropaymentChannel.sol`: one immutable ERC20, funded unidirectional payer-to-provider channels, EIP-712 cumulative vouchers, provider-only settlement, and a payer refund after a fixed expiry. Only externally owned payer signatures are supported. Registry session keys and contract wallets are **not** authorized to spend channel balances.
- `ComputeReceiptRegistry.sol`: provider-signed request/output/model commitments. The historical `IComputeVerification` name is retained for the requested interface, but the implementation verifies only the signature. No ZK proof, TEE attestation, model execution, output correctness, or external timestamp claim is verified.
- `interfaces/`: the requested `IAgentRegistry`, `IMicropaymentChannel`, and `IComputeVerification` interfaces.
- `test/MockToken.sol`: unrestricted local test tokens. They are not a currency or production token implementation.

## Settlement semantics

Amounts are integer smallest units of the configured ERC20. With a six-decimal test asset, `1,000` units represent `0.001` of that asset; the contracts do not establish a dollar peg or guarantee a stablecoin's redemption value.

For deposit `D`, prior settled amount `S`, and an authenticated cumulative voucher `C`, a settlement requires `S <= C <= D` and transfers `C - S`. Replaying the same cumulative voucher transfers zero. Lower cumulative amounts revert. The signature covers the channel ID, provider, cumulative amount, receipt commitment, and voucher deadline; the EIP-712 domain additionally binds the chain ID and contract address. Every opening consumes a payer nonce, so a new channel cannot inherit an old voucher.

A channel has a fixed expiry, at most 30 days after opening. The provider can settle only before the channel expiry and while the voucher's deadline is still valid. At or after expiry the payer can reclaim exactly `D - S`, once. The provider must monitor deadlines and settle sufficiently early to account for congestion and reorganizations. There is no post-expiry challenge window. A payer's new voucher does not cancel an older unexpired voucher; the provider can settle any still-valid signed cumulative amount within the deposit.

The per-request operation is off-chain signing, not an on-chain transaction. Opening, batched settlement, and refund require transactions and gas. Effective gas cost per request is `total channel transaction cost / requests batched`; there is no promised fee floor, latency, or chain finality. A provider can accept a signed voucher as a credit exposure before final on-chain settlement, with the attendant chain, token, deadline, and key risks.

The signed `receiptRoot` is a commitment only. The contract neither checks individual receipts against it nor checks that the payer received useful work. Receipt and channel registries are independent; a receipt's claimed channel and cumulative amount are not cross-validated by the receipt registry.

## Disputes and trust

Either named receipt party may record a dispute evidence hash once. An immutable, explicitly trusted resolver may then record one resolution hash. These are declarations in events. They have no authority to transfer funds, alter channels, slash stake, determine inference correctness, or provide decentralized arbitration. Evidence availability and adjudication happen outside these contracts. The resolver can fail or act dishonestly.

These references use OpenZeppelin ECDSA, EIP712, SafeERC20, and ReentrancyGuard. Inbound deposits must increase the contract's token balance by exactly the deposit, which rejects the included fee-on-transfer test token. Only a known standard, non-rebasing, non-fee ERC20 is supported. SafeERC20 cannot make an arbitrary malicious or upgradeable token trustworthy. Stablecoin freezes, issuer control, depegs, token upgrades, and key compromise remain external risks. There are no upgrade, operator withdrawal, administrative rescue, or emergency pause functions.

## Run the local checks

From the repository root, after `npm install`:

```sh
node scripts/test-contracts.mjs
```

The test suite compiles all Solidity with `solc`, deploys into an isolated Ganache chain with chain ID `31337`, and exercises cumulative deltas, duplicate/reordered vouchers, signature tampering, chain/deployment/channel isolation, recipient permissions, deposit bounds, exact expiry/refunds, token callbacks, nonstandard deposits, agent session expiry/revocation, receipt forgery/replay, and resolver permissions. No RPC key, funded wallet, external chain, or deployment is used. Tests are evidence of these specific behaviors, not an audit or proof of comprehensive security.

The compiler targets Shanghai for this local EVM suite. Review compiler/library versions, the target chain, stablecoin behavior, economic assumptions, wallet compatibility, dispute policy, threat models, fuzz/invariant testing, and independent audits before any real deployment.

Primary implementation references: [EIP-712 typed structured data](https://eips.ethereum.org/EIPS/eip-712), [OpenZeppelin cryptography and utilities](https://docs.openzeppelin.com/contracts/5.x/utilities), [OpenZeppelin ERC20 API](https://docs.openzeppelin.com/contracts/5.x/api/token/ERC20).
