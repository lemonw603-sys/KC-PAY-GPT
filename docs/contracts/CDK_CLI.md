# v1 CDK 批次工具

- 日期：2026-08-17
- 范围：Plus CDK 批量生成和文件导入
- 存储：MySQL 只保存 SHA-256，不保存 CDK 明文

## 生成

```bash
cd v1
npm run cdk -- generate \
  --count 100 \
  --batch BATCH_20260817_A \
  --output /absolute/private/path/cdks.txt
```

- 数量范围 `1..10000`。
- 格式为 `PJ-` + 20 位随机字符，字符表排除 `0/O/1/I/L`。
- `--output` 必须是尚不存在的文件；工具拒绝覆盖。
- 明文文件权限为 `0600`，每行一枚 CDK。
- 数据库写入失败时，工具会删除本次新建的输出文件。
- 任一新生成码与历史哈希冲突时，整批数据库写入回滚，不会交付夹杂不可用码的文件。
- 标准输出只有批次和数量摘要，不打印 CDK 内容。

## 导入

```bash
cd v1
npm run cdk -- import \
  --input /absolute/private/path/existing-cdks.txt \
  --batch IMPORT_20260817_A
```

运行前由部署密钥存储注入 `NODE_ENV`、`DATABASE_URL` 和 TLS 字段，不要把带密码的 URL 写进 shell 历史。生产远程数据库缺少 `DATABASE_TLS=true` 时，工具会在连接前失败关闭。

- UTF-8 文本，每行一枚 CDK；忽略空行和首个 BOM。
- 最多 10000 个非空行，文件最大 2 MiB。
- 允许字母、数字、下划线和连字符，长度 `8..128`。
- 区分大小写；文件内重复和数据库已存在会分开计数。
- 导入使用数据库唯一键最终防重，重复运行不会生成第二枚可用记录。

## 返回摘要

```json
{
  "command": "import",
  "batchNo": "IMPORT_20260817_A",
  "inputCount": 100,
  "duplicateInputCount": 2,
  "insertedCount": 95,
  "duplicateExistingCount": 3
}
```

批次号可显式指定；省略时生成带毫秒时间和随机后缀的批次号。
