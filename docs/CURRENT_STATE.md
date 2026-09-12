# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260912-customer-page-624487c`（commit `624487c`；候光客户充值页：卡密先验接口、九阶段、四步流程、新标志；D-182～D-184）。回滚 `20260911-card-stock-alert-69946b0` | 2026-09-12 12:55 UTC | `customer-sql-probe.sh` 五条 SQL 全通过 → `prepare`（1019 文件 manifest OK、库备份 OK）→ `switch`；服务器本机独立 curl 复验：客户页引用 `customer.js?v=35` 且实际服务的文件含 checkSession/navTheme/runQuery；`POST /api/v1/orders/status` 对真实成功单**返回 stage 字段**（index 9 / SUBSCRIPTION_ACTIVE，D-184 的修复生效）；`POST /api/v1/cdks/verify` 200、`Cache-Control: no-store`、`RateLimit-Limit: 10`、未知码返回 INVALID；admin 登录页 200、`/api/v1/admin/overview` 在非 admin host 下 404；web / worker / operator-watch.timer 均 active |
| 回滚点 | `/opt/pojia/releases/20260911-highvcc-snapshot-sync-275f6e7`（再前 `20260910-highvcc-ui-feedback-cdcf42e`；本版无迁移，直接切回即可；timer 单元不随 release 变化） | 2026-09-11 04:42 UTC | switch 输出 ROLLBACK 命令 |
| 最新数据库备份 | `/var/backups/pojia/pojia-20260911T044030Z.sql.gz.enc`，完整性 OK（release prepare 阶段） | 2026-09-11 04:42 UTC | deploy-release prepare 输出 |
| pojia-web | active（2026-09-11 04:42 UTC 随 release 切换重启） | 2026-09-11 04:42 UTC | switch 输出 + 服务器本机 curl live/ready 200 |
| highvcc 备用卡台 A token | 已配置进生产（`app_settings.highvcc_access_token_ciphertext`，加密存储，09-10 09:17 UTC 写入） | 2026-09-10 09:52 UTC | `v1/scripts/set-highvcc-token.mjs` 输出 |
| highvcc 备用卡台 A 已开卡片（本窗口） | 3 张：尾号 9839（$50，08:xx）、9354（$5，09:19）、3241（$3，09:35，开卡时因 detail() 竞态未即时入库，09:53 用 `reconcile-highvcc-card.mjs` 补记）；账户另有 $20 押金要从钱包余额里先扣，才是真实可开卡余额（Lemon 提供） | 2026-09-10 09:52 UTC | 平台卡片列表 + `cards` 表独立核对 |
| pojia-worker（v1 任务 Worker） | active（处理 ASSIGN_CARD/PREPARE/SUBMIT_RECHARGE/POLL 等；Browser 路线的 BROWSER_PREFLIGHT 与付款由本机 worker 跑） | 2026-09-09 11:46 UTC | systemctl |
| pojia-browser-worker | inactive / disabled（Browser 执行在本机，来单人工拉） | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-funding.timer | `pojia-highvcc-snapshot-sync.timer` 已改为每 1 小时（D-169），无变化时只发 1 次列表请求、不发逐卡详情 | 2026-09-11 14:21 UTC | systemctl |
| pojia-card-read-sync.timer | active | 2026-09-09 11:46 UTC | systemctl |
| pojia-highvcc-snapshot-sync.timer | active / enabled，每 10 分钟 oneshot 跑 `v1/scripts/sync-highvcc-snapshot.mjs --commit`（pojia 用户，runtime.env）；首次手动 run exit 0，批次 `23584a48`（9 更新，因表格与本机 02:53 那次的字节不同：固定 mtime 是之后才加的）；**03:49:13 UTC 定时触发已核实：数据未变 → `replay:true`、沿用批次 `23584a48`、批次表无新增、exit 0** | 2026-09-11 03:40 UTC | ssh：`systemctl is-active/is-enabled`、`journalctl -u`、`list-timers`；隧道新连接查 manual_card_import_batches |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 2026-09-09 11:46 UTC | systemctl |
| 健康 | `127.0.0.1:3100` live 200 / ready 200；后台登录页 200（ADMIN_HOST） | 2026-09-09 06:35 UTC | curl（服务器本机） |
| 数据库迁移 | 最新 `052_cards_bin`（cards 增 card_bin，D-168；051 于 09-08 01:25 UTC，050 于 09-07 19:16 UTC） | 2026-09-11 13:32 UTC | schema_migrations / 仓库 v1/migrations |
| accept_new_orders | true | 2026-09-09 11:46 UTC | app_settings |
| dispatch_new_recharges / 模式 | true / AUTOMATIC | 2026-09-09 11:46 UTC | app_settings |
| 默认路线 | Browser（`CHATGPT_PLUS_BROWSER_V1`/`PRO_5X`/`PRO_20X` accepts_new_orders=1，旧 API 路线=0） | 2026-09-09 11:46 UTC | fulfillment_routes |
| Browser 当前卡台 | 备用卡台 A（`manual_excel` / `backup-a`） | 13:31 | browser_card_source_selections |
| browser_dispatch_enabled | true | 2026-09-09 11:46 UTC | app_settings |
| browser_payment_writes_enabled | **true**（2026-09-12 04:47:58 UTC 由 Lemon 在后台开启，进入无人值守：客户任意时间兑换即自动处理，**会真实扣卡上的钱**。关闭方式同一处按钮；关掉后常驻执行器退回「只等不跑」，订单停在付款前） | 2026-09-12 | app_settings / admin_setting_events；常驻 LaunchAgent `com.pojia.browser-pool` 于 04:49:00 自动拉起 worker，心跳持续推进 |
| **菲律宾出口对 ChatGPT 的可达性** | **未定论**。裸 curl 经出口访问 chatgpt.com 返回 403 Cloudflare 拦截页，但 **curl 不能用来判断 Cloudflare 是否封禁**（无 TLS 指纹、不执行 JS，会被单独拦）。**Lemon 当场在 BitBrowser 窗口里看到的是 ChatGPT 的退出登录页面，说明页面打得开、出口没被整站封**。真实根因转向「Session 没能登录上」，见 D-187 | 2026-09-12 09:40 UTC | 反例证据来自 Lemon 直接观察窗口；curl 测试已作废 |
| Browser Profile productionWritesEnabled | false（随付款开关同步） | 09-09 | executor_profiles config_public_json |
| card_auto_replenishment_enabled | false（与补余额构成首页「开卡补钱」的"部分开启"态） | 2026-09-09 11:46 UTC | app_settings |
| card_balance_recharge_enabled | true（对手动卡无效） | 2026-09-09 11:46 UTC | app_settings |
| card_max_successful_payments | 3 | 2026-09-09 11:46 UTC | app_settings |
| 最低所需卡余额 | default 16 / pro_5x 16 / **pro_20x 150**（09-09 05:33 UTC 调，独立核实；5X 上线前同调） | 2026-09-09 11:46 UTC | app_settings（`minimum_required_card_balance:*`）+ admin_setting_events |
| Worker 进程写权限 | worker：`PROVIDER_RECHARGE_WRITES_ENABLED=true`（drop-in），通用/卡片写 false；funding 单元：`PROVIDER_CARD_WRITES_ENABLED=true`；env 文件 `PROVIDER_READS_ENABLED=true` | 16:35 | `systemctl cat` |
| HNSKJ 卡 | `5980` DEPLETED，余额 $0.31（09-07 12:07 UTC 直充扣 $15.69，占用已释放）；其余 5 张 ASSIGNED 于历史订单且 ≤ $0.01；5 张 DEPLETED；HNSKJ 可分配 0 | 09-07 14:42 | cards |
| 备用卡（备用卡台 A = highvcc，manual_excel 导入与一键开卡同池，sync_tier=MANUAL_IMPORT） | 卡台现存 5 张（3118 $60 / 7402 $1.08 / 0601 $1.27 / 5501 $1.79 / 0237 $0）；库内另有 3241、9354 于 10:50 同步时仍在、之后消失，尚未被下一次快照标记。10 分钟自动快照同步正常工作（3118 开卡后 2 分钟内入库并 ACCEPTED） | 2026-09-11 10:58 UTC | 脚本 preview→门控→commit 输出；隧道新连接独立 SELECT cards / manual_card_import_batches |
| 可分配卡（资格 SQL，Plus 门槛 16） | **1 张：卡段 `53211304`，余额 $39.24，MANUAL_IMPORT（不受同步新鲜度限制）**。**这是唯一自动成功过的那个卡段**——7 次付款提交里 6 次用卡段 `51398996` 全败、1 次用 `53211304` 成功（D-185）。按单笔实耗约 $15.76 估，这张够约 2 单。非终态订单 0。**全部 21 张的卡段分布**：`51398996` 7 张（$55.79，余额够的 1 张，已知拒付集中）／`40024200` 5 张（$0.34）／`43612081` 5 张（$0.05）／`53211304` 2 张（$40.51，余额够的 1 张）／`42882000` 1 张／`40041606` 1 张。**补货认准 `53211304`，别补 `51398996`** | 2026-09-12 14:50 UTC | 资格 SQL 九个条件逐条直查 |
| HNSKJ 卡台 | 09-05 起故障；09-07 12:06 UTC 前已恢复（读同步与交易同步成功，`provider_calls` SUCCESS）；开卡/补余额未再验证 | 09-07 14:00 | provider_calls / cards.last_transaction_synced_at |
| 订单总况 | RECHARGE_SUCCESS 7 / RECHARGE_FAILED 15 / CLOSED 14 / 非终态 0。待 Lemon 复核取消续费：Dqcn（本次）；VHl_ 09-09 那条按前表仍为 1 未核 | 2026-09-11 02:38 UTC | orders GROUP BY status 推算（收口前 6/15/14/1 + 本次 1 转成功） |
| 活动资金与运行 | active_runs 0；Dqcnq 存在 ACTIVE 卡分配 1，不再是“全库无活动分配”。其余全库资金/dispatch/账本聚合本轮未完整重验，旧 09-09 清零快照不能代表现在 | 2026-09-10 23:23 UTC | browser_runs active_account_key_hmac COUNT=0；卡分配查询 |
| 最近 Browser 运行 | **09-09 14:53–15:12 UTC 真单 `PJV1-VHl_` 预检（Lane4，pay 模式）5 次全败、无 run、无付款**：第 1–3 次 `LEASE_LOST`（租约 120s 到期于身份核对之后）；第 4–5 次 `CHECKOUT_NAVIGATION_FAILED`——session 注入/清旧登录态/身份核对/点升级均通过，结账页 `chatgpt.com/checkout/openai_llc/oaics_…` 返回 **403**（标题 Unhandled Thrown Response!），刷新后 **500** Application Error（Cloudflare 前置，文档请求本身失败，非 API 子请求）。任务 135 DEAD。上一次成功演练：09-09 04:2x rehearsal `PJV1-zLUtyjBjxrYnQsLeTpBN`（free 账号，到零税报价 ₱982.14） | 2026-09-09 15:27 UTC | tasks / lane-4.wal / CDP 现场截图 |
| Browser 自动化里程碑 | 生产**全自动真实付款 0 次**；**第一笔真单（09-09）失败**：租约 120s 不足 + 结账页 403/500，用户上号器手动完成；真实客户账号上已验证通过的步骤：session 注入、清旧登录态换 session、身份核对、点升级建结账；**未通过：结账页加载**。rehearsal（free 账号）2 次到零税报价。**D-139：403 根因未清前自动付款不上真单** | 2026-09-09 15:27 UTC | UNVERIFIED_LEDGER / HANDOFF_LOG |
| 最近真实单 | `PJV1-ztS9FZ3QcwHopTmZRfDY`（11:10 提交，mengx612，Pilot，**新卡 3118 / 卡段 53211304**）：**全链路首次跑通** → RECHARGE_SUCCESS，Plus 已生效、续费已自动取消并二次确认（独立核实 `will_renew=false`，到期 2026-10-11）。实扣 $15.76。详见 `docs/E2E_CHAIN_TEST_SAMPLE.md` 第 4 次 | 2026-09-11 11:30 UTC | 生产主机 dry-run + 真跑输出；隧道新连接独立 SELECT（orders/tasks/cdks/cards/card_assignment_history） |
| 告警 | OPEN 16：PROVIDER_BALANCE_CHANGED 11（info 噪音，后台不显示）、BROWSER_ORDER_FAILED 4（09-08 测试单付款前失败）、CARD_STOCK_LOW 1 | 2026-09-09 11:46 UTC | operator_alerts |
| 本机 | BitBrowser Local API（`ready-check.sh` 发现未开会自动启动）+ mihomo（launchd `com.pojia.mihomo-ph` KeepAlive，出口锁菲律宾 38.60.246.34）；SSH 隧道 13306→3306 由 launchd `com.pojia.ssh-tunnel-13306` 守护；无常驻 Worker（来单 `go-live.sh --arm` 拉、`stop-live.sh` 收）；Lane4 clean 窗口 `51e915e` 为付款/演练身份 | 09-09 | launchctl / lsof / curl |
| 已上线（本次 release） | `20260911-drop-preflight-24bcbde`：一单只登一次客户账号（不再有独立预检任务与派工前置）。同批 browser-mvp 本机改动：结账页无收据邮箱字段时不再中止（D-157） | 2026-09-11 10:02 UTC | 服务器本机 curl 复验（见 release 行） |
| 已知未修 | ①**结账页 403：候选修复已落代码（D-140），根因未坐实，真单未验证**：注入的 session cookie 曾按 `{url}` 放成 host-only，与网站在 `.chatgpt.com` 轮换的同名 cookie 并存；对照实验（同号同窗口同出口）复现 + 改 `.chatgpt.com` 域后结账页打开出 ₱ 报价。但本机 WAL 显示 09-07/09-08 有 7 次同样并存却到达结账页、1 次付款成功（审查 F-27），"并存即 403"不成立；真单再 403 按 D-139 转人工。修复在 `browser-mvp/src/session-bootstrap.js`（本机工作区，pool worker 从工作区启动即生效，无需服务器发布）；次要差异未处理：注入路径没有 auth.openai.com 层（付款后刷新依赖，D-134 已知）；②预检租约默认已改 900s（`run-live-pool.sh`），只在 09-09 第 4–5 次预检验证过"不再超时"，未在成功路径验证，A1 演练也验不到（F-33）；③`browser_run_events` 同一任务多次重试只落第 1 次（job_id+sequence 唯一键），后续尝试只在本机 WAL；④本机绕过连接池直连写入（09-07/08）遗留问题已清；⑤后台控制事务并发可能 `ER_LOCK_DEADLOCK`；⑥手动卡付款后无独立卡侧扣款证据；⑦审查批次 1 P1 处置更新：中途关付款开关即判失败（F-25）、点击后 kill 无核实排程（F-26）——已修，browser-mvp 本机代码，pool worker 下次启动即生效，不需要本次 v1 release；打回后重提同码丢 Session（F-34）、换账号重提 409（F-35）——已修且已随本次 release（`20260910-highvcc-open-session-resubmit-0b5639c`）发布到生产，未做真单复验 | 2026-09-10 09:10 UTC | 本表 + REVIEW_RECORD 批次 1 + 本次 release |

## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
