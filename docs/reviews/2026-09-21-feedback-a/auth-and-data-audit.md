# A后续核查：登录续期与两页数据

2026-09-21 UTC+8。D-333：用户已认可第三批交互，**尚未发布**。本轮只读分析，无应用修改、自动续期、保活、登录、验证码或资金请求。使用接口分析技能做公开资源静态取证；没有登录HAR，未生成或试跑新的认证客户端。上下文与文档技能用于记录验证边界。

**后续覆盖（12:14 UTC）**：用户已自行完成一次登录观察，响应声明约7天后到期、无刷新凭据，Network观察已关闭。详见[真实登录观察](login-observation.md)。以下“待一次登录”是本报告形成时的历史状态，不重复要求登录；跨时段有效性仍未验。

## 续期：找到了函数，但没有找到可直接采用的链路

来源为卡台公开主页列出的业务资源：[主页](https://www.highvcc.com/)、[主脚本](https://www.highvcc.com/js/app.f77d29e8.js)、[登录脚本](https://www.highvcc.com/js/signin.f9e1b478.js)。2026-09-21本轮使用无cookie/无Authorization的curl读取；没有猜测或调用API端点。

| 观察 | 范围/证据 | 能否作为实施依据 |
|---|---|---|
| 主脚本定义changeRefreshToken，并接受调用方传入的URL及刷新凭据 | app中函数名1次，refresh_token5次；没有具体刷新URL | 只能证明有通用函数，不能证明接口可用 |
| 登录页面传给setToken的字段为access_token、access_overtime | 数据来自accessToken/expireTime；signin未传refresh_token | 不能断言服务器一定不返回刷新凭据，须看真实响应 |
| 13个主页列出的非vendor业务JS中，没有其他changeRefreshToken引用，也没有匹配到/api/...refresh路径 | 主脚本外refresh_token/refreshToken均0；未查vendor内部或隐藏服务端代码 | 未找到实际接线；不是证明不存在续期服务 |
| 网页请求拦截器有2小时不活动判断；响应会更新网页内lastActiveTime | access_overtime在app出现4次；失效响应分支跳回登录 | 网页行为不等于服务端TTL，不能推断定时查询能续命 |
| 本项目provider只接受getAccessToken提供的Bearer | v1/src/providers/highvcc-card.js | 没有既有续期实现可直接启用 |

公开源码身份：app.f77d29e8.js SHA256 `c3646ef013f9ae448ad87d91b831bb2812eb99d2bd3a4fc0b285daaa75e6a584`；signin.f9e1b478.js SHA256 `8410ad56f8db41200f63ee598019d8edbbbcf00b88c2ac9c24a7d0eeee070cc9`。两文件字符数分别466436/79136（不是网络字节数）。其余扫描文件：404、card、finance、finance~home~subHome、home、noPermission、onlineService、personal、rebate、subAccount、subHome，路径来自主页prefetch，不是目录扫描。

**建议与下一验证点**：先观察一次用户正常登录的响应字段与过期元数据、网站登录后的自然只读请求，判断是否实际下发刷新凭据、是否自然续期。只输出字段存在性/时间，不将密码或完整token写进聊天/日志，不自行续期/退出其他会话。如果有可用链路，再单独做有界验证；没有则再权衡减少书签步骤的本机辅助入口。当前不增加常驻浏览器、额外插件或“每隔几分钟保活”。

## 两页数据：正式读服务返回值对齐

12:05:28.511 UTC在生产当前release中调用createAdminReadService({pool}).getOverview()、createCardStockService({pool}).status()，外层pool仅允许SELECT/WITH、getConnection直接拒绝，共25次读。未提供解密密钥，不输出卡凭据。不是第二套手写资格规则。

```text
workbench legacy-primary: stockAvailable2; Plus used6/剩2; 5X used0/剩0; 20X used0/剩0; spentToday0.000000
workbench backup-a: stockAvailable2; Plus used6/剩2; 5X used0/剩0; 20X used1/剩0; spentToday0.000000
cardPage legacy-primary: stockAvailable2; wallet38.730000; syncedAt2026-09-21T12:03:02.137Z
cardPage backup-a: stockAvailable2; wallet null; syncedAt null（此旧生产读服务不接历史钱包，实时值另查）
overview providerHealth: accountBalance38.730000; syncedAt2026-09-21T12:03:02.137Z
```

解释：两页库存口径来自同一providerCardStockSql；“用”是按产品有用卡账本记录的卡张数，不是成功充值单数或今日用卡。此刻即时分配口径HNSKJ0/highvcc2，与库存2/2不同是既有时效规则；不把这个差异当数据错误。本次只证明系统内部口径一致，highvcc卡台逐张新鲜值未验。

## 时间与费用：已知限制不能藏进“数据准确”

余额行资料更新时间沿第三批说明；HNSKJ工作台钱包读card_provider_snapshots，不是provider_balance_snapshots；highvcc第三批钱包只展示本页面成功查询，不把旧快照当新值。

今日花费SQL在admin-read-service中按北京时间窗口聚合：客户成功订单的CONSUMED账本用consumed_at；开卡费/拒付/拒付手续费用first_seen_at。未改统计算法。

12:06:00.455 UTC原始查询：

```sql
SELECT transaction_type,COUNT(*) AS n,SUM(occurred_at IS NULL) AS missing_event_time,
MIN(first_seen_at),MAX(first_seen_at)
FROM card_transactions
WHERE LOWER(transaction_type) IN ('card_issue_fee','chargeback','chargeback_fee')
GROUP BY transaction_type;
```

```text
chargeback     4 4 2026-08-29 01:50:13.929 2026-09-15 10:00:24.755
chargeback_fee 4 4 2026-08-29 01:50:13.930 2026-09-15 10:00:24.756
CARD_ISSUE_FEE 2 2 2026-09-18 00:27:31.928 2026-09-18 06:27:19.735
```

三类10行均缺事件时间；跨日补录可能把历史费用算入当天，当前显示0不证明将来也不会偏。此项仍待确定是否修源数据时间，不能通过清历史或偷换统计算法闭合。

## 登录与同步现场（只读）

12:04:23.590 UTC查询：

```sql
SELECT setting_key,updated_at FROM app_settings WHERE setting_key='highvcc_access_token_ciphertext';
SELECT pa.account_code,MAX(bs.observed_at) FROM provider_balance_snapshots bs
JOIN provider_accounts pa ON pa.id=bs.provider_account_id GROUP BY pa.account_code;
SELECT alert_type,status,created_at,updated_at FROM operator_alerts
WHERE alert_type='PROVIDER_TOKEN_EXPIRED' ORDER BY created_at DESC LIMIT 2;
```

```text
token setting updated_at 2026-09-18 12:54:05.098 UTC（未读值）
legacy-primary latest wallet 2026-09-21 12:03:02.137 UTC
backup-a latest wallet 2026-09-19 00:53:18.368 UTC
PROVIDER_TOKEN_EXPIRED OPEN created09-18 12:52:56.237 updated09-19 01:53:20.269 UTC
timer ActiveState=active LastTriggerUSec=2026-09-21 11:11:13 UTC
service Result=exit-code ExecMainStatus=1
```

指定09-19日志窗口筛选未返回匹配行，不能据此编造逐小时成功日志。更新时间与后续钱包记录相隔约12小时不是TTL结论：期间有没有其他调用、凭据语义均未证实。

## 交付核对与下一步

- D-332交互：用户确认，保持不动；未发布。
- 续期：公开资源静态分析完成，动态认证验证缺一次正常登录样本；自动续期未实现。
- FB-01：两页库存/HNSKJ钱包内部对齐已验；highvcc上游新鲜值与今日费用事件时间限制未闭合。
- 后续历史分类/客户链路/订单需求/一天试用仍未开始，不跨过A宣称整体完成。
- 本轮仅文档变化，无应用修改，不重跑完整支付测试；收尾state-check核事实，Demo8805与已有服务保留。
