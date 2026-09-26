# 任务书｜批 B（缩小版）：付款池核实窗口代码修 + 点击后计时 + 查新单 1 秒（D-389）

2026-09-26（UTC+8）Lemon「以上全部同意你的建议」。来源：盘点报告 `reviews/2026-09-26-customer-ux-speed-audit/report.md` P0 与 P3 ①⑥。
另 4 项提速（新标签不重复 goto、卡预检并行、库时间线异步写、入口等待）等有真单数据再做，不在本批。

## 目标

1. 核实窗口填错时，付款池**启动就起不来**，不再是每张真付款单在填卡前失败（D-386 P0 的代码层修；配置止血已在 D-387）。
2. 点完付款后三段（人机验证检测 / 结账页结果观察 / 账号套餐确认）各花多久、结论是什么，每单落一份本机记录，**只记录、不改流程**。
3. 付款池空闲时查新单的间隔 3 秒 → 1 秒（只改运行配置）。

## 文件白名单（D-254）

- `browser-mvp/src/chatgpt-post-payment-verifier.js`：只导出上限常量 `POST_PAYMENT_VERIFICATION_MAX_MS`，构造函数改用它（值不变 300000）
- `browser-mvp/src/production-live-pool-worker.js`、`browser-mvp/src/production-live-config.js`：核实窗口上限改用该常量；池传入计时记录器
- `browser-mvp/src/shared-live-composition.js`：点击后观察抽成导出函数 `createPaymentOutcomeObserver`、人机验证检测包 `timedGate`，各加一层计时
- `browser-mvp/src/post-click-timing.js`（新）
- `browser-mvp/scripts/run-live-pool.sh`：核实窗口默认 1800000 → 300000；`BROWSER_POOL_POLL_INTERVAL_MS` 默认 1000
- 测试：`browser-mvp/test/post-payment-verification-window.test.js`、`browser-mvp/test/post-click-timing.test.js`（新）

付款前三件（`billing-address-fill.js`、`live-chatgpt-payment-adapter.js`、`payment-executor.js`）未动。

## 计时记录

- 位置：`~/Library/Application Support/pojia-browser-live/pool/post-click-timing.jsonl`（与 WAL 同目录，600 权限，超 10MB 滚动一次为 `.1`）
- 每行：`at`（UTC）、`runId`、`plan`、`event`（`human-verification-gate` / `checkout-outcome-watch` / `confirm-plan-active` / `payment-result`）、`ms`、结论字段、出错码、会话恢复梯子结果、页面位置（只留域名 + 第一段路径）
- 不记：卡号、CVV、Cookie、Token、邮箱、完整 URL；出错信息去掉 8 位以上数字串
- 包装层原样返回被包的结果、原样抛出被包的错误；写文件失败只吞掉

## 验收

- 生产会出现的三个来源（`run-live-pool.sh` 默认、LaunchAgent 值、配置 fallback）都能过池配置且能构造核实器；超上限的值池配置当场报错（测试 + 新版本目录 `run-live-pool.sh check pay` 实测）
- 演练跑不到点击之后，所以计时包装靠单元测试覆盖生产用的同一段函数：结果 / 错误对象同一、拒卡分支不变、页面观察出错仍落 UNREADABLE、写盘失败不影响；8 处故意改坏全部被测出
- browser-mvp 全量测试 0 失败；一次演练（新版本目录代码）到零税报价、停在点击前
- 池切到新版本后进程环境 `BROWSER_POOL_POLL_INTERVAL_MS=1000`、核实窗口 300000、跑 current

## 以后怎么用这份记录

首张真实客户单跑完后，读 `post-click-timing.jsonl` 里该 run 的四行：43 秒花在哪一段、当场确认为什么没成（`confirm-plan-active` 的 `confirmed` / `identityMatched` / `error.code` / `recovery`），再决定是否做「核实轮询 5 秒 → 2 秒」等后续提速。
