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

## 5. 唯一执行顺序（2026-09-11 重排，Lemon 确认；09-07 版原文见 `docs/archive/2026-09/PROJECT_MAP_section5_snapshot_2026-09-11.md`）

排序原则只有一条：什么在阻塞"一天几十上百单"就排前面。分工：大脑（Claude 主窗口）管全局与 v1，Codex 管 `browser-mvp`，短命窗口做边界清楚的机械活。细目与理由见 `docs/BRAIN_UNDERSTANDING_2026-09-11.md` §5。

**A. Browser 主链路跑通（唯一阻塞北极星）**
- A1 F-42 预检接入 SessionProvider：已合并 `2aad60d`。
- A2 预检改造：预检不再点 Upgrade 创建 Checkout，只做注入、身份核对、free 判定；`BROWSER_PREFLIGHT` `max_attempts` 5→2。browser-mvp 侧 Codex，v1 侧大脑。**待 Lemon 一字确认**（09-11 已解释目的与代价）。
- A3 阶段 2 实验：E0 离线路径标记（已批）→ E1 一个专用 free 测试账号两条建会话路线只读配对（Lemon 注册账号；Codex 先只读列 8 身份会话状态，大脑定 lane）→ E2 另一个从未用过的 free 账号一次 rehearsal（Lemon 注册；卡 9839、CDK 后台 plus 可用）。
- A4 rehearsal 到 PRE_SUBMIT_STOPPED → Lemon 放行一笔真单到 RECHARGE_SUCCESS。D-139 不变：真单失败一次即人工。

**B. 真单前必修（大脑，v1）**
- B1 `RESOLVE_UNKNOWN_PAYMENT` 三个 bug（F-44 字符串 false、F-45 不核对产品、F-46 取消字段不同步）修好，接后台按钮，发布。
- B2 F-43 核实 lane 被旧 token 五分钟门槛挡住。
- B3 F-19 多 lane 核实不绑窗口（开第二条 lane 前）。

**C. 供给与运维根因（大脑）**
- C1 资格 SQL 对 highvcc 卡按同步新鲜度判定，不再信任静态余额（timer 已上，09-11）。
- C2 快照同步失败（token 过期）写 operator_alert。
- C3 F-37 自检脚本与资格 SQL 同口径；state-check NULL 计数 bug。
- C4 `highvcc-card.mjs export` 分当元写余额（收回大脑地界）。
- C5 F-38：`go-live.sh` / `stop-live.sh` 改走后台接口，不再直写生产库（Lemon 09-11 同意）。
- C6 F-40、F-41（短命窗口）。

**D. 规模化前置（真单通后）**
- D1 Worker 搬常开机器：Lemon 暂无常开 Windows 机，本机继续；规模化前再议。
- D2 住宅菲律宾出口：**不做**（Lemon 09-11 判断：一两个固定出口够用，09-08 三次拒付不归因出口）。
- D3 多 lane 并行验证（B3 之后）。
- D4 Free 直购 20X（D-141），Plus 闭环稳定后。
- D5 审查第二批（后台五页、schema、文档一致性）。

**E. 真单通后集中体检（Lemon 09-11 定）**
- 真单跑完且无问题后，集中时间做一轮：`docs/UX_PUNCHLIST_2026-09-10.md` 全部条目、遗留 bug、以及一次真实登录后台的全面走查找出未发现的问题。做的过程中能顺带解决的小问题可以顺带，但不为此打断 A 段。

**F. 清理（最后）**
- F-4/7/8/10；删旧编排（CORE_SPEC §5.1 清单）；零使用接口与旧表，删前查调用链。

## 6. 明确不做

住宅菲律宾出口 / 出口隔离采购（Lemon 2026-09-11：不需要）；逐单选路线或卡台；卡台自动回退；每身份每日上限、延后取消续费等无依据限速；为每单新建浏览器窗口（常驻身份每单清登录态、留设备，09-07 用户确认；封控细节由 Codex 另行研究）；裸调结账接口（由页面点击触发）；为未出现的风控加闸门；第二套订单或资金账；删历史证据；把测试通过说成生产可用。

## 7. 维护纪律

- 落盘规则唯一权威：`CLAUDE.md`「开发纪律」；阅读顺序与收尾清单：`AGENTS.md`。事实改 `CURRENT_STATE.md`，方向改 `DECISIONS.md`，过程追加 `HANDOFF_LOG.md`，收尾重写 `HANDOFF_NOW.md`。
- 本文保持一页：只留当前有效状态，不在顶部堆叠历史引用块；历史进归档。
- 外部审查（Codex 审查员、分板块核查）按 `docs/REVIEW_PROTOCOL.md`；审查记录 `docs/reviews/REVIEW_RECORD.md` 只由审查员写，处置记录 `docs/reviews/DISPOSITIONS.md` 只由执行者写。
- 生产发布只从单一提交构建并全量校验：`scripts/deploy-release.sh prepare <commit> <name>` → 复核 → `switch <name>`（内部调用 `build-production-release.sh` / `verify-production-release.sh`，含备份、manifest 校验、健康检查与回滚命令）。
- 数据库集成测试串行运行（`--test-concurrency=1`）。
- 不得绕过正式连接池直连生产库写入。
