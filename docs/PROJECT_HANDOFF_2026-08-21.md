# AI充值业务阶段性完结与接手说明

> 归档日期：2026-08-21  
> 用途：当前阶段暂停开发、等待真实订单；后续 AI 或工程师必须先阅读本文，再继续修改代码或执行生产操作。

## 一、项目身份与当前基线

- 本地项目目录：`/Users/lemon/code/AI充值业务`
- 旧目录 `/Users/lemon/code/破甲` 已完成改名，不再存在。
- 当前分支：`codex/mvp-zero-cost-ops-20260819`
- 当前产品名称：**AI充值业务**
- v1 是当前生产路径；根目录 legacy 浏览器、Stripe、hCaptcha 和代理模块仅保留作隔离上游基线。
- 生产技术标识 `pojia`（Linux 用户、`/etc/pojia`、`/opt/pojia`、systemd 名称、数据库名、Cookie 和内部前缀）有意保留，不能因本地品牌改名而重命名。

## 二、项目目标与范围

项目是一个 ChatGPT Plus AI 充值业务系统，当前 v1 生产边界包括：

- 客户 CDK + Session 下单和状态查询；
- 卡片供应商库存、隔离、只读同步和余额/交易对账；
- 充值供应商订单状态查询、任务执行和资金风险栅栏；
- 后台订单、卡片、CDK、授权、对账和安全 CSV 能力；
- Bark 手机异常通知；
- MySQL 持久化、备份、恢复和可审计事件。

明确不属于当前生产路径：legacy 浏览器自动化、Stripe、本地 hCaptcha、旧代理链。

## 三、已经完成的工作

### 3.1 v1 基础与隔离

- 根 `npm start` 指向 v1；legacy 启动有显式二次解锁。
- Web、Worker、迁移和定时任务使用独立入口。
- Web/Worker/Provider 权限边界和运行开关已建立。
- Session 加密、CDK HMAC、恢复密钥、后台会话和敏感字段脱敏已落地。

### 3.2 Provider 与工作流

- `HnskjCardProvider` 和 `ZzshuRechargeProvider` 已实现。
- 只读响应 Schema、错误分类、超时/5xx/未知状态处理已实现。
- 任务租约、重试、dead-letter、Worker 心跳和运行开关已实现。
- 开卡、卡片就绪、充值提交、状态轮询和取消续费流程已接入本地数据层。
- `SUBMIT_UNKNOWN`、资金 fence、一次性授权和不自动重复提交规则已实现。

### 3.3 Foundation v2 运营层

- 供应商账户、产品、不可变履约路线已建立。
- 卡片供应商账户级唯一性、批次隔离、两次快照校验和分层同步已建立。
- 充值授权、资金风险尝试、余额历史、CDK 交付和对账案例已建立。
- 后台批量授权、异常筛选、只读详情、安全 CSV、补发/取消边界已完成。
- 生产备份、恢复演练、迁移重放和部署验收基线已形成。

### 3.4 Bark 通知

- Telegram 已明确不采用，通知统一使用 Bark。
- Bark 采用独立通知进程，不加载供应商密钥，不调用资金 Provider。
- 支持 JSON `POST /push`、Device Key 不进 URL、脱敏、去重、退避重试、死信和人工恢复。
- `RESOLVED → OPEN` 的同类告警会根据 `source_updated_at` 重新推送。
- 已从 `/Users/lemon/.claude/bark-notify-url` 找到既有 Bark 配置，并成功发送一条非资金测试通知，Bark 返回 `code=200`。

### 3.5 只读上线体检与审查

- `v1/scripts/preflight-readiness.js` 只查询 MySQL，检查租约、UNKNOWN、授权、资金风险、活动开卡任务、对账、Bark 死信、Worker 心跳和迁移版本。
- Provider 只读脚本会拒绝任一大小写/空白规范化后为 true 的 Provider 写开关。
- 独立对抗式审查已完成；报告见 `docs/ADVERSARIAL_AUDIT_2026-08-21.md`。
- 审查发现的 3 个 P1（告警重开不推送、写开关绕过、未来迁移误报）均已修复。
- 阶段性完结后的二次审查又补强了旧告警表迁移、辅助脚本写开关规范化、活动开卡任务体检和 Bark 重试 SQL；详见 `docs/ADVERSARIAL_AUDIT_2026-08-21.md`。

### 3.6 文件夹改名与影响排查

- `/Users/lemon/code/破甲` 已改为 `/Users/lemon/code/AI充值业务`。
- 仓库及常用配置中没有旧本地绝对路径引用。
- Node/Python 脚本使用自身目录解析资源，不依赖旧目录名。
- legacy 有一条基于 `process.cwd()` 派生管理密钥的逻辑；该影响仅限 legacy，v1 使用显式后台 Session Secret，不受影响。
- 详细记录见 `docs/PROJECT_RENAME_2026-08-21.md`。

## 四、数据库与迁移基线

- 最新迁移：`023_bark_notifications.sql`。
- 023 新增 `alert_notifications`，并为旧 `operator_alerts` 安全补充 `updated_at`。
- 已在临时 MySQL 8.4.11 中完成迁移 `001–023` 首次执行和重放。
- 已在隔离 MySQL 中验证 Bark 通知并发领取和告警重新打开。
- 未连接生产数据库，未修改生产数据。

## 五、测试与证据

在新目录 `/Users/lemon/code/AI充值业务` 执行根项目完整测试：

```text
260 passed
21 skipped
0 failed
```

跳过项是未设置 `TEST_DATABASE_URL` 的其他 MySQL 集成套件；Bark 专项 MySQL 集成测试已用临时 MySQL 8.4.11 单独执行通过。

主要证据文件：

- `docs/IMPLEMENTATION_ACCEPTANCE.md`
- `docs/ROADMAP.md`
- `docs/ADVERSARIAL_AUDIT_2026-08-21.md`
- `docs/SMALL_BATCH_RUNBOOK.md`
- `docs/PROJECT_RENAME_2026-08-21.md`
- `progress.md`

## 六、接下来要做的工作

### P0：有生产访问条件后、仍不触碰资金

1. 在生产目标机执行迁移 `023`，先做备份并保留输出。
2. 安装/启用 `pojia-bark-notifications.service`。
3. 运行只读上线体检和 Provider 只读连通性检查。
4. 演练两个独立 Bark runner 的进程重启、`SENDING` 超时重领和 `DEAD` 恢复。
5. 用既有 Bark Device Key 发送一条普通内部告警并确认手机收到。

### P1：出现真实订单后

1. 单笔、并发 1、人工确认 Session/卡片/余额/授权状态。
2. 逐单验证开卡、卡绑定、充值提交、最终状态和交易证据。
3. 验证 Provider 相同幂等键重复调用行为。
4. 验证真实错误映射和 `SUBMIT_UNKNOWN` 对账路径。
5. 每单运行只读体检并保存资金前后证据。

### P2：3–5 单稳定后

- 继续并发 1，逐单人工核对；
- 记录成功率、耗时、Provider 调用次数、UNKNOWN 比例和资金差异；
- 通过门槛后再考虑 10–20 单小批量；
- 任何重复充值或无法解释差异立即停止新提交。

### 延后项目

- 更完整的可写设置页面；
- 退款人工确认和余额提取；
- Telegram（已放弃，改为 Bark）；
- 自动退款、自动余额提取、多供应商、Pro 套餐和多租户。

## 七、已经达成的共识

1. 品牌名称是 **AI充值业务**；本地目录必须使用 `/Users/lemon/code/AI充值业务`。
2. 通知使用 Bark，不做 Telegram。
3. 当前没有订单时，不执行开卡、充值、退款、余额提取或任何可能扣费的 Provider 写调用。
4. 这不是永久禁止资金调用；有真实订单并进入逐单验证时，可以在明确门禁、Permit、资金 fence 和人工核对下执行。
5. 允许执行不产生扣费的只读接口、健康检查、同步、状态查询和 Bark 通知。
6. 不确定是否会扣费的接口，先检查协议和代码路径，不直接发送。
7. 不改动 `pojia` 远程部署技术标识，避免破坏现有 systemd、备份、数据库和运维脚本。
8. 后续 AI 接手前必须先读本文、`docs/ROADMAP.md`、`docs/SMALL_BATCH_RUNBOOK.md` 和最新 `progress.md`。
9. 当前阶段目标是“可部署、可审计、等待订单”，不是继续无止境扩展功能。

## 八、后续 AI 接手规则

- 先运行 `pwd`、`git status`、`git log -5`，确认目录为 `/Users/lemon/code/AI充值业务`。
- 先读本文件和上面的证据文件，再提出改动。
- 修改前明确属于 P0/P1/P2 哪一项。
- 资金相关动作必须逐步、可回滚、有证据；不能把测试 fixture 当真实验收。
- 不要重新引入 Telegram，不要把 Device Key、Session、PAN、CVV、API Key 写入仓库。
- 不要因本地品牌改名而重命名 `pojia` 生产技术标识。

## 2026-08-21 后台体验与 CDK 审计补丁

本轮根据后台实际使用反馈完成：刷新反馈、待验证新卡说明与状态翻译、资金证据核对队列说明、CDK 生成/下载分离、作废批次视觉标记，以及逐码状态 CSV 审计接口。新批次的加密恢复副本在作废/兑换后保留，便于倒查；旧版本已经清空恢复副本的批次无法恢复明文，只能从原始下载文件补回。接口为敏感 POST，要求后台登录、同源和 step-up，不会把状态清单写入日志或普通导出。

## 2026-08-21 生产 P0 更新

- 当前发布：`/opt/pojia/releases/20260821-bark-prep-1`。
- 生产迁移已到 `023_bark_notifications`；重复执行验证通过。
- 新加密备份及无网络隔离恢复通过，恢复 30 张表；异地加密副本仍未完成。
- Bark 已在生产启用，普通实推、超时重领和 DEAD 恢复通过。
- HNSKJ/ZZSHU 严格只读检查通过；历史 HNSKJ 401 已解除。
- 最终只读体检无 blocker；`accept_new_orders=false`、`dispatch_new_recharges=false`。
- 卡库存付费执行 timer 保持停止；Worker 只追踪已有状态，没有可领取资金任务。
- 本轮未执行任何 Provider 写调用或资金动作。
