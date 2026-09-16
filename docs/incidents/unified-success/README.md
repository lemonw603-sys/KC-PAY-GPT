# 统一成功版本：当前实现与交接索引

整理：2026-09-17（北京时间）。业务提交4334dc2；最新生产值以../../CURRENT_STATE.md为唯一来源。

## 用户最终决定
确认Plus → 关闭自动续费并完成现有内部核对 → 客户成功。取消续费不展示给客户。

提前成功收益未量清且增加恢复状态复杂度，已撤回。保留核验减法、结果只读检查修复、有界重试、真实付款进度和2秒查询；不是整个退回09-13版本。

## 代码落点
- v1/src/db/repositories/browser-execution-repository.js：recordPlusActivation只记录Plus；recordCancellationConfirmed收订单成功。
- browser-mvp/src/live-post-payment-recovery.js、v1/src/services/browser-payment-verification-service.js：删除onPlusConfirmed早交付回调，恢复整体核实后收口；保留完成时重新取时钟。
- 其余D-240保留改动见../../tasks/2026-09-16-D240-delivery.md顶部覆盖说明。
- 测试旧→新：v1/test/plus-early-delivery-mysql-integration.test.js → v1/test/plus-unified-success-mysql-integration.test.js。

## 验证
本目录browser-tests.txt：294通过、9跳过；v1-tests.txt：675通过、66跳过；mysql-tests.txt：9通过，独立本地MySQL、串行、零生产付款。计数重叠，不相加。

2026-09-16 15:36 UTC（北京时间23:36）发布完成，prepare.txt记录1075文件清单/备份通过；switch.txt记录切换，customer-sql.txt记录生产只读探针通过。随后独立复核Web/Worker cwd和本机源文件哈希一致、心跳正常、接单已恢复。脚本即时打印worker cwd=/已被后续独立查询纠正，不作为真实运行目录。

## 未完成/下一步
- 正常真实单到来时量清首次Plus、取消完成、订单成功、客户端响应四个时点；没有精确节省秒数结论。
- 原Session期限门槛、MANUAL_IMPORT独立扣款证据与恢复诊断仍有缺口，见../d240-followup/findings.md；其中早交付专属缺陷已通过撤销入口处置。
- 不擅自充值测时；不为追溯重新发布旧隔离worktree；不把b31a88a视为当前版本。
