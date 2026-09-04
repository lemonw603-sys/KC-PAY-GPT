# 菲律宾 Checkout 税费观察器补强（2026-09-03）

## 目标

回答一个窄问题：在菲律宾出口固定不变时，`PHP 982.14` 何时、因什么信号变成 `PHP 1100.00`。本轮只增强证据采集，不执行新的线上 Checkout，也不付款。

## 实现

- 新增 `browser-mvp/src/checkout-tax-evidence.js`，所有网络证据先经过白名单化再落入结果。
- Checkout 创建只保留入口、套餐、UI mode、账单国家和币种。
- Checkout snapshot 只保留国家/州和字段存在性；姓名、街道、城市、邮编原文全部丢弃。
- pricing config 只保留价格、税、VAT、币种、国家、PSP 等限定信号。
- Stripe URL 删除 query，并把 payment page 的 Checkout 标识替换为 `:checkout`；不读取 Stripe body。
- 观察器增加填卡前、填卡后、地址后的稳定金额时间线，并在输出前对实际输入值做禁止值扫描。

## 验证

```text
node --test test/checkout-tax-evidence.test.js
7 passed / 0 failed

npm run check
passed

npm test
150 total / 145 passed / 5 environment-skipped / 0 failed
```

5 个环境跳过项与之前一致，需要隔离 MySQL/BitBrowser 现场配置；本轮没有把它们误报为通过。

## 对下一轮现场实验的价值

下一次用同一菲律宾 Profile 做非付款观察时，可直接区分：

1. UI 到底以什么 `billing_details` 和 mode 创建 Checkout；
2. Delaware 地址填写后是否真正触发 `/checkout/snapshot`；
3. snapshot 前后税额有没有变化；
4. `982.14` 是配置净价、Checkout 基础价，还是最终应付；
5. Checkout 税额不变究竟是“地址已提交但不生效”，还是“地址根本没有进入权威 snapshot”。

若 UI 基线显示 snapshot 未发生，下一组才比较显式 `PH/PHP + custom`；若已发生且返回成功但总额不变，再比较卡 BIN/账号，而不是继续随机换地址。

## 安全停止点

- 没有点击 Subscribe；
- 没有真实付款；
- 没有 Provider/卡台写入；
- 没有保存 Session、PAN、CVC、地址原文或 Checkout ID；
- 真实 A/B 仍等待 BitBrowser 每日额度与一次可用测试输入。
