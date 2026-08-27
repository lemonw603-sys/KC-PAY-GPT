# Browser 数据库短暂不可用组合报告（2026-08-22）

## 场景

固定脚本 `v1/test-support/browser-db-outage-soak.js` 启动 30 秒 Browser MySQL soak，在第 5 秒 pause 隔离 MySQL 容器，保持 2 秒后 unpause；期间继续注入和 claim 合成 dispatch job。

## 结果

- child exit：0；未出现未处理数据库错误；
- created/claimed：1430/1430；
- missing/duplicate：0/0；
- heartbeat：1430；
- claim 延迟均值/最大：3.44ms / 27ms；
- heartbeat 延迟均值/最大：1.53ms / 105ms；
- 清理残留 dispatch/attempt/order/cdk：0/0/0/0；
- 无页面、Session、卡片或付款动作。

## 边界

pause/unpause 是隔离 Docker 容器级短暂阻塞，不等价于生产网络分区、连接池耗尽或主从切换；本轮没有强制杀掉所有已有 socket，也没有模拟长时间不可用。该结果只能作为短暂阻塞窄证据。
