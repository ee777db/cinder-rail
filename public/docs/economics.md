# Economics: useful work with a bounded price

Version 0.1 · 5 September 2026

The economic choice is **no new token**. Users need to buy a defined service at a known price. A freely traded native asset adds an exchange-rate variable without making the service more accurate, cheaper or easier to verify.

## Units and live sandbox prices

The deployment uses `sandbox-microUSD`, an integer display unit with no financial value. One million of these units are displayed as one test dollar. This is a formatting convention, not a dollar peg, reserve, redemption promise, transferable asset or future token allocation.

| Service | Test units per accepted request | Display equivalent | Work limit |
| --- | ---: | ---: | --- |
| SHA-256 text digest | 10 | $0.000010 test value | 4,000 JavaScript string characters |
| Llama short inference | 500 | $0.000500 test value | 1,200 input string characters; at most 192 generated tokens |

A session starts with 10,000 test units. The operator bears actual hosting and inference costs subject to configured quotas. Free sandbox usage does not establish commercial willingness to pay. Test balances are neither company revenue nor total value locked.

## Price the service, not an abstract FLOP

A FLOP is an operation count. It does not normalize memory bandwidth, numeric precision, batching, availability, model quality, context length, data rights or latency. Two providers can report the same operation count and deliver different useful results. A protocol cannot create universal resource fungibility by naming a credit after compute.

For a real service `s`, publish a versioned resource definition:

`s = (model or function version, input constraints, output cap, execution settings, evidence class, service terms)`

Publish a quote in a settlement unit for that service. For variable use, an appropriate formula is:

`price = fixed_fee + input_tokens × input_rate + output_tokens × output_rate + proof_fee`

The request must also set a maximum total charge and output limit. Use exact integer units with documented rounding; never allow a floating-point rounding error to authorize an overspend. A fixed quote is suitable for the initial bounded demo; a production metered invoice requires trustworthy metering and evidence for the reported counts.

Quoted stability is temporal: a provider honors the quote until expiry. It is not a promise that every future quote costs the same or that hardware economics never change. For a funded release, USDC reduces exposure to volatile native-token prices, but issuer, market, redemption and blocklisting risks remain. Circle's terms explicitly allow secondary-market prices to differ from one dollar and constrain direct redemption eligibility. [USDC terms](https://www.circle.com/legal/usdc-terms).

## Positive contribution margin

Let:

- `p` be revenue per completed request;
- `c_compute`, `c_verify`, `c_storage`, `c_network` be direct service costs;
- `c_support` be attributable support and dispute costs;
- `L` be expected fraud, failure and refund loss;
- `F` be total channel open/claim/close cost over `N` successful requests.

Then:

`contribution = p − c_compute − c_verify − c_storage − c_network − c_support − L − F/N`

Sub-cent billing works only when this is positive at actual traffic and failure rates. A smaller billing unit cannot rescue an expensive operation. Quote expiry and price updates must respond to costs; margin should not rely on selling a speculative treasury.

As a dated illustration, Cloudflare lists Llama 3.1 8B FP8 Fast at $0.045 per million input tokens and $0.384 per million output tokens. A hypothetical 1,000-input-token, 192-output-token request costs about `$0.000118728` for inference alone. The calculation excludes Worker execution, storage, requests, support and all verification costs. It is neither this sandbox's measured token use nor a profit claim. Cloudflare's free allocation is a launch allowance, not a permanent business model. [Workers AI pricing, checked 5 September 2026](https://developers.cloudflare.com/workers-ai/platform/pricing/).

## How batching changes the arithmetic

Suppose a channel's aggregate blockchain cost is `F = $0.05`, purely an illustrative assumption. At `N = 1`, the settlement cost is five cents per request. At `N = 10,000`, it is `$0.000005` per request. Given a settlement budget `b` per request, choose:

`N ≥ ceil(F / b)`

This amortizes settlement overhead. It does not eliminate signature checks, database writes, liquidity costs, disputes or fees charged per off-chain request. Fewer calls or early closure raise the realized cost. Chain fees change; the production system must measure `F` and choose batching thresholds dynamically.

The current CDP x402 facilitator documentation lists a 1,000-transaction monthly free tier and $0.001 per transaction afterward. At that tariff, a service priced below $0.001 cannot sustainably settle each request through that paid tier even before compute costs. Channels, aggregated billing, a differently priced facilitator, or larger purchases are necessary. This is a conclusion from the published tariff, not an assertion that x402 universally charges that fee. [CDP x402 pricing overview](https://docs.cdp.coinbase.com/x402/welcome).

Probabilistic tickets can also amortize payments, but the expected payment hides variance. If a ticket wins with probability `q` and pays `w`, expected spend is `qw`; provider income over `n` independent tickets has variance `nq(1−q)w²`. Small providers need enough capital to survive that variance, and ticket randomness and replay need their own secure design. Cinder chooses cumulative balances for clearer accounting.

## Provider incentives and market structure

The first incentive is revenue for fulfilled orders. A competitive provider should publish a service definition, quote, availability, evidence class and measured latency. Buyers can choose a cheaper signed-receipt service or pay a premium for independently verified execution. Evidence tiers should be priced explicitly because they have different costs.

The funded design should allow buyers to export receipts, choose another provider and close channels without asking Cinder for permission. Provider concentration is measured by actual order share and operational independence; multiple names pointing at the same GPU host do not demonstrate decentralization.

A stake or bond is useful only when someone can adjudicate a defined fault and enforce a penalty. A large locked balance is not proof of compute correctness. Avoid rewarding raw request count, wash traffic, reported FLOPs, token velocity or attention: each invites activity that is cheap to manufacture and unrelated to customer value.

Initial commercial hypotheses are a paid managed gateway and an explicit service fee on fulfilled purchases. No pricing has been validated with customers, and no commercial revenue is claimed. The early target is a developer who needs a bounded agent budget and an exportable audit record for a paid API call. Validate repeat useful transactions before expanding the network.

## When a token would deserve reconsideration

Only consider a new asset after identifying a necessary protocol function that existing stablecoins, ordinary fees and enforceable collateral cannot satisfy. Specify the attack being priced, the mechanism enforcing it, the source of sustainable demand and the effect on users' bills. Publish a model and have it independently challenged before issuance. Governance branding, attention, demurrage or burn narratives alone do not establish a functional need.

