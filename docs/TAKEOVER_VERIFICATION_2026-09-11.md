# 接班理解与第一轮事实核对（不是全项目审查完成）

截至 2026-09-10 23:23 UTC，核对代码基线 `2b7250b`。本轮仅生产只读查询、健康请求、源码与已有日志阅读；没有启动 Browser、改变账号会话、重跑订单、改业务或部署。

## 我理解的项目：六问

1. **给谁做什么**：客户凭已购买的 CDK 和 Session 开通套餐；内部运营发码、处理订单、管理多卡台。目标是自动履约与可审计的人工兜底，不是另建一套支付系统。
2. **一单如何走**：服务端校验 Session 格式/期限并加密存储，锁 CDK 建单冻结产品/路线/卡源；服务器任务准备卡，本机 Browser 预检登录身份和结账可达性；预检 PASSED 且准备完成后服务器才可提交 Browser 派发；本机执行器填写、复核报价、申请许可、先落付款意图再单次提交；随后确认套餐、取消续费、核实账本或转人工。代码入口见下节。不是“客户提交时已在线验过 Session”。
3. **做到哪**：本轮验证了服务在线、当前卡住单与付款关闭状态，不代表全链自动化完成。历史演练/付款后半段的验收程度仍需逐项核对原始证据，不能直接沿用旧报告“已验收”。
4. **资金安全靠什么**：订单与卡源冻结、分配/账本互斥、数据库付款权限、单次 permit 与提交 operation、提交前意图持久化、未知转核实。已阅读关键代码，不等于重新完成并发/崩溃/真实付款验收。
5. **接下来顺序**：继续主链深读与原始证据核对，先区分已实现、已部署、实单已验；然后提交审查结果，获准后才修。Browser 当前窄问题是登录核对后导航没有到达目标；先审已有错误/网络证据，不能为了补证据继续反复点击当前客户账号。20X 新路线依 D-141，未验收前不替换现有路径。
6. **最大风险**：缺乏真实全链成功证明，却可能被健康检查/旧文档误报为就绪；当前有占卡未收口单；自动付款后的恢复/取消续费实证未齐。Sentinel 请求出现只能算相关观察，不能据此认定根因或随机拦截。

## 本轮原始证据与可重查入口

- `git status --short` 开始为空；HEAD `2b7250b`。最新专项交接晚于 HANDOFF_NOW，后者不能直接当现场。
- `ssh ... 'readlink -f /opt/pojia/current'` 返回 `20260910-highvcc-ui-feedback-cdcf42e`；systemctl：web/worker active、browser-worker inactive；服务器本机 health/live、health/ready 均 HTTP 200。
- `browser-mvp/scripts/prod-query.sh` 查询 Dqcnq：CARD_READY；预检 DEAD 5/5；SUBMIT_RECHARGE PENDING 0；卡 7402 $49 ASSIGNED；ACTIVE 分配 1；该订单 recharge_attempts 无行、browser_runs 经 attempt JOIN 为 0。
- 完整库存口径来自 `v1/src/services/card-inventory-eligibility.js`，用 `eligibleInventoryCardSql('c','16')` 构建只读 COUNT(*)，结果 0。不是只看余额或 inventory_status。
- 本机 `~/Library/Application Support/pojia-browser-live/pool/lane-4.wal` 共 120 条；最后该单记录 account-readonly-probe 的 loggedIn/identityMatched=true、submitCalls=0，随后 CHECKOUT_NAVIGATION_FAILED。未找到本轮可确认 Sentinel 响应体的原始证据，相关说法只按历史观察记录。
- 本机已知 Node Browser worker 入口进程匹配为空；本轮未创建 worker。

## 三处已查明的交接偏差

### 1. 自检把没有合格卡算成一张

`state-check.sh` 使用 GROUP_CONCAT 后 `awk -F, '{print ($0==""?0:NF)}'` 计数。SQL 空集返回字面量 NULL，不是空字符串；离线输入 `printf NULL` 得到 1。完整资格查询为 0。脚本还使用简化资格条件，不含正式口径的全部账本/覆盖项约束。

另一次复查暴露出脚本只做整行子串匹配：事实表备注含错误数字时也会“全绿”，已将备注改写避免匹配。只更新事实表，未修脚本；因此修正文档后 state-check 的库存行预计仍报漂移。不能为了全绿把事实改回错误的 1。

### 2. “人工核实后收口未部署”与服务器文件冲突

线上 release 的 `v1/src/services/browser-admin-service.js:974` 已有 RESOLVE_UNKNOWN_PAYMENT 分支，17/547 等行也有注册与校验。本地 `v1/public/admin/assets/admin.js` 检索该动作无匹配。结论仅为服务器代码已包含；未调用资金收口接口，不能说 UI 或端到端已验收。

### 3. 预检修复不能再全按旧待办重复实施

当前 `browser-mvp/src/browser-order-preflight.js:346-383` 已有租约失败退还次数、DEAD 发 BROWSER_HUMAN_REQUIRED；旧审查“完全没有告警”的结论版本已落后。仍需审重开入口及实用证据，本轮未触发告警或重开。

## 主链已定位代码

- `v1/src/services/order-intake-service.js`、`v1/src/domain/session-validation.js`：入口格式/期限校验和密文。
- `v1/src/db/repositories/order-intake-repository.js:156-240`：路线与建单任务。
- `v1/src/db/repositories/task-repository.js:64-91`：PASSED 预检、PREPARE 完成是领取门槛。
- `v1/src/workers/workflow-handlers.js`：服务端准备/派发责任（本轮非全文复审）。
- `browser-mvp/src/browser-order-preflight.js:309-383`：预检失败与 DEAD。
- `browser-mvp/src/production-live-pool-worker.js`：COOKIE 默认、EXTENSION 可选；核实→预检→派发的 lane 顺序。
- `browser-mvp/src/executor.js`：会话/身份、导航、paymentHandler 分界。
- `browser-mvp/src/chatgpt-checkout-navigator.js:454-474`：等结账或问卷状态，超时可有界再次尝试；错误名称不是根因。
- `browser-mvp/src/payment-executor.js:155-250`：permit→intent→submit→UNKNOWN/确认。
- `browser-mvp/src/chatgpt-post-payment-verifier.js:254-287`：Plus 判定与取消续费再核实。
- `v1/src/db/repositories/browser-execution-repository.js`：订单/卡/账本一致性守卫（本轮非全文复审）。

## 承诺核对与未覆盖

| 工作 | 结果 |
|---|---|
| 接班入口、近期提交、当前单、付款开关与进程现场核对 | 已完成本轮范围 |
| 六问项目理解 | 初稿，见上；非全部模块理解完成 |
| 全项目深读、决策逐条沿革、09-06 起完整日志 | 部分；大文件有输出截断，后续分段补读，不能声称全文已读 |
| 全面审查、全套测试、后台可用性与生产 schema 对齐 | 未完成；未运行测试 |
| 业务修改/真实账号诊断/付款/发布 | 未做；需后续明确批准相应动作 |

没有改审查员 REVIEW_RECORD 或执行者 DISPOSITIONS；本记录是接班核对，不取代正式分板块审查。
