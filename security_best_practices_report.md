# 安全最佳实践审查

## 执行摘要

AI充值业务 v1 的 Web 安全基线整体可用：严格 CSP、后台域名隔离、`HttpOnly + Secure + SameSite=Strict` 会话、同源写入校验、敏感操作二次验证、请求边界 Zod 校验、参数化 SQL、密文落库和递归脱敏均已存在。`npm audit --omit=dev` 报告 0 个已知生产依赖漏洞。

审查找到一个项目外的高危凭证残留，需要账号所有者操作；代码内发现的限流内存增长问题已修复。

## Critical

### SEC-001：本机 shell 历史中残留完整登录凭证

- 位置：`/Users/lemon/.zsh_history:4562`（项目外；行号会随新历史变化）
- 证据：一条历史命令保存了完整认证对象，其中包含可重放的访问/会话令牌。本报告不复制任何凭证内容。
- 影响：能读取该用户 shell 历史的本机进程或人员，可能以该账号身份访问外部服务。
- 必须处理：在对应服务中注销所有会话/撤销令牌，然后从 shell 历史中删除该条记录并检查终端同步或备份。
- 未自动修复原因：注销外部账号和删除用户历史是破坏性/账号级操作，需用户明确执行。

## Medium

### SEC-002：限流客户状态可无界增长

- 位置：`v1/src/app/fixed-window-rate-limit.js:1`
- 影响：攻击者使用大量来源 IP 可使进程内存持续增长，最终影响 Web 可用性。
- 修复：增加最大客户状态数，达到上限时优先清理过期项，仍超限时淘汰最早项。
- 验证：新增旋转 IP 压力边界测试；本地与隔离 MySQL 全量套件通过。

## High（韧性，非应用漏洞）

### SEC-003：备份数据和恢复密钥同机

- 位置：生产服务器 `/var/backups/pojia` 与 `/etc/pojia/backup-key`
- 影响：整机丢失会同时丢失生产数据、备份与解密条件。
- 现有缓解：每日加密备份、SHA-256 校验、已完成无网络 MySQL 真实恢复演练。
- 必须处理：备份密文复制到异地，恢复密钥与备份分开托管。

## 已验证的防线

- Express 关闭 `x-powered-by`，使用 Helmet，JSON 上限 256 KiB，统一 404/错误回应不泄露堆栈（`v1/src/app/create-app.js:52`、`v1/src/app/create-app.js:333`）。
- Caddy 只代理到 `127.0.0.1:3100`，严格区分客户域名和后台域名，并设置 CSP、禁止嵌入、`nosniff` 和最小权限策略（`deploy/server/pojia.caddy:1`）。
- 后台登录和二次验证有独立限流；所有 Cookie 都不向 JavaScript 暴露（`v1/src/app/create-app.js:46`、`v1/src/security/admin-session.js:158`）。
- 客户 Session、卡号和卡资料加密落库；CVV 不通过后台 API 暴露；Provider 摘要和任务错误递归脱敏。
- 前端无远程脚本，不在 Web Storage 保存会话凭证；`innerHTML` 渲染路径对 API 文本使用 HTML 转义。
