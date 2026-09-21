# CDK A 实现与验收（2026-09-21，UTC+8）

## 结论与范围

本地实现完成，未发布、未应用生产迁移、未处理生产卡密。用户批准的业务范围为 D-313～D-318；布局保留 A「一条流水线」。生产 release/服务/数据库本轮未现场核对，历史 21/20/1 不作本轮断言。

默认测试集：1019 tests / 951 pass / 0 fail / 68 skipped。专项真实 MySQL 测试通过。真实浏览器操作、1440几何契约及间距变异检查见脚本和本机证据。扩大 MySQL 套件有12条失败，已用修改前 e4ab498 在另一全新隔离库复现同一名单；不能称全项目/生产全链路验收通过。

## 交付对照

| 承诺 | 实现证据 | 本轮验证 |
|---|---|---|
| 普通码无需备注，默认生成起30天 | cdk-policy.js normalizeCdkOptions/resolveCdkExpiry；cdk-service.js createAdminCdkService | 隔离库 TIMESTAMPDIFF=2592000；浏览器空备注生成 |
| 应急备码另标；离线后补登记 | cdks.issuance_kind；updateCdkCodes issue | 浏览器选中3张登记，新查询确认3条 issued_at |
| 卡网选择不过期，不逐笔同步销售 | 生成用途切换选 NEVER；expires_at=NULL | 浏览器控件检查、隔离库读回 |
| 自设及延期 | updateCdkCodes expiry；原生日期时间输入 | 指定到期读回一致，过期验码EXPIRED，延期后VALID |
| 四格与列表同口径 | cdk-policy.js CDK_STATE_SQL；listCdkCodes/summarizeCdkLiability | 所有state的total与聚合逐项相等；成功/异常/历史/在途独立样本 |
| 历史不算当前异常 | finished_at/created_at界线 | 修改旧单failure_reason后仍为历史，不依赖updated_at |
| 跨页搜索 | SQL过滤先于COUNT与LIMIT；完整码hash精确查 | 61条之后仍搜到最早单码；空结果与失败分开 |
| 完整邮箱跳订单 | cdks.js data-open-order；admin.js保留委托 | MySQL完整邮箱读回；原有导航委托回归通过；真实订单详情全字段未端到端遍历 |
| 最近动静含作废 | GREATEST(created/redeemed/issued/revoked/admin_updated) | 作废后 latestAt=revokedAt |
| 批次作为筛选/导出，不再独立大列表 | cdks.js controller；index.html | 自动筛刚生成批次、下一页/上一页、普通导航实际点击 |
| 批发总额不均摊 | cdk_batches sale_amount/sale_currency/channel_note | 99.90→88.10 USD读回；单张金额仍归订单，不走批次金额 |
| 作废不撤销回库；批量防误操作 | updateCdkCodes行锁/全选验证/事务审计；issued=false拒绝 | 混入已使用码全部回滚，审计插入故障回滚，并发作废只改变一次 |
| 不重复生成 | generation_fingerprint含用途/备注/金额/币种/有效期模式；前端原请求恢复 | 四种同键参数更改被拒；成功响应丢失后恢复只新增1张 |
| 应急码客户先用后退码不变回库存 | order-intake-repository.js同步补issued_at，原退码保留它 | 正式createOrderFromCdk→无付款退码→reserve=0/pending=1 |
| 付款未知仍锁定 | 原退码资金证据规则不变；验码先认资金锁 | 单测到期失败码在blocked时仍BOUND_TO_ORDER |
| 错误、空态、权限区别 | cdks.js load + admin.js api | 500汇总数字变“—”；空查询；无登录401；真实会话失效回登录 |
| 视觉/样式 | 冻结原型、parity/cdk-page.json、cdks.css | 1440几何一致，gap改40px被检出；390截图/整页无横向溢出，表格局部滚动 |

所有上述“验证”只覆盖所列方法；单测不代表生产兑现。搜索完整卡密为精确匹配；邮箱、订单号与备注支持子串，不承诺HMAC码片段模糊搜索。旧码缺批次明文时仍可凭完整码hash查询，但不能编造可复制明文。

## 原始验证命令与摘要

默认测试（v1目录）：

```sh
npm test
# tests 1019 / pass 951 / fail 0 / skipped 68
```

专项 MySQL（仅本机，数据库必须为step6_cdk_test；使用正式连接池配置 timezone=Z）：

```sh
CDK_TEST_DATABASE_URL='<本机隔离库连接串>' node --test test/cdk-page-mysql-integration.test.js
# tests 1 / pass 1 / fail 0 / skipped 0
```

扩大回归：

```sh
TEST_DATABASE_URL='<本机隔离库连接串>' \
CDK_TEST_DATABASE_URL='<同一隔离库连接串>' \
node --test --test-concurrency=1 test/mysql-integration.test.js test/cdk-page-mysql-integration.test.js
# tests 44 / pass 31 / fail 12 / skipped 1
```

基线对照：git archive e4ab498的v1源码，在另一份全新step6_cdk_baseline库应用001～055，串行执行同一个mysql-integration.test.js：

```text
tests 43 / pass 30 / fail 12 / skipped 1
baseline failures = 12
current failures = 12
same failure names = true
introduced failure names = []
```

12条分别涉及Bark、卡分配/供卡、补余额、旧VERIFY_CARD任务预期、旧授权/自动提交、Session替换次数。未为全绿改无关断言；只能证明此次对照未新增这些失败，不能由此宣称所有失败都无业务风险。原日志本机 /tmp/cdk-baseline-mysql.log 与 /tmp/cdk-mysql-test.log；关键信息另见本报告。

浏览器验收（项目根目录，需要现有本机验收环境密钥，不写凭据）：

```sh
DATABASE_URL='<step6_cdk_test隔离库连接串>' node scripts/cdk-ui-verification.mjs
node scripts/css-drift-check.mjs
node scripts/ui-copy-check.mjs
git diff --check
```

脚本要求隔离库无CDK；启动自己的8804服务与Chrome，最后清理合成码并停止自己的进程，不动8803/8899及常驻worker。原型服务使用已有8899。截图位于本机 output/playwright/cdk-step6/desktop.png、mobile.png；report.json记录实际操作与变异结果。这些运行产物未纳入git，不是假生产截图。后续可用 CDK_SKIP_CAPTURES=1 重跑业务检查而不重复视觉打磨。

## 复核与设计说明

独立UI复核认可A流水线及候光外壳，提出一项P1：确定失败的生成请求也保留签名，阻止修正。已修复并经真实页面复验；独立复核最终 verdict 为该项 resolved，而非全项目无问题。

设计技能影响：沿用现有令牌和控件体系、补空态/失败态/选择反馈、冻结参照独立于实现、独立复核恢复路径。impeccable上下文加载器初次无执行权限，已告知并直接读取既有设计；后续经sh运行一次detect，发现跨全后台既有低对比度/阴影等告警，本轮未改其他页面。新cdks.css无字面颜色/新增token/重复选择器。独立文档核对指出：A版紧凑生成主按钮34px；移动控件44px但仍9px圆角/13px字，与全局规范的大档11px/14px有差别。保持已冻A版，不声称完整规范一致，后续由视觉验收决定是否统一，不暗改参照来刷绿。

## 实现索引与发布边界

- 旧CDK页面函数/事件在 admin.js → 新 assets/cdks.js；公共认证、弹窗、导出与订单跳转仍在admin.js，工作台快捷生成保留。
- 旧CDK样式从admin.css删除 → cdks.css；共享admin.css、admin.js资产版本同步更新。
- 迁移055为上一轮有效期/发出字段，056增加批次属性、生成指纹、码用途与最近管理操作时间。只加列；存量用途LEGACY，不用空备注推断库存，不批量改有效期。
- 旧批次读/导出/作废API仍作兼容；原始整批导出明确警告可能包含已发/已兑/作废/过期码，不当新发货清单。
- 本轮没有browser-mvp改动，没有付款动作，没有生产连接。state-check与wrapup-check包含生产SSH/数据库查询，受本轮“不接生产”边界未执行；没有“全收尾闸门通过”的结论。没有推送远端。
- 本轮两份隔离库step6_cdk_test/step6_cdk_baseline已在确认CDK数均为0后删除，仅含可重造测试结构/数据；8804与测试Chrome已退出，原8803/8899不动。复跑前须按RUNBOOK在本机重新创建并迁移隔离库。
- 发布前需单独确认055+056生产迁移及单提交发布，并现场核对生产。回滚到旧版本可能不执行新码有效期/用途规则，不能只凭DDL可加不删就宣称业务回滚无影响。
