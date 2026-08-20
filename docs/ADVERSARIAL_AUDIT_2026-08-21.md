# 2026-08-21 对抗式审查：Bark 与无订单阶段上线前能力

## 审查范围

- 本轮 Bark 通知实现、023 迁移、只读上线体检、Provider 只读门禁。
- 对照 `docs/ROADMAP.md`、`docs/IMPLEMENTATION_ACCEPTANCE.md`、`progress.md`。
- 约束：允许只读调用；审查及修复期间不得触发开卡、充值、退款、余额提取或其他付费写调用。

## 独立审查结论

初审未发现 P0；发现 3 项 P1 和 3 项 P2。P1 已在本轮修复，P2 作为部署/真实环境待办保留。

| 等级 | 发现 | 证据 | 处置 |
| --- | --- | --- | --- |
| P1 | 同一告警被 RESOLVED 后重新 OPEN，旧 Bark `SENT` 记录不会再次推送 | `operator_alerts` 的 dedupe upsert 与 `alert_notifications` 的唯一键 | 已新增 `source_updated_at`；告警更新时间变化时重置为 `PENDING` |
| P1 | 写开关的 `TRUE`、` true ` 可能绕过脚本门禁 | `preflight-readiness.js`、`provider-read-check.js` | 已统一使用大小写和空白规范化解析 |
| P1 | 迁移 024 以后体检会误报 `schema_not_current` | `readiness-audit.js` 严格比较版本字符串 | 已改为迁移数字 `>= 023` |
| P2 | 023 的参数化退避和重启恢复仍需留存部署证据 | 已在临时 MySQL 8.4.11 完成 001–023 首次迁移、重放、表结构检查及 Bark 并发领取/告警重开测试 | 灰度前补两个 runner 进程重启恢复证据 |
| P2 | Bark 手机实际推送尚未验证 | 没有生产 Device Key | 配置 Device Key 后做一次普通内部告警测试，不触发 Provider |
| P2 | 并发/重启演练尚未完成 | 已增加带确认词的 DEAD 恢复命令 | 灰度前演练 `SENDING` 超时重领并留存证据 |

## 本轮复核证据

```text
v1 定向测试：59 passed / 0 failed
根项目此前完整测试：257 passed / 20 skipped / 0 failed
```

本轮没有执行任何供应商付费写调用；Bark 测试使用 fake fetch，体检使用 fake pool。

## 仍需在真实部署前完成

1. 两个独立 runner 进程在 `SENDING` 后退出，5 分钟后可重领的恢复验证。
2. 配置 Bark Device Key 后发送一条非资金内部告警。
