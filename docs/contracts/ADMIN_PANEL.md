# v1 内部运营后台合同

## 范围

- 页面入口：`GET /admin`。
- 登录入口：`GET /admin/login`。
- 第一版只读展示总览、订单列表、异常筛选、订单详情、卡片绑定、任务、事件和退款观察状态。
- 第一版不提供开卡、充值、退款提取、状态修改或运行开关写操作。
- 页面和 API 均不调用供应商；数据只来自本地 MySQL。

## 登录保护

- 未配置 `ADMIN_PASSWORD_HASH` 与 `ADMIN_SESSION_SECRET_BASE64` 时，后台保持关闭。
- 两项必须同时配置；会话密钥必须是 32 字节 Base64。
- 密码使用 scrypt 派生值保存，不保存明文密码。
- 登录成功后使用 12 小时签名 Cookie；Cookie 为 `HttpOnly`、`SameSite=Strict`，生产环境额外设置 `Secure`。
- 登录接口按来源限流；错误密码不建立 Cookie。

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

## 只读 API

- `GET /api/v1/admin/session`
- `GET /api/v1/admin/overview`
- `GET /api/v1/admin/orders?page=1&pageSize=20&status=&q=`
- `GET /api/v1/admin/orders/:publicNo`

全部响应设置 `Cache-Control: no-store`，未登录统一返回 `401 admin_auth_required`。

## 数据边界

- 普通列表只显示订单查询码、账号标识、内部状态、卡号后四位、退款观察状态和时间。
- 详情可显示卡台卡片 ID、外部订单号、失败原因、任务、事件和调用结果。
- API 查询不读取也不返回 Session 密文、完整卡号、CVV、API Key 或直充 `card_key`。
