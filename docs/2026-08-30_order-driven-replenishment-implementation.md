# 订单驱动补给实施记录｜2026-08-30

## 本轮完成

- `ASSIGN_CARD` 在无合格卡时，按订单需求幂等排队自动开卡或订单关联补余额任务。
- 补给任务排队后，订单以 5 秒间隔重试分配；普通等待仍保持低频重试。
- 自动开卡仅在存在 `WAITING_FOR_CARD` 订单时触发，避免无需求购买库存。
- 显式订单补余额任务不再被旧的全局低余额扫描开关阻断；全库自动补钱扫描仍可关闭。
- Browser 路由的资金 attempt 与 dispatch job 入队保持同一事务；若事务失败不会留下资金栅栏。
- 若资金 attempt 已提交而 dispatch 入队遭遇临时故障，重试会复用同一个 `PREPARED/ACTIVE` attempt，不退款、不重复建立资金栅栏。

## 验证

- `npm --prefix v1 test`：439 pass，0 fail，38 skipped（缺少 `TEST_DATABASE_URL` 的隔离 MySQL 集成项）。
- Browser 测试：103 pass，0 fail，4 skipped。
- `git diff --check` 通过。

## 当前边界

- 本轮只完成代码和隔离测试，尚未部署生产。
- 生产 API Provider 写入、Browser Worker/gate、真实付款仍保持关闭。
- 生产启用前仍需候选 release 部署演练、资金/任务只读检查，以及明确的 API 写权限范围确认。

## 部署后只读验收（2026-08-30）

- 当前 release：`/opt/pojia/releases/20260830-order-replenishment-dd0037b`。
- Web/Worker active；`pojia-ops status` 正常；公网 live/ready 均 HTTP 200。
- readiness：`ok=true`，migration 041，活动任务/资金风险/UNKNOWN/对账案件均为 0。
- 当前接单与派发开关为开启，Provider/API/Browser 写入权限仍关闭；Browser Worker disabled。
- 卡资金补给 timer 当前 inactive，因此没有后台资金写入动作；本轮未创建订单、未开卡、未补余额。
- 定向订单驱动回归：88 通过、0 失败；本地全量 v1：439 通过、0 失败、38 环境跳过。

## 隔离 dry-run（2026-08-30）

- 订单等待补给、取消等待订单、资金任务幂等/额度边界、Browser 派发失败安全重试等定向场景：82 通过、0 失败、4 项因未配置 `TEST_DATABASE_URL` 跳过。
- 本次未连接生产数据库，未创建订单、未触发卡台开卡/补余额、未调用 Provider 写接口。
- 受限于本机未提供隔离 MySQL，数据库事务级场景仍需在隔离数据库环境补跑；不能把本次 dry-run 当作生产资金动作验收。

## 隔离 MySQL 复跑结果（2026-08-30）

- 已在生产 MySQL 容器中创建并自动清理临时测试库，完成迁移 001–041。
- 相关套件暴露 2 个**测试夹具/旧断言不匹配**，不是生产写入失败：
  1. 旧的自动补卡测试未创建 `WAITING_FOR_CARD` 订单，现按新规则返回 `NO_DEMAND`，旧断言仍期待 `FUNDS_REVIEW_REQUIRED`。
  2. 旧 fake-provider worker 测试仍按旧状态机断言 `COMPLETED`，当前订单驱动路由下返回值不再匹配。
- 其余该套件 34 项通过；Browser 相关文件在 v1 release 中缺少 Playwright 依赖，导致全量脚本另有环境性失败，未影响 Web/Worker 运行。
- 因此当前结论是：生产服务健康，但“完整隔离 MySQL 套件全绿”尚未达成；需先更新两处旧夹具/断言并重新复跑，不能宣称全部集成测试通过。

## 提交

- `e07e6a0 fix: retry browser dispatch handoff without releasing funds fence`
- 前置订单驱动补给提交：`aca1fb5`、`7a53ebe`、`eb8d427`
