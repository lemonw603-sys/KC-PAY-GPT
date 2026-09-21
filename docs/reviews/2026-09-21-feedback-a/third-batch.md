# D-332确认后的第三批：工作台原位钱包与简化切换

2026-09-21 UTC+8。**本地及Demo已验，未发布。自动续期与A整体验收仍未完成。**

## 范围和依据

用户确认撤回新增“卡台未保存”提醒，没看懂的第4项仅指Demo测试场景，其他方案同意。依据D-332覆盖D-331钱包仅跳转、第二批未保存拦截；工作台C/营业条乙-3、卡片A保持，仅改局部内容和反馈。前轮11:38:57 UTC生产钱包观察时间查询见规划：highvcc为09-19、HNSKJ为09-21，不用旧记录冒充新查询。

本批只改admin前端、Demo和测试；`git diff 9b9f181 -- v1/src browser-mvp/src`为空。继续复用GET highvcc/wallet，后台confirm字段、切换校验、资金锁定、收费确认、原订单冻结来源不变。回退静态资源即可，无迁移、没有重启生产/付款池。台账统计、自动登录机制不在已实现范围。

## 承诺与证据

| 承诺 | 实际结果及证据 | 状态 |
|---|---|---|
| 工作台显示钱包USD、原位刷新 | renderWbCards新增summary/刷新/更新登录；loadHighvccWallet沿用同一请求、向页面state登记金额时点；无新服务/落盘缓存 | 本地已验证 |
| 失败不冒充最新 | updateHighvccWalletSummary保留本页面成功值，追加“上次查询/刷新失败”；无成功值显示未查询或查询失败；空余额不报成功 | 单测及隔离真实DOM通过 |
| 撤回未保存卡台提醒 | 删除guard和data-saved-value；测试unsaved分支仍发1次方式请求，不隐式保存卡源 | 本地已验证，用户明确裁定 |
| 去掉API/Browser确认窗 | 删除该函数window.confirm；disabled防重入，后端confirmation/expectedCurrentMethod仍发送；测试confirm一旦调用即抛错 | 单测通过；Demo真实点击dialog=false |
| 操作提示醒目 | page-notice从右下11px改顶部居中14px，加宽/加粗；错误与结果不明仍不自动隐藏。共用入口影响后台其他页，保留原role=status及aria-live | Demo截图已查看，隔离回归含诊断提示通过 |
| Demo测试场景容易理解 | 默认normal；故障工具收进“模拟故障（可不操作，正式系统没有这一项）”；测试说明不进正式HTML | Demo已更新并保留 |
| 自动续token | 尚无现场续期证据，不实现未经验证的保活或自动登录；D-249旧滑块决定不能证明无续期接口 | 未完成，下一待研究项 |
| A全部及B～E | 逐字段准确性、生产上游/卡台登录、历史分类、客户链路、订单页、一整天试用仍按计划 | 未完成 |

钱包仅保留当前页面运行期的最近成功值，切内部页/轮询重绘不丢，整页reload后回未查询；不把历史库钱包接进概览。更新登录沿用原token入口，确认保存会清旧值；用户随后点刷新，查询成功显示新值。不声称token保存=有效，也未新增自动同步/告警清除。

## 验证

- `node --test`：1062 tests / 993 pass / 0 fail / 69 skipped。专项admin-operation-feedback+admin-cards-page：56 pass。
- `FEEDBACK_ACCEPTANCE=1 DIAGNOSTICS_ACCEPTANCE=1 node scripts/step6-safety-acceptance.mjs`：25 checks/0 failures，11:52:23.339 UTC结束，临时库/账号剩余0。包含钱包原位失败→成功→失败留旧值、重绘、token深链、桌面/390px、0意外写请求、原API/Browser四种核实收口/409资金保护、恢复和诊断几何。仅合成钱包，不是卡台真钱验证。
- 应用内浏览器Demo：刷新后工作台显示`钱包 41.49 USD · 查询于 09/21 19:52`；未保存选择改为primary后点Browser，返回`默认充值方式已切换为浏览器自动化充值；只影响之后新建的订单。`且`dialog:false`。实际已保存卡台仍backup，未隐式保存下拉选择。
- 截图看到提示位于顶部、字号变大；错误/成功原语义色保留。CSS颜色字面量137→133，基线更新，文案/diff检查通过。完整工作台/卡片几何一致性未跑，不冒充全站视觉验收。
- state-check全一致：release9b9f181、服务active、接单/付款true、058、瞬时分配资格2、活动账号槽/非终态0；未更改生产。原8803/8804/8899保留，仅重启自己创建的8805测试服务加载Demo文案。

原始结果：third-tests.txt、third-evidence.json及third-wallet-stale.png。最新Demo继续是`http://127.0.0.1:8805/admin/`，用户试用产物，不清理为残留worker。
