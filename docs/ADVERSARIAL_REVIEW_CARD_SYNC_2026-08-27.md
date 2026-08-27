# 卡片库存同步专项合并前对抗式审查（2026-08-27）

## 审查对象

- 分支：`codex/card-inventory-sync-20260827`
- 原专项提交：`f182a05`
- 本次审查没有保留代码修正；临时试验提交 `6c5e18d` 已回滚（`91e8fce`）。
- 状态：尚未合并、尚未部署；以下结论仅适用于代码，不代表生产已生效。

## 已核实事实

1. 相对 `main`，专项提交修改 Provider 交易字段标准化、卡类型名称映射、卡目录同步、卡片接管重试、同步周期、库存告警去重及 Provider route account 读取。
2. 专项分支测试结果：`402 passed / 0 failed / 36 skipped`；跳过项是未配置 `TEST_DATABASE_URL` 的 MySQL 集成测试。
3. `npm test` 在本次工作树通过（402 通过、0 失败、36 跳过）。
4. 曾怀疑历史 `card_discoveries` 会阻断重新接管，并做了临时修改；但现有测试明确要求“已审核 discovery 在后续批次抑制重复行”，该修改导致测试失败，已回滚。因此这不是已证实缺陷，不能擅自改变现有规则。

## 仍需在合并前确认的边界

1. 交易 Schema 现在先做字段归一化再校验；未知字段会被 Zod 对象 schema 丢弃。当前测试覆盖通过，但若后续业务需要新字段，必须显式加入归一化与 schema，不能依赖透传。
2. `cardType` 名称映射采用精确且唯一匹配；无法唯一匹配时保持缺失并进入既有审查路径，不得改成模糊匹配。
3. Provider snapshot 在接管配置时可能为空；此时仍依赖 `default_card_type_id`，不能把 snapshot 缺失解释为 Provider 已确认。生产启用前需只读核对 snapshot 与当前 route account 一致。
4. `AVAILABLE` 同步间隔改为 10 分钟，会增加读取次数；这是代码事实，是否符合 API 成本目标需结合实际计费与订单量单独决定，不能由测试结果推断。
5. 告警去重逻辑会抑制同一 OPEN 案件的重复 Bark；只有案件解决后（或按确认条件）才重新入队。需由运营确认这符合“变化时是否再次提醒”的业务规则。

## 结论

当前结论：**未发现足以阻止合并的已证实代码缺陷，但仍不得视为已上线**。合并前至少完成：

1. 在隔离 MySQL 上补跑被跳过的集成测试；
2. 只读核对当前生产 route account、Provider snapshot、卡类型映射；
3. 确认 10 分钟同步频率与告警重新通知规则；
4. 用户确认后再合并、部署，并做生产只读验证；未确认前不执行任何 Provider 写操作。

## 同意后的执行记录

- `git diff --check`：通过。
- 关键 JS 文件语法检查：通过。
- `npm test`：402 通过、0 失败、36 跳过。
- 使用临时 MySQL 8.4 容器、完整执行当前 migrations 后，`test/mysql-integration.test.js`：33 通过、0 失败、0 跳过。
- 当前工作树未执行合并或部署。

## 合并后部署前复核（2026-08-28）

- 合并提交：`48aa85a merge: card inventory sync hardening`，已进入 `main`。
- 合并后 `npm test`：402 通过、0 失败、36 跳过。
- 临时 MySQL 8.4 + 全部 migrations：33 通过、0 失败、0 跳过。
- `deploy/server` 中 Browser 与只读同步单元的 Provider 写开关均为关闭；卡库存付费 runner 和直充 worker 仍是独立写路径，部署前必须保持停止/关闭。
- 当前只完成代码和隔离环境复核，尚未执行生产部署或生产只读核验。

## 生产只读核验（2026-08-28）

通过 SSH 只读检查当前 VPS：

- hostname：`elegant-unicorn-1.localdomain`
- release：`/opt/pojia/releases/20260827-browser-readonly-58af6f2`
- Web/Worker：`active`
- 卡库存付费 runner：`inactive`
- 只读同步与目录同步 timer：`active`
- MySQL：`running`
- migrations：最新 `037_card_discovery_latest_index`
- Provider read-check：HNSKJ account `67`、7 种卡类型、19 张可见卡；ZZSHU 连接正常。
- readiness（命令行强制写开关为 false）：`ok=true`，但数据库设置显示 `acceptNewOrders=true`、`dispatchNewRecharges=true`、模式 `AUTOMATIC`，且存在 1 个 active task。

这意味着本次 readiness 命令本身是只读的，但不能据此断言生产 Worker 没有接单/派发能力；生产数据库的接单与派发开关当前确实为开启状态。未在本次审查中擅自关闭，需由运营决定是否进入维护窗口。

## 维护窗口动作（2026-08-28）

经运营明确授权后执行：

- 停止 `pojia-worker.service`，状态确认 `inactive`。
- 数据库 `accept_new_orders`：`true → false`。
- 数据库 `dispatch_new_recharges`：`true → false`。
- 复核 readiness：`acceptNewOrders=false`、`dispatchNewRecharges=false`，其余阻断项为空。
- 当时仍有 1 个 `ASSIGN_CARD`、`PENDING` 任务；未擅自删除或推进，Worker 已停止以避免继续领取。

## 生产部署（2026-08-28）

- 已将 `main` 当前提交部署为 `/opt/pojia/releases/20260828-card-sync-43ca767`。
- 已切换 `/opt/pojia/current` 并重启 `pojia-web.service`；Web 状态 `active`，本机 `/health/live` 与 `/health/ready` 均返回 `ok/ready`。
- `pojia-worker.service` 继续保持 `inactive`；卡库存付费 runner 继续 `inactive`；只读同步 timer 继续运行。
- 接单与派发数据库开关继续为 `false`，Provider 写开关继续为 `false`。
- 部署后 readiness 返回 `ok=false`，唯一阻断项为 `worker_heartbeat_stale`，原因是按维护窗口要求 Worker 保持停止；这不是代码故障。
- 未执行 Provider 写操作、开卡、充值、付款或退款。
- 部署后 Provider 只读检查：通过；HNSKJ account `67`、7 种卡类型、19 张可见卡；ZZSHU 连接正常。

## 部署后同步观察（2026-08-28）

- 只读同步/目录同步日志持续正常运行，无进程异常退出。
- 最近一次目录对账：Provider 总卡 19，Provider active 8，本地 `AVAILABLE` 2、`ASSIGNED` 2、`DEPLETED` 2；Provider active 中有 2 张仍为 `CARD_QUARANTINED_OR_REVIEW`（外部卡 ID `1065`、`917`），未被擅自分配。
- 本地库存查询：`AVAILABLE=2`、`ASSIGNED=2`、`DEPLETED=2`。
- 当前仍有 1 个 `ASSIGN_CARD/PENDING` 任务（task id `22`）；Worker 保持停止，未领取、删除或推进该任务。

连续 3 个目录同步周期（16:18、16:24、16:29 UTC）结果一致：Provider 19/active 8、本地 `AVAILABLE=2`、`ASSIGNED=2`、`DEPLETED=2`、未解决 active 仍为 `1065`/`917`；部署后没有新增 discovery 记录。

## 运营方提供但尚未独立验证的信息（2026-08-28）

运营方表示：`1065` 与 `917` 两张卡均已实际消费过，一张用于 Claude 200 美元档位会员，另一张用于 ChatGPT Plus。该信息目前仅来自运营方口述，尚未通过本地订单/卡片交易记录或 Provider 交易查询独立核实，不能当作已验证事实，也不能据此自动修改库存状态。验证前继续保持 `REVIEW_REQUIRED`，不分配、不删除；后续应以可追溯交易证据确认消费状态及产品对应关系。

## Provider 只读交易核验（2026-08-28）

- `1065`：返回 2 条交易，其中 `PURCHASE / SUCCESS / 200.00 USD / ANTHROPIC* CLAUDE SUB`，并有 `CARD_ISSUE_RECHARGE` 201 USD；已独立验证该卡发生过 Claude 200 美元消费。
- `917`：返回 5 条交易，包含 196 USD 注资、200.99 USD 余额转出、1 USD 注资及 1 USD 余额转出；本次返回中没有 ChatGPT 商户消费记录，因此“用于 ChatGPT Plus”仍未独立验证。
- 两张卡均继续保持 `REVIEW_REQUIRED`，未修改库存状态、未分配、未执行写操作。
