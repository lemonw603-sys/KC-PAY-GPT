# Browser 多赛道实验合同（2026-08-22）

> 状态：规范性设计合同，已通过第一轮对抗式架构审查；尚未取得菲律宾真实 Session、Checkout 或付款运行证据。
>
> 边界：当前只允许离线、非付款和不含真实卡片的实验。任何外部运行仍受当次明确操作范围限制。

## 1. 实验作用域

| Scope | 允许动作 | 实验单位 | 可否与其他 lane 复用同一账号 |
| --- | --- | --- | --- |
| `AUTH_READ_ONLY` | 装载 Session、服务器身份、Free/Plus、升级入口、订阅入口只读观察 | `account + session snapshot + network lease + runtime manifest` | 可以，但必须平衡顺序、限制比较窗口且不创建 Checkout |
| `CHECKOUT_MUTATING` | 创建一个 Checkout、分类链接、在同 lease 下打开同一 artifact | `isolated account cohort + one active checkout artifact` | 同一实验窗口内不可以跨 lane 复用 |
| `PAYMENT_SIMULATED` | mock 卡、mock confirm、3DS、崩溃和恢复 | 合成订单与 mock gateway | 可以，不得包含真实 Session、卡片或 hosted URL |
| `PAYMENT_REAL` | 真实支付、权益、取消和延迟对账 | 单独受控灰度订单 | 当前禁止；需独立操作确认和阶段退出条件 |

`AUTH_READ_ONLY` 一旦触发 Checkout 创建请求，必须重新分类为 `CHECKOUT_MUTATING`，不能继续计入只读对照。

## 2. 可比性合同

每轮结果至少包含：

```json
{
  "experimentId": "opaque-id",
  "scope": "AUTH_READ_ONLY",
  "laneId": "LOADER_SAME_CONTEXT_UI",
  "cohortId": "opaque-cohort",
  "accountKeyHmac": "hex",
  "sessionAgeSeconds": 0,
  "networkLevel": "NON_PH_FUNCTIONAL",
  "networkLeaseHmac": "hex",
  "egressProofBefore": "hex",
  "egressProofAfter": "hex",
  "runtimeManifestSha256": "hex",
  "adapterVersion": "git-commit-or-build-id",
  "attemptOrdinal": 1,
  "paymentSubmitted": false
}
```

以下任一成立，结果必须为 `INCOMPARABLE`：

- 真实服务器账号身份无法核对或前后变化；
- network lease、出口国家或阶段间出口证明不一致；
- 缺少 runtime、Session policy、locale、timezone 或 adapter 版本；
- 只读组创建了 Checkout；
- 同一账号 cohort 被两个变更 lane 使用；
- 隐形重试、刷新或重新打开没有进入 attempt 计数。

非菲律宾结果只能淘汰确定与地区无关的代码、合同或序列化错误。可能依赖地区的失败应标为 `DEFERRED_PH_REQUIRED`，不能计为赛道最终淘汰。

## 3. 账号和 Checkout 变更预算

- 每个 `accountKeyHmac` 同一时刻只能持有一个活动 Browser run 和一个活动 Checkout artifact。
- Checkout 创建需要 `checkout_create_grant`，绑定实验、账号、lane、network lease、adapter 版本和过期时间。
- 每轮 `CHECKOUT_MUTATING` 默认只创建一个 Checkout；刷新和重开不得创建新 Checkout。
- 过期、打不开或页面漂移不能单独证明旧 Checkout 已失效。
- 重建必须同时具备：确定性失效证据、同一 attempt、原 artifact 状态冻结、受控恢复授权和新的审计序号。
- 账号级日配额、冷却时间和 kill switch 在联网实验前配置；未配置时失败关闭。

## 4. 资源租约

运行必须同时持有适用资源：

| Resource | Key | 何时必须持有 |
| --- | --- | --- |
| `ORDER` | order id | 正式订单 run 全程 |
| `ACCOUNT` | normalized account identity HMAC | 身份核对后至 run 结束或冻结 |
| `CARD` | card id | 卡片分配后至资金终态 |
| `CHECKOUT_ARTIFACT` | artifact id | Checkout 创建后至失效、消费或人工冻结 |
| `CONTROL_OWNER` | browser run id | 自动或人工产生输入动作时 |

任何租约丢失，当前控制者立即停止交互。人工接管通过 `REQUESTED→FROZEN→TRANSFERRED→RELEASED` 原子转移 `CONTROL_OWNER`，不得由自动 Worker 和人工同时持有。

## 5. Checkout artifact 保密

完整 hosted URL、fragment 和可导航内部短链按敏感支付工件处理：

- 原文仅存在于 Worker 内存或加密短期 artifact vault；
- 普通数据库只保存 opaque artifact ref、URL/Checkout 哈希、link kind、创建/首次打开/失效时间和版本；
- 禁止进入任务 JSON、普通日志、指标、通知、截图、DOM 快照、trace、HAR、异常栈和测试 fixture；
- 后台不得直接显示或复制原始 URL；人工接管通过绑定 run、operator、TTL 和 single-use nonce 的代理入口访问；
- artifact 读取、打开、失效和销毁均写追加式审计；销毁任务失败必须告警。

## 6. 站点状态克隆

`FULL_PROFILE_STATE` 正式改名为 `CHATGPT_SITE_STATE_CLONE`：

- 只从已关闭的来源浏览器制作只读快照和工作副本；
- 只允许 ChatGPT/OpenAI 登录所需的已冻结域名和存储类别；
- 禁止复制密码库、保存的支付方式、浏览历史、下载、扩展和其他站点状态；
- 工作副本绑定单一账号、单一实验、单一 network lease，并在到期后销毁；
- 源 Profile 永不由自动化直接驱动或写入。

## 7. 路由和恢复

| 当前边界 | 允许动作 | 禁止动作 |
| --- | --- | --- |
| Checkout 创建前 | 按已验证资格选择 champion 或 fallback | 在同一轮试遍所有 lane |
| Checkout 已创建、未进入可能付款动作 | 围绕同一 artifact 切换已批准的打开方式 | 无失效证据新建 Checkout、换账号或换卡 |
| 任一可能提交付款的动作开始 | 消费一次 payment permit 并观察或对账 | 切 lane、重放动作、换卡、新建 Checkout |
| 付款结果未知 | 只读账号、Checkout 和卡交易对账 | 自动重付或用另一路线“补一次” |
| 权益已确认、取消未知 | 只执行取消或核验工作流 | 再次购买 |

可能提交付款的动作包括但不限于：点击最终按钮、Enter、程序化 form submit、支付钱包确认和 3DS 最终确认。它们必须共用同一个一次性 permit 消费点。

## 8. 结果和指标

每个输入都进入端到端分母。报告同时给出：

- 输入合格率和 Session 服务器身份通过率；
- Checkout 创建率、同 artifact 打开率和每单创建数；
- challenge、验证码、3DS、人工、页面漂移和未知率；
- 端到端权益确认率、取消确认率和耗时；
- 代理 lease 漂移率、卡拒绝率、对账积压和人工 SLA；
- 各项按 lane、runtime、Session policy、网络等级和 cohort 分层。

不得用自动重试后的最终结果覆盖前序尝试，也不得只对“有效 Session”报告成功率。

## 9. 胜出模型

最终可以冻结：

- 一个默认 champion；
- 最多一个独立验证的 fallback；
- 两者的资格规则和适用输入范围。

fallback 只能在创建 Checkout 前选择。若在同一 run 内已经出现 Checkout 或付款不确定性，禁止自动切换。没有任何 lane 通过硬门槛时，结论必须是“尚无胜出方案”，不能为了推进项目强选第一名。

## 10. 成功证据层级

- `CHECKOUT_OBSERVED`：只证明 Checkout 结构可观察；
- `PAYMENT_RESULT_OBSERVED`：只证明支付页或卡交易出现结果；
- `ENTITLEMENT_CONFIRMED`：服务器侧账号权益已确认；
- `CANCELLATION_CONFIRMED`：自动续费取消已确认；
- `DELIVERY_COMPLETE`：权益和取消同时成立；
- `POST_SETTLEMENT_EXCEPTION`：延迟撤销、冲正或矛盾，建立人工案件但不触发自动重付。

页面 URL 或成功文案不能单独提升到 `ENTITLEMENT_CONFIRMED` 或 `DELIVERY_COMPLETE`。

## 11. 离线实现映射

2026-08-22 已提供第一版离线实现，并将关键公开检查点扩展到本地追加式 WAL：

| 合同项 | 实现 |
| --- | --- |
| scope 与 mutating cohort 隔离 | `browser-poc/experiment-core.js` / `ExperimentOrchestrator` |
| 账号与 Checkout artifact 租约 | `LeaseRegistry` |
| hosted authority 加密与公开证据脱敏 | `EncryptedArtifactVault` |
| 人工接管所有权顺序 | `ControlOwnership` |
| champion/fallback 仅预路由 | `ExperimentOrchestrator.selectRoute` |
| 多终态支付模拟 | `browser-poc/mock-gateway.js` |
| 可重复合成演示 | `npm run poc:browser-experiment:offline` |
| 带序列/哈希链的追加式检查点 | `browser-poc/experiment-wal.js` |
| 重启后确定性恢复 | `browser-poc/run-offline-wal-recovery.js`；未知付款恢复为 `RECONCILE_ONLY` |
| 真实 BrowserContext/iframe 仿真 | `browser-poc/mock-browser-server.js`、`test/browser-local-mock-page.test.js` |
| WAL-backed 可变操作边界 | `browser-poc/wal-backed-experiment.js`；`OPERATION_PREPARED → apply → domain event` |
| 付款 at-most-once | 外部动作前持久化 `PAYMENT_SUBMITTING`；重复 operation ID 不再次调用 gateway |
| 崩溃/重复投递/接管中断 | `test/browser-wal-backed-experiment.test.js`、`test/browser-process-crash-recovery.test.js` |
| popup 与页面漂移失败关闭 | `browser-poc/local-mock-page-adapter.js`、`test/browser-local-mock-page.test.js` |
| 350 单容量等效仿真 | `browser-poc/run-capacity-simulation.js`；350 submit / 0 duplicate submit |

WAL 拒绝 Session、Cookie、卡片、完整 hosted URL/fragment 等敏感权威进入公开事件；截断、篡改、乱序、重复事件和未知事件均失败关闭。WAL-backed coordinator 已包裹 B2 原型的 run、route、Checkout、付款观察和控制权状态变更；任何未完成 intent 都禁用新 Checkout 和付款。该实现仍不替代 MySQL 最终确定性状态机，且内存 artifact vault/租约尚未实现跨进程恢复。

该实现只证明本地离线合同和 Playwright 浏览器行为，不代表 MySQL 持久化、ChatGPT 真实页面、菲律宾 Session 或付款链路已经验收。
