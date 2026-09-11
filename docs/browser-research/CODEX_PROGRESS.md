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
