# A第二批：重复查询、操作反馈与资料时间

2026-09-21，UTC+8。**本地已实现并按下列范围验证，未发布；A及全部反馈不整体结项。** 用户“好的，可以继续”延续D-331实施范围，无新增生产/资金授权。

## 依据和影响

依据D-330/331、D-246/253独立路线与卡源、D-309/310按需查余额。原型仍是工作台C、营业条乙-3、卡片A；沿用DESIGN_SYSTEM。界面技能工具权限失败，直接使用项目规范，未安装工具。基线613a74a、前批核心保护与隔离日志见report.md；本批前后`git diff 9b9f181 -- v1/src browser-mvp/src`均为空。

只动admin.js、cards.css和index入口（admin.js v86/cards.css v5）。影响工作台切换反馈、卡片查询/登录与资料时间；不改接口、库、资金、分卡、客户页或Browser实现。回退这三个静态文件即可，无数据迁移或营业暂停。

## 承诺核对

| 项目 | 实现/证据 | 结论 |
|---|---|---|
| 钱包重复查询和轮询覆盖 | 顶部查余额不再把临时结果塞进按钮，改为打开已有高级钱包区并查询；loadHighvccWallet合并在途请求；保留查询时点，不随轮询查钱包 | 本地已验；两个入口只有一处结果，不新增缓存服务 |
| 换token后旧请求不能覆盖 | invalidateHighvccWallet使旧请求版本失效；手工/书签确认保存后清旧钱包；并发/迟到响应单测 | 本地已验；未实际保存生产token |
| 保存成功/状态读取失败区分 | 手工保存成功后单独捕获loadHighvccStatus失败，明确已保存；响应丢失只报未确认；书签同样不声称凭据有效 | 单测已验，token写入仍用原服务 |
| Browser与卡台选择 | 已保存来源未改时不要求二次切换；下拉值与data-saved-value不同则先提醒保存，0写请求；方式成功后读失败不冒充失败，丢响应不说未改变 | 5种前端单测通过；生产未切路线，后端校验不变 |
| 余额下时间 | cardRowHtml标“资料更新”，title说明非每次余额查询、浏览器时区。card-stock-service映射cards.last_synced_at；写入路径见下 | 代码语义已核实；未统一修改全站时区/资格时效 |
| 手机入口 | 首轮390px横向溢出；filters-two在admin.css后置200px双列覆盖旧移动样式，cards.css只对highvcc-token-form补620px以下单列 | 桌面1440/手机390的真实DOM焦点、无横向溢出断言通过，截图已查看 |
| 核心保护 | 25项原隔离验收、默认1061项测试 | 隔离通过，不是真实付款或所有生产按钮验收 |
| 全部反馈 | FB-01数据逐字段与新鲜度仍未全部核完；FB-02生产凭据有效性未验；FB-03生产切换未做；FB-05未逐条证明上游余额新鲜；B～E未开始 | 部分完成，不能报整批结项 |

## 已核实的时间与token语义

- `manual-card-import-service.js`提交时更新last_synced_at；`highvcc-snapshot-sync-service.js:prepare`上游列表与库一致时NO_CHANGE短路，不产新卡资料时间。
- `card-transaction-repository.js:persistCardTransactions`有有效余额快照才同时更新last_synced_at；只有交易数据时仅更新last_transaction_synced_at。
- `workflow-repository.js`刷新资料采用current_balance=COALESCE(?,current_balance)，即没有新余额也可能更新last_synced_at。因此“最后余额同步成功时间”过度承诺，标资料更新时间更准确。
- `formatTime`使用浏览器本地时区，非固定北京时区；本批保留该行为并在卡片时间title说明，没有修改后台时间或库存资格。
- `sync-highvcc-snapshot.mjs`三段snapshot/wallet/transactions均成功才clearProviderTokenExpired；任何token过期则mark，其他局部失败保留。保存token不自动解除提醒，不额外触发全量同步；告警闭环仍依现有定时任务。不能把保存成功当卡台有效。

## 原始生产只读证据

```sql
SELECT UTC_TIMESTAMP(3);
SELECT p.product_code,s.executor_kind,pa.account_code
FROM card_source_selections s JOIN products p ON p.id=s.product_id
JOIN provider_accounts pa ON pa.id=s.provider_account_id ORDER BY p.product_code,s.executor_kind;
SELECT alert_type,status,COUNT(*) FROM operator_alerts
WHERE alert_type='PROVIDER_TOKEN_EXPIRED' GROUP BY alert_type,status;
SELECT pa.account_code,c.last4,c.current_balance,c.last_synced_at,c.last_transaction_synced_at
FROM cards c JOIN provider_accounts pa ON pa.id=c.provider_account_id
WHERE c.inventory_status='AVAILABLE' ORDER BY pa.account_code,c.last4 LIMIT 10;
```

输出节选（均UTC，余额/AVAILABLE不是可分配资格结论）：

```text
10:33:03.367
chatgpt_plus API legacy-primary
chatgpt_plus BROWSER backup-a
chatgpt_pro_20x API legacy-primary / BROWSER backup-a
chatgpt_pro_5x API legacy-primary / BROWSER backup-a
PROVIDER_TOKEN_EXPIRED OPEN 1
10:39:46.930
backup-a 0237 0.000000 2026-09-18 02:52:41.892 2026-09-19 00:53:19.087
backup-a 4022 50.000000 2026-09-18 06:27:19.494 NULL
backup-a 8718 50.000000 2026-09-18 06:49:12.519 NULL
legacy-primary 0577 16.000000 2026-09-21 10:12:38.469 2026-09-21 10:12:38.446
legacy-primary 6754 50.000000 2026-09-21 10:12:38.453 2026-09-21 10:12:38.434
10:39:50 SSH
/opt/pojia/releases/20260921-step6-9b9f181
pojia-web active / pojia-worker active / pojia-bark-notifications active
```

来源表有Pro行不代表路线开启；本轮未切任何路线。state-check全一致，瞬时分配资格2（与4交替的既有时效规则），活动账号槽/非终态0。未读凭据值。

## 验证、失败记录与剩余

命令：`node --test`（v1目录）、`FEEDBACK_ACCEPTANCE=1 DIAGNOSTICS_ACCEPTANCE=1 node scripts/step6-safety-acceptance.mjs`、CSS/文案/diff检查、state-check。默认1061 tests / 992 pass / 0 fail / 69 skipped；admin专项55项通过。最终隔离25项通过，10:39:57.257 UTC结束，测试库/账号剩余0。原演示及常驻Browser池未动。

首轮真实手机溢出已修；第二轮合成节点在wait与click两个调用之间被真实轮询清掉，报null.click。测试将反馈段overview/stock读取固定为合成数据并明确读失败分支，保留实际渲染、事件委托、GET请求记录及重绘断言，finally还原读取函数。最终重跑通过，不能用这个夹具证明生产数据加载。失败证据、最终evidence与测试日志在本目录second-*文件；工作台/卡片完整几何契约仍未跑，不把诊断几何通过称全站一致。

下一步：继续FB-01字段来源、今日花费时间口径/新鲜度与刷新行为对照，明确highvcc凭据由用户更新后的验证依赖，再做A整体跨页验收。B历史分类/统计建议需给预览；客户链、订单需求与一天试用按原顺序，不提前启动第⑦。
