# Browser / MockAddress 对齐核查｜2026-09-04

## 已现场核对

- 主线 `main` 当前包含固定版 MockAddress 数据源、HNSKJ JIT 接入、运营后台设置接口/页面及 migration 046/047。
- Browser 分支 `codex/browser` 与主线仍存在大量差异；主线未直接宣称其生产付款能力已合入。
- MockAddress 线上为纯前端静态数据，不存在订单时 API；主线采用固定本地 JSON，避免运行时第三方依赖。
- 地址策略已按用户最新决定修正：优先一张卡一个地址；地址池耗尽允许最低使用次数复用，不阻塞订单。
- 发现并修正 migration 047 的逻辑冲突：之前 `UNIQUE(state,row_index)` 会禁止地址复用，与“尽可能少复用但不强制”不一致；现改为普通索引，唯一约束只保留卡片/绑定引用。

## 测试

- MockAddress 定向测试：3/3 通过。
- v1 全量：528 total，482 pass，46 environment-skipped，0 fail。
- 未部署 migration 046/047，未启动生产 Browser Worker，未调用 Provider/卡台写接口，未付款。

## 当前阻断

1. 主线与 Browser 分支尚未完成选择性代码对齐；不能直接部署 Browser 付款。
2. 生产数据库尚未执行 046/047 migration 和后台只读验证。
3. Browser 真实付款仍未验收；账单地址只能作为候选资料，最终以 Checkout 税额和支付结果为准。

## 下一批执行

先在候选 worktree 完成 Browser 代码与主线的逐文件兼容检查，运行 Browser/v1 全量回归；确认 migration 可逆和后台只读后，才建立候选 release。资金动作（注销、开卡、付款）继续后置并单独确认。
