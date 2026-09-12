# 运营后台能力地图

> 为什么有这份文档：2026-09-12 我不知道后台已经做了「备用卡台 A 一键开卡」和「刷新卡台登录」
> 书签，于是让 Lemon 去跑命令行、去卡台手工看余额——而他早就把这些做成了一键。
> Lemon 的批评是对的：**不了解后台有哪些能力的人，判断会系统性偏差**——会重复造已有的轮子、
> 把已解决的问题当障碍、给出绕远路的建议。回答任何「能不能做 X」之前，先查这里。
>
> 口径：本版基于代码通读（`v1/public/admin/index.html` + `assets/admin.js` +
> `src/app/create-app.js` + `src/server.js` 的注入清单），**未逐项实操验证**。
> 标注了「代码显示」的含义按 CLAUDE.md 分层表达约定。

## 一、先记住这些：会花钱 / 不可逆的操作

动这些之前必须有 Lemon 的当次确认（CLAUDE.md「资金和生产动作先确认」）。

| 操作 | 界面位置 | 接口 | 后果 |
| --- | --- | --- | --- |
| **一键开卡** | 卡片 → 备用卡台 A 一键开卡（highvcc.com，**产生费用**） | `POST /backup-cards/highvcc/open` | 真实开卡、**真实扣钱**。开卡前有 `quote` 可只读算费 |
| **人工开卡** | 卡片 → 人工开卡（**产生费用**） | `POST /card-stock/jobs` | 建开卡/补余额任务，涉及金额（服务里有 `CARD_STOCK_AMOUNT_OUT_OF_RANGE`、`CARD_FUNDING_ACTIVE`） |
| **付款总开关** | 五个决定 | `POST /operations/browser-payment` | 打开＝允许执行器真实扣卡上的钱。**这是无人值守的总闸** |
| **开始营业** | 开工检查 | `POST /operations/start-business` | 一次性把多个开关拨到营业态 |
| **作废卡密批次** | CDK 批次记录 | `POST /cdks/:batchNo/revoke` | 未兑换的卡密作废，**不可逆** |
| **Browser run 控制** | Browser 控制面 | `POST /browser/runs/:id/control` | 动作见下节，含资金判定 |
| **导入备用卡（提交）** | 卡片 → 导入备用卡 | `POST /manual-cards/import` | 全量快照语义写 `cards`；先用 `preview` 只读看差异 |
| **卡运营覆盖** | 卡片列表 | `POST /card-operational-overrides` | 置 `RETIRED` / `PRODUCT_ONLY`，影响卡还能不能被分配 |

### Browser run 控制的四个动作（`browser-admin-service.js:18`）

| 动作 | 含义 | 关键副作用 |
| --- | --- | --- |
| `RESOLVE_UNKNOWN_PAYMENT` | 确认核实结果，需选 `CHARGED` / `NOT_CHARGED` | 选 `NOT_CHARGED`：**一个事务里**放账号槽、清资金锁（`funds_risk_state→CLEARED`）、账本 `RELEASED`、卡回池、`orders.assigned_card_id` 清空、订单 `CLOSED`、**卡密退回**。若资金证据与「未扣款」矛盾则整体回滚（F-48 教训） |
| `CONFIRM_MANUAL_PAYMENT` | 人工在浏览器里付完了，登记进系统 | 按已付款收口 |
| `COMPLETE_20X` | Pro 20X 两阶段的第二阶段 | 当前未启用 |
| `CANCEL` | 取消 | 释放资源 |

## 二、卡台凭证：两个卡台，两套凭证，位置不同

**2026-09-12 我在这里判断错过一次**，记牢：

| 卡台 | provider_code | 凭证位置 | 谁能续 |
| --- | --- | --- | --- |
| HNSKJ | `hnskj` | 服务器 `/etc/pojia/card-read.env`（`HNSKJ_API_KEY`） | 运维 |
| **备用卡台 A（highvcc）** | `manual_excel` | **数据库 `app_settings.highvcc_access_token_ciphertext`（加密）** | **后台一键刷新** |

**highvcc token 过期时的正确做法**（不要让 Lemon 去跑命令行）：

> 后台 → 卡片 → 展开「备用卡台 A 一键开卡」→ 点「去 highvcc.com 登录 →」登录 →
> 点收藏栏里的「📌 刷新卡台登录（拖我）」书签 → token 自动存进后台。
> 首次使用需要把那个按钮**拖**到收藏栏（不是点）。

本机另有一份独立 token（`~/Library/Application Support/AI充值业务/highvcc.env`），
供 `browser-mvp/scripts/highvcc-card.mjs` 用，与后台那份**不共享**，会各自过期。

**重要推论**：`POST /cards/sync`（卡片列表 → 「同步卡台余额和交易」）走的是服务器端凭证，
对 `manual_excel` 的卡**不生效**——那些卡的余额要走 highvcc 通道。所以库里 `MANUAL_IMPORT`
卡的 `current_balance` 是**导入时的快照**，不是实时值，`last_transaction_synced_at` 为 NULL。
判断「有没有扣款」时不能只信这个数。

## 三、按板块的能力索引

- **五个决定 / 开工检查**：`operations/*`（付款开关、接单开关、派工、默认充值方式、供给自动化、开始营业）
- **订单入口 / CDK**：生成卡密、下载批次 TXT、批次汇总 CSV、订单追溯 CSV、作废批次、批次状态报告
- **卡片**：卡片概况、卡台管理、新增备用卡台、导入备用卡（preview/import）、人工开卡、
  一键开卡（quote/ranges/wallet/open/token/status）、卡片列表、同步卡台余额、同步并接管新卡、
  卡余额充值队列（`card-funding-attempts`，含 `resolve`）、补卡执行记录、新卡接管记录（`card-intake`，含 validate/accept）
- **运行状况**：Worker 心跳与开工检查（`overview`）
- **运营核对**：资金证据核对队列（`reconciliation-cases`，含 assign/resolve）
- **Browser 控制面**：runs 列表与详情、`runs/:id/control`、账单资料（`browser/billing-address`）、
  Dispatch 队列、执行记录
- **留档**：CSV 导出（`exports/:dataset.csv`）
- **告警**：`alerts` 列表与 `alerts/:id/close`

## 四、只读安全的（查证据时优先用这些）

`overview`、`orders`、`orders/:publicNo`、`orders/:publicNo/timeline`、`card-stock`、`cards/:id`、
`cdks/batches`、`card-intake`、`card-sources`、`card-funding-attempts`、`reconciliation-cases`、
`browser/runs`、`browser/dispatch-jobs`、`browser/billing-address`、`alerts`、
`backup-cards/highvcc/{status,wallet,ranges}`、`backup-cards/highvcc/quote`（只算费不开卡）、
`manual-cards/preview`（只看差异不写库）、`exports/:dataset.csv`。

## 五、待补

- [ ] 每个写操作的确认语与幂等键（现已知 `RESOLVE_UNKNOWN_PAYMENT` 的确认语是 `确认核实结果 <run>`）
- [ ] `card-stock/jobs` 的完整语义（开卡还是补余额、金额从哪来、上下限）
- [ ] 逐项实操验证（本版仅代码通读）
