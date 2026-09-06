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

1. 已在临时 MySQL 8.4 隔离库补跑完整 Browser 套件：`154/154/0/0`，原环境跳过项全部实际执行。
2. 尚未用生产数据执行 LIVE `--check`；本批代码未部署，生产 release 不包含该入口。
3. 尚未完成“真实订单但付款关闭”的卡→地址→邮箱→PHP 零税重报价回归；需要先部署候选，并以不产生付款的模式验证。
4. 尚未核对用户充值后的卡片权威余额/资料。
5. 尚未获得本次真实付款的最终操作确认；任何部署都必须先保持付款关闭。

因此下一阶段是：构建单一 commit release → 部署但保持付款关闭 → LIVE `--check` 与单 Profile 订单级非付款回归 → 核对卡片 → 再让运营提交新 CDK+Session。只有到最终 PHP 零税快照和数据库租约全部通过时，才单独请求一次付款确认。

## 6. 第三批对抗审查与隔离 MySQL 证明

提交 `ff34feb` 修复的不是生产资金状态机，而是此前被跳过后已漂移的测试边界：

- 三个 MySQL 夹具补齐 `orders.frozen_card_provider_account_id`，使测试与当前订单冻结卡源合同一致；
- 生产 readonly、共享 dry-run、付款状态机用例改为串行执行，避免两类用例并发修改数据库全局付款开关；
- UNKNOWN 刚建立时不再错误期待立即创建人工对账单；只有到验证截止时间仍无决定性证据时才创建一张人工对账单；
- 新增 UNKNOWN→确认收口、付款已确认但 Plus 未收口→恢复、UNKNOWN 超时→单订单人工处理三条真实 MySQL 用例。

隔离库最终证据：

```text
Browser 完整套件（TEST_DATABASE_URL，test-concurrency=1）：154 total / 154 pass / 0 skip / 0 fail
生产形状 smoke：12 config + 1 readonly MySQL + 1 shared dry-run MySQL + 5 payment/recovery MySQL，全部通过
每条付款恢复用例：PAYMENT_SUBMIT=1；恢复阶段新增付款调用=0
UNKNOWN 超时：订单/资金/卡消费保持 UNKNOWN/RECONCILIATION，只创建一张人工对账单
```

本轮仍未访问生产付款路径、未写 Provider、未填写真实卡、未付款。

## 7. 候选发布与付款关闭 LIVE 检查

当前 HEAD `556ba97` 已用 `git archive` 构建单一提交候选并完成 841 个 tracked 文件全量 manifest 校验：

```text
release=/opt/pojia/releases/20260906-browser-live-556ba97
commit=556ba974240ee168161a043177422c8b22c9b04a
archive_sha256=49fa5298ff91d6297a70c13f5ada31f7c691b2d78ad48d986659b3653321ee8c
rollback=/opt/pojia/releases/20260906-import-errors-c6e9f48
backup=/var/backups/pojia/pojia-20260906T013157Z.sql.gz.enc
release_evidence=/var/backups/pojia/browser-live-deploy-20260906T013344Z
```

部署后现场：

- Web/API Worker `active/enabled`，公网与本机 `live/ready` 均为 200；
- Browser Worker、旧每分钟自动开卡 timer 均 `inactive/disabled`；
- 数据库 `browser_payment_writes_enabled=false`，Browser Profile `productionWritesEnabled=false`；
- 活动 Browser run/dispatch、ACTIVE/UNKNOWN 充值资金、ACTIVE/UNKNOWN 补款资金均为 0；
- API Worker 仍仅保留 `PROVIDER_RECHARGE_WRITES_ENABLED=true`，通用 Provider/卡片写为 false；
- 本机以 SSH 隧道连接生产数据库并接管本机 BitBrowser，正式 LIVE `--check` 返回 `READY`。

LIVE `--check` 不需要订单确认，且强制进程与数据库付款开关为 false；本次没有创建/领取订单、注入 Session、解密或填写卡片、进入 Checkout 或付款。

卡片权威核对仍未通过：HNSKJ 单卡只读请求现场返回维护期 `HTTP 403`；数据库 5980 快照仍为 `$16`，手工备用卡快照为 `$0/$2`，都不足 `$18`。因此订单级付款关闭回归等待卡片充值并取得最新权威资料后执行。

## 8. 手工备用卡 `$20` 付款前真实页面观察

- 生产订单 `PJV1-AH6M688B3Wfv5_vxISmp` 已冻结到 `manual_excel/backup-a`，分配卡尾号 `5501`；生产数据库余额 `$20`，卡片 `active/ACCEPTED/ASSIGNED`，唯一活动 assignment，唯一 `$16 RESERVED` 账本，attempt=`PREPARED/ACTIVE`，dispatch=`QUEUED`。
- Browser 付款数据库开关保持 `false`，Browser systemd inactive/disabled；观察未创建 payment permit、未点击付款。
- 本机 BitBrowser Pilot Profile + 菲律宾出口完成真实页面观察：Session 身份匹配、账号 FREE、账号接口 HTTP 200。
- 初始报价为 `PHP ₱1100.00 / tax ₱117.86`；填入卡片、固定版本 MockAddress DE 地址与 Session 邮箱后，重报价为 `PHP ₱982.14 / tax ₱0.00`，唯一 Subscribe 控件可见且可用。
- 卡字段 `3/3` 清空，Session Cookie 清理，Profile 关闭，`submitCalls=0`。
- 现场暴露两项 drift：summary 不再稳定含 `h2`；Stripe 地址 iframe 延迟挂载且存在隐藏/跨 frame 控件。候选代码已改为 summary 容器识别、唯一可见控件定位及 hydration 等待；Browser 全量 `156 total / 149 pass / 7 environment skip / 0 fail`。
- 脱敏证据：`artifacts/browser-manual-card-prepayment-20260906/`。修复部署并生产复核前仍不得付款。

## 9. Stripe drift 修复生产发布

- 代码 release：`/opt/pojia/releases/20260906-stripe-live-a9e65e3`，commit `a9e65e34b071772ddfb2aa13800c65c019901426`，844 个 tracked 文件全量 manifest 通过；归档 SHA-256 `bd9eb666f4e0ee8839d7362052cb042dfd7ad161c48d46b2fd579618e06c7baa`。
- 部署前备份：`/var/backups/pojia/pojia-20260906T025642Z.sql.gz.enc`，完整性通过；回滚 release：`/opt/pojia/releases/20260906-manual-browser-86a53ef`。
- Web/API Worker active，live/ready 正常；Browser Worker inactive/disabled，旧自动开卡 timer inactive，数据库付款开关 false。
- 本机接生产库的正式 `production-live-worker.js --check` 返回 READY。部署后订单仍是 Browser/备用卡 A/5501/$20、PREPARED/ACTIVE、QUEUED、RESERVED；Browser run=0、payment permit=0。
- 下一步只剩最终真实付款确认；确认前仍不会点击 Subscribe。
