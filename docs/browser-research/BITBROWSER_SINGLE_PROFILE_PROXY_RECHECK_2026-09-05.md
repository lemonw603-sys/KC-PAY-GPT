# BitBrowser 单 Profile 代理修复后复核｜2026-09-05

## 范围

本次只验证本机 mihomo 单实例、BitBrowser Local API、批准的 Pilot Profile 和 ChatGPT 公开首页；不注入 Session、不创建订单、不进入 Checkout、不读取卡片、不执行 Provider/卡台写入、不付款。

## 现场结果

- `agent-evidence-gate.sh browser-order`：通过。
- BitBrowser Local API：`READY`。
- mihomo：单实例，PID `45732`；`17897/19097` 均由同一进程监听。
- 代理出口：`38.60.246.34`。
- Profile：`Plus Browser PH Pilot`，id `10f0dc7b534844c083165796447d5893`。
- `/browser/open`：成功；CDP 接管：成功。
- `https://chatgpt.com/`：HTTP `200`，标题 `ChatGPT: Chat, Work, Create & Code with AI`。
- Cloudflare challenge：本次未出现。
- 页面数：3；未发现付款动作。
- `/browser/close`：成功，生命周期正常收敛。

原始结果：`artifacts/bitbrowser-single-profile-check-20260905/result.json`。

## 边界

这证明代理生命周期和单 Profile 公开页面访问已恢复，不等于 Session 身份、Checkout 金额/税费或真实 Browser 付款已验收。下一步应在同一 Profile 生命周期内做一次客户式只读 Session/Checkout 观察；仍需在付款前停止。
