# Browser ChatGPT 单次非付款观察合同（2026-08-29）

## 1. 目的

把首次真实灰度前的 ChatGPT 页面观察收敛为一个只执行一次、默认关闭、没有付款能力的 harness。它只回答五个问题：

1. Session 是否建立了服务器认可的登录态；
2. 当前登录身份是否与订单中冻结的身份摘要全部一致；
3. 目标账号是否已经有活动付费订阅（Plus 或其他付费计划均停止）；
4. 免费账号是否存在唯一、非表单提交型的 Plus 购买入口；
5. 创建 Checkout 后，页面摘要、支付表单和安全字段是否符合只读合同。

本合同不包含填卡、最终提交、卡台读写、付款 permit、Plus 开通确认或取消续费。

## 2. 单次执行顺序

```text
fail-closed 配置检查
→ claim dispatch / begin browser_run / acquire leases
→ 通过 browser_run 读取共享密文 Session
→ 注入 Google Chrome 后立即释放 Session 短租约
→ GET /api/auth/session（身份全部匹配）
→ 同一页面内用 accessToken 调用 account check；token 不离开页面上下文
→ 已付费：ACCOUNT_ALREADY_PLUS，付款前安全退出
→ 免费：核对首页 pageContract
→ 打开价格页 / 唯一 Plus 入口 / 可选问卷
→ 识别 Checkout 摘要和安全字段
→ abortBeforePayment(NONPAYMENT_VERIFIED)
```

输出只允许：

```json
{
  "loggedIn": true,
  "identityMatched": true,
  "alreadyPlus": false,
  "plusEntryPresent": true,
  "checkoutRecognized": true,
  "fieldsWritten": 0,
  "submitCalls": 0
}
```

不得输出邮箱、account/user ID、Session、accessToken、Checkout Session ID、PAN/CVC 或完整外部响应。

## 3. 强制门禁

- `BROWSER_WORKER_MODE=PRODUCTION_READONLY`
- `BROWSER_READONLY_HARNESS=CHATGPT_ACCOUNT_CHECKOUT`
- `BROWSER_SHARED_MATERIALS_MODE=SHARED_ENCRYPTED_NONPAYMENT`
- 目标精确为 `https://chatgpt.com/`，不接受其他 origin、query、fragment 或 URL 凭据；
- Browser payment executor 必须 `false/MOCK`；
- `BROWSER_PAYMENT_WRITES_ENABLED`、`PROVIDER_WRITES_ENABLED`、`PROVIDER_CARD_WRITES_ENABLED`、`PROVIDER_RECHARGE_WRITES_ENABLED`、`CARD_FUNDING_WRITES_ENABLED` 必须逐字为 `false`；
- 必须使用外部共享材料只读确认词；
- harness 不创建 `SharedEncryptedCardMaterialSource`，因此真实观察不解密 PAN/CVC；
- 每次 Session/card material 读取前重新验证执行租约；租约丢失立即停止；
- 任一身份字段不一致、订阅状态不明、页面选择器不唯一、控件可能提交表单、页面漂移或 Checkout 摘要不全都 fail-closed。

## 4. 结果分类

| 结果 | 处理 |
| --- | --- |
| 免费账号且五项检查通过 | `NONPAYMENT_VERIFIED`，原子清理 attempt/funds，订单回 `CARD_READY` |
| Session HTTP 失败或身份任一字段不匹配 | `SESSION_INVALID`，原订单回 `WAITING_FOR_SESSION` |
| Plus/其他活动付费订阅 | `ACCOUNT_ALREADY_PLUS`，原订单回 `WAITING_FOR_SESSION` |
| 订阅响应未知、入口缺失/多义、页面漂移、Checkout 不完整 | 付款前安全失败，不允许继续到付款 |
| 任意 `PAYMENT_SUBMIT`/外部付款调用不为 0 | 不按只读成功处理，保持资金核对边界 |

## 5. 一次性外部输入

统筹窗口在真正执行前一次性提供或确认：

1. 专用非客户测试账号对应的隔离订单/共享 Session 密文记录；
2. 订单中可核对的 `chatgpt_account_id` 和/或客户邮箱（harness 只投影 SHA-256 摘要）；
3. 批准的网络出口与运行主机；
4. 系统 Google Chrome 可执行路径；
5. 当次观察得到并人工确认的首页 `title`、唯一 marker selector 和 marker text；
6. 明确的只读执行窗口。

不需要、不应提供 PAN/CVC。本阶段不读取卡资料，不部署生产服务，不访问真实客户账号。

## 6. 当前证据边界

本合同已由本地 HTTP/Google Chrome fixture 覆盖免费账号、活动 Plus、身份部分匹配、Plus 导航、Checkout 识别和零提交。`/backend-api/accounts/check/v4-2023-04-27` 仍是基于既有项目运行代码和历史观察的候选路径；执行真实只读窗口时必须以当次页面/响应为准，失败只记页面/接口漂移，不自动换接口或进入付款。
