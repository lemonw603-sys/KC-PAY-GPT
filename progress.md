

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
