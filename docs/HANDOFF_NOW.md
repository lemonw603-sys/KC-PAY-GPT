# 接班一屏（HANDOFF_NOW）

更新：2026-09-24 11:3x（UTC+8）＝ 03:3x UTC。当前执行顺序以 **D-352** 为准，「可离开」第一条以 **D-366** 为准。本窗口（acd69d1e）写。

## 现在的状态（证据：CURRENT_STATE.md；以下 03:34 UTC 现查）

- 生产 release **`20260924-block7-batch2-0d06f41`**，迁移最新 061（回滚点 `20260924-block7-batch1-eadcd37`；回滚到删表前的版本须先重建表，见 CURRENT_STATE）。默认路线 BROWSER（D-353），Browser Plus 用 highvcc（backup-a）。
- 可分配 Plus 卡 1 张（highvcc 8718，能充 3 单）；钱包 HNSKJ $104.71 / highvcc $34.24。非终态订单 1（WAITING_FOR_SESSION，无卡）。
- **HNSKJ 供卡故障仍在**（`CARD_STOCK_PURCHASE_DISABLED`；原因＝HNSKJ 卡台自身维护中，Lemon 告知）；Lemon 已把 HNSKJ Plus 水位设 0（D-363）。不影响 Browser 接单。
- 本机常驻池 PID 6667 + supervisor 61962 在跑，Browser 心跳 03:35 UTC 新鲜。

## 本窗口已完成并发布（D-363～D-366）

- ⑤ 故障重试不再先关缺卡告警；缺口真补上/真开出卡才关。
- ①～④：卡与钱每格一行（按 Lemon 屏幕 1440×730）；两台钱包「上次余额 + 查询时间 + 刷新余额」；成功提示 4 秒消失；「更新登录」先查登录；卡片页 highvcc 格直接显示余额。字体 B（12px/500，数字正文字体）。
- 欠账 16（逐个候选 + 一致排序）、17（转台只替等卡单）；同台「卡台故障」推过则「缺卡但开不出来」不另推。
- 自检补漏：`state-check.sh` 加两台 Plus 水位 + HNSKJ 故障状态。

## 下一可执行项

1. **块 7 删表已完成**（D-367，两批：迁移 060 删 5 表、061 删补余额线 2 表 + 开关；补余额两个定时任务停用并删 unit）。剩余：`checkout_artifacts` / `browser_artifact_secrets` 并入块 6；块 7 只剩「可离开」收尾＝等第一张真实客户单（下一条）。
2. **「可离开」第一条（D-366）**：等第一张真实客户 Plus 单。来单 Bark 会推 → Lemon 开窗口 → 执行者按 RUNBOOK §1 全程盯、逐项对照 `contracts/2026-09-18_delivery-criteria-contract.md`；此后数「连续 10 单真实客户单无人介入」。不自费、不需 free 号。
3. **块 6 = Pro 5x**（D-370；20x 官方暂停）：任务书 `tasks/2026-09-25-block6-pro5x-browser.md`（白名单 5 个 browser-mvp 文件 + 测试，付款前三件不动）。**待 Lemon**：批白名单；演练前置（Lane 3 号的 Session 由他在客户页建单；5x 演练要不要开一张 $100 的 5x 卡）。5x 卡金额不用调（免税后约 $93）；5x 真钱等客户单。

## 下一件（Lemon 2026-09-24 定）

- **KC-PAY-GPT 评估已出**（`reviews/2026-09-24-kc-pay-gpt-evaluation.md`）：它就是本仓库根目录封存的旧代码（29/31 文件逐字节相同）；本地路线＝`browser-mvp` 的前身且 Plus 裸调结账接口 400，不再单独做；第三方路线＝另一个 ZZSHU 式代充商，唯一增量是可能接受 highvcc 卡。**待 Lemon 定**：第三方路线试不试（需买 API Key + 一次小额真钱受控测试）、Lane 3 免费测试号能否用于块 6 PoC/演练。

## 已定不做 / 禁区

- 付款前三件（`billing-address-fill.js` / `live-chatgpt-payment-adapter.js` / `payment-executor.js` submit 段）不改（D-254）；browser-mvp 改动走任务书白名单。
- 不重开：D-248、D-240、D-253、D-249、D-275、D-306、D-359 裁定。资金与生产动作当次确认；**发布先问**。
- 回复 Lemon：开头三点定位，**结尾一节「要你决定的」列全**（AGENTS.md，2026-09-24）；排版以 1440×730 为准、格内不换行（DESIGN.md）。

## 待 Lemon 定 / 待他做

- `DESIGN.md`「概览」一节的措辞核对（上一窗口遗留）。

## 未验证边界

- HNSKJ「刷新余额」成功路径未在生产点过（本机无卡台凭据，只验了失败态）；Lemon 第一次点即首次真跑。
- 欠账 16/17 与「故障盖住缺卡」只有单测、隔离 MySQL 与重演证据，生产无真实触发样本。
- 当前 release 真实付款、取消续费、付款不明恢复、Browser 崩溃补核均无真单样本（`UNVERIFIED_LEDGER`）。
- FB-04：1657 / 3159 / 7402 三张 highvcc 卡 Lemon 尚未销卡（不急）。D-352 六条结构性问题中未随块 3 处理的仍只在代码层。

## 每块收尾

跑 `scripts/wrapup-check.sh`；向 Lemon 交「我理解的决定」清单；重写本文件。
