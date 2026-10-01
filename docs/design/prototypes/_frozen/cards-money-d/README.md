# 定稿快照：工作台「卡与钱」丁「一台一行」（2026-10-01，D-414 补记五）

三份 CSS 是 Lemon 挑定丁那一刻（提交 `4764ac7b`）演示页用的 `v1/public/admin/assets/` 原样复制；
丁自己的样式（`.cm-*`）在 `../../d414-cards-money-demo-v2.html` 的 `<style>` 里，和这三份一起构成定稿。
**原型必须 link 这里的快照，不能 link 实时的实现样式**：实现已把 `.cm-*` 搬进 `workbench.css`，
link 实时样式会让参照物跟着被测物一起变，比对永远通过（规矩见 `../opsbar-v5/README.md`）。

契约：`docs/design/parity/workbench-cards-money.json`（比演示页 `#scene=3&design=d` 与真页面同一份数据）。

## 什么时候更新快照

只有重新定稿时：出新原型 → Lemon 挑定 → 才重新冻。日常改实现不更新——实现偏离快照正是要被抓出来的东西。
