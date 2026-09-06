# 2026-08-31｜一卡多单与自动补余额部署后只读验证

## 结论

部署验证通过，当前生产可继续运行；本次仅做只读检查，没有开卡、补余额、付款、退款或提现。

## 现场证据

- 当前 release：`/opt/pojia/releases/20260831-card-reuse-068c070`
- Web/Worker：`active/enabled`
- 卡片库存 runner timer：`active/enabled`（60 秒间隔）
- 卡片读同步、卡目录同步、Bark：`active/enabled`
- Browser Worker：`inactive/disabled`
- 卡资金 timer：`inactive/disabled`
- 本地与公网 live/ready：均返回正常
- readiness：`ok=true`，最新迁移 `043_order_assigned_card`；活动任务、过期租约、未知 Provider 调用、活动资金风险、开放对账案件均为 `0`，`blockers=[]`
- 接单/派发：`acceptNewOrders=true`、`dispatchNewRecharges=true`，保持部署前状态
- `pojia-ops check`：通过；最新加密备份 `/var/backups/pojia/pojia-20260830T235805Z.sql.gz.enc` 完整性 `OK`
- Web/Worker 最近 15 分钟无 warning 日志；库存 runner 最近执行均为 `NO_DEMAND`，未触发自动开卡

## 边界

常驻 Web/Worker 的 Provider 写权限保持关闭。库存 runner 仍按已确认的“无卡自动补卡”运营策略保留，但本次没有补卡需求，也没有发生卡台写入。

## 本地控制面静态复核

- 管理后台 HTML/JS 关键控制项均存在：默认充值方式、开始营业、接单/自动充值、卡段刷新、只读同步、每卡成功次数上限、自动补卡上限。
- JS 中发现的 9 个“缺失 ID”均属于订单详情按需生成的动态按钮，不是页面初始 DOM 缺陷；JS 调用的固定管理 API 均有服务端对应路由，带查询参数的列表 URL 属于同一路由。
- 本次未进行浏览器点击级复核，因为当前会话没有可用的浏览器控制连接；生产接口和服务状态已通过 SSH/curl 只读复核。
