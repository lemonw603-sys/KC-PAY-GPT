# Browser 六 Profile 常驻池实施与对抗审查（2026-09-02）

## 本轮范围

基于用户确认的“6 个常驻 BitBrowser Profile、单 Profile 单订单串行、Profile 间并行”方案，完成本地代码实施和对抗审查。付款、Subscribe、生产部署均未执行。

## 已实现

1. `BitBrowserProfilePoolRuntimeAdapter` 支持 1–6 个唯一 Profile；槽位在异步打开前同步预留，第 7 个并发任务明确拒绝。
2. Profile 支持常驻复用：逻辑订单结束只清理客户页面、ChatGPT/OpenAI Cookie 和站点存储；进程退出才物理关闭，减少 BitBrowser 每日打开次数消耗。
3. 每个槽位使用不可伪造的当前租约引用复核；旧/伪造 handle 不能释放正在运行的槽位。
4. 单 Profile 打开或隔离清理失败时将该槽隔离；其他 Profile 可继续。进程 shutdown 会尝试关闭全部槽并汇总失败，不再静默吞错。
5. production-readonly Worker 支持最多 6 条并发 lane；单 Profile 和原 `--once` 行为兼容。WAL 保持单实例串行追加。
6. Stripe 安全字段等待上限扩至 60 秒（配置最大 120 秒），账单地址 Element 在卡字段有效后分阶段等待。
7. 付款时序拆为：填写卡/账单地址（无付款）→读取地址后的最终税费/总额→预算判断→最终 Checkout 摘要哈希绑定权威付款 permit 与 submit intent→最后复核→唯一点击。地址导致税费变化不再错误阻断；permit 后再次变化仍 fail-closed。
8. 卡资料合同支持 JIT `billingAddress`；HNSKJ 卡资料源可组合独立配置地址源。地址不得进入 job、WAL、artifact 或文档，本次用户提供的真实字段未落盘。

## 对抗审查发现并修复

- **旧方案的关键时序错误**：permit 在填写地址前发出，而地址会改变税费/总额。旧代码虽会安全停住，但无法形成正确付款流程。现已让最终金额先稳定，再把摘要绑定 permit。
- **槽位释放竞态**：只凭数组索引可用伪造/陈旧 runtime 释放新任务槽位。现增加租约引用和 vendor Profile 双重比对。
- **隔离失败复用风险**：清理失败后的槽位原本可能立即回池。现隔离该槽，直到进程级 shutdown/reset。
- **无 anchor 页面时站点存储未清理**：现按需创建临时页建立 CDP session 后清理。
- **shutdown 错误被吞**：现汇总并向上抛出，Worker 退出不会把残留 Profile 假报为正常关闭。
- **单槽故障拖垮全部并发**：Profile 级启动故障会隔离并尝试下一个健康槽；账户级/Local API 错误不做无意义多槽重试。

## 验证

- Browser 全量：`138 total / 134 passed / 4 skipped / 0 failed`。
- 新增定向测试覆盖：6 个并发获得 6 个不同 Profile；第 7 个拒绝；常驻复用只 open 一次；伪造租约拒绝；单槽故障隔离；清理失败不回池；shutdown 汇总失败；地址后金额先于 permit 冻结；permit/intent 绑定同一 Checkout 哈希。
- v1 Browser repository 定向：`21/21` 通过，包含地址后 Checkout 哈希绑定与漂移拒绝。
- MySQL 实跑的 4 项测试因本轮未提供 `TEST_DATABASE_URL` 保持 skipped；不是失败。

## 尚未验证

1. BitBrowser 当前套餐是否允许 6 个 Profile 同时常驻打开。
2. 6 个菲律宾 sticky 出口、代理并发和每 Profile 固定 `proxyRef` 的真实隔离。
3. 真实 3/6 Profile 页面并发、吞吐、断线恢复与长期稳定性。
4. LIVE budget guard、付款 outcome、Plus 激活、取消续费和卡交易对账的生产接线。
5. 任何真实 Browser 付款。

## 下一步

BitBrowser 每日额度恢复后，先用 1 个 Profile 完成 Delaware 地址的非付款税费复验；随后执行单 Profile 生产形态非付款闭环。通过后再准备 3 Profile 并发配置与代理出口实测，最后扩到 6。付款仍需独立确认。
