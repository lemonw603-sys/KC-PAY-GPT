# Browser LIVE P0 第二批实现与核验记录｜2026-09-06

## 1. 结论边界

提交 `bc8ee2f` 已完成单订单 Browser LIVE 本地候选的运行组装和付款后恢复闭环代码。它不是生产部署，也不是一笔真实付款验收。

当前仍保持：

- 生产 release：`/opt/pojia/releases/20260906-import-errors-c6e9f48`；
- `pojia-browser-worker.service=inactive/disabled`；
- 数据库 `browser_payment_writes_enabled=false`；
- 旧自动开卡 timer `inactive/disabled`，`card_auto_replenishment_enabled=false`；
- 未填写真实卡、未点击付款、未创建新订单。

## 2. 本批完成项

1. 新增独立 `production-live-worker.js`，只接受：
   - `--check`：付款进程开关和数据库付款开关必须为 false，不要求订单号或付款确认；
   - `--once`：付款双进程开关必须为 true，数据库付款开关和 Profile 生产权限必须为 true，并精确绑定一个订单及确认字符串。
2. LIVE Worker 只使用本机 BitBrowser Local API 与一个明确 Profile；Provider 开卡、补余额和通用写开关必须全部为 false。
3. HNSKJ API Key 只允许在 `PROVIDER_READS_ENABLED=true` 时用于付款后的只读交易核验；手工备用卡不要求 Provider Key。
4. 新增路线化卡交易核验：
   - HNSKJ：只接受付款 intent 时间窗内、成功、金额合理且商户匹配的唯一交易；歧义、多笔、过期或其他商户均不确认；
   - 手工卡：以同一 run 的 Browser Plus 确认与共享消费账本收口，不伪造 Provider API 交易。
5. 账单地址补全以实体卡 ID 作为稳定绑定参考：导入卡自带地址优先保留；没有地址的 HNSKJ 卡从固定版本本地 MockAddress 数据集分配，并通过 MySQL 保存。
6. 新增付款后专用 Session 来源，只接受两种权威状态：
   - `PAYMENT_UNKNOWN / SUBMIT_UNKNOWN / UNKNOWN`；
   - `PAYMENT_CONFIRMED` 但 Plus/取消续费尚未收口。
7. 付款确认与后续核验计划在同一数据库事务中建立。即使进程在确认付款后立刻崩溃，后续也可只读恢复，不需要再次点击。
8. UNKNOWN 恢复严格按批准订单过滤；重开同一 BitBrowser Profile、注入同一订单 Session，只读核对 Plus、取消续费和卡交易，不持有付款 adapter。
9. 成功恢复后统一收口：付款确认、Plus 激活、取消续费、订单/attempt/run、消费账本、assignment 和 dispatch；超时或冲突只升级该订单为人工处理，不暂停其他订单。

## 3. 对抗审查后修正

- 未采用“先读取 100 条 UNKNOWN 再在内存过滤订单”的实现，因为大量旧 UNKNOWN 会把批准订单挤出窗口；改为 SQL 直接限制 `order_id`。
- 未把普通同金额消费当 OpenAI 交易；Provider 返回商户名时必须匹配 OpenAI/ChatGPT。
- HNSKJ 交易必须位于付款 intent 的有界时间窗，不能用历史同金额交易误确认本单。
- 未只靠后续调度补救付款确认后的崩溃；`markPaymentConfirmed` 本身原子写入后续核验时间窗。
- 未把“账号仍 FREE”单独解释为明确拒付。没有确定性拒付证据时继续 UNKNOWN，最终只升级本单人工处理。

## 4. 验证证据

### 自动测试

```text
browser-mvp: 151 total / 147 pass / 4 environment skip / 0 fail
v1:          552 total / 505 pass / 47 environment skip / 0 fail
npm run check: pass
git diff --check: pass
```

跳过项均依赖隔离 `TEST_DATABASE_URL`，不是失败。本批新增的配置、交易匹配、Session 后置来源、UNKNOWN 订单过滤、状态收口和 CLI 模式均有非跳过测试；既有 MySQL 支付集成测试仍需在隔离 MySQL 环境补跑。

### 本机现场

```text
代理单实例：READY
mihomo PID：45732
代理出口：38.60.246.34
BitBrowser Local API：READY
ChatGPT Profile：7 个
Pilot Profile：HTTP 200 / 正常 ChatGPT 标题 / 无 Cloudflare challenge
BrowserContext：1
付款提交：0
```

本机现场只验证公开页面与 BitBrowser/CDP 生命周期，不注入客户 Session、不进入真实订单、不填写卡片。

### 生产只读现场

```text
current=/opt/pojia/releases/20260906-import-errors-c6e9f48
Web=active/enabled
API Worker=active/enabled
Browser Worker=inactive/disabled
旧自动开卡 timer=inactive/disabled
/health/live=ok
/health/ready=ready
migration=048_manual_backup_card_import
browser_dispatch_enabled=true
browser_payment_writes_enabled=false
card_auto_replenishment_enabled=false
活动 Browser run=0
ACTIVE/UNKNOWN 充值资金=0
活动 Browser dispatch=0
活动开卡任务=0
```

## 5. 尚未完成与下一步

1. 尚未在隔离 MySQL 跑 4 个环境跳过的 Browser 集成测试；部署前必须补齐，或明确记录无法建立隔离库的事实，不能把跳过写成通过。
2. 尚未用生产数据执行 LIVE `--check`；本批代码未部署，生产 release 不包含该入口。
3. 尚未完成“真实订单但付款关闭”的卡→地址→邮箱→PHP 零税重报价回归；需要先部署候选，并以不产生付款的模式验证。
4. 尚未核对用户充值后的卡片权威余额/资料。
5. 尚未获得本次真实付款的最终操作确认；任何部署都必须先保持付款关闭。

因此下一阶段是：构建单一 commit release → 部署但保持付款关闭 → LIVE `--check` 与单 Profile 订单级非付款回归 → 核对卡片 → 再让运营提交新 CDK+Session。只有到最终 PHP 零税快照和数据库租约全部通过时，才单独请求一次付款确认。
