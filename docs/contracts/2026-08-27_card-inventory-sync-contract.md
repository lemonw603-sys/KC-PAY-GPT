# 卡片库存与自动同步合同（2026-08-27）

> 状态：实现与隔离测试已完成；尚未部署，生产修复效果未验证。

## 范围与不变量

- Provider 详情缺失 `cardTypeId` 时，仅允许用 Provider card-types 快照做唯一精确名称映射；未知或歧义继续人工复核。
- 交易集合可无 `page/pageSize`，但必须有非负整数 `total`；金额兼容 number/十进制 string，canonical 交易只保留稳定身份、类型、状态、币种、金额、手续费、时间和证据字段。
- 同一 Provider account 同时最多一个发现 batch；相同 completed baseline 复用，不创建空 batch。目录差分同时查询 cards 与历史 discoveries，避免重复发现；终态 FAILED 不自动重发现，恢复需人工入口。
- 详情读取最多 3 次，前两次 QUARANTINED，第三次 FAILED。AVAILABLE 每 10 分钟同步，以满足 15 分钟资格窗口；确定性 Schema 错误直接 REVIEW_REQUIRED，可重试网络错误仍有界退避。
- 低库存 Bark 同一 OPEN 事件仅推送一次；解除时通知取消，解除后重开才重发，DEAD 不在同一事件内复活。
- 手动/自动开卡及余额快照绑定当前 fulfillment route 的 Provider account，不再隐式使用 legacy 固定账户。

## 验收与未验证

隔离 MySQL 8.4 空库已执行 `001–037`；专项定向 54/54，真实 MySQL 33/33。生产只读确认卡 1477 开卡金额 `$16`、当前 Provider 余额 `$0.07`、本地余额滞后为 `$16`、交易 Schema 任务两条 REVIEW_REQUIRED、历史卡最多 495 条 discovery、低库存告警 OPEN/Bark SENT。修复尚未部署；历史重复 discovery 清理、FAILED 恢复入口及真实手动开卡端到端仍未验证。不得执行真实开卡、充值、付款、退款或提现。
