# 主链交接点审查｜2026-09-11

代码基线：`d76d193`（业务代码同 `2b7250b`）。时间：2026-09-10 23:30 UTC 起（UTC+8 为 09-11 上午）。本轮范围：预检适配器、预检重开、付款后核实、人工收口和后台入口。不是全项目审查完成。

## 结论

主线不是重新写一个充值器：保留服务端订单/卡/资金账与本机 Browser 的职责分离，先证明这些组件实际接在一起。当前最重要的新证据是：**此前称为“扩展对照”的预检，在对应提交中仍使用 Cookie 适配器**。应撤回“扩展方式也失败”的实验结论，而不是继续解释它为什么失败。

### F-42｜P1｜EXTENSION 开关没有接入实际失败的预检阶段

- 观察：`production-live-pool-worker.js:262-269` 只为 shared.sessionProvider、shared.postPaymentSessionProvider 选择适配器；`:222-227` 创建预检时不传该适配器。`browser-order-preflight.js:409-414` 独立 new CookieSessionBootstrapAdapter。
- 原版本核对：`git show 5397d3d:browser-mvp/src/browser-order-preflight.js` 第 409 行同样写死 Cookie，非接班后变化。
- 离线复现：设置 BROWSER_SESSION_PROVIDER=EXTENSION，调用真实预检 factory，在进程内替换仓库 I/O 与 executor.execute 以观察其实际注入实例，得到 CookieSessionBootstrapAdapter。未修改源码文件，未访问浏览器或数据库。
- 结论：开关无法使预检采用扩展；5/5 次预检失败不能证明扩展 adapter 走过失败链。代码与“第五次为扩展路径真实对照”的交接描述冲突。
- 反证/限制：如果之前有人独立手动打开扩展，浏览器可以遗留扩展建立的会话；本证据不能排除这种外部动作，也不能证明扩展有效或无效。WAL 没有足够 adapter 标记证明完整实验来源。
- 建议：先修正实验结论；获批后才补预检依赖注入和 wiring 回归，不能直接再次用客户账号试。
- 置信度：代码接线高；历史是否独立手动用过扩展未知。

### F-43｜P1｜付款后核实先验证旧订单凭证，可能挡住浏览器现有会话探测

- 观察：`live-post-payment-recovery.js:57-64` 在 newPage/confirmPlus 前调用 sessionProvider.open；`session-bootstrap.js:145-149` 先 source.load；`shared-encrypted-materials.js:212-214` 仍对订单里的旧 JSON 调 validateChatGptSession；`v1/src/domain/session-validation.js:48-86` 默认要求 access token 剩余至少 300 秒。
- 离线复现：保持付款未知上下文和模拟浏览器现有 cookie 不变，只把合成旧凭证的寿命从 3600 秒改成 299 秒。前者读取浏览器 cookie 一次、进入 confirmPlus 一次；后者 SESSION_INVALID，浏览器 cookie 读取 0、confirmPlus 0。
- 结论：即使浏览器现有会话可能仍可核实，系统也会先被不再用于核实的旧 access token 门槛挡住。这与 D-136“用付款后浏览器会话、不依赖重注入旧 token”的方向不完整一致。
- 影响：协调器将异常转 VERIFICATION_READ_FAILED/UNKNOWN，等待重查或超时人工，不会因本缺陷重付；但可能无法自动收尾。
- 反证/限制：旧凭证仍充足时不触发；本轮没有真实付款后账号样本，未证明历史某单由此失败。模拟 confirmPlus 只作调用计数，不伪称真实会话有效。
- 建议：获批后将已有浏览器会话核实与旧材料加载解耦，同时保留权威身份/订单核对，不简单取消身份验证。
- 置信度：离线控制流高，真实发生频率未知。

### F-16/F-3 状态更新｜后端已有，后台入口仍缺

- 线上文件只读核对包含 RESOLVE_UNKNOWN_PAYMENT；本地 `server.js:267` → `create-app.js:706-715` → `browser-admin-service.js:974` 形成后端调用入口。
- `public/admin/assets/admin.js:589-606` 排除 RECONCILE_ONLY，现有按钮没有新动作；`:1352-1361` 订单抽屉也没有接该动作。不能把“后端部署”说成“运营已可通过界面收口”。
- 本轮没有对真实订单调用接口，没有做已登录页面验收。

## 不能沿用的旧恢复说明

1. “预检 DEAD 无任何重开或告警”已过时：当前 `browser-order-preflight.js:346-383` 有退还租约失败次数和告警；`v1/scripts/reopen-browser-preflight.mjs` 有 DEAD→PENDING 守卫和审计。未执行重开。
2. 重开脚本 `--dry-run` **不是只读 SQL**：仍执行事务 UPDATE/INSERT，最后 rollback。不要在只读核对时运行它。脚本直接 mysql.createPool 而不是共享 `createDatabasePool`，是否符合项目“正式连接池”的约定需后续处置，不在本轮擅自替换。
3. “核实时账号 free 就自动判拒付”不是当前 recovery verifier 行为：`live-post-payment-recovery.js:89-92` 在 !plus.confirmed 时只返回 UNKNOWN。协调器虽支持 DECLINED，但不能仅因分支存在就声称 LIVE 已产生该结果。未确认会保守重查/转人工。
4. NOT_CHARGED 测试只证明**无提交证据**的夹具能退 CDK。`browser-admin-service.js:1150` 调用 cdk-return，而该函数 `:30-37` 对任何历史 PAYMENT_SUBMIT 都保留绑定。真实点击后再人工判未扣款，不等同于那条测试的 AVAILABLE 结果。这是当前保守规则，不在缺乏用户决策时直接判为必须移除的防护。

## 验证与复现

```sh
node docs/reviews/probes/recovery-wiring-2026-09-11.mjs
```

纯离线、合成凭证、假数据库/浏览器，不读环境里的生产 URL；结果在同目录 JSON。预检接线探针替换 executor 仅用于观察依赖，不能代替浏览器端到端验证。

定向测试：browser-order-preflight、extension-session-bootstrap、shared-encrypted-materials、live-post-payment-recovery 四文件 25/25，0 skip；运行时取消 TEST_DATABASE_URL/DATABASE_URL。这证明原测试仍通过，也说明它们未覆盖上述组合缺口。

Browser 全量回归：233 项，224 通过、9 跳过、0 失败；跳过的数据库集成未验证。输出 `probes/browser-tests-2026-09-11.txt`。初次探针漏提供假 context.clearCookies 导致对照失败，补齐假接口后复跑通过，未修改业务模块。

## 下一步顺序（建议，不等于获准修改）

1. 保留当前付款关闭状态与客户现场；先纠正“扩展对照失败”的证据归因。
2. 补完付款许可/核实/人工收口的剩余边界审查，给出最小修改集合；获用户确认后才改。
3. 先离线 wiring 与隔离数据库证明，再决定是否需要真实非付款观察；账号稀缺，不以连续重试代替证据。
4. Plus 全链验收前，不以服务在线或测试全绿宣布可放量；20X 路线按 D-141 单独验。

## 未能核实的事项

Sentinel 请求响应体与根因；第五次是否有独立手动扩展操作；真实付款后会话刷新与取消续费；UNKNOWN 实单收口；多身份真实并发。

## 与事实源冲突但无法判断谁对

专项交接声称“扩展路径实际失败”，而对应提交的预检未接扩展。能确认代码接线，不能重建未记录的人工浏览器操作；因此撤回对照结论而非认定历史记录造假。

## 本次未覆盖范围

全项目深读仍为部分：后台五页完整交互、highvcc/HNSKJ 资金供给、部署全量校验、全迁移数据库回归与 09-06 起全部历史逐条比对未完成。未修改业务代码、未接生产执行、未重开任务、未新建账号或付款。
