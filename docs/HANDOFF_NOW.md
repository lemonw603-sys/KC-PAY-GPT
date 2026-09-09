# 接班一屏（HANDOFF_NOW）

> 规则：**每次窗口收尾覆盖重写本文**（不追加）；过程流水在 `HANDOFF_LOG.md`（只追加）。新窗口按 `AGENTS.md` 顺序：先读本文，再读 `PROJECT_MAP.md`、`CURRENT_STATE.md`。本文只写"现在"和"下一步"，不写历史。

**上次收尾**：2026-09-09 晚（UTC+8），窗口 `68c73cc7`，模型 Fable 5.1。

## 现在的状态

- **等真实订单**。系统待命态干净：付款开关 **false**；非终态订单 0；账号槽 active_runs=0；可分配手动卡 1 张（`7402`，$49——够 Plus、**不够 20X**，20X 需 ≥150）。
- 本机依赖已守护：mihomo（launchd `com.pojia.mihomo-ph`，出口锁菲律宾 38.60.246.34）、SSH 隧道 13306（launchd `com.pojia.ssh-tunnel-13306`）；比特浏览器由 `ready-check.sh` 自动拉起。无常驻 worker（来单再拉）。
- 线上 release `20260909-askform-cc3bba0`（后台对话框 + 「已在账号里取消续费」+ 开卡补钱关闭按钮），回滚点 `20260908-cancelfix-bad14cc`。

## 下一可执行项

1. **真单来了**：按 `RUNBOOK.md`「来单」一节执行（用户：充卡→传 Excel→提交→给单号；执行者：`ready-check.sh pay` → `go-live.sh --arm` → 盯到终态 → `stop-live.sh`）。20X 第二阶段自动停在「Confirm plan changes」小窗（用已绑卡、不填卡），**用户核对卡尾号后手动 Pay now**，再后台「确认 20X 已升级」。
2. 真单跑完：把 `UNVERIFIED_LEDGER.md`「付款后半段」按实际证据改行；重写本文。
3. （已做）`project-kickoff` 技能已建在 `~/.claude/skills/project-kickoff/`（本项目落盘体系的最简模板：7 本 + CLAUDE.md 写死开头/收尾两句；无脚本无 hook，用户 09-09 定的）。新项目说"新项目开工，叫 xxx"即用。

## 已定不做 / 已定保留

- 不做：Plus→20X 升级自动化（D-138，运营手动升）；常驻 worker；手动卡付款后交易录入入口；住宅 IP（现无）；"抓取付款后新 session 存回订单"（A2，真单后视情况）。
- 保留：付款后 session 恢复阶梯第 2 级（清页面登录 cookie + 刷新，只在 token 已失效时跑一次）；第 3 级"重注入旧 session"已删（`96ac467`）。

## 已验证 / 未验证的边界（详见 UNVERIFIED_LEDGER）

- 已验证：付款前全自动链路 rehearsal 2 次（零税 ₱982.14，停点击前，零扣款）；付款后同一浏览器登录态存活（不重登，D-136）；D-137；防重复扣款状态机；「已在账号里取消续费」生产实用。
- **从没跑过**：全自动真实付款那一下 + 付款后半段 + 20X 闭环——下一笔真单即验证。

## 暂停 / 恢复记录（有则填）

```text
暂停原因：无（等单）
允许继续：来单后按 RUNBOOK 执行；文档改造可继续
禁止操作：未经当次确认不真点付款；付款结果不明不重付不换卡
恢复后的第一步：跑 browser-mvp/scripts/ready-check.sh
```
