# 审查范围｜2026-09-07 基线确认以来的全部改动（供新窗口审查）

用户要求：不只审最后那份方案，要审"从 Opus 4.8 接手以来"落到代码里的一切。本文把范围钉死：**2026-09-07 起到 HEAD 的运行代码、脚本、迁移**，共 39 个运行文件、40 余次提交。审法按 `docs/REVIEW_PROTOCOL.md`（只读、每条附证据、报告落 `docs/reviews/`），审完再动。

对每一项问三个问题：①它解决的问题真的存在吗（现场证据是什么）；②它在**真单会走的路径**上验过没有（单测≠演练≠真单）；③它有没有引入新的未验证假设。

已知"修了一半"的两处先记着：`96ac467`（付款后不重注入旧 token）只改了付款路径，核实 lane `live-post-payment-recovery.js:77-84` 还在重注入（审计 F-18）；预检 DEAD 无重开（审计 F-1）。

## 一、Browser 执行链（本机 `browser-mvp/src`，worker 从工作区启动，无需服务器发布）

| 提交 | 日期 | 改了什么 | 验证到什么程度 |
|---|---|---|---|
| `5a570f6` | 09-07 | 有付款处理器时不再在填卡前等零税重报价（09-06 真单没填表的根因） | 09-07/09-09 演练到点击前 |
| `fc20e9a` | 09-07 | 常驻会话属于他人/已失效时一次性替换为本单 token | 09-09 真单第一次真正走到（随后撞 D-140） |
| `2290cc6` | 09-07 | 换账号时清上一登录态 cookie | 同上 |
| `78e3f84` | 09-07 | LIVE 演练模式 `BROWSER_LIVE_STOP_BEFORE=SUBMIT` | 演练 2 次 |
| `b7e73c5` `be6d066` | 09-07 | 身份探测识别 RefreshAccessTokenError / 网页端 authStatus≠logged_in | 09-07 只读验证 |
| `0bd113d` | 09-07 | 安全字段等待 10s→45s | 演练 |
| `54f3254` | 09-07 | 常驻多身份 Worker（pool：核实→预检→领单） | 09-09 rehearsal 1 次；多 lane 未跑 |
| `ca2c794` | 09-07 | 导航器适配叠层弹窗/续跑/会话过期弹窗 | 09-07 只读 |
| `b8a005a` | 09-07 | 每单阶段时间线入库（迁移 049 `browser_run_events`） | 上线；**同一任务重试只落第 1 次**（审计 F-14） |
| `1e8449c` `42073c7` `58db552` `2e92cdb` `fd9fd7d` | 09-08 | Pro 第二阶段：走到「Confirm plan changes」弹窗停下、#pricing 入口、新开结账页也算停止点、等金额渲染 | 09-08 真实已 Plus 账号只读走到弹窗；付款后接入未验证 |
| `e27ac92` | 09-08 | 两阶段 Pro 的 stage 1 固定买 Plus | 未在真单验证 |
| `ff35923` | 09-08 | transactionReaderFactory 用 runId 解析卡上下文 | 未在真单验证 |
| `3615729` | 09-08 | 复用已存在标签注入后强制 reload；等头像菜单渲染 | 演练 |
| `96ac467` | 09-08 | 付款后不再重注入旧 token（D-134）——**只改了 shared-live-composition** | 09-08 手动两阶段验证不重登；**核实 lane 未改（F-18）** |
| `e57025c` | 09-08 | session bootstrap 支持注入完整 cookie 导出（含 auth.openai.com 层） | **生产材料只有 token（客户贴 /api/auth/session JSON），这条路径在生产从未触发**；只有单测 |
| `e8934ca` | 09-08 | confirmPlus 付款后先抓 accounts/check 快照 | 未在真单验证 |
| `fee5f9a` | 09-08 | 付款前 drift 清空卡字段（D-137） | 单测 |
| `2d38c74` | 09-09 | verifier 去诊断噪音、慢激活轮询退避 | 单测 |
| `3014578` | 09-09 | worker 报错打 message、ready-check 加付款开关/账号槽/可分配卡检查 | 本机使用 |
| `3b9d791` | 09-10 | 注入 cookie 放 `.chatgpt.com` 域（D-140）；openPricingSelectors 加 Rejoin Plus | 对照实验到结账页；**真单未验** |
| 未提交为 commit 的运行配置 | 09-09 | `run-live-pool.sh` 租约默认 120→900 秒 | 只验到"预检不再超时" |

## 二、资金与订单状态（服务器 `v1/src`，线上 release `20260909-askform-cc3bba0` 含到 `c7288c1`）

| 提交 | 日期 | 改了什么 | 验证到什么程度 |
|---|---|---|---|
| `f8c1d30` | 09-07 | 基线 CDK 规则：未付款终态自动退回、同码同账号返回原单、Session 重贴不限次数 | 单测；**生产订单未验**；客户页重贴表单因 F-5 实际不可用 |
| `ae68195` | 09-07 | 无卡的等 Session 订单可取消 | 上线 |
| `fbba5fe` | 09-08 | 付款前失败释放卡绑定（D-131）；Browser 终态落提醒 + Bark | 上线；Bark 未在真实 run 触发过 |
| `bf2f25c` | 09-08 | `orders.cdk_id` 唯一索引改普通索引（迁移 050），退回的 CDK 可绑新单 | 上线 |
| `bad14cc` | 09-08 | 取消释放卡时保留 MANUAL_IMPORT 同步等级 | 上线 |
| `0073d45` | 09-08 | Pro 5X/20X 两阶段产品入库；CDK 按产品；最低余额按产品 | 上线；Pro 真单 0 |
| `370c7ce` | 09-08 | 手动卡导入"累计充值−消费≠余额"降为提示 | 上线，用过 |
| `37ceaff` | 09-08 | 付款开关写 executor_profiles 不再引用不存在的列 | 上线，用过 |
| `c7288c1` | 09-09 | 「已在账号里取消续费」收口动作；askForm 替代全部 prompt | 上线；生产实用 1 次 |
| `v1/scripts/close-rehearsal-order.mjs` `close-stale-residue.mjs` `close-manually-fulfilled-order.mjs` | 09-09/10 | 三个收口脚本（正式连接池、dry-run、审计事件） | 各在生产跑过 1 次；`--card-used` 分支未跑 |
| 迁移 `051_orders_cdk_id_reusable` | 09-08 | 见 `bf2f25c` | 上线 |

## 三、后台五页与接口删减（`v1/src/services/admin-*`、`create-app.js`、`public/admin`）

`96008d4` `ed40c94` `6948b02` `2bc0e12` `9ccd2a7` `0238601` `af188c9` `6f1217f` `5687598`（09-07）：首页/订单/CDK/卡片/诊断五页新版；删除 14 条无消费者接口与二次密码；`order-stage.js` 阶段投影。**验证方式：上线并日常使用**；审查重点是 `order-stage.js` 的投影是否与真实状态一致（审计已指出"等待自动执行"提示指向错误原因），以及删接口有没有删掉还在用的。

## 四、迁移与配置

- 迁移 049（`browser_run_events`）、050/051（`orders.cdk_id` 索引）——上线。
- `app_settings`：`minimum_required_card_balance:pro_20x=150`（09-09 用户定）；`browser_payment_writes_enabled` 由 go-live/stop-live 开关并写审计。
- 本机：mihomo/隧道 launchd、`ready-check.sh`/`go-live.sh`/`stop-live.sh`/`state-check.sh`/`prod-query.sh`。

## 五、文档体系（09-09 改造）

HANDOFF_NOW / RUNBOOK / CURRENT_STATE 唯一事实表 / state-check / DECISIONS D-131–D-140。审查重点：**文档说的和代码做的是否一致**（例如 CORE_SPEC §5.1"贴码即验"文档有、代码无——审计 F-10）。

## 六、建议的审查顺序

1. 先审第一节（Browser 执行链）——真单今天要走的路，且大多只有演练级验证。
2. 再审第二节里三处"付款前失败→释放/退回"（`fbba5fe`、`f8c1d30`、`bf2f25c`）与三个收口脚本——它们直接动资金/CDK 状态。
3. 再对照 `docs/reviews/FULL_CHAIN_AUDIT_2026-09-10.md` 的 F 编号看有无遗漏或误判。
4. 第三、四、五节按需。

审查报告落 `docs/reviews/REVIEW_RECORD.md`（审查员写）；执行者处置落 `docs/reviews/DISPOSITIONS.md`。
