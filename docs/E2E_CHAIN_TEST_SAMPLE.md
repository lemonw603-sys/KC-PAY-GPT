# 完整链路测试样本（Browser 自动充值）

本文是"客户下单 → 系统自动充值完成"整条链路的参考样本。每次完整链路测试按同一结构记录，供以后比对与回归。
记录原则：只写观察到的原始事实与证据出处；结论单列。大脑负责启动、观察、记录，**不替系统操作页面**（D-160）。

## 链路应有的样子

| # | 环节 | 由谁做 | 证据出处 |
|---|---|---|---|
| 1 | 客户提交 CDK + Session | 客户（测试中为 Lemon） | `orders` 行、`order_events` |
| 2 | 分配卡片 → CARD_READY | 服务器 worker（ASSIGN_CARD / PREPARE_RECHARGE） | `tasks`、`card_assignment_history` |
| 3 | 排出浏览器派工任务 | 服务器 worker（SUBMIT_RECHARGE） | `browser_dispatch_jobs` |
| 4 | 开付款开关 + 拉起本机常驻池 | 运营（`go-live.sh --arm`） | `admin_setting_events`、go-live 日志 |
| 5 | 登录客户账号并核对身份、判定 free | 系统（一次登录，D-158） | `browser_run_events` 的 `session-bootstrap` / `account-readonly-probe` |
| 6 | 打开购买页、创建结账页 | 系统 | `checkout-navigation`（`checkoutCreated`） |
| 7 | 填卡、账单地址、（如有）收据邮箱 | 系统 | 适配器阶段；失败则付款前安全中止 |
| 8 | 零税重报价核对 | 系统 | 报价币种/金额/税额 |
| 9 | 点一次付款 | 系统 | `browser_operations` 的 `PAYMENT_SUBMIT`（**有且仅有一条**） |
| 10 | 人机验证（若出现） | **人**勾选，系统等待后继续（D-153/154/159） | 日志 `需要人工验证`、`human-verification-gate` |
| 11 | 确认 Plus 已生效 | 系统 | `recordPlusActivation`、`post_payment_state` |
| 12 | 取消自动续费并确认 | 系统 | `cancellation_confirmed_at`、`subscription_cancelled` |
| 13 | 收工：停 worker、关付款开关 | 运营（`stop-live.sh`） | `admin_setting_events` |

## 每次记录的固定字段

- 订单号 / 账号 / 窗口 / 卡尾号 / 出口 IP
- 各环节时间戳（UTC）与是否通过
- 走到第几步、卡在哪一步、原始报错码
- 资金结论：是否点击付款、是否扣款（ChatGPT 订阅状态 + 卡台余额，两个独立来源）
- 收尾：订单终态、卡与 CDK 去向
- 本次暴露的问题与已修项

---

## 第 1 次（2026-09-11，账号 shichuan003）——走到第 10 步被拦

走到：第 9 步点击付款一次 → 第 10 步人机验证出现，当时系统尚无识别能力，静默等待 5 分钟后判「付款结果未知」。
资金：**未扣款**（账号仍 `chatgptfreeplan` / `chatgpt_not_purchased`；卡 9839 卡台余额 $50 未变）。
收尾：`resolve-unknown-payment.mjs` 记 NOT_CHARGED → 订单 CLOSED，卡回池；CDK 因 F-48 未退回，修复后补退。
暴露并已修：F-47（失败无原因）、F-48（CDK 不退回）、D-155（人机验证识别与接力）。

## 第 2 次（2026-09-11，账号 mengx612）——走到第 7 步中止

走到：第 6 步结账页创建成功 → 第 7 步填完卡与账单地址后，因该版结账页**没有收据邮箱字段**而代码要求必填 → 付款前安全中止 `CHECKOUT_DRIFT`。
资金：**未点击付款、未扣款**（`browser_operations` 无 `PAYMENT_SUBMIT`）。
收尾：系统自动 RECHARGE_FAILED，卡与 CDK 自动退回。
新事实：ChatGPT 有两套结账页实现（`cs_live_` 有邮箱、`oaics_` 无邮箱且界面为他加禄语）。已修（D-157）。
本次全程**未出现人机验证**。

## 第 3 次（2026-09-11 10:48 UTC，账号 mengx612，Pilot 窗口，卡 9839）——走到第 9 步被发卡方拒付

大脑全程未代操作（D-160）：未清窗口、未关标签、未手工校验 Session，系统自行完成。

| 时刻(UTC) | 环节 | 结果 |
|---|---|---|
| 10:30:21 | 提交 → 分卡 → 排派工 | 通过；**无预检任务**（D-158 生效），SUBMIT_RECHARGE 由服务器直接完成 |
| 10:33:08 | 运行开始 | |
| 10:33:22 | 注入会话登录 | 通过（14 秒） |
| 10:33:29 | 核对身份、判定 free | 通过（只登一次） |
| 10:33:32 | 校验卡材料 | 通过 |
| 10:34:05 | 点 Upgrade、创建结账页 | 通过（32 秒，`oaics_` 版） |
| 10:34:44 | 填卡、账单地址、零税重报价 | 通过（39 秒；**无邮箱字段亦不再中止**，D-157 生效）。报价 ₱982.14 / 税 ₱0.00 |
| 10:34:44 | 点付款（仅一次） | 通过 |
| 10:39:55 | 等 Plus 生效 5 分钟未果 → 判付款未知 | **卡在这里**：实为发卡方拒付，页面红字「Tinanggihan ang iyong kard.」，系统当时不读页面 |

资金：**未扣款**（卡 9839 卡台余额 $50.00 未变；页面明示拒付）。本次**未出现人机验证**。
暴露并已修：F-47 → D-161（付款后先读结账页，拒付秒级识别并带原因）。
观察项：付款后卡号仍显示在页面上（清空是尽力而为，提交后页面重渲染导致未清掉），记为待办。
待办：Lemon 去卡台换一张新卡后重跑第 4 次。

## 第 4 次（2026-09-11，账号 mengx612，Pilot 窗口，**新卡 3118 / 卡段 53211304**）——**全链路跑通**

大脑全程未代操作：未清窗口、未关标签、未手工校验 Session。

| 时刻(UTC) | 环节 | 结果 |
|---|---|---|
| 11:10:03 | 客户提交 CDK+Session → 分卡 3118 → 服务器排派工 | 通过（无预检任务） |
| 11:11:33 | 开付款开关 + 拉起常驻池 | 通过 |
| 11:12:46 | 注入会话（指纹 `3eb73734`，与前三单各不相同） | 通过 |
| 11:13:00 | 核对身份、判定 free | `identityMatched=true`、`subscriptionStatus=FREE`、`alreadyPlus=false`（D-158 的检查在正式流程内生效） |
| 11:13:36 | 创建结账页（指纹 `3f96dd77`，全新） | 通过 |
| 11:14:09 | 填卡/地址/零税报价 → **点付款一次** | 通过 |
| 11:14:53 | 页面未给出明确结果 → 判「付款结果未知」并锁定 | 设计中的安全中转，非失败 |
| 11:14:58 | 付款后核实通道接手（第 1 次检查，另开页面查完即关） | |
| 11:15:15 | **确认 Plus 生效 + 自动取消续费 + 订单收为成功** | `PLUS_ACTIVATED` / `CANCELLATION_CONFIRMED` / `PAYMENT_CONFIRMED` |

- **资金**：卡 3118 $60.00 → **$44.24**，实扣 **$15.76**（其后 $39.24 是 Lemon 本人把约 $5 提回卡台钱包所致，与本单无关，D-171）。
- **独立核实（直接问 ChatGPT 接口，非本方数据库）**：`chatgptplusplan`、`has_active_subscription=true`、到期 2026-10-11、**`will_renew=false`**、来源 `chatgpt_web`。
- **本次无人机验证**。窗口事后只剩 1 个 chatgpt.com 标签，核实通道开的页面已自行关闭，无残留。
- **决定性差异**：前四次拒付全在卡段 513989，本次换 53211304 一次通过。样本仍小，但这是唯一被改动且直接命中结果的变量。

### 本次证实可用的能力

一次登录完成身份核对与 free 判定（D-158）；两套结账页实现都能处理（D-157）；付款只点一次；「付款结果未知」由自动核实通道兜住并自行收口（此前从未在真单成功）；自动取消续费并二次确认；卡与消费账本自动结算。

### 大脑本次的失误（记录以免重犯）

轮询时把中间态 `RECONCILE_ONLY` 当成终态跳出循环，拿过期快照向 Lemon 报了「失败」，实际系统在 22 秒后已收为成功。**下结论前必须重新读一次当前状态**，这是既有规则，被违反了。


## 第 5 次（2026-09-13，账号 chmilacml，Pilot 窗口，卡段 53211304）——**D-187 之后首次全自动跑通，2 分 30 秒**

> 固定这一单的目的：**证明这条链路在当前代码下可以无人干预跑通**，并给出可复现的全部条件。
> 当天前五单连续失败（原因各不相同，见 D-190），这是第六单，一次过、无人机验证、无任何人工介入。

### 运行条件（复现必须对齐这些）

| 项 | 值 |
| --- | --- |
| 生产 release | `20260912-token-login-616255c` |
| 执行器代码 | `0243a26`（2026-09-13 01:05:15 +08:00）——进程于 **2026-09-12 17:58:42 UTC** 启动并加载 |
| 执行器包含的关键修复 | D-187 首次即替换登录态（`04d311b`）、**注入前关掉旧标签页**（`c8f1dbf`）、刷新链断了就停（`88710ed`）、人机验证识别（`0243a26`） |
| 窗口 | BitBrowser `Plus Browser PH Pilot`（`10f0dc7b…`），lane-1 |
| 出口 | 菲律宾 38.60.246.34（mihomo 17897） |
| 卡 | 卡段 `53211304`，余额 $39.24，`MANUAL_IMPORT` |
| 账单地址 | 美国 DE 州（免销售税，`BROWSER_BILLING_ADDRESS_STATE`） |
| 开关 | 付款 true、接单 true；非终态订单 0、账号槽 0 |
| 客户账号 | `chmilacml@gmail.com`，付款前 `FREE` |

### 全链路时间线（UTC）

| 时刻 | 事件 | 证据 |
| --- | --- | --- |
| 02:56:57.784 | 客户提交，订单 `CREATED` | `order_events` |
| 02:56:58.433 | 分卡完成 → `CARD_READY`（**0.6 秒**）| 同上 |
| 02:56:58.479 | `RECHARGE_PROCESSING` | 同上 |
| 02:57:08.237 | `observe-page`，BitBrowser 控制建立 | `browser_run_events` |
| 02:57:14.879 | `session-bootstrap`：**关掉 1 个旧标签页**、清 8 个登录 cookie、替换 2 个 session cookie、注入 1 个 | `closedStaleTabCount:1, clearedLoginCookieCount:8, replacedCookieCount:2, cookieCount:1` |
| 02:57:18.344 | `page-reload-after-inject` | 同上 |
| 02:57:23.959 | `account-readonly-probe`：登录成功、身份匹配、**`sessionError: null`**、`FREE` | 同上 |
| 02:57:24.273 | `page-signature` 通过 | 同上 |
| 02:57:27.022 | `card-material-preflight` ready | 同上 |
| 02:57:44.416 | `checkout-navigation`：**`checkoutCreated: true`**，未出现问卷 | 同上 |
| 02:58:42.471 | **`PAYMENT_SUBMIT`**（仅一次）| `browser_operations` |
| 02:59:19.139 | `PAYMENT_UNKNOWN` → 订单 `SUBMIT_UNKNOWN` | 同上 |
| 02:59:28.066 | **`PAYMENT_CONFIRMED` + `PLUS_ACTIVATED` + `CANCELLATION_CONFIRMED`**（同一毫秒）| 同上 |
| 02:59:28.066 | 订单 `RECHARGE_SUCCESS` | `order_events` |

**总耗时 150 秒。全程无人干预，未出现人机验证。**

注意 `SUBMIT_UNKNOWN` 只存在了 **9 秒**：付款后短暂判不确定，验证 lane 自己确认并落定。
这说明判定链路本身很快——之前那些单卡在「不明」几分钟，是因为证据源缺失（D-190 / ROADMAP），
不是机制慢。

### 终态与资金

| 项 | 值 |
| --- | --- |
| 订单 | `RECHARGE_SUCCESS`，`finished_at` 02:59:28 |
| 资金 attempt | `SUCCESS` / `SETTLED` |
| 消费账本 | `CONSUMED` $16.00 |
| 卡分配 | `RELEASED`（成功后释放） |
| CDK | `REDEEMED`（正确消耗，不退回） |
| 卡台实扣 | **1572 分 = $15.72**，`status=PENDING`，交易时刻 02:58:56（距付款提交 **0 分钟**）|
| 卡余额 | $39.24 → 用尽，卡转 `DEPLETED`（低于 Plus 门槛 $16，退出可分配） |

卡台证据由 `v1/scripts/check-card-charge.mjs` 独立核实，与订单记录一致。

### 与当天前五单的差异（为什么这次成了）

前五单的失败原因互不相同，逐条对照：

| 当天失败原因 | 这一单为何没遇到 |
| --- | --- |
| 窗口里是上个客户的登录态 | `closedStaleTabCount:1` + `replacedCookieCount:2`，注入前窗口被清干净（D-187 + `c8f1dbf`）|
| Session 刷新链已断（`RefreshAccessTokenError`）| `sessionError: null`——Session 是当场导出、立刻提交的 |
| 账号有免费试用资格，定价页只给「Claim free offer」| 该账号给的是正常付费入口，`checkoutCreated: true` |
| 找不到唯一的升级按钮 | 同上，页面形态正常 |
| 付款后卡在人机验证 | **本次未触发人机验证**——这一条是运气，不是能力（D-153/D-154 定死不绕过，触发了仍需人点）|

**结论：链路本身可以跑通，当前代码下的失败都来自外部条件（账号形态、Session 新鲜度、风控抽样），
不是链路缺陷。** 但人机验证是否触发不可控，这一项永远需要人在场兜底。

### 第 6 次（同日 03:39–03:43，账号 running.da，**账号自带历史绑卡**）——连续第二单全自动

同样卡段 `53211304`、同样执行器版本，耗时 3 分 40 秒，全自动无人工操作，实扣 $15.72
（卡台 `1572分 PENDING 03:42:45`）。

**这一单单独回答了一个此前悬着的问题：客户账号里已经有历史绑卡时，系统能不能填进我们自己的卡。**

- 第 5 次（`chmilacml`）跑之前，Lemon **手动删掉了**账号里的旧卡；
- 第 6 次（`running.da`）**没来得及删**，账号带着自己的历史绑卡直接跑 —— 照样成功，
  钱扣在我们的卡上。

两单是**不同账号**，所以第 6 次不是沾第 5 次删卡的光。**结论：系统自己能填，运营不必替它删卡。**

两层保障，最坏结果只是失败、不会扣错钱：

| 层 | 内容 |
| --- | --- |
| 事实 | 账号有旧卡时，ChatGPT 结账页仍提供新卡输入框（卡号/有效期/CVV），系统填入并用我们的卡付款 |
| 设计 | `CHATGPT_PLUS_CHECKOUT_CONTRACT` 写死 `inspectSecureCardFields / requireSecureCardFields: true`（`checkout-observer.js:100-101`），三个输入框缺任一即在**付款前中止**（同文件 174 行），绝不退化成使用客户已保存的卡 |

**限定**：带历史绑卡的账号目前只有这一个真实样本。若将来某账号的结账页只给「使用已保存的卡」，
系统会中止并留下错误码，届时日志可辨；但钱不会走错。

### 可复现的前置检查（提单前做，当天教训）

1. 在目标账号打开 `chatgpt.com/#pricing`：按钮是「Upgrade to Plus」才提；是「Claim free offer」
   说明有免费试用资格，**没有结账流程可走**，换号。
2. 打开 `chatgpt.com/api/auth/session`：返回里**不能有 `"error"` 字段**。
   有 `RefreshAccessTokenError` 说明刷新链已断，提了必在进结账时被拦。
3. Session 当场导出、立刻提交，导出后不要在别处再刷那个号（刷新令牌一次性）。
4. 价格必须是**免税价 ₱982.14**；₱1,100 是含税价，系统会在付款前中止（三道闸门见
   `docs/ADMIN_CONSOLE_MAP.md` 一·五）。
