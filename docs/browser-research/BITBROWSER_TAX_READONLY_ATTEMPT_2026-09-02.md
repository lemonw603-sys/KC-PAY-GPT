# BitBrowser 菲律宾 Checkout 税费只读测试（2026-09-02）

## 目的

在不填卡、不点击 Subscribe、不写入 Provider/卡台的前提下，观察菲律宾 Checkout 的价格与税费，并尝试使用用户确认的真实账单地址进行对照。

## 本轮现场证据

- BitBrowser Local API `POST /health` 返回 200，Profile 可打开，CDP 接管成功。
- 登录账号页面正常，地区显示 Philippines。
- 通过页面的 `Upgrade` → `#pricing` 导航可打开套餐页；页面显示 ChatGPT Plus **₱1,100/月**。
- 页面存在 `data-testid=select-plan-button-plus-upgrade`，从套餐页点击后会停留在 `#pricing` 并持续显示 “Getting your plan ready”。网络和 Console 未出现 4xx/5xx 或脚本异常，且没有发起新的 Checkout 创建请求。
- 复用同一账号此前仍有效的 Checkout 页面后，现场重新读取到：基础价 **₱982.14**、VAT **12% / ₱117.86**、`Due today` **₱1,100.00**。
- 当前 Checkout 在未提供付款方式时没有呈现可编辑账单地址字段；Stripe Payment Element 配置也未单独展示地址输入区。因此不填卡条件下只能确认当前菲律宾 Checkout 的税额，**不能验证 Delaware 地址对税费的影响**。
- 未填写账单地址，未填卡，未点击 Subscribe，未创建订单，未调用 Provider/卡台。

## 结论

当前 BitBrowser + 菲律宾代理的登录、套餐页和此前已创建的 Checkout 均可达。当前 Checkout 明确把 ₱1,100 拆为 ₱982.14 + 12% VAT ₱117.86，因此这一次 ₱1,100 是含税总额。

在“不填卡”的边界内，Delaware 地址没有可输入位置，所以无法完成地址对照；不能据此判断该地址最终是否改变税费。

随后尝试等待同一 Checkout 的 Stripe Payment Element 并进行付款前填充，但该次页面在限定等待时间内未加载卡字段，因而未写入用户提供的卡信息；Profile 已关闭收口。此前曾观察到 Stripe 卡字段短暂加载，但尚未在一次稳定会话中完成“填卡后读取税费”的对照。

进一步诊断确认：Stripe 卡字段和账单地址 iframe 在部分加载窗口内确实会出现；曾在一次临时内存会话中填入卡字段（未提交），随后关闭 Profile。多次重新打开同一 Checkout 时字段又会消失或延迟，说明当前链接/Stripe 初始化存在间歇性状态，不能把它当作稳定测试结果。临时截图和脚本已删除。

下一次只读尝试应先复用同一 Profile，记录升级请求/页面错误并等待有限时长；若仍卡在 “Getting your plan ready”，应停止，不增加重试频率，也不绕过税务或风控校验。

## 当前阻塞（现场）

在完成新 Checkout 创建后，BitBrowser Local API 随即返回“今日打开窗口次数已达上限”。该限制来自 BitBrowser 当前账户/套餐，不是 ChatGPT、Stripe、代理或项目代码错误。新 Checkout 已创建，但 Profile 已关闭，今日无法再次经 Local API 打开并完成地址税费对照。后续必须等待额度重置或经用户确认升级 BitBrowser 套餐；恢复后应在一次 Profile 生命周期内完成全部观察，避免重复开关消耗次数。
