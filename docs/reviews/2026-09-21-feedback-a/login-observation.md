# 一次真实登录观察：返回约7天到期时间，无刷新凭据

2026-09-21，UTC。用户在“方便”后自行完成highvcc正常登录。**仅观察，不自动登录/续期/保活，不向充值后台保存新token。** 用户输入密码和完成滑块，Agent未代填或代点。

## 方法与范围

IAB tab7至官方https://www.highvcc.com/。Network事件只在内存读取，responseReceived从cursor32起，truncated=false/hasMore=false；不录HAR、不输出完整URL查询参数、请求体、Authorization、完整响应。只对已出现的loginPwd响应解析字段名、业务code、凭据存在性及expireTime，解析后不保留原始body。12:14:49.090 UTC Network.disable已执行。登录页因用户操作进入#/home，未再次登录/退出，不触碰充值/卡片资金按钮。

## 原始元数据（无凭据）

```text
POST /api/user/loginPwd  HTTP200 / business code500  dataFields=[]
POST /api/user/loginPwd  HTTP200 / business code200
topFields=[code,msg,data,ok]
dataFields=[name,isSub,expireTime,accessToken]
hasAccessToken=true
hasRefreshToken=false
expireTime=1790597610
declaredExpiry=2026-09-28T12:13:30.000Z
observedAt=2026-09-21T12:14:49.090Z
renewalPathsObserved=[]
```

未读取/记录首个业务失败的原因，不从HTTP200或code500猜密码、滑块等原因。网页自然请求路径包括captchaTwo/verify/loginPwd、user/info、user/overview、user/wallet、card/rangeList及notice类；这里只记录路径和HTTP状态，不将所有HTTP200当业务成功。

## 可以与不可以得出的结论

- 本次成功响应声明到期为约7天后，不是2小时。北京时间为09-28 20:13:30。
- 本次没有refreshToken/refresh_token字段，当前登录后的自然请求也未见refresh/renew路径；配合公开代码未见实际续期调用，仍没有现成可直接接入的续期证据。
- 网页代码的“两小时不活动”是独立的前端判断。不能把它当服务端固定两小时TTL，也不能把声明7天当7天内必然可用；服务端闲置过期、撤销/其他登录影响、绝对期限等均需另证。
- 仅凭本次观察，不能承诺“定时请求即可保活”“无需再登录”，也不能以滑块为由断言一定无解。

## 下一验证点

**已获后续授权并安排**：用户“安排”。2026-09-21 22:20 Asia/Shanghai应用一次性heartbeat，id=highvcc，指向当前任务，COUNT=1。不主动保活、不刷新或重登；最多一次现有GET /api/user/wallet，先确认是同一会话。完成或需要用户处理后停止，不重复执行。

安排时在tab7内部只读计算SHA256（未发网络请求、不导出token）：`0e9493ef8c17bca799652217a732eb643841020464449be88489e372224a945d`；storedExpiry=`1790597610000`。复测前用同法比较指纹；若不同，只报告会话变化，不能当原token两小时验证。指纹不可用于登录，不保存原始token。CDP Network仍关闭，标签markHandoff保留。

本次有界只读复测保持同一会话，不调用续期/登录接口、不修改生产配置，比较网页与只读API是否真的失效；关注发生时刻和明确响应code，不输出凭据。已按上述用户确认的时点使用产品调度机制安排，不启动常驻轮询。复测尚未执行，不进行持续监控。

本轮无应用代码变更。原Demo与正式系统不变；官方登录标签保留为用户现场，不擅自退出。该结果覆盖auth-and-data-audit.md里的“还缺一次登录响应”，但不代表A/续期功能完成。
