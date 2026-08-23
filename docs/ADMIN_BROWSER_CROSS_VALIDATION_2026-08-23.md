# Plus 运营后台浏览器交叉验收（2026-08-23）

> 说明：文档前半保留首轮未登录边界证据；“第二轮”章节为本次已登录管理员浏览器验收的最新结论，优先级高于首轮的“无法验证”记录。

## 结论摘要

本轮使用 Playwright CLI 访问生产 `https://ops.vibebridge.top/admin`，浏览器实际到达 `/admin/login`。当前浏览器上下文没有管理员会话；本机可见的候选材料未通过登录，因此无法进入后台完成登录后的逐页视觉、交互和数据交叉验收。没有执行任何 CDK、开卡、充值、切换卡台、开关修改或其他生产写操作。

生产未登录边界符合预期：`/admin` 返回 `302 → /admin/login`；代表性后台只读接口均返回 `401`。登录页截图已保存为：

- [桌面登录页](../output/playwright/admin-login.png)
- [390×844 窄屏登录页](../output/playwright/admin-login-mobile.png)

## 浏览器与接口证据

| 检查项 | 结果 |
|---|---|
| URL / 页面标题 | `https://ops.vibebridge.top/admin/login` / `登录 · Plus 运营后台` |
| `/admin` 未登录 | `302`，跳转 `/admin/login` |
| `/admin/login` | `200` |
| `/api/v1/admin/overview` | `401` |
| `/api/v1/admin/orders` | `401` |
| `/api/v1/admin/cdks/batches?limit=20` | `401` |
| `/api/v1/admin/reconciliation-cases` | `401` |
| `/api/v1/admin/card-funding-attempts` | `401` |
| `/api/v1/admin/provider-routes` | `401` |
| `/api/v1/admin/browser/runs` | `401` |
| `/api/v1/admin/card-stock` | `401` |
| `/api/v1/admin/card-intake` | `401` |
| `/api/v1/admin/alerts` | `401` |
| 失败登录尝试 | `401`，仅创建/拒绝登录会话，不改业务数据 |

Playwright console 另外记录到两项：`/assets/favicon.svg` 返回 `404`；密码表单触发浏览器可访问性提示“Password forms should have (optionally hidden) username fields”。这两项不涉及业务数据，但应纳入前端收尾。

## 逐模块结果

“无法验证”表示未取得管理员会话，不能把代码/API 审计或未登录保护证据冒充为该页面已通过。

| 模块 | 结果 | 本轮具体证据 / 未验证范围 |
|---|---|---|
| 总览 | 无法验证 | `/api/v1/admin/overview` 为 `401`；未能核对四组指标的实际文字、数值口径、当前路线名称、账户余额/可分配卡、刷新和行动入口。 |
| 订单 | 无法验证 | `/api/v1/admin/orders` 为 `401`；未能实际输入查询码/CDK/邮箱、打开详情、检查状态事件/卡片/Provider/CDK 追溯、分页和筛选。 |
| 异常队列 | 无法验证 | `/api/v1/admin/reconciliation-cases` 与 `/api/v1/admin/alerts` 均为 `401`；未能检查筛选、分配/只读详情、告警文案和 CSV 导出按钮。 |
| 资金核对 | 无法验证 | `/api/v1/admin/card-funding-attempts` 为 `401`；未能核对 `PENDING/UNKNOWN/MANUAL_REVIEW/SETTLED/FAILED` 展示、金额字段、刷新和安全导出。 |
| 卡余额充值 | 无法验证 | 相关接口未登录不可读；未点击充值、重试、解决或任何写按钮。无法验证队列分页、状态筛选、按钮禁用和未知结果只对账路径。 |
| 卡台路线 | 无法验证 | `/api/v1/admin/provider-routes` 为 `401`；未能检查当前有效路线、账户标识、箭头/下拉位置及切换按钮是否只读/受保护。没有切换路线。 |
| Browser 执行 | 无法验证 | `/api/v1/admin/browser/runs` 为 `401`；未能检查 run/租约/检查点/付款状态/对账关系、详情折叠、刷新和人工接管入口。没有创建、冻结、接管或重试 run。 |
| 卡片库存 | 无法验证 | `/api/v1/admin/card-stock` 为 `401`；未能检查账户余额与卡片余额分离、可分配/开卡中/已分配/耗尽/隔离指标、同步时间、分页和导出。未执行同步或接管。 |
| CDK 管理 | 无法验证 | `/api/v1/admin/cdks/batches` 为 `401`；未能检查产品/状态/日期筛选、游标加载更多、下载/状态 CSV、订单追溯 CSV、批次分页及按钮可用性。没有生成、作废、下载敏感明文或修改 CDK。 |

## 已观察到的问题

### 问题（P1，前端收尾）

1. 登录页请求 `/assets/favicon.svg` 返回 `404`，浏览器 console 有对应错误。页面主体仍可用，但生产静态资源不完整。
2. 密码表单没有用户名字段，Chromium 给出可访问性提示。若系统确实是单密码后台，可加入隐藏用户名字段或明确采用无用户名密码表单的可访问实现，避免密码管理器/辅助技术误判。

### 无法验证而不应下结论的项目

- 各模块文字准确性、指标可理解性、下拉框/箭头位置、按钮启用/禁用状态；
- 刷新是否重置游标、分页/筛选/导出是否连续正确；
- CDK → 订单 → 邮箱/产品/卡片/Provider/交易/失败或退款案件的页面追溯链路；
- 卡台实际切换后的路线与账户余额联动；
- Browser 未知付款结果的只对账锁定路径。

## 必须修复 / 完成项

1. 提供一个已授权的只读管理员浏览器会话（或在受控环境完成一次登录），重新执行本报告列出的九个模块逐页验收；在此之前不能将后台 UI 标为最终通过。
2. 修复或补齐生产 `/assets/favicon.svg`（或移除错误引用），并重新做静态资源 smoke check。
3. 处理密码表单的无用户名可访问性提示，并在桌面/窄屏各复验一次。

## 可选优化项

- 为本轮验收增加专用只读审计账号/会话和过期时间，避免共享管理员密码；
- 在验收脚本中固定 1440×900 与 390×844 两个 viewport，对每个模块保存截图、关键接口状态和刷新前后游标；
- 对“总览→订单→CDK 追溯”建立一条只读 smoke flow，导出只验证下载响应头和白名单字段，不打开明文敏感导出；
- 登录页可补 `autocomplete="current-password"` 及隐藏 username 字段，减少浏览器提示并改善密码管理器体验。

## 运行边界与交接

- 当前生产 release（用户提供）：`/opt/pojia/releases/20260823-admin-trace-2-8002e5b`。
- 按用户指示，接单、派发、Provider 写入、开卡和充值均保持关闭；本轮没有生产资金动作。
- 下一可执行项：取得只读管理员会话后，按上述顺序逐页复验并补充成功/问题截图与接口响应；未验证事实不得凭代码审计推断为已通过。

---

## 第二轮：已登录管理员浏览器逐页只读验收（2026-08-23）

### 执行边界

本轮接管用户 Chrome 中已打开的 `https://ops.vibebridge.top/admin` 标签页，确认页面显示“管理员已登录 / 人工确认模式”。依次打开九个模块，执行了只读的导航、筛选、查询、刷新和导出检查；没有生成 CDK、作废 CDK、开卡、充值、切换路线、修改开关或修改任何生产数据。

### 总体接口结果

逐页浏览期间，后台接口均返回 HTTP 200，未观察到 401、403、500 或 `loadingFailed`：

| 模块 | 主要接口证据 |
|---|---|
| 总览 | `GET /api/v1/admin/overview` → 200；刷新后仍为 200 |
| 订单 | `GET /api/v1/admin/orders?page=1&pageSize=6`、`/orders/search` → 200 |
| 异常队列 | `GET /api/v1/admin/orders/search` → 200 |
| 资金核对 | `GET /api/v1/admin/reconciliation-cases?page=1&pageSize=50`，筛选带 `status=RESOLVED&severity=warning` → 200 |
| 卡余额充值 | `GET /api/v1/admin/card-funding-attempts?page=1&pageSize=20`，筛选带 `status=UNKNOWN` → 200 |
| 卡台路线 | `GET /api/v1/admin/provider-routes` → 200 |
| Browser 执行 | `GET /api/v1/admin/browser/runs?page=1&pageSize=50`，筛选带 `status=RECONCILE_ONLY` → 200 |
| 卡片库存 | `GET /api/v1/admin/card-stock`、`/card-stock/replenishment-settings`、`/card-intake?limit=100` → 200 |
| CDK 管理 | `GET /api/v1/admin/cdks/batches?limit=50`，筛选带 `planType=plus&status=REDEEMED` → 200 |
| CDK 批次汇总导出 | `GET /api/v1/admin/exports/cdk_batches.csv?limit=10000` → 200，`text/csv` |
| CDK 订单追溯导出 | `GET /api/v1/admin/exports/order_trace.csv?limit=10000` → 200，`text/csv` |
| 部署后的 favicon | `GET /admin/assets/favicon.svg` → 200，`image/svg+xml` |

### 九个模块结果

| 模块 | 结果 | 验收记录 |
|---|---|---|
| 总览 | 问题 | 页面分组、卡台账户余额与卡片余额区分、低库存提醒、刷新按钮和系统开关文案清楚；刷新接口 200。发现“成功订单 0”时“已完成订单成功率”显示 `0%`，而页面同时说明成功率不计未完成订单、当前没有成功订单，按既有口径更像应显示 `—` 或“无样本”。这是指标口径问题，未修改。截图：[总览](../output/playwright/admin-overview-auth.png)。 |
| 订单 | 问题 | 搜索框、状态/时间下拉、日期框、查询、刷新、导出订单 CSV、单页分页均可见；筛选 `充值失败` 和刷新均触发 200。打开失败订单详情后可见 CDK 批次、兑换时间、订单查询码、邮箱、ChatGPT 账号 ID、卡台卡片 ID/卡片交易、Provider/充值状态和多组时间线。发现详情同时显示时间线“充值提交被拒绝”，但“失败代码/失败原因”仍为“—”；另有“完整卡号”字段直接展示 `4361208115741666`，与后台其他位置强调脱敏/后四位展示的方向不一致。两项涉及数据/安全语义，未修改。截图：[订单列表](../output/playwright/admin-订单.png)、[订单详情](../output/playwright/admin-order-detail-trace.png)。 |
| 异常队列 | 通过 | 页面默认定位“需要关注的订单”，显示 1 条充值失败/三方对账异常订单；状态下拉、时间下拉、查询、刷新均可用，查询/刷新接口 200。当前仅 1 页，上一页/下一页按预期禁用。截图：[异常队列](../output/playwright/admin-异常队列.png)。 |
| 资金核对 | 通过 | 页面明确说明三方证据冲突、未知结果和“解决只保存核对结论，不自动重充/退款”；案例状态/严重程度下拉及筛选、刷新正常，筛选请求 200；当前 0 个案例，分页按钮按预期禁用。截图：[资金核对](../output/playwright/admin-资金证据核对.png)。 |
| 卡余额充值 | 通过 | 页面明确 `PENDING/UNKNOWN/人工复核` 不自动重试，UNKNOWN 只能人工记录已扣款/未扣款；状态筛选 `未知风险`、刷新均返回 200；当前 0 条记录，分页禁用。未点击任何解决、重试或充值按钮。截图：[卡余额充值](../output/playwright/admin-卡余额充值.png)。 |
| 卡台路线 | 通过 | 页面显示当前 `LEGACY_HNSKJ_ZZSHU_V1` 与备用 `CHATGPT_PLUS_BROWSER_V1`、卡台账户、读写状态、只读健康状态和“路线只影响新订单”的说明；刷新 200。仅检查“切换为当前”按钮存在，未点击。截图：[卡台路线](../output/playwright/admin-卡台路线.png)。 |
| Browser 执行 | 通过 | 页面明确 authority、Checkout URL、Session、卡片凭据和租约令牌不可见；运行状态/付款状态/控制权筛选可用，筛选 `RECONCILE_ONLY` 返回 200；当前 0 个 run，分页禁用。未创建、冻结、接管或重试 run。截图：[Browser 执行](../output/playwright/admin-Browser-执行.png)。 |
| 卡片库存 | 通过 | 等待只读规则加载完成后，显示可分配 0、已分配 1、耗尽 2、隔离 0、卡台余额 `$279.17`、active 卡 6、剩余开卡额度 294、规则/对账时间及“对账未完成，禁止新开卡”。开卡任务确认按钮处于禁用；未点击保存阈值、保存上限、同步接管、只读同步或开卡按钮。接口均 200。截图：[卡片库存](../output/playwright/admin-卡片库存-final.png)。 |
| CDK 管理 | 通过 | 产品/状态/日期筛选与刷新均正常；筛选 `Plus + 含已兑换` 返回 200，显示 3 个批次（每批 1 个、已兑换 1），没有更多批次可加载，因此本次没有出现“加载更多”控件。批次汇总 CSV 与订单追溯 CSV 均收到 HTTP 200 `text/csv` 响应；未点击生成、作废、原始 TXT 或逐码敏感导出。页面说明金额未补录时导出显示“未记录”。截图：[CDK 管理](../output/playwright/admin-CDK-管理.png)。 |

### 必须修复项

1. **总览成功率口径**：当前无成功订单时显示 `0%`，与“已完成订单成功率 / 不计未完成订单”的口径不完全一致；建议明确采用 `—`/“无样本”或补充分母说明。
2. **订单失败证据回填展示**：订单详情时间线显示提交被拒绝，但失败代码/失败原因为空；应确认历史 Provider 失败回退是否应在该详情位置展示。该项涉及业务证据，不在本轮自行修改。
3. **完整卡号展示**：订单详情直接展示完整卡号；应按后台敏感数据最小暴露原则复核并改为后四位或受控二次确认显示。该项涉及安全/数据边界，本轮未修改。

### 可选优化项

- 当列表只有一页时可以保留当前禁用分页状态；若未来批次超过一页，建议在 CDK 区域明确显示“加载更多/已加载 N/总数”，让连续加载结果更易判断。
- CDK 两个导出按钮在窄区域呈竖向布局，当前可用；可增加下载完成 toast 中的行数/筛选条件摘要。
- 总览“需要关注”“三方对账异常”已能点击进入订单筛选；可继续在卡片上展示当前筛选条件，减少交叉指标的理解成本。

### 第二轮交接结论

本轮九个模块均已取得已登录浏览器证据；7 个模块通过、2 个模块发现明确问题（总览指标口径、订单详情证据/敏感字段）。没有发现 401/403/500 或前端页面崩溃。问题均涉及业务证据或敏感数据展示，按要求未自行扩大修改范围。

## 报告问题复核与修复（2026-08-23）

- **成功率**：生产当前有 1 个已完成失败订单、0 个成功订单，因此 `0%` 按“已完成订单中成功比例”是事实正确值；已补充“已完成 N 单，不计未完成订单”说明，避免把 0% 误解为无样本。
- **失败证据**：已调整 Provider 调用查询，使 `zzshu/create_direct` 历史记录优先进入详情证据窗口；生产失败单现在显示 `PROVIDER_40030` 及历史推导原因。
- **完整卡号**：订单详情和卡片分配历史不再返回完整卡号，仅显示后四位；Provider/库存内部仍保留加密原始资料供受控服务使用。
- 新 release：`/opt/pojia/releases/20260823-admin-trace-fix-cf19fef`；Web/Worker active，live/ready 正常。
- 本地回归测试：408 tests，374 passed，0 failed，34 skipped。
