-- Timed rounds: each round's stored brain also records which custom variables the player reset to
-- their default at that round's boundary, and what they chose to happen if their clock ran out. A
-- finished match re-simulates exactly from the seed plus these rows.
ALTER TABLE match_round_bot_codes
    ADD COLUMN variable_resets JSONB NOT NULL DEFAULT '[]'::jsonb,
    ADD COLUMN timeout_fallback VARCHAR(10);

ALTER TABLE match_round_bot_codes
    ADD CONSTRAINT match_round_bot_codes_timeout_fallback_check
        CHECK (timeout_fallback IS NULL OR timeout_fallback IN ('CURRENT', 'PREVIOUS'));
