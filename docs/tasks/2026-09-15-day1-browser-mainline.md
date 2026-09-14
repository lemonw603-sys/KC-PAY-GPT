# 任务书 · Day 09-15 · Browser 主线能跑真单且失败可诊断

> 粒度按 D-151：只写目标 / 验收 / 边界 / 定位提示，不写实现路径。验收按 D-222：测试 + 现场脚本 + 生产只读复验，不用时间、不信自述。
> 背景：今日 hnskj 卡台服务器故障、开不了卡（D-223/CURRENT_STATE），API 路线无卡；今天主线只能是 Browser（可分配卡 `1657` 一张，Plus 门槛够 1 单）。

## T1 · A3 账本推算口径发布 + 手动开卡入库记真实金额

- **目标**：让分卡口径用 MIN(同步余额, 账本推算)（工作区已改），并让手动补钱/开卡的卡在库里记的是真实开卡金额，不是恒定的 16。
- **验收**：①生产 `card-inventory-eligibility.js` md5 == 工作区那份；②一个单测：手动开卡入库后 `funded_amount` = 实际开卡金额；③发布含 `restart pojia-worker`（D-220）；④发布后独立核实（新 ssh）`state-check.sh` 全一致。
- **边界**：**前提是 Lemon 已关 `card_balance_recharge_enabled`（D-223）**；发布是生产动作，`switch` 前必须问 Lemon；不动 ZZSHU、不动付款路径。
- **定位提示**：`v1/src/services/card-inventory-eligibility.js`、`card-stock-service.js:260`（COALESCE 那处）、`scripts/deploy-release.sh`。

## T2 · 诊断存库：fill-billing-email 三种死因落 DB（D-214/D-209）

- **目标**：Browser 付款前的失败诊断（尤其 `fill-billing-email` 的"邮箱格式 / 找到≥2个 / fill 超时"三选一）写进数据库，接班和运营不必翻本机日志缓冲。
- **验收**：制造一次真实失败后，`browser_run_events`（或订单 `failure_reason`）里能查到确切死因字符串；一个单测覆盖三种死因各自的落库文本。
- **边界**：只加观测，不改判定逻辑；诊断文本不得含完整卡号/CVV/token（CLAUDE.md 日志红线）。
- **定位提示**：`browser-mvp/src/billing-address-fill.js`、`live-chatgpt-payment-adapter.js`、`shared-runtime-integration.js`、`v1` 侧 `browser_run_events` 写入点。
- **外部依赖**：需一次真实失败样本；日常单量低，可能用 rehearsal 兜（rehearsal 账号状态与真实客户不同，诊断可能不完全等价，须标注）。

## T3 · 切换校验 + 切路线解耦卡台（A2 / D-219 发现 5）

- **目标**：后台切路线时，若目标路线无可分配卡则拒切并给出原因；且切路线不再连带自动改卡台。
- **验收**：①单测：目标路线卡池为空 → 切换被拒 + 返回可读原因；②切一次路线后 `browser_card_source_switch_events` 不新增（解耦）；③后台点切换时行为符合前两条（只读复验事件表）。
- **边界**：只加校验与解耦，不改既有路线数据；切换仍由 Lemon 在后台点，不绕过鉴权写库。
- **定位提示**：`v1/src/services/provider-route-admin-service.js`、`provider_route_switch_events` / `browser_card_source_switch_events`。

## T4 · 免费试用入口识别（决定① / D-216）

- **目标**：执行器能识别 "Start your free trial" 类免费试用入口，不把它当异常中止；付完记"本单零成本、续费必须取消"。
- **验收**：单测对着 D-216 那单的真实页面文本断言识别成功（不是自造夹具，D-172 惯犯 C）。
- **边界**：只做识别与标记，不改付款提交；免费试用**不拦**（Lemon 决定①）。时间不够可挪 09-16。
- **定位提示**：`browser-mvp/src` 的 checkout 导航 / adapter。

## 收尾（说"做完了"之前）

- `scripts/wrapup-check.sh` 全绿；`browser-mvp/scripts/state-check.sh` 一致；改到的模块跑针对性测试 + 全量。
- 当轮落盘：生产状态变化改 `CURRENT_STATE`，决策进 `DECISIONS`，`HANDOFF_NOW` 覆盖重写。
