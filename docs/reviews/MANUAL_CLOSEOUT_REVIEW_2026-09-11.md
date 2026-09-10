# 人工收口的交付判据审查

截至 2026-09-10 23:44 UTC（UTC+8 为 09-11 上午）；代码基线 `9cad431`。范围：付款确认、人工核实收口、续费事实与套餐状态。未修改业务、未调用生产写接口。

## F-44｜P1｜字符串 false 被当成续费已取消，直接成功并关闭待办

- 观察：`v1/src/services/browser-admin-service.js:573` 用 Boolean(input.renewalCancelled)，所以 JSON 字符串 `"false"` 被转换为 true。`:1068-1081` 随即选择 RECHARGE_SUCCESS / cancellation_review_required=0。
- 入口：`v1/src/app/create-app.js:706-710` 将 req.body 传到服务，`server.js:267-270` 只覆盖 actorId，不做此字段的布尔 Schema 验证。仍需管理员登录/保护与正确确认词，不是未授权接口。
- 离线复现：实际 createBrowserAdminService + 模拟 SQL 连接；其他输入不变，布尔 false→请求 CANCELLATION_REVIEW_REQUIRED，字符串 false→请求 RECHARGE_SUCCESS。见 probes/manual-closeout-2026-09-11.json。
- 影响条件：内部客户端发送字符串 false，且订单/run 满足人工核实前置态。当前 UI 未接此新动作，不能据此断言用户点击过或生产错单。
- 结论：输入类型错误不应抹掉续费核实待办。建议严格接受布尔值，非法类型拒绝，不做宽松真值转换。
- 置信度：服务控制流高；真实数据库/线上写入未测。

## F-45｜P1｜CHARGED 收口不读取订单产品，可能把 Pro 第一阶段当整单交付

- 观察：`browser-admin-service.js:203-219` lockRun 没有选择 order.plan_type/product；`:974-994` 只检查运行、付款、订单状态，不查目标套餐；`:1023-1034` 无条件写 PLUS_CONFIRMED；`:1068` 用续费是否取消决定整单成功，而不是确认最终套餐。
- 规则：D-133/D-141 与项目地图要求当前 Pro 路线先 Plus 再升级，最终套餐到账后才算交付；正式 `recordManual20xHandoff`（browser-execution-repository.js:1480 起）刻意保留订单 RECHARGE_PROCESSING 等最终升级。
- 影响条件：Pro 单第一阶段付款后失去确认，进入 HUMAN_REQUIRED/RECONCILE_ONLY 且 attempt 仍 SUBMITTING/SUBMIT_UNKNOWN，管理员用 CHARGED 记录“只确认 Plus 已扣款”并声明续费已关。新动作没有 Pro 分支，可跳过待升级直接请求整单成功。不带续费确认时进入 CANCELLATION_REVIEW_REQUIRED；后续 manual-cancellation-service 也只按该状态成功，不补查最终套餐。
- 验证级别：代码路径与 SQL 意图核对；探针确认该操作未查任何产品字段、写 PLUS_CONFIRMED 并请求订单成功。**没有在真实数据库构造 Pro 订单，所以不标记为数据库端到端复现。**
- 反证：若运营已人工确认最终 Pro 到账，并在自由文本正确注明，结果可能正确；缺口是合同没有要求/区分这个事实，而非断言每次 CHARGED 都错。现有未知收口集成夹具只使用一个产品 id，不能证明 Pro 边界。
- 建议：至少明确该动作仅服务 Plus，或按冻结产品要求确认最终套餐并保留 Pro 中间态。修改方向待用户确认。
- 置信度：代码缺少产品门槛高；实际业务触发待验证。

## F-46｜P2｜确认续费已关却没有写回用于展示的取消字段

- 观察：新动作 renewalCancelled=true 分支清 cancellation_review_required、写订单成功，却不更新 orders.subscription_cancelled/cancellation_checked_at，也不写 browser_runs.cancellation_confirmed_at；run.post_payment_state 仍 PLUS_CONFIRMED。
- 消费方：`admin-read-service.js:1354` 返回 subscriptionCancelled；`public/admin/assets/admin.js:1386` 据此显示“已取消/等待确认/未开始”，`:1357` 在 review=0 且 SUCCESS 时不提供“已在账号里取消续费”按钮。`manual-cancellation-service.js:44-49` 同样拒绝 SUCCESS+review=0 的非幂等补记。
- 离线探针：真值 true 的实际服务写语句中没有 subscription_cancelled 赋值。若旧字段为 0/NULL，会保留旧值；未执行真实 DB/UI。
- 结论：业务成功状态与续费事实投影可能不一致；与 F-44 输入误判是不同问题。自动取消路径也未同步 orders 字段，本轮不把它说成新动作独有回归。
- 建议：明确取消事实的权威字段并统一投影/写回，不用删除审计记录或伪造取消请求补齐。
- 置信度：源码与写语句高；已登录 UI 未测。

线上只读文件核对（本轮）：release cdcf42e 的第 573 行同为 Boolean 转换，第 1068 行同为续费布尔决定成功；订单 UPDATE 同样不写取消字段。这只证明生产文件包含逻辑，未调用生产接口。

## 校验

```sh
node docs/reviews/probes/manual-closeout-2026-09-11.mjs
```

实际服务、模拟每条 UPDATE 成功，仅证明控制流/SQL 意图；无网络、无真实凭证、无数据库。不是事务/锁/外键验收。11 项现有 browser-admin-service + manual-cancellation-service 单测全过、0 跳过；输出见 probes/manual-closeout-tests-2026-09-11.txt。

## 确认保留的边界

- 非管理员请求不在本发现范围；现有认证、确认词、付款状态前置检查应保留。
- PAYMENT_CONFIRMED 时 NOT_CHARGED 明确被拒，避免推翻已确认的扣款。
- 提交意图先持久化；UNKNOWN 进入核实而非第二次付款。当前 LIVE 恢复不因账号仍 free 自动判 DECLINED，上一批已更正。
- 不删除历史 PAYMENT_SUBMIT 来强迫退回 CDK。

## 未能核实的事项

真实数据库中 Pro 收口的最终效果、生产此动作是否曾被调用、真实取消接口、客户端实际发送类型和历史影响数量。没有用当前客户单验证。

## 与事实源冲突但无法判断谁对

旧处置称 F-16/F-3“已修”只覆盖后端路径的部分样本，不能说明上述产品/类型/字段边界已验收。方向上仍保留人工核实入口，不因此否定整个实现。

## 本次未覆盖范围

供给链完整审查、全部历史日志、后台全部页面、生产全量 schema/事务集成和多身份并发。这里只收敛人工收口审查，不声称全项目审查完成。
