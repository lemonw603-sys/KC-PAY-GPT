-- D-400 / D-401（2026-09-27 Lemon 定）：API 路线（ZZSHU 直充）与 Browser 一样可用任何卡台的卡。
-- 依据：2026-09-27 02:27 UTC 用 highvcc 卡（卡头 51398996）经 ZZSHU `orders/direct`、region PH 建单成功
-- （订单 35289），ZZSHU 不再按卡头拒 highvcc（D-253 的前提已不成立）。付款成功未验，由首张真实客户单验收。
-- 本迁移只做两件数据改动；切到哪个卡台、切不切路线，仍由 Lemon 在后台做（走四项校验与审计）。

-- 1. 备用卡台 A（highvcc，103）标记为可做 API 直充：建单选路线（order-intake-repository）与切卡台的
--    SOURCE_HEALTHY 校验都按这个能力位放行。
UPDATE provider_accounts
SET supports_api_recharge = 1
WHERE id = '00000000-0000-4000-8000-000000000103' AND purpose = 'CARD';

-- 2. Plus 的 API 行解锁（migration-053 按 D-253 锁成固定 hnskj）；版本 +1，让旧页面上的切换请求因版本不符被拒。
--    Pro 5x / 20x 的 API 行不在本次范围（欠账 9），保持锁定。
UPDATE card_source_selections s
INNER JOIN products p ON p.id = s.product_id
SET s.locked = 0, s.version = s.version + 1, s.updated_by = 'migration-062'
WHERE p.product_code = 'chatgpt_plus' AND s.executor_kind = 'API' AND s.locked = 1;
