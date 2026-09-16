# 当前Browser剩余风险核查（2026-09-16 12:55 UTC）

范围：本轮只读代码/生产查询、脱敏本地夹具，无业务修改/停单/重启/付款。本次不是全面审计。

## 最高优先：早交付状态与Session恢复入口不兼容（确认的代码缺陷）

shared-encrypted-materials.js:104-114的assertPostPaymentContext只允许paymentConfirmed对应orders.RECHARGE_PROCESSING。D-240 recordPlusActivation已将Plus订单提前写为RECHARGE_SUCCESS，run仍CANCELLATION_PENDING。恢复路径live-post-payment-recovery.js:58-64先sessionProvider.open，才bootstrap和confirmPlus；因此已交付后收尾中断/重启/取消失败的下次自动补核会在Session读取入口报SESSION_INVALID。

单变量复现：reproduce-cleanup-session.mjs、reproduction.jsonl。相同合法加密Session、run/attempt等字段，只改order_status：PROCESSING可读，SUCCESS被拒。生产release与本机该文件SHA256均053a73edfaef5ce29730806ad5c4b41164b4082d90d1224d222d9c84a8407a34。

影响：不中断的正常收尾不受此门槛影响；补核路径失败后可能转人工并占住lane。不能从此推断已发生扣款/取消失败。12:54:59 UTC生产新版本订单0、active_runs0；当前无已知受影响新订单。

责任与测试边界：这是D-240实施漏掉的跨模块衔接。此前数据库测试只验证待收尾任务能重新被发现；恢复测试对Session provider使用替身，未覆盖真实材料源，因此“完整Session恢复已验证”不能成立。应优先修窄状态门控并补组合测试，不能只删除所有约束。修复/发布尚未执行。

## 旧凭证过期仍会挡住付款后恢复（代码+夹具已证）

同一source.load:219先对订单原始Session执行validateChatGptSession；session-validation.js默认要求accessToken剩余1800s。恢复在读取浏览器当前Cookie之前就可能被原凭证门槛拒绝，即使浏览器实际会话仍可能有效。夹具最初TTL3600s，过31分钟变成29分钟即SESSION_INVALID。没有新生产事故证据；适用于排队或延后恢复，应和上一项一起检验，不能放宽付款前准入作为替代。

## 备用卡对账不是独立卡台扣款证据（已确认能力缺口）

browser-card-transaction-reader.js:68-82对MANUAL_IMPORT只返回固定MANUAL_CARD_BROWSER_CONFIRMED标记、匹配相同run即matched。生产当前5371/1657均MANUAL_IMPORT、provider_code=manual_excel。故此路径的“对账完成”不代表查到卡台交易金额/商户/重复扣款。生产与本机文件SHA256同b73d485fd05437530167d81c6523206db47ca6db0931d022abe828d86d3661ee。此前已列入历史未验证清单，D-240并未补齐。

## 付款后异常诊断仍不足（代码已证）

browser-payment-verification-service.js:72-79捕获只留errorCode并生成hash；:133-135只传outcome/hash到recordPaymentVerificationObservation；后者只存evidenceHash。恢复失败的具体HTTP/阶段并未完整持久化。付款前diagnostic与付款段异常透传改造不能视为全链路故障均已可解释。生产该service与本机hash同29249297efb409d819b5db65a555997e4209cadb5b06063a1d72551b52327fd4。

## 运维/容量限制（不是新增故障）

production-live-pool-worker.js:254-269明确阻止有待收尾/人工run的lane接新客户；现场单lane、PID99137依赖本机Mac。一个收尾转人工可能挡住整条lane，关机/睡眠会影响接单执行。不可为提速绕过该门控；应把内部待办/可用lane状态可视化，并按后续项目计划验证恢复和多lane。

## 当前优先顺序

1. 先修早交付收尾恢复门控与旧Session读取问题，补真实source→恢复器→持久化链测试，再经确认发布。
2. 补付款后错误的脱敏结构化证据，避免恢复失败只剩hash。
3. 接独立卡台消费证据/核对账本差异，再谈放量。
4. 单lane人工占用与本机依赖作为运营约束管理。

403上游诱因、真实重试收益、真实交付提速仍未验证。不能宣称新版已跑真实单或整个系统无问题。
