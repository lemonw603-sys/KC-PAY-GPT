# 2026-09-01｜Browser 主线只读回归与生产配置核对

## 已验证事实

在当前 `main`（工作区 HEAD `a8fd57a`）执行：

- `npm --prefix browser-mvp run smoke:worker:readonly`：10/10 配置与系统检查通过，3/3 隔离 MySQL/Chrome 只读 smoke 通过，0 失败。
- `BROWSER_DRY_RUN_ENV=isolated-fixture ... npm --prefix browser-mvp run dry-run:shared`：语法检查及真实隔离 MySQL dispatch→run 非付款 dry-run 1/1 通过，0 外部付款/Provider/卡台写入。

覆盖重点：写权限全关闭时的 production-readonly 配置、精确 origin 与 harness 约束、共享加密材料模式边界、队列领取/租约/资金栅栏在 mock adapter 下的安全收敛。

通过 SSH 对生产 `root@144.34.180.184` 只读核对：

- current=`/opt/pojia/releases/20260901-session-release-2bce69e`；Web/API Worker active；`pojia-browser-worker.service` disabled/inactive。
- Browser 代码、systemd 单元及 Browser migrations 027/028/031/032/041 均存在于当前 release。
- `/etc/pojia/browser-readonly.env` 的目标为 `PRODUCTION_READONLY/LOCAL_FIXTURE`；付款执行器未启用。systemd 单元强制 Browser payment、Provider、卡片和 funding 写权限为 false。
- API Worker 进程仍为 `PROVIDER_RECHARGE_WRITES_ENABLED=true`，通用 Provider/卡片写为 false（与当前 API 营业基线一致）。

## 未验证边界

- 未启动生产 Browser Worker，未连接真实 ChatGPT，未读取客户 Session/PAN/CVC，未创建 Checkout，未填卡、点击付款或执行任何 Provider/卡台写操作。
- 因此本报告不能宣称 Browser 生产非付款页面观察或真实付款已经完成。

## 结论与下一步

Browser 当前主线代码与隔离只读闭环通过，生产仍保持 Browser 停用、API 默认路线不变。下一步是准备专用非客户账号和批准网络后，再单独确认一次生产形态只读观察；在此之前不部署、不启动 Browser Worker、不进入真实付款。
