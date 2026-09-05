# 卡台来源与对账收敛｜D5 生产部署记录

> 部署时间：2026-09-06（Asia/Shanghai）
> 状态：生产部署与只读验证完成；D6 真实验收尚未开始。
> 边界：未导入备用卡、未启动 Browser Worker、未开启 Browser 付款、未开卡、未补余额、未付款。

## 1. 精确发布物

- 源码 commit：`8012da8bf624a3b55390a03f8e89a83e9e0ba23c`。
- release：`/opt/pojia/releases/20260906-card-sources-8012da8`。
- 原回滚点：`/opt/pojia/releases/20260905-browser-zero-tax-04e08e6`。
- 归档在全新空目录解压；安装依赖前后均通过全量 manifest：`release_manifest=OK tracked_files=825`。
- `source.tar.gz` 校验通过；manifest 文件 SHA-256：`acd5c4f0bce658831137eca55d7e73600e72654318f2c5f65942bf97ecd6e501`。
- 已禁止继续使用“复制 current 后局部覆盖”的发布方式。

## 2. 维护窗口、备份与迁移

- 停止 Web、API Worker、只读同步、补余额/对账、Bark 以及旧自动开卡进程后进入维护窗口。
- 新备份：`/var/backups/pojia/pojia-20260905T230819Z.sql.gz.enc`；完整性 `OK`。
- 隔离恢复演练：`restore_test=OK`，恢复 `54` 张表。
- 迁移前：最高 migration `047_browser_billing_address_assignments`；RUNNING task、ACTIVE/UNKNOWN recharge/funding attempt、活动 Browser run/dispatch、OPEN/ASSIGNED reconciliation case 均为 `0`。
- migration 048 首次应用成功；第二次执行返回 `already applied`，幂等复跑通过。

## 3. 切换后权威状态

- `/opt/pojia/current` 已原子指向新 release。
- Web、API Worker、卡片只读同步 timer、补余额 timer、补余额对账 timer、Bark 均已恢复。
- `pojia-card-stock-runner.timer/service` 保持 `inactive/disabled`；数据库 `card_auto_replenishment_enabled=false`。
- `pojia-browser-worker.service` 保持 `inactive/disabled`；`browser_payment_writes_enabled=false`，heartbeat 为空。
- 本机与公网 `plus`/`ops` 的 live/ready 均正常。
- `pojia-ops check`、最新备份完整性与 release manifest 均通过。

## 4. migration 048 生产验证

- 5 张目标表存在；`orders.frozen_card_provider_account_id` 存在；Browser 付款核实 5 个字段存在。
- 历史订单未冻结来源数量为 `0`。
- HNSKJ：支持 API 与 Browser、API 同步、自动开卡及补余额。
- `备用卡台 A`：仅支持 Browser，不支持 API、自动开卡或补余额。
- Browser 当前来源为 HNSKJ，版本 `1`。
- 手工导入批次为 `0`：本轮没有把备用卡文件导入生产。
- API 路线仍 `accepts_new_orders=0`；Browser 路线仍 `accepts_new_orders=1`，未因部署漂移。

## 5. 安全与稳定性复核

- 部署后 RUNNING task、ACTIVE/UNKNOWN recharge/funding attempt、活动 Browser run/dispatch、OPEN/ASSIGNED reconciliation case 均为 `0`。
- 历史 stock jobs 仍为 `969`，活动为 `0`，最新创建时间仍为 `2026-09-05T22:32:12.365Z`；跨多个旧周期没有新增。
- Web、Worker、读同步、补余额、补余额对账和 Bark 在切换后没有 warning/error。
- 卡目录只读同步被 HNSKJ 当前 `HTTP 403 maintenance` 响应拒绝；重试仍为相同结果。这是现场存在的上游可用性约束，不是 migration/release 校验失败；系统未自动切换卡源，也未产生资金动作。

## 6. 准确边界与下一步

D5 只证明新模型、迁移、后台/API 代码和生产运行基线已上线，不能据此宣称 Browser 已可付款或备用卡已可用。当前新订单仍会冻结为 Browser 路线，但远程 Browser Worker 没有运行。下一阶段 D6 必须先做无资金的生产页面/API验收，再在明确选择卡源、导入样本和付款授权后进行真实订单验收。
