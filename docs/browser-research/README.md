# Browser 研究资料库

这是 Browser 充值线的研究资料索引，不是生产配置、运行事实或技术路线批准。

## 使用规则

1. 研究材料只能作为候选输入，不能覆盖当前运行时证据。
2. 每条结论标注来源、固定提交/抓取时间、证据等级和可复用边界。
3. 公开仓库没有明确许可证时，只记录接口和设计思想，不复制源码。
4. 第三方后台截图、商品页和卖家声明只作为观察线索，不能当成能力证明。
5. Session、Cookie、Checkout URL、卡号和 API Secret 不进入资料库。

## 证据等级

- **L0 观察线索**：截图、页面文案、商品描述、卖家声明。
- **L1 静态证据**：固定提交源码、配置或可复现的离线测试。
- **L2 本地运行证据**：在隔离环境实际执行，未触碰真实付款。
- **L3 项目运行证据**：已接入本项目并由本地/隔离运行验证。
- **L4 真实业务证据**：真实 Session/Checkout/付款和最终权益均完成独立核验；需要单独批准。

当前资料库中的 GitHub 研究最高主要为 L1/L2，不能直接推出 L3/L4。

## 索引

- [`github-research-synthesis-2026-08-25.md`](./github-research-synthesis-2026-08-25.md)：此前 GitHub/公开实现研究的统一归纳。
- [`competitor-console-observation-2026-08-25.md`](./competitor-console-observation-2026-08-25.md)：用户提供的竞品后台截图观察，不把界面文案当成实现证明。
- [`competitor-photo-analysis-2026-08-26.md`](./competitor-photo-analysis-2026-08-26.md)：新增 4 张竞品现场照片的结构、安全和 MVP 启发分析。

## 原始材料位置

主要历史材料仍保留在 `docs/` 根目录，尤其是：

- `2026-08-22_browser-automation-github-expanded-research-report.md`
- `2026-08-22_browser-marketplace-tool-assessment-report.md`
- `2026-08-22_adversarial-review-browser-multi-lane-report.md`
- `2026-08-22_external-guide-browser-fingerprint-assessment-report.md`
- `2026-08-22_session-cookie-family-ab-evidence.md`
- `contracts/2026-08-22_browser-multi-lane-experiment-contract.md`

资料库是导航和沉淀层，不删除或改写原始研究记录。
