ALTER TABLE puzzles
    ADD COLUMN IF NOT EXISTS initial_elapsed_ms INTEGER NOT NULL DEFAULT 0;

ALTER TABLE puzzles
    DROP CONSTRAINT IF EXISTS puzzles_initial_elapsed_check;

ALTER TABLE puzzles
    ADD CONSTRAINT puzzles_initial_elapsed_check
        CHECK (initial_elapsed_ms BETWEEN 0 AND 60000);

ALTER TABLE puzzles
    DROP CONSTRAINT IF EXISTS puzzles_time_initial_elapsed_check;

ALTER TABLE puzzles
    ADD CONSTRAINT puzzles_time_initial_elapsed_check
        CHECK (time_limit_ms >= 0 AND time_limit_ms + initial_elapsed_ms <= 90000);
