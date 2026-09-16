# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260916-d240-b31a88a`（单提交 `b31a88af7ad42132202ac12b993a889cd55d827f`）。D-240：Plus确认后交付成功、后台取消/对账、有界只读重试、核验减法、真实付款子阶段；客户JS/CSS v39。含此前D-217库存保守口径。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 回滚点 | `/opt/pojia/releases/20260913-orderno-6dcb458`；本机旧代码提交 `f836977`。无迁移，但新版本早交付且尚未收尾的run必须清完或保留新版收尾器，不能无条件回滚旧逻辑。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 最新数据库备份 | `/var/backups/pojia/pojia-20260916T122757Z.sql.gz.enc`，完整性OK。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| pojia-web | active；MainPID 2253812，实际cwd `/opt/pojia/releases/20260916-d240-b31a88a/v1`。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| highvcc 备用卡台 A token | 已配置进生产（`app_settings.highvcc_access_token_ciphertext`，加密存储，09-10 09:17 UTC 写入） | 2026-09-10 09:52 UTC | `v1/scripts/set-highvcc-token.mjs` 输出 |
| highvcc 备用卡台 A 已开卡片（本窗口） | 3 张：尾号 9839（$50，08:xx）、9354（$5，09:19）、3241（$3，09:35，开卡时因 detail() 竞态未即时入库，09:53 用 `reconcile-highvcc-card.mjs` 补记）；账户另有 $20 押金要从钱包余额里先扣，才是真实可开卡余额（Lemon 提供） | 2026-09-10 09:52 UTC | 平台卡片列表 + `cards` 表独立核对 |
| pojia-worker（v1 任务 Worker） | active；MainPID 2253822，实际cwd `/opt/pojia/releases/20260916-d240-b31a88a/v1`，已随switch重启，不再停在09-11 release。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| pojia-browser-worker | inactive / disabled（Browser 执行在本机，来单人工拉） | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-funding.timer | `pojia-highvcc-snapshot-sync.timer` 已改为每 1 小时（D-169），无变化时只发 1 次列表请求、不发逐卡详情 | 2026-09-11 14:21 UTC | systemctl |
| pojia-card-read-sync.timer | active | 2026-09-09 11:46 UTC | systemctl |
| pojia-highvcc-snapshot-sync.timer | active / enabled，每 10 分钟 oneshot 跑 `v1/scripts/sync-highvcc-snapshot.mjs --commit`（pojia 用户，runtime.env）；首次手动 run exit 0，批次 `23584a48`（9 更新，因表格与本机 02:53 那次的字节不同：固定 mtime 是之后才加的）；**03:49:13 UTC 定时触发已核实：数据未变 → `replay:true`、沿用批次 `23584a48`、批次表无新增、exit 0** | 2026-09-11 03:40 UTC | ssh：`systemctl is-active/is-enabled`、`journalctl -u`、`list-timers`；隧道新连接查 manual_card_import_batches |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 2026-09-09 11:46 UTC | systemctl |
| 健康 | 服务器本机live/ready 200；admin登录页200；公网客户JS v39的SHA256与单提交发布包一致；历史成功单状态API返回SUCCESS/stage9。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 数据库迁移 | 最新 `052_cards_bin`（cards 增 card_bin，D-168；051 于 09-08 01:25 UTC，050 于 09-07 19:16 UTC） | 2026-09-11 13:32 UTC | schema_migrations / 仓库 v1/migrations |
| accept_new_orders | true（12:36:58 UTC维护暂停，12:40:21 UTC正式服务恢复，均写admin_setting_events）。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| dispatch_new_recharges / 模式 | true / AUTOMATIC | 2026-09-09 11:46 UTC | app_settings |
| 默认路线（Plus） | Browser：CHATGPT_PLUS_BROWSER_V1 accepts_new_orders=1；LEGACY_HNSKJ_ZZSHU_V1=0（旧 09-14 API 默认已过期） | 2026-09-16 10:40 UTC | fulfillment_routes 按 route_code 只读 SELECT；本次 h9RKl 实际走 Browser |
| Browser 当前卡台 | 备用卡台 A（`manual_excel` / `backup-a`） | 13:31 | browser_card_source_selections |
| browser_dispatch_enabled | true | 2026-09-09 11:46 UTC | app_settings |
| browser_payment_writes_enabled | true（本次发布全程未改，已有自动付款权限保持）。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| **菲律宾出口对 ChatGPT 的可达性** | **未定论**。裸 curl 经出口访问 chatgpt.com 返回 403 Cloudflare 拦截页，但 **curl 不能用来判断 Cloudflare 是否封禁**（无 TLS 指纹、不执行 JS，会被单独拦）。**Lemon 当场在 BitBrowser 窗口里看到的是 ChatGPT 的退出登录页面，说明页面打得开、出口没被整站封**。真实根因转向「Session 没能登录上」，见 D-187 | 2026-09-12 09:40 UTC | 反例证据来自 Lemon 直接观察窗口；curl 测试已作废 |
| Browser Profile productionWritesEnabled | true（CHATGPT_PLUS_BROWSER_V1；正式启动检查与DB读取一致）。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| card_auto_replenishment_enabled | false（与补余额构成首页「开卡补钱」的"部分开启"态） | 2026-09-09 11:46 UTC | app_settings |
| card_balance_recharge_enabled | false（此前 09-14 true 已过期；本轮未改开关） | 2026-09-16 10:38 UTC | app_settings 独立只读 SELECT |
| card_max_successful_payments | 3 | 2026-09-09 11:46 UTC | app_settings |
| 最低所需卡余额 | default 16 / pro_5x 16 / **pro_20x 150**（09-09 05:33 UTC 调，独立核实；5X 上线前同调） | 2026-09-09 11:46 UTC | app_settings（`minimum_required_card_balance:*`）+ admin_setting_events |
| Worker 进程写权限 | worker：`PROVIDER_RECHARGE_WRITES_ENABLED=true`（drop-in），通用/卡片写 false；funding 单元：`PROVIDER_CARD_WRITES_ENABLED=true`；env 文件 `PROVIDER_READS_ENABLED=true` | 16:35 | `systemctl cat` |
| HNSKJ 卡 | `5980` DEPLETED，余额 $0.31（09-07 12:07 UTC 直充扣 $15.69，占用已释放）；其余 5 张 ASSIGNED 于历史订单且 ≤ $0.01；5 张 DEPLETED；HNSKJ 可分配 0 | 09-07 14:42 | cards |
| 备用卡（备用卡台 A = highvcc，manual_excel 导入与一键开卡同池，sync_tier=MANUAL_IMPORT） | 卡台现存 5 张（3118 $60 / 7402 $1.08 / 0601 $1.27 / 5501 $1.79 / 0237 $0）；库内另有 3241、9354 于 10:50 同步时仍在、之后消失，尚未被下一次快照标记。10 分钟自动快照同步正常工作（3118 开卡后 2 分钟内入库并 ACCEPTED） | 2026-09-11 10:58 UTC | 脚本 preview→门控→commit 输出；隧道新连接独立 SELECT cards / manual_card_import_batches |
| 可分配卡（正式资格 SQL） | 1 张：`5371`（Plus门槛16.00，按新生产release正式资格SQL）；非终态订单 0。`1657`同步17.83但账本推算2.00，新口径排除；不推断差异来源。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| HNSKJ 卡台 | **2026-09-14 服务器故障、开不了卡**（Lemon 报；此前钱包余额 **$106.09**（11:38 快照；今日 $18.25 → 07:02 $121.77 → 08:47 $71.52 → **09:17 $106.09**，最后一跳是 `1652` 退回的 $34.57）。卡台共 14 张卡（13 active），`providerOnlyActiveCount=0`。**卡余额只能靠同步读到，手动补钱后要等一次 `card-read-sync`**（今日实测滞后 5 分 34 秒，由订单的按需同步触发）。今日 4 次 `card_recharge`（自动补余额）HTTP 400 `DO_NOT_RETRY`（06:40/06:43/08:58/09:02），由 `card_balance_recharge_enabled=true` 触发（D-223）。**开卡故障是卡台侧，恢复时间未知**——直接影响 API 路线供卡 | 2026-09-14 15:05 UTC | Lemon 报 + provider_calls + admin_setting_events |
| 订单总况 | RECHARGE_SUCCESS 20 / RECHARGE_FAILED 37 / CLOSED 18 / 非终态0（含历史人工/自动，不把20全算自动成功）。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 活动资金与运行 | active_runs 0；非终态订单0；自D-240恢复接单（12:40:21 UTC）后新建订单0。ACTIVE卡分配最后一次12:41核对为0，本次未重计。 | 2026-09-16 12:48 UTC | orders/browser_runs独立SELECT；新版本无真实单验收样本 |
| 最近 Browser 运行 | 最近付款样本见「最近真实单」行；本次D-240仅重启和只读校验，新版本尚无真实付款验收样本。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| Browser 自动化里程碑 | 已有真实自动成功样本（不是0）；09-16重提单由旧版自动补核收口。D-240部署验证已通过，真实提速与异常恢复效果待新样本。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 最近真实单 | PJV1-x-tIsPB5ICHu6R9bzsSO（09-16 11:06:44 UTC提交）：RECHARGE_SUCCESS；Browser COMPLETED/PAYMENT_CONFIRMED/RESOLVED/CANCELLATION_CONFIRMED；PAYMENT_SUBMIT仅1条，CDK REDEEMED，卡分配RELEASED。先UNKNOWN，后自动补核成功。orders.subscription_cancelled仍NULL，Browser取消续费确认记录存在（投影差异）。 | 2026-09-16 11:12 UTC | 独立查询，docs/incidents/2026-09-16-x-tIs-success-evidence.tsv |
| 告警 | OPEN 16：PROVIDER_BALANCE_CHANGED 11（info 噪音，后台不显示）、BROWSER_ORDER_FAILED 4（09-08 测试单付款前失败）、CARD_STOCK_LOW 1 | 2026-09-09 11:46 UTC | operator_alerts |
| 本机 | 常驻Browser PID99137，2026-09-16 12:39:21 UTC启动，PAY/pool:lane-1；supervisor PID98863（启动核对）。生产心跳12:48:02.327Z，本轮PID仍存在；运行源码为b31a88a。 | 2026-09-16 12:48 UTC | ps与app_settings独立只读核实 |
| 已上线（本次 release） | D-240客户体验改造及此前已提交D-217资格规则。实现与测试见docs/tasks/2026-09-16-D240-delivery.md；发布证据见docs/incidents/d240-deployment/。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 已知未修 | ①**结账页 403：候选修复已落代码（D-140），根因未坐实，真单未验证**：注入的 session cookie 曾按 `{url}` 放成 host-only，与网站在 `.chatgpt.com` 轮换的同名 cookie 并存；对照实验（同号同窗口同出口）复现 + 改 `.chatgpt.com` 域后结账页打开出 ₱ 报价。但本机 WAL 显示 09-07/09-08 有 7 次同样并存却到达结账页、1 次付款成功（审查 F-27），"并存即 403"不成立；真单再 403 按 D-139 转人工。修复在 `browser-mvp/src/session-bootstrap.js`（本机工作区，pool worker 从工作区启动即生效，无需服务器发布）；次要差异未处理：注入路径没有 auth.openai.com 层（付款后刷新依赖，D-134 已知）；②预检租约默认已改 900s（`run-live-pool.sh`），只在 09-09 第 4–5 次预检验证过"不再超时"，未在成功路径验证，A1 演练也验不到（F-33）；③`browser_run_events` 同一任务多次重试只落第 1 次（job_id+sequence 唯一键），后续尝试只在本机 WAL；④本机绕过连接池直连写入（09-07/08）遗留问题已清；⑤后台控制事务并发可能 `ER_LOCK_DEADLOCK`；⑥手动卡付款后无独立卡侧扣款证据；⑦审查批次 1 P1 处置更新：中途关付款开关即判失败（F-25）、点击后 kill 无核实排程（F-26）——已修，browser-mvp 本机代码，pool worker 下次启动即生效，不需要本次 v1 release；打回后重提同码丢 Session（F-34）、换账号重提 409（F-35）——已修且已随本次 release（`20260910-highvcc-open-session-resubmit-0b5639c`）发布到生产，未做真单复验 | 2026-09-10 09:10 UTC | 本表 + REVIEW_RECORD 批次 1 + 本次 release |


## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
