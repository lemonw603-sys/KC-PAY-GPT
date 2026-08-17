# 安全审查现场记录：2026-08-17

## 路由

- 模式：defensive-review
- 主域：Web/API
- 辅助域：Node.js 配置、依赖与 MySQL 接入边界
- 目标：在真实 MySQL 与真实供应商接入前确认重大可利用漏洞和接入阻塞项

## 只读检查

- 阅读项目索引、`CLAUDE.md`、路线图、v1 规格、路由、认证、限流、服务、仓库、worker、Provider、前端、迁移、配置和 legacy 启动边界。
- 搜索动态 SQL、HTML 注入点、外部命令、日志、Cookie、API Key、Session、卡资料、CORS、CSP 和代理配置。
- 扫描当前 Git 与历史提交中的常见真实密钥/私钥形态；仅输出命中文件名，不输出匹配内容。命中均位于脱敏测试 fixture。
- 确认 `v1/.env.admin.local` 被忽略且权限为 `0600`；未读取文件内容。

## 运行验证

- `npm --prefix v1 test`：69 通过，9 个 MySQL 用例跳过，0 失败。
- 根项目 `npm test`：legacy 8/8 通过；v1 同上。
- `npm --prefix v1 audit --omit=dev --json`：0 个已知漏洞。
- `npm --prefix v1 outdated --json`：无输出项。
- 本地 fixture HTTP：未认证后台 `401`；后台页面 `302 /admin/login`；篡改 Cookie `401`；编码路径 `404`；错误方法 `404`；非法 JSON `400`；登录限流达到阈值后 `429`。
- Cookie fixture：`HttpOnly`、`Secure`、`SameSite=Strict`、`Path=/` 均存在。
- 本机 Chrome 恶意 HTML fixture：订单列表和详情均未执行脚本，未创建攻击用 `img` 节点，恶意值只作为文本出现。

## 关键证据链

1. 外部错误消息：`http-client.extractBusinessError` → ProviderError.message → `task-runner.normalizeTaskError` → `tasks.last_error_message`。
2. 直充凭据副本：`orders.recharge_card_key` → `order_events.metadata_json.cardKey`；轮询时又进入 `provider_calls.request_key`。
3. 生产接入缺口：连接池只消费单一 URL；迁移与运行未区分账号；无 v1 生产部署文件。
4. 限流边界：单进程 Map + `req.ip`；代理仅由布尔值切换为信任一跳。

## 未执行

- 未连接真实 MySQL 或测试 MySQL。
- 未调用卡台或直充 API。
- 未读取剪贴板、真实 API Key、管理密码、Session 或卡资料。
- 未修改生产代码、数据库或运行开关。

## 获批后的修复记录

- 在任务失败持久化边界增加敏感文本清洗与外部错误代码约束。
- 移除事件和 Provider 调用审计中的 `card_key` 明文副本，订单表保留唯一业务副本。
- 新增四个回归测试；完整结果为 82 个测试、73 通过、9 个 MySQL 用例跳过、0 失败。
- 生产依赖审计继续为 0 个已知漏洞。
- 仍未连接 MySQL、供应商或读取任何真实密钥。

## 生产 MySQL 合同实现

- Web、worker、CDK 工具改为统一消费受校验的运行数据库配置。
- 生产远程 MySQL 未启用证书校验时会在连接前失败关闭。
- 迁移脚本改用独立迁移 URL；生产环境显式复用同一用户名会被拒绝。
- 增加公共 CA/私有 CA 两种 TLS 配置，并始终保持 `rejectUnauthorized=true` 与 `verifyIdentity=true`；远程生产连接禁止直接使用 IP。
- 依赖源码核对确认 `mysql2` 默认不会因 `rejectUnauthorized=true` 自动开启主机名校验；该坑点已沉淀到 `analysis/experience-candidates/`。
- 新增四项配置测试；完整结果为 86 个测试、77 通过、9 个 MySQL 用例跳过、0 失败。
- 尚未验证实际防火墙、MySQL GRANT、TLS 握手或备份恢复，F-02 仍等待服务器侧证据。
