-- 块 7 删表第一批（D-367，Lemon 2026-09-24 对盘点报告 docs/reviews/2026-09-24-block7-table-inventory.md 答「以上同意」）。
-- 删前：prepare 的整库加密备份 + 这 5 张表的行已单独导出留底（见 HANDOFF_LOG 同日章节）。
--
-- 1) 被 053 的 card_source_selections 取代的三张旧卡台选择表：运行代码 0 处引用。
--    browser_card_source_selections（3 行，053 已迁入新表）、browser_card_source_switch_events（7 行）、
--    fulfillment_route_card_sources（2 行）。
-- 2) 订单标签 / 补发：0 行，写入入口早已不存在（addOrderTag 未接路由、order-compensation-service 未被引用），
--    本迁移同一提交删掉了全部读写代码（含客户查单那一句 SQL）。
-- 三张旧表只有指向 products / provider_accounts / fulfillment_routes 的外键，订单两张只指向 orders / cdks；
-- 没有别的表指向这 5 张，可直接删。
DROP TABLE IF EXISTS browser_card_source_switch_events;
DROP TABLE IF EXISTS fulfillment_route_card_sources;
DROP TABLE IF EXISTS browser_card_source_selections;
DROP TABLE IF EXISTS order_tags;
DROP TABLE IF EXISTS order_compensations;
