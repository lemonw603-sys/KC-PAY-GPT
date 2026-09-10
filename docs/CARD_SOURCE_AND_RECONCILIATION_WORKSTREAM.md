# 卡台来源切换与对账收敛｜工作线唯一状态表

> **状态（2026-09-09）：本工作线自 2026-09-06 起不再更新，进度与未完成项已并入 `PROJECT_MAP.md` §4/§5 与 `UNVERIFIED_LEDGER.md`；本文仅作历史证据。**

> 当前阶段：**D6 已完成后台/API、切换与完整快照验收；真实 Browser 订单未完成**
> 最后更新：2026-09-06  
> 本文件是本工作线的唯一状态入口。专项分析报告提供证据，但不能单独改变本表中的决策状态。

## 1. 使用规则

1. 任何新模型/窗口开始本工作线前，先读本文件，再读其链接的证据报告。
2. 聊天中的建议不自动成为需求；只有用户明确同意后，才从 `待确认` 改为 `已确认`。
3. 被推翻的方案进入“已否定”，禁止从旧报告或聊天中恢复。
4. 未达到“方案冻结”前，不进入业务代码实现或生产部署。
5. 实现时，每个已确认决策必须绑定代码、测试和验收证据；没有映射的需求不能宣称完成。
6. 任何偏离必须先更新本表、说明原因并重新取得确认，不能在实现中静默改变。
7. 部署后必须填入精确 commit、release、migration、运行配置和生产验证证据；否则状态只能是“代码完成”，不能写“已上线”。

## 2. 阶段闸门

| 阶段 | 状态 | 退出条件 |
|---|---|---|
| D0 事实核查 | 已完成基础核查 | 已核对现有后台、路线服务、建单/分卡、生产 route/account/migration 差异 |
| D1 方案讨论 | 已完成 | 用户已确认运营流程及对抗审查修正 |
| D2 方案冻结 | 已完成 | 用户于 2026-09-06 确认 `CARD_SOURCE_AND_RECONCILIATION_FROZEN_SPEC.md` D2-FINAL |
| D3 代码实现 | 已完成本地核心候选 | 卡源/快照/建单冻结/后台、付款未知协调器与路线化对账已实现；真实 verifier/生产调度仍属部署后联调边界 |
| D4 部署前对齐 | 已完成 | 已复核 release/服务/数据库/资金、047→048 前滚和回滚边界；发现混装后已实现单一 commit 归档与全量校验机制 |
| D5 生产部署 | 已完成 | 精确 release 已上线，服务/数据库/配置已核对，无未经确认资金动作 |
| D6 真实验收 | 进行中 | 页面/API、卡源切换和完整快照已通过；真实 Browser 订单、付款收敛与对账展示待验 |

## 3. 已确认决策（实施时不得漂移）

| ID | 决策 | 未来必须验证 |
|---|---|---|
| NAME-01 | 显示名称统一为 `API 充值`、`浏览器自动化充值` | 前端、接口展示、文档一致；内部枚举可保留 API/BROWSER |
| SRC-01 | API 充值首版固定使用当前 HNSKJ 卡台 | 无 API 备用卡不能进入 API 分配 |
| SRC-02 | HNSKJ 同时支持 API 充值与浏览器自动化充值 | Browser 选择 HNSKJ 时仍可使用其同步/开卡/补余额能力 |
| SRC-03 | 浏览器自动化充值可选择 HNSKJ 或未来多个备用卡台 | 每个来源独立归属、库存和统计，不混池展示 |
| SRC-04 | Browser 当前卡台由运营者直接指定；不做自动优先级、评分或自动回退 | 指定来源异常时不会静默换源 |
| SRC-05 | 健康、库存和能力只作提醒，不阻止运营者保存卡台选择 | 切换成功与“当前是否能执行”分开表达 |
| SRC-06 | 不提供日常逐订单手动选择卡台 | 客户提交后无需运营逐单干预 |
| SRC-07 | 充值方式与 Browser 卡源在建单事务中冻结 | 异步分卡不得重新读取全局当前卡台 |
| SRC-08 | 全局卡台切换默认只影响新订单 | 切换前已创建订单保持冻结来源 |
| SRC-09 | 切换时可选“一次性接管尚未真正开始的等待订单” | 只迁移无卡/无预留/无 attempt/run/UNKNOWN 的订单，显示数量并审计 |
| IMP-01 | 备用卡台每次导出的文件都是该来源全部卡片 | 导入按完整快照而不是增量追加处理 |
| UI-01 | 充值方式切换与卡台来源选择是两个概念，不得继续混在同一动作中 | 后台入口和文案能清楚区分两者 |
| PAY-01 | 一笔付款结果未知不得暂停其他订单、其他 Profile、整个卡台或营业 | 未决影响范围局限到相关订单/账号/卡/run |
| PAY-02 | 同一订单付款点击已发生且结果未收敛时，不自动再次点击 | 局部一次性提交互斥存在，其他订单继续 |

## 4. 已认可方向，但细节尚待冻结

| ID | 当前方向 | 尚需确定 |
|---|---|---|
| DETAIL-01 | 卡台管理页面保持简单 | 页面最终名称和最少展示字段在冻结稿确定 |
| DETAIL-02 | 自动付款核实采用有界观察 | 具体时间与轮询间隔由真实订单证据校准，不在讨论阶段拍值 |
| DETAIL-03 | 手工卡重新出现在完整快照后可重新评估 | 恢复状态名称与操作提示在实现规格中确定 |

## 5. 已否定方案（禁止恢复）

| ID | 已否定内容 | 原因 |
|---|---|---|
| NO-01 | API 与 Browser 各设计一套对称的可切换卡台 | API 首版固定 HNSKJ，只有 Browser 需要多源选择 |
| NO-02 | AUTO/PREFER/DISABLE、整数优先级和复杂评分 | 不符合运营者直接选择，增加无价值复杂度 |
| NO-03 | 卡台异常时自动回退其他来源 | 用户明确要求等待人工决定 |
| NO-04 | 健康/无卡/能力检查阻止保存切换 | 只能提醒，不能替运营者决定 |
| NO-05 | 在订单详情中日常逐单切换卡台 | 与自动履约时序冲突，不适合几百单规模 |
| NO-06 | 到异步分卡时才决定当前卡台 | 会让切换错误影响已经提交的旧订单 |
| NO-07 | 一笔付款 UNKNOWN 导致全链路、全卡台或营业停机 | 应局部核实和锁定，其他订单继续 |
| NO-08 | 直接沿用硬编码 ZZSHU 的“三方对账”判断 Browser | Browser 的权威证据不同，会产生误报 |

## 5.1 对抗式审查必须修正项

| ID | 问题 | 必须修正 |
|---|---|---|
| AR-01 | 导入器写死一个 `SOURCE_ACCOUNT_ID` | 导入批次必须明确归属卡台，并支持来源级解析适配器 |
| AR-02 | 本地分卡仍从所有 enabled 来源按 priority 自动选择 | 改为只从订单建单时冻结的来源分卡 |
| AR-03 | 完整快照把停用/过期/低余额卡当数据错误 | 业务不可用卡仍进入快照；结构/身份错误阻止整批提交 |
| AR-04 | PAN HMAC 非唯一，跨来源同卡可能双分配 | 全局实体卡冲突检查，不自动复制或搬家 |
| AR-05 | 快照提交与 Worker 分卡可能竞态 | 来源/卡行事务锁；不暂停全局，活动卡不被快照释放 |
| AR-06 | 新增卡资格硬编码 `$16`、更新卡读取动态设置 | 导入只记事实，资格统一由业务规则动态计算 |

证据：`docs/archive/2026-09/2026-09-06_card-source-operating-design-adversarial-review.md`。

## 6. 已核实的当前生产状态与剩余差距

- 生产 current：`/opt/pojia/releases/20260906-import-errors-c6e9f48`（commit `c6e9f48`）；827 文件全量 manifest 通过，migration 048 已部署。空/损坏快照已在生产实测为 `HTTP 400 manual_card_file_invalid`，不再误报 500。
- HNSKJ 和备用卡 A 的能力字段、Browser 当前来源 HNSKJ、历史订单冻结来源均已在生产数据库核对。
- 备用卡导入入口已上线；生产已用 2 卡完整快照验证预览、原子提交、分池统计与同文件幂等重放。
- Browser Worker 与付款保持关闭；当前 Browser 路线接新单，因此不能把“代码/结构已上线”误报为“Browser 可履约”。
- 旧自动开卡 timer 与总开关保持关闭；969 条历史任务未增长。新订单事件触发的自动开卡机制尚未另行实现/验收。
- HNSKJ 卡目录只读同步当前收到 `HTTP 403 maintenance`；按已冻结决策不自动回退，只提示并等待运营者处理。
- 路线化对账基础已上线，但真实 Browser 付款未知核实、账本归属和后台展示仍需 D6 订单证据。

证据：

- `docs/archive/2026-09/2026-09-06_card-source-current-system-audit.md`
- `docs/archive/2026-09/2026-09-06_card-source-discussion-error-review.md`
- `docs/archive/2026-09/2026-09-06_payment-unknown-scope-discussion.md`
- `docs/archive/2026-09/2026-09-06_three-way-reconciliation-audit.md`
- `docs/archive/2026-09/CARD_SOURCE_D4_PRODUCTION_ALIGNMENT_2026-09-06.md`
- `docs/archive/2026-09/CARD_SOURCE_D5_PRODUCTION_DEPLOYMENT_2026-09-06.md`

## 7. 实现追踪矩阵（D2 冻结后填写）

| 决策 ID | 数据库/migration | 后端 | 前端 | 自动测试 | 生产验证 | 状态 |
|---|---|---|---|---|---|---|
| NAME-01 | — | 已实现 | 已实现 | 已通过 | 生产页面已验证 | 已验收 |
| SRC-01～09 | 已实现 | 已实现 | 已实现 | 已通过 | 双向切换/不接管已验证，建单冻结待真实单 | 部分验收 |
| IMP-01～02 | 已实现 | 已实现 | 已实现 | 已通过 | 2 卡完整快照及幂等重放已验证 | 已验收 |
| UI-01～02 | — | 已实现 | 已实现 | 已通过 | 生产页面已验证 | 已验收 |
| PAY-01～03 | 已部署核实字段 | 已实现 | 待接入调度 | 定向通过 | 结构已验证，真实支付未验证 | 已部署待联调 |
| REC-01～02 | 复用现有账本/案例 | 基础已实现，路线化待收口 | 已实现 | 已通过 | 待验证 | 部分代码完成 |

## 8. D6 剩余验收项

- [x] 生产页面/API 与名称边界一致。
- [x] Browser 卡源双向切换成功，默认不接管旧订单，审计完整。
- [x] 备用卡完整快照原子提交与同文件幂等重放通过。
- [x] 备用卡与 HNSKJ 分池，低余额卡不进入 Plus 可分配集合。
- [ ] 用达到余额门槛的来源卡验证新 Browser 订单冻结正确卡源。
- [ ] 验证 Checkout、零税、付款结果核实、Plus 激活、取消续费和客户状态。
- [ ] 验证最终消费账本、卡源统计和路线化对账展示。

## 9. 下一动作

D6 已完成生产后台/API、Browser 卡源双向切换、不接管旧订单、备用卡完整快照和幂等重放验收，证据见 `CARD_SOURCE_D6_PRODUCTION_ACCEPTANCE_2026-09-06.md`。Browser LIVE P0 已发布为 `/opt/pojia/releases/20260906-browser-live-556ba97`；Browser `154/154/0/0` 隔离库回归和本机接生产库的 LIVE `--check=READY` 均完成，Browser Worker 与付款继续关闭。详见 `BROWSER_LIVE_P0_IMPLEMENTATION_2026-09-06.md`。HNSKJ 当前仍以维护 403 拒绝只读卡详情，数据库可见卡余额均低于 `$18`；下一动作是卡片充值后获取 HNSKJ 权威读证据或导入手工卡最新完整快照，再执行订单级付款关闭回归。通过后才提交真实 Browser 首单，并在最终 PHP 零税快照处单独确认付款。

### 2026-09-06｜备用卡台 A `$20` 订单级付款前证明

- 订单 `PJV1-AH6M688B3Wfv5_vxISmp` 已证明冻结并使用 `manual_excel/backup-a`，卡尾号 `5501`，生产余额 `$20`；没有调用 HNSKJ 卡资料接口。
- Session 身份/FREE、MockAddress DE、PHP、零税、金额一致和唯一提交按钮均在真实 Checkout 通过：`₱1100/税117.86` → `₱982.14/税0`。
- 本轮没有付款；修复 Stripe 地址 iframe/Checkout summary 漂移后需先部署复核，再进入唯一真实付款点。

### 2026-09-06｜备用卡 Browser 付款前修复已发布

`a9e65e3` 已完整发布并通过 844 文件 manifest、备份、服务健康和 LIVE check。目标订单仍冻结 `manual_excel/backup-a`，卡 `5501/$20`，无 Browser run/permit。真实付款确认后，手工卡以 Browser Plus 确认+共享账本收口，不调用 HNSKJ 对账。

### 2026-09-10｜备用卡台 A（highvcc.com 舜捷跨境）开卡脚本化

- 新增 `browser-mvp/scripts/highvcc-card.mjs`（`ranges | cost | list | detail | open | export`）：直接走 highvcc.com 自己的登录态 JSON 接口，不碰它的登录（密码+图形验证码，由人完成）；`export` 生成后台「导入备用卡」能直接吃的 xlsx。token 存本机 `~/Library/Application Support/AI充值业务/highvcc.env`（0600），`browser-mvp/scripts/save-highvcc-token.sh` 从剪贴板写入，全程不进对话/不进日志；token 过期（2 小时不活动）时任何命令直接报出修复命令，不会当成别的错误误判。
- 首次真实调用命中两个未曾核实过的真实 bug，已修复并补了针对性回归测试（`browser-mvp/test/highvcc-card.test.js`，9/9 通过；`browser-mvp` 全量 226/226 通过[9 个既有 skip]）：
  1. 算费/开卡接口线上实际吃 `application/x-www-form-urlencoded`，脚本原先发 JSON，服务端把整个 body 当空处理，报出无关的「支付钱包不能为空」——用真实登录会话抓包 `openCardCost` 的 XHR 才定位到，不是字段名问题。
  2. `--amount` 缺失/非法时原先会静默算成 `NaN` 分再发请求；现在开卡/算费前先校验，非正数直接拒绝。
- 默认卡段定为 `708`（513989，MasterCard）：这个账户 6 张卡里已有 4 张同卡段，2026-09-10 与 Lemon 确认过，`cost`/`open` 不传 `--vid` 时用它；可用 `HIGHVCC_DEFAULT_VID` 环境变量或 `--vid` 覆盖。
- 首张真实卡：`open --amount 50` 全流程验证——持卡人用卡台自己的 `autoCard` 生成器出名（未再编造姓名），账单地址复用项目既有免税地址源（`MockAddressBillingAddressSource`，本次 OR 州）。结果：卡尾号 `9839`，有效期 `09/28`，Jamie Winder，Portland OR 97202，充值 $50、总扣费 $50.50，扣自 highvcc USD 钱包（扣前 $80.38）。已导出 xlsx 发给 Lemon；**尚未导入生产 `cards` 表**——沿用既有流程由 Lemon 在后台「导入备用卡」手工上传，本次没有新建生产写路径去自动完成这一步。
- 平台自身有标准风控提示（"禁止恶意退款、拒付…违规者封号处理且禁止余额提现"），通用政策文案，非本次专属；记在这里供以后批量开卡时留意，不是本次异常。
- **Lemon 补充的平台规则（未在任何接口响应里出现，来自他的使用经验，按事实记录）**：账户有 $20 押金，算"可开卡余额"时要先扣掉这 $20，不是钱包显示余额直接可全部拿来开卡。09-10 09:xx UTC 钱包 $29.88 时开"十几美元"报"余额不足"正是因为 $29.88 − $20 押金不够那笔金额；同一余额下开 $5（费用 $5.50）成功。以后判断某个金额能不能开，要用"钱包余额 − $20"去对比，不能只看钱包余额本身。

### 2026-09-10｜备用卡台 A 一键开卡集成进后台（未部署，待发布确认）

- Lemon 确认"前期可以手动登录"（token 刷新仍是人工一步）并要求"导入自动化"+"整个开卡能力按钮集成到我们后台"。评估过把它并入 `card_stock_jobs`/`createJob`（首页"人工开卡"用的那一套）：那一套的前置条件（`readProviderSnapshot`/`readCardCatalogSnapshot` 新鲜度、无未核对活跃卡）是为 HNSKJ 这种限速、易漂移的卡台设计的，highvcc 是随时可查的同步接口，不需要也不该硬套；而且 `card_stock_jobs` 目前只有 `createJob` 侧，`claimCardStockJob` 从未被任何 worker 调用过（生产没有消费者），不是"沿用已跑通的东西"。因此新开一条独立、同步的路径，不touch 现有 `card_stock_jobs`。
- 新增 `v1/src/providers/highvcc-card.js`（纯函数 + 可注入 token 的 provider，独立于 `browser-mvp/scripts/highvcc-card.mjs`，两边各自维护，不跨包依赖运行时代码）、`v1/src/services/highvcc-card-service.js`（token 加密存取、`quote`、`openCard`）。地址生成复用 `browser-mvp/src/mockaddress-billing-address-source.js` 的 `MockAddressBillingAddressSource`/`MysqlBillingAddressAssignmentStore`（v1 首次跨包引用 browser-mvp 的 src 代码——判断是重新实现防碰撞逻辑的正确性风险大于跨包耦合，且复用的是同一张生产表 `browser_billing_address_assignments`，migration 047）。
- token 加密存 `app_settings`（复用 `sessionEncryptionKey`，不新增迁移），只经正式服务写入，从不进日志/对话；`app_settings.setting_value` 是 `VARCHAR(255)`，写入前显式校验密文长度，超限拒绝而不是截断。
- 开出的卡按与 `manual-card-import-service.js` 相同的字段写入 `cards`：`card_type_id='MANUAL_BACKUP'`、`provider_account_id` 复用现有备用卡台 A 的 `00000000-0000-4000-8000-000000000103`，与手工快照导入的卡同一个库存池；卡台返回余额是"分"，入库前换算成"元"（用本轮真实 $50 开卡样本核对过单位）；`sync_tier='MANUAL_IMPORT'`——本轮不建自动余额同步，后续要余额自动刷新是单独任务。
- 后台新增一节"备用卡台 A 一键开卡"（卡片页，`index.html`/`admin.js` v=38）：查费用→原生 confirm 弹窗二次确认→开卡，服务器仍校验字面确认词 `开卡 <vid> <amount>`（双重保险，不只信前端弹窗）；同页可更新 token。四条新路由：`GET .../status`、`POST .../token|quote|open`（quote 只需登录，token/open 走 `sensitiveAdminGuards`，同源校验测试覆盖了跨源伪造请求被拒）。
- 测试：`v1/test/highvcc-card-provider.test.js`（8 例，纯 provider）、`v1/test/highvcc-card-service.test.js`（8 例，含金额换算、重复卡拒绝、确认词校验）、`v1/test/app.test.js` 新增路由鉴权用例；v1 全量 580 个测试跑过（578 过 2 败，2 败是既有版本号断言过期的 F-40，与本次改动无关，改动前后失败数不变）。
- **未部署**：改动只到本地 commit；上线需要走 `deploy-release.sh prepare/switch`，与已排队的 F-5+F-34+F-35 一起，需要用户确认后再做。部署前 token 尚未配置，按钮会先看到"还没有配置 token"。
