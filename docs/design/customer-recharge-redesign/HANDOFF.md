# 交接说明 · 客户充值页重设计

> 面向「把原型落地到 v1 生产前端」的实现者。读完可无歧义地接入，无需回看对话。
> 前提：本次是**纯前端重设计**。后端 `v1/src/**` 零改动即可上线。

---

## 1. 实现边界（能改 / 绝不能碰）

### 可以改（本次范围）

- `v1/public/index.html`（客户页结构）
- `v1/public/assets/customer.css`（客户页样式）
- `v1/public/assets/customer.js`（客户页脚本）

### 绝不能碰（硬边界，改了即越界）

- `v1/src/**` 任何后端逻辑：订单、Provider、卡台（HNSKJ）、自动补给、资金栅栏、付款、对账、Browser。
- 三个客户接口的**入参 / 出参 / 错误码 / 状态映射语义**（`create-app.js`、`order-status-service.js`、`order-intake-service.js`、`session-validation.js`）。
- 后端幂等与防重：CDK 一次性 REDEEM、`orderRateLimit`、`cardPurchaseIdempotencyKey`。
- 管理后台（`v1/public/admin/**`）与 admin 接口。
- 任何会导致「确认前创建订单 / 发起充值」的改动。
- 任何会回显完整 Session / Token / 卡号的改动。

> 落地属于「改动生产前端」，按项目纪律：动手前说明影响与回滚方式并取得当次确认；本设计阶段**不做落地**。

---

## 2. 接口依赖（契约，已按现网核验）

### 2.1 创建订单 —— 仅确认后调用

```
POST /api/v1/orders
Body: { "cdk": "<string 8..256>", "session": <完整 Session JSON 对象> }
201:  { "order": { "publicNo": "PJV1-…", "status": "CREATED" } }
```

- `session` 直接传解析出的 JSON 对象（不是字符串）。后端 `validateChatGptSession` 会校验 `user.email`、`account.id`、`accessToken`(JWT)、`sessionToken`(JWE 5 段)、`expires`。
- 返回 `status` 为内部 `CREATED`；前端首帧按 `QUEUED` 渲染（与现有 `customer.js` 行为一致），真实进度靠随后轮询补齐。
- 错误码（`payload.error`，小写）：`cdk_unavailable`(409) / `incomplete_session` / `invalid_access_token` / `access_token_expired` / `access_token_near_expiry` / `invalid_session_token` / `session_expired` / `invalid_session_expiry` / `invalid_order_request` / `order_route_unavailable`(503) / `rate_limited` / `body_too_large`(256kb 上限) / `invalid_json`。

### 2.2 查询 / 轮询

```
POST /api/v1/orders/status
Body: { "publicNo": "PJV1-…" }  或  { "cdk": "<原 CDK>" }   （二选一，不能同时）
200:  { "order": { … } }
```

`order` 字段：

| 字段 | 出现时机 | 说明 |
|---|---|---|
| `publicNo` | 总是 | 查询码 |
| `status` | 总是 | 7 态之一 |
| `updatedAt` | 总是 | ISO |
| `timeline[].{status,updatedAt}` | 有事件时 | 已发生节点（连续同态已去重） |
| `actionRequired.{code,message}` | 有客户动作时 | 直接展示 `message`，不要自造 |
| `sessionReplacement.{used,remaining,expiresAt}` | 有客户动作时 | `remaining = 3 - used` |
| `customerEmail` | 仅 `SUCCESS` | 成功摘要用 |
| `finishedAt` | 仅 `SUCCESS` | 完成时间 |

错误码：`invalid_order_query`(400) / `order_not_found`(404) / `rate_limited`（status 限流 30/窗口）。

### 2.3 更换 Session

```
POST /api/v1/orders/session
Body: { "publicNo": "PJV1-…", "session": <新 Session JSON 对象> }
200:  { "order": { … } }
```

错误码：`session_replacement_not_allowed` / `session_replacement_expired` / `session_replacement_limit_reached` / `funds_state_unsafe`（资金复核中不允许更换）。

### 2.4 前端本地读取（不经接口）

- 确认页邮箱：`session.user.email`（与后端 `customerEmail` 同源，见 `session-validation.js:73`）。
- 卡密：客户输入，打码展示。

---

## 3. mock 说明（原型 vs 生产）

原型用 `mock-api.js` 在浏览器内存模拟后端，**绝不连接生产、不创建真实订单、不发付款**。它严格对齐真实客户契约（字段名、状态映射、错误码、`timeline` 去重）。

### 落地时如何替换为真实后端

`app.js` 通过 `const api = window.MockBackend;` 消费三个方法：`createOrder / getStatus / replaceSession`。落地只需把这一行换成真实 fetch 封装（沿用现有 `customer.js` 的 `postJson`）：

```js
async function postJson(url, body) {
  let res;
  try { res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }); }
  catch { throw new Error('network_error'); }
  let payload = null;
  try { payload = await res.json(); } catch { throw new Error('invalid_response'); }
  if (!res.ok) throw new Error(payload?.error || 'request_failed'); // error.message = 小写错误码
  return payload;
}
const api = {
  createOrder:   (b) => postJson('/api/v1/orders', b),
  getStatus:     (b) => postJson('/api/v1/orders/status', b),
  replaceSession:(b) => postJson('/api/v1/orders/session', b)
};
```

> 错误码差异：mock 抛的 `error.code` 是大写（`CDK_UNAVAILABLE`），真实 fetch 把 `payload.error`（小写）放进 `error.message`。`app.js` 的 `errText()` 已同时兼容两者（先看 `err.code` 再看 `err.message`），无需改动。

### 落地时必须移除（仅原型的东西）

- `index.html`：`.proto-ribbon` 顶部提示条、`<aside class="demo">` 演示面板、`<script src="./mock-api.js">`。
- `app.js`：文件末尾 `window.__proto = {…}` 钩子、演示面板事件绑定（`el.demo*`、`demoPrefill/demoConfirm/demoStatus/demoAutoplay`）、`setTheme` 的演示触发。
- `mock-api.js`、`capture.mjs` 整个文件不落地。
- favicon 改回现有 `/assets/favicon.svg`（原型用内联 data-uri 便于独立运行）。

### 落地保留（是生产功能，不是演示件，别误删）

- **Session 获取教程弹层**：`#session-guide` dialog、`.help-link` 入口（`#session-help-open` / `#replace-help-open`）、`openGuide/closeGuide` 及其事件绑定——全部保留。仅 `window.__proto.guide/closeGuide` 这两个钩子随 `__proto` 一起移除。
- **成功页订阅外链**：`#subscription-link` 及 `renderStatus` 里 `el.subLink.hidden = !success`——保留。
- 教程与订阅外链均指向 ChatGPT 官方域名（`chatgpt.com`、`chatgpt.com/api/auth/session`），带 `target="_blank" rel="noopener noreferrer"`；不涉及任何后端接口。若运营有独立帮助中心 / 教程页，可把外链改为站内地址。

### 落地时必须调整

- 资源引用路径改为 `/assets/customer.css?v=6` / `/assets/customer.js?v=6`（**bump 版本号**避免缓存旧文件；现网是 `?v=5`）。
- 轮询间隔改回生产值（见 DECISIONS B6）：建议沿用现有 `customer.js` 的 `QUEUED/PROCESSING=5s、REVIEWING/ACTION_REQUIRED=30s、FINALIZING=10s`，并保留「隐藏标签页跳过轮询、30 分钟上限暂停、终态停止」三条现有策略（`app.js` `schedulePoll` 已实现同款逻辑，仅数值需对齐）。
- 保留现有 `sessionStorage` 记忆查询码的行为（可选，原型未搬运这段，但不影响契约）。

---

## 4. 落地映射（一一对应）

| 原型文件 | 落地目标 | 动作 |
|---|---|---|
| `prototype/index.html` | `v1/public/index.html` | 重写结构，移除 §3「必须移除」项 |
| `prototype/styles.css` | `v1/public/assets/customer.css` | 替换 |
| `prototype/app.js` | `v1/public/assets/customer.js` | 替换 + 按 §3 换 `api` 实现、删钩子、调轮询值 |
| `prototype/mock-api.js` | — | 不落地 |
| `prototype/capture.mjs` | — | 不落地（可留仓做回归截图工具） |

落地后建议回归：`v1/test/public-isolation.test.js`、`v1/test/app.test.js`、`v1/test/order-status-service.test.js`（确认前端改动未触碰后端契约）。

---

## 5. 启动方式（本地预览原型）

```bash
cd docs/design/customer-recharge-redesign/prototype
python3 -m http.server 8848 --bind 127.0.0.1
# 打开 http://127.0.0.1:8848/index.html
```

- 顶部「演示面板」可跳转任意状态、填入示例、切深/浅色、看自动演进。
- 真实体验路径：填入示例 → 下一步（本地解析，看确认页大字邮箱）→ 勾选 → 创建订单 → 观察轮询自动到成功。
- 重新生成截图（可选，需仓库根 `node_modules` 的 playwright）：

```bash
node docs/design/customer-recharge-redesign/prototype/capture.mjs
```

---

## 6. 未验证项（明确列出，不夸大）

- 【未联调】未与真实后端 / 真实 Session 联调；原型全程走内存 mock，未创建任何真实订单、未发任何付款。
- 【未回归】未在真实浏览器矩阵测试；仅用 Chromium（Playwright 截图）+ 应用内浏览器预览，未覆盖 Safari / 微信内置浏览器 / 低端 Android。
- 【未回归】`parseSessionInput` 沿用现有逻辑，但未用真实 Session 样本集回归各种变体（含扩展追加文本、多对象粘贴）。
- 【未测】无障碍未用屏幕阅读器（VoiceOver / TalkBack）实测，仅做了语义 / 焦点 / `aria-live` / reduced-motion 的静态设计。
- 【未测】生产 `helmet` / CSP 下的内联样式与 SVG 表现未验证（原型内联脚本/样式；生产是外链 css/js，风险更低）。
- 【未定】轮询间隔用了演示用短值，未按生产值回归节流 / 弱网 / 超长时间线表现。
- 【未定】Dark 模式是否上线、邮箱是否打码、失败结果码是否新增，均待拍板（DECISIONS §B）。
- 【未审】文案未经运营 / 合规终审。
- 【未压测】未做真实并发 / 长时间轮询 / 断网恢复的稳定性验证。

---

## 7. 一句话总结

结构、视觉、文案、动效全部重做，但**后端零改动、契约零变更、边界零突破**：确认前不发请求，只展示脱敏邮箱，成功就地不弹窗，防重与幂等原样保留。落地即「替换 `v1/public` 三文件 + 把 mock 换成 fetch + 删演示件」。
