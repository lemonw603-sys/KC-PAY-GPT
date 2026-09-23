# 接班一屏（HANDOFF_NOW）

更新：2026-09-23 14:45（UTC+8）。当前执行顺序以 **D-352** 为准（覆盖 D-329 门槛与 PROJECT_MAP 旧八步⑥之后的排序）。

## 现在的状态

- 生产 release `20260921-feedback-d340-7e88952`（D-341）；`state-check.sh` 11 项一致（2026-09-23 06:08 UTC）。生产数值只看 `CURRENT_STATE.md`。
- 09-19 起生产 0 单；最近真钱成功 09-16（旧版代码）；此后 6 次发布无真单样本。
- highvcc token 09-19 起失效，快照 4 天未更新，`pojia-highvcc-snapshot-sync.service` failed。
- 本机 pool worker PID 67131 自 09-18 07:06 UTC 跑至今，代码为 09-18 版。
- 订单页工作块（D-345～D-351）已停，D-352 定为块 5、待块 4 真实单后重定需求。

## 下一可执行项（按 D-352 块序）

1. **块 1**：Lemon 贴新 highvcc token（`v1/scripts/set-highvcc-token.mjs`），新连接核实快照恢复、服务 active。
2. 块 2：A/B 反馈台账（`tasks/2026-09-21-post-step6-feedback-plan.md` FB-01～08）逐条只验已发布项，Lemon 裁定关闭。
3. 块 3：运营不在场三硬伤（付款不明只隔离账号 / 入单查心跳 / 处理中超时转人工），动 browser-mvp 前先列文件白名单给 Lemon 批（D-254）。
4. 块 4：Lemon 自己跑真钱 Plus 单验收（API 一单 + Browser 若干），每单对照交付判据合同。

## 已定不做 / 禁区

- 付款前三件（`billing-address-fill.js` / `live-chatgpt-payment-adapter.js` / `payment-executor.js` submit 段）不改（D-254）。
- 不重开：接口三段统一（D-248）、早交付（D-240）、卡台解耦到 API（D-253）、自动续 token（D-249）、完整财务总账（D-275）、自动开卡总开关（D-306）。
- 四页（工作台/CDK/卡片/设置）沿用不重做；订单页不先做（D-352）。
- 资金与生产动作当次确认；发布先问。

## 未验证边界

- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核、分卡当场同步均无真单样本（`UNVERIFIED_LEDGER`）。
- 代码显示的六条结构性问题（D-352）未在生产复现，只有代码证据。
- web/worker/bark 三进程 journal 去向未查到。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
