# Browser Recharge MVP

这是 Browser 线的隔离控制能力 PoC，不是生产充值实现。

当前 M1 提供四个可替换 Port、合成 job fixture、运行时合同校验和本地文件 dispatch/lease PoC。它不连接共享订单、MySQL、真实 Session、Checkout、卡片、Provider 或付款接口；`LOCAL_MOCK` manifest 也明确禁止任何写入动作。

## 本地验证

```bash
npm test
npm run check
```

## 设计边界

- `BrowserExecutionPort`：执行一次 Browser job 的边界，未来接入共享 order/attempt/资金栅栏适配器。
- `DispatchStore`：durable dispatch、lease 和恢复的存储边界，M1 才实现内存/文件 PoC，生产实现预留 MySQL 适配器。
- `EvidenceSink`：WAL、脱敏事件和 artifact vault 的证据边界，M3 才实现。
- `RuntimeAdapter`：本地 BrowserContext 与未来真实 Playwright runtime 的边界；M0 仅允许 `LOCAL_MOCK`。
- `FileDispatchStore`：M1 的本地原子 JSON 持久化实现，覆盖幂等 enqueue、claim、lease heartbeat、过期恢复和完成状态；它不是生产资金账本。

所有跨边界对象使用引用和 digest，不接受卡号、CVV、Session 原文、Checkout authority 或明文密钥。
