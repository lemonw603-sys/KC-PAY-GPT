# 阶段 1｜差异维度清单与证据边界

范围：只读既有文件与 WAL，不访问客户页面、不创建 Checkout。结论不包括任何成功率/风控归因。F-42 是接线缺陷的发现，不是被推翻的发现；被推翻的是“第五次自动预检已经走扩展、扩展也失败”的旧叙述。

## 证据分级

- A：本轮读到的原始工件或当前代码。
- B：交接/历史叙述，未拿到对应原始截图、网络响应或同次环境快照。
- C：假设，尚无控制变量证据。

| 维度 | 已有观察/支持 | 反对或不足 | 当前判定 |
|---|---|---|---|
| 窗口身份与指纹 | B：Pilot 手动成功；Lane4 自动失败，任务书明确记录。A：Lane4 WAL 对应任务五轮导航失败 | 无成功/失败同次的指纹配置摘要、浏览器构建、启动参数配对。不同窗口不等于仅改变指纹 | 指纹为候选变量，未证明因果；不能认定“冷窗口必败” |
| Cookie 层 | A：WAL bootstrap cookieCount=2、身份匹配 true。B：仅 Lane6 有 auth.openai.com 认证层、Pilot 没有也曾成功 | cookieCount 不是内容/域/轮换证据；当前 checkout JSON 不含认证层快照 | 不能断言认证层缺失是充分原因；保留账号身份与 cookie 层两个独立指标 |
| 账号新旧/套餐/Session 年龄 | A：09-07 result*.json 账户接口 status=200、free；09-10 WAL subscriptionStatus/alreadyPlus=null。B：最近单为全新账号、旧测试号 Rejoin | WAL 身份匹配不证明 free；没有同一采集时点的账号年龄和 token 剩余寿命 | 需要真实实验时分别记录账号历史与凭证年龄，不能互相替代 |
| 出口 IP/区域 | A：09-07 JSON country=PH/currency=PHP（请求参数）。B：既有配置共用菲律宾出口 | country/currency 不是现场出口证明；缺每次尝试的 IP/连接稳定性工件 | 不能用请求 PH 标签证明 sticky 出口相同，也不能推断 IP 无关 |
| 操作节奏/重试 | A：WAL 五轮身份核对后超时；可以由各 appendedAt 差值复算耗时。B：人工三次两次出现 sentinel | 没有成功/失败点击与 hydration 的精确配对；“人工”历史里有 Playwright 单独点击，不等于真实鼠标输入 | 不认定随机风控；区分执行器点击、脚本点击、人工鼠标三种来源 |
| Session 建立方式 | A：原 5397d3d 预检固定 Cookie；本轮注入改动可见。扩展当前代码可驱动 popup，已有单测 | 旧第五次不构成自动扩展对照。即使选择扩展，有现存 cookie 时 adapter 会保留而不打开 popup | 必须同时记录 adapter 选择与实际 bootstrap 分支；选 EXTENSION 不等于真的使用扩展建会话 |
| 页面状态/入口/网络 | A：pricing-modal-plus.json 定价弹窗可见、Rejoin Plus 点击、8 秒后 checkoutCalls=0、出现 payments error；同文件还记录 request-shape（历史拦截实验） | 该文件没有成功 checkout 响应；不能用 request-shape 推断请求已被服务器接收。没有 09-10 sentinel 响应体。scratchpad/lane4.png 不在独立工作区 | 不能把“无 checkoutCalls”统一解释为 Sentinel 拒绝，也不能把历史 403 文档页与这次无导航混为一谈 |
| 扩展版本与副作用 | A：仓库 manifest 1.2.1，cookies/tabs 权限，chatgpt.com host；popup.js 清登录 cookie、关闭 ChatGPT tabs、打开新 tab | adapter 注释声称“清 localStorage/indexedDB/service worker”没有当前扩展代码支持（未见 browsingData 权限/调用）；安装副本本轮未核对 | 只比较实有行为，不引用注释当缓存清理证据；真实实验前需核对已加载版本 |

## 可重查文件

1. `evidence/stage1-20260911/lane4-sanitized.json`：本轮从共用 lane-4.wal 提取目标订单五次共 30 条记录，仅保留计数/布尔/原因，含原文件 SHA-256。原文件只读，未写共用目录。
2. `artifacts/poc-checkout-api-20260907/result.json`：Plus 400、Pro 200 的历史响应摘要；不支持“Plus 页面点成功”的推断。
3. `artifacts/poc-checkout-api-20260907/result-lane2.json`：另一窗口 Plus 400 摘要。
4. `artifacts/poc-checkout-api-20260907/pricing-modal-plus.json`：上述弹窗点击、错误和拦截 request-shape。含历史请求数据，本轮未复制到新日志，不输出 token。
5. `docs/browser-research/IDENTITY_STRATEGY_RESEARCH_2026-09-07.md`：B 类汇总。其“与账号/身份/IP 无关”等措辞超过有限样本能证明的范围，本轮不当结论。
6. `docs/BROWSER_AUTOMATION_HANDOFF_CODEX_2026-09-11.md`：B 类历史，F-42 更正优先。
7. `browser-mvp/extensions/nuohuisheng-session-loader/{manifest.json,popup.js}`、`browser-mvp/src/{session-bootstrap,extension-session-bootstrap}.js`：当前仓库行为，不代表已加载副本完全一致。

## 阶段 1 状态

- 接线已修改：pool 将按模式构造的、绑定 order-scoped source 的 provider 传给预检；未动付款许可/卡/订单状态机；独立调用默认 Cookie。
- 直接注入回归及扩展单测 16/16，通过；完整 pool wiring 用例已写，依赖环境阻塞，**尚未证明 pool EXTENSION 回归通过，因此阶段 1 未验收**。
- 无真实账号实验；“穷尽”条件远未达到，未判自动化不可行。

## 2026-09-11 更新
大脑已批准安装 v1/node_modules；已安装完成。完整 pool wiring 定向回归现为 23/23（含 COOKIE/EXTENSION 真实 adapter.open/bootstrap，模拟 UI/DB），见 targeted-after-deps.txt；前面的依赖阻塞记录保留历史。扩展不实清缓存注释选择修正描述，不添加清缓存行为，避免把 F-42 接线修复扩大成新的实验变量。全量结果与验收请求见 CODEX_PROGRESS 末尾。
