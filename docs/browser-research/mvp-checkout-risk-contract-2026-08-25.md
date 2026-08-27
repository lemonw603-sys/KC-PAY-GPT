# Browser MVP Checkout 风控合同

状态：MVP 必须遵守的设计约束；不是生产付款开关，也不授权真实付款。

## 核心不变量

1. 一个 `order/attempt` 最多只有一个有效付款动作。
2. 一个 ChatGPT 账号同一时间最多一个活动 Browser run。
3. Checkout 创建后，run 必须绑定同一 Checkout artifact；不能在不确定时换 lane、换代理、换卡或重建 Checkout。
4. 付款提交前必须存在单次消费的 payment permit；permit 重放不得授权第二次外部动作。
5. 任何“提交是否发生”无法确定的情况都进入 UNKNOWN/RECONCILE_ONLY，禁止自动重付。
6. 页面文案、HTTP 200、URL 出现或按钮点击成功都不能单独证明付款或 Plus 成功。
7. 最终成功至少需要分别观察：付款/卡交易证据、Plus 权益证据、订单状态和必要的取消/撤销状态。
8. 完整 Checkout URL、Session、Cookie、AccessToken、PAN、CVV 不进入普通队列、日志、截图、HAR 或后台列表。
9. Session、账号、卡片、Checkout artifact、Browser slot 和网络出口都必须有明确租约/归属边界。
10. 付款动作包含 click、Enter、form submit、wallet/3DS 等等效提交入口；人工接管前必须原子转移控制权。

## 明确禁止

```text
Checkout 不确定 → 自动重建
Checkout 不确定 → 自动换卡
Checkout 不确定 → 自动换代理或 Browser lane
同一 Session 并发多个订单
自动修复 Selector 后直接继续付款
只凭成功页面文字关闭订单
只凭“Cookie 存在”判断登录
把第三方指纹分数/住宅 IP 标签当作通过证明
```

## MVP 允许的阶段

```text
订单绑定
→ Session 获取/校验
→ 账号互斥
→ Checkout 创建一次
→ 页面/金额/支付方式签名核验
→ 单次付款许可
→ 付款提交
→ 卡交易与权益后验
→ 订单/资金/审计终态
```

在真实付款批准前，所有阶段必须使用 synthetic/mock 或隔离环境，并明确 `submitCalls=0`。

## 故障分类

| 故障 | 默认处理 |
|---|---|
| Session 无效/过期 | 进入 Session repair，不创建 Checkout |
| 页面签名漂移 | 冻结 run，人工审查，不猜 Selector |
| Checkout 创建明确失败且无外部副作用 | 关闭本次 attempt，可按合同重新授权 |
| Checkout 创建结果不确定 | `CHECKOUT_REVIEW_REQUIRED`，不重建 |
| 付款提交前超时 | 只有确定未提交证据才能恢复；否则 UNKNOWN |
| 付款提交后网络断开 | UNKNOWN/对账，不换卡不重付 |
| 卡明确拒付且提交结果确定 | 按独立资金合同处理，不能把所有错误都当拒付 |
| 页面显示成功但权益未出现 | 保持待观察/对账，不立即失败或重付 |

## 事实来源

- `/Users/lemon/.codex/worktrees/c566/AI充值业务/docs/2026-08-22_adversarial-review-browser-multi-lane-report.md`
- `/Users/lemon/.codex/worktrees/c566/AI充值业务/docs/contracts/2026-08-22_browser-attempt-post-payment-contract.md`
- `/Users/lemon/.codex/worktrees/c566/AI充值业务/docs/contracts/2026-08-22_browser-multi-lane-experiment-contract.md`
- 当前 `browser-mvp` 的 `contracts.js`、`executor.js`、`wal.js`、`recovery.js` 测试。

历史合同和当前代码可能存在差异；接入实现时以运行时和共享数据库合同为准。
