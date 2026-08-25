# 非 Browser 后端只读对抗审查报告（2026-08-25）

> 工作线：非 Browser。本轮为纯只读代码审查，未改任何业务代码、迁移或生产。
> 事实等级：**代码已验证**（可在 `v1/` 定位实现并逐行核对），非运行时/生产验证。真实运行行为（尤其卡台幂等是否真生效）仍需卡台恢复后 live 验证。

## 1. 范围与方法

系统过了 8 个风险面，逐个定位实现并核对硬约束（CLAUDE.md）：防重复扣款、凭证安全、认证授权、并发一致性、补偿/取消续费、分页边界、状态机迁移、订单追溯。Browser 工作线不在本次范围。

## 2. 总体结论

**非 Browser 后端核心质量优秀，未发现 P0/P1 级正确性或安全漏洞。** 5 个发现全部 P2/P3（文档偏差/低风险正确性/一致性/建议）。

## 3. 逐组结论（含证据）

| 风险组 | 核心证据 | 结论 |
|---|---|---|
| 防重复扣款 | 幂等键强制+长度校验(`hnskj-card.js:115-121`)，开卡用订单级稳定 key `purchase-${orderId}`(`order-intake-service.js:43`)；开卡响应缺 ID→列表差异识别不重开(`workflow-handlers.js:178-181`)，缺 baseline→人工禁止 rebuy(`:142-146`)；充值 uncertain→`markAttemptUnknown`+`retryable:false`(`:343-368`)；资金栅栏 `funds_risk_state IN(ACTIVE,UNKNOWN,SETTLED)`+`FOR UPDATE`(`recharge-attempt-repository.js:175`)；card-funding 三层去重(`card-funding-repository.js:44-101`) | ✅ 扎实 |
| 凭证安全 | Session AES-256-GCM 随机 IV+authTag(`secret-box.js`)；日志脱敏键名+值双层覆盖卡号/CVV/token/CDK/API-key(`redaction.js`)；CDK HMAC-SHA-256 独立密钥(`cdk-code.js`) | ✅ 优秀 |
| 认证授权 | CSRF：`requireAdminOrigin` 严格 Origin 校验(缺头也拒)+Cookie SameSite=Strict，全写路由覆盖(`create-app.js:160-174`)；step-up 绑定 session(`admin-session.js:155-158`) | ✅ 优秀 |
| 并发一致性 | CDK 兑换 `FOR UPDATE` 行锁+`UPDATE...WHERE status='AVAILABLE'` CAS(`order-intake-repository.js:69-130`)，同 CDK 并发只能兑成一单 | ✅ 正确 |
| 补偿/取消续费 | 取消续费仅 `isSubscriptionCancelled===1` 算成功，耗尽进人工复核(`workflow-handlers.js:477-522`)；订单取消多重充值风险检查(task 状态+permit+recharge 标识+`provider_calls`)防取消已扣款单，卡释放到 HELD_FOR_REVIEW(`order-cancellation-service.js:54-97`) | ✅ 严谨 |
| 分页边界 | `page` 整数 1-100000、`pageSize` 整数 1-100，`Number.isInteger` 校验(`admin-read-service.js:142-145`)；alerts/CSV `Math.min/max` clamp | ✅ 安全 |
| 状态机迁移 | 冻结枚举+显式 `transitions` 后继表+`assertOrderTransition` 强制校验(`order-status.js`)；`SUBMIT_UNKNOWN` 不能回 `SUBMITTING`，`RECHARGE_SUCCESS` 需经 `CANCELLATION_PENDING` 确认 | ✅ 可审计（见发现 #3） |
| 订单追溯 | 状态迁移与 `order_events` 同事务写入；`provider_calls` 审计覆盖 6 个 repository | ✅ 完整 |

## 4. 发现清单（5 项，均 P2/P3，无需紧急修）

| # | 级别 | 位置 | 说明 | 处置 |
|---|---|---|---|---|
| 1 | P2·文档偏差 | `hnskj-card.js:139` | 502 归 `uncertain`(进人工) 而非 `retryable`，与 CLAUDE.md「502/503 只原 key 重试」表述不一致。代码更保守、更安全 | 对齐文档（说明保守策略），或让 502 retryable |
| 2 | P2·正确性 | `hnskj-card.js:257` 及后台多处 | 余额门槛 `Number(balance)>=Number(minimum)` 浮点比较（方向偏保守，低风险） | 并入 B 金额精度统一处理 |
| 3 | P2·一致性 | `order-status.js:34-38` vs `order-cancellation-service.js:93-97` | `cancelOrder` 执行 `CARD_READY→CLOSED`，但 `transitions` 未声明这条边；靠 SQL CAS 而非 `assertOrderTransition`，运行时可用但 domain 非完整真相 | 在 transitions 补边，或加注释说明人工取消路径 |
| 4 | P3·建议 | `card-funding-repository.js:33` | 默认 `randomUUID` 幂等键；调用方宜传稳定 key 才能幂等返回（现靠 card 维度 FOR UPDATE 兜底防重复，重复点击安全但非最优） | 建议调用方传稳定 key |
| 5 | P3·观察 | `redaction.js:5` | `nhs_` API-key 前缀需确认匹配 hnskj 实际前缀（键名脱敏已兜底） | 确认前缀 |

## 5. 边界与未覆盖

- 本审查为只读代码审查，不等于生产/运行时验证；卡台幂等真实行为、真实开卡去重需卡台写能力恢复后按真实单笔测试验证。
- 未覆盖 Browser 工作线（另条线，browser-* / test-support）。

## 6. 关联

- 本轮前置：后台优化清单 1/3/4 已提交 `6e5eadc`（`admin.js` 前端：去重可分配卡 + exceptions 导航身份自愈），浏览器实测全绿。
- 后续 B（金额精度含发现 #2、窄屏响应式）、C（UI 增量）按 A→B→C 顺序推进。
- DECISIONS.md 本轮未动（工作区含其他窗口未提交的 D-089/D-109 内容）。
