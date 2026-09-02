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

下一次只读尝试应先复用同一 Profile，记录升级请求/页面错误并等待有限时长；若仍卡在 “Getting your plan ready”，应停止，不增加重试频率，也不绕过税务或风控校验。
