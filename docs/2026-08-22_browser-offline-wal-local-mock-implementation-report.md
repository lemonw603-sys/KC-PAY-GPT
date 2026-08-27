# Browser 离线 WAL 与本地页面仿真实施报告

> 日期：2026-08-22
> 阶段：B2 控制面和仿真实现
> 边界：仅本地合成数据；未接生产、卡台、ChatGPT、Stripe 或真实 Session，未填写真实卡片、未创建真实 Checkout、未提交真实付款。

## 1. 本节点结论

B2 已从纯内存合同推进到两个可重复实现：带完整性校验的本地追加式 WAL，以及只监听 `127.0.0.1` 的 Browser/Checkout/payment iframe 仿真页面。两者共同证明：模拟付款请求即使在服务端已消费后丢失响应，恢复路径也会锁定为 `PAYMENT_UNKNOWN → RECONCILE_ONLY`，不会创建第二个 Checkout 或再次提交付款。

本节点不证明真实 ChatGPT 页面、菲律宾出口、真实 Session、支付主体或卡片链路可用，也不替代正式 MySQL 状态机。

## 2. 实现清单

### 2.1 追加式 WAL

`browser-poc/experiment-wal.js` 提供：

- JSONL schema v1、单调序列、前序哈希和当前事件 SHA-256；
- `0600` 文件权限和每次追加后的 `fsync`；
- `O_EXCL` 单写者锁与期望 head 乐观并发检查；
- 截断、无效 JSON、乱序、哈希链断裂、内容篡改和重复事件检测；
- 对 Session、Token、Cookie、卡号/CVV、完整 navigation/checkout/hosted URL 与 fragment 的写入拒绝；
- 从公开检查点恢复 run 状态，未知事件失败关闭；
- `PAYMENT_UNKNOWN` 恢复后 `mayCreateCheckout=false`、`maySubmitPayment=false`、`recoveryAction=RECONCILE_ONLY`。

`browser-poc/run-offline-wal-recovery.js` 使用临时目录写入四个合成事件，再以新实例读取和恢复，用于验证进程重启语义。

### 2.2 本地真实浏览器仿真

`browser-poc/mock-browser-server.js` 提供合成账号页、Checkout 页、payment iframe 及 mock submit/3DS/cancel API。服务仅绑定回环地址和随机端口，未知场景在 mock gateway 消费提交后主动断开连接，以复现“外部可能已收到、调用方没有结果”。

`test/browser-local-mock-page.test.js` 使用真实 headless Chromium 验证：

1. BrowserContext 间 localStorage 隔离；
2. `SUBMIT_UNKNOWN` 只消费一次提交、按钮锁定、同一 run 只创建一个 Checkout；
3. `SUCCESS` 后取消是独立动作，最终 `DELIVERY_COMPLETE`；
4. `REQUIRES_3DS` 使用原授权引用继续，`submitCalls` 仍为 1。

## 3. 验证结果

执行：

```bash
node --check browser-poc/mock-browser-server.js
node --check test/browser-local-mock-page.test.js
npm run test:browser-poc
```

结果：8 个测试文件、63 项测试全部通过。测试期间没有访问外部网络或使用真实业务凭据。

## 4. 已证明与未证明

| 项目 | 当前结论 |
| --- | --- |
| WAL 进程重启恢复 | 已由新实例重放测试证明 |
| WAL 损坏/篡改失败关闭 | 已由单元测试证明 |
| 未知付款禁止重付 | 已由状态恢复和真实 BrowserContext 断连场景证明 |
| Context 隔离、iframe、3DS continuation、取消 | 已由本地 Chromium 仿真证明 |
| 编排器所有变更原子写 WAL | 未完成 |
| MySQL 确定性持久化与现有订单接口 | 未完成 |
| 真实 ChatGPT 页面/Session/菲律宾 sticky 出口 | 未验证 |
| 真实开卡、Checkout 或付款 | 明确未执行 |
| 350 单/24 小时容量 | 未执行 |

## 5. 下一可执行项

前 3 项已在后续节点完成，证据见 `2026-08-22_browser-durable-orchestrator-capacity-report.md`。当前下一步是把已验证语义映射到 MySQL、现有订单、Provider route、资金 attempt、审计和异常恢复接口，并设计 artifact vault/租约跨进程恢复；生产写开关继续关闭。

## 6. 接班入口

接班模型先读 `docs/BROWSER_CURRENT_STATUS_2026-08-22.md`，再读本报告和 `docs/contracts/2026-08-22_browser-multi-lane-experiment-contract.md`。不要把本节点的本地仿真误写成菲律宾真实测试或真实付款事实。
