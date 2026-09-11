# AI充值业务｜项目地图

只回答四件事：目标、当前生产事实（指向 CURRENT_STATE）、已完成/未完成（里程碑级）、唯一执行顺序。新窗口先读 `docs/HANDOFF_NOW.md`。过程记录在 `docs/HANDOFF_LOG.md`，决策在 `docs/DECISIONS.md`，改造基线在 `docs/PRODUCT_SIMPLIFICATION_DISCUSSION.md` 末尾「接班实施基线」。2026-09-07 之前的旧版地图原文：`docs/archive/2026-09/PROJECT_MAP_snapshot_2026-09-07.md`。

最后核对：2026-09-11（大脑窗口深读 + 生产 DB 只读统计；§5 按 Lemon 确认重排）。

## 1. 目标与不变原则

1. 客户提交 CDK + Session 后系统自动完成开通，不要求运营逐单找开关。
2. 资金：一单每阶段一次付款；结果未知不重付、不换卡、不换路线；路线与卡台在建单时冻结；开卡幂等；审计证据不删。
3. 两种充值方式（API 充值 / 浏览器自动化充值）共用订单、卡、账本；多卡台可注册，切换只影响新单，不自动回退，系统只提醒。
4. 卡与订单：Plus 一卡一单或一卡多单由运营者设置（现值 3）；5X/20X 默认一卡一单；开卡金额与最低余额按产品。
5. 单人内部系统：简单、稳定、好用优先；不为推测性风险扩系统，不设人为限速。
6. 运营者只做五个决定：接不接单、走哪条路线、用哪个卡台、能不能付钱、能不能开卡补钱。日常只做三件事：发 CDK、处理订单、管卡片。

## 2. 业务主链

客户提交 CDK + Session → 建单并冻结路线与卡台 → 卡资格与余额 → 唯一 attempt / 资金栅栏 → API 或 Browser 执行 → 确认 Plus（20X 再升级）→ 取消续费 → 账本、对账、通知。

## 3. 当前生产事实

**只在一处维护：`docs/CURRENT_STATE.md`**（每行一个事实，带核对时间与证据方式；`browser-mvp/scripts/state-check.sh` 可把现场值与其比对）。本文不再复制事实表，避免两处漂移（2026-09-09 改造，用户同意）。

## 4. 已完成 / 未完成

已验收：CDK、订单、资金核心（2 笔历史 API 成功）；付款未知锁定与恢复（MySQL 证明）；Browser 付款前只读观察到零税报价（多样本）；**付款前全自动填写链路 rehearsal 两次通过**（09-07 测试单、09-09 free 账号 e4938aca：上号→导航→填卡/地址→零税 ₱982.14→停在点击前，零扣款）；付款后不需客户重登（D-136，09-08 用户手动两阶段 + navigator 到升级弹窗均验证）；D-137 付款前 drift 清卡字段（含测试）；备用卡台导入与切换；人工付款收口动作（09-07 部署并实用一次）；「已在账号里取消续费」收口动作（09-09 发布并在生产实用一次）；后台连环 prompt → askForm 对话框（09-09 发布）；本机依赖守护（mihomo/隧道 launchd、ready-check/go-live/stop-live）。

未完成（详见 `docs/UNVERIFIED_LEDGER.md`）：Browser **全自动**真实付款与付款后半段（0 次；付款前填写已演练 2 次）——下一笔真单即验证；20X 闭环（stage1 真付→session 保持→弹窗→人工 Pay now→确认 20X）；付款未知(UNKNOWN)真实页面恢复路径；hCaptcha/`requires_manual_approval` 真点击后行为；供给自动化（HNSKJ 维护中，自动开卡已停）；出口隔离/住宅 IP（放量前）；账号风险数据（0）。明确不做：Plus→20X 升级自动化（D-138）、Worker 常驻（来单人工拉）。

## 5. 唯一执行顺序（2026-09-11 二次收缩，Lemon 定：简单、稳定、好用，D-147；09-07 版原文见 `docs/archive/2026-09/PROJECT_MAP_section5_snapshot_2026-09-11.md`）

只有一件核心事：**自动把客户的 Plus 充值做完。** 其余只补"缺了它自动化就完成不了、或会记错账"的部分，剩下全部放到真单跑通之后。Pro 5X/20X 搁置（D-146）。

**主线（现在做）**
- A1 F-42 预检接入 SessionProvider：已合并 `2aad60d`。
- A2 预检改造（D-150）：**代码已完成，待发布**——预检不点 Upgrade、不建 Checkout，只保留登录/身份/free 判定；`max_attempts` 5→1。大脑做（Codex 已退出，D-152）。
- ~~A3 真实订单演练~~ **已完成（D-164，2026-09-11）**：第 4 单全链路跑通并打标签 `e2e-first-success-20260911`。主线目标「Browser 链路跑通」达成。
- A4 rehearsal 到 PRE_SUBMIT_STOPPED → Lemon 放行一笔真单到 RECHARGE_SUCCESS。D-139 不变：真单失败一次即人工。
- ~~B2 F-43~~ **已移出主线（D-148）**：付款→确认 Plus→确认取消续费在同一浏览器会话内完成，不经过旧 token 门槛；F-43 只影响付款后的自动补核，归入真单之后的集中整治。
- 已完成：B1 `RESOLVE_UNKNOWN_PAYMENT` 三 bug 修好并接按钮（`3d4936d`，release `20260911-resolve-unknown-ui-3d4936d`）。其中 Pro 分支随 D-146 搁置暂不会用到，保留不删。

**真单跑通之后（按需，不预先做）**
- 供给与运维：资格 SQL 对 highvcc 卡按同步新鲜度（C1）；timer 失败告警（C2）；自检脚本同口径与 NULL 计数（C3）；`highvcc-card.mjs export` 分当元（C4）；F-38 go-live 改走后台接口（C5，D-143）；F-40 已随 B1 修；F-41。
- 多 lane：F-19 核实不绑窗口（B3）→ 多 lane 并行验证（D3）。
- 常开机器（D1，Lemon 暂无）；住宅出口不做（D-142）。
- 集中体检（D-144，E 段）：UX 清单全部 + 遗留 bug + 真实登录后台全面走查。
- 清理（F 段）：F-4/7/8/10；删旧编排（CORE_SPEC §5.1）；零使用接口与旧表；审查第二批。

**搁置**：Pro 5X/20X 两阶段与 Free 直购（D-146）。

## 6. 明确不做

住宅菲律宾出口 / 出口隔离采购（Lemon 2026-09-11：不需要）；Pro 5X/20X 任何路线（D-146 搁置，官方恢复且 Plus 稳定后再议）；逐单选路线或卡台；卡台自动回退；每身份每日上限、延后取消续费等无依据限速；为每单新建浏览器窗口（常驻身份每单清登录态、留设备，09-07 用户确认；封控细节由 Codex 另行研究）；裸调结账接口（由页面点击触发）；为未出现的风控加闸门；第二套订单或资金账；删历史证据；把测试通过说成生产可用。

## 7. 维护纪律

- 落盘规则唯一权威：`CLAUDE.md`「开发纪律」；阅读顺序与收尾清单：`AGENTS.md`。事实改 `CURRENT_STATE.md`，方向改 `DECISIONS.md`，过程追加 `HANDOFF_LOG.md`，收尾重写 `HANDOFF_NOW.md`。
- 本文保持一页：只留当前有效状态，不在顶部堆叠历史引用块；历史进归档。
- 外部审查（Codex 审查员、分板块核查）按 `docs/REVIEW_PROTOCOL.md`；审查记录 `docs/reviews/REVIEW_RECORD.md` 只由审查员写，处置记录 `docs/reviews/DISPOSITIONS.md` 只由执行者写。
- 生产发布只从单一提交构建并全量校验：`scripts/deploy-release.sh prepare <commit> <name>` → 复核 → `switch <name>`（内部调用 `build-production-release.sh` / `verify-production-release.sh`，含备份、manifest 校验、健康检查与回滚命令）。
- 数据库集成测试串行运行（`--test-concurrency=1`）。
- 不得绕过正式连接池直连生产库写入。
