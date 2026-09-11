# E0 交付、E1 只读盘点与预检改造评估

当前仅 Plus；Pro 两阶段、直购及 UPGRADE_DIALOG_STOP 均非实验对象，已有代码未删除或修改。IP 仅观察不做实验变量，不申请住宅出口或常开机器。实验够定位即停。

## E0

executor 的 session-bootstrap/session-replaced 两事件输出 adapterMode（COOKIE/EXTENSION/UNKNOWN）、viaExtension、existingSessionPreserved、replacedCookieCount 和 executionAttemptId。后者为每次 execute 的随机 UUID，同一次 execute 的 bootstrap/replaced 一致，不同重试区分。只允许枚举、严格布尔与非负安全整数，不复制 result 任意字段。既有 sessionDigest/cookieCount 保留，不增加敏感材料。

Memory/真实 WAL + 模拟 MySQL sink 测试覆盖摘要传递，实际 executor 的本地 Chromium 测试覆盖 Cookie 标记产生。扩展真实浏览器未跑；不把扩展 adapter 单测当账号成功。已存在 cookie 时 viaExtension=false/existingSessionPreserved=true，不由配置猜分支。

限制：MySQL sink 仍 INSERT IGNORE(job_id,sequence_no)，重复预检的后续摘要可能不落库；每次尝试完整证据以 WAL executionAttemptId 为准。本轮不改 v1/schema，也未宣称解决旧 F-14。后续如需库内完整重试证据由大脑安排。

## 单次脚本与 E2 点击边界

两脚本 shell 原本继承外部 BROWSER_SESSION_PROVIDER，但生产 readonly/live 单次 Worker 固定 Cookie，等于参数没有实际生效。已补显式默认/枚举拒绝与 Worker 的 adapter 选择；预检坚持 order-scoped 材料，付款执行使用 run-scoped 材料；默认 Cookie 不变。

`run-browser-preflight.sh once` 一次领取任务后返回，task max_attempts=5 是跨调用预算，不表示 once 必跑五遍。但导航 maxUpgradeAttempts=2 可在一次任务内点两次；当前预检与 LIVE 都导航，顺序跑两者最多四次 Upgrade，不能称“只点一次”。readonly once 在预检 IDLE 时还会 fall through 到 shared dry-run，不能无条件拿作 E1 身份只读工具。

E2 限制方案（未实施）：优先等大脑批准 account-only 预检，则预检 0 次 Upgrade；为 Plus rehearsal 局部传导航合同 maxUpgradeAttempts=1，调用一次且首错停止，不启常驻池、不改全局 Pro 合同。不先做预检精简时，当前现成脚本不满足整个实验仅一次点击；E2 暂不执行。

## account-only 预检改造：只评估，不改

涉及：browser-order-preflight.js 的 observation 构造与 summary；production-live-pool-worker.js/production-readonly-worker.js 两个预检调用点（建议统一在预检专用构造器收窄，不修改 LIVE 的 observation()）；browser-order-preflight、production-readonly-worker、preflight-provider-wiring 与 executor 的对应回归。

不能只删 checkoutNavigationContract：executor 后续仍会在有 checkoutContract 时 observeCheckout，首页会失败。因此预检专用 observation 应同时去掉导航和 Checkout 合同，仅保留 pageContract/accountProbeContract；LIVE 原始 observation 不动。summary 要用未观察/null 而不是伪装“检查失败 false”。预检没有真实卡材料，不新增读取。

风险/验收：账号非 free 应保持打回；身份摘要不符失败；无 Upgrade/卡操作的 spy 断言；无 checkout/navigation 的 summary 合同；数据库消费者是否依赖 summary.checkout 字段由大脑/v1 核对。task-repository 的门槛已知看 outcome=PASSED，不能据此保证所有后台消费者都不受影响。预检不再承诺 Checkout 可达，错误推迟到 LIVE；这是明确语义改变，未获批准前不落代码。规模约 3 个运行文件、3–4 个测试文件，小范围而非重写状态机。

## E1 8 身份列表（2026-09-11 05:13:46 UTC）

| 序号 | 名称 | 当前 session / auth层 | 最近 WAL 记录（UTC） |
|---|---|---|---|
|1|Plus Browser PH Pilot|未核实 / 未核实|未能可靠归属|
|2|Plus Browser PH Lane 2|未核实 / 未核实|未能可靠归属|
|3|Plus Browser PH Lane 3|未核实 / 未核实|lane-3：2026-09-08 07:05:11.816（按已审配置对应；WAL 未逐事件保存物理 Profile ID）|
|4|AI Recharge Browser Lane 4|未核实 / 未核实|未能可靠归属；不是 seq8 的 lane-4|
|5|AI Recharge Browser Lane 5|未核实 / 未核实|未能可靠归属|
|6|AI Recharge Browser Lane 6|未核实 / 未核实|未能可靠归属|
|7|US-TAX-AB-20260904|未核实 / 未核实|未能可靠归属|
|8|Plus Browser PH Lane 4 (clean)|未核实 / 未核实|lane-4：2026-09-10 22:45:54.819（已审配置归属）|

原始安全字段：evidence/e0-20260911/profile-inventory.json、wal-latest.json。BitBrowser list 各 status=0，但本轮没有文档确定此字段含义，不推断“已关闭”。cookie 字段不可解析，不能推断“无登录”。未发现可直接归属身份的已开 CDP 端口；没有启动、关闭、刷新、清理任何真实 Profile。

现有 list-session-cookies-readonly.mjs 调 browser/open，并打印 tabs URL，可能带付款路径；不直接用于“不改变窗口”的盘点。请大脑确认是否可由 Lemon 手动打开指定窗口后仅连接现有 CDP，或允许受控打开（会恢复页面、可能轮换会话）。在确认前不强开八窗，不读取 OS 凭据库解密 cookie。

## 账号交付方式

E1：Lemon 在自己的已登录 E1 测试账号中，按已有方式取得完整 Session JSON（含 user/account/accessToken/sessionToken/expires），在本机保存为仓库外 `/Users/lemon/Library/Application Support/pojia-browser-e1/session.json`，目录权限 0700、文件 0600。只把路径发来，不在聊天粘贴内容、不提交 Git、不保存密码或验证码。不要为拿材料先占本项目未知状态的 lane。

执行前核对权限、格式、有效期、账号摘要；只读入内存并禁止日志内容；待大脑定 lane 和放行 E1 后才读取用于会话建立。实验结束或中止后删除该文件，进度仅记录已删除/失败原因与材料哈希，不复制明文；若需等批准，先不导出，避免长时间放置后过期。E2 另一个 free 账号走正式客户页 CDK+Session，不另交文件。本轮未创建或读取真实 session 文件。

## [需要大脑]

E0 review 合并；E1 当前会话列仍未核实，需要认可只读盘点方式后补齐，不据旧“Lane6 有 auth 层”选窗口。预检精简仅评估，等待批准；E2 等 E1。全部范围保持 Browser 与研究文档，不动 v1 源码。
