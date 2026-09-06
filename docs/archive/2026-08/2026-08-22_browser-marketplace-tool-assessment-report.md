# Browser 提链与自助充值市场工具评估

> 日期：2026-08-22
> 调查对象：OpenPrice、PriceAI 及其公开商品详情/接口文档
> 操作边界：仅访问公开页面、公开 JSON API、公开 health endpoint 和公开 GitHub 元数据；未登录、下单、充值、联系卖家、下载或运行第三方程序，未提交真实 Session/CDK。

## 1. 结论

两个聚合站有情报价值，但不应被当作功能验收或卖家背书。当前真正值得继续研究的只有两类：

1. UPI/PayPal/hosted 提链服务，用于验证“账号上下文创建支付工件、另一执行端付款”的分离架构；
2. 菲律宾自助充值 CDK，其业务形态与现有 CDK-API 充值路线一致，默认只作同一路线的市场样本，不是 Browser 工具，也不据此新建 Provider。

当前不建议采购或接入任何商品。优先评估公开本地提链实现，避免把客户 Access Token/Session 交给第三方。若以后需要黑盒对照，应在单独批准后只买最小规格、使用隔离测试账号和合成订单，不能使用客户 Session 或生产订单。

## 2. 聚合页事实

| 页面 | 公开样本 | 判读 |
| --- | ---: | --- |
| `https://www.openprice.cc/card-products/chatgpt-other` | 247 个渠道报价 | 分类噪音高，混有邮箱、接码、教程、镜像、成品号、中转、充值和授权工具 |
| `https://priceai.cc/products/chatgpt-codex-service` | 43 条报价 | 标签更适合筛选：提链 8、扫码 1、自助充值 26、邀请 9、长期质保 5 |

“正常”“有货”“confidence/freshness”只说明聚合器近期抓到商品或库存，不证明提链成功率、充值成功率、账号存活、退款或售后。

## 3. 直接相关候选

### 3.1 提链服务

2026-08-22 公开样本：

| 商品 | 价格/规格 | 当前状态 | 结论 |
| --- | --- | --- | --- |
| GPT 提链 PP 渠道，自助 10 次 | ¥1.73 | 有货 | 商品详情被反爬拦截，输入/输出/地区/是否付款不明；不买 |
| BurstPro UPI 提链 | ¥3/10 次、¥12/50 次、¥45/200 次 | 有货 | API 合同完整，但必须上传 Access Token/Session；只作黑盒候选 |
| 印度 UPI 批量链接提取 10 次 | ¥5.15 | 有货 | 标称荷兰 iDEAL/印度 UPI，详情不可验证；不买 |
| PayPal 全自动提链带自动支付 | ¥10.30/10 次、¥41.20/50 次 | 有货 | “自动支付”的资金主体、授权和终态不明；不买 |

同一商品不同聚合页或抓取时点可能出现价格、库存和名称差异，不能据此直接采购。

### 3.2 BurstPro 公开接口

公开页面和 API 文档显示：

- 输入：CDK + ChatGPT `access_token`，也接受包含 `accessToken` 的 Session JSON；
- 创建：`POST /api/activate`，返回 `task_id` 和只返回一次的 `read_token`；
- 结果：轮询/SSE，完成后返回 Stripe UPI `result_url`，可再请求 QR 图片；
- 次数：创建任务先原子锁定次数，成功扣减，失败释放；
- regenerate：声称在 30 分钟内复用加密保存的凭据；
- 限流：创建/重生成每 IP 8 次/分钟；
- 2026-08-22 health 实测：`workers=64`、`queue_max=600`、`queue_depth=0`、`durable_queue=true`。

可借鉴：task token、异步任务、SSE/轮询、次数 reserve/commit/release 和队列 health。

不可直接接受：客户 Access Token/Session 必须发送到第三方；“不写任务数据库、加密保留 30 分钟”是服务方声明，本项目无法验证密钥管理、日志副本、备份和删除。其 regenerate 也不能覆盖本项目的规则：Checkout 或付款结果未知时禁止自动重建。

### 3.3 菲律宾自助充值 CDK

公开在售样本约 ¥111–¥143，包括：

- 菲律宾自助充值卡密，不可覆盖；
- 菲区 CDK 24 小时自动充值；
- iOS 菲区卡密自助；
- 菲律宾 CDK 质保 30 天。

`web3chirou.com/item/458` 公开详情在调查时显示 ¥122、库存 202，并声明：只能给没有任何订阅的 Free 账号充值，不可覆盖；兑换入口为 `keleai.pro`，声称 30–40 秒完成和质保订阅 30 天。

`keleai.pro` 的公开流程要求：验证 CDK、提交 `chatgpt.com/api/auth/session` JSON、确认申请；另提供用 Session 查询账单和订阅状态。它与本项目目标账号条件相似，公开表现也是“CDK + Session → 上游代充”的 API/Provider 业务形态，需要把 Session 交给对方，不是可安装的 Browser 执行工具。当前没有证据证明它与本项目既有 CDK-API 使用完全相同的实际上游，但工程归类默认视为同一路线，不能因此再造一套 Provider 或业务系统。

该类产品未来最多用于现有 CDK-API 路线的市场/黑盒对照：比较输入合同、终态、取消、账单、时延和 Session 暴露面。只有接口、上游身份或终态行为出现明确差异时，才重新评估是否需要独立 Provider 适配；它不能替代 Browser 主链，也不能在当前边界下真实购买或提交。

## 4. 公开本地实现

| 仓库 | 最近推送 | 适用性 | 主要问题 |
| --- | --- | --- | --- |
| `lkonga/upi-chatgpt-checkout-gui` | 2026-08-04 | 小型本地 hosted/UPI/GoPay/Link 参考 | 无许可证；未验收测试和敏感日志 |
| `biypan/chatgpt-upi-checkout` | 2026-06-28 | 两阶段 checkout→UPI QR 参考 | 无许可证；README 明示 debug trace 记录 headers 和原始 payload，不能直接运行真实 Session |
| `ryugadev/UPI-CDK` | 2026-07-12 | 本地 UPI QR、job manager、SSE、代理池参考 | 无许可证；包含批量注册/邮箱/2FA 等大量非本项目能力，噪音和敏感面大 |
| `2951461586/GPT-Register-Tool` | 2026-08-20 | `gen_pp_link.py` 的 hosted/PayPal/UPI 分段代理思路 | 无许可证；仓库大且以账号注册为主，只能定点阅读支付模块 |
| `TheDustJa/chatgpt-codex--` | 2026-07-25 | 提链流程整理 | 无许可证；是二次解析文档，不是独立可信实现 |

上述仓库均未在 GitHub 元数据中声明许可证，因此只能研究接口和架构，不能直接复制源码进入项目。

## 5. 候选分级

### 可以继续研究

- 本地 hosted/UPI/PayPal 提链实现的最小支付模块；
- BurstPro 的异步任务合同、队列 health 和 reserve/commit/release 模型；
- 菲律宾 CDK 的输入、Free-only、不可覆盖、账单和终态合同，作为现有 CDK-API 路线的市场对照。

### 只作市场情报

- 接码、邮箱、成品号、镜像站、号池中转、Codex 邀请和额度刷新；
- “防封教程”“高权重账号”“日抛”等没有可复现实验合同的商品；
- 需要整个人 Profile、云端 Session 或第三方托管账号的服务。

### 当前不要购买

- 输入/输出和资金主体不清楚的 PayPal 自动支付；
- 无扫码方时购买 UPI 提链次数；
- 需要提交客户 Session 的第三方充值或提链服务；
- 任何要求下载闭源 EXE/扩展、关闭安全软件或云同步 Profile 的工具。

## 6. 对当前项目的影响

1. 保持菲律宾 Browser + HNSKJ 卡片主线不变；市场商品尚未证明更优。
2. 后续可新增两个隔离研究 lane，而不是混入 champion：
   - `LOCAL_PAYMENT_LINK_REFERENCE`：公开本地实现，只用合成/隔离测试输入；
   - `EXTERNAL_UPI_LINK_BLACKBOX`：第三方 API 最小规格，仅在单独采购和真实测试授权后运行。
3. 菲律宾 CDK 不新增研究 lane 或 Provider；默认标记为现有 `CDK_API_PROVIDER_MARKET_COMPARISON`，不与 Browser attempt 共享自动重试，也不使用同一真实账号做顺序付款实验。
4. 在本地实现可复现前，不采购提链次数；在没有扫码履约方前，UPI 链即使生成成功也不能形成交付闭环。

## 7. 下一动作

该市场研究的下一动作是对 `lkonga/upi-chatgpt-checkout-gui`、`biypan/chatgpt-upi-checkout` 和 `GPT-Register-Tool` 的支付模块做固定提交静态审查，重点核对：Token/Cookie 日志、checkout 创建、hosted authority、地区/代理拆分、重生成、付款许可、终态和测试。它是可并行、非阻塞旁路；项目主工程仍先完成 MySQL 事务映射、跨进程恢复、现有订单/attempt 接口、并发队列和连续 24 小时 soak。审查结果若证明本地方案可用，再决定是否需要购买 ¥3 的 10 次 UPI 黑盒对照。

任何购买、真实 CDK 兑换、真实 Session 提交或付款均需要新的明确操作确认。
