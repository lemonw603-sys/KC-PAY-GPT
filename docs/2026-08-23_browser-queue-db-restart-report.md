# Browser 队列积压 + MySQL 容器重启恢复（2026-08-23）

## 运行

- 先预先创建 120 个 Browser dispatch job，准备阶段不启动 Worker。
- 重启隔离 `pojia-stage1-mysql` 容器。
- 重启后重新发现动态 host port，等待 `mysqladmin ping` 就绪，再以新连接池启动 6 个恢复 Worker。

## 结果

```text
pendingBefore=120
claimed=120
heartbeatOk=120
residual=0
errors=[]
```

没有 Checkout 或付款动作。旧连接没有被复用，恢复 Worker 使用重启后的新连接池排空全部积压。

## Harness 发现

第一次尝试直接沿用重启前的 host-mapped port，因容器重启后端口发生变化而失败；这不是控制面结论。Harness 已改为重启后动态读取端口并等待数据库 ready，第二次复验通过。

## 边界

这是单次隔离容器重启 + 120 job 的恢复证据，不等价主从切换、真实网络分区、生产编排或 24 小时稳定性。
