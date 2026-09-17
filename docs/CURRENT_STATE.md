# 当前生产状态｜事实表

每行一个事实，带核对时间与证据方式；变化时改行，不追加段落。旧版快照原文：`docs/archive/2026-09/CURRENT_STATE_snapshot_2026-09-07.md`。

| 项目 | 当前值 | 核对时间（UTC） | 证据方式 |
|---|---|---|---|
| 生产 release | `/opt/pojia/releases/20260916-unified-4334dc2`（提交4334dc2）。已撤回提前客户成功：Plus确认、取消自动续费和现有内部核对完成后成功；其余D-240提速保留。客户资源仍v39（本次未改前端）。 | 2026-09-16 15:36 UTC | 独立SSH/进程/DB查询与发布清单；docs/incidents/unified-success/ |
| 回滚点 | 上一release为20260916-d240-b31a88a，但它有已知早交付恢复缺口，不建议无条件退回。更早20260913亦丢失提速与修复；回滚须独立评估在途run。 | 2026-09-16 15:36 UTC | 独立SSH/进程/DB查询与发布清单；docs/incidents/unified-success/ |
| 最新数据库备份 | /var/backups/pojia/pojia-20260917T032442Z.sql.gz.enc（`pojia-backup.timer` 每日 03:2x UTC）；完整性本轮未验。 | 2026-09-17 05:34 UTC | ssh `ls -t /var/backups/pojia/` |
| **服务器重启** | **2026-09-16 23:36:10 UTC 服务器重启过**（`uptime -s`；`journalctl --list-boots` 仅此一个 boot）。web 起来时 MySQL 未就绪崩一次（`PROTOCOL_CONNECTION_LOST`），systemd 6 秒后自动拉起。**重启原因无记录、未知。** | 2026-09-17 05:57 UTC | ssh `uptime -s` / `journalctl -u pojia-web --since "2026-09-16 23:34"` |
| pojia-web | active；PID2286（09-16 23:36:26 UTC 起，服务器重启后），cwd /opt/pojia/releases/20260916-unified-4334dc2/v1。 | 2026-09-17 05:34 UTC | ssh `systemctl show -p MainPID -p ActiveEnterTimestamp`；state-check |
| highvcc 备用卡台 A token | 已配置进生产（`app_settings.highvcc_access_token_ciphertext`，加密存储，09-10 09:17 UTC 写入） | 2026-09-10 09:52 UTC | `v1/scripts/set-highvcc-token.mjs` 输出 |
| highvcc 备用卡台 A 已开卡片（本窗口） | 3 张：尾号 9839（$50，08:xx）、9354（$5，09:19）、3241（$3，09:35，开卡时因 detail() 竞态未即时入库，09:53 用 `reconcile-highvcc-card.mjs` 补记）；账户另有 $20 押金要从钱包余额里先扣，才是真实可开卡余额（Lemon 提供） | 2026-09-10 09:52 UTC | 平台卡片列表 + `cards` 表独立核对 |
| pojia-worker（v1 任务 Worker） | active；PID75228（09-17 01:36:56 UTC 起，D-241 回滚 env 时重启），cwd /opt/pojia/releases/20260916-unified-4334dc2/v1。 | 2026-09-17 05:34 UTC | ssh `systemctl show -p MainPID -p ActiveEnterTimestamp`；state-check |
| pojia-browser-worker | inactive / disabled（Browser 执行在本机，来单人工拉） | 2026-09-09 11:46 UTC | systemctl |
| pojia-card-funding.timer | active / enabled，`OnUnitActiveSec=5s` 跑 `card-funding-runner.js`（带 `PROVIDER_CARD_WRITES_ENABLED=true`），但 `card_balance_recharge_enabled=false` → 每次立即退出（journal `CARD_BALANCE_RECHARGE_DISABLED`），不做事。另有 `pojia-card-funding-reconcile.timer`（15s）、`pojia-operator-watch.timer`（1min）、`pojia-backup.timer`（每日）在跑。 | 2026-09-17 05:40 UTC | ssh `systemctl cat` / `list-timers` / `journalctl -u pojia-card-funding` |
| pojia-card-read-sync.timer | active / enabled，`OnUnitActiveSec=15s` 跑 `card-read-sync-runner.js`（只读 hnskj，每次 claim 1 个 card_sync_jobs）。**实际节奏观察**：AVAILABLE 卡 5276 的 job 是 01:34/02:00/03:00/04:00/05:00 整点各一次——`scheduleDueCardSyncJobs` 默认 `staleMinutes=60`、条件 `next_sync_at <= now-60min`，把 `card-sync-policy` 的 10 分钟档拉成 ≥1 小时；合格窗口 = 同步后 15 分钟。是否有意未知。 | 2026-09-17 05:40 UTC | ssh `systemctl cat`；`card_sync_jobs` 独立 SELECT；`card-sync-job-service.js:78-112` |
| pojia-highvcc-snapshot-sync.timer | active / enabled，**`OnUnitActiveSec=1h`**（D-169 改的；此前本表另一行写"每 10 分钟"已过期）跑 `sync-highvcc-snapshot.mjs --commit`；最近批次 04:38:23 UTC COMMITTED（0 插入 / 9 更新），前两次 09-16 15:37、11:37。 | 2026-09-17 05:40 UTC | ssh `systemctl cat` / `list-timers`；`manual_card_import_batches` 独立 SELECT |
| pojia-card-stock-runner.timer | inactive / disabled（旧每分钟自动开卡架构已废弃） | 2026-09-09 11:46 UTC | systemctl |
| 健康 | 服务器本机live/ready 200；admin登录页200；公网客户JS v39的SHA256与单提交发布包一致；历史成功单状态API返回SUCCESS/stage9。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 数据库迁移 | 最新 `052_cards_bin`（cards 增 card_bin，D-168；051 于 09-08 01:25 UTC，050 于 09-07 19:16 UTC） | 2026-09-11 13:32 UTC | schema_migrations / 仓库 v1/migrations |
| accept_new_orders | true；统一成功维护已结束，无待恢复接单操作。 | 2026-09-16 22:50 UTC | app_settings独立SELECT |
| dispatch_new_recharges / 模式 | true / AUTOMATIC | 2026-09-09 11:46 UTC | app_settings |
| 默认路线（Plus） | **API：LEGACY_HNSKJ_ZZSHU_V1 accepts_new_orders=1；CHATGPT_PLUS_BROWSER_V1=0**（2026-09-17 01:47 从 Browser 切回 API，setDefaultRechargeMethod，事件 55e62934；仅影响切换后新单） | 2026-09-17 01:47 UTC | fulfillment_routes 独立 SELECT（API=1/Browser=0）+ provider_route_switch_events |
| Browser 当前卡台 | 备用卡台 A（`manual_excel` / `backup-a`） | 13:31 | browser_card_source_selections |
| browser_dispatch_enabled | true | 2026-09-09 11:46 UTC | app_settings |
| browser_payment_writes_enabled | true；本轮整理未改。 | 2026-09-16 22:50 UTC | app_settings独立SELECT |
| **菲律宾出口对 ChatGPT 的可达性** | **未定论**。裸 curl 经出口访问 chatgpt.com 返回 403 Cloudflare 拦截页，但 **curl 不能用来判断 Cloudflare 是否封禁**（无 TLS 指纹、不执行 JS，会被单独拦）。**Lemon 当场在 BitBrowser 窗口里看到的是 ChatGPT 的退出登录页面，说明页面打得开、出口没被整站封**。真实根因转向「Session 没能登录上」，见 D-187 | 2026-09-12 09:40 UTC | 反例证据来自 Lemon 直接观察窗口；curl 测试已作废 |
| Browser Profile productionWritesEnabled | true（CHATGPT_PLUS_BROWSER_V1；正式启动检查与DB读取一致）。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| card_auto_replenishment_enabled | false（与补余额构成首页「开卡补钱」的"部分开启"态） | 2026-09-09 11:46 UTC | app_settings |
| card_balance_recharge_enabled | false（此前 09-14 true 已过期；本轮未改开关） | 2026-09-16 10:38 UTC | app_settings 独立只读 SELECT |
| card_max_successful_payments | 3 | 2026-09-09 11:46 UTC | app_settings |
| 最低所需卡余额 | default 16 / pro_5x 16 / **pro_20x 150**（09-09 05:33 UTC 调，独立核实；5X 上线前同调） | 2026-09-09 11:46 UTC | app_settings（`minimum_required_card_balance:*`）+ admin_setting_events |
| Worker 进程写权限 | 进程实际（`/proc/75228/environ`）：`PROVIDER_READS_ENABLED=true / WRITES=false / CARD_WRITES=false / RECHARGE_WRITES=true`。来源：三个写开关来自 drop-in `api-recharge-enabled.conf` 的 ExecStart；**READS=true 来自 `/etc/pojia/provider.env`（unit 里 `EnvironmentFile=-`，后加载覆盖 `runtime.env` 里的 `READS=false`）**。funding 单元：`CARD_WRITES=true`。 | 2026-09-17 05:40 UTC | ssh `systemctl show -p EnvironmentFiles`、`cat drop-in`、`grep provider.env`、`/proc/pid/environ` |
| HNSKJ 卡 | `5276` AVAILABLE/active，余额 $16（2026-09-17 01:34 新开，段 23）；旧卡 12 张均 FAILED/invalid/REFUND_WATCH 余额 $0。**5276 只在每小时整点同步后的 15 分钟内合格**（05:49 查不合格、06:05 查合格，见 read-sync 行的节奏观察）；窗口外来单会先 WAITING_FOR_CARD 再按需同步（代码路径 `workflow-repository.js:216-260`，未实跑）。 | 2026-09-17 06:05 UTC | cards 独立 SELECT + 生产 release 的 eligibleInventoryCardSql |
| 备用卡（备用卡台 A = highvcc → 103 manual_excel，sync_tier=MANUAL_IMPORT） | 库内 AVAILABLE 9 张、合计 $154.56：29bb $145（用量 0）、3bac $1.83、c30e $1.79（RETIRED）、091b $1.75、92a1 $1.08、a4cb $1.07（用量 3）、0a0e $1.05、d408 $0.99（RETIRED）、633a $0（RETIRED）；HELD_FOR_REVIEW 5 张（`source_present=0`，04:38 快照标记：4dfa 账面 $50、75b3/c5ab RETIRED、10b2、d79f）。是否 Lemon 手动删卡、余额是否回钱包 未核。 | 2026-09-17 05:37 UTC | 隧道新连接独立 SELECT cards + card_operational_overrides + card_consumption_ledger |
| 可分配卡（正式资格 SQL） | 2 张：`5276`（101 hnskj，$16，06:00:08 刚同步）+ `29bb`（103 manual_excel，$145，用量 0）。**这个数随 5276 的同步窗口变**：hnskj 卡每小时整点同步一次、同步后 15 分钟内合格，其余时间只剩 29bb 1 张（05:49 查是 1 张，06:05 查是 2 张）。Plus 现走 API 冻结 101 → 只有 5276 能用；29bb 是 103 的卡、API 单用不到；非终态订单 0。**`state-check` 只比数字，跑的时刻不同会报漂移，分不出是哪张。** | 2026-09-17 06:05 UTC | 生产 release 的 `card-inventory-eligibility.js` 生成 SQL → 隧道新连接查（与 state-check 同法，多列出卡号）；`card_sync_jobs` 5276 最近两条 05:00 / 06:00 |
| HNSKJ 卡台 | **2026-09-17 开卡已恢复**。根因是默认卡段失效：卡台 09-14 后换新段（现有效段 7 个，id 23-29「新—VISA-…」），旧默认段 18 失效致就绪判定 false、人工开卡建不了任务（D-241）；已改 `default_card_type_id` 18→23。开出 1 张卡 5276（16刀），账户余额 106.06→**89.48**（扣 16.58）。手动开卡执行器 `v1/scripts/card-stock-job-runner.js` 无常驻服务/timer，需按需手动跑并带 `PROVIDER_CARD_WRITES_ENABLED=true`；后台"人工开卡"只建 PENDING job、不自动执行。`card_provider_snapshots` 由 `pojia-card-catalog-sync.timer` 每 5 分钟刷新。 | 2026-09-17 01:47 UTC | card_provider_snapshots + cards + admin_setting_events + D-241 |
| 订单总况 | RECHARGE_SUCCESS 20 / RECHARGE_FAILED 37 / CLOSED 18 / 非终态0（含历史人工/自动，不把20全算自动成功）。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 活动资金与运行 | active_runs 0；非终态订单0；统一成功发布后新建订单0。当前版本真实单时延/重试效果仍未验。 | 2026-09-16 22:50 UTC | 独立SELECT orders/browser_runs |
| 最近 Browser 运行 | 最近付款样本见「最近真实单」行；本次D-240仅重启和只读校验，新版本尚无真实付款验收样本。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| Browser 自动化里程碑 | 已有真实自动成功样本（不是0）；09-16重提单由旧版自动补核收口。D-240部署验证已通过，真实提速与异常恢复效果待新样本。 | 2026-09-16 12:41 UTC | 发布日志、独立SSH/DB/API/公网哈希复验（docs/incidents/d240-deployment/） |
| 最近真实单 | PJV1-x-tIsPB5ICHu6R9bzsSO（09-16 11:06:44 UTC提交）：RECHARGE_SUCCESS；Browser COMPLETED/PAYMENT_CONFIRMED/RESOLVED/CANCELLATION_CONFIRMED；PAYMENT_SUBMIT仅1条，CDK REDEEMED，卡分配RELEASED。先UNKNOWN，后自动补核成功。orders.subscription_cancelled仍NULL，Browser取消续费确认记录存在（投影差异）。 | 2026-09-16 11:12 UTC | 独立查询，docs/incidents/2026-09-16-x-tIs-success-evidence.tsv |
| 告警 | OPEN 116：BROWSER_ORDER_SUBMITTED 33、BROWSER_ORDER_FAILED 30、PROVIDER_BALANCE_CHANGED 24、BROWSER_PAYMENT_UNKNOWN 10、BROWSER_PAYMENT_CONFIRMED 6、BROWSER_ORDER_COMPLETED 6、BROWSER_HUMAN_REQUIRED 3、CARD_STOCK_LOW 2、BROWSER_ORDER_STALLED 2 | 2026-09-17 05:33 UTC | operator_alerts 独立 SELECT |
| **5X/20X 路线（与 CLAUDE.md「仅启用 Plus」冲突，待 Lemon 定）** | `products` 三个 ACTIVE；`fulfillment_routes` 305（pro_5x BROWSER）/306（pro_20x BROWSER）**`accepts_new_orders=1`**；`browser_card_source_selections` 三产品都指 103；`cdks` pro_20x AVAILABLE 2 / REDEEMED 1；后台 CDK 生成端点接受 pro_*（`create-app.js:358`）；intake 无产品闸门。历史 pro_20x 订单 9 单全在 09-08～09-10。**代码显示一张 20X CDK 现在就能下单进 Browser 路线**（付款后 UPGRADE_DIALOG_STOP 交人）。本轮未动。 | 2026-09-17 05:37 UTC | products / fulfillment_routes / browser_card_source_selections / cdks / orders 独立 SELECT；`cdk-service.js:13` |
| 本机 | 常驻Browser PID47905（09-16 15:35:18 UTC 起，supervisor 47620，launchd `com.pojia.browser-pool`），PAY/pool:lane-1；心跳 09-17 05:32:28Z 新鲜。本机源码 736c130（文档提交，业务代码同 4334dc2）。Plus 走 API 后它只接 Pro 单/人工路由单/付款后补核。 | 2026-09-17 05:40 UTC | 本机 `ps` / `launchctl list`；app_settings `browser_worker_heartbeat_at` |
| 已上线（本次 release） | 统一成功时点修正。删除提前SUCCESS写入与恢复器回调，保留核验减法/结果只读门控/有限重试/真实阶段与2秒查询。证据docs/incidents/unified-success/。 | 2026-09-16 15:36 UTC | 独立SSH/进程/DB查询与发布清单；docs/incidents/unified-success/ |
| 已知未修 | ①**结账页 403：候选修复已落代码（D-140），根因未坐实，真单未验证**：注入的 session cookie 曾按 `{url}` 放成 host-only，与网站在 `.chatgpt.com` 轮换的同名 cookie 并存；对照实验（同号同窗口同出口）复现 + 改 `.chatgpt.com` 域后结账页打开出 ₱ 报价。但本机 WAL 显示 09-07/09-08 有 7 次同样并存却到达结账页、1 次付款成功（审查 F-27），"并存即 403"不成立；真单再 403 按 D-139 转人工。修复在 `browser-mvp/src/session-bootstrap.js`（本机工作区，pool worker 从工作区启动即生效，无需服务器发布）；次要差异未处理：注入路径没有 auth.openai.com 层（付款后刷新依赖，D-134 已知）；②预检租约默认已改 900s（`run-live-pool.sh`），只在 09-09 第 4–5 次预检验证过"不再超时"，未在成功路径验证，A1 演练也验不到（F-33）；③`browser_run_events` 同一任务多次重试只落第 1 次（job_id+sequence 唯一键），后续尝试只在本机 WAL；④本机绕过连接池直连写入（09-07/08）遗留问题已清；⑤后台控制事务并发可能 `ER_LOCK_DEADLOCK`；⑥手动卡付款后无独立卡侧扣款证据；⑦审查批次 1 P1 处置更新：中途关付款开关即判失败（F-25）、点击后 kill 无核实排程（F-26）——已修，browser-mvp 本机代码，pool worker 下次启动即生效，不需要本次 v1 release；打回后重提同码丢 Session（F-34）、换账号重提 409（F-35）——已修且已随本次 release（`20260910-highvcc-open-session-resubmit-0b5639c`）发布到生产，未做真单复验 | 2026-09-10 09:10 UTC | 本表 + REVIEW_RECORD 批次 1 + 本次 release |


## 事实表之外

- 客户页 v2（09-03，`3cef082`）与夜间配色（`eba5331`，`?v=11`）已部署；成功态文案固定为 Plus，产品扩展时需改状态映射。
- 生产使用量为零的功能（三方对账案例、退款观察、灰度许可、CDK 交付记录、订单标签/备注/补发）按基线删除清单处理。
- 备用卡台导入完整快照是供给核心能力，保留；每次导入代表该卡台全部卡片。
