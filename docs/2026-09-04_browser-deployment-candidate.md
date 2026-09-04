# Browser 部署候选准备记录｜2026-09-04

## 候选基线

- Git HEAD：`6944ffe602b70aeae38959f3e66e15733a5a235e`
- Git archive SHA-256：`3af95d8cc1df33888b93694189ef52c5d5f3e7648d734cedc2b01ef37ae30985`
- 工作区存在用户未提交的 `docs/DECISIONS.md`；部署候选只允许使用上述干净 HEAD，不得包含该文件改动。
- 待部署迁移：`046_browser_billing_address_settings.sql`、`047_browser_billing_address_assignments.sql`。

## 回归证据

- v1：`528 total / 482 passed / 46 skipped / 0 failed`
- Browser（主线当前套件）：`113 total / 109 passed / 4 skipped / 0 failed`
- `git diff --check` 通过。

## 生产前停止点

本记录仅完成候选打包基线和回归，不代表已部署：

- 未上传 release；
- 未执行 046/047 迁移；
- 未启动 Browser Worker；
- 未改变 Provider、卡台、资金或付款开关。

正式部署仍需维护窗口内完成备份、上传、迁移、只读健康核对和回滚演练；Browser Worker 继续保持 disabled，除非另行确认只读 canary。
