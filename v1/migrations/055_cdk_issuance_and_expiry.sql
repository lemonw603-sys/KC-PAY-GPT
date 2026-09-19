-- 第⑥步 CDK（D-286）：把「已发出」和「还在手里」分开，并给码一个可选有效期。
--
-- 为什么必须分开：cdks.status 只有 AVAILABLE/REDEEMED/REVOKED，于是 AVAILABLE 混了两种
-- 性质相反的东西——已售未兑（欠客户一次交付＝负债）与未售（还能卖＝库存）。规模化后
-- 「我现在欠多少次交付」直接决定备多少卡、钱包留多少钱、能不能安全停业务，必须答得出。
--
-- 为什么是加列而不是加 status 取值：「已发出」与 status 正交——已发出的码在被兑换前
-- 仍然是 AVAILABLE。塞进 status 会让「可兑换吗」和「卖出去了吗」两个问题互相污染。
--
-- expires_at：D-245 关掉 305/306 后，20X 的码仍在客户手里且状态仍 AVAILABLE，兑换直接撞
-- ORDER_ROUTE_UNAVAILABLE，后台无法主动识别「哪些码现在兑不了」。有效期给一条可控的退路。
-- 注意「当前可不可兑」不落静态字段，运行时按产品路线 accepts_new_orders 判断（路线随时会切）。
--
-- 只加列、不动存量：全部可空，既有码 issued_at/expires_at 均为 NULL
-- （NULL = 未标记发出 / 不过期），行为与迁移前完全一致。
ALTER TABLE cdks
  ADD COLUMN issued_at TIMESTAMP(3) NULL DEFAULT NULL COMMENT 'D-286: 标记为已发给客户/渠道的时间；NULL=还在手里（库存）',
  ADD COLUMN issued_note VARCHAR(200) NULL DEFAULT NULL COMMENT 'D-286: 发出去向备注（给谁/哪个渠道），运营自填',
  ADD COLUMN expires_at TIMESTAMP(3) NULL DEFAULT NULL COMMENT 'D-286: 可选有效期；NULL=不过期';

-- 按「未发出的库存」「已发出未兑的负债」筛选是这两个功能的主查询，给它一个索引。
ALTER TABLE cdks ADD KEY idx_cdks_status_issued (status, issued_at);
