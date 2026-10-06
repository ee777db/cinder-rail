# OPG、文化币与同名资产：先确认自己讨论的是什么

研究口径：2026-10-05；名单中的重复项只计一次。价格、成交量和已实现回报不构成本表结论。这里分开解释资产的产品用途和价格叙事。

| 符号 | 可以确认的对象与最佳用途 | 底层约束；对 CINDER 的启示 |
| --- | --- | --- |
| OPG | OpenGradient 的推理支付、节点经济和治理代币。官方 SDK 文档给出 Base 上的 OPG 地址 `0xFbC2051AE2265686a469421b2C5A2D5462FbF5eB`，介绍 x402、TEE 验证及批量哈希记录。适合需要可追溯 AI 调用的开发者。[SDK](https://docs.opengradient.ai/developers/sdk/)、[执行流程](https://docs.opengradient.ai/learn/onchain_inference/verifiable_execution) | 这是 CINDER 的实际比较对象，不能把 OPG 误写成 Optimism OP。TEE 的可信边界取决于运行代码、硬件、认证根和模型究竟在 enclave 内还是经代理调用外部 API；代理请求见证不自动变成外部闭源模型每一步执行的数学证明。波动币付款也不天然产生稳定的美元成本。 |
| FARTCOIN | 若指 Solana 上 `9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump`，项目页将其定位为娱乐和社区文化代币。最佳用途是表达、收藏和自愿参与的文化交易。[项目页](https://fart.dev/) | 没有由页面建立的现金流、算力赎回或生产资源权利。文化价值可以持久，但不能据此承担代理预算单位；也不能推出价格必然归零。 |
| KPEPE / kPEPE | 这份交易符号语境下通常是 PEPE 的缩放市场标识。Hyperliquid 官方保证金文档确实列出 kPEPE 市场；它不是因为多了 k 就变成一条新链。[市场定义](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers) | 使用者必须另核对交易场所的合约乘数、结算资产和现货地址。它主要承载 meme 价格敞口，不是计算或结算基础设施；合约交易也不等于持有现货币。 |
| KSHIB / kSHIB | 同样需区分 SHIB 现货与交易平台的 kSHIB 合约符号。SHIB 有社区和应用生态，但 Shibarium 官方网络参数将 gas 币明确列为 **BONE**。[市场定义](https://hyperliquid.gitbook.io/hyperliquid-docs/trading/margin-tiers)、[Shibarium](https://docs.shib.io/get-started/shibarium) | 不能把 SHIB、BONE、交易合约和整个生态的收入权混成一个资产。最佳用途是对应的社区和交易场景，而非假定任何新应用都会强制购买 SHIB。 |
| USELESS | 同名资产非常多。若指主流名单中的 Solana meme，产品主题是对“无用”叙事的文化表达，而非资源赎回；其他链也有不同历史的 USELESS。网页和名字不能代替合约确认。[Solana 项目页面候选](https://www.uselesscoin.io/)、[另一项目的自述](https://www.uselesstoken.net/) | 这里不把任何同名项目的承诺归给另一个合约。对生产支付排除，对文化存续不作确定的消亡判断。 |
| PONS | 若指 ponsfamily 文档中的 PONS，其 reference token 地址为 `0x39dBED3a2bd333467115dE45665cC57F813C4571`，位于 Robinhood Chain；pons 是以 WETH 为报价的发币和流动性平台，文档将 PONS 列为已毕业的参考资产。[官方文档](https://docs.ponsfamily.com/) | 平台有用不代表这枚参考资产持有人自动取得平台收入。不要与 PONZ、其他 Pons 协议或同名发行混淆。最佳场景是该平台的资产/社区活动，不能把它当跨行业结算基础。 |
| CASHCAT | 仅靠本次给出的符号不足以可靠锁定资产；已有多个同名/近名代币、工具和“CashCat Chain”页面，且页面区分 CASHCAT、CCC、CCBOT。未完成网络和合约对应前，不作确定技术归类。[一个具体网络自述](https://cashcatchain.cash/status) | 排除的是未核明资产的生产接入，而不是预言某个合约价格或寿命。任何涉及资金的系统都应要求 chain ID + 合约/原生资产 ID，不能按名字自动路由。 |

本表不会把文化需求视为不存在，也不会将所有交易量视为有效生产流量。Doge 可以因为文化、认知和支付集成持续存在；某个新 meme 也可能成为文化符号。两者都不能由“max flux”推出稳定购买力、可信交付或投资收益。

对我们的接口而言，资产身份已经落实为网络标识和固定资产动作，而不是任意 ticker。CINDER 与 WORK 的状态分别记账；没有自动将任何同名外部资产映射成本网络余额。
