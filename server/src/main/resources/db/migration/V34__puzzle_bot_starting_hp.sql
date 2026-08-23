ALTER TABLE puzzle_bots
    ADD COLUMN IF NOT EXISTS start_hp DOUBLE PRECISION NOT NULL DEFAULT 150;

ALTER TABLE puzzle_bots
    DROP CONSTRAINT IF EXISTS puzzle_bots_start_hp_check;

ALTER TABLE puzzle_bots
    ADD CONSTRAINT puzzle_bots_start_hp_check CHECK (start_hp >= 0 AND start_hp <= 150);
