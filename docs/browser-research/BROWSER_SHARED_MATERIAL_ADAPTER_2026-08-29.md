# Browser 共享 Session / 卡资料 Production Adapter（2026-08-29）

## 结论

Browser readonly Worker 已具备从共享核心读取当前订单 Session 和当前 attempt 已预留卡资料的正式
adapter。它没有建立第二套 Session/卡片存储，也不调用卡台 API：所有材料都从 v1 现有
`orders.session_ciphertext`、`cards.card_credentials_ciphertext` 读取，并复用
`SESSION_ENCRYPTION_KEY_BASE64` 的 AES-256-GCM secret-box。

本轮只验证**非付款观察**：Session 注入 BrowserContext 后立即释放内存租约；卡资料只在短租约
callback 内做一次格式/绑定预检，`fieldsWritten=0`、`submitCalls=0`，随后立即释放。没有把卡资料填入
页面，也没有 payment submitter。

## 实现链路

```text
claimed browser_dispatch_job
→ browser_run.id
→ opaque ref browser-run:<run_id>
→ 再核对 run/attempt/order/profile/route 的付款前状态
→ Session: orders.session_ciphertext → v1 secret-box → CookieSessionBootstrapAdapter
→ Card: cards.card_credentials_ciphertext
   + 同 attempt/order/card 的 RESERVED consumption ledger
   + route/provider 绑定
   → InMemoryCardMaterialLeaseProvider
→ Google Chrome 本地非付款页面观察
→ Session/card lease 立即释放
→ WAL 仅记录摘要
→ abortBeforePayment()
```

### Session adapter

- `SharedEncryptedSessionSource` 只接受 `browser-run:<run_id>`，不接受任意 order/card ID；
- SQL 通过 run→attempt→order→route 读取当前订单密文；
- 只接受 run=`RUNNING`、payment=`NOT_STARTED`、attempt=`PREPARED/ACTIVE`、order=`RECHARGE_PROCESSING`；
- run/attempt profile、order/attempt route、Browser executor 必须一致；
- 复用 `validateChatGptSession()` 校验 Session/AccessToken 有效性；
- 只把 session cookie 交给既有 `CookieSessionBootstrapAdapter`，不返回到 job/result/WAL；
- 注入 BrowserContext 后立即关闭 Session lease。

### card-material adapter

- `SharedEncryptedCardMaterialSource` 同样只接受 `browser-run:<run_id>`；
- 卡必须仍绑定当前订单和冻结 route/provider；
- 消费账本必须是当前 attempt/order/card 的 `RESERVED`；
- 只读取本地已同步密文，不调用 Provider 读/写 API；
- 当前 readonly lane 只在内存 callback 内确认四个字段完整，随后立即关闭租约；
- 不填卡、不创建 Checkout、不点击付款。

## 启动闸门

新增配置：

```text
BROWSER_SHARED_MATERIALS_MODE=DISABLED
```

默认关闭。只有显式改为 `SHARED_ENCRYPTED_NONPAYMENT` 才要求并读取
`SESSION_ENCRYPTION_KEY_BASE64`。外部只读页面还必须使用独立确认词：

```text
I-CONFIRM-EXTERNAL-READONLY-SHARED-MATERIALS-NO-PAYMENT
```

该模式不改变五个写开关、数据库 Browser payment gate 或 payment executor gate；它们仍全部关闭。

## 实际验证

```bash
npm --prefix browser-mvp run smoke:worker:readonly
```

- 配置/systemd：**9/9 passed**；
- 隔离 MySQL mock 状态机 + 正式 readonly CLI/Google Chrome：**3/3 passed**；
- 正式 CLI 实际解密 fixture Session/card，完成 cookie bootstrap、卡资料内存预检、页面观察、WAL、
  `abortBeforePayment()`；stdout/stderr/WAL 均未出现 fixture Session/PAN。

```bash
npm --prefix browser-mvp test
```

- **94 tests / 90 passed / 4 skipped / 0 failed**；
- 新覆盖包括：opaque run ref、短租约、run/profile/route/provider/ledger 漂移、损坏密文、Session 关闭、
  卡资料只读一次且不写页面。

```bash
BROWSER_DRY_RUN_ENV=isolated-fixture \
BROWSER_PAYMENT_WRITES_ENABLED=false \
PROVIDER_WRITES_ENABLED=false \
PROVIDER_CARD_WRITES_ENABLED=false \
PROVIDER_RECHARGE_WRITES_ENABLED=false \
CARD_FUNDING_WRITES_ENABLED=false \
npm --prefix browser-mvp run dry-run:shared
```

- 隔离 MySQL 8.4 + migration 001–040 + Chrome：**1/1 passed**。

## 已证明与未证明

已证明：

- v1 现有密文可以通过当前 Browser run 受控读取；
- Session/card 不进入 dispatch、run metadata、普通输出或 WAL；
- 材料读取不建立平行状态，不调用 Provider，不留下长期第二份副本；
- pre-payment 状态、profile、route、Provider、RESERVED ledger 漂移均 fail-closed；
- 完整隔离流程仍为零字段写入、零付款、safe-abort 后资金栅栏清除。

未证明：

- 未连接生产/预生产，未读取任何真实 Session/PAN/CVC；
- 未访问真实 ChatGPT、未验证真实 Session cookie 建立登录态和账号身份一致性；
- 未在服务器 Chrome/systemd/菲律宾 sticky 网络运行；
- 未把卡资料写入真实 Checkout；
- 未实现 LIVE payment adapter、Plus 激活/取消续费/卡交易真实对账；
- 未部署、未开启 dispatch/payment、未执行真实付款。

## 下一缺口

下一步是在保持付款关闭的前提下，用专用非客户测试账号和批准的网络做真实 ChatGPT
**只读登录/身份/页面观察**，冻结页面与 Session 合同。通过前不实现或启动真实付款。
