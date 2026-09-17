# 清账本 · 第四面：通知与对账（2026-09-17，给 Lemon 过）

> 四段：现在是什么（证据）、你说过要什么、真正的问题、建议 + 要你答的。这一面吃掉旧 B1（通知分类）、B3（看板）、B4（对账）、G1（highvcc 入库）、G2（账本计数）。推手机的判据直接用面三表三（人工兜底点清单）。

## 1. 现在是什么（代码 + 生产，2026-09-17 10:45 UTC）

### 1.1 通知：怎么产生、怎么推
- **产生点 7 处**写 `operator_alerts`：Browser 9 类（`browser-alert-repository`，severity 写死在表里：SUBMITTED/COMPLETED/PAYMENT_CONFIRMED=info，ORDER_FAILED/UPGRADE_HANDOFF=warning，PAYMENT_UNKNOWN/HUMAN_REQUIRED/STALLED/HUMAN_VERIFICATION=critical）· `ORDER_WAITING_FOR_CARD`（critical，每单）· `CARD_STOCK_LOW`（warning，只算 hnskj）· `CARD_STOCK_EMPTY`（operator-watch）· `PROVIDER_BALANCE_CHANGED`（info，只 hnskj）· `REFUND_CANDIDATE` · 补款类。去重键 = 类型 + 订单，同一单每种一条。
- **推送**：常驻 `pojia-bark-notifications.service`（每轮 `enqueueOpenAlerts` → `claimNext` → Bark），规则是「**所有 OPEN 告警都推，除 `PHONE_SILENT_TYPES` = [PAYMENT_UNKNOWN, PAYMENT_CONFIRMED]**」（D-176）；critical → Bark `critical`，warning → `timeSensitive`，info → 普通。告警一 RESOLVED，通知行改成 CANCELLED（**不代表没发过**，`sent_at` 还在）。
- **近 7 天实际推了 99 条**：ORDER_SUBMITTED 33、ORDER_FAILED 26、BALANCE_CHANGED 13、**PAYMENT_UNKNOWN 10**、PAYMENT_CONFIRMED 6、COMPLETED 6、HUMAN_REQUIRED 3、STALLED 2。真需要人的（HUMAN_REQUIRED + STALLED + 缺卡）不到 10 条。
- **两条纠错**：①D-219 说「CARD_STOCK_EMPTY pushed=0、唯一没推的恰是最该推的」——**错**，它 09-12 12:42 发出去了（`sent_at` 有值），告警关闭后通知行被标 CANCELLED 才被误读；②**D-176 的静音没生效**：生产代码里静音表在、推送进程跑的是当前 release，但 PAYMENT_UNKNOWN / PAYMENT_CONFIRMED 近 7 天仍各插了通知行并 SENT（例：09-16 11:09 那单，四条告警四条推送）。**原因未查清**（入队 SQL 用 `NOT IN (?, ?)` 绑定数组），落实时先坐实再改。
- **token 过期不叫人（今天实证）**：highvcc token 06:06 贴的，08:38 起快照同步连续失败 `HIGHVCC_TOKEN_EXPIRED`，service 处 failed，**近 4 小时新告警 0 条**。

### 1.2 对账：现在比什么、数据从哪来
| 数据 | hnskj | highvcc |
|---|---|---|
| 卡余额 | read-sync（每卡每小时） | 1h 快照（现因 token 失败） |
| 卡交易 `card_transactions` | 50 笔（read-sync 按卡拉） | **0 笔**（provider 有 `allTransactions()` 账户级接口，没接同步） |
| 钱包余额 `provider_balance_snapshots` | 7963 条（catalog-sync 5 分钟） | **0 条**（provider 有 `wallet()`，只后台点查） |
| 拒付 | 4 笔入库：6807 三笔 $128.75（08-29）、1652 一笔 $76（09-15）；fee $0.4/笔 | 无法知道 |
| 开卡费 | `card_recharge.fee` 全 0（未记） | 无 |

- **消费账本 `card_consumption_ledger`**：CONSUMED 12 / RELEASED 53 / RECONCILIATION 2。**成功单 20 里只有 12 单记了 CONSUMED**：Browser 7 单成功却是 RELEASED、API 1 单没有账本行——人工收口的单没进账本。卡 1657：账本 CONSUMED 1，余额 $50 → $1.83（实际用了 3 单），交易表里 purchase 0 笔。**每卡 3 单的上限靠这张账本数，它现在少数了。**（G2 实证）
- **自动对账**：`card-consumption-audit.js` 比的是「账本 CONSUMED 次数 vs 卡台 purchase success 次数」（次数对账，不是金额），只是一个 npm script，**没有任何 timer/流程调它**；对 highvcc 卡永远假阳性（交易 0）。
- **Browser 付款后的「交易核对」**：备用卡固定返回一个 marker、恒匹配（`browser-card-transaction-reader.js:69-82`），不是卡台侧证据。

### 1.3 看板：后台首页现在算什么
`getOverview` 读 21 张表（tasks 8 次、app_settings 7、card_sync_jobs 5……含待删的 reconciliation_cases / refund_cases / order_tags / card_funding_attempts / card_stock_jobs / card_discoveries），算：总单/今日单/成功/处理中/各中间态计数/成功率、CDK 状态、退款状态、告警数、worker 心跳、过期租约、卡同步积压/失败率、补卡日限用量、卡库存（可分配/已分配/耗尽/待补）、hnskj 钱包、路线健康、五个决定开关。
**没有的**：花了多少钱、两路线各自耗时、拒付、highvcc 钱包、今天叫了你几次、自动完成率。

## 2. 你说过要什么
- 余额有变化就要通知我（D-228）。
- 缺卡、开卡失败、资金异常必须推；信息类只进后台（D-219/D-227）。
- 「需要我处理」只放系统真解决不了的；叫人要带证据、别谎报（面三 §7）。
- 看板 = 运营看板：今日多少单、花了多少钱、用了多少张卡、两路线各自耗时、异常支出（拒付哪张卡）、当天突发（D-227）。
- 基础对账能力：账本 vs 卡台，差异进「需要我处理」（D-219 发现 7）。
- 不做三方对账、退款自动识别（基线）。
- 稳定、不臃肿。

## 3. 我看到的真正问题
1. **推不推手机的判据是「排除法」而且排除没生效。** 近 7 天 99 条推送里真需要人的不到 10 条；付款不明本来就不该推（面三定了「定不了才叫」），现在每单必推一条。这就是你说的「付成没付成都叫我」。
2. **该叫的没叫：token 过期、卡台故障没有告警。** 今天 08:38 起 highvcc 同步失败两小时，系统一声没吭。
3. **对账没有数据源。** highvcc 交易和钱包 0 入库；hnskj 开卡费没记；Browser 付款后的「核对」是假的。面三定的「付款不明靠两路证据」和面二定的「钱包水位」都建在这上面。
4. **消费账本少数了。** 20 单成功只记了 12 单，一卡 3 单的上限靠它数，人工收口的单一律漏。这直接影响分卡（多分一单会拒付）和销卡（用满没进待销）。
5. **看板不回答你的六个问题**，回答的是 21 张表的技术状态。
6. **告警只看 hnskj**：余额变化、库存低都没有 highvcc 那一半。

## 4. 我建议怎么做

**N1 · 推送判据改「白名单」= 面三表三 + 供给 + 资金**（替代 B1）
- 推手机的只有三类：①**叫人**（面三表三里标 A 的：付款前现场保留、人机验证、付款不明定不了且带证据、缺卡开不出、token 过期/卡台故障、ZZSHU 零原因失败）；②**供给**（缺卡预警、开卡失败、钱包低于告警线）；③**资金**（余额变化、拒付、账本与卡台对不上）。其余全部只进后台。
- 实现是减法：`PHONE_SILENT_TYPES` 排除表 → `PHONE_PUSH_TYPES` 白名单；类型表两台通用（余额变化、库存低按台产生）。
- **先坐实静音为何没生效**（同一段代码要用），不带着未知上线。
- 新增两个产生点：token 过期（highvcc 同步/开卡失败时）、卡台故障（面二⑦标故障时）。

**N2 · 数据源三件事 = G1 + 开卡费 + 账本补记**（替代 G1/G2）
- highvcc：`allTransactions()` 账户级流水 → 按 `provider_card_id` 归卡 → `card_transactions`；`wallet()` → `provider_balance_snapshots`；都挂进现有 1h 快照那趟（token 失效则一起失败、一起告警）。
- hnskj：开卡费 $0.5 记进 `card_transactions.fee`（现全 0）。
- 消费账本：**人工收口的单也必须记 CONSUMED**（后台 CONFIRM_MANUAL_PAYMENT / RESOLVE_UNKNOWN=CHARGED 时写账本）；历史 8 单一次性补记（正式脚本、dry-run、审计）。
- 这三件是面二（钱包水位、待销）、面三（两路证据）的地基。

**N3 · 对账 = 每日一次「账本 vs 卡台」，两种分开**（替代 B4）
- 次数对账：`card-consumption-audit` 挂 timer 每日跑，差异 → 「需要我处理」+ 资金告警。
- 金额对账：每卡「开卡金额 − 卡台交易合计」vs「卡余额」，差异超阈值 → 同上。
- Browser 付款后的假核对删掉，改读 N2 的真交易（有延迟就等，不造证据）。

**N4 · 看板只回答你的六个问题**（替代 B3，C 组做页面时用）
今日单数 / 成功率 / 自动完成率（不靠人收口的比例）· 花了多少钱（开卡 + 付款 + 拒付，按台）· 用了几张卡、还剩几张（按台按产品，面二水位）· 两路线各自耗时（建单→成功中位数）· 异常支出（拒付哪张卡、多少）· 今天叫了你几次、为什么 · 卡台状态（余额、token、故障）。数据源全部来自 N2 + orders + 账本，**不新建表**。`getOverview` 里那 21 张表的技术指标降为「高级」。

**不做 / 删**：三方对账、退款观察（`refund_cases`）、`REFUND_CANDIDATE` 告警、补款类告警、Browser 假核对 marker、18 类告警的 severity 手工表（改由白名单表统一定义）。

## 5. 要你定 / 答的
1. **推送白名单**（N1）三类就够了吗？有没有你想加的？「客户提交了充值」（SUBMITTED，近 7 天推了 33 条）你要不要继续收？
2. **余额变化**：每一笔都推（现状，13 条/周），还是只推「低于告警线」和「有钱回来」？你说过「每笔都要知道」，我照原话保留，但想确认量大了你还要不要。
3. **账本补记**：历史 8 单人工收口的单补记 CONSUMED，会让对应的卡用量变准（可能有卡立刻变「用满」进待销）。同意补记吗？
4. **看板六项**（N4）是不是你要的全部？顺序按重要性排一下。
5. **今天 highvcc token 过期了**，请重贴。贴之前一个问题：06:06 贴的 08:38 就失效，这个卡台的 token 一般能活多久？这决定面二里「token 过期叫人」会有多频繁。

## 6. Lemon 的回答（2026-09-17）与定稿

**五答**：①「客户提交了充值」也要推；「账本与卡台对不上」前期可以推，但担心判断不准或延迟造成误推；②余额变化前期量不大正常推，开卡费不用推，**拒付一定要推**，量大后不每笔推；③同意补记历史 8 单；④看板六项没问题；⑤highvcc token 一般活 2 小时，2 小时叫一次太频繁。

**定稿修订**：
- N1 白名单加第四类「**客户动态**」：客户提交了充值（SUBMITTED）推。其余信息类（PAYMENT_CONFIRMED / COMPLETED / 同步类）只进后台。
- N1 资金类细化：拒付**必推**；余额变化推（开卡扣款、付款扣款、销卡回笼），**开卡费单独不推**；「量大后不每笔推」做成设置项（每笔 / 每日汇总），默认每笔。
- N3 对账差异：**前期只进后台看板 + 每日一条汇总推**（「今日对账差异 N 项」），不逐条推；差异连续两次日对账仍在才算「持续差异」进「需要我处理」。这样判断不准或同步延迟造成的假差异不会单独打扰。
- ⑤ token 2 小时：**不按「过期」叫，按「要用而没有」叫**——只在系统真要用 token（开卡、对账拉流水、水位刷新）而 token 失效时推一次，同一段失效期只推一次，不重复；没有需求的时段过期不叫。这样叫的频率 = 真实用到的次数，不是每 2 小时。**另探索自动续 token**：需要 Lemon 说明 highvcc 网站登录方式（账号密码？手机/邮箱验证码？有没有「记住登录」）——若是账密无验证码，可以由系统自动登录取 token，人不用贴；若有验证码，只能人贴。事实：token 上次 06:06 贴、08:38 失效，与「2 小时」吻合。

**我理解的这一面的决定（请核对）**：
- 推手机白名单四类：叫人（面三表三 A 项）/ 供给（缺卡、开卡失败、钱包低于告警线）/ 资金（拒付必推、余额变化每笔推可设汇总、开卡费不推）/ 客户动态（提交了充值）。其余只进后台。先坐实静音未生效再上。
- 数据源三件：highvcc 交易与钱包挂进快照那趟入库；hnskj 开卡费记 fee；人工收口写账本 + 历史 8 单补记（正式脚本、dry-run、审计）。
- 对账每日一次、次数与金额分开；差异前期只进看板 + 每日一条汇总，持续两次才进队列。删 Browser 假核对。
- 看板六项（今日单数/成功率/自动完成率、花费按台、卡用了几张剩几张、两路线耗时、异常支出、今天叫了几次）+ 卡台状态；不新建表。
- token：按「要用而没有」叫、一段失效期只叫一次；探索自动登录续 token（等 Lemon 说明登录方式）。

## 7. 补：token 频率（D-251）
Lemon 追问「2 小时叫一次太频繁」。我自纠：面四②把 highvcc 三样入库挂每小时那趟，等于每 2 小时必然要用 token，「按要用叫」没降频。给 A（每日固定时段集中做、时段外只在突发缺卡叫）/ B（有需求即叫）。**Lemon 选 A，定稿**；账本面二⑧、面四②⑤已改。
