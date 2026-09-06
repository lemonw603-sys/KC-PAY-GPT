# Browser Plus → 手工 20X 接管（2026-09-06）

## 目标与边界

本能力只服务一笔由运营者明确指定的 20X 临时订单，不把 20X 扩展成第一版通用产品：

1. 客户仍通过统一入口提交 CDK + Session；
2. 订单仍复用 Browser 路线、共享卡源、消费账本、付款许可和审计；
3. 自动化只购买 Plus；
4. Plus 与卡交易均确认后，不执行取消续费，转为人工接管；
5. 订单继续显示处理中，不能把 Plus 成功误报为 20X 完成；
6. 运营者手工升级完成后，以后台明确动作收口为成功。

普通 Plus 的默认行为不变：`CANCEL_RENEWAL`，继续确认 Plus、取消续费、卡交易对账后完成。

## 调用合同

进程配置：

```text
BROWSER_POST_PLUS_ACTION=CANCEL_RENEWAL       # 默认
BROWSER_POST_PLUS_ACTION=MANUAL_20X_HANDOFF   # 仅单订单 LIVE --once
```

`MANUAL_20X_HANDOFF` 必须同时满足：

- `BROWSER_WORKER_MODE=PRODUCTION_LIVE`；
- 不是 `--check`，而是显式 `--once`；
- `BROWSER_LIVE_ORDER_ID` 与付款确认词精确绑定；
- 当前不存在另一笔已转交、尚未人工完成的 20X run；
- Provider/开卡/补余额写权限仍为 false；
- 最终 Checkout 仍必须 PHP、Tax 0、算术一致。

## 付款后状态

成功接管路径：

```text
PAYMENT_CONFIRMED
→ PLUS_ACTIVATED
→ card transaction reconciliation matched
→ MANUAL_20X_HANDOFF
```

原子结果：

- `browser_runs`: `HUMAN_REQUIRED / PAYMENT_CONFIRMED / PLUS_CONFIRMED / TRANSFERRED`；
- `recharge_attempts`: `SUCCESS / SETTLED`（只表达 Plus 付款资金已确定收口）；
- `orders`: 保持 `RECHARGE_PROCESSING`（20X 尚未交付）；
- `browser_dispatch_jobs`: `COMPLETED`，不再自动领取；
- `card_consumption_ledger`: 已由付款确认置为 `CONSUMED`；
- assignment 已由付款确认释放；
- 运行资源租约全部释放，Checkout artifact 标记 `CONSUMED`；
- 不写 `CANCELLATION_CONFIRMED`；
- BitBrowser Profile 保持打开，Playwright/CDP 客户端断开，JIT 卡资料 lease 释放。

若 Plus 已确认但卡交易未匹配：进入 `MANUAL_20X_REVIEW_REQUIRED`，同样停止自动化并保留窗口，但 attempt 仍保留 `SUBMITTING / ACTIVE`，不得伪装为资金已收口。

人工升级完成后，运营后台只在上述精确状态显示“确认 20X 已升级”。确认动作原子执行：

- run → `COMPLETED / RELEASED`；
- order → `RECHARGE_SUCCESS`；
- 追加订单事件与 `CONTROL_COMPLETE_20X` 操作审计；
- 付款提交次数仍为 1。

## 失败与恢复

- Plus 未确认：进入现有付款后核验，不接管、不再次付款；
- 卡交易不匹配：人工核对，不伪报接管成功；
- 付款结果未知：继续进入现有 `RECONCILE_ONLY`，禁止第二次付款；
- 配置未显式开启：按普通 Plus 路径取消续费；
- 20X 接管后不会被普通 verification 扫描继续取消续费。

## 验证证据

已执行：

- Browser 定向：21/21；
- 全新 MySQL 8.4 + migrations 001–048：20X/付款集成 7/7；
- Browser 全量：164 total / 155 pass / 9 environment-skip / 0 fail；
- v1 全量：557 total / 510 pass / 47 environment-skip / 0 fail；
- `git diff --check`：通过。

MySQL 实证覆盖：默认 Plus 完成、20X 接管不取消、订单不提前成功、人工确认最终完成、UNKNOWN 不重付、付款后恢复不重付、UNKNOWN 到期人工核对。

部署前调用链审查另外发现并修复：生产入口最初没有把 `postPlusAction` 传入付款 Worker，付款后恢复器也会落回普通取消续费逻辑。现已补齐 LIVE Worker、恢复协调器和 Profile detach 的端到端传递，并新增组件、恢复与全新 MySQL 回归，证明直接路径和 UNKNOWN 恢复路径均不调用取消续费且付款提交仍为 1。

## 当前运行事实

实现阶段没有创建订单、没有读取客户 Session/卡资料、没有访问 Checkout、没有调用卡台写接口、没有付款。部署必须保持 Browser Worker disabled/inactive、`browser_payment_writes_enabled=false`；部署后完成生产只读复核，才可以另行通知是否可提交 20X 订单。
