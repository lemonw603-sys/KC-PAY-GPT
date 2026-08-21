

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
