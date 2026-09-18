# 接班一屏（HANDOFF_NOW）

更新：2026-09-19 UTC（第⑥步「工作台」C 精修**已上生产**：release `20260919-step6-8cd6d7e`，无迁移；三服务新连接独立核实 + getOverview 按台聚合只读复验通过）。按 CLAUDE.md 约定维护，接手者从 main 继续。

## 现在是什么

- **V2 落实 8 步：①②③④⑤（含⑤b）已上生产；第⑥步「工作台」第一版已上生产**（release `20260919-step6-8cd6d7e`，2026-09-19 UTC 切换，**无迁移**，回滚点 `20260918-step5b-b0a36d4`）。
- **第⑥步 = 四页重做（工作台/CDK/卡片/设置）**。工作台采用 **C 看板优先·精修**（D-283；三版比稿 `docs/design/prototypes/step6-workbench-compare.html` 可切 A/B/C + 日夜）。**已上生产的工作台**：营业条五决定（候光皮、复用现有 handler 契约）/ 数字墙 / **卡与钱两台真数**（hnskj 可分配 0 / backup-a 2，复用 `eligibleInventoryCardSql`）/ 日对账 / 队列（资金核对案例可解决+写账本，其他类跳专页）/ CDK 快捷生成即复制 / 全局定位搜索。前端不换栈（D-281）：候光皮 `workbench.css`（`.workbench` 作用域，不碰旧页）。
- **测试**：v1 全量单元 **831/831 绿**（改核心 getOverview 波及 4 类测试全负责任修，无一靠改测试掩盖）。

## 证据从哪里看

1. `docs/HANDOFF_LOG.md` 末尾「2026-09-19｜第⑥步工作台」节：实现 / 测试闭环 / 发布逐条。
2. `docs/DECISIONS.md` D-283（选 C 精修 + 导航 6 页 + 自动完成率口径）；D-281（前端不换栈）；D-279/D-280（CDK/卡片页需求）。
3. `docs/CURRENT_STATE.md`：release / 三服务 PID·cwd / 回滚点 / 备份已更新。
4. 生产验证：web 1681208 / worker 1681215 / bark 1681232 均新 release·active·NRestarts=0；getOverview 按台聚合 hnskj 0 / backup-a 2。

## 接下来做什么（顺序）

1. **Lemon 用工作台一天给反馈**（任务书验收要的）。ops 后台登录后首页即新工作台。
2. **补工作台三个待接入数**（口径已定，各需摸源 + 生产只读验证再接）：今日花费按台、自动完成率（口径＝进过任何人工待办即非自动，D-283）、highvcc 钱包水位。
3. **sidebar 加「设置」第 6 项**；待销确认 / 手动用卡登记的完整处理放卡片页（D-280）。
4. **其余三页**：CDK（D-279 七条）、卡片（D-280 八条）、设置页。

## 已定不做 / 别再重开的

- 工作台三个数「待接入」是诚实占位、不是 bug——每个要多表聚合 + 生产只读验证 + 口径确认，逐个接，别拿 inventory_status 之类近似糊上去（D-280 硬约束：复用资格规则）。
- 队列「真处理」工作台只做资金核对案例（缝 j 核心，复用 `resolveReconciliationCase`）；待销 / 手动用卡的完整处理在卡片页 D-280，不在工作台另做。
- 前端不换栈（D-281）；物理拆 `common.js` 等放四页都做完再做（渐进拆分）。

## 未验证边界（别说成已完成）

- **工作台真实使用未经 Lemon 用一天**：渲染 + getOverview 生产复验过，但营业条改开关 / 队列解决 / CDK 生成的**真实点击**未在生产走过（本地 mock 验渲染 + 复用现成 handler；营业条/队列按钮契约沿用旧代码，逻辑未变）。
- **三个待接入数未接**：今日花费 / 自动完成率 / highvcc 钱包在工作台标「待接入」，未实现。
- 现场非终态订单 0、无真单样本时，队列 / 今日订单在生产是空的（渲染正确、无数据可显示）。

## 分支、运行与禁止事项

- main 是接手入口；本窗口提交已 push（`origin/main` 同步）。隧道 13306 保留。
- 常驻 Browser 池 **PID 67131** 不要当残留杀掉。
- 开卡 / 补余额 / 充值 / 付款 / 退款 / 切路线 / 发布 / 改开关 / 重启 worker **先开口问**；范围外发现只报不改（D-254）。
- **每次发布后核对三服务 cwd**（bark——switch 打印的 `bark cwd=/` 是假值，用新连接 `readlink /proc/<pid>/cwd` 独立核实，D-271）。

## 暂停/恢复记录

- **本窗口**：三版比稿 → Lemon 选 **C 看板优先·精修**（删两路线耗时 / 订单整宽 / 留今日订单表）→ 实现工作台（卡与钱两台真数**复用资格规则 + 生产只读验证**、队列资金核对可解决）→ 全量单元 831 绿 → Lemon 确认「切」→ 发布 `20260919-step6-8cd6d7e` → 三服务独立核实 + getOverview 只读复验通过。**全程 switch 前停下等 Lemon 确认，未擅自发布。**
- **外部字段验真两次救场**：highvcc 不是独立卡台账户（`provider_accounts` 只有 legacy-primary(hnskj)/backup-a(manual_excel)，highvcc 开卡快照进 backup-a）；`locked`/`status` 列名两次猜错 → 教训是先 DESCRIBE 再查。
- **测试闭环负责任修 4 类**：admin-read-service mock 错位（我的按台查询偷了 browserProfile 返回）/ 悬空 elements 引用（删旧 id 但 admin.js 还 querySelector）/ 内联 style 真问题（挪进 CSS）/ 版本号 + 旧文案随 UI 同步（保留「关闭不显示成开启」意图）。
