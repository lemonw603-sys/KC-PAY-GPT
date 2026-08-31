# 客户提交与后台 CDK 体验收敛（2026-08-31）

## 范围

本次只修改 v1 客户提交页、Session 粘贴整理、订单查询提示和后台 CDK 生成入口；未修改 Provider、卡库存/补给、资金状态或 Browser 执行器，也未部署生产。

## 已实施

- 新增 `v1/public/assets/session-input.js`：只接受以 JSON object 开始的完整 Session，按字符串/转义规则寻找第一个闭合对象；允许 `json` Markdown 围栏；仅静默丢弃对象之后的复制尾部文本。前缀标签、数组、截断 JSON 和非 json 围栏均 fail-closed。
- 客户页以 module 方式加载整理器，并在 paste/blur 时无提示地规范化可解析输入；提交和更换 Session 共用同一规则。
- 提交时显示“创建中，请勿重复点击”状态。网络/响应不明时锁定当前 CDK 为待确认，切换到查询页并明确禁止重提；CDK 已占用时自动尝试按原 CDK 找回订单。
- 后台 CDK 生成从 `sensitiveAdminGuards` 降为已登录管理员 + 同源 + 写限流；仍保留登录会话、数量确认、幂等键、批次审计。下载、作废、状态导出等高敏感明文操作继续要求 30 分钟 step-up，不再每次生成重复输入密码。
- 生成数量增加 1–1000 整数校验和统一确认文案；损坏的浏览器幂等缓存会被安全清理。

## 验证

- `node --test v1/test/session-input.test.js`：3/3 通过。
- `node --check v1/public/assets/customer.js`、`node --check v1/public/admin/assets/admin.js`、`git diff --check`：通过。
- 已执行 `npm ci --prefix v1 --ignore-scripts`。路由/业务测试（含“生成无需 step-up、下载仍需 step-up”）通过；完整 `npm --prefix v1 test` 仍有 2 个既有 Browser 测试因 v1 未声明的 `playwright` 依赖导入失败，其余 88 项通过。
- 生产只读页面和静态资源核对显示当前线上 hash 与工作区基线一致；本次未部署，因此线上行为未改变。

## 未验证/下一步

- 需在安装依赖后重跑完整 v1 套件及 app 路由测试（特别是“生成无需 step-up、下载仍需 step-up”）。
- 需用浏览器真实操作核对 module 资源、Session 粘贴尾部清理、网络不明状态后的查询恢复和管理员会话续期。
- 需按正常发布流程单独部署并做生产只读视觉/Network 验收；本提交不含部署。
