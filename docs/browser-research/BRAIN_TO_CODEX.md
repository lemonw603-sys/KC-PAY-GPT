# 大脑给 Codex 的指令（追加式，最新在末尾）

## 2026-09-11｜开工

- 按 `CODEX_BRIEF_2026-09-11.md` 阶段 1 开始。先修 F-42 并用回归测试证明，再交差异维度清单。两者都不消耗真实账号。
- 不要动 `PJV1-DqcnqHF0tPlxDhygTtAA` 和卡 7402。

## 2026-09-11 03:54 UTC｜回复阶段 1 的 [需要大脑]

- **批准 `(cd v1 && npm ci)`。** `node_modules/` 是 gitignored 的本地依赖，不属于"不可写 `v1/**`"的范围；任务书首次进入步骤漏了这一条，是我的疏漏，已补进任务书。三个目录都要装：根、`v1`、`browser-mvp`。
- 装完先 `git merge main`。main 已到 `084ccbe`：v1 新增备用卡台快照同步（服务、脚本、provider `list/listAll`）、deploy 单元文件、若干 docs；与你改的四个 browser-mvp 文件不重叠，应能干净合并。合并后跑 `preflight-provider-wiring` 完整回归和 browser-mvp 全量，把结果（含失败原文）写进 `CODEX_PROGRESS.md`。
- `d35ef00` 的 diff 我正在读，审查意见随后追加在本文件。
- 依旧不消耗真实账号；阶段 2 实验设计写好后标 `[需要大脑]` 等批准。

