# 非 Browser 生产 Release 对账（2026-08-25）

## 结论

线上后台已切换到 `/opt/pojia/releases/20260825-nonbrowser-e32a6fd-fixed`；接单/自动充值拆分、后台去重/导航修复和窄屏修复已进入线上静态资源。

## 只读证据

- `GET https://ops.vibebridge.top/health/ready`：HTTP 200，`{"status":"ready"}`。
- `GET https://ops.vibebridge.top/admin`：HTTP 302 到 `/admin/login`。
- 线上 `/admin/assets/admin.js` SHA-256：`6a3ce5a855b9d5213d0fc05ef5566a3f5ba89a38103688be70d327ced3f87612`，与候选包一致。
- 线上 `/admin/assets/admin.css` SHA-256：`445b1b43f04c943b15ff8f03b8d5dcedb6fd3c0c665d94df5c3063ad4e17b412`，与候选包一致。
- 线上 `admin.js` 已包含 `toggle-recharge-dispatch`、`/recharge-dispatch`、`toggle-order-acceptance` 和“停止自动充值”。
- 未认证 POST 探测 `/api/v1/admin/operations/order-acceptance` 和 `/api/v1/admin/operations/recharge-dispatch` 均返回 HTTP 401 `admin_auth_required`；GET 返回 404 符合仅 POST 路由设计。
- SSH 现场核验：`/opt/pojia/current` 指向候选；Web/Worker/Bark/只读同步 active，付费卡库存 runner inactive；迁移最新为 037。

## 分层状态

| 项目 | 状态 |
|---|---|
| 当前源码 | 代码已验证 |
| 当前分支 | 候选已提交 `f3bbe93`，未部署 |
| 线上静态资源 | 候选已部署，SHA 与候选一致 |
| 接单/自动充值拆分 | 已部署；未认证 POST 路由返回 401 |
| 线上数据库开关 | 已验证：接单 false、派发 false |
| 真实资金行为 | 未执行 |

## 下一步

1. 在获得管理员会话后逐页验收后台两个独立控制项和对应路由。
2. 继续保持接单、派发和 Provider 写入关闭；不执行真实开卡、余额充值或付款。
3. 处理或明确保留遗留 task 22、历史 intake batch 和历史异常。

## 候选 Release 对账（未部署）

- 候选分支：`codex/nonbrowser-integration-20260825`
- 候选提交：`f3bbe93 fix(non-browser): preserve funding identity and retry gateway uncertainty`
- 候选范围：当前 `v1` 的 242 个 Git 跟踪文件；本次新增/修改文件精确为：
  - `v1/src/db/repositories/card-funding-repository.js`
  - `v1/src/domain/order-status.js`
  - `v1/src/providers/hnskj-card.js`
  - `v1/test/card-funding-repository.test.js`
  - `v1/test/order-status.test.js`
  - `v1/test/provider.test.js`
- 候选静态资源 SHA-256（部署前必须重算）：

| 文件 | SHA-256 |
|---|---|
| `v1/public/index.html` | `cef0c3c29db6c6adc7f62a884c4b521b30924c993b1938cee76aa08e72102295` |
| `v1/public/assets/customer.js` | `4ce65d0599152c827491ff625cbb5ca7ba0ac4287910364e476abe95532d1444` |
| `v1/public/assets/customer.css` | `3a8333d2d318d1241b324ad85fad3c50294e92f4d198aa2594c2be5876761c51` |
| `v1/public/admin/index.html` | `884e1afb00af9faded65bafb6dfeba5cfdcf5ad3fe103d60604352d1e416a0e7` |
| `v1/public/admin/login.html` | `7539d280e7d4f48e026588eb8b097e4b2a47fdd8495e79bfe224eca598b92405` |
| `v1/public/admin/assets/admin.js` | `6a3ce5a855b9d5213d0fc05ef5566a3f5ba89a38103688be70d327ced3f87612` |
| `v1/public/admin/assets/admin.css` | `445b1b43f04c943b15ff8f03b8d5dcedb6fd3c0c665d94df5c3063ad4e17b412` |

- 验证：`git diff --check` 通过；定向回归 `node --test test/order-status.test.js test/provider.test.js test/card-funding-repository.test.js` 为 `36 pass / 0 fail`；全量 `npm test` 为 `369 pass / 34 skipped / 3 fail`。全量失败均为环境/基线阻塞：Unicode worktree 下 customer 静态页 500、两个 Browser 测试缺 `playwright`；不能写成候选 release 已全量通过。
- 状态分类：代码已验证；候选已提交；已部署；运行时已验证（health、manifest、迁移、服务和静态资源）；后台登录后逐页验收未完成；真实资金行为未执行。

## 部署后证据（2026-08-25）

- 部署前备份：`/var/backups/pojia/pojia-20260825T032925Z.sql.gz.enc`，`pojia-ops check` 校验 `backup_integrity=OK`。
- 候选归档服务端 SHA-256：`b0d7ee8394af959ae82fb3fd3e88546e9c52e0a2f23550f7678722e78664be8d`；release manifest `242/242` 通过。
- 迁移：001–037 全部 `already applied`。
- 服务：Web、Worker、Bark、卡只读同步和目录同步 active；卡库存付费 runner inactive。
- 公网：`/health/live` HTTP 200，`/health/ready` HTTP 200，`/admin` 未登录 HTTP 302 到 `/admin/login`。
- readiness：`ok=true`；`acceptNewOrders=false`、`dispatchNewRecharges=false`；活动资金风险、Permit、UNKNOWN provider call、对账案件和 Browser 活动队列均为 0；task 22 仍为历史 `ASSIGN_CARD/PENDING`，未清理。
- 期间未执行开卡、卡余额充值、Provider 写入、Plus 付款、退款或提现。
