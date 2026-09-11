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

## 第 3 次（待跑，账号 mengx612）

目标：一次跑到第 12 步。此次起大脑不代操作（D-160），不预清窗口、不预校验 Session。
