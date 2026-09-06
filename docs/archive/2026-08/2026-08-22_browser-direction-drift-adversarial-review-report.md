# 进入真实非付款 BrowserContext 前的方向偏移对抗审查

日期：2026-08-22
目的：确认近期实现没有偏离已确认的 Browser 项目目标、最高账号安全原则和现有业务边界

## 总结判定

**未发现需要推翻路线的方向偏移；可以按已确认范围进入真实但不付款观察。**

本轮确认：我们仍在建设一个复用现有订单/卡片/资金 attempt/审计的 Browser 执行器，而不是另建 Provider、卡台或订单系统；当前仍未选定 champion，也没有把真实观察偷换成真实付款。

## 逐项审查

| 审查问题 | 结论 | 证据/约束 |
|---|---|---|
| 是否绕开现有订单和资金栅栏？ | 否 | Browser route 仍创建唯一 `recharge_attempts`；dispatch queue 只引用 attempt；未知结果仍进入对账。 |
| 是否把 Browser 伪装成 Provider API？ | 否 | Browser 不要求充值 Provider account，不写 `provider_calls.create_direct`；页面动作写 Browser run/operation/checkpoint。HNSKJ 卡片 Provider 仍保留自己的审计。 |
| 是否已过早选定某条赛道？ | 否 | 五条 lane 仍共享实验合同；Hosted 只是候选，尚未冻结 champion/fallback。 |
| 是否把非付款观察变成付款试验？ | 否 | 当前允许只读 Session/账号/页面/Checkout 观察；禁止卡片、付款 permit、提交、换卡、换 lane 和未知结果重试。 |
| 是否把“防封控”变成不可验证的伪装/指纹工程？ | 否 | 指纹浏览器仍只是本地 runtime 候选；不使用云 Profile、随机 Canvas、历史预热或伪造身份作为证据。 |
| 是否误把菲律宾执行出口当成目标账号地域？ | 否 | 继续区分非 PH Session 获取与 PH sticky 执行，要求出口、locale、timezone、账单和身份作为显式变量。 |
| 是否改变成功定义？ | 否 | 付款确认仍不等于成功；Plus 激活和取消确认才可进入 `RECHARGE_SUCCESS`。 |
| 是否为了推进而放宽未知结果保护？ | 否 | Worker lease 丢失、run 对账、页面漂移或付款未知均失败关闭，不自动重付。 |

## 观察阶段的最小范围

真实但不付款观察只能回答：

- 独立 BrowserContext 能否在固定网络租约下装载 Session；
- 服务器身份是否与预期账号一致；
- Free/Plus 状态、升级入口、订阅入口和页面签名是否真实；
- Checkout discovery 是否可达、产品/币种/金额/主体是否可读取；
- 页面 Context 与 hosted 分离 Context 的行为能否被统一证据 schema 记录。

观察阶段不得回答或声称：

- 真实付款成功率；
- 真实封控率；
- 每日几百单容量；
- 某个 runtime 已经是安全 champion；
- 可以自动绕过验证码、3DS、风控或限制。

## 进入前停止条件

- 没有用户当次确认；
- 真实输入未在仓库外 `0600` 隔离；
- 没有固定 profile/runtime/network manifest 和版本哈希；
- 无法独立验证服务器身份、实际出口和 sticky 会话；
- 页面动作可能触发 Checkout 创建或付款；
- 观察证据会保存完整 Session、hosted authority、卡片或其他敏感字段。

## 结论

本轮审查结论为“方向未偏移，观察范围可进入”。下一阶段只做真实但不付款观察；结束后必须再做一次 cohort 级对抗审查，未通过不得进入任何真实付款动作。
