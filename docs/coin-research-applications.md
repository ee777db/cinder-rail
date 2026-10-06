# 应用型代币研究：产品、代币与长期价值分别看

研究核验日：**2026-10-05**。范围：HYPE、LINK、UNI、AAVE、MORPHO、ONDO、ENA、LDO、ETHFI、JUP、PENDLE、TAO、WLD、KAITO、VVV、VIRTUAL、ZRO、PUMP、LIT、XPL。LIT 存在两个不同项目，分别处理。

这份研究回答的是“它究竟提供什么、币在其中做什么、什么条件下能持续”，不提供买卖指令或价格目标。事实以本次可访问的官方文档、项目发布和治理材料为基础；“判断”和“失败条件”是据此作出的分析。访问日期不代表每个页面都在当天更新。提案、路线图、已上线机制与当日链上执行额属于不同证据等级；没有逐笔核验的回购额、用户数和收益率不写成确定事实。

## 1. 先把四个经常混在一起的问题分开

**产品有用，不等于必须持有项目币。协议收到费用，不等于持币者有索取权。币有市场需求，不等于它适合做稳定的计价单位。**

可以用一条链检查任何项目：

`外部用户的真实需求 → 付费服务 → 扣除成本后的可持续收入 → 明确的代币机制 → 持有人实际得到的权利或效用`

每一箭头都可能断。用户可以很喜欢借贷产品，却完全不持有其治理币；协议可以收入很高，却把收入投入运营而非回购；回购币可以留在金库，随后重新支出。必须把这些区别留在账上。

| 机制 | 实际含义 | 不应推导出的结论 |
| --- | --- | --- |
| 原生 gas / 安全质押 | 币参与链的资源定价或经济安全 | 所有终端用户都必须先买币；每次使用都永久减少供应 |
| 产品准入 / 费率等级 | 持有或质押换某项服务权益 | 权益不能调整；服务本身有无限需求 |
| 治理 | 对指定参数、金库或升级有投票权 | 对公司、储备资产、全部营业收入有所有权 |
| 收入换币并销毁 | 特定现金流形成买入和供应移除 | 价格一定上涨；收入和销毁永久不变 |
| 收入换币并入库 | 金库持有更多本币 | 已销毁；持有人有分红请求权 |
| 收入换币并分配 | 合格参与者收到币，规则有条件 | 美元收益固定；收到的币不会再出售 |
| 排放奖励 | 用新增或预留代币补贴参与 | 已产生同额外部营业利润 |
| 资源兑换权 | 按条款向指定供应方领取服务 | 是美元储备；代表所有硬件上相同 FLOPs 或相同质量 |

“代币是否必要”也有两层。工程上，很多产品能用数据库、稳定币或其他币实现；在**现行协议规则下**，原生安全质押、准入门槛和交易对会创造实际需求。前者不自动否定后者，后者也不证明设计不可替代。

## 2. 一张分类地图

表内是快速定位；各项目下方给出机制证据、条件和风险。币名不是安全标识，同名资产必须另外核对网络和官方合约。

| 币与准确身份 | 产品最擅长的工作 | 币在现行设计中的角色 | 最容易误认的地方 |
| --- | --- | --- | --- |
| HYPE / Hyperliquid | 订单簿交易与金融应用执行 | L1 质押安全、HyperEVM gas、费率权益、部分费用换币销毁 | HYPE 不是 HLP 做市份额，也不是交易保证金收益凭证 |
| LINK / Chainlink | 给合约提供外部数据、跨链消息与机构连接 | 服务经济、部分服务质押、支付抽象后的 LINK 储备 | 储备累积不等于 LINK 持有人分红 |
| UNI / Uniswap | 无许可资产交换和流动性基础设施 | 治理；已启用范围内协议费换 UNI 销毁 | LP 赚的交易费不全部属于 UNI |
| AAVE / Aave | 超额抵押信贷与流动性市场 | 治理、特定安全机制、收入支持的回购 | AAVE 不是存款凭证，也不等于 GHO |
| MORPHO / Morpho | 可组合借贷市场与风险管理金库 | 有限治理、金库资源与费用开关权限 | 金库管理费不自动分给 MORPHO |
| ONDO / Ondo DAO | 关联产品提供链上证券和国债敞口 | Ondo DAO / Flux Finance 治理 | ONDO 不是 USDY、OUSG 或股票代币 |
| ENA / Ethena | USDe 合成美元体系的协调与发展 | 治理、激励和 sENA 参与机制 | ENA 不是 USDe，更不是 sUSDe 收益权 |
| LDO / Lido | ETH 质押服务及可组合质押凭证 | 治理；NEST 有条件回购入库 | LDO 不是 stETH；入库不是销毁 |
| ETHFI / ether.fi | 质押、资产管理和支付产品组合 | 治理、sETHFI 奖励及产品权益 | ETHFI 不是 eETH / weETH 的底层 ETH 债权 |
| JUP / Jupiter | Solana 交易入口、路由和金融产品分发 | 治理、参与奖励、Litterbox 回购机制 | JUP 不是 Solana gas；提议销毁不等于已销毁 |
| PENDLE / Pendle | 分拆与交易未来收益、管理利率风险 | sPENDLE 治理与符合条件的费用奖励 | PENDLE 不是 PT 本金，也不是 YT 收益头寸 |
| TAO / Bittensor | 多个数字服务子网的激励与资源配置 | 网络原生资产、质押、子网资本与排放协调 | TAO 排放不是对 AI 正确性的通用密码学证明 |
| WLD / World | 人格唯一性验证与身份网络分发 | 网络分发与治理设计中的代币 | 买 WLD 不会获得“真人身份” |
| KAITO / Kaito | 信息发现、注意力测量与创作者分发 | 质押、参与及特定投票权益 | 注意力评分不是事实真伪证明 |
| VVV / Venice | 模型 API 与可交易的持续 API 额度 | 质押 VVV；锁 sVVV 铸 DIEM | VVV、DIEM、API 美元额度是三种东西 |
| VIRTUAL / Virtuals Protocol | Agent 发行、服务交易与商业协调 | Agent 流动性基准资产、交易及生态权益 | Agent 发币不等于 Agent 已有客户或收入 |
| ZRO / LayerZero | 应用自选安全配置的跨链消息 | 治理与特定业务收入支持的回购 | Stargate 费用、Executor 费用、协议费开关不是一回事 |
| PUMP / Pump.fun | 低门槛发币、交易与注意力分发 | 平台生态代币；收入支持的买入销毁 | PUMP 不是平台上每一个新币，也不授予其版权 |
| LIT / Lighter Infrastructure Token | 可验证撮合、清算的交易场所 | 质押准入、LLP 容量、交易收入回购 | LIT 不是 LLP 份额；不能凭名称假定治理权 |
| 旧 LIT / Litentry，现 HEI / Heima | 从身份聚合转向链抽象与跨链体验 | 独立于 Lighter 的另一套网络经济 | 不能把旧 LIT 的历史、供给和合约套到 Lighter |
| XPL / Plasma | 稳定币支付网络及账户产品 | 原生 gas、PoS 网络经济和验证者激励 | XPL 本身不稳定；用户免 gas 不代表没人支付 |

## 3. 金融服务：钱从哪里来，币得到什么

### HYPE：交易基础设施、安全预算与费用流合在一起

Hyperliquid 的具体工作是维护订单簿交易及清算，并让 HyperCore 与 HyperEVM 应用共享底层网络。HYPE 同时承担委托 PoS 质押和 HyperEVM gas；交易费存在 HLP、Assistance Fund、资产部署者等不同去向。当前官方文档明确：Assistance Fund 将相关费用自动转为 HYPE，其中 HYPE 被移出流通量和总供应。不能把“全部成交额”或“全部手续费”写成 HYPE 收入。[费用规则](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/fees)、[质押](https://hyperliquid.gitbook.io/hyperliquid-docs/hypercore/staking)、[HyperEVM gas](https://hyperliquid.gitbook.io/hyperliquid-docs/onboarding/how-to-use-the-hyperevm)

**判断：**它的逻辑比只有治理权的币更直接，因为交易场所、原生安全资产和一部分费用处理相连。长期基础是流动性、执行质量、开发者和真实付费交易者。失败条件是流动性迁移、清算或风控事故、验证与运营集中风险，或竞争使可分配费用长期压缩。高杠杆活跃期的收入不能直接外推为永久收入；HYPE 与承担做市损益的 HLP 要分别评估。

### UNI：交换协议很有用，但要看已经打开的费用路径

Uniswap 提供 AMM、流动性管理和交易路由。普通用户交换资产无需持 UNI。UNI 治理能决定协议费等参数。**当前官方文档已不能用“UNI 只有治理、没有费用机制”概括**：自 2025 年 12 月起有协议费换币销毁机制；本次页面明确，协议费当前启用在 v2、v3，不能泛化为所有 v4 池和所有产品。费用收集后由参与者交付 UNI 取走费用，UNI 被销毁；持有人没有按比例领取协议营业收入的个人权利。[UNI 官方说明](https://developers.uniswap.org/docs/ecosystem/governance/uni)

**判断：**持续性来自资产交换、流动性深度和可组合性。币的持续性还取决于可收取协议费的范围，以及收费后 LP、交易者是否留下。失败条件是竞争和订单流迁移让费用基础缩水，或治理在收入与用户成本之间失衡。回购销毁是一种分配机制，不会消灭 MEV、滑点、合约风险或代币需求波动。

### AAVE：成熟信贷产品，代币捕获依赖治理分配

Aave 组织存款、借款、抵押品和清算；这些行为不要求先持 AAVE。AAVE 是治理资产。官方资料说明，回购计划已自 2025 年执行，购买的 AAVE 进入 Ecosystem Reserve，用于奖励、资助和服务支出等；这与永久销毁不同。安全体系也需区分旧 Safety Module 与 Umbrella，不能把所有市场风险简单说成“由 AAVE 质押统一担保”。[AAVE 代币与回购](https://www.aave.com/docs/ecosystem/aave)、[治理](https://www.aave.com/docs/ecosystem/governance)、[协议常见问题](https://aave.com/faq)

当前文档包含 V4、Horizon 和金库产品方向；文档列出版本并不等于每条链、每个市场均已升级。**判断：**借贷是可持续需求，但必须经过坏账、运营成本和风险准备后再谈可分配收入。失败条件包括预言机错误、抵押品流动性枯竭、清算失败和治理捕获。存款增长能证明产品需求，不能单独证明 AAVE 持有人得到同等比例经济利益。

### MORPHO：把信贷拆成可组合的市场和专业风险管理

Morpho 更像借贷基础设施：底层市场保持较小、较稳定的权限面，上层金库由不同角色选择市场、配置额度。当前官方资料包含 Blue、Vault V2，以及固定利率方向 Midnight。MORPHO 是治理币，借贷本身不需要它。治理有费用开关等有限权限，最高费用能力不等于已经启用，更不等于持有人已收到分配。Vault V2 的适配器、限额、curator / allocator / sentinel 等职责也意味着应逐个审查金库。[MORPHO 代币](https://docs.morpho.org/learn/governance/morpho-token/)、[治理权限](https://docs.morpho.org/learn/governance/organization/)、[Vault V2](https://docs.morpho.org/learn/concepts/vault-v2/)、[当前合约分类](https://docs.morpho.org/developers/contracts/)

**判断：**机会来自更多金融产品把它当作后台，而非都直接使用同一个前端。失败条件是风险管理者造成重大损失、集成集中在少数渠道，或产品普及却长期没有清晰的代币价值分配。一个 curator 收到的管理费，不应记到 MORPHO 持币者名下。

### JUP：交易入口和分发能力，不能替代代币现金流核验

Jupiter 的优势在 Solana 上聚合交易、发现更好的执行路线，并把流量带到相关金融产品。普通 swap 不要求持 JUP；网络 gas 是另一层。官方治理材料说明过 Litterbox 将 50% 链上收入用于回购，2026 年团队提出 Net-Zero Emissions 等安排。**提案文本证明提出了什么，不自动证明最终表决和执行状态。**尤其 70% 回购、全部回购币销毁、会员费率权益等社区帖子，不能当作当前协议事实。[官方 DAO FAQ](https://discuss.jup.ag/t/jup-dao-faq-june-2025-edition/38967)、[2026 年净排放提案及讨论](https://discuss.jup.ag/t/proposal-net-zero-emissions/39948)、[仍属提案的 70% / 会员方案](https://discuss.jup.ag/t/proposal-make-jup-an-economic-membership-token-staking-tiers-fee-discounts-and-a-70-buyback-and-burn/40223)

**判断：**长期位置取决于用户入口、路由质量、分发和跨产品留存。JUP 还取决于回购持续性、币的最终去向和激励支出。失败条件是钱包直接接管路由、竞争削弱收费、排放或金库支出超过经济捕获。本文确认“回购机制有官方依据”，不声称已逐笔审计 2026-10-05 当天的预算或销毁比例。

### PENDLE：把未来收益变成可单独定价的头寸

Pendle 把生息资产的本金和未来收益拆成 PT / YT，使固定收益、收益交易和期限管理成为可能；PENDLE 不是这两种头寸。当前应看 **sPENDLE**，而非只复述旧 vePENDLE 模型：官方说明 80% Pendle V2 的 yield / swap fees 用于买回 PENDLE，买回币最多全部分配给符合活跃条件的 sPENDLE；特定积分空投按原资产分配。Boros 另做资金费率相关交易，不能混成同一项产品收入。[sPENDLE 机制](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/sPENDLE)、[V2 费用](https://docs.pendle.finance/pendle-v2/ProtocolMechanics/Mechanisms/Fees)、[Boros 费用](https://docs.pendle.finance/boros-docs/boros-systems/fees)

**判断：**如果链上生息资产持续增多，期限和利率管理有长期工作可做。失败条件是收益来源主要来自短期积分补贴、底层资产出险、流动性无法覆盖退出需求。PT 的“固定”须以底层资产、到期兑现和合约假设成立为前提；PENDLE 奖励率则依赖实际费用和参与条件，不能当成固定利息。

### LIT / Lighter：可验证交易执行，币主要是准入和经济协调

这里的 LIT 指 **Lighter Infrastructure Token**。Lighter 是交易场所，其官方技术白皮书重点是证明撮合与清算规则的执行。LIT 官方 utility 页面列出质押和 LLP 准入：每质押 1 LIT 可获得最多 10 USDC 的 LLP 存入额度；同时有交易费用支持的回购。这个额度只是允许参与做市池，不是兑付价值或无风险收益。页面说明的质押奖励也以 LIT 计，不能转换成固定美元收益。[LIT 官方用途](https://docs.lighter.xyz/about-lighter/lit-utility)、[Lighter 技术白皮书](https://assets.lighter.xyz/whitepaper.pdf)、[官方交易界面](https://lighter.exchange/)

**判断：**它的长期价值取决于执行质量、交易流动性、证明成本及退出保障。证明某次撮合遵守规则，并不保证外部价格正确、做市盈利、系统永不停止。失败条件包括清算损失、证明或排序系统故障、付费订单流不足，以及准入带来的币价风险使用户离开。官方已读取 utility 页面没有完整列出持币治理权或永久销毁规则，因此本文不把二手材料中的“治理币”“所有回购都烧毁”当作已核验事实。

## 4. 资产、收益与质押：产品凭证和治理币不能互换

### ONDO：链上金融资产的产品分发，治理币不等于资产权益

Ondo 关联产品把国债、货币市场基金或证券敞口接入链上，但各产品的法律、资格和兑付结构不同。USDY、OUSG、股票类代币分别看条款。**ONDO 的官方定义是 Ondo DAO / Flux Finance 治理**，不是对所有 Ondo Finance 商业收入的股权，也不是国债或股票份额。官方风险材料明确排除一般公司所有权、分红等权利。[ONDO 定义](https://docs.ondo.foundation/ondo-token)、[DAO 与 Flux](https://docs.ondo.foundation/ondo-dao)、[代币权利边界](https://docs.ondo.foundation/coinlist/coinlist-risk-factors)、[OUSG 产品](https://ondo.finance/ousg)、[当前产品入口](https://app.ondo.finance/)

**判断：**真实资产链上分发的长期工作是托管、法律权利、申赎和流动性整合，技术只是其中一层。产品持续增长与 ONDO 经济捕获之间仍需明确连接。失败条件包括发行或托管问题、资格限制、市场关闭时的链上流动性不足，以及持币者误把品牌增长当作自动分红。

### ENA：合成美元的治理与激励，不是合成美元本身

Ethena 的 USDe 体系依赖支持资产、衍生品对冲和相关运营安排；sUSDe 是不同于 ENA 的参与工具。ENA / sENA 则属于治理、生态和激励层。当前读取的 sENA 文档特别说明，分配是酌情的，并保留“截至 2025 年 9 月没有正在执行或宣布的分配”这一时间说明。这个旧日期不能证明 2026 年必然为零，但足以说明不能凭“stake”一词承诺持续利润分配。本文未核验到可以把全部 USDe 收入自动归 ENA 持有人的现行机制。[产品及对冲结构](https://docs.ethena.fi/)、[sENA 说明及分配限制](https://docs.ethena.fi/video-guides/how-to-stake-ena)、[USDe 官方风险分类](https://docs.ethena.fi/protocol-overview/risks)

**判断：**需求基础是美元计价资产和收益管理；持续性必须经过负资金费率、交易所失败、托管、基差与赎回压力检验。失败条件是对冲或抵押安排失效、压力期退出受阻，或 ENA 激励需求始终无法转成非补贴需求。ENA、USDe、sUSDe 三者的价格、风险和权利不同，不能用同一收益逻辑估值。

### LDO：ETH 质押基础设施治理，NEST 是有盈余条件的回购

Lido 提供 ETH 质押服务，stETH / wstETH 代表相关质押头寸；LDO 是治理币。2026-08-14 官方发布 NEST：当收入相对经营基线产生累计盈余时，在上限约束下购入 LDO；负累计余额会暂停买入。首发采用 Treasury-only mode，购入币归 DAO 金库；另一模式可形成 DAO 自有流动性，需要治理决定。**这不是自动烧币或按持币比例发现金。**[NEST 官方说明](https://blog.lido.fi/ldo-automated-buybacks-overview/)、[Lido V3 技术白皮书](https://docs.lido.fi/Lido_V3_Whitepaper.pdf)

**判断：**质押运维、流动性及 DeFi 集成具有持续工作，但收益随 ETH 质押经济而变化。V3 的产品化方向还需看实际使用和风险隔离。失败条件是重大罚没、质押集中引起生态排斥、凭证流动性折价、收入不足以覆盖运营，或治理把金库资产重新用于低效补贴。NEST 的盈余纪律值得借鉴，不能把其存在写成每天必定买入。

### ETHFI：把质押和消费产品连起来，再把部分收入回到参与者

ether.fi 由质押延伸到 Liquid、Cash 等产品；ETHFI 与 eETH / weETH 不是同一类资产。当前官方回购材料将提现费收入用于 ETHFI 回购，并将 Stake、Liquid、Cash 的部分收入纳入计划；买回币分配给 sETHFI 参与者，部分也可用于流动性安排。比例、产品范围及裁量权必须分别看，不能一句“收入全归持币者”概括。sETHFI 还关联产品等级等权益。[回购规则](https://etherfi.gitbook.io/gov/ethfi-buyback-program)、[sETHFI 产品说明](https://help.ether.fi/en/articles/593178-sethfi)

**判断：**比单纯再质押叙事更需要关注可持续的付费产品和用户留存。失败条件包括底层质押或再质押损失、产品操作风险、支付合作方和合规限制，以及费用收入不足却继续补贴奖励。ETHFI 奖励的数量与其美元价值是两个变量。

## 5. 数据、跨链与支付网络：用户可不买币，底层仍有成本

### LINK：可信连接服务，以及降低付款摩擦的支付抽象

Chainlink 提供预言机、跨链消息及机构系统连接；它的最佳位置是让合约使用链外信息和跨系统动作。LINK 参与服务经济和部分服务的质押安全。Payment Abstraction 允许客户用偏好的资产付款，再转换为 LINK；官方 Reserve 将部分链上、链下业务收入转成 LINK 储备。储备有提款时间锁，但**持有在储备合约中不等于永久销毁，更不等于每个 LINK 都有提款权**。[Reserve 与支付抽象](https://chain.link/blog/chainlink-reserve-strategic-link-reserve)、[质押机制与范围](https://chain.link/economics/staking)

**判断：**最可持续的需求来自依赖可靠数据和互操作性的业务，而不是“预言机”标签。失败条件是数据错误导致重大损失、集成被竞争者取代，或服务收入进入代币机制的规模始终不足。必须区分客户支付、节点报酬、储备积累和质押奖励；不能将全部合作公告当成等额 LINK 收入。

### ZRO：跨链通信协议，经济捕获已部分落在具体业务层

LayerZero 让应用配置跨链消息的验证与执行；不同应用的安全配置不同，不应视为同一种风险。2026 年官方材料把 ZRO 与 Stargate 收入回购联系起来，并提出 Zero L1 的后续用途。2026-08-11 费用更新说明，Stargate OFT 接口费及 Labs Executor 定价是**业务层费用**，没有替代或自动激活由治理决定的协议费开关。Zero 后续费用设计也不能未经上线证据就记成当前收入。[ZRO 官方定位](https://layerzero.network/blog/the-zro-token)、[当前费用层级说明](https://layerzero.network/blog/pricing-updates)、[回购来源](https://layerzero.network/blog/understanding-zro-buybacks)

**判断：**持续性来自开发者集成、跨链资产和消息需求；ZRO 捕获还取决于具体服务选择和治理。失败条件包括应用安全配置薄弱、桥或验证网络出险、跨链需求集中到竞争网络，以及商业费用导致流量绕开。转账数不能直接等于协议收入，更不能直接等于 ZRO 销毁量。

### XPL：Plasma 的原生币，稳定币支付的成本藏在服务后面

XPL 对应 Plasma，不是 USDT 的另一种名字。官方定义其为原生交易和 PoS 网络激励资产；PlasmaBFT 是管线化 Fast HotStuff 类 BFT，共识与 EVM 执行是两层。当前产品方向同时包含 Plasma One 账户和底层支付网络。[XPL 定义与分配](https://www.plasma.org/company/blog/xpl-the-public-sale-and-its-role-in-the-plasma-ecosystem)、[网络设计](https://www.plasma.org/docs/get-started/why-build-on-plasma/overview)、[当前产品方向](https://www.plasma.org/docs/get-started/introduction/start-here)

**谁付 gas？**普通 EVM 操作仍消耗 gas。特定稳定币转账可以经赞助路径，让终端用户不必持 XPL；官方较早技术说明描述由 paymaster 的受管理 XPL 额度支付。2025 年主网发布说明提及通过官方 dashboard 开放免手续费 USD₮ 转账。但本次读取的 Network Fees 页面仍把通用 custom gas tokens 写为建设中，因此不能宣称所有合约、所有钱包现在都能用任意稳定币付 gas。更不能将赞助解释为验证者和服务器没有成本。[主网公告](https://www.plasma.to/insights/plasma-mainnet-beta-and-xpl)、[赞助与自定义 gas 的技术说明](https://www.plasma.to/docs/plasma-chain/network-information/differences-ethereum-and-plasma)、[当前 Network Fees 页面](https://www.plasma.org/docs/plasma-chain/network-information/network-fees)

**判断：**长期机会是支付分发、商户、出入金及真实账户服务，而非单纯低 gas。失败条件是补贴撤去后无人付费、稳定币流动性迁出、账户合作或基础设施失效。稳定币流量上升不必然使终端用户大量囤 XPL；应观察谁采购 gas、采购多少、赞助成本如何回收。

## 6. AI、身份和注意力：把“有活动”与“有价值”分开

### TAO：为多种数字服务建立竞争性激励市场

Bittensor 的子网可以承担不同服务，验证者按子网规则评价贡献，网络分配排放。TAO 是基础资产；dTAO 引入子网 alpha 资产及其与 TAO 的市场，不能再用“所有矿工直接获得同一种算力奖励”解释。官方当前 emission 文档描述多层排放、子网市场和 Yuma 权重结算，还明确提示部分页面快照早于某些规则激活；本文因此不把预览参数当作当日全网已生效配置。[dTAO 白皮书](https://www.bittensor.com/dtao-whitepaper)、[排放与 Yuma](https://www.bittensor.com/docs/concepts/emissions)

**判断：**它擅长组织开放竞争和激励实验，不能自动证明某次 LLM 输出正确或某个 GPU 真执行指定模型。持久性需要子网产生愿意付费的外部需求，而非只有资本流入和排放。失败条件是评分被操纵、验证者串谋、补贴大于真实服务价值，或资本市场表现与真实工作质量脱节。TAO 不是固定 FLOPs 兑换券，更不是稳定的 AI 单价。

### WLD：独特人格验证与代币分发是两条线

World ID 试图区分独特人类参与者与批量伪装身份，WLD 则是生态分发及治理设计中的代币。购买 WLD 不能代替身份验证；身份验证成功也不代表某条内容真实。官方白皮书讨论代币与人格两种治理输入，不能据此把未来治理安排写成全部完成。World Chain 和 World App 的赞助 gas 也不意味着 WLD 就是所有底层操作的 gas。[World 白皮书](https://whitepaper.world.org/designing-for-scale/2025-04-28)、[World Chain 官方说明](https://world.org/world-chain)

当前方向进一步走向“人类委托给 Agent 的证明”：2026-10-02 官方材料介绍仍处于 beta 的 AgentKit、按人限额及关键动作的人类确认；这比简单“区分机器人”更具体。另有基金会使用 WLD 结算运营和生态支出的说明。这是代币支出用途，不是协议向外部客户赚钱或给持币者分红的证明。[Agent 授权方向](https://world.org/blog/announcements/muse-dots-instinct)、[WLD 运营结算](https://world.org/blog/announcements/building-a-wld-native-economy-across-the-world-protocol)

**判断：**AI 增加会使反女巫需求更明显，但有效性取决于采集设备、覆盖、隐私、撤销与纠错机制，以及应用是否愿意集成。失败条件是公众和监管不接受、生物识别或运营环节被攻破，或身份产品有用却缺少持续 WLD 需求。它证明的是特定身份系统认可的唯一性，不是道德、信用或所有表达的真实性。

### KAITO：信息和注意力分发，不能把流量评分当现金流

Kaito 现在的公开产品包含 Mindshare、Studio、创作者与品牌合作，以及质押入口。官方 Connect FAQ 描述 sKAITO 的投票和参与权益，并把质押奖励来源写为流动性激励。当前官网仍可核验 KAITO 质押入口，但旧 Yapper 文档中的每一个权益不能未经复核套到新 Studio 商业流程。本文未找到足够官方依据，证明所有 Studio 收入按固定比例分给 KAITO 或用于不可更改的销毁。[当前产品](https://kaito.ai/)、[Studio](https://www.kaito.ai/studio)、[质押机制](https://faq.launchpad.kaito.ai/yapper-launchpad-faqs/staking-mechanics)、[质押入口](https://kaito.ai/stake)

**判断：**有长期需求的是搜索、筛选、分发和衡量有效触达；代币持续性取决于其在分配和付费中的真实作用。失败条件是排名被刷量、奖励激励垃圾内容、外部平台更改数据权限，或品牌付费无法转化为商业结果。声量、点击和人类有效注意力应分别测量。

### VVV：必须认真对待的计算资源竞争者

Venice 是实际的 AI API 产品，VVV 是 Base 上的代币。当前结构必须拆开：**质押 VVV 得到 sVVV；锁定 sVVV 可以按当时的 Mint Rate 铸造 DIEM；质押 DIEM 获得每枚每天 1 美元的 Venice API 额度。**DIEM 可以转移或交易；要解除相应 sVVV 锁定，需要烧回同量 DIEM，卖掉后想退出就要重新取得 DIEM。API 还支持其他付费路径，因此“调用 API 必须持 VVV”不成立。[当前 FAQ](https://venice.ai/faqs/all)、[DIEM 设计](https://venice.ai/blog/introducing-diem-as-tokenized-intelligence-the-next-evolution-of-vvv)、[解锁规则](https://featurebase.venice.ai/help/articles/0570869-how-do-i-unlock-my-svvv-after-minting-diem)、[卖出 DIEM 后的退出](https://featurebase.venice.ai/help/articles/8577381-what-happens-if-i-sell-the-diem-i-minted-and)

**“每天 1 美元额度”究竟锚定什么？**它锚定指定供应商的 API 价目和服务承诺，不是每天可兑付 1 美元现金，也不是固定模型质量或固定硬件 FLOPs。不同模型价格、限速、可用性和条款会影响实际可买的服务。长期资源承诺还要求未来服务成本有持续融资来源；代币排放本身不创造 GPU。

当前 API 文档还区分 anonymized、private、TEE、E2EE 等服务等级，不能把所有模型都概括为相同隐私或证明能力。[Venice API 与服务等级](https://docs.venice.ai/llms.txt) **判断：**VVV / DIEM 已经实现本研究最相关的“基础币与资源使用权分离”，这不是 Cinder 首创。失败条件是日常 API 使用价值不足、供应商经营或服务承诺无法持续、额度需求与铸币锁仓失衡，或模型、隐私和执行保证被营销混为一谈。

### VIRTUAL：Agent 商业协调和发币工具已有实质基础设施

Virtuals 不只是聊天角色发币。当前文档包括身份、钱包、计算、资本形成，以及 ACP 服务协议。VIRTUAL 是 Agent 代币流动性及交易的基准资产；生态规则让 Agent 交易经过相应资产路径。但“所有服务都技术上只能用 VIRTUAL”需要逐个合约和支付路径验证，不能从品牌口号推断。ACP 定义 Client、Provider、Evaluator，通过约定、托管、交付和评估组织服务交易；当前开发文档将 ACP 描述为拟议 ERC-8183 的参考实现。[VIRTUAL 角色](https://whitepaper.virtuals.io/info-hub/usdvirtual-token-base-asset-for-ai-agents)、[商业层](https://whitepaper.virtuals.io/about-virtuals/commerce-layer)、[当前 ACP 架构与 SDK](https://os.virtuals.io/acp/overview)

**判断：**最值得观察的是 Agent 真正向其他 Agent 购买服务，而不是互相交易代币。评估者的同意属于特定信任和争议机制，不等于对任意模型执行的数学证明。失败条件是 Agent 收入主要来自发币和补贴、评估者串谋、交易量刷出，或实际服务没有复购。锁入流动性池的 VIRTUAL 也不是自动销毁。

### PUMP：注意力与发行交易的市场，不是生产力计量单位

PUMP 是 Pump.fun 平台代币，与平台上发行的其他币不同。产品工作是降低发行和交易门槛，再把用户注意力汇集到市场。当前官方 token 页面说明，50% 平台收入目标用于市场买入 PUMP 并烧毁；页面也提示 custom pairs 导致费用仪表盘统计存在待修正问题，因此本文不用其总额作审计事实。普通发币和交易按所在池的 SOL / USDC 等路径进行，不要求人人预先持有 PUMP。[PUMP 官方机制](https://pump.fun/pump-token)、[平台费用及币对规则](https://pump.fun/docs/fees)

**判断：**持续性来自创作者、发行分发和交易流动性，但需求高度依赖投机与注意力周期。失败条件是用户损失造成信任衰减、竞争迁移、内容或市场滥用，以及发行数量增长却没有持续交易。买入烧毁比模糊承诺更可追踪，但不能把交易手续费变成创造真实生产力的证明。

### 旧 LIT / Litentry → HEI / Heima：单独标识，不能拼接历史

Litentry 的旧代码也是 LIT；官方 Heima FAQ 说明已通过治理更名为 Heima，方向从身份聚合延伸到链抽象和多链资产体验。官方更名提案把 ticker 改为 HEI，并讨论新经济安排。它与 Lighter 没有同一代币身份。对于用户只写“LIT”的情况，本文同时保留两者，不能默认为旧 Litentry，也不能用旧链的质押或供给数据解释 Lighter。[Heima 官方 FAQ](https://docs.heima.network/resources-more-about-heima/faq)、[官方更名治理记录](https://heima.subsquare.io/techcomm/proposals/35)

**判断：**Heima 的机会在减少跨链账户、身份和 gas 管理的复杂性。失败条件是用户没有采用、桥与代理执行风险过大，或迁移后的代币需求没有与实际服务建立联系。FAQ 中“计划 Q3 2025 推出 staking”属于旧计划，不能据此声称 2026 年该机制已上线或有固定收益。本次没有把尚未核验的 HEI 当前收费和收入分配补写成事实。

## 7. 哪些更可能留下：按条件判断，而不是排涨幅

如果“潜力”指未来价格，没有一个只看技术用途的排序足够成立；还缺买入价格、流通与解锁、市场深度、权利和风险预算。这里给出的是**研究优先级与业务耐久性条件**。

| 研究组 | 为什么值得长期跟踪 | 必须出现的证据 | 推翻判断的条件 |
| --- | --- | --- | --- |
| 基础金融工作：Aave、Morpho、Uniswap、Chainlink | 借贷、交换、数据连接有持续业务需求 | 不靠代币补贴的费用；经历压力期仍能运行；费用路径可查 | 坏账或安全事故破坏信任；竞争使有效收入消失；产品增长不传导到币 |
| 交易与分发：Hyperliquid、Jupiter、Lighter、Pump.fun | 交易需求与市场分发可形成收入 | 净付费流量、流动性质量、留存、回购最终去向 | 刷量、投机周期退潮、执行或风控失效、市场流动性迁出 |
| 收益和资本管理：Pendle、Lido、ether.fi、Ethena | 收益、期限、质押与美元需求真实存在 | 底层收益来源、压力期兑付、扣成本后的分配能力 | 负资金费、罚没、底层资产出险、奖励主要来自自身排放 |
| 现实金融和支付：Ondo、Plasma、LayerZero | 申赎、支付分发和跨系统连接有明确工作 | 法律与技术权利一致；真实转账者付费；代币捕获边界清楚 | 依赖补贴、账户或托管出险、产品成功却与治理币权利无关 |
| 新需求实验：Venice、Virtuals、Bittensor、World、Kaito、Heima | AI 服务、代理协作、反女巫和信息筛选可能扩大 | 实际付费、复购、可验证交付或有效身份使用，扣除刷量 | 活跃只由奖励驱动；评价被操纵；数据、硬件或供应商单点失败 |

同一组里也不能混为一谈。Venice 的 API 额度比较具体；World 面对硬件与人格验证；Kaito 面对注意力归因；TAO 面对开放评价和激励；Virtuals 面对服务契约与商业协调。它们不是同一种“AI 币”。Ondo 产品的耐久性也不能直接放大成 ONDO 对全部业务的经济权利。

真正有辨识力的季度检查项是：谁支付了非补贴费用、扣完成本剩多少、资金最终流到哪、有什么可执行权利、若不发奖励用户是否仍留下。不能只比较 TPS、TVL、关注数或名义 APY。

## 8. 对 Cinder 的直接架构结论

### 8.1 已有竞争者，定位必须收窄到可交付的价值

Venice / DIEM 已有可交易 API 额度；Virtuals ACP 已有代理服务约定与托管；x402 已有机器支付规范。Cinder 不能使用“第一种机器支付”“没人把算力和代币结合”“其他链不能支持 Agent”等说法。[x402 v2 规范](https://github.com/x402-foundation/x402/blob/main/specs/x402-specification-v2.md)

可以争取的工作是：**把代理的授权预算、具体交付、原生资产变动、资源权益和创作者分账放在同一条可独立重放的审计路径里。**是否优于现有组合，必须通过失败恢复、费用、集成时间和真实用户任务测量，不能通过给协议重新命名证明。

### 8.2 CINDER、WORK、交付证明继续分离

当前仓库的 WORK 是有限库存下、面向特定有界 SHA-384 服务的一次兑换权；不是固定美元，不是通用 GPU 算力，也不是 LLM 正确性凭证。它和 CINDER 之间的固定报价属于运营者销售条款；AMM 二级价格则由池储备和订单决定，两个价格可以不同。购买渠道存在时，价差交易也只在库存、费用和容量限制内可能成立，并不形成无限兑付保证。[本地资源接口](economy-interface.md)、[实现](../src/native-economy.ts)

与 DIEM 的差异可以精确写成：

| 维度 | Venice DIEM，按本次官方材料 | 当前 Cinder WORK |
| --- | --- | --- |
| 单位承诺 | 指定供应商每天 1 美元 API 额度 | 一次已定义、有输入边界的 SHA-384 工作 |
| 资源债务 | 持续额度承诺，需要未来持续服务 | 有限库存；成功兑换后消耗单位 |
| 获得方式 | 锁定 sVVV 铸造或市场取得；使用有相应质押路径 | 从运营者库存购买、转账或现有池交换 |
| 计价风险 | API 美元额度与可实际购买的模型服务有区别 | CINDER 自身波动；原生币报价不是美元报价 |
| 能证明什么 | API / 合约权益按各自服务等级解释 | 当前哈希可独立重算，账本可核对；不能证明任意 AI 推理 |

这是能力对照，不是声称简单哈希服务已经能替代模型 API。下一阶段若要出售真正昂贵的计算，应先定义模型版本、输入输出、并发、有效期、失败退款、供应方保证与验证证据，再发行对应权益。

### 8.3 原生币波动没有被“资源锚定”这个名称消除

若一项工作价格固定为 `q` 个 CINDER，CINDER 的外部美元价格为 `p(t)`，实际美元成本就是 `q × p(t)`。若希望固定美元预算 `B`，需要更新报价约为 `B / p(t)`，同时处理预言机、兑换价差、库存和有效期；没有外部价格与流动性时，不应展示虚构美元单价。

资源供给也有现金成本：

`可持续服务收入 ≥ 计算成本 + 网络与存储 + 失败重试 + 验证成本 + 运营与风险准备`

发币、锁仓、排放和烧币只能改变分配；不会改变这个不等式。永久额度特别需要说明谁承担未来成本。有限库存更容易审计，但不能因此称为无需信任的实物担保。

### 8.4 低费用必须有承担者，批量授权必须有最终结算

Plasma 的赞助路径说明终端用户可以免 gas，但系统有付款方。Chainlink 的支付抽象说明客户可用熟悉的资产付款，底层再转换。Cinder 可以研究同类体验，却不能把运营者代付写成物理零成本。

当前 native channel 用预付抵押覆盖多次授权，调用阶段更新资源使用与日志，最后关闭或到期才把已消费金额结算给供应方。这减少逐次账本手续费，不把运营者快速确认冒称独立共识最终性。以当前每次 100 atoms、开通 12、手动关闭 12 计，完成 `n` 次的账本手续费摊销为 `24/n` atoms；到期关闭无额外关闭费时为 `12/n`。它没有自动消除每次签名、验证、存储和网络成本。[通道接口](channel-interface.md)、[通道实现](../src/native-channel.ts)

### 8.5 音乐不能复制“注意力越大就自动铸币”

Kaito、Pump 和 Agent 发行市场说明注意力能产生交易，但也会诱导刷量。Cinder 音乐应继续把“付费访问事件”“实际播放”“真人独立收听”“版权权属”分开。签名和分账能证明谁授权了多少、接收者分别得多少，不能证明用户真的听完或上传者拥有版权。收入分账需要原子守恒，拒绝重复付款；不能为任意自报播放量铸造奖励。[音乐接口](music-interface.md)

### 8.6 现在不应抄一个金融超级应用

研究这些项目的目的，是选择一个有明确客户的服务入口。Cinder 当前更合理的顺序是：先做能可靠交付和恢复的原生支付及资源订单，再接真实供应商与创作者；等有交易量、成本数据和风控能力后，才决定是否需要更复杂市场。波动原生币做保证金、杠杆、借贷或衍生品会额外引入预言机、清算、坏账、保险和反身性风险，不能把已有现货池改名就宣称具备这些能力。

潜在对外一句话应基于真实状态：**“Cinder 为代理服务和创作者收入提供有预算上限的原生支付、明确资源权益和可核对的分账记录。”**其中托管测试网络、单一运营者、资源范围和证明等级仍要在产品旁清楚显示。代币名称、抗量子签名、付费事件和 AI 输出之间，没有任何一项能替其他项证明全部系统安全。

## 9. 本次仍保留的证据边界

- JUP 的治理讨论不能替代最终投票和合约执行核验；未把社区提出的 70% 回购或全部销毁写成已执行规则。
- Lighter 的已读官方 utility 页确认质押、LLP 准入和费用回购；未据二手文章补写完整治理权、回购币最终销毁率或当前储备奖励来源。
- Ethena 的 sENA 页含明确旧时间说明；未把旧日期解读为 2026 年收益状态，也未凭“fee switch”讨论承诺已生效分红。
- Plasma 较旧技术页与当前路线图措辞存在范围差异；本文仅说明免用户费的赞助逻辑，不承诺所有 custom gas 功能已普遍开放。
- Kaito 新产品页面与旧 Connect FAQ 应分别看；没有证据支持把全部 Studio 商业收入自动计入 KAITO。
- Heima 的旧路线图不等于当前部署；LIT 必须按完整项目名及合约辨认。
- 各协议的代码升级、费用参数、金库权限和地区限制可能继续变化。本文没有把项目自述的“第一”“唯一”“永远”或市场规模口号作为事实结论。

这些边界不妨碍判断产品所做的工作。它们恰好指出下一次尽调应核验哪一条资金流、哪一个权限和哪一个可执行承诺。
