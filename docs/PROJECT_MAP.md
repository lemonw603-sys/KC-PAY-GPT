# AI充值业务｜项目地图

只回答四件事：目标、当前生产事实、已完成/未完成、唯一执行顺序。过程记录在 `docs/HANDOFF_LOG.md`，决策在 `docs/DECISIONS.md`，改造基线在 `docs/PRODUCT_SIMPLIFICATION_DISCUSSION.md` 末尾「接班实施基线」。2026-09-07 之前的旧版地图原文：`docs/archive/2026-09/PROJECT_MAP_snapshot_2026-09-07.md`。

最后核对：2026-09-07 14:xx UTC（发布后公网与 SSH 复核）。

## 1. 目标与不变原则

1. 客户提交 CDK + Session 后系统自动完成开通，不要求运营逐单找开关。
2. 资金：一单每阶段一次付款；结果未知不重付、不换卡、不换路线；路线与卡台在建单时冻结；开卡幂等；审计证据不删。
3. 两种充值方式（API 充值 / 浏览器自动化充值）共用订单、卡、账本；多卡台可注册，切换只影响新单，不自动回退，系统只提醒。
4. 卡与订单：Plus 一卡一单或一卡多单由运营者设置（现值 3）；5X/20X 默认一卡一单；开卡金额与最低余额按产品。
5. 单人内部系统：简单、稳定、好用优先；不为推测性风险扩系统，不设人为限速。
6. 运营者只做五个决定：接不接单、走哪条路线、用哪个卡台、能不能付钱、能不能开卡补钱。日常只做三件事：发 CDK、处理订单、管卡片。

## 2. 业务主链

客户提交 CDK + Session → 建单并冻结路线与卡台 → 卡资格与余额 → 唯一 attempt / 资金栅栏 → API 或 Browser 执行 → 确认 Plus（20X 再升级）→ 取消续费 → 账本、对账、通知。

## 3. 当前生产事实（2026-09-07 13:00 UTC）

| 项目 | 事实 |
|---|---|
| release | `/opt/pojia/releases/20260907-orders2-0238601`（09-07 15:31 UTC，后台订单页「一张表 + 一个抽屉」+ 需处理按阶段判定）；回滚点 `20260907-orders-9ccd2a7`（再前 `20260907-home-2bc0e12`） |
| 服务 | Web active；API Worker inactive（09-06 03:46 UTC 人为停止）；Browser Worker inactive/disabled；补余额与读同步 timer active；旧自动开卡 timer disabled |
| 开关 | 接单 true；自动派发 true；默认路线 Browser；Browser 卡台 = 备用卡台 A；Browser 付款开关 false；自动开卡 false；自动补余额 true；每卡成功次数 3；最低卡余额 16（09-07 08:28–09:33 UTC 曾临时 8） |
| 卡 | HNSKJ 已恢复但 `5980` 只剩 $0.31；备用 A `5501` $8.87 低于门槛 16、`0237` $0 → 可分配 0 |
| 订单 | 成功 2、失败 8、关闭 10、等 Session 0；API 路线 1 单 CANCELLATION_PENDING（09-07 误触发直充已按正常流程结单，实付 982.14 PHP，只剩取消续费待跑）；活动资金栅栏 0 |
| 迁移 | 049（`browser_run_events` 每单阶段时间线） |
| Browser 自动化 | 生产从未自动完成过一笔付款；09-07 演练首次自动走完填卡/地址/邮箱/零税报价并停在点击前（run FAILED_SAFE/PRE_PAYMENT_ABORT，0 许可 0 点击）；此前 21 个 run 中 20 个为 09-01 的 CHATGPT_ACCESS_BLOCKED，1 个 09-06 到 Checkout 未填表后人工完成 |
| 本机 | BitBrowser + mihomo（launchd）；LIVE Worker 靠手动 `--once`，无常驻；SSH 隧道 13306→3306（掉线时 `ssh -f -N -L 13306:127.0.0.1:3306 root@<host>`）；启动脚本：单订单 `run-live-rehearsal.sh check｜once <orderId>`、预检 `run-browser-preflight.sh check｜once`、常驻池 `run-live-pool.sh check｜run rehearsal｜pay`（密钥运行时经 SSH 取入进程，不落盘） |

详细事实表见 `docs/CURRENT_STATE.md`。

## 4. 已完成 / 未完成

已验收：CDK、订单、资金核心（2 笔历史 API 成功）；付款未知锁定与恢复（MySQL 证明）；Browser 付款前只读观察到零税报价（多样本）；备用卡台导入与切换；人工付款收口动作（09-07 部署并实用一次）。

未完成（详见 `docs/UNVERIFIED_LEDGER.md`）：Browser 真实付款与付款后半段（0 次；付款前填写已演练 1 次）；付款后凭证刷新路径（未验证）；20X 自动化；供给自动化（HNSKJ 维护中，自动开卡已停）；Worker 常驻；后台新版；账号风险数据（0）。

## 5. 唯一执行顺序（2026-09-07，用户确认）

0. 已完成：悬空订单收口、备用卡导入修复 `45f953c`、后台小修 `96008d4`、导入免密码免手打确认词 `6948b02` 均已上线（release `6948b02`）；历史文档归档；executor 填表顺序修复 `5a570f6` 与常驻会话替换 `fc20e9a` 在本机 Browser 路径，待真实单验证；上号器 1.2.1 已装入全部 BitBrowser 身份（写入即替换旧会话与登录态）；只读验证脚本已在 Lane 3 跑过一次。
1. 两个只读验证（09-07 完成，Lane 2/3，不付款）：结账在常驻身份内可创建，但必须由页面点击触发（裸调 Plus 被拒「unusual activity」，差别只在页面签名头）；免费账号可直接创建 Pro 5x/20x 结账（阶段数 1）；custom 模式返回 client_secret 而非 URL；同一身份换账号必须清上一账号登录态 cookie（已修）。身份策略分析：`docs/browser-research/IDENTITY_STRATEGY_RESEARCH_2026-09-07.md`。
2. 两页规格，一天出：订单生命周期（阶段、CDK 绑定与退回、N 阶段付款、按产品供给）；执行流程形状（接口优先、浏览器只填 Stripe 表单、身份常驻、停在付款前）；五个决定的数据模型。真实单跑通前只是草稿。
3. 按规格实现新流程 → 测试账号跑到付款前 → 一笔真实付款 → 删除旧编排。完成标准：旧实现已删除。**进度（09-07 09:35 UTC）：测试账号已用生产链路跑到付款点击前**——测试单 `PJV1--j4AnE7fvfgkvaceSr0Z`（备用卡 `5501`）：本机预检 PASSED → 服务器 Worker 短启把订单推到派发边界 → 本机 LIVE 演练 `BROWSER_LIVE_STOP_BEFORE=SUBMIT`：会话替换、身份核对、定价弹窗建结账、卡/地址/邮箱填入、零税重报价 PHP 982.14 / 税 0.00、最终复核后停止；未申请许可、未点击；订单回 CARD_READY、资金栅栏清、卡占用释放。下一步：卡上有钱后，同一订单翻付款开关做一笔真实付款。
4. 并行：六个身份——**常驻多身份 Worker 已实现并在真实排队单上跑过一次闭环**（`production-live-pool-worker.js`，`run-live-pool.sh check|run rehearsal|pay`；领单 → 执行 → 分类安全中止/重试上限；窗口不关、心跳落库；有效会话下的 PRE_SUBMIT_STOPPED 与多 lane 并行未跑；出口隔离仍缺）；供给自动化（按产品）；Browser Worker 搬到常开机器（BitBrowser Windows 版）；**每单阶段时间线入库已实现**（迁移 049，三个 Worker 的证据事件 WAL + 数据库并写；后台展示待第 5 步）；结账导航已支持 Pro 5x/20x 按钮（Pro 产品未入库、未实跑）。
5. 后台五页新版与 CDK 页；密码与手打确认词全部取消。**进度（09-07）**：CDK 规则已按基线实现并上线 `44b00cd`（未付款终态自动退回、同码同账号返回原单、Session 重贴不限次数不限时间），生产订单上未验证；五页新版：结构稿 `docs/ADMIN_FIVE_PAGES_2026-09-07.md` 已确认；第 1 步首页已上线 `2bc0e12`（五个决定一行 + 五个数字 + 需要处理的订单 + 提醒 + 开工检查；新增 `operations/browser-payment`、`operations/supply-automation` 两个开关接口）；第 2 步订单页已上线 `9ccd2a7`+`0238601`（列表七列：订单/产品/当前阶段/需要我做什么/卡尾号/身份/创建时间；筛选 全部/需要处理/进行中/已完成；抽屉 动作区→执行时间线→资金与结果→客户与会话→卡片→身份与运行→技术证据；阶段由 `src/services/order-stage.js` 按 CORE_SPEC §1 投影；删除标签/备注/补发/灰度许可/退款观察列；二次密码已移除）；下一步是第 3 步卡片页。
6. 20X 启用第二付款阶段。
7. 删除零使用接口与旧表，删前查调用链。

穿插不动结构的小修：告警可关闭；CDK 去密码、去 10 分钟清空；备用卡导入去密码去手打确认词并显示真实失败原因；最低所需卡余额可在库存页设置；隐藏死控件；客户页等待承诺按真实队列与开关计算；Session 密文交付后清理；首页与待办列表适配手机。

## 6. 明确不做

逐单选路线或卡台；卡台自动回退；每身份每日上限、延后取消续费等无依据限速；为每单新建浏览器窗口（常驻身份每单清登录态、留设备，09-07 用户确认；封控细节由 Codex 另行研究）；裸调结账接口（由页面点击触发）；为未出现的风控加闸门；第二套订单或资金账；删历史证据；把测试通过说成生产可用。

## 7. 维护纪律

- release、服务、开关、路线、卡台、订单终态变化：同一提交更新本文 §3 与 `docs/CURRENT_STATE.md`；方向变化更新 `docs/DECISIONS.md`；过程追加到 `docs/HANDOFF_LOG.md`。
- 本文保持一页：只留当前有效状态，不在顶部堆叠历史引用块；历史进归档。
- 外部审查（Codex 审查员、分板块核查）按 `docs/REVIEW_PROTOCOL.md`；审查记录 `docs/reviews/REVIEW_RECORD.md` 只由审查员写，处置记录 `docs/reviews/DISPOSITIONS.md` 只由执行者写。
- 生产发布只从单一提交构建并全量校验：`scripts/deploy-release.sh prepare <commit> <name>` → 复核 → `switch <name>`（内部调用 `build-production-release.sh` / `verify-production-release.sh`，含备份、manifest 校验、健康检查与回滚命令）。
- 数据库集成测试串行运行（`--test-concurrency=1`）。
- 不得绕过正式连接池直连生产库写入。
