# NON_PH_FUNCTIONAL 观察对抗式审查（2026-08-22）

## 审查对象

`artifacts/browser-poc/nonph-functional-2026-08-22T09-23-48-422Z.json`

## 通过项

1. **Session 服务器身份证据独立且稳定**：前后两次 `/api/auth/session` 均 HTTP 200，均存在 `user` 与 `accessToken`；前后字段集合一致。
2. **Cookie 家族已冻结**：使用 `__Secure-next-auth.session-token`，与此前同 Session A/B 差异一致。
3. **安全边界未越过**：无卡片、无 Checkout、无付款点击；非 GET 支付/订阅变更拦截数为 0，未创建新的资金工件。
4. **地域结论未越界**：manifest 明确为 `NON_PH_FUNCTIONAL`、无代理，报告没有把结果外推为菲律宾风控或生产成功率。
5. **敏感数据未进入 artifact**：只保存 opaque Session 引用、字段存在性和大小，不保存 Token/Cookie/邮箱/账号值。

## 阻塞项

1. **页面观察未完成**：首页导航 HTTP 403，标题为挑战页，`loggedInUi=false`。因此不能声称页面登录成功，也不能进入 Checkout discovery。
2. **网络限制未分类为账号失败**：403 只能记为当前网络/挑战事实；不能判定 Session 无效、账号被封或菲律宾风控。
3. **无法晋级付款或容量**：在页面挑战未解释前，禁止真实付款、champion 选择、跨路线重试和批量吞吐结论。

## 结论

审查通过“非付款 Session 服务器身份验证”这一窄目标；未通过“页面登录/Checkout 观察”目标。当前状态保持 `OBSERVATION_BLOCKED_PAGE_CHALLENGE`，下一次网络或菲律宾 cohort 必须新建 manifest，不覆盖本次结果。
