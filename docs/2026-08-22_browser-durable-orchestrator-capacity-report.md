# Browser 持久化编排与容量仿真报告

> 日期：2026-08-22
> 阶段：B2 控制面和仿真实现
> 重要边界：本报告全部证据来自本地合成数据和回环地址。未接生产、卡台、ChatGPT 或 Stripe，未使用真实 Session/卡片，未创建真实 Checkout，未提交真实付款。

## 1. 结论

B2 已形成可重复的 WAL-backed 编排原型：每个可变操作先持久化 intent，再应用内存状态，最后写完成事件；付款在调用 mock gateway 前先持久化 `PAYMENT_SUBMITTING`。随机崩溃、重复投递、真实子进程退出、租约过期和人工接管中断均无法产生第二次付款提交。

第一轮 350 单/24 小时等效容量仿真通过：350 个合成订单完成执行，mock gateway 收到 350 次 submit，重复 submit 为 0。该结果不是连续运行 24 小时的 soak，也不证明真实页面或菲律宾网络容量。

## 2. 如何复现

```bash
npm run test:browser-poc
npm run poc:browser-experiment:capacity
```

关键实现：

| 目标 | 文件 |
| --- | --- |
| WAL-backed 操作边界 | `browser-poc/wal-backed-experiment.js` |
| WAL 哈希链、缓存与恢复 | `browser-poc/experiment-wal.js` |
| 随机崩溃和重复投递 | `test/browser-wal-backed-experiment.test.js` |
| 真实子进程退出恢复 | `browser-poc/run-crash-process-fixture.js`、`test/browser-process-crash-recovery.test.js` |
| popup 和页面漂移 | `browser-poc/local-mock-page-adapter.js`、`test/browser-local-mock-page.test.js` |
| 350 单等效容量 | `browser-poc/run-capacity-simulation.js` |

## 3. 持久化边界

普通可变操作按以下顺序执行：

1. 写入 `OPERATION_PREPARED(operationId, operationType)` 并 `fsync`；
2. 应用内存动作；
3. 写入带 `operationCompleted=true` 的领域事件并 `fsync`。

付款提交在第 1 步之后额外写入 `PAYMENT_STATE_CHANGED(PAYMENT_SUBMITTING)`，之后才允许调用 gateway。若进程在 gateway 前退出，系统也无法知道外部动作是否发生，因此保守恢复为 `PAYMENT_UNKNOWN → RECONCILE_ONLY`。这是以人工率换取不重复扣款，不允许自动猜测“应该尚未提交”。

同一 `operationId` 已完成时返回既有恢复状态；intent 存在但没有完成事件时返回 `OPERATION_OUTCOME_UNKNOWN`，不执行动作。

## 4. 崩溃和页面验证结果

| 场景 | 结果 |
| --- | --- |
| gateway 前崩溃 | 0 次 submit；重启后仍禁止提交 |
| gateway 后、完成事件前崩溃 | 1 次 submit；重启后禁止再次提交 |
| 1–5 次随机重复投递 | 50 轮性质测试均保持 submit ≤ 1 |
| Checkout 应用后、完成事件前崩溃 | `CHECKOUT_REVIEW_REQUIRED`，禁止重建 |
| 账号租约过期 | 操作中止并记录 `OPERATION_ABORTED` |
| 自动化 freeze 后进程中断 | 自动与人工双方均不能操作 |
| popup Checkout | 新 Page 先完成产品/金额/iframe 签名校验 |
| 页面产品、币种或 iframe 漂移 | `PAGE_SIGNATURE_MISMATCH`，submit=0 |
| 真实子进程退出 | 新进程全量验链后恢复为 `RECONCILE_ONLY` |

## 5. 容量证据

2026-08-22 本机执行结果：

| 指标 | 数值 |
| --- | ---: |
| 等效业务窗口 | 24 小时 |
| 合成订单 | 350 |
| 完成 run | 350 |
| mock submit | 350 |
| 重复 submit | 0 |
| WAL 事件 | 3,710 |
| WAL 体积 | 1,991,456 bytes |
| 执行耗时 | 38,137.37 ms |
| 本地吞吐 | 9.18 单/秒 |
| `DELIVERY_COMPLETE` | 210 |
| `DECLINED_SAFE` | 70 |
| `PAYMENT_UNKNOWN` | 70 |

所有 350 个 run 的恢复状态均为 `maySubmitPayment=false`。WAL 每个事件仍执行 `fsync`；进程启动或文件指纹变化时全量验链，同一单写者进程内复用已验证事件缓存。外部修改使文件指纹变化后，下一次追加会重新验链并在篡改时失败关闭。

## 6. 当前限制和下一步

- WAL 是 B2 本地实现，正式运行仍需映射到 MySQL 确定性状态机和事务；
- artifact vault 密文、账号/Checkout 租约仍在内存，当前不能跨进程恢复继续操作，只能依据 WAL 停手或人工复核；
- 350 单是等效负载，不包含并发 worker、真实浏览器资源、代理延迟、队列积压或连续 24 小时 soak；
- 本地页面签名不是 ChatGPT 真实页面定位合同；菲律宾 sticky Session A/B 仍未执行；
- 生产写开关、真实开卡、真实付款和余额操作均未启用。

下一节点应先设计 MySQL 表/事务/唯一约束和现有订单、Provider route、资金 attempt、审计、异常恢复接口，再决定如何持久化 artifact vault 与租约。不要直接把本地 coordinator 注册成生产 Worker。
