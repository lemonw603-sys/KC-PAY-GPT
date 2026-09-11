# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260910-highvcc-ui-feedback-cdcf42e`（commit `cdcf42e`；highvcc「刷新余额」按钮补上成功/失败提示，「保存 token」输入框为空时补上提示（此前两者点击后台面均无反应）；admin.js 升到 v=44；**2026-09-10 23:2x UTC 独立核对：本 release 的 browser-admin-service.js 已含 `RESOLVE_UNKNOWN_PAYMENT`（第 974 行）；此前“尚未部署”记载错误。仅证实代码存在，未调用动作、未验收端到端/UI**；无新迁移；回滚点 `20260910-bookmarklet-label-21a7f80`） | 2026-09-10 12:45 UTC | `readlink -f /opt/pojia/current`；switch live/ready/admin 均 200；服务器本机独立 curl 已核对 admin.js 新增的三处 showNotice 文本均在生产返回内容中；本机 v1 全量 641 个断言/583 通过/2 败（均为既有 F-40 版本号断言未同步，与本次改动无关） |
| 回滚点 | `/opt/pojia/releases/20260910-bookmarklet-label-21a7f80`（再前 `20260910-highvcc-bookmarklet-1738627`；本版无迁移，直接切回即可） | 2026-09-10 12:45 UTC | 部署记录（switch 输出 ROLLBACK 命令） |
| 最新数据库备份 | `/var/backups/pojia/pojia-20260910T124348Z.sql.gz.enc`，完整性 OK（release prepare 阶段） | 2026-09-10 12:45 UTC | deploy-release prepare 输出 |
| pojia-web | active（09-10 12:4x UTC 随 release 切换重启） | 2026-09-10 12:45 UTC | systemctl |
| highvcc 备用卡台 A token | 已配置进生产（`app_settings.highvcc_access_token_ciphertext`，加密存储，09-10 09:17 UTC 写入） | 2026-09-10 09:52 UTC | `v1/scripts/set-highvcc-token.mjs` 输出 |
| highvcc 备用卡台 A 已开卡片（本窗口） | 3 张：尾号 9839（$50，08:xx）、9354（$5，09:19）、3241（$3，09:35，开卡时因 detail() 竞态未即时入库，09:53 用 `reconcile-highvcc-card.mjs` 补记）；账户另有 $20 押金要从钱包余额里先扣，才是真实可开卡余额（Lemon 提供） | 2026-09-10 09:52 UTC | 平台卡片列表 + `cards` 表独立核对 |
| pojia-worker（v1 任务 Worker） | active（处理 ASSIGN_CARD/PREPARE/SUBMIT_RECHARGE/POLL 等；Browser 路线的 BROWSER_PREFLIGHT 与付款由本机 worker 跑） | 2026-09-09 11:46 UTC | systemctl |
| pojia-browser-worker | inactive / disabled（Browser 执行在本机，来单人工拉） | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-funding.timer | active | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-read-sync.timer | active | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 2026-09-09 11:46 UTC | systemctl |
| 健康 | `127.0.0.1:3100` live 200 / ready 200；后台登录页 200（ADMIN_HOST） | 2026-09-09 06:35 UTC | curl（服务器本机） |
| 数据库迁移 | 最新 `051_orders_cdk_id_reusable`（09-08 01:25 UTC 应用；050 于 09-07 19:16 UTC）；仓库最新亦为 051，无待应用迁移 | 2026-09-09 11:46 UTC | schema_migrations / 仓库 v1/migrations |
| accept_new_orders | true | 2026-09-09 11:46 UTC | app_settings |
| dispatch_new_recharges / 模式 | true / AUTOMATIC | 2026-09-09 11:46 UTC | app_settings |
| 默认路线 | Browser（`CHATGPT_PLUS_BROWSER_V1`/`PRO_5X`/`PRO_20X` accepts_new_orders=1，旧 API 路线=0） | 2026-09-09 11:46 UTC | fulfillment_routes |
| Browser 当前卡台 | 备用卡台 A（`manual_excel` / `backup-a`） | 13:31 | browser_card_source_selections |
| browser_dispatch_enabled | true | 2026-09-09 11:46 UTC | app_settings |
| browser_payment_writes_enabled | **false**（09-09 为 rehearsal/预检关闭并带审计；真单来时 `go-live.sh --arm` 开回） | 09-09 | app_settings / admin_setting_events |
| Browser Profile productionWritesEnabled | false（随付款开关同步） | 09-09 | executor_profiles config_public_json |
| card_auto_replenishment_enabled | false（与补余额构成首页「开卡补钱」的"部分开启"态） | 2026-09-09 11:46 UTC | app_settings |
| card_balance_recharge_enabled | true（对手动卡无效） | 2026-09-09 11:46 UTC | app_settings |
| card_max_successful_payments | 3 | 2026-09-09 11:46 UTC | app_settings |
| 最低所需卡余额 | default 16 / pro_5x 16 / **pro_20x 150**（09-09 05:33 UTC 调，独立核实；5X 上线前同调） | 2026-09-09 11:46 UTC | app_settings（`minimum_required_card_balance:*`）+ admin_setting_events |
| Worker 进程写权限 | worker：`PROVIDER_RECHARGE_WRITES_ENABLED=true`（drop-in），通用/卡片写 false；funding 单元：`PROVIDER_CARD_WRITES_ENABLED=true`；env 文件 `PROVIDER_READS_ENABLED=true` | 16:35 | `systemctl cat` |
| HNSKJ 卡 | `5980` DEPLETED，余额 $0.31（09-07 12:07 UTC 直充扣 $15.69，占用已释放）；其余 5 张 ASSIGNED 于历史订单且 ≤ $0.01；5 张 DEPLETED；HNSKJ 可分配 0 | 09-07 14:42 | cards |
| 备用卡（manual_excel / highvcc 一键开卡，均 sync_tier=MANUAL_IMPORT） | **系统余额不同步，以下为卡台 highvcc 实时值（分→元）与 `cards` 表对照**：7402 卡台 $1.08 / 表 $49.00（差额=卡台交易记录两笔 OpenAI 消费 $15.75@09-09 15:13 UTC + $142.87@09-10 03:47 UTC，均系统外，账本零消费；Lemon 提供截图）；5501 卡台 $1.79 / 表 $0.07；0601/7428/2911/0237/3241 两侧一致。**9839（$50.00）、9354（$5.00）在卡台已激活但不在 `cards` 表**，9839 系 CLI 开卡待导入、9354 疑与 3241 同一 detail 竞态未入库。7402 ASSIGNED 绑 Dqcn。5 张 RETIRED override 不变 | 2026-09-11 00:5x UTC | highvcc `list`/`detail`（只读，`browser-mvp/scripts/highvcc-card.mjs` + provider `detail()`）+ cards + card_consumption_ledger + card_state_events（7402 为空）+ Lemon 截图 |
| 可分配卡（资格 SQL，Plus 门槛 16） | **按库中静态余额 1 张（7402 $49.00），但卡台实时余额 $1.08，实际 0 张够 Plus**。非终态订单 0。Dqcn 已于 2026-09-11 02:38 UTC 以人工履约收口释放 7402。**已知系统缺口**：`card-inventory-eligibility.js:10` 对 `sync_tier=MANUAL_IMPORT` 跳过新鲜度检查直接信任静态 `current_balance`，highvcc 卡入库即标 MANUAL_IMPORT（`highvcc-card-service.js:196`）；在余额刷新前来单会分到 7402 空卡（付款开关 false、Browser 链路预检不通，暂到不了付款）。state-check 在 0 张时误报 1 张（NULL 计数 bug，脚本未修） | 2026-09-11 02:38 UTC | 资格 SQL + 卡台 `detail`；代码行号见前 |
| HNSKJ 卡台 | 09-05 起故障；09-07 12:06 UTC 前已恢复（读同步与交易同步成功，`provider_calls` SUCCESS）；开卡/补余额未再验证 | 09-07 14:00 | provider_calls / cards.last_transaction_synced_at |
| 订单总况 | RECHARGE_SUCCESS 7 / RECHARGE_FAILED 15 / CLOSED 14 / 非终态 0。待 Lemon 复核取消续费：Dqcn（本次）；VHl_ 09-09 那条按前表仍为 1 未核 | 2026-09-11 02:38 UTC | orders GROUP BY status 推算（收口前 6/15/14/1 + 本次 1 转成功） |
| 活动资金与运行 | active_runs 0；Dqcnq 存在 ACTIVE 卡分配 1，不再是“全库无活动分配”。其余全库资金/dispatch/账本聚合本轮未完整重验，旧 09-09 清零快照不能代表现在 | 2026-09-10 23:23 UTC | browser_runs active_account_key_hmac COUNT=0；卡分配查询 |
| 最近 Browser 运行 | **09-09 14:53–15:12 UTC 真单 `PJV1-VHl_` 预检（Lane4，pay 模式）5 次全败、无 run、无付款**：第 1–3 次 `LEASE_LOST`（租约 120s 到期于身份核对之后）；第 4–5 次 `CHECKOUT_NAVIGATION_FAILED`——session 注入/清旧登录态/身份核对/点升级均通过，结账页 `chatgpt.com/checkout/openai_llc/oaics_…` 返回 **403**（标题 Unhandled Thrown Response!），刷新后 **500** Application Error（Cloudflare 前置，文档请求本身失败，非 API 子请求）。任务 135 DEAD。上一次成功演练：09-09 04:2x rehearsal `PJV1-zLUtyjBjxrYnQsLeTpBN`（free 账号，到零税报价 ₱982.14） | 2026-09-09 15:27 UTC | tasks / lane-4.wal / CDP 现场截图 |
| Browser 自动化里程碑 | 生产**全自动真实付款 0 次**；**第一笔真单（09-09）失败**：租约 120s 不足 + 结账页 403/500，用户上号器手动完成；真实客户账号上已验证通过的步骤：session 注入、清旧登录态换 session、身份核对、点升级建结账；**未通过：结账页加载**。rehearsal（free 账号）2 次到零税报价。**D-139：403 根因未清前自动付款不上真单** | 2026-09-09 15:27 UTC | UNVERIFIED_LEDGER / HANDOFF_LOG |
| 最近真实单 | `PJV1-DqcnqHF0tPlxDhygTtAA`：**2026-09-11 02:38 UTC 由大脑窗口用 `close-manually-fulfilled-order.mjs`（默认分支，卡未用）收口 → RECHARGE_SUCCESS，`cancellation_review_required=1` 待 Lemon 点「已在账号里取消续费」**；Lemon 已在系统外手工为该客户完成 Plus（用卡不明，非 7402）。收口前：预检 DEAD 5/5 CHECKOUT_NAVIGATION_FAILED、0 attempt、0 run。7402 释放（分配 RELEASED、账本 RELEASED、AVAILABLE）。其余历史真单见 HANDOFF_LOG | 2026-09-11 02:38 UTC | 生产主机 dry-run + 真跑输出；隧道新连接独立 SELECT（orders/tasks/cdks/cards/card_assignment_history） |
| 告警 | OPEN 16：PROVIDER_BALANCE_CHANGED 11（info 噪音，后台不显示）、BROWSER_ORDER_FAILED 4（09-08 测试单付款前失败）、CARD_STOCK_LOW 1 | 2026-09-09 11:46 UTC | operator_alerts |
| 本机 | BitBrowser Local API（`ready-check.sh` 发现未开会自动启动）+ mihomo（launchd `com.pojia.mihomo-ph` KeepAlive，出口锁菲律宾 38.60.246.34）；SSH 隧道 13306→3306 由 launchd `com.pojia.ssh-tunnel-13306` 守护；无常驻 Worker（来单 `go-live.sh --arm` 拉、`stop-live.sh` 收）；Lane4 clean 窗口 `51e915e` 为付款/演练身份 | 09-09 | launchctl / lsof / curl |
| 已上线（本次 release） | `20260910-highvcc-open-session-resubmit-0b5639c`：highvcc 备用卡台 A 一键开卡（后台新增 4 条路由 + 卡片页一节 UI；token 尚未配置，按钮会先看到"未配置"，需要粘贴 token 后才能查费用/开卡）；F-5 客户页重贴表单 remaining=null 时显示；F-34/F-35 打回态订单收到同码或换账号提交即当作重贴 Session，不再返回原单丢 Session、不再 409。复验：admin.js v=38（含 highvcc，2176 行）、customer.js v=12（含 canReplace）均已服务；highvcc 新路由未登录 401；登录页 200 | 2026-09-10 09:10 UTC | 服务器本机 curl + ADMIN_HOST |
| 已知未修 | ①**结账页 403：候选修复已落代码（D-140），根因未坐实，真单未验证**：注入的 session cookie 曾按 `{url}` 放成 host-only，与网站在 `.chatgpt.com` 轮换的同名 cookie 并存；对照实验（同号同窗口同出口）复现 + 改 `.chatgpt.com` 域后结账页打开出 ₱ 报价。但本机 WAL 显示 09-07/09-08 有 7 次同样并存却到达结账页、1 次付款成功（审查 F-27），"并存即 403"不成立；真单再 403 按 D-139 转人工。修复在 `browser-mvp/src/session-bootstrap.js`（本机工作区，pool worker 从工作区启动即生效，无需服务器发布）；次要差异未处理：注入路径没有 auth.openai.com 层（付款后刷新依赖，D-134 已知）；②预检租约默认已改 900s（`run-live-pool.sh`），只在 09-09 第 4–5 次预检验证过"不再超时"，未在成功路径验证，A1 演练也验不到（F-33）；③`browser_run_events` 同一任务多次重试只落第 1 次（job_id+sequence 唯一键），后续尝试只在本机 WAL；④本机绕过连接池直连写入（09-07/08）遗留问题已清；⑤后台控制事务并发可能 `ER_LOCK_DEADLOCK`；⑥手动卡付款后无独立卡侧扣款证据；⑦审查批次 1 P1 处置更新：中途关付款开关即判失败（F-25）、点击后 kill 无核实排程（F-26）——已修，browser-mvp 本机代码，pool worker 下次启动即生效，不需要本次 v1 release；打回后重提同码丢 Session（F-34）、换账号重提 409（F-35）——已修且已随本次 release（`20260910-highvcc-open-session-resubmit-0b5639c`）发布到生产，未做真单复验 | 2026-09-10 09:10 UTC | 本表 + REVIEW_RECORD 批次 1 + 本次 release |

## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
