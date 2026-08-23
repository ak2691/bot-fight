ALTER TABLE matches
    ADD COLUMN result_visible_at TIMESTAMPTZ;

UPDATE matches
SET result_visible_at = completed_at
WHERE completed_at IS NOT NULL;

CREATE INDEX matches_result_visible_at_idx
    ON matches (result_visible_at)
    WHERE result_visible_at IS NOT NULL;
