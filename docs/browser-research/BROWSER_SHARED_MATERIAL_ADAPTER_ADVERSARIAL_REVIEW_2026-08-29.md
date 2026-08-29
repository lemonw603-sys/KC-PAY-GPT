# 共享 Session/card-material adapter 对抗式审查（2026-08-29）

## 审查范围与边界

审查对象：

- `browser-mvp/src/shared-encrypted-materials.js`
- `browser-mvp/src/session-bootstrap.js`
- `browser-mvp/src/session-identity-probe.js`
- `browser-mvp/src/executor.js`
- `browser-mvp/src/production-readonly-config.js`
- `browser-mvp/src/production-readonly-worker.js`
- 共享 projection / dry-run composition 及相关测试

本轮未连接生产、未读取真实客户 Session/PAN/CVC、未访问真实 ChatGPT、未填卡、未付款、未调用卡台接口、未部署。

## 已确认正确的边界

1. Session/card 只由 `browser_run.id` 进入共享密文记录，run/attempt/order/profile/route/provider/RESERVED ledger 漂移均 fail-closed。
2. SQL 多行或零行均拒绝；migration 039 对 attempt 消费记录有唯一约束，不会任取歧义记录。
3. Session 与卡资料均只进入内存短租约；普通 job、WAL 和结果不含原文。
4. readonly 配置要求五个写开关 `false`、payment executor `false/MOCK`、显式共享材料模式和确认词。
5. 付款未知、非 `NOT_STARTED`、非 `PREPARED/ACTIVE`、非 `RECHARGE_PROCESSING` 均不能读取材料或进入新付款。

## 发现并修复的 P1

### P1-1：身份判断曾采用“任一字段相同”

原逻辑在订单同时提供邮箱与 account ID 时，只要其中一个相同就接受。攻击/漂移场景中，旧邮箱与新 account ID 混合可能错误通过。

修复：所有已提供身份摘要必须逐项相同；production resolver 只把订单身份的 SHA-256 摘要投影到 job，不投影原始邮箱/account ID。定向测试包含“邮箱相同、account ID 不同”并确认拒绝。

### P1-2：真实只读观察会无必要解密卡资料

原 `SHARED_ENCRYPTED_NONPAYMENT` 同时装配 Session 和 card material，即使阶段目标只检查账号/Checkout，也会预检 PAN/CVC。这不是付款副作用，但扩大了材料读取面，也违背本轮“不读取真实 PAN/CVC”的验收边界。

修复：`CHATGPT_ACCOUNT_CHECKOUT` harness 只装配 Session source；card source、card ref 和 card preflight 都不创建。旧 `PAGE_ONLY` 隔离 fixture 仍保留 card adapter 测试，不删除既有能力。

### P1-3：材料读取前的租约检查间隔过大

原执行器只在打开 runtime 前和页面导航后核验租约，Session/card material 刚要读取时没有独立复核。

修复：Session source 和 card source 每次打开前立即重新调用共享 lease guard；`LEASE_LOST` 不再被误分类为 Session/card 错误。

### P1-4：订阅接口漂移可能被误判为客户 Session 错误

原身份 probe 只有通用 `ContractError`。如果身份已经匹配、但 account-check HTTP/schema 漂移，执行器会统一包装成 `SESSION_IDENTITY_MISMATCH`，从而错误提示客户换 Session。

修复：区分 `SESSION_INVALID`、`SESSION_IDENTITY_MISMATCH` 和 `ACCOUNT_STATUS_UNKNOWN`。前两者才进入 Session 更换；订阅接口未知按内部付款前安全失败处理，绝不自动继续或要求客户无意义换 Session。

## 未发现 P0

未发现可绕过共享 attempt/资金栅栏、产生付款提交、调用 Provider 写接口或把敏感原文写入普通结果/WAL 的 P0。没有为审查引入第二套材料存储、第二套订单状态或新 Provider 路径。

## 新增最小 harness

单次流程已冻结到：Session bootstrap → 身份逐项匹配 → 订阅状态 → Plus 入口 → Checkout 只读识别 → `abortBeforePayment()`。活动 Plus/其他付费计划在任何购买入口点击前以 `ACCOUNT_ALREADY_PLUS` 安全停止。

真实模式被限制到精确 `https://chatgpt.com/`；account-check accessToken 只在页面 `evaluate()` 内使用，返回 Node/WAL 的只有状态和摘要。输出合同见 `docs/contracts/2026-08-29_browser-chatgpt-readonly-observation-contract.md`。

## 验证与未验证

实际验证：

```text
npm --prefix browser-mvp run check
  passed

npm --prefix browser-mvp test
  99 total / 95 passed / 4 skipped / 0 failed
  （4 项仅因无 TEST_DATABASE_URL 在普通全量中跳过）

npm --prefix browser-mvp run smoke:worker:readonly
  config/systemd 10/10 passed
  临时 MySQL + 正式 readonly CLI/Google Chrome + mock payment recovery 3/3 passed

BROWSER_DRY_RUN_ENV=isolated-fixture \
BROWSER_PAYMENT_WRITES_ENABLED=false \
PROVIDER_WRITES_ENABLED=false \
PROVIDER_CARD_WRITES_ENABLED=false \
PROVIDER_RECHARGE_WRITES_ENABLED=false \
CARD_FUNDING_WRITES_ENABLED=false \
npm --prefix browser-mvp run dry-run:shared
  临时 MySQL + migration 001–040 + Chrome 1/1 passed

git diff --check
  passed
```

已用本地 fixture 证明零 submit/零字段写入、已 Plus 提前停止、身份部分匹配拒绝、订阅 schema 漂移独立归类，以及失租约时材料读取次数为 0。

仍未验证：真实 ChatGPT 当前 account-check schema、首页 marker/标题、Plus 入口、当次 Checkout DOM、批准网络出口和服务器 Chrome。上述事实只能在统筹提供一次性外部输入并批准只读窗口后验证；本地 fixture 不能写成真实站点通过。
