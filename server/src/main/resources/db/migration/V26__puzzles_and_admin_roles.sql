ALTER TABLE users
    ADD COLUMN IF NOT EXISTS role VARCHAR(20) NOT NULL DEFAULT 'USER';

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('USER', 'ADMIN'));

CREATE TABLE puzzles (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    puzzle_number BIGINT NOT NULL,
    name VARCHAR(120) NOT NULL,
    status VARCHAR(20) NOT NULL DEFAULT 'DRAFT',
    hide_opponent_code BOOLEAN NOT NULL DEFAULT true,
    time_limit_ms INTEGER NOT NULL DEFAULT 90000,
    max_action_nodes INTEGER NOT NULL DEFAULT 100,
    max_condition_nodes INTEGER NOT NULL DEFAULT 300,
    max_custom_variables INTEGER NOT NULL DEFAULT 100,
    win_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    lose_conditions JSONB NOT NULL DEFAULT '[]'::jsonb,
    created_by UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT puzzles_number_unique UNIQUE (puzzle_number),
    CONSTRAINT puzzles_status_check CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    CONSTRAINT puzzles_time_limit_check CHECK (time_limit_ms > 0 AND time_limit_ms <= 90000),
    CONSTRAINT puzzles_action_limit_check CHECK (max_action_nodes BETWEEN 0 AND 100),
    CONSTRAINT puzzles_condition_limit_check CHECK (max_condition_nodes BETWEEN 0 AND 300),
    CONSTRAINT puzzles_custom_variable_limit_check CHECK (max_custom_variables BETWEEN 0 AND 100),
    CONSTRAINT puzzles_created_by_fk FOREIGN KEY (created_by) REFERENCES users (id) ON DELETE RESTRICT
);

CREATE INDEX puzzles_status_number_idx ON puzzles (status, puzzle_number);

CREATE TABLE puzzle_bots (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    puzzle_id UUID NOT NULL,
    role VARCHAR(20) NOT NULL,
    loadout VARCHAR(40) NOT NULL,
    start_x DOUBLE PRECISION NOT NULL,
    start_y DOUBLE PRECISION NOT NULL,
    rotation DOUBLE PRECISION NOT NULL DEFAULT 0,
    brain_payload JSONB NOT NULL DEFAULT '{}'::jsonb,
    CONSTRAINT puzzle_bots_role_check CHECK (role IN ('PLAYER', 'OPPONENT')),
    CONSTRAINT puzzle_bots_x_check CHECK (start_x >= 0 AND start_x <= 1000),
    CONSTRAINT puzzle_bots_y_check CHECK (start_y >= 0 AND start_y <= 1000),
    CONSTRAINT puzzle_bots_rotation_check CHECK (rotation >= -360 AND rotation <= 360),
    CONSTRAINT puzzle_bots_puzzle_fk FOREIGN KEY (puzzle_id) REFERENCES puzzles (id) ON DELETE CASCADE,
    CONSTRAINT puzzle_bots_puzzle_role_unique UNIQUE (puzzle_id, role)
);

CREATE INDEX puzzle_bots_puzzle_id_idx ON puzzle_bots (puzzle_id);
