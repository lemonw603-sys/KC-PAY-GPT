# 接班一屏（HANDOFF_NOW）

更新：2026-09-23 16:45（UTC+8）。当前执行顺序以 **D-352** 为准（覆盖 D-329 门槛与 PROJECT_MAP 旧八步⑥之后的排序）。

## 现在的状态

- 生产 release `20260921-feedback-d340-7e88952`（D-341）。**默认路线已切 BROWSER**（08:13 UTC，D-353）；API 路线代码标未验证。生产数值只看 `CURRENT_STATE.md`。
- 09-23 08:33 UTC 第一单真实客户单 `PJV1-_xH487IWWc0h0fi8pqY9`：预检 ACCOUNT_ALREADY_PLUS 付款前安全中止，卡已释放，等客户重贴（暂不会）。付款后半段仍零样本；最近真钱成功 09-16（旧版）。
- highvcc token 已于 07:04 UTC 更新，07:12 轮次同步成功、快照 $44.74（块 1 完成）。
- 本机 pool worker PID 67131 自 09-18 07:06 UTC 跑至今，代码为 09-18 版。
- 订单页 = 块 5，紧接块 3；真钱只留 Plus 一单（块 3 后）+ 20X 一单（块 6），其余用 rehearsal（D-352 补记）。

## 下一可执行项（按 D-352 块序）

1. **块 3**：运营不在场三硬伤（付款不明只隔离账号 / 入单查心跳 / 处理中超时转人工），动 browser-mvp 前先列文件白名单给 Lemon 批（D-254）。
2. 块 4：Plus Browser 真钱一单（仅此一单），对照交付判据合同；其余用 rehearsal。
3. 块 5：订单页三个问题 → 拍板 → 做一版。

## 已定不做 / 禁区

- 付款前三件（`billing-address-fill.js` / `live-chatgpt-payment-adapter.js` / `payment-executor.js` submit 段）不改（D-254）。
- 不重开：接口三段统一（D-248）、早交付（D-240）、卡台解耦到 API（D-253）、自动续 token（D-249）、完整财务总账（D-275）、自动开卡总开关（D-306）。
- 四页（工作台/CDK/卡片/设置）沿用不重做；订单页不先做（D-352）。
- 资金与生产动作当次确认；发布先问。

## 待 Lemon 定

- 已是 Plus 的账号提交（续费场景）当前预检一律拒；要不要支持。
- 手动补余额后卡 `funded_amount` 不跟进（0601 例），D-217 规则把它判不合格；登记方式待定。
- 块 3 文件白名单待批（见 HANDOFF_LOG 09-23 块 2 章节后的报告）。

## 未验证边界

- FB-04：1657 / 3159 / 7402 三张 highvcc 卡 Lemon 尚未销卡（不急），销后核实登记。

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核、分卡当场同步均无真单样本（`UNVERIFIED_LEDGER`）。
- 代码显示的六条结构性问题（D-352）未在生产复现，只有代码证据。
- web/worker/bark 三进程 journal 去向未查到。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
