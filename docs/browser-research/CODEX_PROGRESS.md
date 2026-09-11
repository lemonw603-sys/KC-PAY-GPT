# Codex 进度（追加式，最新在末尾）

格式：`## YYYY-MM-DD HH:MM UTC｜标题`，正文分「观察」「结论」「证据路径/SQL」「[需要大脑]」四段，没有的段写"无"。

## 2026-09-11 03:38 UTC｜阶段 1：F-42 接线与差异维度清单，完整回归待依赖

### 观察
独立工作区 `codex/browser-live-20260911`，基线 59eac28。已执行用户要求的根 npm ci、browser-mvp npm ci；两者成功。根依赖审计提示 19 项（5 moderate/14 high），browser-mvp 0；未执行 audit fix。未修改主工作区或 v1。

预检原先独立 new Cookie；修改为接收 sessionProvider，pool 按 config.sessionProviderMode 注入 order-scoped provider，不复用 run-scoped source。新增完整 lane→preflight→adapter.open/bootstrap 回归，模拟 UI 与 DB，仅临时状态目录。直接注入回归 + 现有扩展用例 16/16，通过。完整 lane 回归导入 v1/config.js 时因 Zod 版本报错：root 3.25.76；v1 package 声明 4.4.3，而 v1/node_modules 缺失。初次目标套件 15 pass/2 fail（导入错误），不是业务断言失败。

只读原 WAL 并提取 30 条脱敏记录；差异清单涵盖身份/指纹、cookie、账号年龄、出口、节奏、Session 路线、页面状态、扩展版本。旧失败扩展对照不成立；代码选择扩展也可能保留已有 cookie，不能把模式名当实际建会话证据。

### 结论
阶段 1 部分完成：F-42 代码改动与清单已落盘，但 pool EXTENSION 回归因环境未运行到断言，不能称修复验收。没有网络/账号/付款实验，没有启动 worker，未触碰当前单与 7402。

### 证据路径/SQL
`browser-mvp/src/browser-order-preflight.js`、`production-live-pool-worker.js`；`browser-mvp/test/preflight-provider-wiring.test.js`、`browser-order-preflight.test.js`；`docs/browser-research/DIFFERENCE_DIMENSIONS_STAGE1_2026-09-11.md`；`docs/browser-research/evidence/stage1-20260911/` 下 targeted-tests.txt（失败保留）、independent-tests.txt（16/16）、lane4-sanitized.json。3 个修改/新增 JS 语法检查通过。无生产 SQL。

### [需要大脑]
请在独立工作区安装 v1 的锁定依赖，或明确允许本次执行 `(cd v1 && npm ci)` **仅写忽略的 v1/node_modules，不改源码/锁文件**。原因：根 npm ci 装的是 legacy Zod3，v1/config.js 的 Zod4 Schema 无法导入，连既有 pool 测试也失败。任务书禁止写 v1/**，所以没有自行安装或借用主工作区 node_modules。依赖准备后立即运行完整 pool wiring 回归与 Browser 全量测试；在此之前不开始真实账号阶段。

## 2026-09-11 04:01 UTC｜阶段 1 验收请求

### 观察
按用户先 merge main，无冲突，合并提交 9ac838d（main 包含 09e8695 的审查意见）。已按批准在独立工作区执行 v1/npm ci：80 packages，2 moderate audit 提示，未 audit fix、未改锁文件。根/v1/browser-mvp 三处依赖均已安装。

审查三点：①provider 校验补 clearSession，增加缺方法拒绝用例；②阶段 2 设计明确先清批准 lane 且 remainingSession 为空、实际 viaExtension/existingSessionPreserved 等证据落盘为实验前置；③选择仅纠正 extension adapter 注释，真实扩展只清登录 Cookie、关闭/新建 ChatGPT tabs，不宣称清 localStorage/IndexedDB/service worker，不添加新副作用。

定向回归 23/23、0 skip；包括实际 createLaneWorker→预检→order-scoped source→所选 adapter.open/bootstrap，模拟数据库/UI，验证扩展 popup 点击一次而直接 addCookies=0。Browser 全量 237 项：228 pass、9 skip、0 fail。9 项跳过不计数据库验收。未启动业务 worker、未操作真实账号、未清共享 lane 会话、未触碰 Dqcnq/7402；仅本机临时测试目录。

### 结论
阶段 1 所需接线回归与差异清单已齐，申请大脑验收并合并。这里只证明依赖接线与模拟交互，不证明已加载扩展能在真实账号开 Checkout，也不改变现有 sentinel 未证实结论。无需 v1 源码配合；F-43 等不在本阶段顺手修改。

### 证据路径/SQL
`docs/browser-research/evidence/stage1-20260911/targeted-after-deps.txt`（23/23）、`full-after-deps.txt`（228 pass/9 skip/0 fail）；初次依赖失败原文 `targeted-tests.txt` 保留。`browser-mvp/test/preflight-provider-wiring.test.js` 与 `browser-order-preflight.test.js`；`DIFFERENCE_DIMENSIONS_STAGE1_2026-09-11.md`；无生产 SQL。测试命令均取消 DATABASE_URL/TEST_DATABASE_URL；full 使用 browser-mvp 下 `node --test --test-concurrency=1`。

### [需要大脑]
请 review 本次补丁与完整测试原文，按既定流程合并到 main。阶段 1 代码不由我自行在主工作区合并或启动实际 worker。

## 2026-09-11 04:01 UTC｜阶段 2 实验设计（单独申请）

### 观察
当前真实尝试未证明扩展路径；选择 EXTENSION 也可能保留现有 Cookie 而不打开扩展。清 lane 工具会关 ChatGPT tabs，属于会话变更。

### 结论
先 E0 离线落盘实际路径标记并回归；再申请 E1 一个专用账号的两条 AUTH_READ_ONLY 路线，0 Checkout；E2 另一个新账号做一次 EXTENSION rehearsal，单独放行，不将它冒称因果对照。最多两个账号分步申请，当前 0 个消耗。任何失败不追加重试，不动既有客户单。

### 证据路径/SQL
`docs/browser-research/STAGE2_EXPERIMENT_DESIGN_2026-09-11.md`，含变量、预期、判据、账号数、清理副作用、WAL 标记、脱敏网络证据、单次停止条件。无实验 SQL。

### [需要大脑]
批准 E0 范围后实施实际路径标记；E1 请指定允许清理的 Profile、专用测试账号及停点；E2 另行批准并指定新订单/卡和单次编排。E0/E1/E2 尚未执行，未请求 PAY 权限。

## 2026-09-11 05:17 UTC｜E0 完成待 review；E1 名单已列、会话状态未核实

### 观察
已 merge main 到 13bda2e，读完 04:09/04:26/04:59 三节。E0 两事件加入枚举 adapterMode、严格布尔 viaExtension/existingSessionPreserved、非负 replacedCookieCount、每次 execute 的 executionAttemptId；同次 replacement 共用标识。真实本地 WAL 与模拟 MySQL summary 传递测试通过，无 v1/schema 改动；旧 job+sequence 去重仍会忽略后续重试的 DB 行，WAL 保留完整标识。
两个单次脚本 shell 继承模式但 Worker 原先固定 Cookie，现已补默认/拒绝非法模式以及 readonly/live Worker 实际 adapter 选择，order-scoped 预检不混用 run 材料。默认不变。未改导航重试或预检行为，仅评估 account-only。定向 22/22；Browser 全量 240 项：231 pass、9 skip、0 fail。

### 结论
E0 已实现，待 review 合并；E1 **没有完成当前会话状态核实**：只读 browser/list 返回 8 个身份、status 全 0（含义未核实）、cookie 不可解析，不得称没有会话。现有 list-session-cookies-readonly 脚本会 browser/open，不符合不改窗口，所以未运行。没有真实窗口操作/账号实验/付款，也没有业务 worker 启动。Pro 已非实验对象；不动现有 Pro 路径，不买出口不搬机。

### 证据路径/SQL
`docs/browser-research/E0_E1_EVALUATION_2026-09-11.md` 含预检评估/单次边界/交付方式；`evidence/e0-20260911/targeted.txt`（22/22）、`full.txt`（231/9/0）、`profile-inventory.json`、`wal-latest.json`。列表只调用本地 `POST /browser/list {page:0,pageSize:100}`，没有 browser/open/close/update；未存 cookie 原文或密码，WAL 只读。

8 身份当前 session/auth 层均 **未核实**：
| 序号 | 身份 | 最近可归属 WAL 时间（UTC） |
|---|---|---|
|1|Plus Browser PH Pilot|未知|
|2|Plus Browser PH Lane 2|未知|
|3|Plus Browser PH Lane 3|2026-09-08 07:05:11.816（lane-3，按已审配置归属）|
|4|AI Recharge Browser Lane 4|未知，不等于 seq8|
|5|AI Recharge Browser Lane 5|未知|
|6|AI Recharge Browser Lane 6|未知|
|7|US-TAX-AB-20260904|未知|
|8|Plus Browser PH Lane 4 (clean)|2026-09-10 22:45:54.819（lane-4，按已审配置归属）|

### 账号交付方式
E1 新 free 号待 lane/实验放行后，从自己的登录页面取得含 user/account/accessToken/sessionToken/expires 的完整 Session JSON，保存仓库外 `/Users/lemon/Library/Application Support/pojia-browser-e1/session.json`（目录 0700、文件 0600）；只发路径，不在聊天贴内容、不提交 Git、不提供密码/验证码。批准后仅读入内存，实验完成/中止删除文件，日志只记摘要与删除结果。先别提前导出，避免等审批过期。E2 另一个 free 号用正式客户页 CDK+Session，不另交文件。当前未读取任何真实新账号材料。

### [需要大脑]
请 review E0 与单次入口透传改动；请确认如何补 E1 状态：由 Lemon 打开允许查看的窗口后仅读现有 CDP，或另授权受控 browser/open（可能恢复页面/轮换会话）。本轮不擅自打开八窗，不将未知写成 false。预检改造评估已交，注意只删 checkoutNavigationContract 不够，保留 checkoutContract 仍会在首页要求 Checkout；建议预检专用 observation 两者一起去掉，LIVE 不动，summary 明确未观察；尚未实施。E2 需 account-only 预检获批并局部 Plus maxUpgradeAttempts=1，否则预检+LIVE 现状可点多次，不满足一击限制。
