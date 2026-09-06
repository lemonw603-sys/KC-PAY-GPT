# Browser 自动充值 GitHub 扩大调研报告（2026-08-22）

> 历史研究输入：本文早于 D-054～D-057。文中的 `FULL_PROFILE_STATE`、同账号变更实验和“唯一胜出 adapter”表述已被修订；当前实施必须以 `BROWSER_CURRENT_STATUS_2026-08-22.md` 和 `contracts/2026-08-22_browser-multi-lane-experiment-contract.md` 为准。
>
> 结论：没有一个公开项目同时满足本项目的跨地区 Session、菲律宾 sticky、Plus Checkout、卡支付、批量租约、付款未知恢复和运营审计要求。最省力的路线不是复制某一仓库，而是从不同项目借成熟部件：完整 Profile 实验、Browser lease、hosted 提链、typed checkpoint、人工接管和 mock gateway。
>
> 本轮只克隆公开仓库到 `/tmp`、检查固定提交、做静态编译和离线测试；没有运行任何登录、Checkout、代理、验证码或付款脚本。

## 1. 调研范围

本轮覆盖 17 个公开项目/上游，分为五类：

- ChatGPT Session 与 Checkout；
- 完整浏览器状态迁移；
- Browser pool、租约和人工接管；
- Runtime/fingerprint A/B；
- 定位、回放、错误和模拟支付。

README 只用于发现线索；结论优先来自固定提交源码。没有根许可证的项目只借鉴思路，不复制源码。

## 2. ChatGPT 与 Checkout 方向

| 项目与固定提交 | 真正实现 | 可借鉴 | 不照搬 |
| --- | --- | --- | --- |
| [`shi-YangYang/plus-extractor@451aff9`](https://github.com/shi-YangYang/plus-extractor/tree/451aff99db33663a6e156ce8974b5030fd35896d) | Checkout 创建/update、`oaics_*`、隔离批处理 | 把提链做成独立阶段；同 Checkout 更新；结构化金额证据 | US→TR 优惠路线、零金额逻辑和自动促销参数 |
| [`1837620622/chatgpt-specimen-toolbox@f0601b9`](https://github.com/1837620622/chatgpt-specimen-toolbox/tree/f0601b9ef7b39edfe54c3a6baf25c7d7233e2ba2) | Checkout→Stripe init→完整 hosted URL；内外链并存 | 完整 hosted 长链优先；自定义 token 只留内存 | 自有 Stripe 代理；把“可打开”视为闭环成功 |
| [`ciaooo55/chatgpt-checkout-link-gui@0ecb812`](https://github.com/ciaooo55/chatgpt-checkout-link-gui/tree/0ecb812c5f14640eae2cdc7e9cec698d74480c14) | access token 创建 hosted Checkout，失败回退内部短链 | link-kind 明确分级；允许检查实际支付方式 | 缺少许可证、订单租约、身份绑定和未知恢复，不复制源码 |
| [`jmmy9609-design/gpt-pp@c5c72f5`](https://github.com/jmmy9609-design/gpt-pp/tree/c5c72f541ea853eb60d490687326ed5a3f29cc37) | hosted/Stripe init/PayPal authorize 分阶段；同 token 串行 | 账号侧与支付侧分段；单 token 串行锁 | 零金额 PayPal 目标与本项目卡支付不同 |
| [`1537271403/pay153-checkout-link@e8b3662`](https://github.com/1537271403/pay153-checkout-link/tree/e8b36626162f09363f29b85af42de98cc8114c9b) | custom/hosted Checkout、多地区 route、金额和支付方式解析 | Checkout adapter 分层；国家/币种/方式来自响应；高并发缓存思路 | 公共酒店/商户地址生成、优惠/验证码/支付确认流程；无根许可证 |
| [`fangyuan99/gpt_checkout.user.js`](https://gist.github.com/fangyuan99/e93a81f634b68c570a0edb1fee39a511) | 在已登录页面生成 PH/PHP Plus 短链/长链 | `PAGE_CONTEXT_HOSTED` 赛道的最小形态 | 单文件脚本没有真实身份连续核对和批量恢复 |
| [`lane2077/Gpt-Agreement-Payment@1b8c158`](https://github.com/lane2077/Gpt-Agreement-Payment/tree/1b8c1582551b3578aa94bfd1ffd4a6663fae1c51) | 浏览器/协议组合、代理池、daemon 状态；本地 mock gateway 模拟 Checkout/confirm/poll/3DS | `local_mock_gateway` 的多终态设计；支付页面与后台结果分开模拟 | 自动验证码、代理轮换、支付重试和完整 pipeline；此前离线入口还出现缺失 `flows`，不能当可直接运行成品 |

新的关键启发是：`PAGE_CONTEXT_HOSTED` 应成为独立赛道。它不依赖升级按钮 Selector，但仍在已验证的账号 BrowserContext 内创建 Checkout；不能退化成后台拿 access token 随意批量 POST。

## 3. Session 与完整 Profile

| 项目与固定提交 | 真正实现 | 本项目用途 |
| --- | --- | --- |
| [`ceoimperiumprojects/chatgpt-py@c31ba1e`](https://github.com/ceoimperiumprojects/chatgpt-py/tree/c31ba1ef6af8d4d2739763494321c2ec22112e06) | Playwright `storage_state`、保存后 `chmod 0600`、状态检查、可切 Camofox | 证明 storage state 是常见中间档，但其 status 仍不足以替代账号 identity 哈希核对；无根许可证，不复制源码 |
| [`apoorvdarshan/browser-cookie-bridge@ed6b46a`](https://github.com/apoorvdarshan/browser-cookie-bridge/tree/ed6b46a9724dab074ae58bcfb12faa1ef2742be2) | Cookie 属性、LocalStorage/IndexedDB/SessionStorage/Service Worker 全站状态迁移；关闭源浏览器、备份、工作副本、校验、原子替换、回滚 | 建立 `CDP_FULL_PROFILE` 赛道；比较单 Cookie 与完整站点状态；借鉴“先关闭、备份、校验、替换失败回滚” |
| [`microsoft/playwright@9642f57`](https://github.com/microsoft/playwright/tree/9642f57665db582b12dcfa5d8022808f2402fa2a) | 临时 BrowserContext 隔离、storage state、严格 locator、FrameLocator、trace | 继续作为确定性默认底座；每单新 Context，支付 iframe 用 FrameLocator |

`browser-cookie-bridge` 的离线测试 37/37 通过。这并不证明 ChatGPT Session 能跨机器/地区迁移，却支持把“完整站点状态”作为独立实验，而不是继续猜某个 Cookie 名。

不采用其云端 Profile 上传路径：客户 Session 不应为了 PoC 发送到第三方 Browser 云。只学习本地副本、备份和校验流程。

## 4. Browser Worker、租约与恢复

| 项目与固定提交 | 可复用思想 | 本项目落点 |
| --- | --- | --- |
| [`floomhq/openbrowser@5680ac6`](https://github.com/floomhq/openbrowser/tree/5680ac6fbe1334a20d87a02d1087c95fc3e20a9c) | `lease → act → heartbeat → release → report`；identity 绑定 Profile/proxy/locale/timezone；过期租约 GC；人工 takeover；脱敏 telemetry | Browser slot 租约、sticky proxy 与账号 Context绑定、人工接管、Worker 回收。只借接口，不引入第二个 broker 系统 |
| [`gsd-build/gsd-browser@e5ec085`](https://github.com/gsd-build/gsd-browser/tree/e5ec085e3b726e2ecb3ad1f7f805c39272d5f42c) | action timeline、session summary、pause/step/abort、takeover、sensitive mode、assert/diff、版本化 element refs | 后台接管体验、敏感输入时暂停录制、每步前后状态和人工逐步放行 |
| [`mentiora-ai/loom@b2caca7`](https://github.com/mentiora-ai/loom/tree/b2caca7531cf14228271af18876659df200b1b56) | hash-chain WAL、typed errors、session budgets、只返回 grant ID、不返回 secret、损坏 WAL 隔离、PASS 不等于可 replay | 追加式检查点、错误枚举、凭据 grant、崩溃 run 隔离；不引入整套 Rust runtime |
| [`apify/crawlee@69a824b`](https://github.com/apify/crawlee/tree/69a824b77a2ce5ed48ef6bca5a0a54d5ce504ac4) | BrowserPool、最大页面数、浏览器退休、Session/Proxy 绑定、生命周期 hooks、自动并发 | 350 单无付款容量仿真的资源池参考。其 crawler 自动 retry 不能直接用于支付提交阶段 |

最值得马上吸收的是 OpenBrowser 的 lease contract 和 Loom 的“验证通过不等于允许重放”。它们与本项目现有 run/attempt 思路一致，可以做成很小的本地接口，不需要新增微服务。

## 5. Runtime 与页面漂移

| 项目与固定提交 | 能解决什么 | 使用边界 |
| --- | --- | --- |
| [`Kaliiiiiiiiii-Vinyzu/patchright@2290f12`](https://github.com/Kaliiiiiiiiii-Vinyzu/patchright/tree/2290f121aea4be2e70b1c8b4b0cf0a676311b0e3) | Playwright Chromium drop-in runtime，修改 Runtime/Console/默认 flags 等可观察差异 | 作为 runtime A/B，不默认启用；需重新验证 console、route、trace 和 iframe 行为 |
| [`daijro/camoufox@dbd511b`](https://github.com/daijro/camoufox/tree/dbd511b9624b63e0090416b7848748e4d403de6e) | Firefox/C++ 层指纹、proxy→timezone/locale、Playwright 接口 | 作为 Firefox 赛道轴；项目自己承认指纹一致性仍可能出错，不能把“stealth”宣传当证据 |
| [`browserbase/stagehand@1011177`](https://github.com/browserbase/stagehand/tree/1011177a3140a93f021745a3e3dc0dce9ee73225) | `observe` 先解析动作，再缓存确定性重放；`extract` 结构化读取 | 用于非资金步骤的 locator discovery 和漂移报告；不允许 agent 自主决定最终付款 |
| [`browser-use/browser-use@85ddbf`](https://github.com/browser-use/browser-use/tree/85ddbfedf609166b2d2c76c3d80506649fee82a9) | allowed/prohibited domains、domain-scoped sensitive data、Profile/proxy、keep-alive | 借鉴域名白名单和凭据按域注入；不采用自由 Agent 做支付决策 |

页面定位策略因此调整为三层：

1. 首选 Playwright `getByRole/getByLabel`、严格唯一匹配和 FrameLocator；
2. 页面漂移时，Stagehand/语义工具只产生候选和 DOM 差异，进入人工审查；
3. 审核后的 locator 固化到版本化 adapter，下一轮确定性执行。

“自动修复 Selector 后立刻继续付款”明确禁止，因为它可能把相似按钮误认为最终支付按钮。

## 6. 可以直接少造的轮子

### 现在就吸收

- BrowserContext 隔离、role/label/FrameLocator：继续用 Playwright；
- 完整站点状态实验的备份/工作副本/校验/回滚：参考 Browser Cookie Bridge；
- Browser slot 的 lease/heartbeat/release 和 identity→proxy 绑定：参考 OpenBrowser；
- action timeline、pause/step/abort、sensitive mode：参考 GSD Browser；
- typed checkpoint、grant ID、损坏 run 隔离：参考 Loom；
- hosted/internal/incomplete link 分类：现已在本项目 `checkout-link-core.js` 实现；
- mock Checkout/confirm/poll/3DS 多终态：参考 Gpt-Agreement-Payment 的本地 gateway 结构，在本项目重写最小版本。

### 作为实验轴

- `SYSTEM_CHROME`/CDP；
- `PLAYWRIGHT_CHROMIUM`；
- `PATCHRIGHT_CHROMIUM`；
- `CAMOUFOX_FIREFOX`；
- `SINGLE_COOKIE`/`CURATED`/`FULL_EXPORT`/`CHATGPT_SITE_STATE_CLONE`。

### 明确不吸收

- 自动生成或搜索公共地址；
- 验证码自动求解和自动换 IP；
- 支付后超时自动换卡、换代理、换赛道重试；
- 把客户 Session 上传第三方 Browser 云；
- 让 LLM/自愈 Selector 自主点击最终付款；
- 把 URL 出现、页面成功文案或 HTTP 200 当成 Plus 开通证据；
- 为采用某个 Browser pool 而引入第二套订单/资金系统。

## 7. 验证记录

- 新克隆 8 个仓库并固定 HEAD；
- Python 静态编译通过：`chatgpt-py`、`openbrowser`、`pay153-checkout-link`、`Gpt-Agreement-Payment` 本地 mock gateway；
- Node 语法通过：Browser Cookie Bridge broker、Chromium reader、direct import；
- Browser Cookie Bridge 离线测试 37/37 通过；
- 前轮固定提交结果继续有效：plus-extractor checkout helper 47/47、Browser PoC 26/26、本项目 legacy 34/34；
- 未安装或执行候选项目的浏览器、代理、Camofox、Patchright、验证码、Checkout 或付款依赖。

## 8. 推荐实施顺序

1. 为五条赛道建立统一 manifest/evidence schema；
2. 重写最小 mock gateway，覆盖 Checkout 创建、hosted/internal、过期、支付未提交、提交未知、开通成功和取消待处理；
3. 增加 `SYSTEM_CHROME/CDP` 与 `CHATGPT_SITE_STATE_CLONE` 两个离线/本地赛道；
4. 把 Browser slot 改成 lease/heartbeat/release，不引入外部 broker；
5. 增加 pause/step/abort 和 sensitive-mode 证据开关；
6. 先在非菲律宾网络筛选，再用菲律宾普通 VPN 预筛，最后用生产相似 sticky 出口冻结胜者；
7. 最终只把 champion 和最多一个可在 Checkout 创建前路由的预验证 fallback 接入现有订单和后台。
