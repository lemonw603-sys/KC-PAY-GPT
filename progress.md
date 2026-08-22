

## 2026-08-14 - Task: 修復 GPT 代充 API 協議代理傳參
### What was done
- Session inspect 保留為不使用代理的本機格式／到期檢查。
- 執行代充時從本地代理池取得啟用代理並傳入 `/pay.proxy`；本地池為空時省略欄位，由平台啟用代理池兜底。
- 完整 Session payload 繼續傳入，固定 CDK 冪等鍵不變。
- 重寫 `協議api.md`，對齊 inspect 無代理、Worker 協議有代理的新規格。
- 修正 Vitest CommonJS 測試載入方式。
### Testing
- `node --check gpt-api-client.js`、`node --check server.js` 通過。
- `npm test -- test/gpt-api-client.test.js`：3 passed。
- 線上使用正式 API 設定呼叫 inspect 成功，回 `reason=local_check`。
- 契約驗證確認 `/pay` payload 同時包含完整 Session 與 proxy。
- `docker compose up -d --build app` 成功，app 容器 healthy。
### Notes
- `gpt-api-client.js`：`submitPay` 支援並傳送 proxy。
- `server.js`：取得協議代理並傳入平台，保留平台代理回退。
- `test/gpt-api-client.test.js`：改驗證 proxy 會傳送並修復 Vitest 載入。
- `協議api.md`：更新完整協議與 403 風險說明。
- `progress.md`：追加本輪記錄。
- 回滾方式：還原上述檔案並執行 `docker compose up -d --build app`；回滾會恢復不傳代理的舊行為。


## 2026-08-14 - Task: 補齊 GPT API 套餐與卡片相容性
### What was done
- 新增 `pro_5x → pro5x`、`pro_20x → pro20x` 映射，inspect 與 pay 共用同一平台套餐鍵。
- `GET /plans` 客戶端支援平台 `{gpt, credit}` 回應。
- 卡片有效期嚴格支援 `MMYY`、`MM/YY`、`MM/YYYY`；無效格式明確失敗，不再回退 2030。
### Testing
- Node 語法檢查通過。
- `npm test -- test/gpt-api-client.test.js`：4 passed。
### Notes
- `server.js`：新增套餐鍵映射與有效期解析。
- `gpt-api-client.js`：支援 `raw.gpt` 套餐陣列。
- `test/gpt-api-client.test.js`：增加 plans 回應契約測試。
- `協議api.md`：補充套餐映射及有效期格式。
- `progress.md`：追加本輪記錄。
- 回滾方式：還原上述檔案並重建 app；回滾會使 Pro 套餐重新可能回 `plan_disabled`。


## 2026-08-14 - Task: 修復平台任務 done 誤判激活成功
### What was done
- 查詢 task 時優先讀取 `result.status`，不再把 queue 外層 `done` 當業務成功。
- 移除 `done` 成功終態；`result.ok=false` 強制按失敗處理並顯示內層錯誤。
### Testing
- `npm test -- test/gpt-api-client.test.js`：5 passed。
- 線上容器契約驗證：`done + result.failed → failed`，`done + result.success → success`。
- app 重建部署成功，容器 healthy。
### Notes
- `gpt-api-client.js`：優先解析內層業務狀態。
- `server.js`：移除 done 成功映射並使用 result.ok／error。
- `test/gpt-api-client.test.js`：新增 queue done 與業務終態回歸測試。
- `progress.md`：追加本輪記錄。
- 回滾方式：還原上述檔案並重建 app；回滾會再次把失敗任務誤報成功。

## 2026-08-21 - Task: 补齐无订单阶段上线前能力
### What was done
- 新增独立 Bark 告警投递进程，消费 `operator_alerts`，支持数据库去重、并发领取、超时恢复、指数退避和失败终态。
- Bark 使用 JSON `POST /push`，Device Key 不进入 URL；标题和正文发送前再次脱敏。
- 新增只读上线体检，检查任务租约、模糊 Provider 调用、活动充值授权、资金风险尝试、对账案例、Bark 死信、Worker 心跳和迁移版本。
- 加固 Provider 只读检查：任一拆分写开关开启时均拒绝运行。
- 新增 3–5 单灰度运行检查表；当前无订单阶段不执行开卡、充值或其他资金写入。
### Verification
- Bark、配置、体检和迁移顺序定向测试通过。
- 所有新增运行路径默认关闭；未配置 Bark Device Key 时不会发送通知。
### Notes
- 新迁移：`023_bark_notifications.sql`。
- Bark 生产启用仍需 Device Key 和一次非资金测试推送。
- 真实 Provider 写入边界与 3–5 单资金链路继续等待出现订单后按逐单检查表执行。

## 2026-08-21 - Task: Bark 与上线前能力对抗式审查
### What was done
- 由独立 Agent 对照路线图、验收基线和本轮交付执行对抗式审查。
- 发现并修复告警重开不重复推送、环境变量大小写/空白绕过门禁、未来迁移版本误报三项 P1。
- 审查报告保存于 `docs/ADVERSARIAL_AUDIT_2026-08-21.md`。
### Remaining
- MySQL 8.4 迁移/并发领取实测、Bark Device Key 手机推送、DEAD 恢复演练仍待真实部署条件；均不需要也不会自动触发资金写入。
- 已在临时 MySQL 8.4.11 容器完成迁移 `001–023` 首次执行、重放和 `alert_notifications` 表结构检查；未连接生产库。
- 发现 `operator_alerts` 原表缺少 `updated_at` 后已补充 guarded migration；临时 MySQL 8.4.11 已通过 Bark 并发领取与 RESOLVED→OPEN 重推集成测试。

## 2026-08-21 - Task: AI充值业务阶段性完结
### Status
- 当前阶段冻结，等待真实订单；不再主动扩展功能。
- 完成项、待办项、共识、证据和后续 AI 接手规则统一归档于 `docs/PROJECT_HANDOFF_2026-08-21.md`。
- 当前工作目录已从 `破甲` 改为 `AI充值业务`；`pojia` 生产技术标识有意保留。
### Next gate
- 有生产访问条件时先做迁移、Bark 服务、只读体检和重启恢复演练。
- 有真实订单时再按 `docs/SMALL_BATCH_RUNBOOK.md` 进入单笔资金验证。

## 2026-08-21 - Task: 阶段性完结后的二次对抗审查
### Result
- 发现并修复旧 `operator_alerts` 表缺少 `updated_at`、辅助 Provider 写开关判断不统一、活动开卡任务未纳入只读体检、Bark systemd 旧品牌描述和重试 SQL 未实测五项问题。
- 临时 MySQL 8.4.11 集成验证通过：迁移、并发领取、告警重开和指数退避重试。
- 未发现 P0；生产进程重启恢复和真实生产 Bark 仍是部署条件下的待办。

## 2026-08-21 - Task: 后台六项可用性与 CDK 审计修复
### What was done
- 刷新按钮增加“刷新中…”、转圈、禁用和“刷新完成/失败”反馈，避免点击无感。
- 将“隔离中新卡”改为“待验证新卡（隔离区）”，补充本地接管队列、两次稳定读取和不进入订单分配的说明，并翻译内部状态。
- 对账区改名为“资金证据核对队列”，明确其用于阻止不确定结果自动重试/重复扣款；解决动作只保存结论，不自动重充或退款。
- CDK 生成与下载解耦：生成不再自动下载，生成结果提供单独下载按钮。
- CDK 批次增加“可使用 / 部分作废 / 已全部作废”等突出状态，保留批次行。
- 新增受敏感操作保护的逐码状态清单接口 `POST /api/v1/admin/cdks/:batchNo/status-report` 与 CSV 下载，返回每个码的状态、关联订单、兑换/作废时间和原因。
- 停止在作废或最后一个码兑换后清空 `codes_ciphertext`；新批次加密恢复副本可用于后续审计。已被旧逻辑清空的历史批次无法凭空恢复，只能依赖原始下载文件。
### Verification
- `v1/npm test`：260 passed / 21 skipped / 0 failed。
- 未调用开卡、充值、退款、余额提取或其他 Provider 资金写接口。

## 2026-08-21 - Task: 生产 P0 安全准备与 Bark 上线
### What was done
- 生产接单与新充值派发开关从 `true` 事务化关闭为 `false`；执行前后活动 Permit、开卡任务、不确定 Provider 调用和资金风险尝试均为 0。
- 创建加密备份 `pojia-20260820T195421Z.sql.gz.enc`，哈希/解密/gzip 校验通过；在无网络 MySQL 8.4.11 容器恢复成功，共 30 张表。
- 加密备份及校验文件已复制到服务器外的 `/Users/lemon/backups/AI充值业务/production/2026-08-21/`，本地 SHA-256 与服务器校验值一致；恢复密钥的长期异地托管仍待确定。
- 发布 `/opt/pojia/releases/20260821-bark-prep-1`，执行迁移 `023_bark_notifications`；第二次执行全部为 `already applied`。
- Bark 服务已安装并启用；普通实推、`SENDING` 超时重领和 `DEAD` 显式恢复均达到 `SENT`。
- Provider 严格只读检查通过：HNSKJ 账户/余额/卡段/卡片读取正常，ZZSHU 连接检查正常；历史 401 阻塞已解除。
- 最终只读体检 `ok=true`：活动任务、过期租约、UNKNOWN、活动授权、资金风险、活动开卡任务、开放对账和 Bark 死信均为 0。
### Evidence and corrections
- 当前 release manifest 共 481 个非依赖文件，逐项 SHA-256 校验通过。
- 外部 TCP 探测受本地测试网络代理影响产生 3306 假阳性；服务器自身公网 IP:3306 明确 `Connection refused`，Docker 只绑定 `127.0.0.1:3306`，firewalld 未开放 3306。
- 准备新 release 时曾因 `cp -a` 复制 symlink 而覆盖旧 `535fe2b` 目录；当前 release 已修复为真实目录。精确 Git 提交 `535fe2b` 已重建为 `/opt/pojia/releases/20260820-foundation-v2-535fe2b-restored`，259 个非依赖文件清单校验通过；被覆盖目录已标记禁止回滚。
- 本轮没有开卡、直充、退款、余额提取或其他 Provider 写调用。

## 2026-08-21 - Task: 收尾验收与后台下拉框修复
### Commitment check
- CDK 批次作废：代码、后台路由、生产隔离 MySQL 全量测试均通过；只更新 `AVAILABLE`，已兑换码不受影响。
- CDK 查订单：客户 API 同时支持 `publicNo` 和 CDK，生产隔离 MySQL 测试确认两种查询返回同一订单。
- 右上角刷新：后台脚本已实现加载中、成功、失败反馈；静态回归测试通过，实际页面可见反馈逻辑存在。
- 下拉框箭头：统一改为向内收进的 CSS 箭头，资源版本更新到 `admin.css?v=13`；浏览器计算样式和截图复验通过。
### Production evidence
- 发布 `/opt/pojia/releases/20260821-ui-fix-1`，Web 重启后 `/health/live` 与 `/health/ready` 均 200。
- 生产隔离 MySQL 全量验收：282/282 通过、0 skipped；没有 Provider 写调用。
- 三条 Bark 测试告警已标记 `RESOLVED`，通知记录保留；最终只读体检无 blocker。

## 2026-08-21 - Task: 真实单笔链路、规则纠正与事实源对齐

### What was done
- 使用真实客户页面、真实 CDK 和真实 Session 创建单笔生产订单。
- 真实验证到已有库存卡分配、卡片只读核验、充值前 Permit 和 ZZSHU `create_direct`。
- ZZSHU 返回 HTTP 400 / 业务码 `40030`：仅支持免费账号提交，当前目标账号套餐为 Plus。
- 明确并落盘硬业务规则：Plus 是要购买的产品；目标账号当前为 Plus 时禁止充值，上游也不会接受。
- 客户页自动轮询从 5 分钟延长为 30 分钟；失败状态已能从订单库同步到客户状态 API。
- 真实测试后恢复所有接单、派发、Provider 账户和 Provider 进程写门禁为关闭。
- 新增跨窗口单一事实源：`docs/SINGLE_SOURCE_OF_TRUTH_2026-08-21.md`。

### Evidence
- 订单最终状态：`RECHARGE_FAILED`。
- Provider 调用：ZZSHU `create_direct`，HTTP 400，业务码 `40030`，`DEFINITE_FAILURE`。
- 未产生 ZZSHU 外部订单号；未确认充值扣款。
- HNSKJ 卡片只读同步调用成功。

### Remaining
- 下一次真实充值前必须完成目标账号 Plus 本地硬阻断、40030 失败字段映射、Provider 调用与充值尝试账本关联审计、统一多层写门禁和配置型任务恢复。
# 2026-08-21 最终需求对齐与对抗式审查收口

- 完成最终需求的第一性原理/冲突审查，报告：`docs/FINAL_REQUIREMENTS_ADVERSARIAL_REVIEW_2026-08-21.md`。
- 用户确认审查修正方向，形成正式基线：`docs/FINAL_REQUIREMENTS_BASELINE_2026-08-21.md`。
- `DECISIONS.md` 新增 D-029～D-035，并标明被替代的旧决策。
- 正式方向：库存优先、人工与受限自动补卡并存；正常订单自动履约但保留资金栅栏；Session 原订单最多更换 3 次；支付成功且取消续费确认后才最终成功；退款仅保留原始同步和人工案件。
- HNSKJ `POST /cards/{id}/recharge` 已由当前官方文档确认存在，v1 尚未实现；只用于未履约且余额不足的 active 库存卡，新开卡不重复补余额。
- 卡片默认不跨订单复用；特殊情况保留受控人工口子，禁止系统自动复用，必须记录完整审计。
- 完成当前 Plus 运营后台与最终需求的代码/API/线上静态资源对齐审查：`docs/ADMIN_ALIGNMENT_AUDIT_2026-08-21.md`。
- 生产只读证据：Web live/ready 正常、未登录后台 API 返回 401、线上 `admin.js` 与当前本地代码 SHA-256 一致；未使用登录会话读取生产业务数据。
- 审查结论：后台认证、CDK、库存优先、卡台接管、订单/资金核对和资金栅栏可保留；逐单充值授权、成功终态、Session 更换、自动补卡、卡 recharge、退款自动识别、卡台人工切换和特殊复用入口需要按最终基线对齐。
- 用户确认后续完整实施路径并落盘：`docs/IMPLEMENTATION_PLAN_FINAL_2026-08-21.md`；决策账本新增 D-036、D-037。
- Browser 自动化采用“现在独立窗口设计、阶段七稳定后实现接入”的双阶段策略；设计成果必须回写主项目，不得另建订单或资金账。

## 2026-08-21 - 阶段一追溯中心实施与对抗审查

- 实施 Migration 024、卡片绑定历史、客户付款、备注、标签、PAN HMAC 和后台统一搜索。
- 订单档案已联通 CDK/补发/交付/付款/卡片/Provider/交易/成本/人工记录。
- 已修正对抗审查确认的敏感 GET 搜索、新库存卡无法分配、虚构客户付款时间、库存口径和浮点成本汇总问题。
- 本地和隔离 MySQL 验收详见 `docs/STAGE1_TRACEABILITY_ACCEPTANCE_2026-08-21.md`。
- 特殊人工复用入口和复用后交易归属仍属阶段四，未冒充为已完成。
- 独立对抗审查最终结论：阶段一无剩余阻断项。
- 生产发布 `/opt/pojia/releases/20260821-traceability-86d6282`；迁移、PAN 回填、6 项数据一致性检查、Web/Worker/Bark 健康和上线后只读体检全部通过。
- 生产资金门禁保持关闭，本次无 Provider 写调用。

## 2026-08-21 - 阶段二 Session 恢复与正确终态

- 新增原订单 Session 更换、最多 3 次和首次客户可修复错误起 72 小时窗口；历史不保留旧 Session。
- 新增 `WAITING_FOR_SESSION`、`CANCELLATION_PENDING`、`CANCELLATION_REVIEW_REQUIRED`，客户侧只展示账号已是 Plus/Session 无效两类行动原因。
- 只有付款成功且取消续费确认后才最终成功；查询异常耗尽进入人工复核。
- Foundation v2 提交现在强制先建 `recharge_attempt`；legacy Permit 不能进入资金路径。
- 修复 40030 后重新授权幂等键冲突、授权 claim/consume 恢复、lease-lost 和非 40030 明确拒绝僵尸订单。
- 隔离 MySQL 8.4 全量测试 `313/313`，Migration 001–025 干净执行和 025 重放成功。
- 独立对抗式终审未发现剩余 Stage 2 P0/P1 阻断；证据见 `docs/STAGE2_SESSION_FINALIZATION_ACCEPTANCE_2026-08-21.md`。
- 尚未部署生产，本阶段没有任何 Provider 资金写调用。

## 2026-08-22 - 阶段二生产安全部署

- 通过 KiwiVM 恢复本机 SSH 公钥访问，没有重置服务器或业务凭证。
- 发布 `/opt/pojia/releases/20260822-stage2-94dbefb`，Migration 025 首次执行和重放通过。
- 发布前加密备份完整性通过，服务器外副本保存到 `/Users/lemon/backups/AI充值业务/production/2026-08-22/`，SHA-256 一致。
- 修正 Worker systemd 旧硬编码的充值写开关；实际 Worker 进程三个 Provider 写开关均为 `false`。
- 接单、派发、Provider 账户和进程资金门禁全部关闭；活动资金风险和活动充值授权均为 0。
- Web、Worker、Bark active；公网 live/ready 200，后台未登录 API 401；最终只读体检 `ok=true`、无 blocker。
- 本次没有开卡、卡充值、直充、退款、余额提取或 Browser 付款调用。

## 2026-08-22 - 阶段三正常订单自动履约与生产安全部署

- 正常模式改为规则通过后自动履约；`MANUAL` 只消费 `SINGLE/BATCH` 灰度许可，资金事务内重新锁读派发总闸和模式。
- 自动授权、资金 attempt、订单 `SUBMITTING` 和 `create_direct` intent 同事务；Migration 026 用 generated unique index 保证每个 attempt 最多一个创建意图。
- 提交前立即只读刷新已绑定卡；卡片或配置不满足时不创建资金 attempt，配置等待退还当前任务尝试次数。
- 修复周期卡片同步相同时间桶重复 dedupe key 导致 systemd 任务失败；生产新版连续运行成功。
- 独立对抗式审查确认无剩余 Stage3 P0/P1；补充防御性 MANUAL 最终断言、schema artifact 精确校验，并将 API 与 Browser 资金证据口径分开。
- 精确提交 `8a3134dcbd8dc227822177ef8b805e5d879025db` 隔离 MySQL 全量测试 `330/330`；共享工作树含 Browser 并行内容时为 `342/342`。
- 生产发布 `/opt/pojia/releases/20260822-stage3-8a3134d`，Migration 026 首次执行和重放通过；历史明确失败 orphan 已受限补齐，最终资金账一致性计数全部为 0。
- Web、Worker、Bark、卡片只读同步、live、ready 和只读 readiness 均通过；接单、派发、Provider 账户和进程资金写门禁保持关闭。
- 部署后独立只读终审确认 P0=0、P1=0；线上 Git tracked 文件与精确提交全部一致，并补存服务器端 `.manifest.sha256` 后自检通过。
- 本阶段没有开卡、卡充值、直充、退款、余额提取或 Browser 支付；免费目标账号真实成功充值、取消续费最终态和 3–5 单灰度仍未验收。

## 2026-08-22 - 待用户反馈：运营后台总览卡片缺失

- 用户反馈：Plus 运营后台“总览”中的部分指标卡片/信息没有显示，需核对当前前端实现、后端 overview 数据合同、历史已确认需求和生产返回数据是否一致。
- 当前处理状态：仅记录，尚未修改代码、部署或生产配置。
- 下一步：先做事实核对并列出“应显示 / 已实现 / 实际返回 / 缺失原因”，经用户确认后再调整。

## 2026-08-22 - 运营后台全量审计与发布候选包阶段

- 用户要求对整个 Plus 运营后台做大块全量审计，不只修总览卡片；已建立并持续更新 `docs/ADMIN_FULL_AUDIT_2026-08-22.md`。
- 已确认公网后台静态资源与本地代码漂移：公网 `/admin`、`admin.js`、`admin.css` 的大小和 SHA-256 均与本地不一致，公网仍引用旧版 `admin.css?v=8`。
- 本地已修复/补齐：总览订单/Session/补卡/取消续费/自动补卡/对账/同步积压指标、CDK/退款状态分布、Provider 新鲜度、卡片接管验证/接管入口、耗尽卡统计、累计订单跳转和“历史卡数”歧义。
- “卡台历史总卡数”已改为“卡台当前 active 卡数”，避免把上游目录总记录误称为成功开卡历史。
- 隔离 MySQL 已执行迁移 028–036；v1 全量测试最新结果为 `401/401 pass, 0 fail, 0 skipped`。
- 已生成本地发布候选包：`artifacts/release-candidate-20260822-f821305/`，包含 414 个文件和 `manifest.sha256`；未上传、未部署、未迁移生产。
- 修复后的对抗式复核已落盘：`docs/ADMIN_REPAIR_ADVERSARIAL_REVIEW_2026-08-22.md`。
- 当前下一大阶段：生产服务器当前 release、服务器端清单与候选包只读对照；完成后再形成部署/回滚结论。生产部署仍需单独确认。

## 2026-08-22 - 交接完整性复核

- 新增 `docs/HANDOFF_COMPLETENESS_AUDIT_2026-08-22.md`，复核聊天结论、代码提交、阶段文档、生产证据和候选包是否对齐。
- 明确标记历史快照与最新公网证据的冲突：较早“线上 admin.js 与本地一致”不能覆盖 2026-08-22 最新公网哈希漂移证据。
- 当前唯一有效状态：本地候选包已验收、未部署；公网仍旧资源；生产服务器端 release/清单本轮尚未取得新的只读终端证据。

## 2026-08-22 - 后台查询性能修复与生产部署

- 修复总览待验证新卡统计的相关子查询，改为 anti-join；新增 Migration 037 复合索引。
- 隔离 MySQL v1 全量测试 `401/401 pass, 0 fail, 0 skipped`；候选包 manifest 416/416 通过。
- 生产部署前创建并验证加密备份：`/var/backups/pojia/pojia-20260822T120608Z.sql.gz.enc`。
- 生产切换到 `/opt/pojia/releases/20260822-0a9c574`，Migration 027–037 完成。
- Web/Worker/Bark、卡片目录同步和卡片只读同步 active；自动开卡 timer inactive；Provider 三项写入开关均为 false。
- 本机与公网 live/ready 均返回 200；只读 readiness `ok=true`，活动任务、租约、UNKNOWN Provider 调用、资金风险和活动授权均为 0。
- 本次没有开卡、充值、付款、提现或退款；后续仍需进行部署后后台逐页只读验收和对抗式复核。
### 2026-08-23 只读余额同步与 Session 体验修复

- Session 粘贴尾部被扩展文本污染的问题已修复并部署：页面可提取首个完整 JSON 对象，自动规范化并提示用户。
- 证实 Provider 余额快照过去依赖写入型 card-stock runner，写入开关关闭时会陈旧；已改为由只读 card-catalog sync 刷新余额/开卡规则快照。
- 当前 release：`/opt/pojia/releases/20260823-balance-sync`；Web/Worker、目录同步、只读同步正常；接单、派发、Provider 写入仍全部关闭。
- 未执行开卡、卡充值、ChatGPT 充值、付款、提现或退款。
- Session 尾部附加文本仍会静默规范化为纯 JSON，但不再向客户显示“检测到附加文本”提示；已部署 `/opt/pojia/releases/20260823-session-silent`。
- 已注册卡余额充值 service/timer 但保持 disabled；已启用只读卡余额充值对账 timer，首次执行成功且当前无待对账资金尝试。
- 当前因 HNSKJ 卡台正在升级，暂停所有卡台相关写入与真实资金测试；只读健康检查和对账保持运行。
