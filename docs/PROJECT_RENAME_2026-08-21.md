# 项目改名记录：AI充值业务

## 已执行

- 本地项目目录从 `/Users/lemon/code/破甲` 改为 `/Users/lemon/code/AI充值业务`。
- 代码、文档、systemd 描述、Bark 分组和运维说明中的中文品牌名已统一为 `AI充值业务`。
- 在新目录执行根项目完整测试，结果保持通过。

## 有意保留的技术标识

以下不是本地项目品牌，而是已部署环境的兼容标识，本次没有重命名：

- `pojia` Linux 用户、`/etc/pojia/`、`/opt/pojia/`、`/var/lib/pojia/`
- `pojia-*` systemd 单元、运维命令、备份文件名和 MySQL 数据库名
- npm package name `kc-gpt-pay` 与 v1 package name `pojia-v1`
- 客户端 Cookie、sessionStorage key、内部幂等键前缀和历史发布路径

这些标识如果直接改名，会影响现有生产服务、备份恢复、systemd、Cookie 兼容和运维脚本；保留它们不会影响本地目录改名。

## 影响排查

- 仓库内没有发现指向旧本地绝对路径的脚本或配置。
- Node/Python 脚本使用自身文件目录解析资源，不依赖旧目录名。
- legacy 管理密钥有一条基于 `process.cwd()` 的派生路径；改名后该 legacy 派生值会变化。v1 生产路径使用显式 `ADMIN_SESSION_SECRET_BASE64`，不受影响。
- 部署脚本使用 `/opt/pojia/current/v1`，这是远程部署路径，不是本地目录，因此保持不变。
