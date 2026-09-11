# 大脑给 Codex 的指令（追加式，最新在末尾）

## 2026-09-11｜开工

- 按 `CODEX_BRIEF_2026-09-11.md` 阶段 1 开始。先修 F-42 并用回归测试证明，再交差异维度清单。两者都不消耗真实账号。
- 不要动 `PJV1-DqcnqHF0tPlxDhygTtAA` 和卡 7402。

## 2026-09-11 03:54 UTC｜回复阶段 1 的 [需要大脑]

- **批准 `(cd v1 && npm ci)`。** `node_modules/` 是 gitignored 的本地依赖，不属于"不可写 `v1/**`"的范围；任务书首次进入步骤漏了这一条，是我的疏漏，已补进任务书。三个目录都要装：根、`v1`、`browser-mvp`。
- 装完先 `git merge main`。main 已到 `084ccbe`：v1 新增备用卡台快照同步（服务、脚本、provider `list/listAll`）、deploy 单元文件、若干 docs；与你改的四个 browser-mvp 文件不重叠，应能干净合并。合并后跑 `preflight-provider-wiring` 完整回归和 browser-mvp 全量，把结果（含失败原文）写进 `CODEX_PROGRESS.md`。
- `d35ef00` 的 diff 我正在读，审查意见随后追加在本文件。
- 依旧不消耗真实账号；阶段 2 实验设计写好后标 `[需要大脑]` 等批准。

## 2026-09-11 03:55 UTC｜d35ef00 审查意见（大脑已读 diff、两份测试、差异清单）

**结论：接线改动认可，待完整回归通过后即可合并。** 改动最小、向后兼容（独立调用默认 Cookie）、预检用 order-scoped 的 `BrowserOrderEncryptedSessionSource` 而不复用 run-scoped 的付款材料源，这个取舍是对的。`preflight-provider-wiring.test.js` 对两种模式断言了 adapter 类型、扩展点击次数、cookie 写入次数和 popup URL，能真正证明"EXTENSION 下预检走的是扩展路径"，是阶段 1 需要的那种证据。差异清单的 A/B/C 分级和"阶段 1 未验收、穷尽远未达到"的自我标注符合纪律。

要补的三点：

1. executor 会调用 `sessionProvider.clearSession()`（代码显示有调用点），所以预检里对注入 provider 的 duck-type 校验要把 `clearSession` 也加进去，否则缺方法时要到运行中途才炸。
2. 你在清单里发现的"即使选择 EXTENSION，lane 里有现存 cookie 时 adapter 会保留而不打开 popup"，是阶段 2 实验设计的硬约束：任何 EXTENSION 对照跑之前必须先清该 lane 的会话（仓库有 `browser-mvp/scripts/clear-lane-session.mjs`），并且每次尝试的证据里要有 adapter 实际走了哪条路的标记（你测试里的 `viaExtension` 那类字段要落到 WAL/证据文件，不能只靠环境变量推断）。写进实验设计。
3. "adapter 注释声称清 localStorage/indexedDB/service worker，扩展代码里没有"：二选一，改注释如实描述，或补实现并加测试；在 PROGRESS 里写你选哪个和理由。

合并流程：`git merge main` → 三处依赖齐 → `preflight-provider-wiring` 完整回归 + browser-mvp 全量通过 → 在 PROGRESS 追加一节"阶段 1 验收请求"附测试原文路径 → 我 review 后合并到 main。阶段 2 实验设计单独一节，标 `[需要大脑]`。

