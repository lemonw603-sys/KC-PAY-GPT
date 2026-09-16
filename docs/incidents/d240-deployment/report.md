# D-240发布验证（2026-09-16）

## 结果

生产release：`20260916-d240-b31a88a`，源码单提交`b31a88af7ad42132202ac12b993a889cd55d827f`。

- prepare：备份`/var/backups/pojia/pojia-20260916T122757Z.sql.gz.enc`完整性OK；1060跟踪文件清单全部校验通过。
- 客户SQL探针5项通过；592条SQL PREPARE成功（仅语法/schema，不执行写），72条动态插值不计入；新增子阶段读取和worker-scoped核实查询另用候选真实模块对生产只读执行成功。
- 无数据库迁移。
- 12:36:58 UTC通过正式连接池/admin operations服务暂停接单，独立新连接确认活动run/非终态订单/待收尾run全部0；原付款开关true未变。
- 旧Browser PID67720 SIGTERM正常STOPPED。主工作区快进同一提交后切服务器release并重启web/worker。
- 12:38:31 UTC独立SSH：Web PID2253812、Worker PID2253822，两个cwd均`/opt/pojia/releases/20260916-d240-b31a88a/v1`；live/ready与后台登录200。
- 本机新Browser PID99137于12:39:21 UTC启动，supervisor PID98863；生产心跳12:40:37.673Z。使用原lane1/PAY模式，未创建额外业务worker。
- 12:40:21 UTC正式服务恢复接单，写admin_setting_events；12:40:41 UTC新连接确认接单/派工/付款true，活动run0、非终态0。
- 历史成功订单状态API：SUCCESS/stage9。没有为发布触发新充值。

## 文件与公网核验

公网`https://plus.vibebridge.top/assets/customer.js?v=39`与服务器实际HTTP/文件/本机发布源码同SHA256：

```
fdf489072e8dda6cf0c8f1b5aa26300beee2ec71cfc99b68bf461652cb1c14d6  customer.js
7e91eb7708fcfa9584efd7b327e8a897bd43ff7e2375550172be729e16cb5570  browser-execution-repository.js
9c1b720e6b83d7a8753b6c9386c0c2164c85c92cac7aef25266ad1585dcef65d  session-identity-probe.js
```

客户HTML引用JS/CSS v39。switch脚本打印的`worker cwd=/`是重启立即查询时的短暂值，已用独立SSH核对上述真实新目录；脚本写死的admin.js?v=23不是本次资源版本，实际HTML为admin.js?v=49。

## 伴随基线差异

发布包含此前主线D-217资格规则：正式SQL对比旧版2张（5371/1657）→新版1张（5371）。1657同步余额17.83，funded_amount50、计入账本48，因此保守余额2；未补写余额或放宽资格。补余额/自动开卡false，满足原规则上线前提。差异已在切换前告知，生产事实表已更新。

## 验证边界与回滚

本次证明部署版本一致、服务/心跳正常、生产只读查询正常和接单恢复。不证明新版本真实付款、重试成功率或客户感知节省秒数；下一笔真实客户单仍需核对。

旧服务端release：`20260913-orderno-6dcb458`；本机旧运行源码留存提交f836977。**不能在存在“订单SUCCESS、Browser收尾未完”时直接切旧版**：先由新版收完/保留兼容收尾器。空闲窗口下暂停接单、核对活动/待收尾run后才执行回滚并同步本机版本；不得清订单或重新付款。

原始输出：prepare.txt、switch.txt、customer-sql.txt、sql-prepare.txt、state-check.txt。完整测试证据在相邻`../d240-validation/`。
