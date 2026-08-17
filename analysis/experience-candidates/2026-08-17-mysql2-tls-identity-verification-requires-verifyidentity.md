---
title: "mysql2 TLS identity verification requires verifyIdentity"
category: "tooling"
tags: ["mysql2", "tls", "nodejs"]
created: 2026-08-17
last_validated: "2026-08-17"
source_task: "破甲 v1 production MySQL security contract"
reusable_script: ""
status: "candidate"
---

# mysql2 TLS identity verification requires verifyIdentity

## Applies When

- Signal: Node.js 应用通过 `mysql2` 的 `ssl` 对象连接远程 MySQL，并要求同时验证证书链和数据库主机名。
- Required precondition: 连接 URL 使用 DNS 主机名，服务端证书的 SAN 覆盖该主机名。

## Does Not Apply When

- Counterexample: MySQL 与应用仅通过本机回环地址通信，且 3306 未暴露到其他网络。
- Invalidation signal: 后续 `mysql2` 版本把 `verifyIdentity` 默认值改为 `true`，并有对应发布说明和运行测试证明。

## Workflow

1. 检查当前安装版本的 `lib/base/connection.js` 和 `lib/connection_config.js`，确认 TLS 参数的实际语义。
2. 同时设置 `ssl.rejectUnauthorized=true` 与 `ssl.verifyIdentity=true`。
3. 生产远程数据库 URL 只接受 DNS 主机名；拒绝直接使用 IP，因为当前实现不会对 IP 进入主机名校验分支。
4. 用配置单元测试断言两个开关均进入 `mysql2` 连接参数，并在真实接入时用错误主机名证书做负向握手测试。

## Validation

- Environment/tool version: Node.js 24.14.0；`mysql2` 3.23.3。
- Command: `node --test v1/test/config.test.js`
- Expected decisive checkpoint: 远程生产配置生成的 `ssl` 同时包含 `rejectUnauthorized: true` 与 `verifyIdentity: true`；远程 IP 配置被拒绝。
- Sample or fixture SHA-256: 不适用；使用纯配置 fixture，不含真实地址或凭据。
- Clean/reset baseline: 未设置 TLS 的远程生产 URL 必须在发起网络连接前失败。
- Last validated: 2026-08-17

## Pitfalls and Rollback

- Failure mode: 只设置 `rejectUnauthorized=true` 会验证证书链，但 `mysql2` 默认不执行主机名身份校验。
- Return to stage: 若真实握手行为与源码不同，回到 Evidence 阶段抓取 TLS 错误和运行版本，再核对部署镜像内的实际依赖。

## Reusable Assets

- Script: 无；复用项目配置测试。
- Inputs: 脱敏的数据库 URL、TLS 布尔值和可选 CA fixture。
- Outputs: 受校验的 `mysql2` 连接参数或不含 URL 原文的配置错误。
- Dependencies: Node.js、`mysql2`、Zod。
- Safe defaults: 非回环生产连接缺少 TLS 或使用 IP 时失败关闭。
- Known limits: 仍需在实际服务器上验证证书 SAN、TLS 握手和错误证书负向路径。

## Promotion Notes

- 保持 `candidate`；完成真实 MySQL 正向与错误主机名证书负向握手后再考虑提升为稳定经验。
