# v1 客户页面合同

- 日期：2026-08-17
- 路径：`GET /`
- 运行边界：仅调用 v1 订单创建与状态查询 API

## 能力

- 提交 CDK + 完整 Session JSON 创建 Plus 订单。
- 使用 `publicNo` 或原 CDK 查询订单。
- 展示 `QUEUED | PROCESSING | REVIEWING | SUCCESS | FAILED` 五种客户状态。
- 对排队和处理中订单每 5 秒轮询，复核中每 30 秒轮询；5 分钟后暂停自动轮询。
- 进入成功或失败终态后停止自动轮询。

## 敏感信息边界

- Session JSON 不写入 `localStorage`、`sessionStorage`、Cookie 或 URL。
- 创建成功后立即清空 Session 输入框。
- 当前标签页只在 `sessionStorage` 保留最后一个 `publicNo`，用于刷新后填充查询框。
- 页面不展示银行卡、Provider、内部错误、退款或 Session 内容。
- 不加载外部脚本、字体或 CDN 资源；Helmet CSP 只允许本站资源。

## 错误显示

页面将 API 错误码转换为可操作的中文提示，不显示服务端异常堆栈或内部原因。CDK 已绑定时提示客户转到查询页找回原订单。

## 浏览器验证

2026-08-17 用 Playwright/Chromium 完成：

- 1440×1000 桌面视口。
- 390×844 移动视口。
- 创建订单、Session 清空、自动轮询至终态、CDK 找回复核中订单。
- 控制台 0 错误、0 警告。

本次验证使用本地假 API，没有访问供应商或真实写入资金数据。
