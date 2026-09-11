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
