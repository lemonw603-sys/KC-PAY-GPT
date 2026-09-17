# 清账本 · 第一面：卡台与路线的关系（2026-09-17，给 Lemon 过）

> D-243 五步之①的第一页。规矩：每面写四段——现在是什么（证据）、你说过要什么、我建议怎么做、代价与不做的后果——你过了才写进 `V2.0_EXECUTION.md`。这一面挂着 A1（切换解耦）、A2（切换前校验）、A4（两台并重供卡）、Pro 路线、解耦想法五件事。

## 1. 现在是什么（代码 + 生产，2026-09-17 07:50 UTC）

**两个选择，三个实体，四条路线。**

| 运营的选择 | 存在哪 | 谁读 |
|---|---|---|
| 走哪条路（API / Browser） | `fulfillment_routes.accepts_new_orders`（按产品一条=1） | 建单 intake 选路线 |
| Browser 用哪个卡台 | `browser_card_source_selections`（按产品；三产品现都 →103） | 建单 intake、切卡台端点 |
| API 用哪个卡台 | **没有选择，是硬写**：`fr.card_provider_account_id`（四条路线全填 101）+ intake SQL 硬写 `provider_code='hnskj' AND supports_api_recharge=1` | 建单 intake |
| 自动开卡/读同步/补款用哪个卡台 | **硬写** `resolveCurrentCardProviderAccount`：找 accepts=1 的 Plus 路线，且 `pa.provider_code='hnskj'` | read-sync 15s、card-funding 5s、card-stock 手动、worker PURCHASE_CARD |

（证据：`order-intake-repository.js:130-160`、`provider-route-service.js:6-28`、`card-source-admin-service.js`、生产 `fulfillment_routes` / `browser_card_source_selections` / `provider_accounts`）

**建单时把卡台冻进订单**（`orders.frozen_card_provider_account_id`），之后分卡只在这个卡台里找（`workflow-repository.js:216`），Browser 执行前再校验卡的卡台 == 冻结卡台（`shared-encrypted-materials.js:249`）。切换只影响新单，这条是对的、要保。

**切路线** `setDefaultRechargeMethod`（`provider-route-admin-service.js:117`）：只翻 accepts 位。切 API **不查任何东西**；切 Browser 只查 dispatch 开关、有 ACTIVE profile、心跳 60s 内。**不查目标卡台有没有卡。** 09-17 你切回 API 前是人肉查的卡池。

**切卡台** `switchBrowserSource`（`card-source-admin-service.js:75`）：只改 Plus 产品的 bcs；可选「接管等待中的单」把它们的冻结卡台改掉；查目标 `supports_browser_recharge=1`；健康状态只作 warning 不拦。**API 路线没有切卡台的入口。**

**D-219「切一次路线 7 秒内动了两条记录」的真相**：代码里切路线不动卡台。那是你 09-14 06:36 手动点了两次（路线 302→301，7 秒后卡台 103→101）。09-16 09:19 切回 Browser 时你又点了两次（301→302，4 秒后 101→103）。**为什么切路线时你要顺手把 Browser 卡台也切？**——这是我要问你的第一个问题（§5）。

**历史组合与结果**（`orders` × `card_assignment_history`，全量）：

| 路线 | 冻结卡台 | 成功 | 失败 | 关闭 | 有没有点过付款 |
|---|---|---|---|---|---|
| API | 101 hnskj | 5 | 7 | 4 | 有 |
| Browser | 103 highvcc | 15 | 30 | 10 | 有 |
| Browser | 101 hnskj | 0 | 0 | 4 | **0 次**（4 单全 `CANCELLED_PRE_SUBMISSION`，08-30～09-05） |
| API | 103 highvcc | — | — | — | **组合不存在**（intake SQL 不允许） |

→ **「hnskj 卡走 Browser 能用」在系统里没有证据**，只有你手动的经验；「highvcc 卡走 API」没试过。账本 §2.8 写"BROWSER→101 3 单"和 A1 ③"Browser 已能用 hnskj 卡"都要按这张表改。

**两个卡台的能力位与真实能力**（`provider_accounts` + 代码）：

| | 101 hnskj | 103 manual_excel（highvcc 喂） |
|---|---|---|
| API 充值 | 1 | 0（硬写不让） |
| Browser 充值 | 1 | 1 |
| 自动开卡 `supports_auto_open` | 1（worker PURCHASE_CARD，需 CARD_WRITES=true，现 false） | 0（但 `highvcc-card-service.openCard` 真能开，只是不走这条位） |
| 自动读同步 `supports_api_sync` | 1（read-sync 每 15s/每卡每小时） | 0（1h 全量快照刷余额） |
| 交易入库 | 有（50 笔） | 无 |
| 钱包余额入库 | 有 | 无 |
| 销卡 | `withdraw` API | 手动删 |
| 限流 | 60 次/分钟，超出收费（实测均值 4.6 / 峰值 22） | 未知 |

## 2. 你说过要什么（原话要点）

- 运营只做三个选择：接不接单、走哪条路、用哪个卡台。（基线、V2 §0）
- 两台同等重要、经常来回切；hnskj 自动开卡不能排后。（D-242）
- 一键切换不踩坑：切过去要跑得起来。（V2 §3.1）
- 卡台↔支付方式解耦：想法，没定；API 绑别的卡台行不行没试过。（D-243/D-244）
- 5X/20X 走 Browser，与 Plus 同型只换套餐。（D-244/D-245）
- 稳定、不臃肿；不拘泥过往。（D-244）

## 3. 我看到的真正问题（不是账本原来写的那几条）

1. **「用哪个卡台」这个选择只有一半存在。** Browser 有选择表，API 没有——API 的卡台是三处硬写（路线表字段、intake SQL、`resolveCurrentCardProviderAccount`）。所以「切卡台」在 API 路线上根本没有按钮，你要换只能换路线。这才是"切换麻烦"的根，不是代码把两个开关耦合了。
2. **供给侧的自动动作全部只认 hnskj。** 读同步、补款、开卡调度都经 `resolveCurrentCardProviderAccount` → hnskj。highvcc 的开卡、余额、交易全是另一套（快照 timer + 手动脚本）。「两台并重」在供给侧不成立，成立的只有"两台都能出卡给 Browser"。
3. **切换前没有校验。** 切 API 不看有没有卡；切卡台不看目标卡台健康（只 warning）。你今天人肉查的那四项（路线唯一、可分配 >0、provider CLOSED/read_enabled、版本对）就是缺的校验。
4. **卡的合格窗口跟卡台绑死。** hnskj 卡只在每小时同步后 15 分钟合格（§4.2 已记），highvcc 卡不受此限（MANUAL_IMPORT 豁免）。同一条资格规则对两台卡的行为不一样，运营看到的"可分配 N 张"会随时刻跳。
5. **两台各自「能不能走另一条路」都没验过**（上表）。解耦讨论的前提数据是空的。

## 4. 我建议怎么做（三个选项，我推 C）

**A · 最小改：不解耦，只补切换前校验。** 切路线/切卡台前跑今天那四项，不过就拒绝并说原因。代价小（只动两个 admin service），不碰 intake、不碰付款。但「API 没有卡台选择」「供给只认 hnskj」两个根问题留着，两台并重做不到。

**B · 全解耦：卡台成为订单级选择，路线只管执行器。** 把 bcs 扩成「产品 × 执行器 → 卡台」一张选择表（或干脆「产品 → 卡台」，两条路共用一个选择）；intake 删掉 `provider_code='hnskj'` 硬写、路线表删 `card_provider_account_id`；`resolveCurrentCardProviderAccount` 改成「对所有 CARD 账户按各自能力跑」（hnskj 走 API 同步，103 走快照）；切换前校验同 A。代价：动 intake（资金路径前段，不碰付款本身）、动三个 runner 的账户解析、切换端点重做；**前提是 highvcc 卡走 ZZSHU 真付一单验过**，否则解耦了也不敢切。

**C · 分两步的 B（推荐）**：
- **C1 现在做**：①一张「产品 × 执行器 → 卡台」选择表替代 bcs + 路线表字段（API 行先只允许 101，白名单在表里不在代码里）；②intake 从这张表取冻结卡台，删硬写；③切换前校验（四项）挂到切路线和切卡台两个端点；④`resolveCurrentCardProviderAccount` 改成遍历所有 `purpose='CARD'` 账户、按能力位分派（hnskj 才发 API 请求，103 不发）。**这一步不改任何付款行为，不改资格规则。**
- **C2 验过再开**：你安排一单 highvcc 卡走 ZZSHU（真付）。成功 → 把选择表 API 行的白名单加上 103，「用哪个卡台」在两条路上都成立；失败 → 白名单保持 101，解耦到此为止，但 C1 的好处（校验、供给两台并重、按钮齐）不丢。
- 为什么推 C：C1 是**减法**（删三处硬写、合两张表成一张）不是加法；C1 不依赖 C2 的结果；hnskj 限流不受影响（同步请求数不变，只是不再绑路线）。

**同步作废/改写的账本条目**：A1 的「切换解耦卡台」按 C 重写，A1 里「接口三段统一」拆出去单独审（它是执行面的事，和卡台无关，而且减法审查已标"可能过度"）；A2 切换前校验并入 C1；A4 的供给两台并重落到 C1 ④；§2.8「BROWSER→101 3 单」改为「0 次付款」；A1 ③「Browser 已能用 hnskj 卡」改为「未验」。

## 5. 要你定 / 答的

1. **切路线时你为什么要顺手把 Browser 卡台也切？**（09-14 切 API 时把卡台切到 101，09-16 切回 Browser 时切回 103）。是"想让两边用同一个卡台"，还是"API 用 hnskj 所以顺手"，还是别的？这决定选择表是「产品 → 卡台（两路共用）」还是「产品 × 执行器 → 卡台（各选各的）」。
2. **hnskj 卡走 Browser**：你手动用比特浏览器充时用过 hnskj 的卡吗、成功过吗？系统里 0 次付款。
3. **C 方案要不要走？** 走的话 C2 那一单 highvcc 卡走 ZZSHU 什么时候安排（真付，约 $16）。
4. hnskj 卡「每小时同步一次、只有 15 分钟合格」——这是要改成"分卡时按需同步、不看时间窗"的，还是现状可接受？它不属于这一面，但决定你切到 API 后来单会不会先等卡，我想先知道你的态度。
