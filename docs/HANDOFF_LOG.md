# 交接记录

## 2026-09-06｜D6 卡源切换与完整快照生产验收

- 真实后台页面发现三处误导：自动开卡关闭却显示开启、同步失败率 100% 却显示正常、空备用来源统计 1 张。提交 `c9f482e` 修复并发布 `/opt/pojia/releases/20260906-admin-alignment-c9f482e`；v1 `500/47/0`、Browser `128/4/0`，826 文件 manifest 通过。
- 生产实际执行 HNSKJ→备用 A→HNSKJ，均只影响新订单；2 个安全可接管 Browser 等待订单未迁移，API 等待订单未变化，两条审计事件落库。
- `/Users/lemon/Downloads/卡片列表.xls` 的 2 卡完整快照成功导入备用 A；同文件重放命中同一批次 `replay=true`。两卡资料均加密，余额 `$0`–`$2`，按 `$18` 门槛可分配数 0；HNSKJ 11 张未变化。
- 最终 Browser 卡源为 HNSKJ；资金/Browser 活动项均 0，旧自动开卡与 Browser Worker/付款继续关闭。D6 真实 Browser 订单尚未开始，证据见 `CARD_SOURCE_D6_PRODUCTION_ACCEPTANCE_2026-09-06.md`。

## 2026-09-06｜卡台来源 D5 已完成生产部署

- 从精确 commit `8012da8bf624a3b55390a03f8e89a83e9e0ba23c` 构建并上传全新 release `/opt/pojia/releases/20260906-card-sources-8012da8`；依赖安装前后全量 manifest 均为 `825/825 OK`，没有复制旧 release 或局部覆盖。
- 维护窗口中新建加密备份 `/var/backups/pojia/pojia-20260905T230819Z.sql.gz.enc`，完整性 `OK`；隔离恢复 `54` 张表成功。migration 048 应用成功，二次执行全部 `already applied`。
- `/opt/pojia/current` 已原子切换；Web/API Worker、只读同步、补余额/对账 timer、Bark 恢复，公网 plus/ops live/ready 均正常。
- Browser Worker、Browser 付款、旧自动开卡 timer 和自动开卡总开关继续关闭；未导入备用卡、未开卡、未补余额、未付款。历史 stock jobs 保持 `969`、活动 `0`，没有新增。
- 生产已验证 HNSKJ 可供 API/Browser、备用卡 A 仅供 Browser，Browser 当前来源仍为 HNSKJ，历史订单冻结来源无空值。
- HNSKJ 卡目录只读同步当前被上游 `HTTP 403 maintenance` 拒绝；未自动回退或写资金。D6 尚未开始，详见 `CARD_SOURCE_D5_PRODUCTION_DEPLOYMENT_2026-09-06.md`。

## 2026-09-05｜Checkout 入口漂移与持久 Session 残留修复

- 现场根因：ChatGPT 首页不再直接渲染旧 `aria-label=Upgrade`，必须先打开 `[data-testid="accounts-profile-button"]`；持久 BitBrowser Context 只 `addCookies()` 会留下上一单的 Session 分块。
- 已修复 `browser-mvp/src/chatgpt-checkout-navigator.js`：增加 Profile 菜单回退路径，选择最后一个实际可点击的可见控件；每次点击继续拒绝表单内控件，保持只读边界。
- 已修复 `browser-mvp/src/session-bootstrap.js`：注入当前 Session 前仅清理 `__Secure-next-auth.session-token` 及其分块，保留 Cloudflare/代理 Cookie；返回替换数量用于审计。
- 新增本地 fixture 覆盖 Profile→Upgrade→Checkout 和旧 cookie 清理；Browser 全量 `120 pass/4 skipped/0 fail`。
- Commit：`92fc70e`。未部署、未启动生产 Browser Worker、未读取客户 Session、未调用 Provider/卡台、未付款。下一步是部署前只读审查/发布候选，然后退还任务 68 因实现缺陷消耗的重试次数并重跑 `BROWSER_PREFLIGHT`。

## 2026-09-05｜只读修复候选已发布

- 已创建并切换 release `/opt/pojia/releases/20260905-browser-checkout-92fc70e`；切换前后备份校验均为 `OK`，`pojia-web`/`pojia-worker` active，`/health/live` 与 `/health/ready` 正常。
- 远程 `pojia-browser-worker` 继续 `disabled/inactive`，生产目标仍为 `LOCAL_FIXTURE`；本次发布不改变 API 路线、Provider/卡台写入或付款权限。
- 由于本机 BitBrowser 只读 Worker 需要受控 SSH 隧道，订单 68 的重跑尚未执行；不得把“已发布”误报为 Browser 订单已完成。下一步是启动本机只读 Worker，核对任务 68 的当前租约/重试预算后再运行前置观察。

## 2026-09-05｜发布后订单 68 只读重跑结果

- 本机通过 SSH 隧道启动 `production-readonly-worker.js --check`，返回 `READY`；随后运行一次订单 68 的只读任务。
- 本轮 Worker 以 `PAGE_CHECKPOINT_FAILED` fail-closed，未进入账号检查、Checkout、卡资料读取或任何付款步骤；WAL 原始记录在 `/tmp/bitbrowser-local-worker.wal.jsonl`，只包含 intent/freeze，不含 Session 明文。
- 该结果证明发布后的执行环境可启动，但页面检查仍有运行时漂移/配置不匹配待定位；不能把它归因于卡台，也不能宣称 Browser 链路已通过。不要在未核对任务预算和页面证据前再次消耗重试次数。
- 进一步代码/运行时对照定位：本机 env 将 `BROWSER_OBSERVE_MARKER_TEXT=x` 带入 ChatGPT 实际页面检查；真实首页没有这个固定文本，因此 `_checkPage()` 在进入账号探针前以 `PAGE_DRIFT` 失败，外层记录为 `PAGE_CHECKPOINT_FAILED`。BitBrowser CDP Context 的 `cookies/clearCookies/addCookies` 均存在，Session 清理改动不是触发点。应将真实 ChatGPT 只读 env 的 marker 置空（保留 `requiredSelector=body`），再在退还任务预算后重跑，不能直接继续消耗当前任务。

## 2026-09-05｜Profile 控件兼容修复与非消费诊断

- 真实 DOM 现场确认 Profile 入口为 `div[role=button][tabindex=0]`；已放宽安全导航校验，仅允许可访问按钮角色且仍禁止表单内控件。提交 `57e4fef`，Browser 回归 `120 pass/4 skipped/0 fail`，修复已同步到生产当前 release。
- 不领取订单的诊断已重新执行：本次在 BitBrowser `/browser/open` 阶段超时，底层为 `AbortError`；没有进入 Session 注入、账号检查、Checkout 或任何支付步骤。
- 因此当前剩余问题是 BitBrowser Local API/Profile 开窗稳定性，不能继续归因于卡台或业务闸门。订单 68 保持 `PENDING`，不再消耗其预算；下一步先做 Local API 单独健康/开窗生命周期诊断，确认稳定后再重跑订单。

## 2026-09-05｜BitBrowser 开窗超时根因与修复

- 独立调用 Local API 现场测得：`/browser/open` 冷启动耗时约 `10.9s` 并最终成功；原 adapter 默认超时 `10s`，因此错误包装为 `PAGE_CHECKPOINT_FAILED`。
- 已将 BitBrowser adapter API 超时提高到 `20s`，保留健康、Profile 白名单、CDP 和只读能力校验。定向回归 `14/14` 通过，提交 `ed89208`，修复已同步当前生产 release。
- `/browser/close` 现场返回成功；未领取订单、未注入 Session、未进入 Checkout、未 Provider/卡台写入、未付款。订单 68 仍保持 `PENDING`，下一步才可在确认预算后重跑。

## 2026-09-05｜修复后订单前置复跑与 Session 身份冲突

- 在 `ed89208` 开窗超时修复后，订单 68 重新执行已越过 BitBrowser 开窗、Session 注入、页面检查和账号接口；WAL 记录 `session-bootstrap`、`account-readonly-probe` 前的身份校验分支。
- 本次真实失败原因为 `SESSION_IDENTITY_MISMATCH`，不是卡台、Checkout 导航或付款闸门；执行器已安全停止，未创建充值 attempt、未读取卡资料、未 Provider/卡台写入、未付款。
- 这表明订单中保存的客户身份摘要与所提交 Session 实际账号不一致（具体值不落日志）。订单保持 `PENDING`，剩余任务预算不得自动重试；需客户在原订单提交匹配该订单的 Session 后，按既定 Session 修复流程重新验证。

## 2026-09-05｜BitBrowser 任务级页面隔离修复

- 现场确认 Profile 继承页面可能造成旧账号内存状态竞争；已在 BitBrowser adapter 接管 CDP Context 后关闭全部遗留页面，再由执行器创建本任务唯一页面。
- 仅影响页面生命周期，不清理 Profile 指纹、代理或非 Session Cookie；安全导航、Session 替换和付款前只读边界保持不变。
- 定向回归 `11/11` 通过，提交 `87121fe`，修复已同步生产当前 release，`/health/ready=ready`。尚未重跑订单 68。

## 2026-09-05｜页面隔离修复后订单 68 最终前置结果

- 订单 68 在修复后实际重跑，BitBrowser 开窗、页面隔离和只读流程均能启动；本轮权威结果为 `CUSTOMER_ACTION_REQUIRED / SESSION_INVALID`。
- 数据库已落为：任务 `COMPLETED`（`last_error_code=SESSION_INVALID`），订单 `WAITING_FOR_SESSION`、`customer_action_code=SESSION_INVALID`。这不是卡台或资金闸门阻断，而是当前订单保存的 Session 在 ChatGPT Session 接口不可用/已失效。
- 全程无充值 attempt、无卡资料读取、无 Provider/卡台写入、无付款。后续需客户重新提交可用且与订单身份匹配的 Session，再走现有 Session 修复流程；不应继续重试这条旧 Session。

## 2026-09-05｜Session 失败诊断证据增强

- 用户确认提交的 Session 无误；已修正机制，不再只保存笼统 `SESSION_INVALID`。Session 探针现在记录受限诊断元数据：失败阶段、HTTP 状态、Content-Type/Server 截断值和 Cloudflare 标记；绝不记录响应正文、Token、Cookie 或邮箱明文。
- Browser preflight 在转入 `WAITING_FOR_SESSION` 时把该诊断摘要写入 `order_events.metadata_json`，保留订单已有加密 Session 原件，便于区分真实失效、身份不匹配、Cloudflare 和上游错误。
- 现场发现执行器在 Session bootstrap 捕获处把具体本地校验码重新覆盖为 `SESSION_INVALID`，导致新订单第二次提交后诊断仍不精确；已修复为保留 `SESSION_EXPIRED`、`INVALID_ACCESS_TOKEN` 等具体码，代码提交 `f96389c`，并同步生产。
- 定向 Session 测试通过；代码提交 `a4c9084`，修复已同步生产当前 release，`/health/ready=ready`。尚未重跑新订单，避免重复消耗任务。

## 2026-09-05｜本地 Session 校验错误分类落地

- 已将订单侧本地 Session 材料错误从笼统 `SESSION_INVALID` 拆为 `SESSION_MATERIAL_INVALID` 及具体校验码（`INCOMPLETE_SESSION`、`SESSION_EXPIRED`、`INVALID_SESSION_TOKEN`、`ACCESS_TOKEN_EXPIRED` 等）；远端接口拒绝仍由探针单独记录 HTTP 诊断。
- Browser preflight 仍统一引导客户更换 Session，但内部事件保留 `stage=causeCode`，不写入明文 Session/Token。
- Browser 全量回归 `121 pass/4 skipped/0 fail`；提交 `28381d3`，修复已同步生产，`/health/ready=ready`。
- 本轮用户要求“先查清再要求重提”后，已现场完成本地/生产代码哈希对齐、Browser `125` 测试 `121/0`、v1 `532` 测试 `486/0`、生产服务/健康检查和当前订单任务状态核对；没有再要求用户重复提交。当前订单仍是 `WAITING_FOR_SESSION`，需等下一次用户提交后才能产生新一轮运行时证据。

## 2026-09-05｜完整只读导航诊断的间歇性身份结果

- 现场在同一订单/同一 Profile 上先后得到两种结果：一次 Session 与订单 email/account 摘要哈希完全匹配，另一次执行器返回 `SESSION_IDENTITY_MISMATCH`。因此不能把单次失败直接定性为客户 Session 错误。
- 当前更可信的根因是持久 BitBrowser Profile 的会话状态在不同开窗之间不稳定（可能存在旧页面/旧账号状态竞争）；业务订单和卡台均未参与该失败。
- 本轮完整导航尚未通过；订单保持 `PENDING`，不再继续消耗任务预算。下一步应为 Browser Profile 增加“单实例、开窗前关闭旧页面、注入后新页确认”的隔离诊断/修复，完成后再重跑。

## 2026-09-04｜补款失败恢复、陈旧卡抢跑修复与生产运行证据

- 代码提交 `0e5a82d`：补款失败固化 `AUTO_RETRY/DO_NOT_RETRY/MANUAL_REVIEW`，仅 `FAILED+CLEARED+AUTO_RETRY` 有界自动恢复，订单+卡最多 3 个 attempt，UNKNOWN 不重试。
- 本地全量 526/0 fail；全新 MySQL 8.4.11 + migration 001–045 为 42 total / 41 pass / 1 intentional skip / 0 fail。
- 生产备份 `/var/backups/pojia/pojia-20260904T124226Z.sql.gz.enc` 完整性通过；先发布 `20260904-funding-recovery-0e5a82d`。
- 发布前 12:38–12:41 UTC，系统在卡台余额 `$34.83` 时自动开卡 `2833/5980/$16`，分配给 `PJV1-tw-hliEBgnOfdEVsxn5r`并创建 API 外部订单 9440；Provider 明确失败“验证策略失败，请稍后重试”，无 PURCHASE，卡保留 `$16`并安全释放为 AVAILABLE。
- 根因是 9051 证据陈旧时被 `fundable` 查询排除，stock scheduler 在只读同步完成前就抢跑开卡。提交 `4bf84f9` 增加 `refreshable` 防线；有可刷新旧卡时先等同步，不允许付费开卡。
- 最终生产 release `/opt/pojia/releases/20260904-funding-recovery-race-4bf84f9`；Web/Worker/补给 timer active，`/health/ready=ready`。旧测试订单已终态，不重试。当前可分配 Plus 卡为 5980/$16；补款成功到账留待下一次自然低余额场景验收。

## 2026-09-03｜客户充值页改版 v2 落地（待部署）

- 用户确认预览定稿后落地：去二次确认（邮箱就地核对、一步建单）、6 步真实横向进度条（合并「准备/就绪」）+ 百分比 easeOutCubic 平滑动画、3 步骤条图标化、祖母绿+香槟金配色升级、等待文案对齐 1 分钟目标。
- 改动为纯展示层 + 一处后端映射（`order-status-service` `CUSTOMER_STATUS` 合并 `CARD_READY→PREPARING`，7 步收 6 步）；未改客户 API 语义、订单状态机、资金/付款/对账、任何 migration；核心不变量（邮箱建单前可见/点击才建单 1 次/Session 清空/客户不见内部态）保留。
- 验证：后端 6 步映射测试通过；`v1` 全量 516/472 通过、1 失败（admin 后台 `admin.js?v=21` vs 测试 `v=20`，**预存漂移、本次未动 admin、git 确认**）、43 跳过；本地预览桌面 1440px + 移动 375px 渲染核对通过（横向进度条 75%/6 节点、金徽章、邮箱就地核对、移动端 stepper 无溢出）。
- 详见 `docs/2026-09-03_customer-page-redesign-v2-implementation.md`；预览定稿 Artifact 用户已确认。
- **夜间配色已部署（2026-09-03，release `eba5331`）**：客户反馈深色态"两个颜色太相近、卡片浮不出"，经确认指的是**卡片与页面背景太接近**（非绿金）。改 `v1/public/assets/customer.css` 深色 token（背景 `#0a0e0c→#070a08`、光晕 `#121a16→#0e1712`、卡片 `#121814→#18211c`、`--surface-2/3` 同步抬升、`--line/--line-strong` 提亮）+ `.card` 深色态加顶部 `inset` 微光边与 `--line-strong` 边框；`index.html` bump `customer.css?v=10→v=11`。commit `eba5331`（精确 add 两文件，未碰 Codex 的 `DECISIONS.md`）。本地 Mac scp 两文件 → 复制当前 release 副本为 `/opt/pojia/releases/20260903-dark-surface-eba5331`（切换前 `grep` 校验 `#18211c`+`?v=11` 通过）→ 原子切 `current` → restart `pojia-web`（active）。公网复验：`customer.css?v=11` HTTP200/含新 token、`index.html` 引用 `?v=11`、`/health/ready`=ready。回滚点 `/opt/pojia/releases/20260903-customer-redesign-3cef082`（`ln -sfn <旧> current && systemctl restart pojia-web`）。仅深色、白天零改动；绿金强调色一度试改后按用户澄清已还原。
- **已部署（2026-09-03）**：用户确认后从本地 Mac scp 4 个改动文件到生产、复制当前 release 新建 `20260901…7bad460` 的副本为 `/opt/pojia/releases/20260903-customer-redesign-3cef082`、覆盖 4 文件、原子切 `current`、`systemctl restart pojia-web`。复验：`/health/ready`=`{"status":"ready"}`、`pojia-web`=active、current 已指向新 release。回滚点保留旧 release `…browser-access-block-7bad460`（`ln -sfn <旧> current && restart`）。生产非 git 部署（release 目录 + 符号链接）。**2026-09-03 已补客户页真实渲染现场验证**：公网 curl 核实生产 serve 新版 `customer.css`/`customer.js`（含 `--brand:#0b7d5a`/`PROGRESS_PCT`/`animateProgress`）、`index.html` 引用 `?v=10`、CSP 同源放行；重建自包含预览走真实前端渲染路径目视确认深色 / 浅色输入页 + 跟踪进度（PAYING 55%/第 3-6 步/6 节点递进）三态正确。Browser pane 首屏"裸奔"系内置浏览器对 `customer.js` 文件名的 `ERR_BLOCKED_BY_CLIENT` 客户端拦截假阳性、非生产问题（服务器 200 + 正确 content-type 已 curl 证明）。

## 2026-08-31｜正式订单付款前暂停测试窗口

- 用户要求：接下来一单只推进到 API 充值提交前，禁止实际客户充值付款。
- 已临时停用 API Worker 的 `PROVIDER_RECHARGE_WRITES_ENABLED` drop-in，并重启 Worker；当前生效值为 `false`。通用 Provider 写、卡片写和 Browser 付款仍为关闭。
- 该暂停只用于本次测试窗口，不改变默认路线或长期运营决策；测试结束后必须恢复之前的最小 API 充值权限并重新核对 readiness。
- 截止记录时生产没有活动订单、活动任务或充值 attempt；没有创建订单、Provider 调用或资金写入。
- 订单提交后允许正常走卡片/Session 准备，但在 API `create_direct` 最终提交前停止；需以数据库状态和 `provider_calls` 证据确认，不能仅凭页面文案判断。
- 实际订单 `PJV1-0RcrjBEOL6senGnzqW7e` 已创建并完成卡片/Session 准备；当前状态 `CARD_READY`，卡片尾号 `1013`（Provider card `1839`）已分配，`SUBMIT_RECHARGE` 仍为 `PENDING`，尚未创建 `recharge_attempts`，对应 `provider_calls` 为 0。未发生客户充值付款。

## 2026-08-31｜全栈对抗核查候选已部署并开启最小 API 充值权限

- 用户确认部署，并确认默认 API 路线长期拥有最小真实充值执行权限。
- 生产已从 `/opt/pojia/releases/20260831-order-funding-c185d19` 原子切换到 `/opt/pojia/releases/20260831-map-audit-d5fb3cf`；migration 044 已执行。
- Worker 生效权限为：`PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`、`PROVIDER_RECHARGE_WRITES_ENABLED=true`；Browser Worker 仍 inactive/disabled。
- 部署前数据库备份 `/var/backups/pojia/pojia-20260831T031529Z.sql.gz.enc` 完整性通过；unit/current 备份位于 `/var/backups/pojia/map-audit-deploy-20260831T031527Z`。
- 部署后只读 readiness：`ok=true`、`apiRechargeExecutionEnabled=true`、`blockers=[]`；ops/plus live/ready 四项 HTTP 200；`pojia-ops check` 通过。
- `pojia-ops check` 的职责仍是服务状态与备份完整性；业务执行能力以应用只读 readiness 为准。替换 Worker unit 时 systemd 记录过一次预期提示，新进程启动后无 warning/error。
- 连续 3 个库存 timer 空闲周期均为 `NO_DEMAND/providerRulesSynced=false`；陈旧等待卡/低库存提醒已关闭，余额变化 info 仍保留但不占后台提醒。
- 本次部署未创建订单，未触发开卡、补余额、Provider 调用、API 充值或 Browser 付款。下一主线为首笔真实订单驱动自动补余额验收，再进入 3–5 单连续 API 运营验证；Browser 非付款线继续并行。
- 本轮未取得管理员登录态浏览器控制通道，后台登录后的视觉、按钮、Network/Console 复验仍待补，不得写成已完成。

## 2026-08-29｜卡段人工刷新部署

- 提交 `58dfe0d` 已部署至 `/opt/pojia/releases/20260829-card-segment-58dfe0d`，并切换 `/opt/pojia/current`。
- 部署后 `pojia-web.service`、`pojia-worker.service`、卡片只读同步/目录同步定时器均 active；健康检查正常。
- 本次未执行开卡、卡余额充值、付款、退款或提现；资金写入门禁保持关闭。
- 待管理员会话下验证刷新按钮和默认卡段持久化。

## 2026-08-29｜“开始营业”入口延期

- 用户决定暂不继续优化或部署“开始营业”快捷入口。
- 生产继续使用现有接单/派发分离开关；该入口代码保留在主线但不代表已上线。
- 需要后续补偿性回滚/部分成功测试后，才能重新评估生产启用。

## 2026-08-29｜指定卡余额充值入口延期

- 已确认当前后台“卡余额充值”页仅提供历史尝试查看与未知结果人工核对，没有指定卡发起充值的管理入口。
- 用户决定后期再做；当前不新增该入口，Provider 写入保持关闭。

## 2026-08-26｜Browser 上游合同纠偏与冻结

- 用户确认优先级：先保证充值链路跑通、顺畅、稳定，再保证资金安全；敏感信息不做导致系统复杂化的过度保护。Browser 执行时可使用必要的卡资料和 Session，普通日志/WAL/截图/录像/客户页面仍不记录原文。
- 代码交叉核验发现 Browser PoC 投影的 `order=CARD_READY/RECONCILIATION_REQUIRED`、`attempt=PENDING/OBSERVING`、card `AVAILABLE` 与共享核心正式状态不一致。共享核心实际在 `CARD_READY` 后原子创建唯一 `recharge_attempt`，把订单推进为 `SUBMITTING`；Browser dispatch 只接受 `attempt=PREPARED`、`funds=ACTIVE`、`executor=BROWSER`，Worker claim 后创建活动 `browser_run`。
- 用户随后确认进一步纠偏：保留“Browser 开始前建立唯一 attempt 并锁定订单/卡片”，但不把尚未付款的阶段提前命名为 `SUBMITTING`。目标合同改为订单 `RECHARGE_PROCESSING` 表示 Browser 正在处理，真正付款提交由 `browser_run.payment_state=PAYMENT_SUBMITTING` 表达。
- 已修正合同 `docs/contracts/2026-08-26_browser-upstream-runtime-contract.md` 和 D-090，并更新 CURRENT_STATE。合同明确 `RECONCILIATION_REQUIRED` 只核对不重付，`browser_run_id` 是正式运行审计锚点，不另造平行 `audit_ref`。
- 本轮只修改文档事实源，未修改 Browser/non-Browser 业务代码、迁移、数据库或生产；未调用卡台写接口、未执行付款。
- 下一步：先修改共享核心 Browser 路线的状态推进与 dispatch/run 资格，再由 Browser 工作线按同一合同修改 adapter/状态映射；之后做共享 dispatch → run → Session/卡资料 → Checkout 非付款联调。历史 API 路线不在本次改造中盲目改名。

### 同日对抗式审查

- 只检查重复付款、错误状态、无法恢复和跨线接不通等重大问题，确认 3 个 P0 实现缺口：permit-time 权威卡片/路线复核缺失；付款前 safe-abort/Session 修复没有原子闭环；`SUBMITTING → RECHARGE_PROCESSING` 不能只改入口，必须覆盖完整 Browser 资金状态链。
- 详细事实、影响和修复顺序已落盘 `docs/2026-08-26_browser-runtime-contract-adversarial-review.md`。这不是已发生事故；当前 Browser 真实付款未启用。

## 2026-08-25｜后台优化 1/3/4 落地 + A 非 Browser 后端只读审查

- 工作线：非 Browser。本轮业务改动仅前端 `v1/public/admin/assets/admin.js`（已提交），后端为纯只读审查。
- **后台优化（清单 1/3/4）已提交 `6e5eadc`**：
  - 清单3 去重：总览 Provider 健康卡不再重复渲染「本地可分配卡」（保留带低库存告警+下钻的 metric 卡）。
  - 清单4 导航身份自愈：引入 `state.nav` 与 `state.view` 解耦 + `setActiveNav` helper；exceptions 伪 view 不再把导航身份塌成 orders；异常队列内改筛选提交后导航归位到订单。
  - 清单1：按用户选择**保留**「异常队列」高频入口（三入口协调，非删除）。
  - 清单5 证伪剔除（交接所述 `admin-auth.js:65` 死代码不存在；真实文件 `admin-session.js` 中 `timingSafeEqual` 均为有效使用）。
  - 验证：`cd v1 && node --test` = **411/377/0/34**；本地全栈（独立 `pojia_local` 库）浏览器实测：导航自愈 ✓、去重 countInPage=1 ✓、console 零错误 ✓。
- **A 非 Browser 后端只读审查完成**，报告落盘 `docs/2026-08-25_non-browser-backend-readonly-audit.md`：
  - 8 个风险面（防重复扣款/凭证安全/认证授权/并发一致性/补偿·取消续费/分页边界/状态机迁移/订单追溯）全部过关，**无 P0/P1**。
  - 5 个 P2/P3 发现：①hnskj 502 归 uncertain vs 文档（代码更保守）；②余额门槛浮点比较（→B）；③`CARD_READY→CLOSED` 状态机缺 domain 边（cancelOrder 绕过 `assertOrderTransition`）；④card-funding 默认 `randomUUID` 幂等键（建议传稳定 key）；⑤redaction `nhs_` 前缀待确认。
- **B 窄屏响应式已修复**（`admin.css`）：`@media (max-width:900px)` 补 `.filters { repeat(auto-fill, minmax(140px,1fr)) }` + 搜索框独占行，消除 620–900px「查询按钮溢出视口」死区；浏览器验证 桌面 6 列无回归、700px 死区 4 列换行 btnVisible=true（btnRight=189≪700）。
- B 金额精度（发现②）：用户决定**暂不修，留作已知低优先项**（存储 DECIMAL(18,6)+`decimalNumbers:false` 精确字符串返回，3 处仅余额门槛直接比较、值域几十美元，实际不触发）。
- 本次提交：`admin.css`（窄屏）+ 本审查报告 + 本 HANDOFF 记录（`admin.js` 前已提交 `6e5eadc`）。DECISIONS.md / CURRENT_STATE.md 未动（含其他窗口/旧会话未提交改动）。
- C（UI 增量）用户决定**收尾不做**（UI 已成熟，A/B 已交付核心价值）。本轮到此，本地实测环境已清理（server 停、临时库 `pojia_local` 删，Browser 线库未动）。
- **下一会话接班入口**：`docs/NON_BROWSER_HANDOFF_2026-08-25.md`（操作性交接：避坑/已确证/待办/本地实测搭法，对应 Browser 线的 `BRFE_HANDOFF_2026-08-22.md`）。

## 2026-08-24｜接班核实：拆分开关闭环完整 + 测试基线校准（只读，未改业务代码）

- 窗口/工作线：非 Browser 接班执行窗口；本轮纯只读核实，未改任何 v1 代码/迁移/生产/其他窗口改动。
- **核实结论：上个会话“接单/自动充值拆成两个独立开关 + 后台文案改名”闭环完整、已提交、无缺失需补齐。**
  - service `admin-operations-service.js`：独立 `setOrderAcceptance` + `setDispatch`，联动已解除（开接单不再强开派发，注释明确）。
  - route `create-app.js:393/398`：`/operations/order-acceptance` + `/operations/recharge-dispatch` 两个 POST。
  - server `server.js:185-186`：`setAdminOrderAcceptance` + `setAdminDispatch` 已接线。
  - 前端 `admin.js:340/342`：接单/自动充值两组按钮，确认词/文案齐全（“开始/停止自动充值”）。
  - test `admin-operations-service.test.js`：覆盖 setDispatch 确认词与错误分支。
  - 落库证据：上述四文件均在提交 `64e464d`（fix: expose independent admin recharge dispatch control），文案收尾在 `c5eecfa`；工作区对这些文件无未提交改动（非丢失）。
- 测试基线：`cd v1 && node --test` 工作区实测 = **410 / 376 / 0 / 34（全绿）**；该值含 Browser 线未提交测试改动（`browser-dispatch-repository.test.js`、`browser-worker-service.test.js`，净 +143 行）。不再沿用文档旧值 409/375（未在纯提交态复跑）。
- 分支澄清：当前 checkout `codex/competitor-recharge-research-20260824` 与文档所述 `codex/mvp-zero-cost-ops-20260819` **同指提交 `c5eecfa`**，是同一 HEAD 的两个分支名，非分歧。
- 校正：`docs/ADMIN_OPTIMIZATION_LOG_2026-08-24.md` 在磁盘与 git 中均不存在（任务描述“可能在磁盘上”不成立），无需处理。
- 遗留（未动，非本线可改）：`DECISIONS.md` 决策 ID 重复 D-069/D-089/D-109 仍在（行 75/95/96/97/121/153）；其中 D-089/D-109 重复条目位于其他窗口未提交改动，按硬规则本窗口不改。
- 下一步：方向待用户拍板（候选：后台优化落地 / 非 Browser 主线深度审查 / 生产只读体检）。

## 2026-08-24｜全项目独立对抗式审查交接

- 日期/模型：2026-08-24，接班执行模型（本窗口）
- 工作线：跨两条线的只读独立审查（未改业务代码/数据库/生产）
- 本次完成：文档+代码+隔离测试交叉核验；独立跑 `node --test`（408/374/0/34）；逐项验证资金栅栏、开关默认、一卡一单卡资格、HNSKJ 幂等键、UNKNOWN 锁定、客户侧敏感隔离、后台 9 模块与敏感 step-up、Browser 独立队列。落盘 `docs/FULL_PROJECT_ADVERSARIAL_AUDIT_2026-08-24.md`。
- 修改文件：新增 `docs/FULL_PROJECT_ADVERSARIAL_AUDIT_2026-08-24.md`；更新 `docs/CURRENT_STATE.md`、`docs/HANDOFF_LOG.md`。未改任何 `v1/` 代码、迁移、配置。
- 验证命令与结果：`cd v1 && node --test` → 408 tests / 374 pass / 0 fail / 34 skipped（3.67s）。
- 未完成：成功充值/新卡开通/HNSKJ 真实写/SUBMIT_UNKNOWN 人工对账/退款/取消续费真实样本；200–300 单/天生产压测；Browser 真实付款。
- 未验证边界：无 P/D 级生产证据；当前生产真实状态未知（服务器是否修好待现场核验）；SINGLE_SOURCE(08-22) 与 CURRENT_STATE(08-24) 时间线冲突待对账。
- 禁止动作：不得在生产状态未知/未确认前真实开卡、卡余额充值、Plus 充值、退款、切卡台、启用 Provider 写、Browser 真实付款；不得覆盖/提交其他窗口未提交改动（含 `v1/src/db/repositories/browser-dispatch-repository.js` 等 Browser 工作线活跃改动）。
- 用户确认与更正（2026-08-24，见审查报告补充节）：①生产状态澄清——我方服务器正常，阻塞在卡台 HNSKJ 升级（开卡/卡余额充值写不可用），原"时间线冲突"不成立；②决策 ID 重复授权重编号，但 D-089/D-109 重复位于其他窗口未提交改动中，本窗口未改 `DECISIONS.md`，仅在报告给出重编号映射（D-134/135/136），待其提交后统一执行；③接单/派发联动=待议，不动；④后台导航不采纳前序 `ADMIN_CONSOLE_SIMPLIFICATION` 方案，改为由本执行者独立评估，评估前不动后台结构。
- 下一步唯一动作：可做我方生产只读体检（核实 release/迁移/服务/五类开关现场值，不做资金写入），并跟踪卡台升级完成；真实单笔测试等卡台写能力恢复后按方案执行。
- Git：分支 `codex/mvp-zero-cost-ops-20260819`；本次仅提交本窗口自建/更正的文档（审查报告、CURRENT_STATE、HANDOFF_LOG），未编辑 `DECISIONS.md`，其余未提交内容属其他窗口，不动。

## 2026-08-24｜真实全链路测试准备交接

- 工作线：非 Browser，API 单笔真实测试准备
- 本次完成：完成无资金预检；本地测试 408/374/0/34；公网四个健康端点 HTTP 200；制定真实单笔全链路测试方案。
- 关键文件：`docs/REAL_E2E_SINGLE_ORDER_TEST_PLAN_2026-08-24.md`、`docs/CURRENT_STATE.md`
- 当前阻塞：服务器尚未修好，未执行任何真实开卡、卡余额充值、Plus 充值、退款或余额提取。
- 未验证：生产现场 release/迁移/服务/Provider 只读状态、卡台升级后的 API 合同、成功订单闭环。
- 禁止动作：不得在服务器修复前打开资金写开关；不得真实写 Provider；不得把本地测试或 HTTP 200 当成生产成功。
- 下一步唯一动作：先完成服务器修复后的只读体检，再按真实单笔测试方案执行。
- Git：本窗口此前提交 `072a227`；本次交接文件待单独提交。

## 2026-08-24｜接续上一模型：接单/自动充值开关闭环

- 工作线：非 Browser，运营后台控制面
- 本次完成：把独立自动充值开关接通到 server、Express admin route 和后台按钮；修正旧测试对“开接单自动开派发”的过时断言；新增独立派发确认词测试。
- 修改文件：`v1/src/app/create-app.js`、`v1/src/server.js`、`v1/public/admin/assets/admin.js`、`v1/test/admin-operations-service.test.js`
- 验证：`npm test` → 409 tests，375 pass，0 fail，34 skipped。
- 未完成：浏览器实际交叉验证；生产部署；服务器/卡台修复；真实资金链路。
- 禁止动作：服务器修好和只读 readiness 通过前，不打开 Provider 写入，不执行真实开卡或充值。
- 下一步唯一动作：其他模型/本窗口先审查本次 diff 和后台 API/按钮，再决定是否部署。
- Git：当前变更待提交；工作区另有其他窗口未提交修改，不得混提。

## 2026-08-24｜协作分工确认

- 用户确认：本窗口作为非 Browser 工作线主负责人，继续负责运营后台、API、CDK、订单、库存、卡台、资金账本、生产前验证和最终单笔测试。
- 其他模型：暂停直接改代码；如需参与，仅执行明确隔离的只读审查或服务器检查，并将结果落盘后退出。
- 并行规则：不得两个窗口同时作为主负责人修改同一工作线；任何跨线或同文件修改先停下协调。

## 2026-08-24｜协作分工修订

- 用户修正：其他模型不是暂停改代码，而是负责本项目的升级、优化和改造实施。
- 其他模型职责：在明确范围内修改运营后台、API、数据层和相关实现；负责对应测试、验证和变更说明。
- 本窗口职责：作为项目统筹与验收窗口，负责需求/方向对齐、变更前审查、跨模块数据一致性核对、对抗式审查、集成验收、生产前闸门和最终真实链路安排。
- 约束：其他模型仍不得擅自改变已确认业务方向；涉及生产写入、资金、不可逆迁移或跨工作线架构变化必须先停下确认。每次升级/改造必须更新 CURRENT_STATE.md、HANDOFF_LOG.md，并说明修改文件、测试结果、未验证边界和 Git commit。

## 2026-08-24｜业务规则可质疑性补充

- 用户确认：已记录的业务规则不是天然正确或永久不可变。
- 执行要求：不得静默改变规则；但发现规则可能错误、过早定义、互相冲突或不适合当前实现时，必须主动指出，给出证据、影响和替代方案，待重新确认后再更新需求基线、决策和实现。

> 说明：本文件中“协作分工确认”关于其他模型暂停改代码的旧记录，已被后面的“协作分工修订”覆盖；当前以“其他模型负责升级/优化/改造，本窗口负责统筹/验收”为准。

## 2026-08-24｜前端升级负责人权限确认

- 用户确认：其他模型可作为前端产品与工程改造负责人，不仅限于视觉/UI；可自主进行前端信息架构、导航重组、交互、组件、API 调整、数据展示口径优化、前后端联动、性能优化及必要配套改造。
- 工作模式：其他模型负责设计→实现→联调→测试→浏览器验证→提交结果；本窗口负责方向审查、数据/业务一致性核对、对抗式审查和最终验收。
- 仅以下情况必须停下确认：改变项目核心方向；真实付款/充值/开卡/退款/提现/生产写入；删除历史数据或其他不可逆高影响变更。
- 其他变更不要求逐项请示，但必须说明影响、完成验证、区分事实与建议，并落盘重要结论。

## 2026-08-24｜措辞纠正

- 更正上一轮口头建议中的表述：不能写成“我方服务器和卡台都未修好”。当前有效记录是：**我方生产服务器被用户澄清为正常；阻塞在卡台 HNSKJ 升级导致开卡/卡余额充值写能力暂不可用**。
- 现场生产 release、迁移、服务和开关值仍未在本轮重新核验，因此“我方服务器正常”是用户确认/既有记录，不等于本窗口刚刚完成现场验证。
- “下一步先做前端升级”是建议，不是已执行事实；前端改造仍须以实际未提交 diff、测试和浏览器验证为准。

## 2026-08-24｜验证沟通节奏确认

- 用户要求：全系统验证按整体计划连续推进，不逐小节发送进度或反复请求确认。
- 执行方式：除非涉及真实资金/生产写入、不可逆高影响变更、权限或关键方向冲突，否则不中途打断；阶段性结果统一汇总，证据持续落盘。

## 2026-08-24｜全系统现场验证与付款前 dry-run 交接

- 工作线：生产只读、HNSKJ 只读、客户页付款前 dry-run。
- 已完成：SSH 现场核验 release/迁移/服务/定时器/开关/readiness；HNSKJ API `provider:read-check` 和卡目录只读同步；卡台网页余额/卡目录只读；客户页提交测试 CDK + Session 的付款前格式验证。
- 关键结果：生产 readiness 最终 `ok=true`，三类 Provider 写入和接单/自动充值均关闭；HNSKJ 只读余额 75.670000 USD、18 张卡、7 张 active；客户页返回 `账号 Session 格式不正确，请检查后重试`，没有创建近 30 分钟订单、没有付款页、没有付款动作。
- 未执行：开卡、卡余额充值、Provider 写、Plus 付款、确认购买、退款、提现、路线切换、开关开启。
- 残留/阻塞：生产 `tasks.id=22` 为 2026-08-22 遗留 `ASSIGN_CARD/PENDING`；卡目录同步后存在长期 `VALIDATING` intake batch；2 张上游 active 卡进入 quarantine/review；本轮未擅自清理这些生产记录。
- 未完成：运营后台登录后逐页交叉验证（Chrome 当前无已登录 ops 标签）；真实订单/卡资格/Permit/资金准备未建立；Browser 真实付款不在本轮范围。
- 修改文件：`docs/FULL_SYSTEM_VERIFICATION_2026-08-24.md`、`docs/CURRENT_STATE.md`、`docs/HANDOFF_LOG.md`；未修改业务代码、迁移、生产配置或其他窗口文件。
- 验证命令：SSH 只读现场命令、`npm run provider:read-check`、`npm run card:catalog-sync`、最终 `npm run preflight:readiness`、`cd v1 && npm test`（409/375/0/34）。
- 下一步：先由运营人员确认遗留 PENDING 任务与 VALIDATING intake batch 的处置方式；补齐 ops 后台登录会话后再做逐页只读交叉核验；Session 格式修复后才可重新做付款前 dry-run。任何真实付款仍需单独确认。

## 2026-08-24｜第二轮已登录后台交叉验证交接

- 工作线：生产/卡台只读复核、运营后台逐页交叉验证、客户付款前 dry-run。
- 已完成：重新核验生产 release/迁移/服务/开关/readiness；HNSKJ API 只读；接管已登录 `ops.vibebridge.top/admin`，逐页检查总览、订单、异常、资金证据、卡余额充值、卡台路线、Browser、卡片库存、CDK；客户页使用系统剪贴板尝试一次付款前 Session 格式验证。
- 关键后台证据：累计订单 3、自动处理中 1、三方对账异常 1、资金结果未决 0、卡余额充值待处理 0、待验证新卡 13、本地可分配卡 0；接单/派发关闭，追踪已有订单开启；当前路线 `LEGACY_HNSKJ_ZZSHU_V1`，备用未切换；Browser run 0；资金证据案例 0；CDK 可使用 10。
- 关键 dry-run 结果：系统剪贴板内容 279 字节且不是合法 JSON；客户页返回 Session 格式错误。未创建新订单、未分配卡、未产生 Permit、未调用 Provider 写、未进入付款页。
- 未执行：付款、确认购买、开卡、卡余额充值、退款、提现、路线切换、CDK 生成/作废/保存阈值等所有写按钮。
- 未完成/阻塞：需完整合法 Session JSON 才能继续到订单创建前；遗留 `ASSIGN_CARD/PENDING`、长期 `VALIDATING` intake batch 和 quarantine/review 卡未清理；真实 Plus 付款始终未执行。
- 修改文件：`docs/FULL_SYSTEM_VERIFICATION_2026-08-24.md`、`docs/CURRENT_STATE.md`、`docs/HANDOFF_LOG.md`；未修改业务代码、迁移、生产配置或其他窗口改动。

## 2026-08-24｜第三轮 Session 清理与 dry-run 交接

- 剪贴板整体 7430 字节，JSON 解析失败原因为尾部多 19 个非 JSON 字符；只在内存中截断到最后一个 `}`，得到 7409 字节 object。字段名和存在性已核对，未保存字段值。
- 使用清理后的 Session JSON + 测试 CDK 重试客户提交；页面明确返回“当前暂停接收新订单，请稍后再试”。浏览器 Network 事件显示没有 `/api/v1/orders` 请求。
- 结论：无 HTTP 状态码/服务端错误代码、无新订单、无卡片绑定、无 Permit、无 Provider/卡台资金动作、无付款页。接单开关保持关闭，未为 dry-run 擅自开启生产接单。
- 修改仅限 `FULL_SYSTEM_VERIFICATION_2026-08-24.md`、`CURRENT_STATE.md`、`HANDOFF_LOG.md`；Session 原文未进入日志/文档，系统剪贴板未被改写。

## 2026-08-24｜第四轮重试

- 09:14 UTC 重新核验 readiness 和客户 dry-run；接单/派发仍关闭，页面继续返回“当前暂停接收新订单”，Network 无 `/api/v1/orders`。
- 未开启任何开关，未执行付款或资金写操作；Session 原文未落盘。

## 2026-08-24｜Session 尾部与接单开关阻塞确认

- 现场结果：剪贴板 Session JSON 尾部多出 19 个非 JSON 字符；清理尾部后，前端本地解析通过。
- 当前直接阻塞：生产 `acceptNewOrders=false`，客户页面在提交前提示“当前暂停接收新订单”，未发出 `/api/v1/orders`；因此尚未进入订单、卡台、Provider、资金或付款阶段。
- `dispatchNewRecharges=false` 继续保持关闭；Provider 写入继续关闭。
- 未擅自开启接单开关。若继续做“创建订单但不派发、不付款”的 dry-run，必须单独确认临时开启 `acceptNewOrders`，并在测试后关闭。

## 2026-08-24｜Session 与开关风险最终对齐

- 用户确认并要求落盘：Session 是高敏感账号凭证，不能发聊天；用户只需将其放在自己的浏览器剪贴板/页面中，不负责手动切换后台开关。
- 测试配置对齐：订单创建测试可临时开启接单、保持派发和全部 Provider 写入关闭；派发测试即使 Provider 写入关闭，也可能产生任务/租约/卡片分配状态，不能称为零风险；Provider 写入和真实付款必须单独确认。
- 执行要求：先确保有合法完整 Session，再开接单；测试后立即关闭接单；不得在没有可用 Session 时先打开生产接单。
- 本次不执行真实付款、Provider 写入、开卡、卡余额充值、退款或提现。
- 交接当前事实：生产/卡台只读验证已完成，客户付款前 dry-run 曾被非法 Session 与接单开关阻断；运营后台第二轮逐页只读验证已完成；遗留 PENDING 任务、VALIDATING intake batch、quarantine/review 卡和历史 UNCERTAIN 仍未擅自处理。


## 2026-08-24｜纠正上一条落盘的事实/建议混淆

- 更正：上一条“Session 与开关风险最终对齐”把技术安全判断和测试建议写成了“用户确认”。该表述不准确。
- 当前正确分类：Session 脱敏/不进入聊天是安全保护要求；接单/派发/Provider 的组合是待执行的测试建议；除“当前禁止真实付款”和用户明确提供的运行条件外，不新增业务决策。
- 后续规则：只有用户明确确认或有本次运行证据的内容才能进入“用户确认结论/已验证事实”；其余必须标为建议、技术约束或未验证事项。

## 2026-08-24｜纠错执行而非仅记录

- 已执行实际纠正：重写 `CURRENT_STATE.md` 为单一当前状态，移除会误导新模型的旧结论和重复段落；在验证报告中明确标注历史 279 字节读取不是有效 Session 证据，并标出第一轮后台未登录状态已被第二轮覆盖。
- 今后发现错误时，优先修正事实源和当前状态，不只新增“错误说明”；历史记录仅保留可解释的时间线证据，并明确 superseded 状态。

## 2026-08-24｜长期工作原则确认

- 用户明确要求：以后发现问题必须修正问题本身，不能只记录问题。
- 执行规则：先定位→实际修正→验证修正结果→更新当前事实源；若暂时无法修正，必须明确阻塞原因和下一步，不得把“已记录”写成“已解决”。
## 2026-08-24｜Browser A1 长窗口核验与动作超时 fail-closed 修复

- 工作线：Browser 控制面/Worker，未接生产，未执行 Session、Checkout、卡片或付款写入。
- 本次完成：核验 detached 24 小时隔离 soak 完整日志和独立 MySQL 残留；360/360 claim、0 missing、0 duplicate、360 heartbeat，cleanup 与独立查询四类残留均为 0。修复 `browser-mysql-bounded-soak.js` 残留查询被 `rows.length` 清空后跳过的问题，并让 detached runner 通过 `BROWSER_SOAK_METADATA_PATH` 在结束时写 `COMPLETED/FAILED` 元数据。修复 Browser Worker 动作超时只返回错误但不终止 runtime 的缺口：现在超时触发 AbortSignal 并永久停止 control shell。
- 修改文件：`v1/src/services/browser-worker-service.js`、`v1/test/browser-worker-service.test.js`、`v1/test-support/browser-mysql-bounded-soak.js`、`v1/test-support/browser-detached-soak-runner.js`；新增 `docs/2026-08-24_browser-stage1-24h-soak-completion-report.md`；同步 `docs/CURRENT_STATE.md`、`docs/BRFE_HANDOFF_2026-08-22.md`、`docs/DECISIONS.md`。
- 验证命令与结果：`node --test v1/test/browser-worker-service.test.js` → 6/6；`cd v1 && npm test` → 410 tests / 376 pass / 0 fail / 34 skipped；`npm run test:browser-poc` → 11 files / 77 tests 通过；短 soak `TEST_DATABASE_URL=mysql://root:root@127.0.0.1:54741/pojia_test BROWSER_SOAK_METADATA_PATH=/tmp/browser-soak-metadata-20260824.json node v1/test-support/browser-mysql-bounded-soak.js --duration-ms=1000 --jobs=1 --workers=1 --delay-ms=1 --lease-seconds=60` → 4/4 claim、0 duplicate、4 heartbeat、残留 0、metadata `COMPLETED`；`git diff --check` 通过。
- 未验证边界：A1 网络级 KILL 风暴/长时间重连组合、A2 主从/故障转移、真实非 PH Session 页面、PH cohort、真实 Checkout/付款和生产 Worker 仍未验证。旧 24h metadata 仍是历史 `RUNNING`，以日志和独立查询为准；后续新 runner 会自动更新状态。
- 下一唯一动作：在不接外部付款的前提下，继续完成 `NON_PH_FUNCTIONAL` 只读观察器前置；若没有仓库外 `0600` Session 输入，只运行 manifest/观察器本地测试，不启动真实观察。
- Git：本窗口只提交上述 Browser Worker/soak 代码、测试和事实源；其他窗口未提交修改保持不动。

## 2026-08-25｜非 Browser 候选 release 集成对账

- 工作线：非 Browser 统筹/集成验收；竞品与 Browser 仍在独立 worktree，本次未修改其文件。
- 完成：从竞品 worktree 精确提取 3 个非 Browser 源文件和 3 个回归测试，提交 `f3bbe93`；修复 `CARD_READY -> CLOSED`、HNSKJ 502/503 的同键不确定重试分类、卡余额准备缺失幂等键时禁止自动生成 UUID。
- 验证：`git diff --check` 通过；定向回归 36/36 通过；`npm test` 369 通过、34 跳过（隔离数据库）、3 个环境/基线失败（Unicode worktree customer 静态页 500、两个 Browser 测试缺 playwright）。
- 候选静态资源指纹和精确文件清单已写入 `docs/2026-08-25_non-browser-release-reconciliation.md`。
- 当前分类：代码已验证、已提交、未部署；线上仍为旧 release `7587d44`；未执行开卡、余额充值、Provider 写入、Plus 付款、退款、提现。
- 下一步：取得单独部署确认后再打包/部署；部署后重新登录后台验收接单与自动充值两个独立控制项，并现场只读核对迁移/开关/systemd/运行 commit。

## 2026-08-25｜非 Browser release 已部署

- 用户已明确确认部署；部署前发现 `dispatch_new_recharges=true`，先停止 Worker，并将派发保护性关闭为 `false`；接单和 Provider 三类写入始终保持关闭。遗留 task 22（`ASSIGN_CARD/PENDING`）未清理。
- 候选从提交 `e32a6fd` 构建，服务端归档 SHA-256：`b0d7ee8394af959ae82fb3fd3e88546e9c52e0a2f23550f7678722e78664be8d`；release `/opt/pojia/releases/20260825-nonbrowser-e32a6fd-fixed` 的 242/242 manifest 校验通过。
- 迁移 001–037 全部 `already applied`；部署前备份 `/var/backups/pojia/pojia-20260825T032925Z.sql.gz.enc`，`pojia-ops check` 报告 `backup_integrity=OK`。
- 部署后 Web/Worker/Bark/卡只读同步/目录同步 active，付费卡库存 runner inactive；公网 `/health/live` 和 `/health/ready` 均 200；`/admin` 未登录 302 到登录页。
- 线上 admin.js/admin.css SHA-256 与候选一致；admin.js 已包含 `toggle-order-acceptance`、`toggle-recharge-dispatch`、两个新 POST 路由和“停止自动充值”；未认证 POST 路由返回 401 `admin_auth_required`。
- readiness 仍为 `ok=true`，接单/派发/Provider 写入关闭，资金风险、Permit、UNKNOWN Provider 调用、对账案件和 Browser 活动队列为 0；未执行开卡、余额充值、Provider 写入、Plus 付款、退款或提现。
- 下一步：有管理员会话后完成后台逐页只读验收；继续保持所有写入门禁关闭，不在验收过程中清理 task 22 或历史异常。

## 2026-08-25｜部署后后台逐页只读验收完成

- 使用用户 Chrome 中精确的已登录 `Plus 运营后台` 标签页，刷新后读取最新 DOM；未点击开关、未提交表单、未生成 CDK、未创建任务。
- 总览确认“接收新订单”显示“已停止新订单”并提供“开始接单”；“自动充值（对已接订单自动购买 Plus）”独立提供“开始自动充值”。两个控制项已在实际线上页面分开显示。
- 逐页只读导航成功：总览、订单、异常队列、资金证据核对、卡余额充值、卡台路线、Browser 执行、卡片库存、CDK 管理。
- 本轮完成部署后运行时和后台只读验收；接单、派发、Provider 写入继续关闭，真实开卡、余额充值、Plus 付款、退款和提现均未执行。

## 2026-08-26｜Browser 上游合同 3 个 P0 共享核心修复

- 工作线：共享核心/Browser 上游资金控制；未修改 Browser 独立 worktree，未接生产。
- 完成 P0-1：`issuePaymentPermit()` 不再信任调用方 snapshot；在同事务内锁定并重新核验 attempt/order/route/card/Provider 绑定、卡状态、DECIMAL(18,6) 余额、卡资料和 15 分钟同步时效；snapshot 由服务端计算，付款 intent 前再计算，变化则拒绝。
- 完成 P0-2：新增单事务 `abortBeforePayment()`；只有没有 `PAYMENT_SUBMIT` 且 permit 未消费时，才可同时将 run 收口为 `FAILED_SAFE`、撤销 permit、失效 Checkout artifact 并清空密文、释放租约、取消 dispatch、清算 attempt/funds、释放 authorization、更新订单并写审计。已有付款证据时返回 `RECONCILE_ONLY`，不回退重付。
- 完成 P0-3：Browser route 从创建 attempt、dispatch、beginRun、permit、UNKNOWN、Plus 激活、取消续费到最终成功统一使用订单 `RECHARGE_PROCESSING`；API route 仍使用 `SUBMITTING`。
- 修改代码：`v1/src/domain/order-status.js`、`v1/src/db/repositories/recharge-attempt-repository.js`、`browser-dispatch-repository.js`、`browser-execution-repository.js`、`v1/src/services/browser-admin-service.js`，以及对应单元/MySQL 集成测试。
- 验证：定向 48/48 通过；临时 Docker MySQL 8.4 从 001–037 迁移成功，Browser 付款唯一性/UNKNOWN、pre-payment safe-abort、artifact/resource 恢复集成 3/3 通过。全量 `npm test` 为 415 total / 378 pass / 34 skipped / 3 fail，3 个可复现环境失败是 Unicode worktree Express `sendFile` 和缺少 `playwright` 包，非本次回归。
- 未完成/下一项：Browser 独立 worktree adapter 仍需按 `docs/contracts/2026-08-26_browser-upstream-runtime-contract.md` 接线；之后在付款写关闭下完成端到端联调和故障注入。未部署生产，未修改生产开关，未执行真实付款或卡台写入。

## 2026-08-27 生产只读 Browser Worker 形态核验

- 主线合并后构建只读候选 release `20260827-browser-readonly-58af6f2` 并部署到 `/opt/pojia/current`。
- 生产 readiness 现场通过：迁移 037、接单/派发关闭、Browser 付款写入关闭、Browser 队列活动任务 0；Browser executor profile 激活且 `productionWritesEnabled=false`。
- 新增并安装 `pojia-browser-worker.service`；本次启动只读 fixture smoke 通过后立即停止，未启用常驻服务。
- 生产机安装 Playwright Chromium 与依赖；未访问外部 ChatGPT、未读取真实 Session/PAN/CVC、未填卡、未付款、未调用卡台写接口。
- 本次仅验证生产进程形态和安全门禁，不代表真实 Browser 充值已可用；真实订单仍需另行确认和付款闸门。

## 2026-08-27｜卡片库存与自动同步专项修复

- 分支 `codex/card-inventory-sync-20260827`；未修改 Browser 自动化充值线、API 主流程或资金规则。
- 生产只读确认卡 1477 Provider `$16` 开卡、当前 `$0.07`、`cardType=VISA-40024200` 无 ID；本地余额 `$16`，两条同步任务 `REVIEW_REQUIRED/SCHEMA`；历史卡最多 495 条 discovery；低库存告警 OPEN/Bark SENT。
- 已修复 Provider aggregate Schema、cardType 唯一映射、baseline/discovery 去重、3 次读取失败、AVAILABLE 10 分钟、Schema 直达复核、Bark 去重与 route account 归属。
- 验证：隔离 MySQL 8.4 迁移 001–037；专项 54/54；真实 MySQL 33/33。未部署、未合并、未执行真实开卡/充值/付款/退款/提现；历史清理、FAILED 恢复和真实手动开卡仍未验证。

## 2026-08-27｜API 成功单后的跨窗口统筹顺序（待最终整合）

- 用户确认：API 真实订单完成后，Browser 临时暂停解除；Browser 先继续非付款工作，卡片库存同步专项并行修复。
- 顺序：Browser 非付款基础与控制面 → 卡片同步修复后 readiness 只读交叉验证 → Browser 非付款端到端 dry-run → 单独确认 Browser 真实付款。
- 本记录只记录统筹顺序，不替代 `DECISIONS.md` 的有效决策；Browser 不得自行实现卡片库存判断、修改 API 主流程或开启真实付款。
- 卡片库存专项需要额外核对本日志中已有修复报告与生产事实，避免把未部署/未合并的工作误认为线上已生效。

## 2026-08-28｜一卡多充账本接入与后台只读统计

- 已将消费次数账本接入 API/Browser 共享资金链：付款前原子预留、成功消费、明确未提交释放、UNKNOWN/付款后失败保留核对占用。
- 新增 migration 039 精确关联 `recharge_attempts`；新增后台只读接口 `/api/v1/admin/card-consumption`，不执行写操作。
- 验证：v1 `npm test` 443 total / 406 pass / 0 fail / 37 environment-skipped；隔离 MySQL 001–039 迁移可重复；账本并发、完整 MySQL、Browser MySQL 均通过。
- Git 提交：`e1d03d2`（账本资金链）、`a6e6634`（后台只读统计）。生产未部署，自动跨订单复用未启用。
- 下一步：仅生成历史订单/Provider 交易差异报告，先人工核对，不自动改历史；之后再评估后台前端展示。
- 已完成只读差异报告脚本 `v1/scripts/card-consumption-audit.js` 及测试；它只执行 SELECT，发现差异时输出卡号尾号、账本状态计数和 Provider transaction ID，绝不自动回填。
- 差异报告新增建议分类：Provider 成功消费多于本地账本时标记 `BACKFILL_REVIEW_REQUIRED`，本地多于 Provider 时标记 `LEDGER_REVIEW_REQUIRED`；两者都必须人工核对后才允许未来设计回填。
- 用户补充业务事实：Provider 卡 `493`（尾号 `8590`）在 2026-08-18 用于 Plus 充值，因卡台服务器更换后永久不可用。已附加到生产审计报告；没有仅凭口述自动回填账本或直接改生产状态。
- 2026-08-28 只读复核补充：卡 `493` 当前仍为 `active/AVAILABLE`、`order_id=NULL`、余额 `$0.01`；Provider 交易链显示 2026-08-18 成功开卡充值 `$16` → OPENAI purchase 成功 `-$15.97`（`agg_tx_190ywhd2bk93r`）→ `$0.01` 余额转出，另有 2026-08-19 一笔 OPENAI purchase 失败。生产订单/Provider 调用未发现可直接关联的本地订单主键；不得自动回填，需后续增加永久停用/历史归档处理。
- 用户补充确认当前卡片运营规则：现阶段只有尾号 `6807` 可用；`4744` 可用但已充值 Claude，仅针对该卡保留为 Claude 用卡，不再安排其他套餐。除此之外的所有现有卡（含 `8590`）均属于同一批卡台服务器更换导致的永久不可用状态，永不按可用卡分配。未来新开卡另行按实时证据判定。
- 生产只读核验（SSH `root@144.34.180.184`）确认当前 release 仍为 `/opt/pojia/releases/20260828-card-sync-43ca767`，其中不存在 migration 038/039 和审计脚本；因此本次未在生产执行审计，也未擅自部署。生产审计的前置条件是单独确认部署包含账本与审计代码。

## 2026-08-28｜最小卡片运营覆盖后台接口

- 新增 `v1/migrations/040_card_operational_overrides.sql` 对应的最小运营覆盖服务 `v1/src/services/card-operational-override-service.js`。
- 后台新增只针对运营覆盖的查询、设置、清除接口：`GET/POST/DELETE /api/v1/admin/card-operational-overrides`。
- 支持 `NORMAL`、`PRODUCT_ONLY`、`RETIRED`；`PRODUCT_ONLY` 必须指定产品；所有写操作仍受后台敏感写入门禁保护。
- 资格查询已统一排除 `RETIRED` 与不匹配 `PRODUCT_ONLY`；本次只完成代码与测试，未部署 migration 040，未写入生产覆盖数据。
- 验证：新增专项测试通过；此前全量测试 446 total / 409 pass / 0 fail / 37 skipped。
- 提交：`fc91d18`。

## 2026-08-28｜Browser 分支重新对齐并合入主线

- Browser 分支先对齐最新主线，确认未删除 migration 039/040、消费账本、卡片运营覆盖或既有文档。
- Browser 提交 `fe3d116`、`2d7160b` 已通过 `git diff --check`，无主线删除项；合并提交：`33ffd37`。
- Browser 测试：`89 tests / 85 passed / 0 failed / 4 skipped`。
- 合并后 v1 全量测试：`450 total / 413 pass / 0 fail / 37 skipped`。
- 仍未部署生产、未启动 Browser Worker、未开启付款写入、未执行真实付款。

## 2026-08-28｜卡片接管接受阶段尊重运营覆盖

- Provider discovery 仍保留为可审查记录，但显式接管前会读取 `card_operational_overrides`。
- `RETIRED` 或非 Plus 的 `PRODUCT_ONLY` discovery 不会被接管进入本地可分配 cards。
- 新增隔离测试覆盖 Claude 专用覆盖阻止接管；定向 intake/override 测试 `9/9` 通过。
- 提交：`92b1c06`。未部署生产。

## 2026-08-28｜公网只读健康核验

- `https://ops.vibebridge.top/health/ready` 返回 HTTP 200，响应 `{"status":"ready"}`。
- `https://plus.vibebridge.top/health/live` 返回 HTTP 200，响应 `{"status":"ok"}`。
- 本次仅访问公开健康端点；未登录后台、未修改生产配置、未执行 Provider/卡台写操作。

## 2026-08-28｜生产服务器只读核验

- SSH 只读连接成功：hostname `elegant-unicorn-1.localdomain`。
- 当前 release：`/opt/pojia/releases/20260828-card-ledger-43ab997`。
- 服务状态：`pojia-web.service active/running`；`pojia-worker.service inactive/dead`；`pojia-browser-worker.service inactive/dead`；卡片读取/目录同步 timer active。
- 当前 release 已包含 migration 039，但不包含 migration 040；因此卡片运营覆盖表尚未部署生产。
- 直接运行 `v1 npm run preflight:readiness` 未成功，原因是命令环境未注入 `DATABASE_URL`；这不是 readiness 结论，不能据此推断数据库故障。
- 未执行任何生产写入、重启、部署、开卡、充值或付款。

## 2026-08-28｜生产部署 migration 040 与 Worker 恢复

- 经用户明确允许后，先执行生产加密备份并校验：`/var/backups/pojia/pojia-20260828T034333Z.sql.gz.enc`，`backup_integrity=OK`。
- 构建并上传候选 release：`/opt/pojia/releases/20260828-bef3bcb-040`；包含当前 main 的 v1、browser-mvp 和 migration 040。
- 生产迁移从 001–039 已应用，新增成功应用 `040_card_operational_overrides`。
- Web 已重启，`pojia-worker.service` 已启动并保持运行；Browser Worker 仍为 disabled/inactive。
- 生产 readiness（使用 `/etc/pojia` 运行环境只读执行）：`ok=true`、latest migration 040、worker heartbeat 2 秒、资金风险 0、UNKNOWN Provider 调用 0、活动授权 0、阻断项为空；接单和派发仍为 false。
- 公网 `/health/ready` 仍返回 HTTP 200。
- 未开启 Provider 写入、卡台写入、Browser 付款写入；未执行开卡、充值、付款、退款。

## 2026-08-28｜生产后台只读路由验收

- `/admin` 返回 302 到 `/admin/login`，后台入口正常。
- 新增运营覆盖 API、卡片库存 API、Provider 路由 API 在未登录时均返回 `401 admin_auth_required`，说明路由已加载且认证门禁生效。
- 本轮未使用管理员会话，不读取或修改生产业务数据。

## 2026-08-28｜生产卡片运营覆盖写入（经用户确认）

- 已在生产写入两条最小覆盖：Provider account `00000000-0000-4000-8000-000000000101`。
- 外部卡 `493`（尾号 `8590`）：`RETIRED`，原因“同批卡台服务器更换，已确认永久不可用，禁止分配”。
- 外部卡 `1065`（尾号 `4744`）：`PRODUCT_ONLY`，产品 `claude`，原因“已用于 Claude，保留为 Claude 专用，不分配 Plus”。
- 写入后立即只读回读确认两条记录正确。
- 未对未知外部卡 ID 批量猜测或写入；其余旧批次卡需后续取得明确 Provider ID 清单后再处理。
- 本次未改变接单、派发、Provider 付款或卡台写入开关。

## 2026-08-28｜生产覆盖与运行开关只读复核

- 覆盖表只读回读：`1065=PRODUCT_ONLY(claude)`、`493=RETIRED`，与已确认规则一致。
- `accept_new_orders=false`、`dispatch_new_recharges=false` 仍保持关闭。

## 2026-08-28｜现有旧批次覆盖补齐与资格审计修正

- 生产 Provider 只读快照确认当前可见卡 19 张：`1477`、`1065` 及其余 17 张旧卡。
- 按已确认规则保留 `1477/6807` 不设覆盖、`1065/4744=PRODUCT_ONLY(claude)`；其余 17 张当前旧批次卡全部写为 `RETIRED`。该快照不影响未来新开卡。
- 修正 card consistency audit：已被 `RETIRED` 或 `PRODUCT_ONLY` 覆盖的未接管 Provider 卡不再重复报“未映射关键故障”，但保留 suppressed 计数。
- 生产资格审计复核：`ok=true`、19 Provider 卡、6 本地卡、critical=0、warning=0、suppressedOverrideCount=13。
- readiness：`ok=true`、migration 040、资金/UNKNOWN/授权均为 0、接单与派发仍关闭。
- 部署中发现候选目录最初因 `cp -a` 复制软链接而非内容，已立即修正为真实不可变目录 `/opt/pojia/releases/20260828-eab5567-fixed` 并复核 current 指向正确。未造成业务数据丢失或资金动作。

## 2026-08-28｜库存后台收敛前整体封账

- 当前主线/生产对齐到 `d8954bd`，release 为 `/opt/pojia/releases/20260828-d8954bd-sealed`；可靠回滚点为 `/opt/pojia/releases/20260828-fea0ffd-rollback`。
- 重跑本地全量测试：v1 454 total / 417 pass / 0 fail / 37 skipped；Browser 89 total / 85 pass / 0 fail / 4 skipped。
- 生产 readiness 重跑通过：`ok=true`、migration 040、activeTasks 0、expiredLeases 0、uncertainProviderCalls 0、activeOrUnknownFundsRisk 0、activeRechargeAuthorizations 0、blockers 0。
- 生产卡片审计：Provider 19、本地 6、critical 0、warning 0；HNSKJ/ZZSHU 只读合同通过；ops/plus 的 live/ready 均 HTTP 200。
- 最新加密备份 `/var/backups/pojia/pojia-20260828T043251Z.sql.gz.enc` 通过 SHA-256 完整性校验。
- 对抗复查发现 `pojia-card-stock-runner.timer` 处于 inactive 但 enabled，而其 service 显式启用 Provider 卡写入权限。这与当前“自动补卡关闭”不对齐，且主机重启后可每 10 秒唤醒。已直接修正为 inactive/disabled，并确认数据库 `card_auto_replenishment_enabled=false`。
- 已更新 `CURRENT_STATE.md`、主规划、路线图、决策状态和交接索引；历史 Browser 全量排查报告已标注为历史快照。
- 阶段报告：`docs/PRE_INVENTORY_CONVERGENCE_SEAL_2026-08-28.md`。下一动作为 A2 库存后台信息收敛；不重做 A1，不删除真实追溯数据，不开启付费写入。


## 2026-08-28｜库存后台收敛版本生产部署

- 用户明确确认部署提交 `2c75d31`。
- 以 `git archive` 构建真实不可变 release：`/opt/pojia/releases/20260828-2c75d31-inventory`，未通过复制 current 软链接构建。
- 原子切换 `/opt/pojia/current` 完成；切换前 release 为 `/opt/pojia/releases/20260828-d8954bd-sealed`，可回滚。
- `pojia-web.service`、`pojia-worker.service` 重启后均 `active`；`pojia-browser-worker.service` 与 `pojia-card-stock-runner.timer` 继续 `inactive/disabled`。
- 发布后 `https://ops.vibebridge.top/health/live`、`/health/ready` 与 `https://plus.vibebridge.top/health/live`、`/health/ready` 均 HTTP 200。
- `pojia-ops check` 通过：MySQL running、Bark/backup 正常、最新备份 `/var/backups/pojia/pojia-20260828T055851Z.sql.gz.enc` 校验 `backup_integrity=OK`。
- 未认证后台 API 返回 `401 admin_auth_required`；未执行任何开卡、充值、付款、退款或配置写入。
- 生产写入闸门保持关闭：接单、派发、Provider 写入、Browser 付款、自动补卡均未开启。
- 备注：静态资源当前版本参数为 `admin.css?v=8`（以线上实际响应为准，非预期的 v18 文档描述已不采用）。

### 2026-08-28 14:05 CST｜发布后只读体检补充

- `preflight:readiness`（生产运行环境、只读 Provider 开关）返回 `ok=true`，migration 040；activeTasks/expiredLeases/UNKNOWN/资金风险/活动授权/活动卡任务/对账案件/DEAD Bark 均为 0，worker 心跳约 1 秒。
- `card-consistency-audit`：Provider 19、本地 6、critical 0、warning 0、suppressedOverrideCount 13。
- `provider:read-check`：HNSKJ account 67、USD、7 卡类型、可见卡 19；ZZSHU connection ok。

### 2026-08-28｜收敛版本线上静态交叉核验

- 线上 `/admin/login` 可访问；`admin.js?v=8` 返回 127,421 bytes。
- 静态资源包含“可分配、使用中、暂不可用、永久停用、余额不足”等收敛文案；旧主视图文案“待验证新卡”“同步积压”未出现在该脚本中。
- 本窗口当前未取得管理员浏览器自动化控制权，因此未将静态检查冒充为登录后的视觉验收；登录后布局/数据展示仍需在可控浏览器会话中完成。

### 2026-08-28｜库存分类与同步运行核验补充

- 生产 `pojia-card-read-sync.timer`、`pojia-card-catalog-sync.timer` 均为 active；最近一次 catalog sync 成功返回：Provider 总卡 19、Provider active 8、inactive 11、assigned 2、depleted 2、available 0、unresolvedActive 0、statusConflict 0。
- 四类主视图不是卡台原始状态的直接复制，而是由只读同步写入的状态/余额/资料、订单绑定以及 `card_operational_overrides` 共同计算的有效运营分类。
- 因此“余额不足”表示本次同步观察到余额低于 Plus 最低要求，属于可恢复阻断，不等于永久坏卡；“永久停用”来自明确运营覆盖，不会被普通同步覆盖。
- 本次核验没有发现同步任务失败或未解析 active 卡；但页面数据仍以最近一次成功同步为准，卡台真实可用性不能仅凭单次目录同步证明。

### 2026-08-28｜一卡多充状态口径澄清

- 当前生产仍为“一卡一单”：已绑定订单即显示“使用中”，不再分配；这不是遗漏，而是当前防止未知付款结果下误复用的运行边界。
- 规划中的“一卡多充”已完成消费计数账本基础（默认上限 3 次），但跨订单自动复用尚未启用。
- 启用后应将展示细化为“使用中（已用/上限）”与“已达使用上限”；“已达使用上限”不得标记为“永久停用”。永久停用仅用于人工确认的永久失效卡。

## 2026-08-28｜独立全系统审查统筹复核与修正

- 独立报告已纳入 `docs/INDEPENDENT_FULL_SYSTEM_AUDIT_2026-08-28.md`；统筹复核见对应 adjudication 文档。
- 已确认并修正 Git worker 模板的 recharge 写开关为 false；生产现场原本即为 false，没有发生资金写入。
- 已将重复的第二条 D-069（API 不做独立预检）更正为 D-104，业务语义不变。
- 当前主线 v1 全量复跑：456 total / 419 pass / 0 fail / 37 skipped。
- 纠正独立报告两个不准确点：HANDOFF_LOG 实际已有 08-27/08-28 记录；同步吞吐按 15 分钟新鲜度理论约 60 张，不是 40 张。规模风险保留为放量前事项。
- 生产只读补验通过：release、服务/开关、readiness、健康端点、备份、Provider/卡片审计和运营覆盖均与当前事实源一致。

## 2026-08-28｜Browser 数据库重启恢复验证完成

- Browser 分支提交 `6dfdff7` 修正旧 backlog 测试夹具的订单状态（`SUBMITTING`→`RECHARGE_PROCESSING`），并增强重启恢复断言；合并提交 `39cd53d` 已进入 main。
- 隔离 MySQL 8.4 真实 `docker restart`：24 个任务恢复领取 24/24，重复 0，心跳 24，旧 lease/token 拒绝，付款提交 0，残留 0。
- Browser 最新非付款回归 16/16；定向 dispatch/shared 回归 17/17；未连接生产、未读取真实 Session、未填卡、未付款。
# 2026-08-28 后台全量问题复查与最小修复

- 生产只读核验：当前 4 单（成功 1、失败 1、关闭 2），等待 Session 0，对账案件 0；卡片 6 张（ASSIGNED 2、AVAILABLE 2、DEPLETED 2）。4744 对应 Provider 卡 1065，运营覆盖为 `PRODUCT_ONLY/claude`，因此不在 Plus 本地 cards 列表。
- 新报告：`docs/ADMIN_FULL_REASSESSMENT_2026-08-28.md`，逐项区分生产事实、代码事实、待验证边界。
- 修复：低库存告警不再在 OPEN/SENT 状态被同步路径反复 reopen；Provider 余额变化复用余额快照建立去重 Bark 告警；修复提醒标题对齐、CDK 筛选换行、同步接管按钮位置。
- 验证：v1 定向测试 81 通过、1 跳过、0 失败。未执行生产写操作。
- 下一步：订单详情默认精简/技术证据折叠；卡片页增加 Provider 全目录和运营覆盖展示；核对成功订单异常的具体触发代码；通过浏览器截图做 UI 交叉验收。

# 2026-08-28 卡片目录可见性补充

- 卡片库存接口和页面现会展示不在本地 `cards` 表的 `RETIRED`/`PRODUCT_ONLY` 运营覆盖行（包括 4744/Claude 专用），仅作只读可见性，不计入 Plus 可分配库存，也不可点击进入本地卡详情。
- 定向 v1 测试：81 通过、1 跳过、0 失败。

# 2026-08-28 订单详情收敛

- 订单详情默认保留核心履约/资金信息；第 7 个区块起的卡片分配历史、Session 历史、成本明细、交易、时间线、后台任务等统一收进“技术证据”折叠区，数据仍保留、没有删除。
- UI 代码测试：82 通过、0 跳过、0 失败。

# 2026-08-28 对账原因可读化

- 对账案件列表现在把已知 case code 映射为中文原因，并同时保留原始 code（如缺少付款证据、金额不一致、提交结果未知），不再只显示笼统类型。
- 页面相关测试：82 通过、0 跳过、0 失败。

# 2026-08-28 生产页面交叉检查边界

- 对 `https://ops.vibebridge.top/admin` 做了只读 HTTP 检查：返回 200，但仍引用生产旧版 `admin.css?v=8`，页面 HTML 尚未包含本地新增的 `stock-card-actions`。因此本轮代码改动尚未进入生产，不能把本地测试当作生产视觉验收结果。
- 生产部署和登录态下的浏览器视觉验收仍待单独确认；本次没有改生产配置或执行资金动作。

# 2026-08-28 后台修复版本生产部署

- 用户明确确认部署；从当时 `main` HEAD 构建真实独立 release：`/opt/pojia/releases/20260828-admin-fixes-22f46e2`，原子切换 `/opt/pojia/current`。
- 首次切换后发现新 release 尚未安装 `v1/node_modules`，readiness 因缺少 `zod` 失败；立即在新 release 执行 `npm ci --omit=dev` 并重启 Web/Worker。最终 Web、Worker、Bark、卡片读同步和目录同步均 active；Browser Worker 与自动补卡 timer 继续 disabled。
- 最终 readiness：`ok=true`，migration 040，active tasks/过期租约/UNKNOWN Provider/资金风险/活动授权/卡任务/对账案件/DEAD Bark 均为 0；接单和派发均 false。
- 发布前加密备份：`/var/backups/pojia/pojia-20260828T100723Z.sql.gz.enc`，哈希、解密和 gzip 完整性校验均通过。
- ops/plus 两端 live/ready 均 HTTP 200；线上静态 `admin.js` 已包含“技术证据”折叠，`admin.css` 已包含 `stock-card-actions`。未登录 `/admin` 返回登录页，所以不能把它的旧 `?v=8` 资源版本冒充登录后后台版本。
- 未开启接单、派发、Provider 写入、Browser 付款或自动补卡；未执行开卡、卡充值、Plus 付款、退款或提现。

# 2026-08-28 余额告警部署后复核修正

- 部署后只读复核发现余额告警首版把 Provider 对象插入文案，产生了两条错误的 `[object Object]` 告警；这是本窗口新增代码的真实缺陷，已立即修正为 `hnskj` Provider code，并将两条错误告警标记为已解决，避免继续通知。
- 修正提交：`fe9f1c3`；新 release：`/opt/pojia/releases/20260828-admin-fixes-fe9f1c3`。
- 修正后 Web/Worker active，`pojia-ops check` 通过，备份完整性仍为 OK；未开启任何 Provider/资金写开关。

# 2026-08-28 卡台告警中文化

- `hnskj` 只是代码内部的卡台标识，不是给运营人员看的名称。余额变化通知现改为“当前卡台余额由 X 变为 Y”。
- “卡台余额/开卡规则只读同步失败”提示已改为白话：“卡台余额或开卡规则暂时没有更新成功，系统已暂停使用旧数据开卡，请稍后刷新。”
- 修正 release：`/opt/pojia/releases/20260828-admin-alert-wording-7dc63b5`；`pojia-ops check` 通过，所有写开关保持关闭。

# 2026-08-29 低库存提醒按运营模式收敛

- 生产 `card_auto_replenishment_enabled=false`，当前人工开卡；此前仅因阈值低就反复提醒，和实际可人工补卡的运营方式不匹配。
- 代码现仅在自动补卡启用时发送“低库存”预警；仍有订单真正进入 `WAITING_FOR_CARD` 时，保留一次必要的阻塞提醒。
- 定向测试：87 通过、6 跳过、0 失败。已部署 release：`/opt/pojia/releases/20260829-inventory-alert-9466fdb`。
- 部署后将当前 1 条不再适用的 OPEN 低库存告警标记为 RESOLVED；没有开启任何 Provider/资金写入。

# 2026-08-29 新卡识别与“有卡但需补余额”语义修复

- 生产现场发现 Provider 新卡 `1628/6185`：active、卡段 17、余额 `$5`、资料完整；旧规则因默认开卡卡段为 16 将其错误标记为 `CARD_TYPE_MISMATCH`。
- 提交 `262bd4d` 修复接管规则：接受卡台当前公布的全部合法卡段，默认卡段只决定未来开卡偏好。定向回归和全量测试通过；部署 `/opt/pojia/releases/20260829-card-segments-262bd4d`。
- 将旧的错误 discovery 精确恢复为待验证并重新读取；最终 `1628` 接管成功，目录 `unresolvedActive=0`、`providerOnlyActiveCount=0`。该过程只调用卡台读取接口，没有开卡、卡充值或付款。
- 继续核验发现四个同源问题并以提交 `51a4b7a` 修复：后台不再把“可直接分配 0”展示成“没有卡”；卡读取统一使用 Plus 最低余额；可补余额卡能进入既有卡充值调度；订单分配不再错误限制为默认开卡卡段。
- 第二版生产 release：`/opt/pojia/releases/20260829-fundable-inventory-51a4b7a`。卡片读同步后，`6185` 正确为 `DEPLETED / 余额不足，充值后可重新判定`，余额 `$5`，未绑定订单。
- 生产后台事实：可直接分配 0、待补余额 1、自动补卡关闭、低库存状态 false、相关 OPEN 告警 0。
- 验证：v1 459 total / 422 pass / 0 fail / 37 environment-skipped；全新临时 MySQL 8.4 四个集成套件 37/37；生产 readiness `ok=true`、公网 ops/plus ready 200、`pojia-ops check` 和最新加密备份完整性通过。
- 所有资金写开关、接单、派发、Browser 付款、自动开卡和卡余额充值继续关闭；本轮没有执行真实资金动作。

## 2026-08-29｜部署后卡片库存只读同步复验

- 通过已登录生产后台“卡片库存 → 只读同步全部”，加入 7 张卡队列，等待后刷新完成；未执行任何 Provider/资金写入。
- 卡 1477/6807：状态 `invalidating`、已分配、余额 `0.07 USD`、资料/交易同步 `08/29 09:50`；`CARD_RECHARGE 16 USD` 与 `PURCHASE 15.93 USD` 成功交易证据已显示。
- 订单 `PJV1-FqFnMiSKBtLGN14GyP7W`：充值成功、三方一致、卡片核对 15 分钟内已更新、平台金额 `982.140000 PHP`、直充单号 `6294`。
- 库存：可分配 0、使用中 1、暂不可用 1、永久停用 17；卡台余额 `$47.36`、剩余开卡额度 292、自动补卡关闭。
- Console 仅有 CSP inline-style 阻止错误；业务只读 GET 请求均 200。详细报告：`docs/2026-08-29_card-inventory-readonly-sync-verification.md`。
- 下一步：由统筹窗口审查报告；保持所有资金写开关关闭，不部署额外变更。

## 2026-08-29｜卡段人工刷新与持久默认选择（已部署）

- 新增管理员卡片库存卡段人工刷新入口及后端路由 `POST /api/v1/admin/card-stock/provider-refresh`；仅调用 Provider `cardTypes/accountBalance` 只读接口并更新既有 snapshot，不执行开卡、充值或付款。
- 新增默认卡段保存路由 `POST /api/v1/admin/card-stock/default-card-type`，校验当前新鲜 snapshot 中的合法卡段后写入既有 `app_settings.default_card_type_id`。
- 前端卡段下拉变更后持久保存，普通库存刷新不触发 Provider 读取；未恢复高频自动读取。
- 测试：`npm test` 全量 461，424 通过、0 失败、37 环境跳过；新增路由认证/调用测试通过。
- 已部署至 `/opt/pojia/releases/20260829-card-segment-58dfe0d`；Web/Worker 与健康检查正常。管理员页面按钮的最终交叉验收仍待完成。

## 2026-08-29｜低复杂度“开始营业”入口（未部署）

- 新增后台“开始营业”按钮及 `POST /api/v1/admin/operations/start-business`。
- 入口先只读检查服务概览、数据库可用性、卡台规则/余额、默认卡段及库存；可分配库存为 0 时明确返回“可用卡库存不足（可分配/待补余额）”，不误报卡台故障。
- 检查通过后仅开启接收新订单与既有自动派发开关；不自动开卡、不自动充值，Provider 写入闸门保持独立。
- 本地 `npm test`：462 total / 425 pass / 0 fail / 37 skipped。尚未部署或生产验证。

## 2026-08-29｜库存刷新按钮语义澄清（未部署）

- 将补卡执行记录的“刷新”改为“刷新本地列表”，成功后明确提示“本地列表已刷新（未同步卡台）”。
- 将“只读同步全部”改为“同步卡台余额和交易”，避免运营误把本地 GET 刷新当成卡台同步。
- 仅修改文案与成功反馈，不改变接口、任务或资金行为；尚未部署。

### 部署更新

- 已从生产基线 `58dfe0d` 单独制作安全发布提交 `ef5afd5`，不包含延期的“开始营业”入口。
- 已部署 `/opt/pojia/releases/20260829-card-refresh-ef5afd5`；Web、Worker、卡片只读同步/目录同步定时器及健康检查正常。

## 2026-08-29｜Browser attempt/run 执行配置绑定已合入主线（未部署）

- Browser 独立线提交 `1d02c78` 已由统筹逐项审查，并以主线提交 `d6f9bf3` 合入；只带入本轮 Browser 代码、测试和运行报告，没有合并 Browser 分支历史。
- 修复内容：共享 adapter 显式读取 `recharge_attempts.executor_profile_id`，要求它与 `browser_runs.executor_profile_id` 一致；权威付款 snapshot 再次核对并纳入 `executorProfileId`，漂移错误码为 `EXECUTOR_PROFILE_CONFLICT`。
- 主线复验：`npm --prefix browser-mvp run check` 通过；adapter/runtime/repository 定向测试 **46/46 passed**。
- 随后执行 v1 全量回归：465 total / 428 pass / 0 fail / 37 environment-skipped。
- 边界：本轮未部署生产 Browser Worker、未连接生产、未读取真实 Session/PAN/CVC、未填卡、未付款，也未改变生产写开关。

## 2026-08-29｜第二单真实 API 全链路成功

- 客户提交 CDK + Session 后创建订单 `PJV1-uVsqgepiEHu3tfpQKQq-`；使用卡 `1628/6185`。
- 用户当次明确允许真实付款后，临时打开 recharge-specific 写入并签发单笔 Permit；`create_direct` 仅调用 1 次，外部订单号 `7025`。
- 最终订单 `RECHARGE_SUCCESS`，平台金额 `982.140000 PHP`，Plus 已开通且自动续费已取消；attempt 为 `SUCCESS/SETTLED`。
- 完成后 Provider 账户写权限恢复为 false，Permit 撤销；readiness `ok=true`，活动任务、UNKNOWN 调用、活动资金风险和开放对账案件均为 0。
- 卡台读到 `PURCHASE 15.76 USD`；05:59 UTC 再同步后余额由 `$16.00` 降至 `$0.24`，扣减金额一致。交易状态仍为 `PROCESSING`，后续只读补证，不重付。
- 现场发现 15 分钟分配新鲜度与 60 分钟定时同步错配；主线已实现仅在真实订单等待时按需同步一张过期候选卡的低 API 调用修复，测试 466 total / 429 pass / 0 fail / 37 skipped；随后已按下述安全分支部署。
- 详细证据：`docs/2026-08-29_second_api_real_order_verification.md`。

### 按需同步缺陷安全部署

- 用户明确确认部署。为避免把主线中延期的“开始营业”和 Browser 代码带入生产，从当前生产基线 `ef5afd5` 制作仅含三处运行时/测试变更的安全提交 `bba4105`。
- 安全分支回归：464 total / 427 pass / 0 fail / 37 environment-skipped。
- 部署前备份：`/var/backups/pojia/pojia-20260829T060414Z.sql.gz.enc`，加密备份完整性通过。
- 新 release：`/opt/pojia/releases/20260829-order-demand-sync-bba4105`；回滚点：`/opt/pojia/releases/20260829-card-refresh-ef5afd5`。
- 部署后 Web、Worker、卡片只读同步/目录同步、Bark 均 active；readiness `ok=true`，活动任务/未知调用/资金风险/对账案件均 0；Provider 三个写开关均 false；ops/plus 四个 live/ready 均 HTTP 200。

### 按需同步真实 MySQL 回归补齐

- 新增集成用例覆盖真实订单遇到一张交易证据超过 15 分钟、但资料/余额/绑定均安全的候选卡。
- 全新临时 MySQL 8.4、migration 001–040 下验证：第一次只创建一个 `PENDING / requested_by=worker` 的单卡只读任务，订单进入 `WAITING_FOR_CARD`；第二次调用不重复排队；卡不提前绑定、无 Provider 调用。
- `mysql-integration.test.js` 34/34 通过；v1 无数据库全量 467 total / 429 pass / 0 fail / 38 environment-skipped。
- 此项只补测试，不需要再次部署生产。

### 第二单卡台交易低频补证

- 2026-08-29 07:16 UTC 只针对 `1628/6185` 排入一次只读同步；任务正常 `COMPLETED`。
- 卡余额仍为 `$0.24`；`agg_tx_3eskrt48lubis` 仍为 `PURCHASE 15.76 USD / PROCESSING / UNSETTLED`。
- 该状态只表示卡台尚未给出最终结算，不改变订单成功、取消续费和禁止重付结论。

## 2026-08-29｜Browser 首次灰度前只读就绪补强已合入（未部署）

- Browser 窗口提交 `2fd3aa0` 已由统筹审查，并以主线提交 `1516c67` 合入。
- production-readonly readiness 现在强制 migration 039/040；直接 CLI 与 systemd 一致要求 payment executor=false/MOCK；补充 Browser-only stop/disable/回滚入口。
- 主线复验：语法检查通过；Browser 90 tests / 86 pass / 0 fail / 4 environment-skipped。
- 仍缺 production Session/card-material adapter、真实 ChatGPT 非付款观察、LIVE payment/post-payment adapter 和服务器部署/回滚演练；未部署、未真实付款。

## 2026-08-29｜Browser 共享密文材料 adapter 已合入（未部署）

- Browser 独立线提交 `ddad4f1` 经统筹审查与复验后，以主线提交 `58c0d4e` 合入。
- adapter 只凭当前 `browser_run` 读取 v1 现有 `orders.session_ciphertext`、`cards.card_credentials_ciphertext`，并强制 run/attempt/order/profile/route/provider 以及消费预留一致；不建第二份材料库、不调用卡台。
- readonly lane 只注入 Session cookie 做页面观察，卡资料只做内存格式/绑定预检；`fieldsWritten=0`、`submitCalls=0`，随后 safe-abort 清理资金栅栏。
- 统筹复验：Browser 94 total / 90 pass / 0 fail / 4 environment-skipped；production-readonly smoke 的配置/systemd 9/9、隔离 MySQL + CLI/Chrome 3/3 通过。
- 未部署、未连接生产、未读取真实 Session/PAN/CVC、未访问真实 ChatGPT、未付款。下一缺口是保持付款关闭的真实 ChatGPT 只读登录/身份/页面观察。

## 2026-08-29｜Browser ChatGPT 账号/Checkout 只读 harness 已合入（未部署）

- Browser 独立线提交 `7abbe51` 经统筹审查后，以主线提交 `7065b60` 合入。
- 新增一次性 `CHATGPT_ACCOUNT_CHECKOUT` harness：Session bootstrap → `/api/auth/session` 身份逐项匹配 → 同页面订阅状态检查 → 免费账号才继续 Plus 入口和 Checkout 只读识别 → `abortBeforePayment`。
- 真实观察阶段只读取订单 Session，不解密或读取 PAN/CVC；不会点击付款、不创建付款 permit、不调用 Provider。
- 对抗式审查修复：身份不再“任一字段匹配即通过”；订阅接口漂移独立归类为 `ACCOUNT_STATUS_UNKNOWN`；Session/card 读取前立即复核租约；真实观察不再无必要读取卡资料。
- 统筹复验：Browser 99 tests / 95 pass / 0 fail / 4 skipped；production-readonly smoke 配置/systemd 10/10，隔离 MySQL + Chrome 3/3；`git diff --check` 通过。
- 未部署、未访问真实 ChatGPT、未读取真实 Session/PAN/CVC。下一步只需一次性准备专用非客户测试账号的隔离订单/Session、身份摘要、批准网络出口与 Chrome 主机，然后执行只读观察并冻结真实合同。
## 2026-08-29｜ChatGPT 只读观察复验与当前停止点

- 输入：用户提供的 Session 文件；仅在隔离 MySQL + Headful Chrome 使用，原文不进入输出或持久化。
- 已证实：页面和 `/api/auth/session` 可达；身份匹配；订阅为 `FREE`；未填卡、未付款、`submitCalls=0`。
- 已修复：只读 Checkout 结果字段命名导致安全检查误报；ChatGPT 首页官方标题存在副标题变体导致页面漂移误报。
- 最新复验已通过 Checkout 只读阶段：登录、身份、免费订阅、Plus 入口、Checkout 和安全字段均成功，`submitCalls=0`；尚未进入付款。
- 已新增付款通道设计合同：先 Mock 回归，再单独确认后实现 LIVE 适配器，成功必须同时确认付款、Plus 激活和取消续费；未知结果禁止重付。
- Mock 回归已完成：14 项通过、0 失败；LIVE 适配器仍明确不可用，未连接生产或执行真实付款。
- 付款执行器对抗复查修复：付款确认后核验器/记录器异常现在返回结构化 `POST_PAYMENT_UNKNOWN`，不再冒泡为可能重试的错误；新增测试通过。
- 新增 `browser-mvp/src/live-chatgpt-payment-adapter.js`：默认禁用、精确确认词门禁、付款结果无观察器则强制 UNKNOWN；测试 2/2 通过，未接生产。
- 复查并补强提交后卡字段清理；未知或异常结果不形成重试路径，测试保持 2/2 通过。
- BrowserPaymentExecutor 现在显式把 page 传给适配器，其他层不接触页面/卡字段；付款状态测试 7/7 通过。
- 对抗复查发现：LIVE 适配器原先在 operationId 缺失时可能先完成页面填写甚至点击，再报参数错误；且观察结果未携带提交选择器。现已在副作用前校验并补齐合同字段；新增测试通过（commit 99dd076）。
- 后续联调确认安全字段名映射与当前选择器一致；新增 3DS/挑战异常清理测试，全量测试 102 通过、0 失败、4 跳过。
- 根据统筹确认，付款门禁仅保留防重复付款、结果可追踪和基础绑定等硬条件；3DS/验证码及付款后核对均按实际出现/需要触发，不提前阻断正常流程（commit af619c5）。
- 已完成门禁收敛复查并记录：106 测试中 102 通过、0 失败、4 因缺少测试数据库跳过；生产付款仍关闭。
- 错误分类进一步明确：付款前确定性问题为 `PRE_SUBMIT_FAILED`（可修正）；付款后不确定性为 `PAYMENT_RESULT_UNKNOWN`（只对账、不重付）。
- Browser 离线 soak 已运行成功；没有生产网络或资金写入。
- 生产部署模板和只读 smoke 配置复核通过：Browser 付款开关为 false、模式为 MOCK。
- 状态更正：此前“真实付款前就绪”仅指代码/隔离测试层；Browser 旧 worktree 报告仍显示生产 Session/card adapter、真实非付款观察和部署演练未完成，当前不得进入真实付款。
- Browser worktree `7abbe51` 与主线不兼容，直接合入会删除/回退主线后续付款门禁和文档；已改为逐文件选择性比较，不直接 cherry-pick。
- Browser 最新报告确认无新增提交；下一步为备份差异后可逆对齐 `main@a6ba908`，再判断是否存在可安全恢复的最小只读补丁。
- 已建立标签 `browser-stale-7abbe51-backup` 保存旧分支，当前主线未合入其差异。
- 已执行可逆对齐：`codex/browser` 现在指向 `main@9093c03`，旧分支保存在 `browser-stale-7abbe51`；对齐后全量测试通过（103/107，4 跳过）。
- 对齐后只读 Worker smoke 成功（含隔离 MySQL 与安全门禁）；未连接生产、未付款。
- 已生成未部署候选归档 `/tmp/aicharge-main-46b2cc7.tar`；check、全量测试和 diff 检查通过。
- 已整理生产只读演练手册；实际演练需 SSH 会话，尚未执行。
- 生产只读启动演练发现当前 release 缺少 Playwright 依赖，已 stop/disable 清理，未产生付款或 Provider 写入；补齐依赖前禁止再次启动。
- 补齐依赖后的候选启动继续暴露 `INVALID_BROWSER_WORKER_CONFIG`；已恢复旧 release、reset-failed 并保持服务 disabled。下一步是对齐只读 env 合同。
- 已对齐只读 env 合同并完成候选 release 的 READY/IDLE 启动、停止和回滚；当前服务 inactive/disabled，无资金写入。
- 已建立余额不足卡付款前停止测试手册；原始 Session 不落盘，仅记录脱敏摘要和流程证据。
- 根因定位：官方方案弹窗的“升级至 Plus”按钮为表单外 `type=submit`，旧规则过宽导致假失败；现已改为只拒绝表单内提交控件，并补充说明。
- 权威收口：订单 `CARD_READY`；attempt/funds `CLEARED`；run `FAILED_SAFE`；dispatch `CANCELLED`；无活动 permit、付款提交记录或资源租约。
- 未部署、未执行真实开卡/卡充值/付款；下一步是继续只读定位 Checkout 导航失败并补测试，之后再更新本文件与 Browser 合同。
# 2026-08-30｜Browser 生产形态非付款安全窗口

- 已备份生产 Browser env、systemd 单元和控制面状态；备份目录：`/var/backups/pojia/browser-nonpayment-20260830T084134Z`。
- Browser Worker 使用 `EXTERNAL_READONLY + SHARED_ENCRYPTED_NONPAYMENT + CHATGPT_ACCOUNT_CHECKOUT` 通过配置检查并 READY/IDLE；付款执行器保持 `false/MOCK`，Provider/卡台写入全部关闭。
- 临时切换默认充值方式为 Browser，通过正常客户入口使用测试 CDK 创建订单 `PJV1-TZmbNEpYNd0Gs_YgRKF_`；数据库确认订单创建时正确冻结 Browser route。
- 正常派发在分卡阶段以 `CARD_STOCK_EMPTY` 停止，订单进入 `WAITING_FOR_CARD`。生产没有余额达到 `$16` 的可分配 Plus 卡，因此未创建 recharge attempt、Browser job/run/lease，也未访问 ChatGPT。
- 已纠正此前“使用余额不足卡仍可沿真实订单链路进入 Checkout”的错误计划：真实生产链路必须先通过卡片余额和可分配资格，不允许靠改库或降低最低余额绕过。
- 测试订单已通过正式取消服务关闭；CDK 已兑换并绑定该订单，不得复用。默认 API、接单/派发、Browser gate/Worker/env 已全部恢复。
- 恢复后活动 task、ACTIVE/UNKNOWN attempt、Browser job/run/lease 均为 0；Web/API Worker active，ops/plus 四个公网 live/ready 均为 HTTP 200。
- 详细报告：`docs/2026-08-30_browser-production-nonpayment-window-result.md`。

# 2026-08-30｜按明确指令手动开卡

- 通过正式库存任务服务创建并执行 1 张、金额 `$16`、卡段 `16` 的手动开卡任务；预计总扣款 `$16.58`。
- Provider 当时规则快照显示开卡允许、账户余额 `$36.30`、剩余额度 `292`；自动补卡保持关闭。
- 任务 `986d345d-e4b6-4ad6-b770-ef447c3b6f74` 完成，新增卡 Provider id `1839`、尾号 `1013`，余额 `$16.00`，已同步接管为 `AVAILABLE / ACCEPTED`，未绑定订单。
- 仅临时进程开启 `PROVIDER_CARD_WRITES_ENABLED=true`；常驻服务及其他 Provider 写权限未开启；未创建订单、未充值、未付款。
- 详细报告：`docs/2026-08-30_manual-card-opening-result.md`。

# 2026-08-30｜启用“无卡自动补卡”

- 用户明确要求没有可分配卡时自动补卡，不再逐单人工确认。
- 生产设置：`card_auto_replenishment_enabled=true`、`card_stock_low_threshold=0`、`card_replenishment_daily_limit=5`；默认卡段/金额为 `16` / `$16`。
- `pojia-card-stock-runner.timer` 已 `active/enabled`，每 10 秒检查；当前 1 张可分配 Plus 卡，最近日志为 `STOCK_SUFFICIENT`，没有新增开卡。
- 自动任务执行前仍校验 Provider 规则、账户余额和目录；充值/付款写入保持关闭。
# 2026-08-30｜订单驱动补给提交部署

- 用户确认部署 `main`；从提交 `dd0037b` 构建不可变 release `/opt/pojia/releases/20260830-order-replenishment-dd0037b`。
- 部署前回归：v1 `439 pass / 0 fail / 38 skipped`；Browser `103 pass / 0 fail / 4 skipped`；`git diff --check` 通过。
- 部署前 release `/opt/pojia/releases/20260830-browser-routing-4dadf79` 保留为回滚点；通过原子切换更新 `/opt/pojia/current`。
- 生产验证：Web/Worker active；`pojia-ops status` 正常；ops/plus live/ready 均 HTTP 200。
- Browser Worker `disabled`；Provider 写入、卡台写入、真实付款均未开启或执行。
- 未执行开卡、补余额、提交订单或任何资金写入；本次仅发布订单驱动补给逻辑。

# 2026-08-31｜一卡多单与自动补余额联合版本生产部署

- 用户已确认部署候选提交 `068c070e06d31cbe284438c62e48efae8f66cab0`。
- 目标 release：`/opt/pojia/releases/20260831-card-reuse-068c070`；部署前回滚点：`/opt/pojia/releases/20260831-preflight-8da5127`。
- 依赖安装首次因 `/opt/pojia/.npm` root-owned 缓存失败；未影响旧 release。随后使用 `/tmp/pojia-npm-cache-068c070` 独立缓存成功安装 v1 与 browser-mvp 依赖，语法检查通过。
- 生产 migration 042/043 已执行；第二次迁移全部 `already applied`。最新迁移为 `043_order_assigned_card`。
- 原子切换后 Web/Worker active，库存 runner timer active/enabled；Browser Worker inactive/disabled，card funding timer inactive/disabled。
- 本地/公网 live 与 ready 均返回正常；`pojia-ops check` 通过，最新加密备份 `/var/backups/pojia/pojia-20260830T235805Z.sql.gz.enc` 完整性 OK。
- 部署后只读 readiness：`ok=true`、`latestMigrationNumber=43`、活动任务/过期租约/未知 Provider 调用/资金风险/开放对账案件均为 0，`blockers=[]`；接单与派发保持部署前 `true`，未擅自改变。
- 发现并修正候选 unit 描述与生产 timer 漂移：生产原为 10 秒触发，已更新为 60 秒；候选 `deploy/server/pojia-card-stock-runner.timer` 同步修正。runner 日志显示连续 `NO_DEMAND`，无额外开卡。
- Provider 写权限仍保持关闭：`PROVIDER_WRITES_ENABLED=false`；常驻 Web/Worker 的卡台与充值写权限均关闭，未执行真实开卡、补余额、付款、退款或提现。

# 2026-08-31｜一卡多单与自动补余额部署后只读验证

- 部署后只读复核通过；详细报告：`docs/2026-08-31_card-reuse-post-deploy-verification.md`。
- 当前 release、迁移 043、Web/Worker、库存/读同步/Bark、Browser Worker 与卡资金 timer 状态均符合预期；本地/公网 live/ready 正常。
- readiness `ok=true`，活动任务、过期租约、未知 Provider 调用、资金风险和开放对账案件均为 0；`pojia-ops check` 与备份完整性检查通过。
- 本轮未执行任何资金写入；库存 runner 最近执行均为 `NO_DEMAND`。

# 2026-08-31｜部署后全量回归与测试修正

- 生产部署后的本地回归完成：legacy/Vitest `14 files / 87 passed / 0 failed`；v1 `483 tests / 443 passed / 0 failed / 40 skipped`；Browser `107 tests / 103 passed / 0 failed / 4 skipped`。
- 发现并修正一个测试框架问题：`test/browser-nonph-manifest.test.js` 使用 `node:test` 被 Vitest 识别为“无测试套件”；改为 Vitest `test` 导入后，根级 legacy 回归完整通过。
- 该修正仅影响测试发现，不改变生产运行逻辑；`git diff --check` 通过。

# 2026-08-31｜下一阶段并行任务启动

- 主线已进入运营控制面收敛阶段：先统一就绪结果/开始营业反馈，再收敛首页入口与错误跳转。
- Browser 窗口已重新安排非付款兼容性复核：以 `main` 最新基线检查一卡多单容量、自动补余额、默认充值方式及 15 分钟交易证据门槛的兼容性；明确禁止真实付款及 Provider/卡台写入。
- 本轮主线已完成生产只读与全量回归，等待 Browser 线报告后做统一判断。

# 2026-08-31｜运营控制面就绪摘要第一批实现

- 新增只读服务 `v1/src/services/admin-readiness-summary.js`，将卡台规则、卡片库存、Browser 执行器状态统一转换为稳定 `checkId/status/actionId/message` 摘要。
- 新增管理员只读接口：`GET /api/v1/admin/operations/readiness`；不执行写操作、不放宽任何资金或库存门禁。
- 状态分类：`READY`、`ACTION_REQUIRED`、`BLOCKED`；Browser 未就绪只作为动作提示，不阻断 API 充值。
- 新增 2 个单元测试；语法检查及定向 v1 回归通过（84/84）。
- 尚未部署；待后续补齐首页展示/跳转后制作候选 release，并按生产部署闸门单独确认。

# 2026-08-31｜运营后台控制面第二批：就绪卡片与跳转

- 首页新增“系统就绪情况”卡片，读取 `GET /api/v1/admin/operations/readiness`，展示 READY/ACTION_REQUIRED/BLOCKED 三类结果。
- 每个需要处理的项目提供稳定 actionId 跳转：卡台规则/卡片库存/Browser 状态；不按中文文案判断，不自动打开 Provider 或资金写权限。
- 管理后台资源版本由 v18 升至 v19，避免旧缓存继续显示旧页面。
- v1 全量回归：485 tests / 445 passed / 0 failed / 40 skipped；静态语法与 diff 检查通过。
- 代码尚未部署生产；待 Browser 兼容复核和候选发布前检查完成后统一制作 release。

# 2026-08-31｜Browser 多订单复用兼容修正合入主线

- Browser 窗口完成并提交 `4591ce3`；统筹审查后已合入 main（`6742248`）。
- 修正 Browser 上游投影、共享密文材料读取和付款前权威快照：优先使用 `orders.assigned_card_id` 绑定复用卡，旧订单继续使用 `cards.order_id` 兼容回退；消费账本/attempt 绑定保持不变。
- 新增兼容性报告：`docs/browser-research/BROWSER_CARD_REUSE_COMPATIBILITY_2026-08-31.md`。
- 回归：Browser `109 tests / 105 passed / 0 failed / 4 skipped`；v1 `486 tests / 446 passed / 0 failed / 40 skipped`。
- 本次只改代码与测试，未部署生产、未启动 Browser Worker、未执行 Provider/卡台写入或付款。待控制面改造与 Browser 兼容改动合并后统一制作候选 release。

# 2026-08-31｜控制面与 Browser 兼容候选已就绪

- 候选 release `/opt/pojia/releases/20260831-control-browser-0a6e651` 已构建、上传并安装依赖；当前生产未切换。
- 候选 SHA-256、全量测试、只读 readiness 和部署边界见 `docs/2026-08-31_control-browser-candidate-release.md`。
- 首次候选依赖安装因解压文件为 root 所有而失败；确认候选不是 current 后修正候选目录所有权并成功重装，线上服务未受影响。
- 下一动作仅为经确认后的生产原子切换与部署后只读验收；不会联动开启 Browser/Provider/卡资金写入。

# 2026-08-31｜候选部署前对抗式审查与修正

- 原 `0a6e651` 候选经真实场景代入发现三项阻塞：默认 API 被 Browser 未启动误报、开始营业与无卡自动补卡相互矛盾、失败只返回不可操作的 internal_error；另发现 overview 重复读取。
- 上述问题已直接修正，原候选作废，不得部署；详细审查见 `docs/2026-08-31_control-browser-candidate-adversarial-review.md`。
- 修正后全量回归：Legacy 87/87；v1 448 passed / 0 failed / 40 skipped；Browser 105 passed / 0 failed / 4 skipped。

# 2026-08-31｜对抗修正后替代候选就绪

- 新候选 HEAD `973cb72`，release `/opt/pojia/releases/20260831-control-browser-973cb72`，SHA-256 `4dfc7d61772bed83e74ff9167a9c29505ab19ffaad32c9b4e9370103bae37864`。
- 依赖安装、语法、全量测试和生产只读 readiness 均通过；当前生产仍为 `068c070`，未切换、未产生资金写入。

# 2026-08-31｜自动补余额生产缺口修正与候选完成

- 用户指出原计划要求自动补余额与当前批次一起完成。复查确认：虽然账本、migration 042/043 和订单侧 PREPARED 已存在，但生产 funding timer 关闭，且旧 service 权限合同会导致启用即失败，因此此前不能称为完成。
- 已以 `95ee5ad` 完成订单驱动自动补余额收口：独立生产 gate、5 秒任务领取、15 秒低调用量对账、资金中卡片不可分配、Provider 接受后本地落账失败锁 UNKNOWN、对账后库存恢复、取消订单清理未提交补给任务，并删除无订单全库存预充 scheduler。
- 隔离 MySQL 与全量验证结果、生产只读预检和启用边界见 `docs/2026-08-31_order-driven-card-funding-production-candidate.md`。
- 当前生产仍为 `/opt/pojia/releases/20260831-control-browser-973cb72`；`card_balance_recharge_enabled=false`，funding timer inactive/disabled；本轮尚未执行卡余额充值或其他资金写入。
- 下一步：发布 `95ee5ad` 但保持独立 funding gate 关闭，完成发布后只读验收；随后仅在用户明确确认后开启生产补余额并执行一次真实小额验收。通过后进入 3–5 单连续真实订单阶段。


# 2026-08-31｜订单驱动自动补余额版本已发布（资金门禁未开启）

- 用户已确认发布；生产已原子切换至 `/opt/pojia/releases/20260831-order-funding-c185d19`，回滚点为 `/opt/pojia/releases/20260831-control-browser-973cb72`。
- 部署前加密备份 `/var/backups/pojia/pojia-20260831T015201Z.sql.gz.enc` 完整性通过；旧 funding unit 备份在 `/var/backups/pojia/funding-units-20260831T015159Z`。
- Web/Worker 和公网健康通过；只读补余额对账 timer 已重启并按 15 秒运行；funding timer 继续 inactive/disabled，`CARD_FUNDING_EXECUTION_ENABLED=false`、`card_balance_recharge_enabled=false`。
- 生产无 PREPARED/ACTIVE/UNKNOWN funding attempt、无 WAITING_FOR_CARD 订单；未执行任何资金写入。
- 下一步不是跳过自动补余额进入放量，而是由用户一次确认后受控开启独立 funding gate、数据库能力开关和 funding timer，并选择一张允许补余额的卡做一次真实小额验收。


# 2026-08-31｜订单驱动自动补余额生产开启

- 用户明确确认“开启”。第一次开启脚本在写入任何配置或数据库前因 Node heredoc 语法错误退出；现场复核确认 timer 仍 disabled/inactive、drop-in 不存在、数据库仍为 false，因此没有半开启状态。修正脚本后一次完成开启。
- 当前 release：`/opt/pojia/releases/20260831-order-funding-c185d19`；开启前备份：`/var/backups/pojia/funding-enable-20260831T020605Z`。
- systemd drop-in：`/etc/systemd/system/pojia-card-funding.service.d/production-enabled.conf`，`CARD_FUNDING_EXECUTION_ENABLED=true`；funding timer active/enabled。
- 数据库 `card_balance_recharge_enabled=true`；审计事件已写入，actor `deployment:card-funding-enable`，reason “用户确认开启订单驱动自动补余额”。
- 开启后无 WAITING_FOR_CARD、无 PREPARED/ACTIVE/PENDING/UNKNOWN funding attempt；开启时间后没有 `card_recharge` Provider call。runner 连续 `{"handled":false}`，空闲未产生 Provider API 调用。
- Web/Worker active；reconcile timer active/enabled；Browser Worker inactive/disabled；ops/plus live/ready 四项 HTTP 200；`pojia-ops check` 与备份完整性通过；最近相关日志无 warning/error。
- 未执行真实开卡、补余额、API/Browser 付款、退款或提现。下一停止点为首笔真实订单驱动补余额验收；这一步尚未完成。


# 2026-08-31｜统一项目规划地图建立

- 用户要求把“运营控制面收敛与自动补给”、整个项目规划和总体进度合并成一张持续更新的地图，避免多份旧计划和聊天上下文导致遗忘或跑偏。
- 新增 `docs/PROJECT_MAP.md`：统一记录最终目标、架构、全部板块状态、当前工作线、退出条件、唯一执行顺序、不做事项和维护规则。
- `docs/ACTIVE_WORKSTREAM.md` 已收敛为地图入口；`CLAUDE.md`、接班阅读指南和 `ROADMAP.md` 已将地图设为新窗口首读和唯一执行顺序来源；旧 `MASTER_EXECUTION_PLAN_2026-08-28.md` 明确降级为历史阶段证据。
- 对抗核对时同时修正旧事实漂移：当前生产 release 已含 Browser 共享兼容代码；funding timer 已开启；默认路线实时核对为 API；每卡成功次数生产值为 3；D-094/D-095/D-108/D-110–D-113 状态已更新。
- 当前唯一下一步不变：首笔真实订单驱动自动补余额验收；随后 3–5 单连续 API 运营验证。Browser 非付款联调并行，不自行真实付款。

# 2026-08-31｜项目地图前端/后端/生产统一对抗核查

- 已按运行事实重新核查 `PROJECT_MAP.md`、运营后台、订单 Worker、自动补给、生产 release/MySQL/systemd/logs。
- 确认 P0：生产接单、派发和默认 API 已开启，但 Worker `PROVIDER_RECHARGE_WRITES_ENABLED=false`，旧后台和只读 readiness 均漏检，不能宣称当前可自动完成 API 新订单。
- 主线候选已增加 Worker 真实充值能力心跳、后台假就绪阻断和 readiness blocker；Web 不隐式开启资金权限。
- 同批修复空闲自动开卡重复 Provider 刷新、取消订单遗留等待卡提醒、余额 info 污染内部提醒、自动补给开启仍产生低库存人工提醒；新增 migration 044。
- 全新 MySQL 8.4 migration 001–044 与定向集成通过；v1/Browser/legacy 全量回归通过。生产尚未部署、未改变任何资金权限或执行资金写入。
- 详细证据：`docs/2026-08-31_project-map-full-stack-adversarial-audit.md`。下一停止点是候选提交后，部署前一次性确认是否长期开启最小 API 充值执行权限。
- 最终候选 HEAD `d5fb3cf`，服务器目录 `/opt/pojia/releases/20260831-map-audit-d5fb3cf`，归档 SHA-256 `71038bb373b95c49b1ff1124337c8fa42659da3283a547ba5ebea122ec1cc8c6`；候选未切流。只读运行候选 readiness 已准确返回 `api_recharge_execution_disabled`，证明假就绪修复能够识别当前生产冲突。

# 2026-08-31｜生产付款前暂停演练清理

- 按用户确认部署并完成 hold 演练后，保留候选 release `/opt/pojia/releases/20260831-prepayment-hold-55b6ec4` 作为可回滚证据；`/opt/pojia/current` 仍指向该 release。
- 测试订单 `PJV1-0RcrjBEOL6senGnzqW7e` 通过 `markAttemptRejected` 正式收敛：订单 `RECHARGE_FAILED`；attempt `7b2ad429-608c-4590-aaf5-acb0b7012179` 为 `CLEARED/CLEARED`，资金栅栏释放，完成时间 `2026-08-31T04:43:06.226Z`；测试 task 保持 DEAD，不会自动重试。
- 原本的 `provider_calls.create_direct` 意图记录已由 `STARTED` 收敛为 `FAILED`，无 HTTP 状态、无完成外部订单号；未执行真实充值、付款、开卡、卡充值或提现。
- 已关闭并移出临时 systemd drop-in `/etc/systemd/system/pojia-worker.service.d/prepayment-hold.conf`（保留为 `.completed-20260831` 备份），daemon-reload 后重启。
- 当前生产 Worker 环境恢复最小默认权限：`PROVIDER_READS_ENABLED=true`，通用 Provider/卡片/充值写入均为 `false`；Web/Worker 均 `active`。未恢复任何真实充值权限。

# 2026-08-31｜规划地图权威纠偏

- 发现并实际修正事实源漂移：旧地图/CURRENT_STATE 仍写 map-audit release、API 权限 true、readiness 通过，但现场 current 已为 `20260831-prepayment-hold-55b6ec4`，Worker API 充值权限 false，readiness 唯一 blocker 为 `api_recharge_execution_disabled`。
- 现场复核：接单/派发/自动开卡/自动补余额均 true；每卡成功次数 3；Provider recharge account write_enabled=1；Web/Worker active、Browser inactive/disabled；活动任务/资金风险/开放对账均为 0。
- 代码复核：“开始营业”只检查路线、执行器和卡供给，随后打开接单+派发；不会打开 systemd/Provider 权限。API 权限关闭没有 actionId/后台跳转，不能再宣称所有错误均可跳转。
- 已重写 `PROJECT_MAP.md`、`CURRENT_STATE.md`、`ACTIVE_WORKSTREAM.md`，在 `ROADMAP.md` 顶部标明旧快照过期；详细报告 `docs/2026-08-31_project-map-authoritative-reconciliation.md`。
- 当前唯一下一步：恢复已确认的 API 常驻最小充值权限并重跑 readiness，然后再接下一笔真实 API 订单。本轮未修改生产或执行资金动作。

# 2026-08-31｜规划地图第二轮完整性补强

- 在权威地图纠偏后，继续按代码/生产证据补齐完整运行模型，新增 `docs/PROJECT_OPERATING_MODEL.md`。
- 总册覆盖：端到端业务链、开始营业检查/跳转矩阵、自动补余额/开卡状态机、API/Browser 双线、库存最小模型、资金幂等、Bark/对账/费用监控、部署备份回滚、分阶段验收、已知缺陷/未验证项、事实/决策/建议分层和文档职责。
- 14:05 CST 再次现场复核：current 仍为 `20260831-prepayment-hold-55b6ec4`；Web/Worker active，Browser inactive；自动开卡/funding/reconcile timers active；Worker 通用 Provider、卡片、API 充值写仍均为 false。未修改生产或执行资金动作。
- `PROJECT_MAP.md`、`CURRENT_STATE.md`、`ACTIVE_WORKSTREAM.md` 与 `CLAUDE.md` 已加入总册入口。地图继续只负责方向和顺序，不把全部细节塞回单页。

# 2026-08-31｜规划地图最后一轮定向对抗审查

- 16:05 CST 再次只读核对生产：current 仍为 `20260831-prepayment-hold-55b6ec4`；Web/Worker active、Browser inactive/disabled；接单/派发=true、默认 API；Worker API 充值写=false；readiness 唯一 blocker `api_recharge_execution_disabled`，活动任务/资金风险/开放对账均 0。
- 明确普通 Worker 卡片写=false 与独立自动补给权限不是一回事：stock/funding/reconcile timers active/enabled，独立 runner 保留窄范围卡片写。card Provider account 当前 read=1、write=0、circuit=CLOSED，但 stock/funding runner 不以该 `write_enabled` 为门禁；这是待收敛的字段语义不一致，不是当前自动补给 blocker。
- 当前可立即分配卡只有 Provider `1839`/尾号 `1013`/`$16.00`；`6807/1477` 因 Provider `invalidating` + 历史 ACTIVE assignment 当前不会被系统分配，不再把“卡实际可用”误写成“系统当前可分配”。
- 修正订单资源准备缺陷：有过期证据候选时先只读同步，不同时排付费开卡；同步任务执行中改为 5 秒重试；达到 REVIEW_REQUIRED 后才允许后续无安全候选路径。一次性 MySQL 8.4 migration 001–044 定向测试 1/1 通过；尚未部署。
- 最终复验：`git diff --check` 与两个 JavaScript 语法检查通过；控制面/任务/工作流定向单测 52/52 通过；重新创建一次性 MySQL 8.4 并从 migration 001–044 验证相关集成测试 1/1 通过。
- 补齐“开始营业”真实边界：当前不检查独立补给 runner 心跳、卡 Provider account 写权限/熔断、开卡额度/资金和未决补给；营业后能力漂移也不会自动关闭已开的接单/派发。
- 更新 `PROJECT_MAP.md`、`CURRENT_STATE.md`、`PROJECT_OPERATING_MODEL.md`、`ACTIVE_WORKSTREAM.md`、`ROADMAP.md`；详细报告 `docs/2026-08-31_project-map-final-targeted-adversarial-review.md`。
- 本轮未执行任何生产写入或资金操作；`DECISIONS.md` 存在并行窗口未提交重写，本提交不覆盖、不采信。

# 2026-08-31｜恢复 API 常驻最小充值权限

- 按用户确认安装 `/etc/systemd/system/pojia-worker.service.d/api-recharge-enabled.conf`（来自仓库示例），仅将 `PROVIDER_RECHARGE_WRITES_ENABLED=true`；通用 Provider/卡片写入保持 false。
- 重启后 Worker `active`，进程环境核对：`PROVIDER_READS_ENABLED=true`、`PROVIDER_RECHARGE_WRITES_ENABLED=true`、`PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`。
- 当前默认 Plus 路线为 API，`provider_accounts.write_enabled=1/read_enabled=1`；接单与自动派发数据库开关均为 true。
- 只读 readiness：`ok=true`，`apiRechargeExecutionEnabled=true`，active tasks/expired leases/uncertain calls/active funds risk/open reconciliation 均为 0，Worker heartbeat age 14 秒，最新 migration 044；本步骤未创建订单、未付款、未调用 Provider。

# 2026-08-31｜恢复 API 常驻最小充值权限

- 用户确认后现场核对生产 `elegant-unicorn-1.localdomain`：`/opt/pojia/current` 仍为 `/opt/pojia/releases/20260831-prepayment-hold-55b6ec4`。
- `/etc/systemd/system/pojia-worker.service.d/api-recharge-enabled.conf` 已存在且明确设置 `PROVIDER_RECHARGE_WRITES_ENABLED=true`；仅保留 `PROVIDER_WRITES_ENABLED=false`、`PROVIDER_CARD_WRITES_ENABLED=false`。创建备份 `/var/backups/pojia/api-recharge-enable-20260831T104328Z`，执行 daemon-reload 并重启 Worker。
- 重启后 `pojia-worker.service=active/running`，进程环境实际为 `PROVIDER_RECHARGE_WRITES_ENABLED=true`、通用 Provider/卡片写=false；`/health/ready` 返回 `{"status":"ready"}`。
- 数据库只读核对：recharge account `zzshu/legacy-primary/RECHARGE` 为 `read_enabled=1、write_enabled=1、circuit_state=CLOSED`；card account `hnskj/legacy-primary/CARD` 为 `read_enabled=1、write_enabled=0、circuit_state=CLOSED`。接单/派发及自动补给开关仍为 true，三个补给 timer active。
- 本动作未创建订单、未读取客户 Session、未调用 Provider、未开卡、未补余额、未付款。后台管理员 readiness 细项尚待登录会话复核。
# 2026-09-01｜部署供应同步修复候选（只读验收）

- 用户确认部署候选 `main@3f23aa3`。部署前生产 preflight：`ok=true`、`blockers=[]`，活动任务/过期租约/UNKNOWN Provider call/资金风险/开放对账均为 0；并创建加密数据库备份 `/var/backups/pojia/pojia-20260831T153049Z.sql.gz.enc`（完整性 OK）。
- 新建 release `/opt/pojia/releases/20260831-supply-sync-3f23aa3`，保留旧版 `55b6ec4`；无 migration 变化。原子切换 `/opt/pojia/current`，重启 Web/Worker 及 stock/funding/reconcile timers。
- 部署后只读核对：Web/Worker 与三个补给 timer active；Worker 实际环境 `PROVIDER_RECHARGE_WRITES_ENABLED=true`、通用 Provider/普通卡片写=false；preflight `ok=true`、`blockers=[]`、heartbeat 2 秒、活动任务/资金风险/UNKNOWN Provider call 均 0。
- 本轮未创建订单、未开卡、未补余额、未调用 Provider 写接口、未付款。旧版 `/opt/pojia/releases/20260831-prepayment-hold-55b6ec4` 保留可回滚；回滚前需再次核对无活动/UNKNOWN 资金动作。

# 2026-09-01｜客户充值页重设计正式代码候选

- 将 Claude 的隔离设计原型移植到 `v1/public` 正式客户页，保留单列三步、邮箱确认主视图和页面内状态/成功；删除 mock/demo/capture 与成功弹窗。
- 确认前只在本地解析 Session 并展示 `user.email`，零订单请求；确认后才调用现有 `/orders`，查询/换 Session 继续使用现有 `/orders/status`、`/orders/session`。
- 保留防重复提交、查询码 sessionStorage 恢复、生产轮询、错误/更换 Session 流程；成功消费现有 `customerEmail/finishedAt/timeline`。
- v1 全量 466 通过、42 跳过、0 失败；Playwright 验证确认前 0 请求、确认后 1 次建单、Session 清空、SUCCESS 无 dialog、390px 无横向溢出。
- 候选未部署、未连接生产、未创建订单或执行资金动作；报告：`docs/2026-09-01_customer-recharge-redesign-production-candidate.md`。
- 正式移植复核发现首版候选遗漏 Claude 原型中的两个教程直达按钮和成功页订阅确认外链；已直接补齐，不把遗漏只留在报告中。
- 对照后端 Session 合同和旧生产轮询继续修正：教程示例补齐 `account/sessionToken`；失败文案取消未经实现的“人工已接手”承诺；`REVIEWING/ACTION_REQUIRED` 从误移植的 100 秒恢复为 30 秒。

# 2026-09-01｜客户充值页重设计生产部署

- 用户核对本地最终候选后明确批准部署。部署提交 `b4cc5ea`，release `/opt/pojia/releases/20260901-customer-ui-b4cc5ea`，回滚点 `/opt/pojia/releases/20260831-supply-sync-3f23aa3`，归档 SHA-256 `42967d32adb0be0034a21aa00c4756b6664357f057f202edaef0e1b75e72d6a4`。
- 部署前只读 readiness `ok=true/blockers=[]`，创建并验证加密备份 `/var/backups/pojia/pojia-20260901T020107Z.sql.gz.enc`。首次在候选目录安装依赖因 `pojia` 默认 npm cache 权限失败，发生在切流前；删除未完成候选并使用隔离 cache 重建后成功，生产未受影响。
- 原子切换后 Web/Worker active，三个自动补给 timer active，Browser inactive/disabled；API 充值最小权限 true，通用 Provider/普通卡片写 false。部署后 readiness 仍 `ok=true/blockers=[]`，活动任务、资金风险、UNKNOWN Provider call、开放对账均为 0，最近 Web/Worker 无 warning/error。
- 公网 `plus/ops` live/ready 均 HTTP 200，JS/CSS 哈希与本地一致；Playwright 完成桌面/390px 输入、教程和 ACTION_REQUIRED 历史订单查询复验，Console 0 error/0 warning、移动端无横向溢出。
- 本轮只查询既有订单状态一次；没有创建订单、更换 Session、开卡、补余额、Provider 写入或付款。成功邮箱/完成时间/成功时间线留待下一笔自然成功订单验收。

# 2026-09-01｜API 随时接单状态复核

- 用户要求在继续 Browser 工作时仍可随时切回 API，并把正常营业所需能力保持开启。现场核对确认无需切换：生产默认路线已经是 API，`accept_new_orders=true`、`dispatch_new_recharges=true`、`recharge_dispatch_mode=AUTOMATIC`、Worker API 充值最小权限=true。
- 自动开卡和自动补余额均为 true；stock/funding/reconcile timers active。通用 Provider 写、普通 Worker 卡片写和 Browser 付款继续关闭，因为它们不是 API 正常营业必需项，自动补给使用各自已开启的窄范围执行权限。
- 当前可直接分配卡为 0。首次 readiness 因卡台规则快照超过严格 2 分钟窗口显示供应 blocker；执行一次卡台规则/余额只读刷新（2 个 Provider 只读请求、仅更新本地快照）后，readiness=`AUTO_HEAL/ready=true`，明确显示“当前无卡；首个订单到达时会按已确认规则自动开卡”。
- 当前无活动/UNKNOWN 资金风险、无开放对账；本轮未创建订单、未开卡、未补余额、未付款，也未开启通用写权限。

# 2026-09-01｜$16 卡未计入可分配库存的根因修复

- 卡台与生产数据库交叉核对确认 Provider `1839` / 尾号 `1013` 为 active、余额 `$16`、资料完整。显示“可分配 0”不是卡台或同步丢卡，而是订单 `PJV1-HfAEiq8dBpDLXzt4t96e` 在 Provider 明确返回 `40030/DEFINITE_FAILURE`、attempt/资金风险和消费预留均已清除后，仍停在 `WAITING_FOR_SESSION` 并保留 ACTIVE 卡绑定。
- 根因是生命周期缺口：后台取消只支持 `CARD_READY`，不能安全关闭 `WAITING_FOR_SESSION`；Session 更换窗口到期后也没有自动收尾，可能永久占用可复用卡。
- 修复 `d1c4d32`，并以 `2bce69e` 收紧到期扫描候选：仅在所有资金状态已明确清除、所有 `create_direct` 调用均为明确失败且无外部订单号时，允许取消等待 Session 的订单并释放绑定；资金 `ACTIVE/UNKNOWN/SETTLED` 仍强制锁卡；Worker 对过期更换窗口执行同一保护逻辑自动收尾且不会反复扫描不安全订单；后台详情同步显示可取消入口。
- 验证：v1 全量 `512 total / 470 pass / 42 environment-skipped / 0 fail`；全新隔离 MySQL `39 total / 38 pass / 1 legacy-skipped / 0 fail`。最终部署 `/opt/pojia/releases/20260901-session-release-2bce69e`，Web/Worker active，live/ready 通过，API 最小充值权限仍为 true，Browser Worker 仍关闭。
- 用户此前已明确该订单略过；生产保护条件现场全部满足后将其关闭并释放卡。随后只读同步完成：尾号 1013=`AVAILABLE`、余额 `$16`、ACTIVE assignment=0、资格 SQL=`eligible=1`。本轮未执行开卡、补余额、Provider 写入或付款。


# 2026-09-01｜Browser 主线只读回归与生产配置核对

- 当前 main 执行 `npm --prefix browser-mvp run smoke:worker:readonly`：10/10 配置检查、3/3 隔离 MySQL/Chrome smoke 通过；shared dry-run 1/1 通过，未产生任何外部写入。
- SSH 只读核对生产：release `20260901-session-release-2bce69e`；Web/API Worker active；Browser Worker disabled/inactive；Browser 代码、systemd 和 migrations 027/028/031/032/041 均存在。Browser systemd 强制 payment/Provider/card/funding writes=false；API Worker 最小充值权限仍 true。
- 未启动生产 Browser、未访问 ChatGPT、未读取客户材料、未创建 Checkout、未付款。下一步是专用非客户账号/批准网络的生产形态只读观察，需另行确认。证据：`docs/2026-09-01_browser-main-readonly-regression.md`。


# 2026-09-01｜纠正 Browser 验收输入与默认路线切换事实

- 纠正前述“必须准备专用测试账号”的过窄表述：客户式 Browser 全链路验收的真实输入是“生成 CDK → 客户提交 CDK+Session → 创建订单 → Browser 执行到付款前停止”；不需要额外账号密码流程。
- 代码现场核对：`provider-route-admin-service.js` 已实现 API/Browser 默认充值方式切换；后台“卡台路线”页面已有切换按钮。切换仅影响新订单，且切换 Browser 前检查 Browser dispatch、活动 profile 与 60 秒心跳。
- 本轮未切换生产路线、未创建订单、未启动 Browser Worker、未付款。


# 2026-09-01｜区分卡台切换与充值路径切换

- 代码核对确认：`provider-routes` 页面仍保留“切换为当前”按钮，用于不同卡台/Provider route；总览设置区的 API/Browser 按钮只切换默认充值执行路径。两者分别调用不同管理接口，不是互相替代。
- 卡台切换仍需在“卡台路线”页面选择备用 route，并经过健康检查、确认词和操作原因；默认充值方式切换只影响新订单。

# 2026-09-01｜主线 Browser/API 路由与订单边界定向回归

- 当前 `v1` 定向套件：116 tests，113 pass，3 environment-skipped，0 fail。
- 覆盖默认充值方式原子切换、Browser 就绪门禁、API/Browser 执行器隔离、客户 Session 订单接入、Browser 付款前安全返回、资金 attempt/dispatch 原子性；未执行生产写入或付款。
- 结果与当前代码一致：客户式 CDK+Session 可作为 Browser 订单输入；默认路线切换已有后台能力；Browser 仍需在生产非付款观察前保持付款关闭。


# 2026-09-01｜新 API 测试订单只读观察

- 生产最新订单 `PJV1-zqelgAB9K9TsiMdtq_Ox`：客户式 CDK+Session 已提交，路线为 API；订单当前 `WAITING_FOR_SESSION`。
- API task 已完成卡分配/准备，`SUBMIT_RECHARGE` 以 `TARGET_ACCOUNT_ALREADY_PLUS` 明确失败并安全停止；attempt 与资金风险均 `CLEARED`，消费账本为 `RELEASED`，无 Provider 付款写入。
- 现场未执行付款或其他资金动作。该订单不适合作为 Browser 测试订单（账号已是 Plus）；是否关闭该等待订单需另行决定。
- 只读观察还发现该卡的 `cards.order_id` 仍指向历史失败订单，而本次新订单也引用同一 `assigned_card_id`；当前消费账本均已 RELEASED、无资金风险。该元数据一致性需后续单独核对，暂不据此判定为资金或重复付款。

# 2026-09-01｜关闭 API 测试订单后的 CDK 状态核对

- 订单 `PJV1-zqelgAB9K9TsiMdtq_Ox` 已由用户关闭，生产数据库状态为 `CLOSED`。
- 对应 CDK 当前状态为 `REDEEMED`（`redeemed_at` 已记录，`revoked_at` 为空），不是 `REVOKED`。
- 代码在成功建单时即把 `AVAILABLE` CDK 原子标记为 `REDEEMED`；关闭订单不会自动把 CDK 恢复为可用或改成作废。实际效果是该 CDK 已被消费，不能再次提交。未执行任何 CDK 状态写入。

# 2026-09-01｜后台刷新按钮范围核对

- 前端代码核对：右上角 `#refresh-button` 是“按当前视图刷新”，在总览只刷新概览/就绪数据，不会刷新 CDK 批次；进入 CDK 管理视图后才调用 `loadCdkBatches()`。
- CDK 管理页内的“刷新”按钮专门重置分页并刷新批次列表；卡片库存的“刷新本地列表”只读本地数据，不同步卡台；“刷新卡段规则”是另一条 Provider 只读接口。
- 结论：不是权限或资金意义上的按钮滥用，但存在同名按钮作用域不清、用户容易点错的 UX 问题；手动刷新会增加相应只读 GET，但按钮请求期间会禁用，未发现重复写入风险。
- 当前未改代码；建议最小改动为按作用域改名（“刷新当前页/刷新批次列表/刷新本地库存/刷新卡段规则”），避免把总览刷新误当作 CDK 批次确认。

# 2026-09-01｜刷新按钮命名修正候选

- 按用户确认完成最小前端修正：右上角按钮改为“刷新当前页”；CDK 页面按钮改为“刷新批次列表”；相关失败提示同步改名，避免误点错误作用域。
- 验证：`node --check v1/public/admin/assets/admin.js` 通过；`npm --prefix v1 test -- --test-name-pattern='admin|CDK'`：122 tests，117 pass，5 environment-skipped，0 fail。
- 当前只在 main 代码中完成，尚未部署生产；部署前需按发布流程做候选构建、备份和只读 preflight。


# 2026-09-01｜刷新按钮修正部署

- 用户确认后，将 `main@2f1fa0a` 构建为 `/opt/pojia/releases/20260901-admin-refresh-2f1fa0a`；无 migration 变化。
- 部署前核对：Web/Worker 与补给 timer active；活动任务、资金风险、UNKNOWN Provider call、开放对账均为 0；创建并校验加密备份 `/var/backups/pojia/pojia-20260901T055129Z.sql.gz.enc`。
- 原子切换 `/opt/pojia/current`，重启 Web/Worker 与补给 timer。部署后：release 指向候选、Web/Worker/timer active、`/health/ready` HTTP 200；API Worker `PROVIDER_RECHARGE_WRITES_ENABLED=true`、通用 Provider/卡片写=false。
- 生产前端现场包含“刷新当前页”“刷新批次列表”“刷新卡段规则”“刷新本地列表”。未执行任何 Provider 写入、开卡、补余额或付款。
- 回滚准备目录：`/var/backups/pojia/admin-refresh-20260901T20260901T055227Z`（含 previous release 与 unit 快照）。


# 2026-09-01｜新 API 测试订单明确失败

- 新订单 `PJV1-412JIT_yfiuBpZeC39_m` 走 API；ASSIGN_CARD、PREPARE、SUBMIT 和轮询任务均已完成。
- Provider 外部订单号 `8849` 返回明确失败：`卡片被拒，请换卡后重提`；本地状态 `RECHARGE_FAILED`，attempt `FAILED/CLEARED`，无成功付款证据。
- 该卡按“Provider 明确拒绝后不自动重新分配”策略保留为 `ASSIGNED`，不能把它误报为可立即分配；后续需按卡片核对/运营决定处理。
- 本轮未执行换卡、重试、开卡、补余额或付款。

# 2026-09-01｜订单 8849 卡片拒付只读调查

- 对生产订单 `PJV1-412JIT_yfiuBpZeC39_m` 做了数据库、ZZSHU 状态接口和 HNSKJ 卡/交易接口交叉核对；全程只读，未重试、换卡、开卡、补余额或付款。
- ZZSHU 外部订单 `8849`：`failed`，原始失败详情为“卡片被拒，请换卡后重提”，`paymentResult.success=false`，金额 `982.14 PHP`；目标账号套餐为 `free`。
- HNSKJ 卡 `1839`/尾号 `1013`：`active`、余额 `$16.00`、资料完整；交易只有 `CARD_RECHARGE 16 USD SUCCESS`，无 PURCHASE。
- 结论：已证实上游支付处理方拒绝该卡；没有更细 decline code，不能把原因猜成余额、3DS、CVV、BIN、地区或银行规则。资金 attempt 已 `FAILED/CLEARED`，订单终态 `RECHARGE_FAILED`，保持不自动重付/换卡。
- 发现展示缺口：订单主表失败原因仍为通用文案，具体 Provider 拒绝原文只在 attempt 结果摘要中；已记录为后续只读展示修复候选。详见 `docs/2026-09-01_order-412JIT-card-decline-investigation.md`。

# 2026-09-01｜用户停用拒付卡后的同步

- 用户在 HNSKJ 卡台删除/停用卡 `1839`（尾号 `1013`）后，现场只读复查为 `invalidating`、余额 `$0.01`；卡台列表仍可见。
- 本地旧快照曾为 `active/$16`，已通过 HNSKJ `GET /cards/1839` 做一次本地只读同步，更新为 `invalidating/$0.010000`；未调用卡台写接口。
- 失败订单 `PJV1-412JIT_yfiuBpZeC39_m` 的 ACTIVE assignment 仍保留，作为失败后资金/卡片关联证据，不会进入新订单资格计算。

# 2026-09-01｜旧卡状态口径更正

- 更正此前“其他未绑定卡余额约 `$0.01` 属于余额不足”的错误表述。生产数据库 `card_operational_overrides` 现场核对显示，旧批次卡（含 `8590/493` 及其余旧卡）已统一标记 `RETIRED`，原因是服务器更换后永久不可用；它们不是可补余额卡，不得进入自动补给或新订单分配。
- `4744/1065` 为 Claude 专用；只有未来新接管、通过实时卡详情与交易证据的卡，才纳入 Plus 库存。
# 2026-09-01｜后台透传 Provider 真实失败原因候选

- 根因确认：订单详情此前只读 `orders.failure_reason`；轮询后的真实 `failureReason` 保存在 `recharge_attempts.result_summary_json`，而订单主表被写成通用 `Recharge provider confirmed failure`，导致运营后台看不到“卡片被拒，请换卡后重提”等决定性原文。
- 当前 `main` 已修复两层：历史失败订单详情只读提取最新 attempt 的 `failureReason` 并标为“Provider 返回原因”；未来轮询确认失败时，将脱敏后的 Provider 原文同时写入订单主表。提交前拒绝也把错误原文写入 attempt 摘要，供详情读取。
- 敏感字段通过既有 `redactSensitiveText` 后才进入订单展示/主表；无 Provider 原文时继续使用通用兜底，不猜测拒付原因。
- 验证：定向 60/60；`v1 npm test` 共 515 项，472 通过、43 项因未配置隔离数据库跳过、0 失败。当前仅为代码候选，尚未部署生产，未创建订单、未调用 Provider、未执行任何资金动作。

# 2026-09-01｜Provider 真实失败原因候选部署

- 用户明确确认部署 `569e8ee`；构建不可变 release `/opt/pojia/releases/20260901-provider-reason-569e8ee`，归档 SHA-256 `8ea742c9b2ad49a6556ca3e60f1f8a86d49f677afacbeaa210ed35a894b8a9b8`，直接回滚点 `/opt/pojia/releases/20260901-admin-refresh-2f1fa0a`。
- 部署前只读 preflight `ok=true/blockers=[]`、活动任务/UNKNOWN 资金风险/开放对账均为 0；加密数据库备份 `/var/backups/pojia/pojia-20260901T075052Z.sql.gz.enc` 完整性通过。unit/release 快照目录：`/var/backups/pojia/provider-reason-569e8ee-20260901T075346Z`。
- 原子切换后 Web/Worker 和三个补给 timer 均 active，Browser Worker 保持 disabled/inactive；API 最小充值权限 true，通用 Provider/普通卡片写 false。公网 ops/plus readiness 均正常，部署后 preflight 继续 `ok=true/blockers=[]`，活动任务和资金风险均为 0，最近 Web/Worker 无 warning/error。
- 使用生产新代码对既有失败订单 `PJV1-412JIT_yfiuBpZeC39_m` 做只读投影验证：`failureReason=卡片被拒，请换卡后重提`、`failureReasonSource=PROVIDER_ATTEMPT`；生产静态资源已包含“Provider 返回原因”。未创建订单、未调用 Provider、未执行资金动作。

# 2026-09-01｜无真实订单期间的 Browser 只读前置复核

- 在当前生产 release `569e8ee` 使用生产 Browser 只读环境重新执行 `production-readonly-worker.js --check`，结果为 `READY`。
- Browser Worker 仍为 disabled/inactive，默认路线仍为 API；未创建测试订单、未读取 Session、未访问 ChatGPT、未调用 Provider、未付款。
- 下一项有价值的 Browser 验收仍是客户式测试 CDK+Session 走到付款按钮前停止；需要临时切换默认路线并启动 Browser Worker时再单独确认。

# 2026-09-01｜Browser 客户式非付款订单实测与访问阻断重试修复

- 用户确认允许本轮 Browser 测试；测试前生产只读核对：API 默认路线、接单/自动派发开启，Browser Worker disabled；卡台实时余额 `$36.01`，按卡段 16/余额 16 计算自动开卡预计扣款 `$16.58`。
- 临时备份：`/var/backups/pojia/browser-customer-nonpayment-20260901T141038Z`；数据库备份：`/var/backups/pojia/pojia-20260901T141040Z.sql.gz.enc`。
- 按真实客户路径生成 1 个测试 CDK，临时开启 Browser dispatch、切换默认路线为 Browser、短暂开启接单；`POST /api/v1/orders` 返回 `201`，订单 `PJV1-zffo7WJvbKcPECKcCxzx` 创建并冻结 Browser 路线。
- 系统自动开卡任务完成 1 张：Provider 卡 `2338`、尾号 `4643`、余额 `$16`；订单自动分卡后进入 Browser 执行。
- Browser Worker 使用 `EXTERNAL_READONLY + SHARED_ENCRYPTED_NONPAYMENT + CHATGPT_ACCOUNT_CHECKOUT`，未读取 PAN/CVC、未填卡、未点击付款。ChatGPT 访问阶段返回 `CHATGPT_ACCESS_BLOCKED`，未产生 `create_direct` Provider 调用。
- 发现真实缺陷：`CHATGPT_ACCESS_BLOCKED` 被错误分类为 `CARD_READY`，safe-abort 后重新排队 `SUBMIT_RECHARGE`，短时间重复创建 20 个 Browser attempt；全部资金状态最终 `CLEARED`，但造成无意义重试和运行噪音。该行为不符合“阻断后不自动重复尝试”的原则。
- 修复提交 `7bad460`：访问/Checkout 阻断改为终态 `RECHARGE_FAILED`；保留卡片/路线校验失败的有限 `CARD_READY` 重试，未知或访问阻断不再重排提交任务。定向 Browser 测试通过（26 项，26 通过）。
- 清理与恢复：停止 Browser Worker；撤销 Browser dispatch；恢复 `/etc/pojia/browser-readonly.env` 原 `LOCAL_FIXTURE` 配置；默认路线恢复 API；接单和自动派发恢复开启；正式取消测试订单，卡 assignment 释放，卡 `2338` 变为 `AVAILABLE`；删除测试 CDK/临时响应文件。
- 生产部署：不可变 release `/opt/pojia/releases/20260901-browser-access-block-7bad460f26d311d8f15103c86933a276cf4b9d14`，回滚点 `/opt/pojia/releases/20260901-provider-reason-569e8ee`。Web/Worker active，Browser Worker inactive/disabled。
- 部署后验证：生产 Browser unit 短暂启动只读 fixture 后正常停止；API readiness `ok=true`、active/unknown funds=0、活动任务=0、Browser job/run/lease=0；默认 API、接单/派发均为 true。
- 未完成：ChatGPT 真实页面因 `CHATGPT_ACCESS_BLOCKED` 未到 Checkout；后续需在可访问的批准网络环境重新执行到最终付款按钮前的非付款观察。不得把本轮结果说成 Browser 付款链路已验收。

## 2026-09-04 新卡错误占用、自动补卡循环与缺卡误报修复

- commit `a8bd7e6`；release `/opt/pojia/releases/20260904-card-availability-a8bd7e6-real`；回滚点 `/opt/pojia/releases/20260903-dark-surface-eba5331`。
- 根因：Provider 失败订单 9414 的卡 2772 在无 PURCHASE、余额仍 $16 后仍保留 RECONCILIATION + ACTIVE assignment；订单重试路径又绕过 scheduler 反复创建 24 个 automatic job，实际仅开卡 1 张；自动自愈过程被错误当成人工告警。
- 修复：失败后强制只读交易同步并以双证据安全释放；WAITING_FOR_CARD 成为唯一需求触发，scheduler 独占付费任务创建；预检零开卡失败不占资金复核/日配额；过程自愈不推送，真正失败按订单唯一提醒。
- 生产复验：卡 2772=`AVAILABLE/isAllocatable/READY`、ledger/assignment=`RELEASED`；overview available=1、readiness=READY、CARD_SUPPLY=READY；补卡 used=1/limit=5；openAlertCount=0；公网健康 ready。
- 部署修正：首次复制 current 时保留 symlink，候选别名误指旧 release；发现后建立真实 `...-real` release，并以 `git HEAD^` 六个文件 SHA 恢复旧 release，最终 current/回滚目录已核对且误别名已 unlink。
## 2026-09-04 自动补余额优先与开卡快速重试修正

- 当轮重新核对当前代码、生产 release/systemd/DB 和管理员实时 API；生产可分配卡为 `2772/9051 active/AVAILABLE/READY/$16`，补余额与补卡 DB gate 及独立 timer 均开启。
- 修正三点：存在合格低余额卡时 stock scheduler 不再抢跑开新卡；多张可补卡选择余额最高者以最小化补差额；订单收到 `replenishmentPending` 后按 5 秒而非误退化到 60 秒重试。
- 验证：定向单元 45/45；v1 全量 522 total / 478 pass / 44 environment-skip / 0 fail；全新临时 MySQL 8.4 + 完整 migrations 的关键补给场景 2/2。
- 卡台实时卡段返回 `requireMinBalance=1/minBalanceUsdt=25`。这是 Provider 开卡前硬条件，不是本地“开卡后保留余额”阈值，因此未按用户口头值伪改成 18；当前卡台余额 `$18.84` 时若进入无卡分支，仍会在 Provider 写入前安全停止。
- 本轮未开卡、未补余额、未付款；真实低余额补差额成功闭环仍待首笔生产验收。专项记录：`docs/2026-09-04-card-supply-priority-and-retry-fix.md`。

### 2026-09-04 部署前生产只读核对阻塞

- 代码与本地回归已完成；尝试取得生产现场只读证据时，当前任务没有附着 Web Terminal/SSH shell，无法读取生产 release、systemd、数据库迁移版本或健康端点。
- 已确认不能把历史报告或本地无 `DATABASE_URL` 的 readiness 结果当作生产证据；未执行部署、迁移、Worker 启动或任何资金动作。
- 解除阻塞所需的最小输入：在服务器控制面板打开 Web Terminal/SSH Terminal，并保持 Linux shell 提示符可见；不需要在聊天中发送密码、私钥或 Token。

### 2026-09-04 Browser 候选部署记录

- 生产备份与隔离恢复通过（53 表）；候选归档上传校验通过。
- 迁移 046/047 已执行，第二次运行确认幂等（already applied）。
- current 已切换至 `20260904-browser-candidate-32b8a04`；Web/API Worker 重启 active，Browser Worker 保持 disabled/inactive；Provider/卡台/付款写权限未开启。
- live/ready/客户首页 HTTP 200；未创建订单、未执行资金或付款动作。

### 2026-09-04 Browser production-readonly canary

- 生产 Browser unit 启动检查成功，连续多轮 `IDLE`，正常停止；最终 inactive/disabled。
- 配置目标为 LOCAL_FIXTURE，未接入外部 ChatGPT 或真实客户 Session；无订单、无资金和付款写入。

### 2026-09-05 Bark 重复告警 P0 证据

- 生产日志：HNSKJ `cardTypes/accountBalance` 在 `parseEnvelope` 失败，catalog-sync 任务周期性 `RETRY_PENDING`。
- 数据库：`provider-snapshot:hnskj` 只有一条长期 OPEN 的 `PROVIDER_SNAPSHOT_STALE` 告警（创建 2026-08-24，最近更新 2026-09-04），不是多条 dedupe 记录。
- 结论：底层 Provider 快照同步失败持续存在；通知层未区分同一 OPEN 事件更新与新故障边沿，导致 Bark 重复推送。待修复 Provider 解析/退避和通知冷却，不执行资金写入。

## 2026-09-05｜P0 修复进度

- 已修复 `alert-notification-repository` 重复条件及旧测试断言；新增 HNSKJ maintenance 响应分类（长退避 300 秒）。
- 测试通过：v1 `528/482/46/0`，Browser `113/109/4/0`。
- 工作区仍保留用户未提交 `docs/DECISIONS.md`，不可覆盖或提交；本次代码文件尚未提交/部署。
- 下一步：审查 diff 后提交独立 commit；备份并部署至生产，重启相关服务后只读验证告警/同步状态。保持所有资金与付款写权限关闭。

## 2026-09-05｜P0 修复已部署

- 生产 release：`/opt/pojia/releases/20260905-maintenance-bark-6246cc1`。
- 部署前备份完整性通过；重启后 Web/Worker/catalog-sync/Bark 均 active，live/ready 正常。
- 已核对生产代码 SHA-256 与本地提交一致；Browser Worker 仍 disabled/inactive，Provider 写权限全部关闭。
- 后续观察重点：HNSKJ 维护期间同步任务采用长退避，Bark 对同一 OPEN 告警不重复通知；不做资金写入或付款。

## 2026-09-05｜部署后健康复核

- 现场复核当前 release 仍为 `20260905-maintenance-bark-6246cc1`；Web/Worker/catalog-sync/Bark 均 active，`/health/ready=ready`。
- Browser Worker inactive；Provider reads=true，所有写权限=false。当前无须人工操作，等待卡台维护状态变化或真实订单。
- 下一阶段顺序：先观察同步/告警去重；有订单后再单笔 Browser 非付款 pilot，走到 Checkout 金额/税费读取后安全退出。

## 2026-09-05｜真实订单付款条件修订

- 用户授权条件已记录：仅当 Checkout 现场确认免税且金额正确时，才考虑完整付款；不是无条件付款授权。
- 测试优先使用已有卡；卡台维护导致开新卡不可用时，不执行开卡/补余额，不影响对已有卡的只读验证。
- 付款前必须重新核对卡状态/余额、账单地址、税费、总额、订单与路线一致性，并在最后一步再次请求明确付款确认。

## 2026-09-05｜Browser 真实测试启动前复核

- 生产 Web/API 健康正常，但 Browser Worker 仍 `inactive/disabled`，生产目标仍为 `LOCAL_FIXTURE`，不能直接承接外部真实订单。
- 本地 BitBrowser Local API 已现场返回 `POST /health -> success=true`；这只证明本地控制面可用，不代表 Profile、代理、Session 或 Checkout 已验收。
- 因此当前动作是测试前置，不创建订单、不切换生产路线、不启用付款写权限。下一步需在本地单 Profile 完成只读连通性和 Checkout 观察，再决定是否进入真实订单。

## 2026-09-05｜BitBrowser 单 Profile 只读预检完成

- 通过 BitBrowser Local API 列出 7 个 Profile，选择 `Plus Browser PH Pilot`（id `10f0dc7b534844c083165796447d5893`）。
- `POST /browser/open` 成功，CDP 接管成功；访问 `https://chatgpt.com/` 返回正常标题 `ChatGPT: Chat, Work, Create & Code with AI`。
- 未注入 Session、未创建订单、未进入 Checkout、未读取卡片、未付款；Profile 已正常关闭。
- 该结果只证明单 Profile/代理/公开页面可达；下一步需要客户式 Session+CDK 才能验证账号与 Checkout。

## 2026-09-05｜Browser 日常效率原则

- 已确认采用“三层检查”：一次性完整基线、每单自动轻量检查、异常/高风险动作人工确认。
- 不把 BitBrowser 首次预检拆成每单人工步骤；正常订单目标是自动运行到付款前，仅在真实付款前请求一次确认。

## 2026-09-05｜真实订单提交后现场核对

- 最近订单 `PJV1-7EYSr3AZfjVl5JZQwTZt` 已创建，状态 `WAITING_FOR_CARD`，路线已解析为 `LEGACY_HNSKJ_ZZSHU_V1`，`executor_kind=API`，无卡绑定。
- 没有新的 Browser dispatch job/run；原因不是 Session 格式，而是订单创建时默认路线仍为 API。订单路线已冻结，不能在执行中静默改成 Browser。
- 本轮未重复提交、未切换生产路线、未开卡/补余额/付款。后续若要 Browser，必须先完成路线切换并确认新订单策略，避免重复消费 CDK。

## 2026-09-05｜启动 Browser 对齐后发现架构缺口

- 代码现场复核：`production-readonly-worker.js` 固定使用 `GoogleChromeControlRuntimeAdapter`；当前配置 target 只支持 `LOCAL_FIXTURE/EXTERNAL_READONLY`，没有 BitBrowser Local API adapter。
- 本地 BitBrowser 公开首页预检不等于共享 Worker 可消费真实订单。下一步应先做 BitBrowser runtime adapter 和隔离测试，再接生产只读 Worker；不直接改 env/启动生产/切换路线。

## 2026-09-05｜BitBrowser adapter 第一批实现

- 新增只读 `BitBrowserControlRuntimeAdapter`，接入统一 RuntimeAdapter 合同；支持 health/list/open/CDP/close，拒绝写入 manifest、未批准 Profile 和非 ChatGPT Profile。
- 扩展执行模式 `BITBROWSER_CONTROL`；新增 3 个隔离测试，全部通过；Browser `npm run check` 通过。
- 当前仍未接入 `production-readonly-worker.js`、共享队列或生产配置；未部署、未启动 Worker、未创建新订单、未付款。
- 下一批：把 adapter 接入 Worker 的 runtime factory/config，增加 Profile/代理漂移、断线、租约丢失和安全关闭测试，再做本地共享订单只读联调。

## 2026-09-05｜BitBrowser readonly Worker 接线完成（本地）

- commit `1675ed7`：Worker runtime factory 可选择 BitBrowser adapter；配置新增 `BITBROWSER_READONLY`、本地 API URL校验和独立 no-payment confirmation。
- Browser 全量 `118/114/4/0`。当前未部署、未启动生产 Worker、未切换路线、未创建订单、未付款。
- 下一步必须先做本地 BitBrowser + 共享数据库只读联调与故障注入，满足闸门后才部署只读 Worker。

## 2026-09-05｜BitBrowser 实际 adapter 联调发现访问挑战

- 新 adapter 实际 open/CDP/close 成功，但 ChatGPT 导航落到带 `__cf_chl_rt_tk` 的 Cloudflare challenge，标题为空。
- 因此 adapter 控制面通过，页面可达性闸门失败；不得继续共享订单或真实订单。下一步先处理单 Profile/出口稳定性，并增加 challenge 分类测试。

## 2026-09-05｜BitBrowser 第二次开窗超时

- BitBrowser 控制面 health/list 正常，但同一 Pilot Profile 第二次 open 在 adapter 超时；未继续重试。
- 代理出口仅有 lastIp，Profile 未给出国家元数据；不能把它认定为 PH 出口。当前需先查开窗配额/代理链稳定性，再继续页面测试。

## 2026-09-05｜BitBrowser 开窗失败根因现场确认

- BitBrowser 日志明确显示 `connect ECONNREFUSED 127.0.0.1:17897`，随后报“网络不通已停止打开浏览器”；该步骤发生在 Profile 真正启动前。
- `17897` 为 mihomo mixed-port。现场有两个 mihomo 进程而只有一个监听该端口，存在重复启动/生命周期竞争。当前端口已恢复，ipify 返回 `38.60.246.34`；BitBrowser 日志缓存该 IP 为 PH/Tagum。
- 因此“以前能开、现在打不开”的直接原因已从猜测变为日志证据：代理进程瞬时不可用；ChatGPT Cloudflare challenge 另行处理。未付款、未创建订单。
## 2026-09-05｜BitBrowser mihomo 生命周期修复

- 根因已由原始 BitBrowser 日志确认：开 Profile 前连接 `127.0.0.1:17897` 被拒绝；现场还发现曾有重复 mihomo 进程，端口监听和上游可用性不稳定。
- 已新增 `scripts/run-bitbrowser-mihomo.sh` 与用户级 `scripts/com.ai充值业务.mihomo.plist`：launchd `KeepAlive` 管理单实例，wrapper 目录锁阻止重复启动；已停止无主 PID 并以受控服务重新启动。
- 已新增 `scripts/bitbrowser-proxy-health.sh`；`agent-evidence-gate.sh browser-order` 现在不再只测端口，而是要求单一 mihomo、监听归属正确、经代理访问 `api.ipify.org` 成功。
- 现场证据：BitBrowser Local API `READY`；mihomo `PID=45732` 同时监听 `17897/19097`；出口 `38.60.246.34`；`LOCAL_MIHOMO_PROCESSES=1`；生产 Web/Worker active，Browser Worker inactive/disabled，生产目标仍 `LOCAL_FIXTURE`，最新订单路线仍 API。
- 未创建订单、未读取客户 Session、未切换生产路线、未开卡/补余额、未 Provider 写入、未付款。Cloudflare challenge 是独立未解决项，后续需单独验证。

## 2026-09-05｜代理修复后单 Profile 只读复核

- 先通过 `agent-evidence-gate.sh browser-order`：BitBrowser API READY、mihomo 单实例、代理真实出口请求成功；生产 Browser Worker 仍 inactive/disabled，生产目标仍 LOCAL_FIXTURE。
- Pilot Profile 完成 `open → CDP → https://chatgpt.com/ → close`；HTTP 200，标题 `ChatGPT: Chat, Work, Create & Code with AI`，未出现 Cloudflare challenge，页面数 3。
- 原始工件：`artifacts/bitbrowser-single-profile-check-20260905/result.json`；详细记录：`docs/browser-research/BITBROWSER_SINGLE_PROFILE_PROXY_RECHECK_2026-09-05.md`。
- 未注入 Session、未进入 Checkout、未创建订单、未读取卡片、未开卡/补余额、未 Provider 写入、未付款。下一步才是同一生命周期内的客户式只读 Session/Checkout 观察。

## 2026-09-05｜Browser 容量运行时体检

- 现场核对代码、生产 systemd/env、生产数据库和本地 BitBrowser Profile 列表；没有用历史对话推断容量。
- 当前 Browser Worker inactive/disabled，生产 target=LOCAL_FIXTURE，`browser_dispatch_enabled=false`；API 路线接新单，Browser 路线 `accepts_new_orders=0`。
- 生产只有 1 个 ACTIVE/BROWSER executor profile；Browser readonly worker 每轮顺序执行一个 `runOnce()`，没有 Profile 池调度。普通 API Worker 未设置 `WORKER_CONCURRENCY`，实际按代码默认 1。
- 本机虽列出 6 个 Browser lane Profile，但尚未注册为生产租约池，也没有完成 3/6 路并发验证。因此当前不能声称具备每日几百单能力。
- 详细体检：`docs/BROWSER_CAPACITY_RUNTIME_AUDIT_2026-09-05.md`。未改生产、未创建订单、未读取 Session、未资金写入、未付款。

## 2026-09-05｜真实 Browser 订单启动前生产候选核对

- 用户确认开始单 Profile 真实 Browser 测试；本轮先运行完整 `browser-order` 闸门并核对生产 release、systemd/env、数据库路由和代码文件，未直接切换路线或创建订单。
- 生产当前 release `/opt/pojia/releases/20260905-maintenance-bark-6246cc1` 中不存在 `browser-mvp/src/bitbrowser-control-runtime.js`；生产 Browser env 仍为 `BROWSER_WORKER_TARGET=LOCAL_FIXTURE`，没有 `BITBROWSER_API_BASE_URL`。
- 因此当前生产 Browser Worker 不是 BitBrowser 实际执行器，直接切换路线会把订单送入未接入 BitBrowser 的只读 fixture，不能进行真实 Browser 测试。
- 结论：测试不是取消，而是被现场发现的“生产候选未部署/未接线”阻断。下一步应先把已验证的 BitBrowser adapter 候选部署为只读、设置目标与 API 地址、启动 `--check` 并做生产只读 readiness；在此之前不切换 Browser 默认路线、不创建订单、不读取 Session、不付款。

## 2026-09-05｜部署目标架构再次核对

- 进一步核对后发现：BitBrowser Local API 监听在本机 `127.0.0.1:54345`，而生产 Browser systemd 运行在远程服务器；即使把 adapter 文件上传，远程服务里的 `127.0.0.1` 也不是本机 BitBrowser。
- 因此不能把 `BITBROWSER_API_BASE_URL=http://127.0.0.1:54345` 直接写进远程生产配置，也不能把“上传代码”误报成“真实 Browser 已接线”。当前没有部署这类无效配置。
- 正确候选是：Browser 控制 Worker 运行在本机并通过受控 SSH 数据库隧道访问生产共享数据库，或建立明确的反向 API 隧道后再让远程 Worker 控制本机 BitBrowser；两者都必须先做只读 readiness 和回滚验证。

## 2026-09-05｜本机 Browser Worker 只读接线通过

- 按方案 A 做了受控验证：本机临时 SSH `-L` 隧道映射生产 MySQL 到本机 `13306`，临时环境将目标设为 `BITBROWSER_READONLY`、API 指向本机 `127.0.0.1:54345`，所有付款/Provider/卡资金写开关保持 false。
- 本机 `production-readonly-worker.js --check` 返回 `READY`；随后 `--once` 返回 `IDLE` 并正常退出，证明本机 Worker 可访问生产共享数据库、满足 Browser 只读迁移/执行器合同、并能安全启动一轮。
- 此轮没有 Browser job，因此没有打开 Profile、没有注入 Session、没有创建订单、没有读取卡片、没有开卡/补余额、没有 Provider 写入、没有付款。
- 隧道、临时环境文件和临时 Worker 均已结束/清理；生产 Browser systemd 仍 inactive/disabled，默认路线仍 API。

## 2026-09-05｜单 Profile Browser 测试窗口已打开

- 用户确认后，本机共享 Session 只读 Worker 已保持运行，通过 SSH 本地数据库隧道访问生产共享库；连续空闲轮询返回 `IDLE`，heartbeat 已写入并保持新鲜。
- 按现有路线服务合同，将 `browser_dispatch_enabled` 开为 `true`，并通过 `createProviderRouteAdminService.setDefaultRechargeMethod()` 原子切换默认路线：API `accepts_new_orders=0` → Browser `accepts_new_orders=1`。路由事件：`ce963a40-872c-4f31-9a89-a09a9e3fe4b5`。
- 当前生产 Browser systemd 仍保持关闭；实际执行控制面是本机 BitBrowser，避免把本机 `127.0.0.1:54345` 错写到远程服务器。
- 现在可以提交这一单的 Session + CDK；订单创建后先核对 `executor_kind=BROWSER`、Browser job/run 和 Profile 生命周期，再执行到付款前停止。当前未读取客户 Session、未创建新订单、未 Provider/卡台写入、未付款。

## 2026-09-05｜真实订单前全链路自查完成

- 现场检查了本地代理/BitBrowser、Browser MVP 代码语法、并发/租约测试、生产 release/systemd/env、生产数据库路由/设置/订单/attempt/run/lease。
- 本地：代理单实例健康，BitBrowser API READY，7 个 Profile 可见；Browser `npm run check` 与并发/配置/Adapter 定向测试通过；本机共享只读 Worker 正在运行，使用 SSH 隧道访问生产库。
- 生产：Web/普通 Worker active，Browser systemd inactive/disabled，生产目标仍 `LOCAL_FIXTURE`；生产数据库 Browser 路线已 `accepts_new_orders=1`、API 路线为 0，`browser_dispatch_enabled=true`，heartbeat 新鲜，付款写权限 false。
- 生产数据：订单 `CLOSED=6/RECHARGE_FAILED=7/RECHARGE_SUCCESS=2/WAITING_FOR_CARD=1`；Browser jobs `CANCELLED=20`、runs `FAILED_SAFE=20`（历史测试）；当前活动 execution lease=0；无新 Browser job/run。
- 关键未对齐但不阻断本次本机方案：生产 release 不含 BitBrowser adapter，远程 Browser systemd 仍是 LOCAL_FIXTURE；因此本次必须由本机 Worker 控制本机 BitBrowser，不能启动远程 Browser systemd。
- 结论：订单前置条件已满足到“可提交客户式 Browser 测试输入”，但尚未提交 Session/CDK，也未读取客户数据、创建新订单、Provider/卡台写入或付款。

## 2026-09-05｜Browser 卡前前置检查实现

- 现场重新核对生产 release、服务、本机 Worker/隧道、数据库订单/路线/卡片/任务，确认真实订单卡在陈旧卡证据；HNSKJ 维护使证据无法刷新。
- 修复两类 Profile id 混用：数据库 `BROWSER_EXECUTOR_PROFILE_ID=00000000-0000-4000-8000-000000000401` 只用于共享租约；本机 BitBrowser Profile 由独立 `BITBROWSER_PROFILE_ID` 配置。
- 新增 `BROWSER_PREFLIGHT` 订单任务、order-scoped 加密 Session source、Checkout 非付款观察、有限结果持久化和 Browser submit 完成依赖；Session 更换会按有无已绑定卡分别恢复 `CARD_READY` 或 `WAITING_FOR_CARD`。
- 回归：Browser 123/119/4/0，v1 531/485/46/0，定向测试与 `git diff --check` 通过。尚未部署、尚未给当前订单补任务、尚未访问该订单 Session/Checkout、未付款。

## 2026-09-05｜首轮前置观察发现历史套餐字段误判

- release `20260905-browser-preflight-3cd3d57` 已部署，备份 `/var/backups/pojia/pojia-20260905T035424Z.sql.gz.enc` 完整；Web/Worker active，远程 Browser systemd 仍 inactive/disabled。
- 当前订单已幂等补建 `BROWSER_PREFLIGHT`；本机 Worker 使用独立 BitBrowser Profile id，Session 注入成功。
- 安全结构诊断确认账号接口 HTTP 200、`has_active_subscription=false`，但保留历史 `subscription_plan=chatgptplusplan`。旧解析器因此返回 `ACCOUNT_STATUS_UNKNOWN`，不是客户 Session 格式错误，也不是卡台问题。
- 修复只调整这一权威判定：活动布尔为 false 即当前 FREE；活动为 true 仍按 plan 区分 Plus/其他付费，字段缺失仍为 UNKNOWN。未输出 Session/Token/邮箱原文，未读取卡资料、未付款。

### 2026-09-05｜新鲜度机制当前结论与后续接续点

- 已现场核对生产 release `/opt/pojia/releases/20260905-session-errors-d24f6d6`：`card-sync-job-service.js` 已包含 Provider maintenance 的 `retryAfterMs` 退避；`pojia-card-read-sync.timer` active，最近运行正常。
- 15 分钟门槛仍按设计作为付款/分卡时证据有效期，不能直接关闭或手工伪造新鲜时间。
- 当前订单卡住的根因是 Provider 只读同步仍不可用，导致已有 `$16` 卡没有新的余额/交易证据；不是 Session、Browser 路由或本地“无卡”事实。
- Provider 恢复后由现有同步任务自动重试；成功后重新计算库存资格，订单无需重新提交 Session/CDK。若 Provider 持续不可用，只能等待或切换到已验证可用的执行上游，不绕过门槛。

## 2026-09-05｜BitBrowser 零税多样本与正式执行顺序收口

- 未依赖旧结论，现场使用两个独立且已打开的 BitBrowser Profile，分别关闭旧任务页、清理非 Cookie 站点状态、注入同一目标 Session，并核对 email/user/account 三项摘要和 `FREE` 状态后新建 Checkout。
- 两个有效样本均观察到初始 `PHP ₱982.14 + VAT ₱117.86 = ₱1,100.00`；填卡、US/DE 账单地址和瞬时 Session 邮箱后，均由服务端重算为 `PHP ₱982.14 + Tax ₱0 = ₱982.14`。全程 `submitCalls=0`，未点击 Subscribe、未付款。
- 旧 Lane 4 身份不匹配样本继续作废；BitBrowser 当日新开次数已达上限，本轮复用已打开 Profile 的 CDP，没有把该限额误写成页面或 Session 故障。
- 现场同时暴露并修复：`Rejoin Plus` 漏识别、pricing React 水合后首次点击无跳转、Session endpoint 初始空响应、关闭最后 Profile 页导致 Context 终止、真实 VAT/Tax/Due 标签及 `₱1,100.00` 千分位解析、执行器先观察严格零税再填卡的错误顺序。
- 正式顺序现为：宽松结构观察 → 短租约内填卡 → 账单地址 → Session 邮箱 → 等待严格 PHP/零税/金额一致报价 → 清空卡字段；任何严格条件失败均付款前停止。
- 测试：Browser `132 total / 128 passed / 4 environment-skipped / 0 failed`；v1 `532 total / 486 passed / 46 environment-skipped / 0 failed`；`npm run check`、`git diff --check` 通过。
- 尚未部署；生产 Browser Worker 仍保持 `inactive/disabled`，真实 Browser 付款仍未验收。下一步：提交当前候选，随后按生产 release/服务/配置/数据库四层核对执行无付款发布。

## 2026-09-05｜Browser 零税候选生产发布

- 提交 `04e08e6` 以 Browser-only 方式发布到不可变 release `/opt/pojia/releases/20260905-browser-zero-tax-04e08e6`；v1 目录从原 release 原样复制，没有部署新的 migration 或改业务数据。
- 归档 SHA-256 为 `4127073d7bac5533c9d3337117f5c0394b57020d85b2899815e371ee569b9761`；8 个关键 Browser 源文件在生产逐项 `sha256sum -c=OK`，生产 `npm run check` 通过。
- 原子切换前回滚点 `/opt/pojia/releases/20260905-session-errors-d24f6d6`；切换后 Web/Worker `active`，live/ready 为 `ok/ready`，API Worker 的窄充值权限仍为 `PROVIDER_RECHARGE_WRITES_ENABLED=true`。
- 生产 Browser `production-readonly-worker --check` 返回 `READY`，但服务继续保持 `inactive/disabled`；没有启动 Browser Worker、没有领取订单、没有 Provider/卡台写入、没有付款。
- 发布前后均核对：RUNNING task=0、ACTIVE/UNKNOWN recharge attempt=0、ACTIVE/UNKNOWN funding attempt=0。
- 下一步：针对当前真实 Browser 订单核对卡证据恢复状态；卡台恢复后，由本机正式 Worker接入共享订单、卡资料和账单地址，按已冻结的零税流程运行到付款前，再请求一次最终付款确认。
# 2026-09-05｜订单发现机制纠偏

- 曾误报“客户提交后系统没有跨窗口订单发现机制”。现场重新读取生产代码和数据库后确认：建单事务已持久化 `orders`、`order_events`、`tasks`，Browser 路线会创建 `BROWSER_PREFLIGHT` 任务，现有任务领取机制就是跨窗口/跨进程发现机制。
- 本次订单 `PJV1-AH6M688B3Wfv5_vxISmp` 已真实落库，路线 `CHATGPT_PLUS_BROWSER_V1/BROWSER`，状态 `WAITING_FOR_CARD`；`ASSIGN_CARD` 为 `PENDING`，最近错误 `CARD_STOCK_EMPTY`。提交没有丢失。
- 误判根因是执行窗口未先采用生产可用的 Node/mysql2 只读查询（服务器没有 `mysql` CLI），却根据本机窗口不可见下结论；已停止残留本地测试进程。以后订单存在性先查生产原始响应/后台接口，再报告，不新增“订单收件箱”重复模块。

## 2026-09-05｜备用卡台 Excel 接入第一批（未部署）

- 现场读取 `/Users/lemon/Downloads/卡片列表.xls`，确认实际为 OOXML/XLSX ZIP；17 列表头和 2 行卡片数据可解析。余额为 `$2` 与 `$0`，均不满足 Plus 最低余额，未作为可用卡宣称。
- 新增 `048_manual_backup_card_import.sql`：独立 `manual_excel`/`backup-primary` 卡源、导入批次/行审计表、Browser 路线卡源映射表；无 Provider 写操作。
- 新增 `manual-card-import-service.js`：签名检测、OOXML 解压、表头/卡号/CVC/有效期/状态/余额关系校验、序列号幂等更新、PAN HMAC 与 AES-GCM 加密。后台新增上传、预览和二次确认导入；预览只返回截断序列号、尾号、余额、州和错误。
- Browser 资格和付款前证据将 `MANUAL_IMPORT` 与 HNSKJ 15 分钟交易证据区分；手工卡不进入 HNSKJ read-sync/funding，仍受余额、绑定、消费账本、退款争议、租约和资金栅栏约束。
- 验证：v1 定向 105/105 通过；Browser 既有 128/132（4 环境跳过）基线通过；Node 语法检查和真实模板解析通过。工作区保留用户未提交的 `docs/DECISIONS.md` 以及本批 package/代码/migration 改动；尚未提交、未部署、未导入生产、未启动 Browser Worker、未调用 Provider/卡台、未付款。
- 下一步：补充数据库集成测试及 Browser 多卡源 SQL 覆盖，完成对抗审查后再精确提交；生产部署需用户当次确认。

## 2026-09-05｜卡台隔离展示修订

- 用户确认不同卡台尽量分开，便于统计和切换。现场核对后确认此前第一批虽然以 `provider_account_id` 做数据分区，但后台卡片列表仍按单一列表渲染，存在视觉混池问题。
- 已修正：卡片状态查询关联 `provider_accounts` 返回来源标签；后台卡片列表按卡台分组显示数量。底层仍共用卡片表、消费账本和审计，不复制业务系统；Browser 分配继续由路线卡源映射和优先级控制。
- 本地代码已通过语法检查；未部署、未执行 migration 048、未导入生产、未创建订单、未调用 Provider/卡台写接口、未付款。

## 2026-09-05｜备用卡接入对抗式审查修正

- 发现并修正一项高风险缺口：首版 `fulfillment_route_card_sources` 只给 Browser 路线播种 HNSKJ 来源；若直接部署，API 路线分卡查询会因缺少映射而看不到 HNSKJ 卡。现改为按 `fr.card_provider_account_id` 为所有既有路线播种对应卡源，Browser 再额外加入 `manual_excel` 备用源。
- 发现并修正一项状态覆盖风险：重复导入同一备用卡时，若卡仍有 ACTIVE assignment，不能把 `ASSIGNED` 改回 `AVAILABLE`；更新逻辑现在保留活动绑定状态。
- 加强余额校验：拒绝负数累计充值、累计消费或余额。
- 定向测试与语法检查已通过；以上修正仍未部署生产。

## 2026-09-05｜多备用卡台需求补充

- 用户补充：未来可能增加 2–3 个具有不同作用的备用卡台，切换频率可能较高。
- 设计因此从“主卡台 + 单一备用卡台”提升为“可注册卡源目录 + Browser 卡源策略”：来源按能力、健康、优先级和路线单独管理；后台按来源分组统计；切换集中在一个控制面；新订单才读取新策略，已分配订单保持原卡源。
- 不新增多套订单或账本，不让 API 路线使用无 API 卡源；单订单例外仅在付款前允许并写入审计。当前为设计确认，尚未实现/部署多源策略。

## 2026-09-05｜高频卡台切换需求正式落盘

- 用户再次明确同意并要求落盘：未来卡台可能为多个（原卡台 + 2–3 个不同用途备用卡台），切换频率较高。
- 正式方案：可注册卡源目录，不写死主/备二元关系；来源声明 API/Browser/开卡/补余额等能力；Browser 策略支持自动选择、指定来源优先、暂停来源；每个来源独立统计与健康检查；订单分配后冻结卡源；切换只影响新订单并产生审计事件。
- 已同步 `PROJECT_MAP.md` 与 `CURRENT_STATE.md`。本轮仅落盘需求与方案，未修改生产、未部署、未启用新的卡台策略。

## 2026-09-05｜多卡源高频切换策略讨论稿

- 用户提出并认可继续讨论“可注册卡源目录 + 能力声明 + 策略版本”方向，但尚未最终冻结的最佳方案，以支持原卡台及未来 2–3 个不同用途备用卡台高频切换。
- 方案文档：`docs/CARD_SOURCE_SWITCHING_POLICY.md`；已同步 `PROJECT_MAP.md` 与 `CURRENT_STATE.md`。
- 核心边界：API 自动排除无 API 源；Browser 支持 AUTO/PREFER_SOURCE/DISABLE_SOURCE；切换只影响新订单；卡源在分配后冻结；付款 UNKNOWN 禁止换源/重付；复用现有订单、卡片、账本、资金栅栏和审计。
- 当前仅完成讨论稿落盘，未新增策略表/后台入口，未部署或改变生产路线。下一步先完成策略讨论和最终确认，再决定实现批次。

## 2026-09-05｜多卡源策略关键取舍确认

- 用户确认指定卡台不可用时不自动回退，必须等待运营者处理。
- 用户同意系统健康检测 + 运营手动暂停；同意付款前单订单指定卡台；拒绝复杂优先级评分，改为运营者直接指定当前卡台。
- 讨论稿 `docs/CARD_SOURCE_SWITCHING_POLICY.md` 已反映上述取舍；整体方案仍未最终冻结，未实现、未部署。

## 2026-09-05｜API/Browser 卡台边界讨论增量

- API 路线业务上固定现有 API 卡台；无 API 备用卡台只进入 Browser。
- Browser 可承接现有 API 卡台和其他 Browser 卡台。
- API/Browser 分别保存当前卡台；暂停不自动清空、不自动回退，等待运营切换。
- 入口位置尚未最终确认。

## 2026-09-06｜充值方式命名确认

- 用户确认最终名称为 `API 充值` 与 `浏览器自动化充值`。
- 说明文字可分别标注 API/协议接口与 BitBrowser/浏览器自动化；卡台来源和当前卡台不并入名称。
- 当前仅完成命名决策落盘，代码/后台文案尚未改动，未部署。

## 2026-09-06｜多卡源方案纠偏

- 用户否定此前未经现场核对的入口、拦截式切换和单订单切换设计。
- 明确要求：卡台切换由运营者直接决定，系统只提醒风险，不阻止切换；不把逐单切换作为日常流程。
- 后续不得继续凭想象设计；先核对真实后台、代码、数据库、生产 release/服务和当前入口，再重新形成方案。

## 2026-09-06｜多卡源/卡台切换现场核查

- 本地代码和生产只读证据已统一记录在 `docs/2026-09-06_card-source-current-system-audit.md`。
- 现有“卡台路线”实际切换的是充值/接单路线，并非同一路线下独立卡源；不健康时前后端会拦截切换。
- 生产尚未部署备用卡源表；API/Browser 均绑定 `legacy-primary`。
- 之前未经核实提出的独立入口和单订单切换方案已撤回。下一步先讨论真实业务语义，再决定最小实现。

## 2026-09-06｜本地/生产差异补充

- 生产 current release 不含 migration 048，且生产 workflow repository 未接入 `fulfillment_route_card_sources`；本地候选与生产并不对齐。
- 生产路线切换服务与本地一致，仍以健康条件拦截切换。
- 任何实现前必须先处理版本/迁移/分配逻辑差异，不能只调整页面。

## 2026-09-06｜多卡源讨论错误复盘

- 复盘并纠正十项错误判断，详见 `docs/2026-09-06_card-source-discussion-error-review.md`。
- 新发现的关键一致性问题：卡源若在异步分卡时才确定，会让切换影响已提交旧订单；必须在建单事务中冻结 Browser 卡源。
- API 固定 HNSKJ；Browser 直接人工选源；不做自动优先级、自动回退和日常单订单切换；告警不阻止选择。
- 整体方案仍在讨论，未实现、未部署、未改变生产。

## 2026-09-06｜Browser 切换可选批量接管规则

- 用户同意：全局卡台切换默认只影响新订单；切换时可选择一次性接管尚未真正开始的等待订单。
- 不开放日常逐单切换。候选需同时满足无卡分配/预留、无 attempt、无 Browser run/付款、无 UNKNOWN；确认前显示数量，迁移写审计。
- 当前为已确认业务决策，整体方案尚未最终冻结，未实现、未部署。

## 2026-09-06｜备用卡全量快照与 HNSKJ Browser 能力

- 备用卡台每次 Excel 均包含该来源全部卡片，导入语义确定为完整快照。
- 快照缺失卡不删除历史，但退出新订单分配；活动/UNKNOWN 状态保持锁定并核对。
- HNSKJ 同时支持 API 与 Browser；API 固定 HNSKJ，Browser 可人工选择 HNSKJ 或备用来源。
- 当前本地导入仅 upsert，完整快照缺失卡处理尚未实现；整体仍在讨论，未部署。

## 2026-09-06｜付款 UNKNOWN 局部收敛讨论

- 用户指出已付款但响应丢失不应导致全 Browser/卡台停机。
- 代码确认当前资金锁主要作用于对应 run/attempt/order/card，其他订单仍可处理；缺口是没有点击后的 `VERIFYING_PAYMENT` 自动观察阶段，且诊断口径可能造成全局 blocker 误解。
- 建议仅禁止同一未决订单二次点击，继续核验该单，其他订单/Profile/卡台继续运行。尚未最终冻结、未实现、未部署。

## 2026-09-06｜三方对账核查

- 生产总览显示 4 个动态异常，案例表 0；4 个均是明确失败无外部订单号造成的误报。
- 对账 SQL使用旧卡归属且硬编码 ZZSHU，不兼容一卡复用和 Browser 多卡源。
- 保留真实资金对账，后续收敛为自动核实、证据等待和真实人工案例三类；不因一单对账停全链路。

## 2026-09-06｜卡台来源与对账工作线防漂移机制

- 新增唯一状态入口 `docs/CARD_SOURCE_AND_RECONCILIATION_WORKSTREAM.md`。
- 明确阶段闸门、确认/待确认/否定状态、生产差距、实现追踪矩阵和部署前反查。
- 当前 D1 讨论中，未实施或部署；新窗口必须先读该表，不得从旧报告恢复被否定方案。

## 2026-09-06｜卡台运营方案确认与对抗审查

- 用户确认卡台管理、完整快照、Browser 切换、局部付款核实和分路线对账的整体运营流程。
- 对抗审查发现 6 项实现前必须修正的问题，已写入工作线唯一状态表 AR-01～AR-06。
- 整体方向无需推翻；当前仍在 D1→D2，未实现、未部署。

## 2026-09-06｜D2 最终冻结候选稿

- 汇总所有已确认决策与对抗审查修正为 `docs/CARD_SOURCE_AND_RECONCILIATION_FROZEN_SPEC.md` D2-RC1。
- D1 已完成，D2 等待用户整份确认；禁止提前进入实现或部署。

## 2026-09-06｜D2-FINAL 正式冻结

- 用户明确确认 D2 冻结稿无问题，可以冻结。
- `docs/CARD_SOURCE_AND_RECONCILIATION_FROZEN_SPEC.md` 已从 D2-RC1 更新为 D2-FINAL。
- 下一阶段为 D3 实现映射与编码；当前没有业务代码或生产变化。
## 2026-09-06｜D3 本地卡源与付款未知核实收口

- 完成并回归 migration 048、本地多卡源完整快照、订单冻结来源、Browser 卡台管理和基础对账收敛；未部署、未开卡、未补余额、未付款。
- `v1` 540 项测试为 493 通过、47 隔离跳过、0 失败；多卡源 MySQL 回归通过；Browser MVP 132 项为 128 通过、4 跳过、0 失败。
- 修正 PAY-03：付款点击后的短时无响应先进入 `VERIFYING_PAYMENT`，不立即制造 Bark/人工对账案例；核实确认可恢复同一 attempt，明确拒绝可安全释放，超时/冲突才升级 `HUMAN_REQUIRED` 并创建真实案例。
- 下一步：接入只读核实调度（ChatGPT 状态/Checkout、HNSKJ 交易、手工快照），完成 API+HNSKJ、Browser+HNSKJ、Browser+手工卡三类证据收敛；随后进入 D4 生产差异核对。
- 本轮补充 `browser-payment-verification-service.js` 协调器与 due 查询，新增 3 个单元测试；v1 总计 543 项、0 失败。仅本地候选，未接生产进程。
- 本轮新增 `route-reconciliation.js` 并接入后台订单读取，覆盖 Browser+HNSKJ、Browser+手工卡和未知执行器分支；新增 3 个测试，v1 总计 546 项、0 失败。生产仍未部署。


## 2026-09-06｜D4 生产对齐发现混装 release 并停止任务风暴

- 现场核对 current release、systemd、直接 health、MySQL 版本/结构、route/account/settings、未决资金、任务、Browser run/dispatch 和备份完整性；原始报告为 `docs/CARD_SOURCE_D4_PRODUCTION_ALIGNMENT_2026-09-06.md`。
- 生产最高 migration=047；048 新表/字段均不存在。隔离 MySQL 8.4 从 001→047 后加入 API/Browser 代表旧订单，执行 048 成功且旧订单来源全部回填，用时约 0.441 秒。
- 对标注 commit `04e08e6` 的 231 个受控文件做完整 SHA-256：204 一致、27 不一致、0 缺失、2 额外。生产文件可分别映射到多个更早提交，根因是 Browser-only 发布复制旧 release 后局部覆盖，只校验本轮少量文件，形成多提交混装。
- 该混装携带的旧 `workflow-repository.js` 会让同一 WAITING_FOR_CARD 订单每次重试都插入新开卡任务；60 秒 timer 持续领取，停止前累计 969 条任务。故障窗口所有任务 opened_count=0、无新增卡，资金 attempt 无 ACTIVE/UNKNOWN。
- 用户明确“如果每分钟自动开卡任务有问题就不用恢复”。已将 `pojia-card-stock-runner.timer` disable/stop、service stop/reset-failed，并把 `card_auto_replenishment_enabled` 改为 false、写设置审计。等待超过一个完整周期后任务数与最新创建时间均未变化；Web/API Worker保持 active，未关闭卡同步和独立补余额。
- D5 当前阻断：必须从单一 commit 用 git archive 构建完整候选并做全量 manifest 校验，禁止继续复制旧 release 局部覆盖。历史 969 条记录保留，后续仅做有证据的状态收敛，不物理删除。
- 发布机制阻断已在本地收口：提交 `8012da8` 新增精确 commit 归档器和全量 release verifier，删除旧自动开卡 timer 部署单元并更新 runbook；v1 `546/499/47/0`、Browser `132/128/4/0`。本地候选 `artifacts/release-candidate-20260906-8012da8/` 含 825 个 tracked 文件且校验通过；修改/缺失/额外文件三类反例均失败关闭。尚未部署，D5 仍需单独确认。

## 2026-09-06｜D6 导入错误分类最终生产闭环

- `c6e9f48` 已部署为 `/opt/pojia/releases/20260906-import-errors-c6e9f48`；827 文件 manifest 已通过。
- 以生产实际管理员认证请求复验空 `fileBase64`，预览接口返回 `HTTP 400 {"error":"manual_card_file_invalid"}`；未访问 Provider，复核后手工导入批次/卡片仍为 1/2，没有新增。
- Web/API Worker active；Browser Worker 与旧自动开卡 timer/service 仍 inactive/disabled；Browser 付款与自动开卡设置均 false。RUNNING task、ACTIVE/UNKNOWN recharge/funding、活动 Browser run/dispatch 均为 0。
- stock jobs 跨过 65 秒前后均为 969，活动数 0，最新创建时间不变，证明旧任务风暴未恢复。
- 本机/生产均无 `/tmp/d6-admin-tokens.json`；本轮临时响应已删除。未开卡、未补余额、未付款。

## 2026-09-06｜Browser 真实全链路验收计划与 LIVE 缺口纠偏

- 根据当前 `main`、生产 release、migration 048、本机 BitBrowser/Proxy 和生产开关，落盘 `docs/BROWSER_REAL_E2E_ACCEPTANCE_PLAN_2026-09-06.md`。
- 发现此前把“付款状态机代码已部署”说得过于接近“真实付款可用”。实际可运行的仍是 readonly Worker，payment executor 会拒绝 LIVE，live click adapter 未接入 Worker，真实 Plus/取消 verifier 与付款未知调度也未完成组装。
- 另一个 P0 时序问题是：卡前 `BROWSER_PREFLIGHT` 不应强求零税，因为实测零税只在填卡+免税地址+Session 邮箱后重报价产生。卡前只验 Session/FREE/新 Checkout/表单；付款前再强制 PHP+零税+金额一致。
- 当前不要提交新 CDK+Session。先完成 P0 组装与单 Profile 非付款回归，再用一笔新 Browser 订单做完整验收；本轮未启动 Worker、未付款。

## 2026-09-06｜Browser LIVE P0 本地实现第一检查点

- 修正 cardless preflight 误用最终零税合同；初始 12% VAT 不再阻断，最终付款仍强制 PHP/零税/算术一致。
- 修正 payment intent 过早：现在完成填卡、账单地址、Session 邮箱、重报价和最终复核后才落 intent，随后立即单次点击。
- 新增真实 Plus/取消续费核验器、单订单绑定 LIVE 配置与组装边界；仍未有可启动生产 LIVE entrypoint。
- 修正备用卡密文中账单地址被丢弃，以及 Browser 上游投影仍使用旧 route 卡台而非订单冻结卡源的跨模块漂移。
- Browser 全量：142 total / 138 pass / 4 environment skip / 0 fail；v1 受影响定向 18/18。
- 工作区仍保留用户 `docs/DECISIONS.md` 修改，本轮未触碰。未部署、未启动 Browser Worker、未付款。
- 下一步：完成生产 LIVE entrypoint、route-aware transaction reader 和 UNKNOWN 真实调度，然后单 Profile 付款关闭回归。

## 2026-09-06｜Browser LIVE P0 第二批运行组装

- 代码提交 `bc8ee2f`：新增单订单 `production-live-worker.js`，`--check` 强制付款关闭且不要求订单确认，`--once` 同时要求进程/数据库/Profile 付款权限与订单绑定确认。
- 新增 HNSKJ/手工卡路线化交易读取、实体卡级 MockAddress 稳定绑定、付款后专用 Session 来源和同 BitBrowser Profile 只读恢复。
- 修正两个恢复级缺口：SQL 直接按批准订单过滤 due verification；付款确认与后续核验计划在同一事务建立，避免确认后崩溃形成无人接管状态。
- 成功恢复可继续收口 Plus、取消续费、订单/attempt/run、消费账本、assignment 和 dispatch；无确定性拒付证据时不会仅因账号仍 FREE 而安全释放。
- 回归：Browser `151 total / 147 pass / 4 skip / 0 fail`，v1 `552 / 505 / 47 / 0`，语法与 diff 检查通过。
- 本机：代理和 BitBrowser API READY；Pilot Profile HTTP 200、无 Cloudflare、1 Context、0 submit。
- 生产只读：仍为 release `c6e9f48`；Browser Worker/付款/旧自动开卡关闭，活动 Browser run、ACTIVE/UNKNOWN 充值资金、活动 dispatch、活动开卡任务均为 0。未部署、未创建订单、未填写卡片、未付款。
- 详细证据：`docs/BROWSER_LIVE_P0_IMPLEMENTATION_2026-09-06.md`。下一步构建单一 commit 候选，以付款关闭方式部署并执行 LIVE `--check` 与订单级非付款回归。

## 2026-09-06｜Browser LIVE P0 第三批隔离 MySQL 对抗审查

- 初次实际执行环境跳过项时复现 3 个失败：付款/readonly 夹具没有同步 `orders.frozen_card_provider_account_id`；同时两个文件并行修改全局付款开关会互相干扰。
- 提交 `ff34feb`：修正三个夹具的订单冻结卡源，生产形状 smoke 改为串行，UNKNOWN 初始阶段不再误判为应立即创建人工对账单。
- 新增三条 MySQL 资金恢复证明：UNKNOWN 后确认收口、付款已确认但 Plus 未收口后恢复、UNKNOWN 到期只升级相关订单。
- 临时 MySQL 8.4 完整 Browser 回归：`154 total / 154 pass / 0 skip / 0 fail`；恢复用例均为一条 `PAYMENT_SUBMIT`，恢复阶段 0 次新增付款。
- 本轮未部署、未改变生产开关、未写 Provider、未填写真实卡、未付款。下一步从当前 HEAD 构建付款关闭的候选 release。

## 2026-09-06｜Browser LIVE P0 第四批生产发布与 LIVE check

- 从 commit `556ba974240ee168161a043177422c8b22c9b04a` 构建 841 tracked 文件不可变 release；归档 SHA-256 `49fa5298ff91d6297a70c13f5ada31f7c691b2d78ad48d986659b3653321ee8c`，服务器解包前 manifest 与归档哈希均通过。
- 当前 release `/opt/pojia/releases/20260906-browser-live-556ba97`；回滚点 `/opt/pojia/releases/20260906-import-errors-c6e9f48`；部署前数据库备份 `/var/backups/pojia/pojia-20260906T013157Z.sql.gz.enc` 验证通过；发布证据保存在 `/var/backups/pojia/browser-live-deploy-20260906T013344Z`。
- Web/API Worker active/enabled，公网 plus/ops live/ready 均 200。API Worker窄充值权限保持 true，通用 Provider/卡片写 false。Browser Worker、Browser 付款、Profile 生产权限、旧每分钟自动开卡均保持关闭。
- 本机通过 SSH 隧道连接生产库并使用本机 BitBrowser，正式 `production-live-worker.js --check` 返回 `READY`；无订单、Session、卡片或付款行为。
- HNSKJ 单卡只读核对仍返回维护期 403；数据库 5980 余额 `$16`，手工备用卡 `$0/$2`，未证明任何卡达到 `$18`。因此未让客户提交新订单，下一步等待充值后的权威卡证据后执行订单级付款关闭回归。

## 2026-09-06｜备用卡 `$20` Browser 付款前观察通过

- 生产订单 `PJV1-AH6M688B3Wfv5_vxISmp`：Browser、`manual_excel/backup-a`、卡尾号 `5501`、余额 `$20`、attempt PREPARED/ACTIVE、dispatch QUEUED、账本 RESERVED `$16`。
- BitBrowser 真实页面：身份匹配、FREE、MockAddress DE；初始 `PHP 1100/tax 117.86`，最终 `PHP 982.14/tax 0`；唯一 Subscribe 可见可用，未点击。
- 发现并修复 summary `h2` 漂移及 Stripe 隐藏/跨 frame/延迟地址控件；全量 Browser 156 项、0 fail。脱敏证据在 `artifacts/browser-manual-card-prepayment-20260906/`。
- 卡字段、Session Cookie、Profile 已清理；付款 0 次。下一步提交、部署修复并生产复核，然后进行唯一一次付款确认。

## 2026-09-06｜Stripe drift 修复生产发布

- release `/opt/pojia/releases/20260906-stripe-live-a9e65e3`，commit `a9e65e3`，844/844 manifest OK；备份 `/var/backups/pojia/pojia-20260906T025642Z.sql.gz.enc` OK；回滚 `20260906-manual-browser-86a53ef`。
- Web/API Worker active，live/ready OK；Browser Worker和旧自动开卡 timer inactive/disabled，付款开关 false。
- LIVE `--check=READY`；订单仍 PREPARED/ACTIVE、dispatch QUEUED、ledger RESERVED，run=0、permit=0。
- 下一动作是唯一真实付款确认，随后只对该订单短时开启付款并完成全链路收口。

## 2026-09-06｜安全取消旧 Browser preparation

- 生产前证明：订单 `PJV1-AH6M688B3Wfv5_vxISmp` 为 PREPARED/ACTIVE + QUEUED，Browser run=0、PAYMENT_SUBMIT=0、active/consumed permit=0、Provider 外部调用=0。
- 新增生产可用的事务取消分支和两项反例测试；定向 8/8、v1 全量 555 total / 508 pass / 47 environment-skip / 0 fail。
- commit `de0485b` 已发布为 `/opt/pojia/releases/20260906-cancel-browser-de0485b`；844 文件 manifest OK；备份 `/var/backups/pojia/pojia-20260906T034454Z.sql.gz.enc` OK。
- 指定旧单已 CLOSED；attempt/ledger/assignment 均已清除，付款 0 次。
- 释放出的尾号 `5501` 被另一张旧等待单 `PJV1-eqTeit7QVMx-qPqIfjJi` 自动分配。已停止 `pojia-worker.service` 防止继续推进；该单现为 CARD_READY、无新 attempt/run/付款。不得把用户对第一张订单的取消确认扩张为对第二张订单的确认。
- 用户随后单独确认“释放”。第二张订单已通过既有 CARD_READY 安全取消路径关闭；卡 `5501` 为 AVAILABLE，active assignment=0，active ledger=0，备用卡源活动积压=0。全局 ACTIVE/UNKNOWN attempt、活动 Browser run、active/consumed permit 均为 0；Worker 保持 inactive，Web ready。
