# 诊断页接线与防绕过验收

**本地实现及隔离验证完成，未发布。** 依据D-325以及用户对`step6-diagnostics-interaction.html`回复“没问题”（D-326）。保持候光风格、六个导航及现有资金执行逻辑；不新增数据库迁移，不改browser-mvp，不改变付款开关。

## 完成与证据

| 已确认事项 | 实现证据 | 实际验收 |
|---|---|---|
| 四段轻量布局 | index.html诊断区域、diagnostics.css；旧诊断大块被替换，原Browser筛选/分页/接管与账单表单保留 | 桌面1440/手机390无整页横溢出；原型9项几何契约通过；gap22→2变异被拒绝 |
| 付款不明只能正式收口 | reconciliation-case-service.js在事务锁内拒绝API/BROWSER_PAYMENT_UNKNOWN及两种历史SUBMIT_UNKNOWN类型，返回CASE_REQUIRES_ORDER_RESOLUTION；create-app映射409。listCases返回requiresOrderResolution | 4条真实隔离DB路径直接伪造通用关闭请求均409，订单/资金/卡/CDK/case/告警快照不变；随后从诊断进入原订单正式收口成功 |
| 普通case仍能关闭记录 | 诊断只对普通记录显示“关闭记录”，原分配动作在展开区域保留 | 合成OPERATOR_NOTE经真实表单关闭、结论保留。它不是资金核实动作，也未新增独立审计表 |
| 逐卡对账有真实落点 | diagnostics.js读取已有GET reconciliation/daily（persist:false），消费discrepancies/pendingRegistration/cards，沿用后端判据；卡台名称取现有card-sources | 分类计数对照真实日对账服务；展开账本/卡台/金额/同步证据；通过providerCardId+providerAccountId打开原卡片流水详情，不推测订单关联 |
| 按订单排查 | 精确订单查询后进入原订单详情；Browser执行表仍走原getRun与control端点 | 实际订单检索及详情可达，原4条Plus收口成功 |
| 低频工具保留 | CSV原端点与唯一按钮保留；账单配置仍原表单/原服务，设置页链接自动展开低频区并定位 | 合成姓名保存后独立SQL核对；CSV HTTP200含合成订单、未包含Session/卡密文字字段 |
| 失败不伪装正常 | runtime/case/report各自错误反馈；失败报告清空旧结果/计数；配置读失败禁用保存；请求轮次拒绝旧报告覆盖新报告 | 500/503注入后显示读取失败和“—”，重试恢复；错序响应单测通过 |

来源索引：`v1/public/admin/assets/diagnostics.js`为新只读页面控制器；`admin.js`保留现有业务操作，只调整入口与加载。`diagnostics.css`作用域限定诊断；新增CSS/文案扫描目标。新CSS字面色/规范外控件高度/重复选择器均0，旧文件基线未放宽。admin.js缓存版本84，新诊断CSS/JS版本1。

## 测试结果

```bash
DIAGNOSTICS_ACCEPTANCE=1 node scripts/step6-safety-acceptance.mjs
npm --prefix v1 test
node scripts/css-drift-check.mjs
node scripts/ui-copy-check.mjs
```

- [evidence.json](evidence.json)：2026-09-21最终完整重跑24项隔离检查通过，精确UTC起止见startedAt/finishedAt。包括既有资金/恢复负例；不是24项全新的诊断功能。commit字段为运行前HEAD，sourceSha256绑定实际验证工作区的六个入口/实现文件，落盘前逐个重算一致；不能用运行前HEAD冒充新代码提交。
- [default-tests.txt](default-tests.txt)：1048 tests / 979 pass / 0 fail / 69 skipped。新增12条付款不明类型/状态保护，6条页面数据/错误/错序/结构测试。69条跳过不算验证通过。
- [mysql-tests.txt](mysql-tests.txt)：既有Browser未知付款真实MySQL12/12通过，其中历史Pro分支只作兼容回归，不是新Pro验收。
- [parity.txt](parity.txt)、[mutation.txt](mutation.txt)：冻结已确认稿外部CSS后对照9项几何；故意改间距退出1。首次契约将根元素当子元素找、首次变异脚本误用URL pathname编码路径，均修正后完整重跑，未把环境失败当通过。
- [桌面实图](desktop.png)、[手机实图](mobile.png)：最后运行使用处理后的合成数据，所以核对case为空、对账仍有记录；不是生产数量。看到状态简条、主核对区、分类明细、按单排查的阅读顺序；手机标题与搜索分行，退出入口保留。
- node语法、无重复HTML id、git diff检查通过。删除旧重复导出按钮对应死handler；没有借调整删除其他页面能力。

## 验收边界与遗留

- 本次测试没有Provider或执行Worker，所有数据库/订单/卡/账号均本机合成。专用库/账号剩余0/0；临时Chrome/服务/恢复容器已关闭。用户8804演示与既有8899原型服务未动。
- 原型只负责已确认动线/风格。实现保留真实筛选、分页、全局搜索和高级操作，不照抄原型的假数据/统一假收口表单；因此不对内容行高/整页高度作虚假的相等断言。
- 当前两个生产历史OPEN案例关联CLOSED订单，**没有自动关闭它们**。新保护不会绕过资金流程给历史记录开后门；历史清理需另行按证据处理。
- 日对账接口仍为现有只读计算，不把“多刷新几次”当连续多日差异。金额无法核对和次数差异可同时出现在同一卡上，分类不是互斥销售状态。
- 非本次范围：Pro同型、全项目旧MySQL夹具、生产真实资金验收、历史账目清理。付款不明机制的4条Plus实测不等于整个系统零风险。
- 仅生产只读state-check：仍⑤b/054，项目核对项一致；没有部署、权限或生产数据写入。新发布候选需纳入本轮诊断改动，旧5e7e717不能声称包含它。
