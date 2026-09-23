# 接班一屏（HANDOFF_NOW）

更新：2026-09-23 16:55（UTC+8）。当前执行顺序以 **D-352** 为准（覆盖 D-329 门槛与 PROJECT_MAP 旧八步⑥之后的排序）。

## 现在的状态

- 生产 release **`20260923-block3-6807de8`**（12:34 UTC 切换，块 3 服务器侧已上线；回滚点 `20260921-feedback-d340-7e88952`）。默认路线 BROWSER（D-353）；API 路线代码标未验证。生产数值只看 `CURRENT_STATE.md`。
- 09-23 08:33 UTC 第一单真实客户单 `PJV1-_xH487IWWc0h0fi8pqY9`：预检 ACCOUNT_ALREADY_PLUS 付款前安全中止，卡已释放，等客户重贴（暂不会）。付款后半段仍零样本；最近真钱成功 09-16（旧版）。
- highvcc token 已于 07:04 UTC 更新，07:12 轮次同步成功、快照 $44.74（块 1 完成）。
- **块 3 代码完成并推送（`6807de8`）**：v1 1019 pass / browser-mvp 300 pass / 隔离 MySQL 集成 54 pass（另 14 条是 D-258 老失败，基线工作树同样 14 条）。**服务器侧已发布；未 rehearsal、本机池未重启**（PID 67131 仍是 09-18 代码，lane 守卫改动未生效）。
- 生产此刻 **可分配卡 0 张**：8718 被 WAITING_FOR_SESSION 单持有；hnskj 两张 10:15 UTC 变 $0.01 DEPLETED；0601 变 $1.99。钱包 hnskj $104.71 / highvcc $34.24；调度器报 WALLET_BELOW_FLOOR 不开卡（规则未核）。
- 订单页 = 块 5，紧接块 3；真钱只留 Plus 一单（块 3 后）+ 20X 一单（块 6），其余用 rehearsal（D-352 补记）。

## 下一可执行项（按 D-352 块序）

1. **块 3 收尾**：① rehearsal（Lemon 自己在客户页贴 free 号 Session 建单，Session 不经执行者；顺序：停池 `stop-live.sh` → `set-intake-executor-check.mjs off --apply` → Lemon 建单 → `run-live-rehearsal.sh once` → `close-rehearsal-order.mjs` 收口 → check `on --apply` → 开付款 → supervisor 拉起新池）；② 演练前要有可分配卡：8718 被 WAITING_FOR_SESSION 单占着，待 Lemon 定是否关单放卡；③ 回填预览候选 0，本轮不 apply。
2. 块 4：Plus Browser 真钱一单（仅此一单），对照交付判据合同；其余用 rehearsal。
3. 块 5：订单页三个问题 → 拍板 → 做一版。

## 已定不做 / 禁区

- 付款前三件（`billing-address-fill.js` / `live-chatgpt-payment-adapter.js` / `payment-executor.js` submit 段）不改（D-254）。
- 不重开：接口三段统一（D-248）、早交付（D-240）、卡台解耦到 API（D-253）、自动续 token（D-249）、完整财务总账（D-275）、自动开卡总开关（D-306）。
- 四页（工作台/CDK/卡片/设置）沿用不重做；订单页不先做（D-352）。已 Plus 账号不充（D-354）。
- 资金与生产动作当次确认；发布先问。

## 待 Lemon 定

- 块 3 文件白名单待批（见 HANDOFF_LOG 09-23 块 2 章节后的报告）。

## 未验证边界

- FB-04：1657 / 3159 / 7402 三张 highvcc 卡 Lemon 尚未销卡（不急），销后核实登记。

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核、分卡当场同步均无真单样本（`UNVERIFIED_LEDGER`）。
- 代码显示的六条结构性问题（D-352）未在生产复现，只有代码证据。
- web/worker/bark 三进程 journal 去向未查到。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
