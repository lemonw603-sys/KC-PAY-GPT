# 非 Browser 生产 Release 对账（2026-08-25）

## 结论

线上后台当前仍运行旧 release `7587d44`；当前仓库的接单/自动充值拆分、后台去重/导航修复和窄屏修复均尚未进入线上静态资源。

## 只读证据

- `GET https://ops.vibebridge.top/health/ready`：HTTP 200，`{"status":"ready"}`。
- `GET https://ops.vibebridge.top/admin`：HTTP 302 到 `/admin/login`。
- 线上 `/admin/assets/admin.js` SHA-256：`720d96cad1fe7e70cbf372ccf1f01e2181c3c3e009020a78d619cca57fbd4d73`，与 Git `7587d44` 完全匹配。
- 线上 `/admin/assets/admin.css` SHA-256：`9d49f2dba810cc3875853cdb93a76ae34a3c7461d49f9c590e83a7fa45aa36de`，与 Git `7587d44` 完全匹配。
- 线上 `admin.js` 没有 `toggle-recharge-dispatch`、`/recharge-dispatch` 或“停止自动充值”。
- 未认证探测 `/api/v1/admin/operations/order-acceptance` 和 `/api/v1/admin/operations/recharge-dispatch` 均返回 HTTP 404。
- SSH 到既有生产主机的只读连接被远端关闭，因此 systemd、`/opt/pojia/current`、迁移版本和数据库开关仍标记为未验证。

## 分层状态

| 项目 | 状态 |
|---|---|
| 当前源码 | 代码已验证 |
| 当前分支 | 已提交，另有工作区改动待整合 |
| 线上静态资源 | 已部署旧版 `7587d44` |
| 接单/自动充值拆分 | 代码完成，线上未部署 |
| 线上数据库开关 | 未验证 |
| 真实资金行为 | 未执行 |

## 下一步

1. 在本 worktree 生成干净非 Browser 候选 release。
2. 精确纳入已审查的非 Browser 提交，排除 Browser 和竞品文件。
3. 跑完整测试、`git diff --check` 和静态资源指纹核验。
4. 单独确认后部署；部署后登录后台验证两个开关和两个写路由，资金写开关继续关闭。

