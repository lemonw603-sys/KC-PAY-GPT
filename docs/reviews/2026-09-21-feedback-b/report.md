# B批只读分类：保留历史，先处理已核实的提醒残留

2026-09-21，UTC+8。**本报告是预览，不是清理完成或生产写入授权。** D-334允许B只读分类与A等待并行；没有访问highvcc标签或发卡台请求，23:20复测不变。

**后续覆盖D-335**：用户随后批准本报告的2case＋10alert，已于13:03 UTC执行并独立复验，见[收口报告](../2026-09-21-feedback-b-close/report.md)。本文保留关闭前的分类快照，不再把这12条当待执行。其余建议仍未批准或实施。

## 依据与范围

规则：D-329/330/334、本批FB-04/06/08；资金未知不释放、真实历史不物理删除、测试记录要有证据而不是按失败状态猜。界面仍工作台C/卡片A，订单重构尚无确认原型，本轮没有界面改动。

原始证据：[audit.sql](audit.sql)→[raw.tsv](raw.tsv)，[detail.sql](detail.sql)→[detail.tsv](detail.tsv)；逐单结果：[preview.md](preview.md)。仅允许读取的SQL，未查询凭据、完整Session/CDK、客户邮箱或卡号。首次查询字段误用rc.created_at报1054，按迁移改detected_at；第二份聚合ONLY_FULL_GROUP_BY报1055，改为分组子查询后全量重跑成功。失败输出不当完整审计。

12:34:54.639 UTC首次完整快照；12:40:18.129 UTC独立复核仍78订单（20成功/37失败/21关闭）、OPEN案例2、OPEN告警123；current为20260921-step6-9b9f181，web/worker/bark active。本轮无业务写入，应用/迁移/支付代码未改，无需发布或回滚。

## 一、建议受控关闭的最小批次

### 两个已收口但还OPEN的案例

| 案例ID | 订单 | 已有正式收口证据（UTC） |
|---|---|---|
| cf367b11-a188-4a8b-89a0-25396c2b3996 | PJV1-9TN0gGX-I5rRdhXxLrq7 | 09-11 08:15:40.835，MANUAL_VERIFICATION_NOT_CHARGED，actor brain-cli，备注存在 |
| 1286b5b3-9fe3-40b7-aff9-25cbaec03ff7 | PJV1-G4OZ2IwONAFtL7dUNokp | 09-12 17:57:16.063，MANUAL_VERIFICATION_NOT_CHARGED，actor admin，备注存在 |

两单当前CLOSED/HUMAN_VERIFIED_NOT_CHARGED；关联attempt全部CLEARED，付款run为FAILED_SAFE/PAYMENT_DECLINED/RESOLVED；无活动assignment/待定账本/已消费账本，CDK均AVAILABLE。结论基于正式人工裁定及当前关联状态，不是只看订单CLOSED。本轮没有重新向卡台证明历史未扣款。

### 十条遗留付款不明告警

清单ID见preview.md末尾。4条对应人工确认未扣款的关闭单（4次MANUAL_VERIFICATION_RESOLVED均已读到NOT_CHARGED、有actor/备注）；6条对应成功单，attempt SUCCESS/SETTLED、账本CONSUMED、Browser COMPLETED/PAYMENT_CONFIRMED/RESOLVED/CANCELLATION_CONFIRMED。没有当前ACTIVE/UNKNOWN资金或待定账本。它们保留历史价值，但不应继续冒充未处理的付款不明事件。

**建议执行范围只限：2个case状态＋10个alert状态及必要关闭审计。** 不改orders/attempts/CDK/卡分配/消费账本，不重新执行人工判款，不重推通知，不删历史。执行前再逐ID核对上述条件；任何变化/证据冲突即停该项。

当前browser-admin-service.js收口代码已同时关闭关联case/alert（约1298行），但不会自动补处理旧记录；reconciliation-case-service.js通用resolve禁止资金类案例（CASE_REQUIRES_ORDER_RESOLUTION）。因此不能为清旧记录放开通用409保护，也不能对终态订单重复判款。若用户批准，应做仅处理已有裁定证据的受控维护路径，先dry-run预览/备份/审计，再独立核对数量与业务表不变；不能直接用prod-query写入。**本轮未实现或执行该路径。**

## 二、不应随历史清理一起动的记录

下列数量可重叠，不可相加。完整订单号、状态、字段在preview/raw中。

| 分类 | 数量 | 证据和处理建议 |
|---|---:|---|
| 账本仍待对账 | 2 | 412JIT…/卡1013与u696SE…/卡4643，RECONCILIATION各16，卡虽RETIRED且attempt CLEARED，仍不释放账本、不自动退CDK。既有调查明确刻意保留对账状态，并非仅残留提醒 |
| 成功但取消续费待核 | 7 | VHl_hg…、Dqcnq…、pom5Nf…、NnL3DW…、BUGAhk…、G3Ni4W…、zdprG5…；均有人工交付事件，cancellation_review_required=1，subscription_cancelled为空；需取消证据，不能当失败或脏单删除 |
| 成功单无CONSUMED账本 | 1 | Dqcnq…，包含在上面7单内。旧账本可能是释放行，不说“完全无账本”；未证实用卡/金额，不能猜金额补消费 |
| 旧失败/关闭单仍绑定REDEEMED码，来源/权益待分清 | 16 | 原17条中先剔除1条明确演练死码。两条待对账也在这16条内；不能断言16个客户没获服务，也不能自动把码释放为可再次兑换 |

## 三、订单保留与演练分类

- 78条完整清单已列；四类基础完整性检查均0：订单缺CDK、attempt缺订单、ledger缺订单、public_no重复。这不证明全链路无缺陷，但没有支持“大量结构性垃圾”的证据。
- **明确演练4单**：zLUtyj…、08VhIP…、DE68qs…、8DB4vP…，都有order_events.metadata.closeRehearsalOrder=true；资金ACTIVE/UNKNOWN0、消费/待定账本0、PAYMENT_SUBMIT操作记录0。保留审计，可单独筛选并从经营统计排除。
- 17条CANCELLED_PRE_SUBMISSION中只有上述4条具备本轮读取的明确演练标记；其余不能一概当演练。未发起付款不等于测试订单。
- 18条失败单的CDK当前已指向其他订单是复用链路的观察，不按外键“不回指旧单”判孤儿；旧CDK必须结合最新订单，不整批退码。
- 49条没有命中本轮重点标签，暂保留为历史；这是筛查结果，不代表逐笔外部对账已通过。

## 四、123条OPEN提醒如何看

| 类别 | 数量 | 建议（均未执行） |
|---|---:|---|
| 纯事件通知：提交36、完成6、付款确认6、余额变化25 | 73 | 从日常待办默认展示中收起，留历史可查；不是批量删记录 |
| 付款不明 | 10 | 按上一节已结清证据提出受控关闭候选 |
| 历史失败30、人工介入3、停滞3 | 36 | 继续按当前订单/运行状态分组，不按年龄关闭；其中5条关联仍有续费待核的成功订单，不能让实际续费义务一起消失 |
| 钱包/供卡低水位2、token失效1 | 3 | 动态风险，先核现状；不为减少数量而关闭。highvcc不访问以保护闲置验证 |
| 当日日对账汇总 | 1 | 放对账摘要区域，不当未处理故障；保留报告 |

## 五、成功率：先定样本，不靠删除改善

admin-read-service.js:getOverview约576～584/749～788行：成功包括RECHARGE_SUCCESS及曾成功后关闭；失败包括CARD_FAILED/RECHARGE_FAILED及未曾成功的CLOSED。当前曾成功后关闭0，分母78，20/78=25.6%。默认无时间过滤，明确的4条演练也在分母里。

以订单创建时间、北京时间日历窗口预览（截止09-21 24:00，SQL写死此次审计日期）：

| 窗口 | 完结样本 | 成功 | 失败/关闭 | 说明 |
|---|---:|---:|---:|---|
| 今天 | 0 | 0 | 0 | 应显示“暂无样本”，不是100% |
| 近7个日历日（09-15～21） | 5 | 1 | 1失败+3关闭 | 3关闭都是上述明确演练；排除它们仅剩2单，不能据此证明稳定性 |
| 全部 | 78 | 20 | 37失败+21关闭 | 版本、演练、人工处理历史混合 |

**建议待裁定**：默认近7天，显示成功数/完结样本数，明确演练排除但保留可查，“全部历史”仍可切换；未知来源不擅自排除，失败不因难看删除。订单成功率和自动完成率分开；后者尚无确认定义，不偷换含义。创建时间或完成时间窗口、关闭订单是否全部进入分母，仍需用户确认后实现。

## 完成边界及下一项

已完成本轮78单/123提醒分类预览、2旧案例深查、统计口径预览；没有完成任何清理或统计改动。B不能整批标完成。先让用户裁定最小2案例＋10提醒批次；其他来源/权益/资金/续费项分批核实，不给生产充值增加新规则。

上下文/文档/交付核对技能用于区分已验与待办。执行证据可复现：

```sh
bash browser-mvp/scripts/prod-query.sh "$(< docs/reviews/2026-09-21-feedback-b/audit.sql)"
bash browser-mvp/scripts/prod-query.sh "$(< docs/reviews/2026-09-21-feedback-b/detail.sql)"
node docs/reviews/2026-09-21-feedback-b/classify.mjs
```

上述只有SELECT和本地格式化。原始JSON键/状态/ID已留，未导出凭据或个人资料。SQL是这次审计的时间快照，不能把旧日期窗口当未来通用统计接口。
