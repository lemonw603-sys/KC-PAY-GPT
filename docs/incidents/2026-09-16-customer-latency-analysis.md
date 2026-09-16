# Plus交付延迟：现场与代码核查

核查日期2026-09-16，所有下表时间为北京时间UTC+8。只读生产、已结束Browser页面元数据、本地夹具；未改业务、部署或再次付款。

## 结论

不是简单的“圆环动画慢一分钟”。有三层：阶段投影漏掉真实细分事件；后端确认链重复请求与补核；客户页轮询。第一次403的上游触发原因仍未知；第二单确认前进入UNKNOWN的原始异常也未记录，不把最终成功当根因已修复。

## 生产版本核对

current=/opt/pojia/releases/20260913-orderno-6dcb458。本机源码与生产文件SHA256一致：
- customer.js：e9f51ce68a7e0913f196ae4a54b3efc6d81875443dc76099104fe054cd4f03e1；服务器HTTP实际提供的/assets/customer.js也同hash。
- customer-stage.js：1898eb2543f3d91920cbcce26d677f59dd5e0a33ba14aa21ca694fd46126f2f1。
- browser-payment-verification-service.js：ecd8bc69570add29797e5a9d122677364edadc98a7604915954ffb4cc13b9e75。
- 本机Browser worker PID67720，前轮restart-source-sha256记录的源码。

## 本单时间线

|时间|原始事实|来源|
|---|---|---|
|19:06:44.485|订单创建|orders|
|19:07:24.568|身份匹配、FREE|browser_run_events|
|19:07:53.295|Checkout创建完成事件|browser_run_events|
|19:08:33.738|已到fill-billing-email|browser_run_events|
|19:08:49.351—49.452|submit-payment → human-verification-gate → observe-payment-outcome|browser_run_events（日志写入时刻，不冒充点击精确墙钟）|
|19:09:27.885|PAYMENT_UNKNOWN|browser_operations|
|19:09:34.024|paymentStatus UNKNOWN、submitClicked1、diagnostic null|browser_run_events|
|19:10:12.245|PLUS_ACTIVATION CONFIRMED实际记录插入|browser_post_payment_observations.created_at|
|19:10:14.161|CANCELLATION CONFIRMED实际记录插入|同上|
|19:10:16.866|窗口期同客户端最后一次/orders/status，HTTP200、89ms|Caddy访问日志；响应正文未记录|

从提交付款阶段到最终确认记录插入约85秒；不等同“Plus已实际开通后又等85秒”，因为外部Plus首次生效瞬间没有保存。客户主张“几秒内已Plus”不能靠现有日志独立核验。

**不能用finished_at误算**：orders.finished_at、run的plus/cancellation时间都是19:09:34.744，但两条观察记录实际19:10:12/14才插入。verification-service.js runOnce先取now，再await verifier.verify，随后一直使用旧now写结果。证实时间戳少记约37–39秒，不代表那时已经提交成功。下一轮性能验收必须修正。

## 一、圆环漏了执行进展

customer-stage-repository.js只读取action/created_at，没有summary_json.stage；customer-stage.js RUN_EVENT_STAGE也没有payment-stage。填卡/地址/邮箱/零税检查虽落库，客户投影不认。

生产事件喂给原resolveCustomerStage函数复演（stage-replay.json）：19:08:34已fill-billing-email，显示仍是“正在获取支付信息”，ceiling62、typicalMs78600；19:08:50付款提交后进入“正在提交支付”，典型段长58000。customer.js:curve按典型耗时模拟百分比，超时后渐近上限，并非完成任务比例。

修正方向：将已有细分事件正确映射到阶段（付款前填写不能冒充已付款），按实际阶段调整段起点/预算；不加新状态机、不为显快伪造成功。成功响应到达时文字立即切换，圆环只做700ms动画，不存在固定等满一分钟动画。

## 二、后端请求可做减法

chatgpt-post-payment-verifier.js confirmPlus先做历史诊断快照（2请求），再身份探测（2），再读套餐（2）；即使第一轮已经是Plus，也需6个串行HTTP请求。postPaymentSnapshot目前只赋值，src/test检索无消费方。

shared-live-composition.js outcomeObserver调用confirmPlus；payment-executor.js正常确认后再调用一次confirmPlus；confirmCancellation又重新核验、读套餐、取Session取消、读回确认。

本地真实函数+HTTP夹具结果（verifier-request-count.mjs/json，**不是本单真实网络计数**）：两个confirmPlus各6次，confirmCancellation8次，共20次；第一响应即Plus且取消立即成功，无等待轮次。这是可复现的结构性冗余，不能声称本单恰好20次或每次固定若干秒。

优化方向：删除无人使用的额外快照；一次已核对身份的账号快照同时用于当前步骤的Plus判断；正常路线将已确认结果向后传，避免紧接着再次全套核验。复用限同run/同页面/短时，不跨客户缓存、不绕过身份校验、不删除取消后独立读回。

另外watchPostSubmit最多60秒，但遇离开Checkout/明确报错会提前返回（post-submit-outcome-watch.js）。**不能说本单固定睡60秒**。页面观察与账户核验目前串行，可评估改成同一个有界观察循环，但不应直接砍等待窗口或引入无控制并发。

## 三、成功显示绑定最终收口

live-post-payment-recovery.js先confirmPlus→confirmCancellation→reconcile，整包返回后verification-service才写PAYMENT_CONFIRMED/PLUS_ACTIVATED/CANCELLATION_CONFIRMED。因此已知Plus时不立即投影给客户。

建议区分“账号已开通，正在关闭自动续费”和最终完成。只有本单身份+权威套餐确认后才显示已开通；订单仍保持处理中，取消/对账完成后再最终成功。不能先把RECHARGE_SUCCESS写了再补资金动作。需用户确认产品文案，不擅自弱化完成标准。

## 四、客户页轮询不是本次主要一分钟延迟

customer.js STATUS_VIEW：处理中3–5秒一轮，后台页面最低30秒，回前台300ms触发一次；失败请求静默延后6秒再排队。本次Caddy同创建请求客户端（remote_ip+UA在服务器内匹配，不输出个人标识）轮询约5.25秒，UNKNOWN后约3.25秒，绝大部分API服务耗时7–44ms；19:10:16最后一次89ms。无60秒查询间隔。

局限：POST日志不含订单号/响应正文，归属由唯一创建请求与同客户端时间线匹配，不能百分百断言最后响应内容或客户端绘制时刻。现场当前status接口已直接核实SUCCESS/stage9。

优化方向：付款后可改本系统状态轮询为1–2秒（不增加ChatGPT请求），减少几秒尾延迟，不宣称解决后端一分钟。不优先新增WebSocket/SSE。

## 建议顺序（均未实施）

1. 消除重复核验请求；补真实耗时与UNKNOWN异常原因，修复完成时间戳。保持付款和身份安全条件。
2. 让圆环读取已有真实子阶段，替换长时间盲爬。
3. 权威确认Plus后展示“已开通，收尾中”，最终收口标准不变；需确认文案。
4. 再将付款后客户状态轮询缩到1–2秒，仅优化剩余几秒。

验收用真实点击/首次权威Plus/取消确认/DB提交/客户状态响应分开计时；不拿回填旧now作结束时间，不拿动画更快作系统更快。当前只有一单详细现场，不承诺具体节省秒数。

## 证据索引

- 旧403：2026-09-16-h9RKl-browser-evidence.json、h9RKl-report.md。
- 本单结果：2026-09-16-x-tIs-success-evidence.tsv。
- 实际写入时间：2026-09-16-x-tIs-timing-evidence.tsv。
- 同客户端轮询：2026-09-16-x-tIs-customer-polling.json。
- 原阶段函数复演：2026-09-16-x-tIs-stage-replay.json。
- 请求冗余离线复现：2026-09-16-verifier-request-count.mjs/json。
