# BitBrowser 税额多样本核验（2026-09-05）

## 有效样本

- Profile `Plus Browser PH Lane 2`：注入测试 Session 后，`/api/auth/session` 现场复核 email/user/account 三项摘要均匹配；Checkout 显示 `PHP / ₱982.14 / Tax 0% / ₱0.00 / Due ₱982.14`。未付款。
- Profile `Plus Browser PH Lane 3`：关闭旧任务页、清理非 Cookie 站点状态并注入同一目标 Session；email/user/account 三项摘要全部匹配、订阅状态 `FREE`。新建 Checkout 初始为 `PHP / ₱982.14 + VAT ₱117.86 = ₱1,100.00`；填写卡片、US/DE 账单地址及瞬时 Session 邮箱后，服务端重新报价为 `PHP / ₱982.14 + Tax ₱0.00 = ₱982.14`。`submitCalls=0`，未付款。
- Profile `Plus Browser PH Pilot`：采用与 Lane 3 相同的干净任务生命周期和同一目标 Session；三项身份摘要全部匹配、订阅状态 `FREE`。独立新建 Checkout 同样从 `₱1,100.00（VAT 12%）` 重算为 `₱982.14（Tax 0%）`。`submitCalls=0`，未付款。

## 作废样本

- Profile `AI Recharge Browser Lane 4` 曾观察到新 Checkout 初始 12% VAT、填写 US/DE 地址后变为 0%。但随后对同一 Checkout 调用 `/api/auth/session` 复核，email/user/account 三项均与目标 Session 不匹配。该持久 Profile 同时存在旧账号页面；因此该样本不能用于证明“同一 Session 地址前后税额变化”，此前结论作废。

## 当前结论

现在有两个独立 Profile 的有效“含税→零税”前后对照样本，另有一个独立 Profile 的身份有效零税样本；共同支持以下可重复流程：干净任务页面 → 注入目标 Session → email/user/account 三重匹配 → 新建 Plus Checkout → 填卡 → 填 US/DE 账单地址与 Session 邮箱 → 等服务端重新报价 → 仅接受 PHP、税额 0、`total=subtotal+tax`。身份不匹配样本不得计入规律。

这证明的是当前页面与当前样本下流程可重复，不是上游对未来所有账号、卡 BIN、地区或税务规则的永久承诺。正式执行器必须逐单读取最终报价；任何非 PHP、非零税或金额关系不一致均停在付款前。

## 本轮代码收口

- Checkout 合同已启用 `PHP + zero tax + quote consistency`，并支持现场标签 `Monthly subscription`、`VAT (12%)` / `Tax (0%)`、`Due today` 和千分位金额。
- 执行顺序已改为：先做宽松结构观察，再在短卡资料租约内填卡 → 账单地址 → Session 邮箱 → 等待严格零税重新报价，最后清空卡字段；不点击提交。
- Session endpoint 初始返回空身份时只做有界稳定等待；一旦返回已填充但不匹配的身份仍立即失败关闭。
- 导航新增 `Rejoin Plus`，并对价格弹窗 React 尚未完成水合的无跳转点击做最多一次有界重试。
- BitBrowser Profile 清理旧页时保留一个空白页，避免关闭最后标签导致 Context 自行终止。
- 回归：Browser `132 total / 128 passed / 4 environment-skipped / 0 failed`；v1 `532 total / 486 passed / 46 environment-skipped / 0 failed`。
- 状态：提交 `04e08e6` 已作为 Browser-only 不可变 release `/opt/pojia/releases/20260905-browser-zero-tax-04e08e6` 发布；生产文件哈希逐项匹配，Browser `--check=READY`。Web/Worker 为 `active`、live/ready 正常；Browser Worker 仍 `inactive/disabled`，不得据此宣称已启用或已完成真实付款验收。直接回滚点为 `/opt/pojia/releases/20260905-session-errors-d24f6d6`。
