# 卡台来源与对账收敛｜D3 实现映射

> 基线：`CARD_SOURCE_AND_RECONCILIATION_FROZEN_SPEC.md`（D2-FINAL）  
> 状态：D3 实施中；本轮本地代码与自动测试已回归，生产证据仍未完成，不能写成已上线。

## 1. 数据与并发边界

| 决策 | migration 048 | 后端 | 前端 | 自动测试 | 生产验收 |
|---|---|---|---|---|---|
| NAME-01 | 内部枚举保留 `API/BROWSER` | 路线接口返回固定显示名 | 首页使用“API 充值 / 浏览器自动化充值” | 路线服务、静态 UI | 两处页面文案一致 |
| SRC-01/02 | HNSKJ 能力目录；API 路线固定 HNSKJ | 建单按执行器冻结来源 | 卡台管理只读展示 API 固定来源 | 建单冻结测试 | API 新单 frozen source=HNSKJ |
| SRC-03/04/05 | Browser 当前来源表 | Browser 来源列举/直接切换；健康仅告知 | Browser 当前卡台单选切换 | 切换服务测试 | 异常来源仍可保存且不回退 |
| SRC-06 | 无逐订单覆盖字段/入口 | 不提供逐单换源 API | 不提供逐单选择器 | 路由面静态断言 | 生产无逐单入口 |
| SRC-07/08 | `orders.frozen_card_provider_account_id` | 建单事务内冻结；Worker 只读冻结值 | 显示“只影响新订单” | 建单/分卡测试 | 切换前后订单来源不漂移 |
| SRC-09 | 来源切换审计与接管计数 | 预估、安全批量接管、事务后二次计数 | 切换时可选接管并显示预计/实际 | 安全条件和并发测试 | 活动订单不迁移；等待订单按选择迁移 |
| AR-05 | 来源行作为快照/分卡共同锁 | 快照与分卡先锁来源 | — | SQL/并发集成测试 | 并发无双分配/误释放 |

## 2. 完整快照

| 决策 | migration 048 | 后端 | 前端 | 自动测试 | 生产验收 |
|---|---|---|---|---|---|
| IMP-01/AR-01 | 批次显式绑定来源、adapter；文件 hash 按来源唯一 | 导入器参数化来源和 adapter | 上传前选择备用卡台 | 多来源/重放测试 | A/B 来源可独立导入 |
| IMP-02/AR-03 | 批次记录不可用/缺失/冲突；卡记录快照在场状态 | 结构错误整批阻止；业务不可用仍落库；缺失收敛 | 预览六类数量 | 快照生命周期测试 | 上传失败不改变有效库存 |
| AR-04 | PAN HMAC 冲突进入批次/行结果 | 全来源锁定检查，不创建第二可分配实体 | 只显示掩码冲突 | 跨来源 PAN 测试 | 同 PAN 不会双分配 |
| AR-06 | 不存商品阈值判断 | 导入只存余额/状态事实；分卡动态判定 | 不宣称低余额为数据错误 | 阈值变化测试 | 改阈值无需重导文件 |

## 3. 付款未知与对账

| 决策 | migration 048 | 后端 | 前端 | 自动测试 | 生产验收 |
|---|---|---|---|---|---|
| PAY-01/02 | attempt/run 现有资金栅栏继续复用 | UNKNOWN 只锁订单/账号/卡/run；同 attempt 不二次提交 | 展示局部核实状态 | Browser 并发/恢复测试 | 一单 UNKNOWN 时其他 Profile 可领取 |
| PAY-03 | `VERIFYING_PAYMENT` 作为可配置观察状态/证据层 | 有界只读核实；超时才建人工案例 | “付款结果核实中” | 状态机与超时测试 | 时长由真实单校准 |
| REC-01 | 复用真实 `reconciliation_cases` | 明确失败不报错；按路线选择证据 | “证据待同步 / 需要人工核对” | API、Browser 两类证据测试 | 无 API 不被判异常 |
| REC-02 | 无派生总览伪队列 | 总览人工数直接查询 OPEN/ASSIGNED 案例 | 总览点击进入同一队列 | 总览 SQL 测试 | 总览数=案例队列数 |

## 4. 交付顺序

```text
migration 048 → 卡源/快照服务 → 建单冻结 → 分卡约束 → 后台卡台管理
→ 对账收敛 → 针对性测试 → v1/Browser 全量 → 047 升级与空库重放
→ 文档事实源回填 → D4 部署前对齐
```

本轮边界：只制作本地候选；不部署、不导入生产卡、不启动付款、不开卡、不补余额。

## 5. 本轮回归证据（2026-09-06）

- `v1/npm test`：546 tests，499 pass，47 skip（均为未配置隔离数据库的套件），0 fail。
- 隔离 MySQL 多来源快照/建单冻结/切换/缺失收敛/跨来源 PAN 冲突：通过。
- 隔离 MySQL Browser execution mapping（付款一次性提交、未知状态进入 `VERIFYING_PAYMENT`、前置安全终止）：2/2 通过。
- `browser-mvp/npm test`：132 tests，128 pass，4 skip，0 fail。
- 本轮新增 `browser_runs.verification_*` 字段；`markPaymentUnknown` 不再立即创建人工案例；只有 `escalatePaymentVerification` 才创建 `BROWSER_PAYMENT_UNKNOWN` 案例。
- 新增 `browser-payment-verification-service.js` 协调器与 due 查询：UNKNOWN 继续只读观察，CONFIRMED/DECLINED 安全收敛，超时/冲突才升级人工案例；协调器尚未接入生产进程。
- 新增 `route-reconciliation.js` 并接入后台订单读取：Browser 不再把缺少 ZZSHU 外部单号当异常；手工卡源等待完整快照校准，未知执行器直接进入真实配置问题。
