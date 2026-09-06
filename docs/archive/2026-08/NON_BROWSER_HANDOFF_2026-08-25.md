# 非 Browser 工作线 · 接班入口（截至 2026-08-25）

> 本文件是**非 Browser 工作线**新窗口/新模型的操作性接班入口，随每轮工作更新。
> 项目通用入口见 `START_HERE.md`；本文件聚焦「上一轮做了什么、待办、避坑、本地实测怎么搭」。
> 对应 Browser 线的接班入口是 `BRFE_HANDOFF_2026-08-22.md`。

接手 `/Users/lemon/code/AI充值业务`，非 Browser 工作线实施负责人。先按 CLAUDE.md→`docs/START_HERE.md`→`docs/CURRENT_STATE.md`→`docs/HANDOFF_LOG.md` 核实事实源，再动手。

## ⚠️ 环境警示——最重要

- 当前分支 `codex/competitor-recharge-research-20260824` 被两条线共用，Browser 工作线可能并发在此提交（只碰 `browser-*` / `test-support` / `docs/*browser*`）。开工先 `git worktree list`、`git reflog -3`、`git status` 确认 Browser 窗口是否活跃；若活跃，用独立克隆目录工作，**别用同仓 worktree**（会被 prune）。
- 提交只用精确 `git add` 命名文件，**绝不 `git add -A`**。文件域：本线 = `v1/public/admin/*`、`v1/src/services/admin-*`、`v1/src/**`（非 browser）；Browser = `browser-*` / `test-support` / `docs/*browser*`。
- 工作区有一批未提交改动（`CLAUDE.md`、`DECISIONS.md`、`CURRENT_STATE.md`、`ROADMAP.md`、`AI_AGENT_ROLE_AND_READING_GUIDE`、`artifacts/`、以及未跟踪的 `START_HERE.md`/`INDEX.md`/`08-handoff/` 等）是**其他窗口/旧会话的，别碰别混提**。尤其 `DECISIONS.md` 含其他窗口未提交的 D-089/D-109。

## 已确证、无需重挖（2026-08-25 逐行核实 + 浏览器实测）

- 后台优化清单 1/3/4 已提交 `6e5eadc`：`admin.js` 去重「本地可分配卡」、exceptions 导航身份自愈（引入 `state.nav`/`setActiveNav` 解耦，异常队列内改筛选后导航归位）、保留异常队列高频入口。
- B 窄屏响应式已提交 `07aa9ea`：`admin.css` 修 620–900px 筛选行「查询按钮溢出视口」死区（`@media(max-width:900px)` 补 `.filters` auto-fill 换行）。桌面 6 列无回归、700px 4 列换行已验证。
- **A 非 Browser 后端只读审查完成**（报告 `docs/archive/2026-08/2026-08-25_non-browser-backend-readonly-audit.md`）：8 个风险面（防重复扣款/凭证安全/认证授权/并发一致性/补偿·取消续费/分页边界/状态机迁移/订单追溯）全部过关，**无 P0/P1**。核心质量已确证，别重挖。
- 测试基线：`cd v1 && node --test` = **411 / 377 / 0 / 34**。

## 待办（A 报告有证据行号）

- A 发现③：`order-status.js` 缺 `CARD_READY→CLOSED` domain 边（`order-cancellation-service.js:93` 实际走这条边、绕过 `assertOrderTransition`）——补边或加注释。
- A 发现①：`hnskj-card.js:139` 的 502 归 `uncertain` vs CLAUDE.md「502/503 只原 key 重试」，文档/代码对齐。
- A 发现②金额精度浮点比较（`admin-read-service.js:886`、`recharge-permit-service.js:56`、`hnskj-card.js:257`）：**用户已决定暂不修、留档**（DECIMAL(18,6)+`decimalNumbers:false` 精确字符串，值域几十美元，实际不触发）。
- A 发现④⑤：card-funding `randomUUID` 幂等键建议传稳定 key、`redaction.js:5` 的 `nhs_` 前缀确认。
- 卡台 HNSKJ 写能力恢复后的真实单笔测试（live 验证幂等/开卡去重）。
- 生产遗留：`ASSIGN_CARD/PENDING`、长期 `VALIDATING` intake batch、quarantine/review 卡。

## 业务阻塞

卡台 HNSKJ 写能力（开卡/卡余额充值）待恢复，真实充值测试要等它；读能力已恢复；我方生产服务器正常。

## 本地实测环境搭法（2026-08-25 验证可用）

- docker MySQL `pojia-stage1-mysql`（root/root@127.0.0.1:54741），**建独立库别碰** `pojia_test` / `pojia_stage*`。
- `npm run migrate`（注入 `MIGRATION_DATABASE_URL`）→ `npm start`：`NODE_ENV=development`（关 Secure cookie 才能 localhost 登录）、`PORT=3100`、**不设 `ADMIN_HOST`**（跳过 host 校验，见 `create-app.js:88`）、`SESSION_ENCRYPTION_KEY_BASE64`/`CDK_HASH_KEY_V1_BASE64`/`CDK_RECOVERY_KEY_BASE64`/`ADMIN_SESSION_SECRET_BASE64` 用 `openssl rand -base64 32`、`ADMIN_PASSWORD_HASH` 用 `npm run admin:hash-password` 自设。
- admin 登录只验密码（`create-app.js:184`），用户名忽略。
- 用完停 server、删临时库。

## 授权边界

综合分析找问题已授权；动手改前确认；红线 = 真实资金 / 生产写入 / 不可逆 / 核心方向变更需停下确认。
