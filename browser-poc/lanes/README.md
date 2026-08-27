# Browser 多赛道 PoC

本目录把互相竞争的 Browser 实现隔离为独立赛道。赛道只共享输入合同、网络事实、身份核对、证据 schema 和结果比较器；不得共享可变 Browser Profile，不得接入生产订单或真实付款。

## 首轮赛道

| Lane ID | 核心方式 | 作用 |
| --- | --- | --- |
| `UPLOADER_REAL_CHROME` | 原诺汇盛上号方式运行在干净真实 Chrome Profile | 人工成功率控制组 |
| `CDP_SITE_STATE_CLONE` | 关闭来源浏览器后只读克隆 allowlist 内的 ChatGPT 站点状态，再通过 CDP 驱动工作副本 | 验证“缺少的不只是 Cookie”，不搬运整个人 Profile |
| `LOADER_SAME_CONTEXT_UI` | Session Loader v2 注入后在同一临时 Context 完成页面预检和 Checkout | 最简单的批量 Worker 候选 |
| `HOSTED_SPLIT_CONTEXT` | 账号 Context 创建 hosted Checkout，支付 Context 在同 sticky 出口打开 | 当前最强解耦候选 |
| `PAGE_CONTEXT_HOSTED` | 在已验证账号页面内调用 Checkout 创建请求，再交给 hosted 支付 Context | 研究页面 UI 漂移时的受控替代入口 |

`HYBRID_ROUTER` 不是首轮赛道。只有独立赛道证据冻结后，才允许把 hosted 主路径和 same-context 回退组合起来，避免无法归因。

## 公共实验轴

- Runtime：`SYSTEM_CHROME`、`PLAYWRIGHT_CHROMIUM`、`PATCHRIGHT_CHROMIUM`、`CAMOUFOX_FIREFOX`，以及待本地审查的 `ANTIDETECT_LOCAL_PROFILE`；
- Session material：`SINGLE_COOKIE`、`CURATED_COOKIES`、`FULL_COOKIE_EXPORT`、`CHATGPT_SITE_STATE_CLONE`；
- Network：`NON_PH_FUNCTIONAL`、`PH_GENERIC`、`PH_STICKY_PRODUCTION_LIKE`；
- Checkout observation：同 Context、内部短链、完整 hosted 长链。

一次实验只改变一个主轴。没有菲律宾出口时可以完成离线和非菲律宾功能筛选，但不能得到菲律宾业务验收结论；普通菲律宾 VPN 只能得到方向性结论，最终比较需要接近未来生产的 sticky 出口。

`ANTIDETECT_LOCAL_PROFILE` 只允许本地工作副本，禁止厂商云 Profile、云同步、团队共享或客户 Session 上传；检测网站评分不作为晋级指标。

实验分两种作用域：`AUTH_READ_ONLY` 可以在同一账号上做平衡顺序的配对观察，但禁止创建 Checkout；`CHECKOUT_MUTATING` 每个 lane 使用隔离账号 cohort，同一账号在同一实验窗口不得被第二条 lane 再次创建 Checkout。完整约束见 `../../docs/contracts/2026-08-22_browser-multi-lane-experiment-contract.md`。

## 统一输出

每轮必须输出同一组脱敏字段：

- `laneId`、`runtimeId`、`sessionMaterialPolicy`、`networkLevel` 和实现版本；
- `scope`、`cohortId`、attempt 序号和完整 runtime manifest 哈希；
- Session 获取国家/年龄、账号常用国家、实验组和执行时间；
- sticky session、各阶段实际出口证明和目标账号身份的哈希；
- 服务器身份匹配、Free/Plus 状态；
- Checkout link kind、Checkout ID 哈希、processor entity；
- 产品、币种、金额、税费、支付方式；
- 同 Context/第二 Context 打开结果；
- challenge、重新登录、验证码、地区不可用和页面漂移分类；
- `paymentSubmitted=false`；
- 原始 hosted URL 不进入输出，只保存加密 artifact 的 opaque ref 和哈希。

任何一轮缺少可比字段都标记 `INCOMPARABLE`，不得参与胜负统计。

## 晋级和淘汰

- L0 离线合同通过后才能进入联网功能测试；
- 非菲律宾网络只用于淘汰明显不可行方案；
- 菲律宾普通 VPN 只用于预筛；
- 菲律宾 sticky 下的同账号只读配对和隔离账号 Checkout cohort 都通过，才能冻结主路径；
- 服务器无法核对真实账号、跨账号污染、产品/币种/金额漂移或依赖伪造 auth 的赛道直接淘汰；
- AI/语义定位只能生成观察或候选，最终付款按钮必须由版本化确定性 locator、页面状态断言和一次性付款许可共同控制；
- 任何付款可能已提交的状态都不得通过切赛道、换卡或新建 Checkout 自动重付。
- Checkout 过期、打不开或页面漂移不能单独作为重建证据；默认进入 `CHECKOUT_REVIEW_REQUIRED`。
- 最终可以冻结一个 champion 和最多一个已独立验证的 fallback，但 fallback 只能在创建 Checkout 前路由。
