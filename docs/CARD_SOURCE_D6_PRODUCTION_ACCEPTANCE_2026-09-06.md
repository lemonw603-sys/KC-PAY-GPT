# 卡台来源与 Browser 卡源｜D6 生产验收记录

> 验收时间：2026-09-06（Asia/Shanghai）
> 状态：后台/API、卡源切换与备用卡完整快照已通过；真实 Browser 订单与付款结果收敛尚未验收。
> 边界：未启动 Browser Worker、未开启 Browser 付款、未开卡、未补余额、未付款。

## 1. 生产页面发现与修复

真实登录生产运营后台后发现三项会误导运营判断的问题：

1. 自动开卡已关闭，但总览仍显示“自动补卡已开启”以及“系统会自动补余额或开卡”；
2. 卡同步失败率 `100%`、`193` 条待复核，却显示“正常”；
3. 空的备用卡台因 `LEFT JOIN + COALESCE` 被错误统计为 1 张当前快照卡。

修复 commit：`c9f482e38bb6ae015b8bcf1e8d173d093e6d237a`。生产 release：`/opt/pojia/releases/20260906-admin-alignment-c9f482e`。全量 `826` 文件 manifest 通过；v1 `547 total / 500 pass / 47 skip / 0 fail`，Browser `132 total / 128 pass / 4 skip / 0 fail`。

部署后页面真实复验：

- 等待卡片：`自动开卡已关闭；当前无合格卡时需要人工处理`；
- 卡片同步：`需检查`，并如实显示 `失败率 100% · 193 条待复核`；
- Plus 可分配卡：`自动开卡已关闭；当前低于库存线`；
- 空备用卡台修复后为 `0 张历史卡 · 0 张在当前快照`。

## 2. 卡源切换闭环

生产 API 实际执行：

1. HNSKJ → 备用卡台 A，`changed=true`；
2. 备用卡台 A → HNSKJ，`changed=true`；
3. 两次均 `takeoverWaiting=false`、`actualTakeoverCount=0`；
4. 当时有 2 个满足“可安全接管”条件的 Browser 等待订单，但均未迁移；API 等待订单也未变化；
5. 两条切换审计事件已落库，最终 Browser 卡源恢复为 HNSKJ，选择版本为 3。

这证明默认切换只影响之后创建的新订单，不会重写已有订单冻结来源，也不会自动回退。

## 3. 备用卡完整快照

输入文件：`/Users/lemon/Downloads/卡片列表.xls`；文件签名为 Microsoft OOXML，大小 `5268` bytes，SHA-256 `1d10e2494c183cf1e6ef1fcc819b2024550aef25b59096a1986b98db40f8e56c`。

预览结果：2 行，新增 2、结构错误 0、跨来源冲突 0、缺失 0，允许提交。生产批次 `4aa49702-82a9-43a9-8228-577b549d0192` 原子提交成功；同一文件第二次提交返回同一批次且 `replay=true`，未重复建卡。

生产只读复核：

- 备用卡台 A：2 张历史卡、2 张在当前快照；
- 两张卡的卡资料密文、卡号密文和 PAN HMAC 均存在；完整卡号/CVC 未写入报告或普通日志；
- 余额范围 `$0`–`$2`，按当前 `$18` 业务门槛可分配数量为 0；导入保存事实，但不会把低余额卡分配给 Plus；
- HNSKJ 仍为 11 张，未被备用快照修改；
- Browser 当前卡源最终仍为 HNSKJ。

## 4. 生产安全状态

- migration：`048_manual_backup_card_import`；
- RUNNING task、ACTIVE/UNKNOWN recharge/funding attempt、活动 Browser run/dispatch、OPEN/ASSIGNED reconciliation case：全部为 0；
- 历史 stock jobs：969，活动 0，最新创建时间未变化；
- 旧自动开卡 timer 与 Browser Worker 均 `inactive/disabled`；自动开卡和 Browser 付款开关均为 `false`；
- Web/API Worker、只读同步、补余额/对账 timer、Bark 均 active；公网 health ready 正常；
- HNSKJ 卡目录仍返回 maintenance 403，属于上游可用性约束。

## 5. 导入错误边界与最终生产复验

验收脚本首次错把空上传字段发往预览接口，生产当时返回笼统的 `500 internal_error`。数据库没有发生写入，但这暴露了空文件/损坏文件未稳定分类为客户端输入错误的边界。

- 修复 commit：`c6e9f487caad6cd7b49046e423e431bf7e5e915d`；
- 最终生产 release：`/opt/pojia/releases/20260906-import-errors-c6e9f48`；
- v1 全量回归：`548 total / 501 pass / 47 skip / 0 fail`；
- release manifest：`827` 个文件全部通过；
- 生产真实 HTTP 复验：已认证的管理员请求向预览接口提交空 `fileBase64`，返回 `HTTP 400 {"error":"manual_card_file_invalid"}`，未访问 Provider；复核后生产仍只有 `1` 个手工导入批次和 `2` 张手工卡，没有新增批次或卡片；
- 生产安全复核：Web/API Worker `active`，Browser Worker 与旧自动开卡 timer/service 均 `inactive/disabled`；`browser_payment_writes_enabled=false`、`card_auto_replenishment_enabled=false`；RUNNING task、ACTIVE/UNKNOWN recharge/funding、活动 Browser run/dispatch 均为 `0`；
- 跨过一个完整定时周期后，stock jobs 仍为 `969`，活动数 `0`，最新创建时间仍为 `2026-09-05T22:32:12.365Z`；
- 本机与生产 `/tmp/d6-admin-tokens.json` 均不存在；本轮临时响应文件已安全删除，不在日志或文档中保留会话令牌。

## 6. 尚未完成

D6 尚未完成真实订单出口条件：还需用一张达到余额门槛的选定卡源卡，在 Browser Worker 受控启用后验证“新订单冻结当前卡源 → 分卡 → Checkout/零税 → 付款 → Plus/取消续费 → 账本/对账/客户状态”。当前不得把卡源切换和导入成功表述为 Browser 付款已跑通。
