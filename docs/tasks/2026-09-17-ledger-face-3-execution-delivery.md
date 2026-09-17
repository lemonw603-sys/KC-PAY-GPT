# 清账本 · 第三面：执行与交付（2026-09-17，给 Lemon 过）

> 四段：现在是什么（证据）、你说过要什么、真正的问题、建议 + 要你答的。这一面吃掉旧 A1（接口三段）、A2（verify）、D-245 后的 Pro 同型改造、以及「需要我处理」的来源清单（它是控制面的输入，V2 §7 说这是只有你能画的一条线）。

## 1. 现在是什么（代码 + 生产，2026-09-17 09:50 UTC）

### 1.1 交付判据（订单何时算成功）
| | API（ZZSHU） | Browser |
|---|---|---|
| 付款完成 | ZZSHU `status=success` | 点击后 60s 读页面 + `confirmPlus`（`/backend-api/accounts/check` 含 plus） |
| 取消续费 | ZZSHU 返回 `is_subscription_cancelled=1`；否则 `CANCELLATION_PENDING` + 每 60s 再查、最多 60 次 → 仍没有则 `CANCELLATION_REVIEW_REQUIRED`（人工） | `confirmCancellation`（调 `/subscriptions/cancel`，确认 `willRenew=false`）+ `reconcile`（备用卡恒匹配） |
| 客户看到 SUCCESS | 订单 `RECHARGE_SUCCESS`（两路线同一时点：取消续费确认后，D-240 撤回早交付后的统一成功） | 同 |
| 落表 | `provider_calls` + `recharge_attempts` | `browser_runs` / `browser_operations`（PAYMENT_SUBMIT → CONFIRMED → PLUS_ACTIVATED → CANCELLATION_CONFIRMED）+ `recharge_attempts` |

两路线在 v1 层共用：订单状态机、`recharge_attempts`（资金栅栏）、消费账本、CDK 退回规则。差异只在 SUBMIT 之后的执行细节。

### 1.2 付款结果不明时
| | API | Browser |
|---|---|---|
| 进入 | `createDirectOrder` 超时/5xx → `markAttemptUnknown` → 订单 `SUBMIT_UNKNOWN`、资金 UNKNOWN | 点击后读不到结果 → `markPaymentUnknown` → 同 |
| 自动恢复 | **没有**。`markAttemptUnknown` 不排任何后续任务；`POLL_RECHARGE` 只在提交成功时才排（`recharge-attempt-repository.js:472-484` vs `:653`） | 常驻 lane 的补核步骤：5 分钟窗口内每 5s 只读复核（`confirmPlus` → `confirmCancellation` → `reconcile`）→ 确认则自动收口；到期没定 → `HUMAN_REQUIRED` |
| 历史 | **0 次** | **14 次**：6 次自动补核成功、8 次人工（4 关闭、3 判失败、1 推回处理中） |
| 人工收口入口 | 无正式入口（只能手写 SQL） | 后台 `RESOLVE_UNKNOWN_PAYMENT`（CHARGED / NOT_CHARGED） |

### 1.3 20 单成功是怎么成的
| 路线 | 谁收口 | 单数 | 建单→成功平均 |
|---|---|---|---|
| Browser | 系统自动 | 6 | 279 秒（150～665） |
| API | worker 自动 | 4 | 1670 秒（430～3259） |
| Browser | 人工（ADMIN/OPERATOR） | 11 | 数小时～数天 |
| API | 人工 | 4 | 数天 |

**20 单里自动跑完的 10 单，人工收口的 10 单。** 账本「不把 20 全算自动成功」是对的。

### 1.4 失败在哪
- Browser 45 单：付款前取消 10、`CHECKOUT_DRIFT` 10、结账导航失败 7、人工核实未扣款 4、观察失败 4、`CARD_DECLINED` 3、访问被拦 2、其余 5。**付款前的抓取类失败（DRIFT + 导航 + 观察 + 被拦）= 23，占一半**；真拒付只有 3。
- API 11 单：ZZSHU 确认失败 5（**零原因**）、付款前取消 4、提交被拒 1。
- Browser run 终态：`FAILED_SAFE/NOT_STARTED` 58、`FAILED_SAFE/PAYMENT_ARMED` 13（填好了没点，现场保留等人）、`COMPLETED` 8、`DECLINED` 4、`UNKNOWN` 3。
- D-239 的「付款前失败真因落库」刚上（09-16），还没有新样本。

### 1.5 现有的人工兜底点（「需要我处理」的来源，散在三处）
**订单态**：`WAITING_FOR_SESSION`（13 次：Session 无效 5、账号已是 Plus 2、其他 6；结局 8 关闭、3 成功、2 失败）· `RECONCILIATION_REQUIRED` · `CANCELLATION_REVIEW_REQUIRED`（1 次，人工确认后成功）。
**run 态**：`HUMAN_REQUIRED`（补核到期）· `RECONCILE_ONLY`（崩溃）· `PAYMENT_ARMED` 现场保留（付款前失败、等 90s 运营接手）· 人机验证门（`BROWSER_HUMAN_VERIFICATION`）。
**后台动作**（`browser-admin-service` 9 个 + 3 个订单动作）：REQUEST / FREEZE / TRANSFER / RELEASE_SAFE / MARK_PAYMENT_UNKNOWN / CONFIRM_MANUAL_PAYMENT（PLUS_ACTIVE / UPGRADED_20X）/ COMPLETE_20X / CANCEL / RESOLVE_UNKNOWN_PAYMENT（CHARGED / NOT_CHARGED）；订单：手动取消续费确认、关单、客户付款登记。
**告警**：18 类里推手机的靠 `PHONE_SILENT_TYPES` 排除法（面四再审）。

### 1.6 Pro 现状（D-245 后）
- Browser：结账导航已有 5x/20x 的 tier 控件（`chatgpt-checkout-navigator.js:204-205`），但只在 `plan-change` 期望下用；组合层结账计划固定 `plus`（`shared-live-composition.js:210`）；`confirmPlus` 只认 plan 含 `plus`（`chatgpt-post-payment-verifier.js:237-254`）；付款后动作对 Pro 是 `UPGRADE_DIALOG_STOP`（退休）。
- API：ZZSHU 合同只写 `planType=plus`（`PROVIDER_BASELINE.md:19`，`对接api.md` 全是 plus）；传 pro 能不能充**未知**。
- 路线 305/306 已关。

### 1.7 Session
- 来单门槛：accessToken 剩余寿命 ≥ 1800s 才接（`session-validation.js`），不够直接 `WAITING_FOR_SESSION` 打回。
- 付款后：API 把 ZZSHU 返回的 `latestSession` 存回订单；Browser 不存（付款后浏览器里的 Session 是新的，D-134）。

## 2. 你说过要什么
- 客户成功 = Plus 确认 + 取消续费 + 内部核对完成后；不展示取消（D-240 最终）。
- 付款不明先 verify 消解：已开通 → 交付；未开通未扣款 → 可安全重试；定不了 → 才人工（D-227）。
- 付款不明禁重付/换卡/换执行器；崩溃先对账（CLAUDE.md）。
- Pro 与 Plus 同型，只换套餐；两阶段退休（D-245）。
- 「需要我处理」只放系统真解决不了的；其余不进队列不推手机（V2 §3.3）。
- 有界只读重试可以，不重跑整单（D-240）。
- 稳定、不臃肿；接口三段统一「不做会死吗」要再问（§5 减法审查）。

## 3. 我看到的真正问题
1. **一半成功单靠人收口。** 自动跑完的只有 10 单。而人工收口的路径（后台 9 个动作 + SQL）比自动路径还多。
2. **API 路线付款不明没有自动恢复。** 历史 0 次是运气（ZZSHU 一直没超时），不是设计。真发生了只能手写 SQL。
3. **Browser 失败的一半是付款前抓取问题**，不是付款问题。这一块刚上诊断落库，样本还没攒到，现在改是猜。
4. **Pro 在 Browser 侧要改三处 + 一次非付款 PoC**（结账选套餐、确认认目标套餐、取消续费同）；API 侧合同没写 Pro。
5. **「需要我处理」没有一张清单。** 来源散在订单态、run 态、告警三处，控制面（面五）没法做队列。V2 §7 说「哪些算系统解决不了」只有你能画。
6. **A1「接口三段统一」不做会死吗？不会。** 两路线在 v1 层已经共用状态机和资金栅栏；差异只在执行细节，而这些细节两边天然不同（ZZSHU 一次做完 vs Browser 四步）。统一接口是加一层抽象，不是减法。
7. 时延：Browser 自动 2.5～11 分钟，API 7～54 分钟（ZZSHU 侧）。离基线「一分钟上下」远，但你定了稳定优先。

## 4. 我建议怎么做

**E1 · 不做接口三段重构，改做「两路线交付契约」三张表 + 测试**（替代 A1 + A2）
- 表一「交付判据」：目标套餐确认 + 取消续费确认，两路线各自实现，测试断言两边在同一条件下才置 `RECHARGE_SUCCESS`。已成立，只补测试和文档。
- 表二「付款不明处理」：两路线都是「先 verify 再定」。Browser 已有；**API 补一条**：`markAttemptUnknown` 后排 `POLL_RECHARGE`（有 `cardKey` 就按 key 查 ZZSHU；没有 key 的不明 → `RECONCILIATION_REQUIRED` 人工，并给后台一个 RESOLVE 入口，不再手写 SQL）。
- 表三「人工兜底点唯一清单」：把 1.5 的三处来源合成一张表，每行写「触发条件 / 系统能做到哪 / 人要做什么 / 后台哪个按钮」——**这张表就是面五「需要我处理」队列的输入，也是面四「推不推手机」的判据**。
- 代价小：不碰付款路径；API 补一个任务排布 + 一个后台动作。

**E2 · Pro 同型改造（Browser）**
- 结账按订单 plan 选 tier（navigator 已有控件，改 `expect` 为 checkout）；`confirmPlus` 改 `confirmPlan(target)`；取消续费不变；`postPlusAction` 只剩 `CANCEL_RENEWAL`，删 `UPGRADE_DIALOG_STOP` / `MANUAL_20X_HANDOFF` / `COMPLETE_20X` 整条线。
- **前置**：一次非付款 PoC（free 测试号，选 20x 走到 Checkout 报价页停住，读报价/税/币种），冻结到 `docs/contracts/`，再改执行器。
- API 侧 Pro：不在本面赌。要么明确「Pro 只走 Browser」，要么 C2 之后再验一次 `planType=pro_20x`。

**E3 · 付款前抓取失败：先攒样本，不在 V2 里赌修法**
- D-239 诊断已落库，跑演练或等真单就有「≥2 邮箱框 / 填超时 / 格式」的分类；有了再定 A 方案对不对（D-238）。本面不加新机制。

**E4 · 时延不作本轮目标。** 稳定优先，先把自动跑完的比例从一半提到接近全部（E1 + 面二供卡 + E3 攒样本），再谈快。

**不做 / 删**：A1 接口三段、`fromPlan`、早交付、`UPGRADE_DIALOG_STOP` / `MANUAL_20X` 整条线、`COMPLETE_20X` 后台动作。

## 5. 要你定 / 答的
1. **A1「接口三段统一」不做，改为三张契约表。** 认不认？
2. **Pro 是否明确只走 Browser？** 认的话 API 侧不再验 Pro，路线 305/306 以后也只开 Browser 的。
3. **「需要我处理」的边界，请你勾。** 下面是现有全部人工点，每个请你标：A 必须叫我 / B 系统应该自己解决 / C 不该出现（该在更早处挡住）：
   - 客户 Session 无效或剩余不足 30 分钟（现：打回等换）
   - 客户账号已是 Plus（现：打回等换）
   - 付款前填表失败、现场保留（现：等你 90 秒接手，不接判失败退码）
   - 结账页出现人机验证（现：等你点，超时判不明）
   - 付款结果不明、5 分钟补核定不了（现：HUMAN_REQUIRED）
   - 付款后取消续费一小时没确认（现：CANCELLATION_REVIEW_REQUIRED）
   - Browser 进程崩溃、run 无终态证据（现：RECONCILE_ONLY）
   - 缺卡（面二后：自动开，开不出才叫）
   - 卡台 token 过期 / 卡台故障（面二后：叫）
   - ZZSHU 确认失败零原因（现：直接判失败退码）
4. **付款前抓取类失败先攒样本再改**，不在 V2 里赌修法。认不认？
5. **客户被打回后 8/13 不回来。** 要不要把「Session 至少剩 30 分钟」这个门槛放到客户页第一步就提示（面五展示面的事，先要你的态度）。

## 6. Lemon 的回答（2026-09-17）、我的理解与三处待确认

**五答**：①A1 不做、改三张契约表——认可；②Pro：让我查 ZZSHU 文档（https://card.zzshu.pro/）看 API 支不支持，同时希望 Pro 也能走 Browser；③「需要我处理」勾选见下表；④付款前抓取失败先攒样本——认；⑤客户页第一步就提示「Session 至少剩 30 分钟」——要。

**②的核实结果（证据：`docs/contracts/2026-09-17_zzshu-third-party-api-plans-excerpt.md`）**：ZZSHU 三方接口文档明确 `planType` 取值 `plus` / `pro5` / `pro20` / `plus_to_5x` / `renew_20x`，其中 `pro5` / `pro20` 是给**免费账号**正价开通。→ **API 路线能充 Pro，且是一次付款同型**（与 D-245 一致）。我们代码只传过 `plus`，要把 `pro_5x` → `pro5`、`pro_20x` → `pro20` 映射；真单验证一次。另：仓库里的 `对接api.md` 是另一个系统（GPT-KCCatk）的文档，此前被当 ZZSHU 合同引用属误，已在摘录文件里注明。**结论：Pro 两条路都走**（Browser 按 E2 改，API 加映射 + 验一单）。

**③勾选表 + 我的理解（A 必须叫 / B 系统自己解决 / C 不该出现）**：

| 情况 | 你的勾 | 我理解成 | 待确认？ |
|---|---|---|---|
| Session 无效 / 剩余不足 30 分钟 | B | 系统自动打回客户换，不叫运营；配合⑤前置提示让它少发生 | 否 |
| 账号已是 Plus | B | 同上 | 否 |
| 付款前填表失败、现场保留 | A | 保持等你接手；接手窗口与退码规则不变 | 否 |
| 结账页人机验证 | A | 保持等你点 | 否 |
| 付款不明、5 分钟补核定不了 | **C** | **补核必须自己定得了**：靠两路证据——账号状态 + **卡台侧扣款记录**。后者 highvcc 现在没入库（G1），所以 G1 是这条的前置；窗口可放长（比如 30 分钟）；两路证据一致才收口，不一致才是真异常 | **是**：这样理解对吗？ |
| 取消续费一小时没确认 | **C** | 系统重试直到成功，不叫人。Browser 侧是自己调取消接口，可重试；**API 侧 ZZSHU 会返回最新 Session，可以用它复用 Browser 侧的取消能力自己去取消**，不再干等 ZZSHU | **是**：这样理解对吗？ |
| Browser 崩溃、run 无终态 | B | 重启后自动走补核（同上一条的两路证据）对账，不再直接人工 | 否 |
| 缺卡 | A | 面二：自动开，开不出才叫 | 否 |
| token 过期 / 卡台故障 | A | 叫 | 否 |
| ZZSHU 零原因失败 | **A** | **两种意思差别大**：(a) 照旧判失败退码、但推手机让你知道；(b) 不退码、订单停住等你看过再定 | **是**：a 还是 b？ |

**⑤**：归面五（展示面）；这里记需求：客户页验码后、贴 Session 前就说明「Session 至少要剩 30 分钟，怎么取新的」。

**对 E1～E4 的修订**：
- E1 表二「付款不明」升级：不是「先 verify 再定」，是「两路证据（账号 + 卡台扣款）自动定，窗口放长，定不了才异常」；G1（highvcc 交易入库）从面四前置提到本面前置。API 补 `POLL_RECHARGE` 不变。
- E1 表二加一行「取消续费未确认」：重试到成功；API 单复用 Browser 的取消能力（用 ZZSHU 返回的 Session）。
- E1 表三用上表定稿。
- E2 Pro：Browser 按原 E2；**API 加 `planType` 映射 + 真单验证**。
- 崩溃：`RECONCILE_ONLY` 不再是终点，重启后进补核。

## 7. Lemon 对三处的回答（2026-09-17）与定稿

1. 付款不明：「没想好就写了 C。之前很多时候付成没付成都让我介入，搞烦了。希望尽量系统层面解决，实在解决不了再叫我。主要是准确率问题，别总谎报。」→ **定为**：补核靠两路证据（账号状态 + 卡台侣扣款记录）自动定，窗口放长；**定不了才叫，叫的时候必须带两路证据的结果**（不许「不知道」就叫）。历史 14 次不明里 8 次人工，其中 4 关闭 + 3 判失败 = 大多数其实没扣款，正是「谎报」的实证。G1（highvcc 交易入库）是这条的前置。
2. 取消续费：「ZZSHU 几乎不会取消不成功；就算没取消，那就算了，到时候提醒我，还有销卡呢。」→ **定为**：API 单取消续费超时**不再阻塞交付**（去掉 `CANCELLATION_REVIEW_REQUIRED` 卡订单），订单照常成功、推手机提醒、该卡进待销清单（面二⑩）。Browser 单自己调取消接口、可重试，失败同上处理。
3. ZZSHU 零原因失败：**b**——不退码、订单停住等 Lemon 看过再定（进「需要我处理」，带 ZZSHU 原始响应）。

**面三定稿（写进账本）**：E1 三张契约表按 §6/§7 修订；E2 Pro 两条路（Browser 三处改 + 非付款 PoC；API `pro_5x→pro5`、`pro_20x→pro20` + 真单验证）；E3 攒样本；E4 时延不作目标；崩溃进补核不进人工；客户页前置 Session 提示归面五。
