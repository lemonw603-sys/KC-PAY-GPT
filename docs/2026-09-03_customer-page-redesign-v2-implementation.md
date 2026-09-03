# 客户充值页改版 v2 实施记录｜2026-09-03

状态：**已落地代码并本地验证；待部署生产**（用户已确认预览定稿）。
预览定稿 Artifact：`https://claude.ai/code/artifact/b52c0201-b2cf-48ef-ac93-2972816007d7`

## 改动范围（纯展示层 + 一处后端映射）

1. **去二次确认**：邮箱在填写页就地核对、一步建单；保留核心不变量（邮箱建单前可见 / 点击才建单恰好 1 次 / Session 建单后清空）。
2. **6 步真实进度**（合并原 7 步的「准备 / 就绪」为一步「准备中」）：已创建 → 准备中 → 正在支付 → 正在开通 Plus → 正在确认订阅 → 已完成。步骤来自订单真实状态机（8-27/8-29 两笔成功单 events 验证）。
3. **横向进度条 + 百分比 + easeOutCubic 平滑动画**，替代竖排时间线；从 1% 顺滑递进、步内缓增、不跳格。
4. **3 步骤条**（填写资料 → 开通处理 → 开通完成，图标 segment），替代 2 步数字圆圈。
5. **配色升级**：祖母绿压深 + 香槟金点缀（PLUS 徽章 / 进度流光）+ 微暖高级中性；light / dark / 系统深色三套 token 同步。
6. **文案**：等待改「通常一分钟左右完成」，对齐 1 分钟目标，去掉「几十分钟」。

## 改动文件

- 后端 `v1/src/services/order-status-service.js`：`CUSTOMER_STATUS` 合并 `CARD_READY→PREPARING`（7 步收 6 步）。
- 后端测试 `v1/test/order-status-service.test.js`：同步 6 步断言。
- 前端 `v1/public/index.html`：3 步骤条、横向进度容器、内联邮箱、删确认视图、资源版本 `?v=10`。
- 前端 `v1/public/assets/customer.js`：`STATUS/TL_LABEL/CANON` 6 步 + `STEP_SHORT/PROGRESS_PCT`；`renderProgress`+`animateProgress` 替 `renderTimeline`；`setStepper` 3 步；去确认流程（`refreshInputEmail` 就地显示邮箱 + submit 直接建单）。
- 前端 `v1/public/assets/customer.css`：配色 tokens、stepper segment、`.hp` 横向进度、去 `READY` 状态色、`plan-badge` 香槟金、移动端 stepper 适配。

## 未改变

- 未改后端客户 API 语义、订单状态机、资金 / 付款 / 对账 / CDK、任何 migration。
- 客户只见映射态、不见内部 16 态 / 卡台 / 资金；异常态（复核 / 待换号 / 失败）不进正常进度条。

## 验证（本地）

- 后端 6 步映射测试通过；`v1` 全量 **516 测试 / 472 通过 / 1 失败 / 43 跳过**。唯一失败：admin 后台 `admin.js?v=21` 与测试期望 `v=20` 不符——**预存漂移，本次未动任何 admin 文件（git 确认）**，与本改版无关。
- 本地预览（http.server 8899）：桌面 1440px + 移动 375px 渲染核对——3 步骤条、横向进度条（ACTIVATING 态 75% / 6 节点 / 平滑填充）、金色 PLUS 徽章、邮箱就地核对（`inline-email.hidden=false`）、按钮亮起、移动端 stepper 无横向溢出。
- `node --check` customer.js 通过；无旧时间线 / 步骤条残留。

## 待部署（未执行）

1. 备份 DB / unit / current；
2. 落 4 个文件 + 资源版本；生产 release 化、原子切换 current；
3. 只读复验：`/health/ready`、readiness `ok=true`、公网 CSP、桌面/移动、Console 0 error/warning、既有订单查询渲染；
4. 留回滚点；单独确认后再上生产。**部署前一律不动生产客户页。**

## 遗留（out-of-scope）

- admin 后台测试断言 `admin.js?v=20` 与实际 `v=21` 不符（预存），建议单独修，不并入本次。
