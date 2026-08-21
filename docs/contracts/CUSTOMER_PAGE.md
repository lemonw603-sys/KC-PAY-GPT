# v1 客户页面合同

- 日期：2026-08-17
- 路径：`GET /`
- 运行边界：仅调用 v1 订单创建与状态查询 API

## 能力

- 提交 CDK + 完整 Session JSON 创建 Plus 订单。
- 使用 `publicNo` 或原 CDK 查询订单。
- 展示 `QUEUED | PROCESSING | ACTION_REQUIRED | FINALIZING | REVIEWING | SUCCESS | FAILED` 七种客户状态。
- 账号已经是 Plus 或本地确认 Session 无效时，在原订单提交新 Session；最多 3 次，窗口从首次客户可修复错误开始计算 72 小时。
- `FINALIZING` 表示充值平台已经确认付款成功，但系统仍在确认自动续费已取消；此时不提前展示成功。
- 对排队和处理中订单每 5 秒轮询，复核中每 30 秒轮询；30 分钟后才暂停自动轮询。
- 进入成功或失败终态后停止自动轮询。

## 敏感信息边界

- Session JSON 不写入 `localStorage`、`sessionStorage`、Cookie 或 URL。
- 创建成功后立即清空 Session 输入框。
- 当前标签页只在 `sessionStorage` 保留最后一个 `publicNo`，用于刷新后填充查询框。
- 页面不展示银行卡、Provider、内部错误、退款或 Session 内容。
- 客户只看到自身可处理的原因；库存不足、开卡失败、卡台/Provider 故障等内部问题只在运营后台和通知中展示。
- 不加载外部脚本、字体或 CDN 资源；Helmet CSP 只允许本站资源。

## 错误显示

页面将 API 错误码转换为可操作的中文提示，不显示服务端异常堆栈或内部原因。CDK 已绑定时提示客户转到查询页找回原订单。

当前客户可操作原因只有：

- `ACCOUNT_ALREADY_PLUS`：换一个免费账号的 Session；
- `SESSION_INVALID`：重新获取并提交完整 Session。

更换成功后立即清空页面输入框；旧 Session 不进入更换历史。

## 浏览器验证

2026-08-17 用 Playwright/Chromium 完成：

- 1440×1000 桌面视口。
- 390×844 移动视口。
- 创建订单、Session 清空、自动轮询至终态、CDK 找回复核中订单。
- 控制台 0 错误、0 警告。

本次验证使用本地假 API，没有访问供应商或真实写入资金数据。
