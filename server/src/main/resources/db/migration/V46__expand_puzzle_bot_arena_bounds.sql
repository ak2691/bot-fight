ALTER TABLE puzzle_bots
    DROP CONSTRAINT IF EXISTS puzzle_bots_x_check,
    DROP CONSTRAINT IF EXISTS puzzle_bots_y_check,
    ADD CONSTRAINT puzzle_bots_x_check CHECK (start_x >= 0 AND start_x <= 1200),
    ADD CONSTRAINT puzzle_bots_y_check CHECK (start_y >= 0 AND start_y <= 1200);
