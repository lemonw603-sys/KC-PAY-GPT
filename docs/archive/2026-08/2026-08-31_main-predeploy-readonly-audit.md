# main 部署前只读审查｜2026-08-31 23:25 CST

## 结论

**`main@b04665d` 可以作为部署候选。** 本轮不部署、不改生产、不执行 Provider/卡台写入或付款。

相对生产代码基线 `55b6ec4`，唯一业务代码变化来自 `1c2c9ba`：

- `workflow-repository.js`：存在可刷新旧卡时先排只读同步，不同时付费开新卡；同步已进入 `REVIEW_REQUIRED` 且未产生更新证据时不再无限重复同一只读同步。
- `workflow-handlers.js`：已排只读同步/补余额/开卡任务时，订单 5 秒后重试；没有恢复动作时保持 60 秒。
- `mysql-integration.test.js`：覆盖“陈旧旧卡先同步且不同时开卡”。

`1c2c9ba` 之后到 `b04665d` 均为文档提交，没有其他业务代码、migration、依赖或 systemd unit 变化。部署必须从干净的已提交 `main@b04665d` 构建，不得把工作区未提交的 `docs/DECISIONS.md` 或 `output/` 带入 release。

## 验证

- 三个变更文件 `node --check`：通过。
- 自动补给/库存/Workflow 定向：178 pass / 0 fail / 23 skip（skip 均为未连接隔离 MySQL 的集成项）。
- `v1` 全量：466 pass / 0 fail / 42 skip。
- 全新 MySQL 8.4.11：migration 001–044 全部成功；关键集成 37 pass / 0 fail / 1 skip。唯一 skip 是已标记待重写的旧 fake-provider 全流程夹具，关键资金与补给路径已有独立覆盖。
- `git diff --check`：通过。

## 生产与回滚边界

只读现场：`/opt/pojia/current` 仍指向 `20260831-prepayment-hold-55b6ec4`；Web/Worker 与 read-sync/stock/funding timers 正常；Worker 充值 gate=true、通用写/普通卡写=false；funding 独立 gate=true。当前没有 migration 差异。

部署时应新建独立 release、保留 `55b6ec4`，原子切换 `current`，保持现有 API recharge 与 funding drop-in，不恢复付款前 hold。切换前后核对活动 task、资金风险、UNKNOWN Provider call、Worker 实际 env、readiness 与日志。因无 schema 变化，可在确认没有活动/未知资金动作后切回 `55b6ec4` 并重启；不得靠回滚重放 UNKNOWN 任务。

## 剩余风险

1. 新逻辑依赖只读 card-sync timer 最终完成或进入 `REVIEW_REQUIRED`；若 timer 漂移，订单会继续等待而不是误开新卡。当前生产 timer 已确认 active/enabled，但“开始营业”尚不持续监控它。
2. 本次证明代码与隔离状态机，不等于真实生产低余额补款或无卡开卡闭环已经验收。
3. 最新客户订单仍为 `WAITING_FOR_SESSION`，不应作为部署后真实充值验收样本。

这些风险不阻断候选部署，但部署后仍需只读复验；真实资金闭环继续按单独确认执行。
