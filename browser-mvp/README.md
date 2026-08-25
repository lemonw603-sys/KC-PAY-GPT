# Browser Recharge MVP

这是 Browser 线的隔离控制能力 PoC，当前正在向 F0 核心真实付款 MVP 演进；尚未启用真实付款写入。

当前 M3 提供四个可替换 Port、合成 job fixture、运行时合同校验、本地文件 dispatch/lease PoC、只读 Playwright BrowserContext 检查和 WAL/reconcile-only 恢复。它不连接共享订单、MySQL、真实 Session、Checkout、卡片、Provider 或付款接口；`LOCAL_MOCK` manifest 也明确禁止任何写入动作。

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
- `LocalPlaywrightRuntimeAdapter`：M2 的临时隔离 BrowserContext；只读打开页面，不提供 submit/click/payment 写操作。
- `BrowserExecutionService`：导航、页面签名检查、租约/人工冻结检查和脱敏证据事件；漂移、超时、租约丢失统一 fail-closed。
- `AppendOnlyWal` / `WalEvidenceSink`：单写者事件追加、序列/哈希链校验和重启验证；截断或篡改直接阻断恢复。
- `reconcileIncompleteJobs`：只把无终态证据的 RUNNING job 移入 `RECONCILE_ONLY`，不自动重放 Browser 动作。
- `SessionProviderPort`：未来上号器的即时取号边界；当前只接受 opaque `sessionRef`，实现默认 fail-closed，不保存或记录 Session 原文。

## F0 当前新增

- `GoogleChromeControlRuntimeAdapter`：使用系统 Google Chrome 的独立 persistent Profile；Profile 路径按 opaque `profileRef` 派生，不复用用户默认 Profile。
- `CookieSessionBootstrapAdapter`：从受控 source 读取 ChatGPT Session Cookie，在 adapter 私有边界内注入 BrowserContext，只向事件写入 digest 和 Cookie 数量。
- `BrowserExecutionService`：当 job 带 `sessionRef` 时必须提供 Session Bootstrap adapter；身份核对和真实 Checkout 付款仍未接线。
- `CHROME_CONTROL`/`CHECKOUT_OBSERVE` manifest：默认 `allowWrites=false`，任何写入 manifest 仍 fail-closed。

这批能力只完成真实付款前的纵向前置切片，不代表真实 Session、Checkout 或付款已验证。

所有跨边界对象使用引用和 digest，不接受卡号、CVV、Session 原文、Checkout authority 或明文密钥。
