# 任务书：V2 阶段 2.5 · A 组业务实际全审（2026-09-17）

> **开专门新窗口做**。靠本任务书 + `docs/V2.0_EXECUTION.md`（§3.A、§2）+ `docs/DECISIONS.md`（D-219/D-241/D-242）恢复状态，不依赖任何会话历史。先读 `AGENTS.md` 的四份阅读顺序进入。

## 目标
把 V2 A 组方案（§3.A：横贯前置 G1/G2 + A1–A6）**逐项拉到真实业务过一遍**，揪出账本里"照文档推、没对上业务实际"的判断并改。这是阶段 3 落实的前置门——Lemon 2026-09-17 定（D-242）：**"文档层面过审 ≠ 业务实际终审"**。**本阶段只审、只改方案/账本，不改任何生产代码、不开卡、不切路线、不发布。**

## 错判样板（照这个颗粒度审其余每一项）
**A4 供卡策略**：账本 §3.A 原判"主力 highvcc 手动够用、hnskj 自动开卡只作故障补充 / 非阻塞 / 排后"，Lemon 2026-09-17 当场纠正——**hnskj 与 highvcc 两台同等重要、经常来回切**（D-242、记忆 `two-card-platforms-equal`）。→ ① hnskj 自动开卡不能排后，要与 highvcc 一样自动、随时供得上；② A1 切换解耦分量加重。**A4 首先按"两台并重"重写；A1 的权重相应上调。**

> **2026-09-17 A 组已审 5 项 + 自审（上一窗口，详见账本 §3.A 各 📋 标注 + D-242）：**
> - **A1（重磅）**：现两套卡台机制并存 + `resolveCurrentCardProviderAccount:16` 写死 hnskj；**Lemon 的"卡台↔支付方式解耦"设计技术可行**（ZZSHU `buildDirectOrderRequest` 不认卡台、highvcc 卡凭证齐、Browser 也不认）。**自审订正**：原写"切换健康检查错位"有误（挂死代码 `switchRoute`，没挂路由），真问题是**生产切换 `setDefaultRechargeMethod` 根本不查卡池/卡台**（切 API 完全不查、切 Browser 只查 worker）→ A2 切换前校验是从无到有的真缺口。**待 Lemon 实测**：highvcc BIN 卡走 ZZSHU 能否真支付成功（黑盒）。
> - **A4**：highvcc 有程序化开卡（`openCard`→newCard，09-10 生产确认）→ 两台都可自动开卡；A4 按"两台并重"重写（原"highvcc 手动/hnskj 排后"作废）。
> - **A2**：账本基本对，补两点——付款不明两条路线两套机制（API `pollRecharge` 查 ZZSHU / Browser confirmPlus + 崩溃 `reconcile`）、Browser 崩溃单落 `RECONCILE_ONLY` 人工兜底（自审坐实 Browser 不走 pollRecharge）。
> - **A3**：全局 `default_open_card_amount=16` 与 `card_max_successful_payments=3` 打架（允许 3 单只放 1 单的钱）→ 按产品化正好修。
> - **A5**：hnskj 开卡+销卡都有 API；highvcc 开卡有 API、**销卡无 API**（手动删）。
>
> **新窗口从这里续**：① 剩 **A6**（卡可用查询，今天验证 `eligibleInventoryCardSql` 可按卡台查、基本成立）、**G1**（highvcc 交易/钱包接口已确认存在 `transactions`/`wallet`，入库可行）、**G2**（账本计数，未细审）；② 然后 **B/C 组**。动作模板：账本原方案 vs 真实、揪错判、每个"对不上"要真证据、拿不准问 Lemon。**⚠️ 自审教训：别照死代码/字段推——先核到底"用没用、验没验"**（A1 的"错位"就是照死代码 switchRoute 推出来的假问题，自审才揪回）。

## 今天（09-17）救火摸到的真实素材（审时对进方案）
- **A2 切换前校验（半成品实证）**：手动切回 API 前查了——目标路线 `executor_kind` 唯一、卡池可分配 > 0（正式资格 `eligibleInventoryCardSql`）、provider `circuit_state=CLOSED`/`read_enabled=1`、`route_version` 对得上。**这套就是 A2「切换前校验」要自动化的清单**（`provider-route-admin-service.js` 的 `switchRoute`/`setDefaultRechargeMethod` 已有骨架）。
- **A1 切换解耦（实证）**：`setDefaultRechargeMethod` 切路线时没连带动卡台——但今天是"恰好"（API 固定 hnskj、Browser 固定 highvcc），A1 要把这"恰好"做成"设计"（卡台=执行器属性，D-219 发现 5）。
- **供卡开卡断点（A4）**：手动开卡执行器 `v1/scripts/card-stock-job-runner.js` 无常驻服务 / 无 timer，后台"人工开卡"只建 PENDING job、不自动执行（D-241）。两台同等后，两边开卡都得自动可靠——这直接冲击 A4 的"主力手动即可"判断。

## 建议审的顺序
先审今天有真实素材、且已被纠正的：**A4（供卡，按两台并重重写）→ A1（切换解耦 + 一键切换）→ A2（切换前校验）**，再回落实顺序补 **G1 → G2 → A3 → A5 → A6**。（顺序可调，但 A4/A1/A2 最该先，今天的真实直接冲击它们。）

## 每项的验收（Lemon 逐项审、逐项拍板）
- 每项：**账本原方案 vs 真实业务，逐条标「对得上 / 对不上（错在哪、真实是什么、怎么改）」**——像 A4 那样。
- **不许照账本推**：每个"对不上"必须有真实代码 / 生产 / Lemon 确认的证据（三道闸门当动作做，不当口号）。业务实际里只有 Lemon 知道的（怎么切、怎么开卡、频率），拿不准就问，别猜。
- 结论落回 §3.A（改方案）+ 必要时 DECISIONS；当轮落盘。

## 边界
- 只审方案、改账本 / DECISIONS，**不碰生产代码、不开卡、不切路线、不发布**。
- 全审是六面（A/B/C）都审；本任务书先做 **A 组**，A 组过完 Lemon 认可后，B、C 组各自再开窗口。
- 收尾靠 `scripts/wrapup-check.sh`，八项全绿才算没留尾巴。
