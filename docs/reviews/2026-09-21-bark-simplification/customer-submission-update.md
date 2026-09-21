# 客户来单Bark通知更新（D-340）

2026-09-21 UTC+8。**本地完成并验证，未发布、真实Bark请求0。**

## 依据清单

- 决策：D-340，用户明确要求“客户来单改为通知我”，覆盖D-336的来单静默子项。D-337邮箱优先、D-338钱包覆盖和D-336其他降噪规则保留。
- 原型：通知层无独立页面原型；后台继续沿用已定工作台C/卡片A，手机文案以本文样例为验收版。
- 生产只读查询：

```sql
SELECT a.status AS alert_status, n.status AS delivery_status, COUNT(*) AS count,
       MIN(a.created_at) AS first_created_at,
       MAX(a.created_at) AS last_created_at
FROM operator_alerts a
JOIN alert_notifications n ON n.alert_id = a.id AND n.channel = 'BARK'
WHERE a.alert_type = 'BROWSER_ORDER_SUBMITTED'
GROUP BY a.status, n.status;
```

当时原始结果等价摘要：`OPEN / SENT / 36`，时间范围`2026-09-12 09:25:54.575 UTC`～`2026-09-18 06:54:18.607 UTC`。36条都已是SENT，恢复白名单不会把这批历史来单重新补推。

## 实现与手机文案

- `v1/src/domain/alert-push-policy.js`：`BROWSER_ORDER_SUBMITTED`恢复到手机白名单，归入`ACTIVITY`，避免误标人工或资金异常。
- `v1/src/notifications/bark-presentation.js`：标题“收到客户充值”；邮箱优先，缺失时回退订单号；去掉“跑完会再推结果”这个无法保证的承诺。
- 不改后台alert原文、通知事故轮次、重试、余额逐笔、拒付/付款不明/取消续费异常，也不改支付、卡片或Browser Worker。

模拟手机内容：

```text
收到客户充值
账号 customer@example.test
已收到，正在排队处理。
```

## 验收方式与结果

| 验收项 | 证据 | 结果 |
|---|---|---|
| 客户来单进手机白名单 | `alert-push-policy.test.js`，白名单和领取SQL参数断言 | 通过 |
| 邮箱优先，缺失回退单号 | `bark-presentation.test.js`，实际presenter输出断言 | 通过 |
| 真实通知repository/dispatcher链路 | `node scripts/test-bark-presentation.mjs`，隔离MySQL，仅Bark transport为mock | 19项通过 |
| 同一OPEN轮次不重复 | 隔离MySQL连续领取/发送 | 通过 |
| 余额逐笔和关键异常不退化 | 隔离MySQL及全量回归 | 通过 |
| 默认全量测试 | `npm test` | 1080 tests / 1011 pass / 0 fail / 69 skipped |
| 真实手机和生产规则 | 未发布，未发真实Bark | 未验证 |

真实隔离MySQL验收过程中实际Bark请求为0，临时库已清理。测试证明代码行为和边界，不等于手机真机验收。

## 发布边界

生产release当时仍为`20260921-step6-9b9f181`，本规则尚未生效。未经发布确认，不切release、不重启服务、不真发Bark。
