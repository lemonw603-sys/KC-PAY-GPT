# 撤回提前成功：本地候选，未发布

2026-09-16 用户确认收益不足以支撑复杂度时改回统一成功。本候选只撤销recordPlusActivation提前写订单成功及恢复器onPlusConfirmed回调；订单在取消续费与现有内部核对完成后成功。保留核验去重、结果只读门控修复、有限重试、进度映射、2秒查询、正确时间戳。历史SUCCESS待收尾的兼容收口保留，不能因此回写客户失败。

覆盖：Plus确认后客户仍处理中、失败升级人工仍不成功不退码、新repository能发现原处理中收尾、取消确认后成功，Pro不误交付；数据库套件9/9通过。Browser294通过9跳过；v1 675通过66跳过；均0失败。测试库为本地独立pojia_d240_test，非生产。

旧→新测试索引：v1/test/plus-early-delivery-mysql-integration.test.js → v1/test/plus-unified-success-mysql-integration.test.js。

生产14:15:46UTC只读：新版本订单0、活动run0、SUCCESS待取消run0。本地候选未合并/部署，线上仍b31a88a提前成功，需协调发布后才改变。旧Session时效门槛和备用卡无独立交易核对等原有问题没有因此自动修复。没有为测试真实付款。
