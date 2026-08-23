ALTER TABLE puzzles
    DROP CONSTRAINT IF EXISTS puzzles_time_limit_check;

ALTER TABLE puzzles
    ADD CONSTRAINT puzzles_time_limit_check CHECK (time_limit_ms BETWEEN 0 AND 90000);
