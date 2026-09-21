# 客户来单Bark通知更新（D-340）

2026-09-21 UTC+8本地完成；**2026-09-22 UTC+8已随`20260921-feedback-d340-7e88952`发布，本轮真实Bark测试请求仍为0。**

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
| 生产规则 | 新release三进程/健康/源码已验，历史36条无补推 | 已发布 |
| 真实手机呈现 | 本轮未主动发真实Bark，等下一笔自然来单 | 未验证 |

真实隔离MySQL验收过程中实际Bark请求为0，临时库已清理。测试证明代码行为和边界，不等于手机真机验收。

## 发布结果与边界

本规则已在生产代码生效。发布后Bark进程cwd已指向新release；36条历史`BROWSER_ORDER_SUBMITTED`仍全是SENT、attempt_count=1，最后发送时间未变，没有因恢复白名单而补推。手机真机样式尚需下一笔真客户来单自然验收，不为验收主动造生产来单。详见[2026-09-22发布报告](../2026-09-22-feedback-release/report.md)。
