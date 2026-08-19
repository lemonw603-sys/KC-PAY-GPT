# 破甲 MVP 验收与证据边界（2026-08-19）

## 已确认事实

### 2026-08-18 独立真实 Plus PoC

- 原始证据：生产机 `/opt/pojia/private/provider-poc-state.json`，权限 `0600`；敏感卡资料、Session、`card_key` 不进入本文。
- 参数：HNSKJ 卡型 ID `1`（`Z-43612081`），开卡 `$16`，最低卡余额 `$16`，`planType=plus`。
- 卡：Provider ID `493`，尾号 `8590`。
- ZZSHU 最终状态：`success`；实际支付 `982.14 PHP`；`is_subscription_cancelled=1`。
- HNSKJ 交易：`$16` 入金成功；`$15.97`（原币 `982.14 PHP`）支付成功并结算。
- 2026-08-19 只读复核时卡余额 `$0.02`。
- 2026-08-19 13:43:31 另有一笔 `OPENAI *CHATGPT SUBSCR`、`$78.24` 的失败支付尝试，没有实际扣款。用户已确认这是主动点击升级套餐后产生的失败支付，不是系统自动续费；原因归属来自用户确认。

结论：双 Provider 的真实开卡、Plus 创建、最终成功和取消标记已经验证；该 PoC 独立于正式订单数据库，不能替代正式订单状态机验收。

### 2026-08-19 正式订单付款前闭环

- 正式订单：`PJV1-m2wZr2ETzmiI8fTGfAT9`。
- 仅调用一次 HNSKJ 开卡，绑定 Provider 卡 `612`，状态 `active`，余额 `$16`，尾号 `1666`。
- 开卡任务执行 1 次；卡片就绪轮询 6 次。
- `PREPARE_RECHARGE` 完成，审计事件为 `submitted=false`。
- `SUBMIT_RECHARGE` 保持 `PENDING / attempts=0`；没有 ZZSHU `create_direct` 调用。
- 实测结束后 `accept_new_orders=false`、`dispatch_new_recharges=false`、三个 Provider 写开关均为 `false`。

结论：正式数据库、任务租约、开卡、缺失 ID 恢复基础、卡就绪和付款前请求构造已验证；没有重复花钱验证真实 Plus。

## 安全执行规则

1. 直充任务没有针对该订单的有效 `rechargePermit` 时不可被 Worker 领取。
2. Permit 只允许 `CARD_READY + PENDING + attempts=0 + 从未调用 create_direct` 的订单。
3. 同一时间最多一个有效 Permit；有效期 1–30 分钟。
4. Worker 在外部请求前原子消费 Permit；消费后无论成功、明确拒绝或结果未知，都禁止自动第二次创建。
5. 全局 ZZSHU 写开关平时保持关闭；运营脚本先签发订单 Permit，再短时开启写开关。
6. 关闭脚本先关闭写开关并重启 Worker，再撤销尚未消费的 Permit。

## 明确未完成

- 没有在正式订单 `PJV1-m2wZr2ETzmiI8fTGfAT9` 上执行真实 Plus；这是有意的零成本边界。
- 退款样本、卡池、动态补卡、批量并发和 Telegram 仍属于后续阶段。
- 取消标记后的 `$78.24` 失败授权已由用户确认为手动升级操作；后续仍通过交易记录只读观察实际扣款，不把用户说明误写成供应商接口直接返回的字段。

## 生产固化

- 当前发布：`/opt/pojia/releases/20260819-zero-cost-ops-1`。
- 回滚基线：`/opt/pojia/releases/20260819-cdk-admin-2`；迁移 011 为向后兼容的新增列，旧代码可忽略。
- 发布清单：生产发布根目录 `RELEASE_MANIFEST.sha256`，包含关键运行文件的 SHA-256。
- 本机隔离 MySQL 8.4：136/136 通过。
- 生产机隔离 MySQL 8.4：133/133 通过；发布包内较旧的非本次测试文件未重复同步，因此计数少 3，但本次 Permit、后台、任务领取和完整假 Provider 链路均包含在内。
- 生产健康检查：Web、Worker、`/health/live`、`/health/ready` 均通过。
- 生产后台数据确认：付款前检查“已就绪”，直充“已锁定”，任务 `PENDING / attempts=0`，ZZSHU 创建调用 0 次。
