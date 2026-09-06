# Browser 手工备用卡付款前观察（脱敏）

目标订单冻结到 `manual_excel/backup-a`，尾号 `5501` 的卡片生产余额为 `$20`。在本机 BitBrowser Pilot Profile、菲律宾出口下，使用订单 Session 完成身份/FREE 核对，新建 Plus Checkout，填写卡片、固定版本 MockAddress DE 账单地址和 Session 邮箱后，页面从 `PHP 1100.00 / tax 117.86` 重算为 `PHP 982.14 / tax 0.00`。唯一可见可用的 Subscribe 控件存在，但没有点击。

观察中发现并修正两项页面漂移：Checkout 不再稳定包含 summary `h2`；Stripe 账单 iframe 会延迟挂载且可保留隐藏/跨 frame 控件。生产代码改为使用唯一 summary 容器及唯一可见账单控件，并等待 iframe hydration。

敏感材料未写入本目录。卡字段 3/3 清空，Session Cookie 清理，Profile 关闭，付款提交 0 次。
