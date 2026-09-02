# Browser 六 Profile 生产形态准备（2026-09-02）

## 本轮范围

在没有真实订单时完成六 Profile Worker 的可运行形态、低写入 heartbeat、配置模板和回归验证。本轮不部署、不启动生产 Worker、不访问真实客户 Session、不调用 Provider/卡台、不点击 Subscribe、不付款。

## 已完成

1. macOS launcher 同时支持单 Profile 和 1–6 个 Profile 列表；拒绝单双配置并存、重复 Profile、并发超过 Profile 数。
2. launcher 新增 `BROWSER_LOCAL_RUN_MODE=ONCE|CONTINUOUS`，默认 `ONCE`；只有明确选择 `CONTINUOUS` 才不传 `--once`。
3. Worker heartbeat 从每条 lane 的轮询循环移到进程级循环：启动立即写一次，默认每 10 秒写一次，停止时清空；6 lane 空闲不会制造约 6 次/秒数据库 UPDATE。
4. lane runner 可独立测试：六条 lane 可并发领取；任一 lane 抛错会让进程级任务失败，不会被静默吞掉；Abort 后所有 lane 收口。
5. macOS/server env 模板已增加六 Profile、keep-alive、并发和 heartbeat 示例，不包含真实 Profile ID、代理订阅或密钥。

## 对抗式审查结论

- **没有改变业务账**：仍复用共享订单、attempt、dispatch、lease、资金栅栏和审计；未建立第二套队列。
- **没有把轮询误当外部 API**：1 秒 lane poll 是本地数据库任务领取，不调用卡台或 Provider；进程 heartbeat 每 10 秒一次，避免 lane 数放大数据库写入。
- **不会默认常驻**：launcher 默认一次性运行；常驻必须显式 `CONTINUOUS`。launchd 模板仍为 `RunAtLoad=false/KeepAlive=false`。
- **不会扩大付款权限**：production-readonly 配置继续强制全部付款/Provider/卡片/补余额写开关为 false，payment executor 为 `false/MOCK`。
- **故障不会伪装成功**：lane 异常向进程传播；Profile 自身的启动/清理故障仍由 Profile pool 隔离槽位。
- **尚未证明的边界不外推**：没有证明 BitBrowser 当前套餐允许同时打开 6 个 Profile，也没有证明 3/6 路真实菲律宾出口、长期运行或真实付款。

## 验证结果

```text
bash -n browser-mvp/scripts/run-macos-headed-worker.sh  PASS
npm --prefix browser-mvp run check                    PASS
npm --prefix browser-mvp test                         140 total / 136 pass / 4 skipped / 0 fail
node --test v1/test/browser-execution-repository.test.js  21/21 pass
git diff --check                                      PASS
```

4 个 skipped 均依赖 `TEST_DATABASE_URL`，本轮没有把它们写成通过。

## 额度恢复后的单次非付款复验清单

只使用仓库外、权限 `0600` 的临时输入；不得把 Session、卡号、CVC、账单地址、代理订阅或密钥写入 Git、命令行参数、普通日志或 artifact。

1. 先以一个 Profile、`ONCE` 模式检查 BitBrowser Local API、CDP、Session 身份与 FREE 状态。
2. 进入同一个 Checkout，一次 Profile 生命周期内完成卡字段和账单地址的无付款准备。
3. 等待地址导致的税费/总额稳定，记录仅包含套餐摘要 digest、币种、基础价、税费、总额和 `submitCalls=0` 的结果。
4. 在 Subscribe 前停止；清空已填字段，清理客户页面/Cookie/storage，再关闭 Profile。
5. 若金额、页面、身份、租约或清理任一项未知，直接停止，不换 Profile 重试付款。

当前仓库已具备无付款字段准备的底层 adapter，但尚未提供把真实仓外材料接入独立诊断入口的正式一键工具。不得把本清单写成“已完成税费复验”。

## 下一步

BitBrowser 额度恢复后先执行一次单 Profile 非付款税费复验；通过后依次验证 3 Profile、6 Profile 同开和任务隔离。任何生产部署、真实订单或付款仍需单独确认。
