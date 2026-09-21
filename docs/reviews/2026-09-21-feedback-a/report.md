# 反馈整改 A 第一批：入口与刷新反馈

2026-09-21，UTC+8。**仅本地实现并隔离验证，未发布。A批和FB-01～09均未整体结项。**

## 依据、范围与回退

- 决策D-329～331；工作台 `step6-workbench-compare.html` C、营业条 `step6-opsbar-v5.html` 乙-3、卡片 `step6-cards-compare.html` A。保留布局及现有高级表单，不新建钱包服务。
- 基线：本轮开工HEAD a9a077e，应用与生产代码9b9f181相同。`git diff 9b9f181 -- v1/src browser-mvp/src` 输出为空；改后仍为空。后端、资格SQL、客户页、Browser付款实现、迁移均未改。
- 影响面：工作台钱包按钮、token待办、卡片高级钱包区域、导航委托。复用已有GET钱包接口；不保存token、不改变供卡资格或付款栅栏、不启动worker。
- 回退：撤回本批admin.js和index.html静态资源变更即可；无数据迁移、无生产配置需要恢复。尚未部署，无维护停业。

## 验收和实际观察

| 承诺 | 证据 | 状态 |
|---|---|---|
| 钱包文字直达原有刷新区 | admin.js `renderWbCards` / `openHighvccTarget`；真实DOM点击后祖先details全open、activeElement为highvcc-refresh-wallet | 本地已验证 |
| token待办展开并定位输入框 | `renderWbQueue` / document委托；截图token-focused.png显示高级与highvcc区打开，输入框有焦点，确认开卡未触发 | 本地已验证 |
| 查询失败不冒充成功，可重试 | `loadHighvccWallet`显式布尔结果，刷新handler按结果提示；截图wallet-failed.png及wallet-success.png；新增单测 | 本地已验证 |
| 保持支付保护 | 修改前60/60保护单测；修改后专项108/108；25项真实隔离MySQL/浏览器验收含未知付款通用关闭409、API/Browser核实收口、未扣款重提及重放幂等、关派单保留轮询 | 在所列隔离范围已验证，不是真钱验收 |
| 两台数据全部准确、所有刷新入口可靠 | 上游/缓存仅钱包样本，highvcc过期；顶部查余额仍有轮询覆盖和成功后禁用问题 | 未完成，FB-01继续 |
| token保存到健康告警闭环 | 本批没有修改保存/自动接收token逻辑；保存成功后刷新失败误报、旧告警清除语义仍需核验 | 未完成，FB-02继续 |
| 卡源切换与时间含义 | FB-03/05代码映射已查；未保存选择、响应丢失、资料同步/交易同步/NO_CHANGE区别仍需收口 | 未完成 |
| 历史分类/统计/客户链/订单页/一天试用 | 保留FB-04/06/07/08/09及B～E顺序；本次没有清理或改统计 | 后续阶段，未完成 |

隔离浏览器钱包响应明确为合成数据；stock服务未注册，额外验了读页失败仍能修复登录的路径。该测试不能证明生产卡片读取正常或上游钱包成功。点击期间请求清单全部GET，0个写请求。截图只含合成内容，无真实凭据。

命令：

```sh
node --test v1/test/admin-operation-feedback.test.js v1/test/admin-cards-page.test.js v1/test/worker-runtime.test.js v1/test/unknown-submission-resolve-service.test.js v1/test/browser-execution-repository.test.js v1/test/recharge-attempt-repository.test.js v1/test/order-intake-service.test.js v1/test/card-inventory-eligibility.test.js
FEEDBACK_ACCEPTANCE=1 DIAGNOSTICS_ACCEPTANCE=1 node scripts/step6-safety-acceptance.mjs
(cd v1 && node --test)
node scripts/css-drift-check.mjs
node scripts/ui-copy-check.mjs
git diff --check
```

结果：专项108 pass/0 fail；隔离25 checks/0 failures，10:18:38.869 UTC结束，databasesRemaining=0/accountsRemaining=0；默认1054 tests/985 pass/0 fail/69 skipped（跳过不算通过）。CSS/文案/diff检查通过。诊断几何契约及变异通过；**不是工作台和卡片全页面几何/移动端验收**，待A批整体验收补齐。

原始日志：baseline-tests.txt、full-tests.txt；隔离结构化结果与截图同目录。已有8803/8804/8899及常驻Browser池保持原样；临时Chrome/服务随验收清理。

## 现场只读证据

原规划中09:18～09:23 UTC查询仍为初查依据；本轮补查（不读token值）：

```sql
SELECT UTC_TIMESTAMP(3);
SELECT setting_key,setting_value FROM app_settings
WHERE setting_key IN ('accept_new_orders','dispatch_new_recharges','browser_payment_writes_enabled');
SELECT provider,synced_at,JSON_UNQUOTE(JSON_EXTRACT(payload_json,'$.accountBalance')) AS balance
FROM card_provider_snapshots WHERE provider='hnskj';
SELECT alert_type,status,COUNT(*) FROM operator_alerts
WHERE alert_type='PROVIDER_TOKEN_EXPIRED' GROUP BY alert_type,status;
SELECT setting_key,updated_at FROM app_settings WHERE setting_key='highvcc_access_token_ciphertext';
SELECT COUNT(*) AS nonterminal FROM orders WHERE status NOT IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED');
```

原始输出：

```text
2026-09-21 10:18:18.396 UTC
accept_new_orders true
browser_payment_writes_enabled true
dispatch_new_recharges true
hnskj 2026-09-21 10:17:34.145 UTC 38.730000
2026-09-21 10:19:22.945 UTC
PROVIDER_TOKEN_EXPIRED OPEN 1
highvcc_access_token_ciphertext 2026-09-18 12:54:05.098 UTC
nonterminal 0
```

第一遍误把数据库列写成UI映射名type，报1054；按迁移010改为alert_type重查成功，错误不当业务依据。10:19:26 UTC独立SSH：current为20260921-step6-9b9f181，web234748/worker234751/bark234754三服务active；state-check现场一致，瞬时资格4、活动账号槽0、非终态0。没有执行生产写入或重启。

本轮较早只读上游请求：10:08:10.105 UTC highvcc钱包返回HIGHVCC_TOKEN_EXPIRED；10:10:24.704 UTC HNSKJ accountBalance返回data.balance=38.730000 USD，与当时缓存一致。此样本不代表所有卡片逐张准确。highvcc仍需用户在卡台登录后通过后台现有入口更新，不能因已配置而判有效。

## 下一批

继续A：统一两个钱包入口的重复查询/轮询覆盖反馈，核验token保存结果与状态刷新分别提示、失效告警生命周期；核实卡余额时间和路线/卡源未保存选择。无需扩展资金能力。完成A的跨页/移动端验收后再明确发布边界；B阶段历史分类先给预览，不自动删除。
