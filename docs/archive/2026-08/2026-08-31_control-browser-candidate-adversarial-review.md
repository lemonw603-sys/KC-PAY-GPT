# 2026-08-31｜控制面与 Browser 候选部署前对抗式审查

## 结论

原候选不能直接部署。审查代入默认 API、默认 Browser、有卡、余额不足、无卡自动补卡四种真实运营场景后发现三处会影响使用的问题，均已修正并通过全量回归。Browser 多订单绑定修正本身未发现新的阻塞问题。

## 发现并修正

1. **默认 API 被 Browser 未启动误报**：旧摘要无论当前路线为何，都把 Browser 未就绪计入整体异常。现仅检查当前选中的执行路线；默认 API 时只看 API Worker，Browser 不再制造噪音。
2. **开始营业与自动补卡冲突**：旧逻辑要求必须已有可直接分配卡，导致“无卡时按订单自动开卡”永远无法从开始营业入口生效。现区分：已有卡直接放行；仅有低余额卡仍阻断并跳卡余额充值；完全无卡且自动补卡、卡台规则、默认卡段均就绪时标记 `AUTO_HEAL` 并允许营业。
3. **错误不可操作**：旧开始营业用普通 Error，前端常只能看到 `internal_error`。现返回结构化 409 + readiness，前端显示首个真实阻塞原因和稳定 actionId 跳转。
4. **重复读取**：初版首页同时请求 overview 和 readiness，导致 overview 数据库查询重复。现 readiness 随 overview 一次返回；独立只读接口仍保留给显式复核。

## 保留边界

- 余额不足不会被假装成可自动恢复：生产 card funding timer 仍关闭，因此明确阻断并跳到卡余额充值。
- Browser 只有成为默认路线时才是营业门禁。
- 不自动开启 Browser Worker、Provider/卡台写权限或 card funding timer。
- UNKNOWN、重复付款、消费容量和 15 分钟交易证据门槛未放宽。

## 验证

- Legacy：87/87。
- v1：488 tests / 448 passed / 0 failed / 40 skipped。
- Browser：109 tests / 105 passed / 0 failed / 4 skipped。
- Node 语法检查与 `git diff --check` 通过。
