ALTER TABLE puzzles
    ADD COLUMN IF NOT EXISTS player_team_size SMALLINT NOT NULL DEFAULT 1,
    ADD COLUMN IF NOT EXISTS opponent_team_size SMALLINT NOT NULL DEFAULT 1;

ALTER TABLE puzzles
    DROP CONSTRAINT IF EXISTS puzzles_player_team_size_check,
    DROP CONSTRAINT IF EXISTS puzzles_opponent_team_size_check;

ALTER TABLE puzzles
    ADD CONSTRAINT puzzles_player_team_size_check CHECK (player_team_size BETWEEN 1 AND 2),
    ADD CONSTRAINT puzzles_opponent_team_size_check CHECK (opponent_team_size BETWEEN 1 AND 2);

ALTER TABLE puzzle_bots
    ADD COLUMN IF NOT EXISTS team_number SMALLINT,
    ADD COLUMN IF NOT EXISTS slot SMALLINT;

UPDATE puzzle_bots
SET team_number = CASE WHEN role = 'PLAYER' THEN 1 ELSE 2 END
WHERE team_number IS NULL;

UPDATE puzzle_bots
SET slot = 1
WHERE slot IS NULL;

ALTER TABLE puzzle_bots
    ALTER COLUMN team_number SET DEFAULT 1,
    ALTER COLUMN team_number SET NOT NULL,
    ALTER COLUMN slot SET DEFAULT 1,
    ALTER COLUMN slot SET NOT NULL;

ALTER TABLE puzzle_bots
    DROP CONSTRAINT IF EXISTS puzzle_bots_puzzle_role_unique,
    DROP CONSTRAINT IF EXISTS puzzle_bots_team_number_check,
    DROP CONSTRAINT IF EXISTS puzzle_bots_slot_check,
    ADD CONSTRAINT puzzle_bots_team_number_check CHECK (team_number IN (1, 2)),
    ADD CONSTRAINT puzzle_bots_slot_check CHECK (slot BETWEEN 1 AND 2),
    ADD CONSTRAINT puzzle_bots_puzzle_team_slot_unique UNIQUE (puzzle_id, team_number, slot);
