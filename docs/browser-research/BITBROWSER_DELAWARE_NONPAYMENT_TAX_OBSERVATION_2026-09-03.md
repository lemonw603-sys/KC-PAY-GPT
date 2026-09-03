# BitBrowser Delaware 账单地址非付款税费复验（2026-09-03）

## 目标与停止点

使用一个 BitBrowser Profile、既有测试 Session、测试卡片和用户确认的 Delaware 账单地址，进入真实 ChatGPT Plus Checkout；填写卡片及账单地址，等税费稳定后停在可点击 Subscribe 的最后一步。全程不点击 Subscribe、不付款、不调用项目 Provider/卡台写接口。

## 安全入口

- 新增 `browser-mvp/scripts/observe-bitbrowser-checkout-tax-nonpayment.js`。
- 敏感材料只接受调用者所有、权限为 `0600` 的仓库外绝对路径文件；读取后立即删除。
- 脚本没有付款点击/提交代码，并在页面注入 submit tripwire；输出只含身份布尔值、摘要哈希、币种、金额、字段计数和 `submitCalls=0`。
- 结束时清空已填写字段、Cookie 与站点 storage，并关闭 Profile。

## 现场结果

- BitBrowser Local API 健康，单 Profile 启动并被 Playwright CDP 接管。
- 测试 Session 身份匹配；订阅状态为 `FREE`。
- 真实 Checkout 已进入，套餐确认是 ChatGPT Plus。
- 卡片字段 3 项、账单必填字段 6 项均完成填写；最终 Subscribe 控件存在且启用。
- 地址填写后的稳定金额仍为：基础价 `PHP 982.14`、VAT `PHP 117.86`、合计 `PHP 1100.00`。
- `submitCalls=0`；没有付款。清理阶段清空 7 个直接可清空输入，其余下拉状态随 Cookie/storage 清理及 Profile 关闭收口。

## 结论边界

本次已证明：在当前菲律宾 Profile/定价轨道和该真实 Checkout 中，填写 Delaware 地址后，页面最终金额**没有**从 `PHP 1100.00` 降低，仍保留 12% VAT。此前“美国免税州地址会把该菲律宾 Checkout 变为免税”的假设不成立，至少不能作为当前系统规则或成本预算依据。

本次没有证明其他 Profile、其他国家定价轨道或未来页面版本一定相同；也没有验证真实付款和付款后 Plus 激活。系统预算应使用账单地址填写后的页面最终总额，不能用地址规则预估减税。

## 执行中修正

首次冷启动因 Local API 默认 10 秒超时而安全失败；已将该单次工具的启动超时改为 60 秒并关闭可能已打开的 Profile。第二次暴露关闭最后页面会令 BitBrowser CDP Context 同时关闭；清理逻辑改为保留临时 anchor 后，第三次完整复验成功。两个失败尝试均发生在 Session/卡片填写前，`submitCalls=0`。

## 下一步

单 Profile 非付款税费闸门已通过。下一步按既定顺序验证 3 个 Profile 同开、订单间隔离和固定出口；通过后再扩到 6 个 Profile。同开验证仍保持非付款，真实付款和生产部署需单独确认。
