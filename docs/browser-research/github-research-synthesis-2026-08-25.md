# GitHub/公开实现研究统一归档

日期：2026-08-25  
范围：Browser Session、Checkout、Browser Worker、租约恢复、Runtime、页面漂移和本地支付模拟。  
状态：历史研究归档；没有真实 Session、真实 Checkout 或真实付款证据。

## 总结结论

没有发现一个公开项目同时满足本项目的：跨地区 Session、菲律宾 sticky 出口、Plus Checkout、卡付款、批量租约、付款未知恢复和运营审计。可行方法是拆分吸收小部件，而不是复制某个“成品”。

## 可复用部件矩阵

| 领域 | 公开项目/来源 | 已看到的能力 | 可借鉴到本项目 | 明确不照搬 |
|---|---|---|---|---|
| Checkout 提链 | `shi-YangYang/plus-extractor@451aff9` | Checkout 创建/update、`oaics_*`、批处理 | 将提链独立成阶段；保存结构化金额证据 | 优惠路线、零金额逻辑、自动促销参数 |
| Hosted Checkout | `1837620622/chatgpt-specimen-toolbox@f0601b9`、`ciaooo55/chatgpt-checkout-link-gui@0ecb812` | hosted URL、内部短链、link-kind 差异 | hosted/internal/incomplete 分类；authority 只进受控工件库 | 把“能打开”当作充值成功；第三方 Stripe 代理 |
| Checkout 多阶段 | `jmmy9609-design/gpt-pp@c5c72f5`、`1537271403/pay153-checkout-link@e8b3662` | hosted/Stripe init/PayPal 分阶段；国家、币种和方式解析 | Checkout adapter 分层；响应驱动地区/支付方式 | 零金额 PayPal、公共地址和自动支付重试 |
| Session 状态 | `ceoimperiumprojects/chatgpt-py@c31ba1e` | Playwright storage state、权限收敛、状态检查 | 状态副本、文件权限、身份 HMAC 核对 | 仅凭 status 判断账号身份 |
| 完整站点状态 | `apoorvdarshan/browser-cookie-bridge@ed6b46a` | Cookie/Storage/IndexedDB/Service Worker 迁移、备份、校验、回滚 | `FULL_SITE_STATE` 实验；先备份和校验再替换 | 云端上传客户 Session |
| Worker 租约 | `floomhq/openbrowser@5680ac6` | lease/act/heartbeat/release/report、identity 绑定、takeover | Browser slot、账号/代理/locale 绑定、人工接管 | 引入第二套 broker |
| 操作时间线 | `gsd-build/gsd-browser@e5ec085` | pause/step/abort、takeover、sensitive mode、assert/diff | 后台逐步接管和敏感输入暂停证据 | 让自愈逻辑直接点击付款 |
| WAL/恢复 | `mentiora-ai/loom@b2caca7` | hash-chain WAL、typed errors、grant ID、损坏隔离 | 检查点、grant、不可重放和损坏 run 隔离 | 直接引入整套 Rust runtime |
| BrowserPool | `apify/crawlee@69a824b` | 并发、页面上限、退休、Session/Proxy 绑定 | 资源池容量和退休策略参考 | crawler 自动 retry 不能用于付款动作 |
| Runtime A/B | `patchright@2290f12`、`camoufox@dbd511b` | Chromium/Firefox runtime 变量、proxy→locale/timezone | 作为隔离实验轴 | 默认启用 stealth 或把“指纹分数”当成功证据 |
| 页面漂移 | `browserbase/stagehand@1011177` | observe/extract、候选动作和结构化读取 | 只生成候选和差异报告，审核后固化 locator | 自动修复后直接继续付款 |
| 域名/凭据边界 | `browser-use@85ddbf` | allowed domains、域级敏感数据 | 域名白名单、按域注入凭据 | 自由 Agent 自主决定付款 |
| 本地支付模拟 | `lane2077/Gpt-Agreement-Payment@1b8c158` | Checkout/confirm/poll/3DS 多终态 mock gateway | 本地 mock gateway 和 UNKNOWN 场景 | 自动验证码、换 IP、支付重试 pipeline |

## 直接影响 MVP 的 Checkout 风控结论

1. Checkout 是付款授权工件，不是普通页面；创建后不能随意换 lane、换卡、换代理或重建。
2. 同一账号需要账号级互斥，订单级资金锁不足以阻止跨订单并发。
3. hosted URL 可能是可直接打开的 authority，原文不能进入普通日志、截图、HAR 或后台页面。
4. 页面成功文案、HTTP 200、URL 出现都不是最终成功证据；必须分别核对卡交易、Plus 权益、订单和取消/撤销状态。
5. Checkout 创建次数本身也会影响账号风控，需要账号级额度、冷却和活动 artifact 上限。
6. runtime、代理、locale、timezone 和 Session 年龄必须冻结并记录；不能把多 lane 实验污染误判为某个 runtime 的效果。

## 研究所得的推荐落点

### 现在吸收

- Playwright BrowserContext 隔离、严格 role/label/FrameLocator；
- 完整站点状态的本地备份、校验、回滚；
- Browser slot 的 lease/heartbeat/release 和身份绑定；
- action timeline、pause/step/abort、sensitive mode；
- typed checkpoint、grant ID、损坏 run 隔离；
- hosted/internal/incomplete link 分类；
- mock Checkout/confirm/poll/3DS 多终态。

### 只做实验轴

`SYSTEM_CHROME/CDP`、`PLAYWRIGHT_CHROMIUM`、`PATCHRIGHT_CHROMIUM`、`CAMOUFOX_FIREFOX`，以及 `SINGLE_COOKIE`、`CURATED`、`FULL_EXPORT`、`CHATGPT_SITE_STATE_CLONE`。

### 不吸收

- 自动生成公共地址；
- 自动验证码和自动换 IP；
- 付款未知后的换卡/换代理/换 lane；
- 把客户 Session 上传第三方 Browser 云；
- LLM 或自愈 Selector 自主点击最终付款；
- 以页面文案作为唯一成功证据；
- 为了 BrowserPool 新建第二套订单/资金系统。

## 证据和边界

- 原始研究报告位于 `docs/archive/2026-08/2026-08-22_browser-automation-github-expanded-research-report.md` 等文件；本页是归纳，不替代原文。
- 原报告记载的仓库检查以固定提交、静态检查和离线测试为主，属于 L1/L2。
- 没有公开项目被证明可以直接完成本项目的真实 Plus 充值。
- 后续若要复用某个项目，必须重新核对许可证、固定 commit、依赖供应链、输入输出合同和本地无付款测试。
