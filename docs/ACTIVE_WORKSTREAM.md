# 当前工作线｜运营控制面收敛与自动补给

唯一方向、状态与顺序见：

1. `docs/PROJECT_MAP.md`
2. `docs/CURRENT_STATE.md`
3. `docs/DECISIONS.md` 尾部
4. `docs/HANDOFF_LOG.md`

当前精确停止点：付款前 hold 演练已完成并清理，但清理把 Worker 的 API 最小充值权限恢复成了 `false`，与已确认的生产常驻基线冲突；接单与派发仍为 true，readiness 唯一 blocker 为 `api_recharge_execution_disabled`。

当前唯一动作：先恢复并验证 API 常驻最小充值权限，再进行下一笔真实 API 订单；该订单优先同时验收订单驱动自动补余额/自动开卡。一卡多单与 3–5 单连续运营随后验证。Browser 非付款联调并行，真实付款仍需另行确认。
