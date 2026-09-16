# h9RKl：Session 单次 403 触发终态退单

核查：2026-09-16 10:46 UTC（北京时间 18:46）。只读生产与现有一号窗口；没有重新兑换、刷新页面、重新注入 Session、建 Checkout 或付款。

## 结论与边界

订单 `PJV1-h9RKlXHNoWfTO01S8aGT` 在 Session 接口一次 403 后，被代码按不可自动重试的付款前失败收口并退码。并非已证明账号失效或整个页面不可操作。当前同一号窗口调用正式身份核验函数，身份与该订单匹配、Session 和套餐接口均 200、套餐 FREE。**当时 403 的上游具体诱因未知；不能断言等几秒必恢复，也未验证后续 Checkout/付款。**

## 一、浏览器现场（真实，不是夹具）

文件 `2026-09-16-h9RKl-browser-evidence.json`：BitBrowser `/browser/list` 确认 seq=1 的 Profile 为 `10f0dc7b534844c083165796447d5893`（Plus Browser PH Pilot），与 supervisor lane-1 一致。通过该进程 BrowserCache/DevToolsActivePort 附着现有窗口，不调用 browser/open。

页面 timeOrigin=10:17:04.699Z，与本单 bootstrap 时间吻合；读取 Performance Resource Timing（不是完整 HAR）：

| 请求开始时间 UTC | path | responseStatus | duration |
|---|---|---|---|
|10:17:09.156|/backend-api/accounts/check/v4-2023-04-27|200|5429ms|
|10:17:11.366|/api/auth/session|403|912ms|

当前 DOM `authStatus=logged_in`、title=ChatGPT Plans，存在 Upgrade to Plus。不能据当前 DOM 推断过去每一刻的 DOM，但本页留下的当时接口记录直接证明两接口结果不同。

10:44:52Z 在同页以正式探测相同的 `fetch('/api/auth/session',{credentials:'include'})` 重读一次：200/application-json，hasUser=true、hasAccessToken=true、sessionError=null。未保存响应正文、token、邮箱、Cookie。

`2026-09-16-h9RKl-identity-verification.json`：10:46:12Z 再用 **原函数** `probeSessionIdentity` + 正式路径 + 生产订单身份摘要验证：verified=true、identityMatched=true、httpStatus=200、subscriptionHttpStatus=200、subscriptionStatus=FREE、sessionError=null。身份摘要口径同 `production-live-worker.js:128-140`，仅数据库内 SHA2 后在内存使用，不保存客户明文。

## 二、生产数据库与运行版本

`2026-09-16-h9RKl-production-evidence.tsv`：10:46:27Z 独立读取，订单 RECHARGE_FAILED/CHATGPT_ACCESS_BLOCKED，CDK AVAILABLE/order_id NULL；browser_operations 仅 PRE_PAYMENT_ABORT、BEGIN_RUN，无 PAYMENT_SUBMIT。事件顺序 observe-page → session-bootstrap → page-reload-after-inject → fail-closed。

只读重放查询：

```bash
browser-mvp/scripts/prod-query.sh "SELECT public_no,status,failure_code,finished_at FROM orders WHERE id='e606e3cd-6778-415a-8581-9705678f9611'; SELECT sequence_no,action,summary_json,created_at FROM browser_run_events WHERE browser_run_id='b454853c-6080-4b3f-9557-ad4beb1aa0bf' ORDER BY id; SELECT operation_type,status FROM browser_operations WHERE browser_run_id='b454853c-6080-4b3f-9557-ad4beb1aa0bf';"
```

生产 current=20260913-orderno-6dcb458，web/worker active。Browser 实际执行在本机 PID 47109，启动 10:09:27Z；身份探测文件最近提交 88710ed（09-12），本轮无修改；本地 executor/payment-executor 进入时已有在途修改，未覆盖、未代提交。仓库当前源码与当时进程内模块不能逐字内存比对；相应探测与分支行为由本单 WAL/DB/浏览器记录交叉支持。

## 三、代码如何导致退单

1. `session-identity-probe.js:74` 请求 `/api/auth/session`。
2. `:117-120` 仅在 **response.ok 且身份字段为空**时等候再读；403 不满足，马上 break。不是“403 已等15秒”。
3. `:121-132` 将符合条件的 403 或 429 抛为 CHATGPT_ACCESS_BLOCKED。
4. `executor.js:283-313` 虽传 stabilizationTimeoutMs=15000，但捕获后直接包装抛出，没有第二次身份核验。
5. `shared-runtime-integration.js:98-112` 明确把此类错误映射到 RECHARGE_FAILED（原意是防止无限重排整单）。
6. `v1/src/db/repositories/cdk-return-repository.js:55-109`：无资金/提交证据，失败后退回 AVAILABLE；生产 RETURNED 审计理由就是 Browser pre-payment abort: CHATGPT_ACCESS_BLOCKED。

离线调用当前真实函数，以“第一响应403，第二响应预备200”的假 page 验证，结果见 `2026-09-16-h9RKl-code-reproduction.json`：evaluateCalls=1、waitCalls=0、targetOrderStatus=RECHARGE_FAILED。**夹具只证明代码不复核，不证明线上第二次当时一定200。**

## 四、为什么此前日志说不清

探测错误已带 `details.httpStatus`（session-identity-probe.js:132），但 executor.js:313 包装后只有 cause；最终 :597-600 只写 failure.evidenceDetail，不遍历 cause.details。classifySafeAbort 的 diagnosticOf 也只拼 message（shared-runtime-integration.js:129-137）。所以 DB/WAL 只剩错误大类。浏览器尚保留 Resource Timing 才补齐历史 403。

## 五、建议处理（未实施，未发布）

- 给身份探测失败落库白名单结构字段：stage/httpStatus/contentType/hasCfRay，以及次数和耗时；不记录响应正文与凭据。
- 只在付款前、同一窗口同一订单内，对暂时访问失败提供有上限的只读复核（不重新注入、不重新建单、不重新创建 Checkout）；只有正式身份比对与套餐核验通过才继续。持久403/429/超时仍停止，身份不匹配不放行。不能把所有 CHATGPT_ACCESS_BLOCKED 一概回队列无限重试。
- 补边界测试：403→200、持续403、429、401、身份不匹配、核验期间租约丢失；验证没有触发付款。
- 本轮只读诊断已经定位退单机制；代码修复、worker 重启生效与真实充值需要分别验收。完整付款链路仍未验证。

## 交付核对

| 请求 | 证据 | 状态 |
|---|---|---|
|解释窗口能操作为何退单|同页真实403/200、DOM、生产事件、代码分支|已验证|
|当前身份是否能通过|正式probe+生产身份摘要|已验证，仅身份/套餐段|
|每项结论附证据|本报告+4份脱敏原始结果|已提供|
|修好并证明下一单全链路|未改业务、未充值|未实施，不能宣称完成|
