-- 第④步（面二⑩，D-228 补充二 / D-232）：待销清单的最短存活期，按卡台规则先配 6 小时、可调。
-- 待销清单本身是派生查询（缝 c：不新建表），只需要这一个设置键；每次实际销成功的时间
-- 记在 card_state_events（event_type = CARD_RETIRED_CONFIRMED）里，积累卡台真实规则。
INSERT IGNORE INTO app_settings (setting_key, setting_value)
VALUES ('card_min_retire_age_hours', '6');
