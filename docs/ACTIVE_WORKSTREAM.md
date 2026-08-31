# 当前工作线｜运营控制面收敛与自动补给

唯一方向、状态与顺序见：

1. `docs/PROJECT_MAP.md`
2. `docs/CURRENT_STATE.md`
3. `docs/PROJECT_OPERATING_MODEL.md`
4. `docs/HANDOFF_LOG.md` 中由地图引用的最新证据

`docs/DECISIONS.md` 保留决策历史，其旧状态栏不是当前生产事实源，不得覆盖上述三份当前文档。

当前精确停止点：API 常驻最小充值权限已恢复为 `true`，Worker 已重启且进程环境核对通过；接单与派发仍为 true，健康端点 ready。下一步用已登录后台复核 readiness 细项后再接真实 API 订单。

当前唯一动作：用已登录后台复核 readiness 细项，再进行下一笔真实 API 订单；该订单优先同时验收订单驱动自动补余额/自动开卡。一卡多单与 3–5 单连续运营随后验证。Browser 非付款联调并行，真实付款仍需另行确认。
