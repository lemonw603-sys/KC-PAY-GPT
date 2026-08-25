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
| 当前分支 | 候选已提交 `f3bbe93`，未部署 |
| 线上静态资源 | 已部署旧版 `7587d44` |
| 接单/自动充值拆分 | 代码完成，线上未部署 |
| 线上数据库开关 | 未验证 |
| 真实资金行为 | 未执行 |

## 下一步

1. 以候选提交 `f3bbe93` 取得单独部署确认。
2. 部署前重算下列静态资源指纹并生成发布包；部署后登录后台验证两个开关和两个写路由，资金写开关继续关闭。
3. 生产数据库开关、迁移版本、systemd 与当前运行 commit 仍需现场只读核验。

## 候选 Release 对账（未部署）

- 候选分支：`codex/nonbrowser-integration-20260825`
- 候选提交：`f3bbe93 fix(non-browser): preserve funding identity and retry gateway uncertainty`
- 候选范围：当前 `v1` 的 241 个 Git 跟踪文件；本次新增/修改文件精确为：
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
- 状态分类：代码已验证；候选已提交；未部署；线上仍为旧 release `7587d44`；真实资金行为未执行。
