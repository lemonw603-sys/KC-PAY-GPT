# D-339 近7天成功率实施与验收

时间：2026-09-21 23:23 UTC+8。范围：本地候选，未发布、未写生产、未调用卡台/付款。

## 依据清单

- 决策：D-339。不删历史，不把自动完成率混进来。
- 原型/布局：工作台C，营业条乙-3；本次只替换数字墙原成功率格与对应筛选，不重排页面。
- 生产查询：`docs/reviews/2026-09-21-feedback-b/audit.sql`、`detail.sql`及原始TSV先证4条明确演练。23:25 UTC+8用最终predicate重查：

```sql
SELECT COUNT(*) sample_count,
  SUM(o.status='RECHARGE_SUCCESS' OR (o.status='CLOSED' AND EXISTS
    (SELECT 1 FROM order_events se WHERE se.order_id=o.id AND se.to_status='RECHARGE_SUCCESS'))) success_count
FROM orders o
WHERE o.status IN ('RECHARGE_SUCCESS','RECHARGE_FAILED','CLOSED')
  AND o.created_at >= TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+08:00'))) - INTERVAL 6 DAY - INTERVAL 8 HOUR
  AND o.created_at < TIMESTAMP(DATE(CONVERT_TZ(UTC_TIMESTAMP(),'+00:00','+08:00'))) + INTERVAL 16 HOUR
  AND NOT EXISTS (SELECT 1 FROM order_events re WHERE re.order_id=o.id
    AND JSON_UNQUOTE(JSON_EXTRACT(re.metadata_json,'$.closeRehearsalOrder'))='true');
```

```text
sample_count=2  success_count=1  success_rate=50.0
PJV1-h9RKlXHNoWfTO01S8aGT  RECHARGE_FAILED  2026-09-16T10:16:35.794000Z
PJV1-x-tIsPB5ICHu6R9bzsSO  RECHARGE_SUCCESS 2026-09-16T11:06:44.485000Z
```

## 实现结果

- `admin-read-service.js`：聚合与`RECENT_FINISHED`列表共用唯一样本predicate；原全历史字段保留以免隐性影响其他消费方。
- `card-inventory-eligibility.js`：北京近N自然日收进现有日界工具，列名与天数均校验，不在业务服务重复手写时区。
- `admin.js/index.html`：显示“近7天成功率”+成功/样本；零样本破折号；点击打开同口径清单并清空旧搜索/日期。全部/已完成仍可查历史。
- 无数据迁移、无新表/服务/定时器；D-254受限付款文件0变更。

## 验收证据

- 专项单测：51/51通过。
- `scripts/test-recent-success-rate.mjs`真实本机MySQL（4项）：第7日北京零点计入，下界前1ms/上界排除；演练/进行中排除；普通失败和关闭保留；聚合2/4=50%与列表4行一致；零样本返回null。临时库已删。
- `FEEDBACK_ACCEPTANCE=1 DIAGNOSTICS_ACCEPTANCE=1 node scripts/step6-safety-acceptance.mjs`：26 checks、0 failures，实际DOM点击与请求body一致；Browser付款门、API/Browser付款不明收口、备份恢复继续通过；临时库/账号0残留。证据`output/playwright/feedback-a/evidence.json`。
- 默认全量：1079 tests / 1010 pass / 0 fail / 69 skipped。`ui-copy-check` 通过，`git diff --check`通过。

首轮真库夹具曾将北京09-15 00:00错换为UTC09-15 16:00，真SQL正确多算了1天；夹具改为UTC09-14 16:00后通过。首轮DOM扩展又暴露初始概览请求与合成渲染竞态，改为等待首次概览完成后连续重跑通过；不隐藏两次夹具/验收脚本修正。

## 边界

生产release仍为`20260921-step6-9b9f181`，页面仍是旧成功率；上述50%仅是2个样本的当时结果，不证明链路已稳定。发布、真客户使用与一天观察仍需后续门槛。
