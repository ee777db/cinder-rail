# Native WORK and spot market interface

`src/native-economy.ts` is a pure atomic transition for the Cinder devnet. It adds a resource asset with real inventory movements and a CINDER/WORK spot pool. It does not call a network, mint CINDER, create an exchange price guarantee, or implement decentralized consensus.

WORK has zero decimals. One unit reserves one operator-provided SHA-384 computation for a well-formed UTF-8 input of 1–4000 JavaScript characters. Initial inventory is exactly **1,000,000 WORK**, created once at economy genesis; no user action mints additional WORK. The operator posts inventory at **100 CINDER atoms per WORK**. This is a capacity promise of the devnet operator, not audited physical capacity, a dollar peg, or redemption for money.

## Integration contract

```ts
economyAccounts(action, sender): string[]
applyEconomy(snapshot, stateOrUndefined, tx, now): {
  accounts, postings, result, state
}
```

Use exactly **one** economy action in a normal signed native transaction. The module validates the native transaction shape, deadline and next nonce, enforces the signed gross `maxDebitAtoms`, debits the **12-atom** base fee, and increments the sender's native nonce. **Do not additionally charge the fee, increment the nonce, or run `applyNativeTransaction`.** The caller still verifies the ML-DSA signature and handles transaction-ID idempotency, serialized execution and persistence.

Load every native account returned by `economyAccounts`. This includes the sender, a WORK-transfer recipient when present, `system:fees`, `system:economy-pool`, and `system:economy-provider`. The last two are ordinary holding accounts initialized with **zero CINDER**, never minted liquidity. Registered native recipients must exist before WORK transfers. Ordinary native transfer APIs must not allow arbitrary deposits into these economy holding accounts, because pool balance must equal recorded pool reserves.

State shape:

```ts
{
  version: 1,
  inventoryWork, burnedWork, walletWorkTotal, walletLpTotal, // integer strings
  walletCount,                                            // bounded number
  pool: { cinderAtoms, workUnits, lpSupply },                // integer strings
  wallets: { [nativeAddress]: { workUnits, lpUnits } }
}
```

**`wallets` is a partial loaded record map.** Persist the global fields without `wallets` under one key; persist each wallet separately, e.g. `economy:wallet:<address>`. Before a transition, load all existing wallet shards for the native addresses returned by `economyAccounts`; omit genuinely new wallets, rather than adding fake zero records. Persist only returned wallet records, preserving all unlisted shards. A zero-balance initialized wallet remains stored and counted. Commit updated native accounts, global economy state, changed wallet records and the signed receipt in **one atomic serialized write**. An error commits nothing. The module never mutates its input snapshots.

Global accounting is `inventoryWork + burnedWork + walletWorkTotal + pool.workUnits = 1,000,000` and `walletLpTotal = pool.lpSupply`. Stored wallet shards are authoritative: aggregate counters cannot independently detect a missing shard supplied by an incorrect caller. `auditEconomy(state, poolNativeBalance, {completeWalletSet:true})` verifies every shard when the complete wallet set is supplied. Ordinary transitions use partial audit plus exact aggregate deltas and native-pool backing checks.

## Exact action fields

All quantities below are canonical decimal integer **strings**. All deadlines are canonical ISO strings live within five minutes. Unknown or missing fields are rejected.

| Action `type` | Other required fields |
| --- | --- |
| `economy.buy` | `workUnits`, `maxCinderAtoms` |
| `economy.transfer` | `to`, `workUnits` |
| `economy.redeem` | `inputHash` (96 lowercase SHA-384 hex characters) |
| `economy.addLiquidity` | `maxCinderAtoms`, `maxWorkUnits`, `minLpUnits`, `deadline` |
| `economy.removeLiquidity` | `lpUnits`, `minCinderAtoms`, `minWorkUnits`, `deadline` |
| `economy.swap` | `assetIn` (`CINDER` or `WORK`), `amountIn`, `minOut`, `deadline` |

The signed gross CINDER debit is 12 plus posted purchase cost, actual CINDER supplied to liquidity, or CINDER swap input. WORK transfer, redemption, LP removal and WORK-input swaps require 12 CINDER already available to pay the fee; future swap or withdrawal proceeds cannot finance that fee. WORK itself is bounded by signed action quantities. Slippage minima are positive integers.

Bounds: 10,000 WORK input per purchase, transfer, liquidity deposit or swap; 100,000 WORK per wallet; 1,000,000,000 CINDER atoms per market/purchase input; 5,000 initialized economy wallets; one pair; no LP transfer, leverage, public mint, borrow or flash-loan action.

**Redemption execution requirement:** the result contains `result.redemption = {service:'hash',inputHash,workUnits:'1',maxInputChars:4000}`. The root must validate the separately supplied input, compute its SHA-384 digest, and produce the actual deterministic output **before atomically persisting** the one-WORK burn and receipt. If input validation or execution fails, discard the transition. Add output/input commitments and completed execution evidence to the signed result. The module alone produces a proposed burn; it does not claim that computation ran. Since this bounded deterministic operation is synchronous, no asynchronous failure-refund mechanism is needed for this action.

## Quotes and pool arithmetic

```ts
quoteWork(workUnits, state?) // {workUnits,cinderAtoms,priceCinderAtoms}
quoteSwap(state, assetIn, amountIn) // {assetIn,assetOut,amountIn,amountOut,swapFeeBps}
quoteAddLiquidity(state, maxCinderAtoms, maxWorkUnits)
// {cinderAtoms,workUnits,lpUnits,unusedCinderAtoms,unusedWorkUnits}
quoteRemoveLiquidity(state, lpUnits) // {lpUnits,cinderAtoms,workUnits}
economyWallet(state, address) // {workUnits,lpUnits}, zero if genuinely absent
economyInfo(state?) // asset,offer,pool,fee/bounds,audit,state(global + empty wallets)
auditEconomy(state?, actualPoolCinderBalance?, {completeWalletSet?})
initialEconomyState() // bounded genesis, never funded pool reserves
```

Read-only quotes neither reserve a price nor establish wallet ownership or available funds. The transition rechecks balances and signed minima. `economyInfo().state` can be passed to quote helpers; it contains global state and an empty partial wallet map. Wallet reads must load the requested wallet shard first.

No pool trade is possible before a user deposits both assets. Initial LP issuance is `floor(sqrt(CINDER × WORK))`. Later LP minting is the minimum of the two proportional floored share amounts. Actual deposits are rounded **up** from minted shares, never above either signed maximum; unused contributions remain in the wallet. Withdrawals return each reserve multiplied by shares and divided by total LP, rounded **down**. A complete LP withdrawal removes every reserve and resets the pool to empty; there is no permanently locked minimum LP. A withdrawal must return at least one unit of both assets. Dust remains with continuing LP holders.

For input `a`, input reserve `x`, output reserve `y`, the swap output is `floor(a × 9970 × y / (x × 10000 + a × 9970))`. The full input enters the pool, so the 30-basis-point trading fee stays with LP holders. The native 12-atom fee is separate. The transition asserts that `x × y` does not decrease across a swap. Prices can move sharply in a small pool; signed `minOut` limits execution, not price discovery or ordering risk.

The arithmetic follows the established constant-product and proportional-share approach documented in the [Uniswap v2 whitepaper](https://docs.uniswap.org/whitepaper.pdf) and [core implementation](https://github.com/Uniswap/v2-core/blob/master/contracts/UniswapV2Pair.sol). This is a separate devnet ledger implementation with different custody, ordering, LP initialization and execution rules, not an audited Uniswap deployment.

Run `node --test tests/native-economy.test.mjs` for pure accounting, partial-shard, rounding and adversarial tests.
