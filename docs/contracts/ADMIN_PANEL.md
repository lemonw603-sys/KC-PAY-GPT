# v1 内部运营后台合同

## 范围

- 页面入口：`GET /admin`。
- 登录入口：`GET /admin/login`。
- 第一版提供总览、订单、异常、卡片库存、任务、事件、交易和退款观察数据，以及受控的 CDK、补卡、接单和单订单充值写操作。
- 后台允许管理员生成 Plus CDK，查看批次状态，下载新版批次，并作废尚未兑换的 CDK。单个 CDK 记录只保存 SHA-256 哈希；新批次为幂等恢复额外保存 AES-256-GCM 加密的明文集合。
- 人工补卡会产生真实费用；后台必须显示卡段实时规则、预计总扣款和可承担数量，超过 10 张出现额外风险确认。
- 开始接单同时允许已创建订单完成非付费准备；停止接单不取消已有订单。真实充值必须在订单详情逐单二次确认，每次只签发一个短时一次性 Permit。
- 普通页面只读本地 MySQL；手动同步只写入受控的 `SYNC_CARD_TRANSACTIONS` 任务，由 worker 调用卡台交易 GET 接口。

卡段由服务端定时同步卡台 `/card-types` 快照，浏览器不接受也不上传 Provider 卡段 ID。普通页面读取本地 MySQL 快照，创建补卡任务时服务端再校验快照时效。

## 登录保护

- 未配置 `ADMIN_PASSWORD_HASH` 与 `ADMIN_SESSION_SECRET_BASE64` 时，后台保持关闭。
- 两项必须同时配置；会话密钥必须是 32 字节 Base64。
- 密码使用 scrypt 派生值保存，不保存明文密码。
- 登录成功后使用 12 小时签名 Cookie；Cookie 为 `HttpOnly`、`SameSite=Strict`，生产环境额外设置 `Secure`。
- 登录接口按来源限流；错误密码不建立 Cookie。
- 所有已认证后台写接口必须通过同源 `Origin` 校验和独立写操作限流。

生成密码派生值：

```bash
read -s ADMIN_PASSWORD
export ADMIN_PASSWORD
npm --prefix v1 run admin:hash-password
unset ADMIN_PASSWORD
```

生成会话密钥：

```bash
openssl rand -base64 32
```

输出值应只保存到部署环境的秘密配置，不提交 Git。

本地配置也可以将密码复制到剪贴板后执行：

```bash
pbpaste | npm --prefix v1 run admin:configure-local
```

命令只写入被 Git 忽略的 `v1/.env.admin.local`，文件权限为 `0600`；若文件已存在会拒绝覆盖。

## 后台 API

- `GET /api/v1/admin/session`
- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/orders?page=1&pageSize=20&status=&q=`
- `GET /api/v1/admin/orders/:publicNo`
- `GET /api/v1/admin/alerts?limit=50`（只读，返回未处理内部提醒）
- `POST /api/v1/admin/orders/:publicNo/sync-transactions`（只读同步任务，需已绑定卡片）
- `POST /api/v1/admin/cdks/generate` （管理员写入，必须带 `Idempotency-Key`；当前 `planType` 仅接受 `plus`）
- `GET /api/v1/admin/cdks/batches`
- `GET /api/v1/admin/cdks/:batchNo/download`
- `POST /api/v1/admin/cdks/:batchNo/revoke` （管理员写入；仅作废该批次仍为 `AVAILABLE` 的 CDK）
- `GET /api/v1/admin/card-stock`
- `POST /api/v1/admin/card-stock/threshold`
- `POST /api/v1/admin/card-stock/jobs`（产生真实开卡费用）
- `POST /api/v1/admin/operations/order-acceptance`（仅接受精确确认词“开始接单”或“停止接单”）
- `POST /api/v1/admin/orders/:publicNo/recharge-permit`（`arm` 或 `revoke`；真实充值只允许一个未尝试订单）

全部响应设置 `Cache-Control: no-store`，未登录统一返回 `401 admin_auth_required`。
手动同步若已有运行中任务则不重复入队；成功入队返回 `202`。

## 数据边界

- 自有运营后台的订单和卡片列表显示完整卡号，不做后四位掩码。
- 详情可显示卡台卡片 ID、外部订单号、开卡金额、最低所需卡余额、上游返回的实际支付金额/币种、失败原因、任务、事件和调用结果。
- API 只向已认证的自有后台返回解密后的完整卡号。订单详情会在服务端读取并验证 Session 密文，但只返回是否有效及过期时间；不返回 Session、Access Token、Session Token、CVV、API Key 或直充 `card_key`。
- 退款提醒的文案固定使用“疑似退款，需要核对”；提醒会关联客户邮箱、本地订单号、直充订单号和交易 ID，但不代表官方已经确认退款。
