ALTER TABLE puzzles
    ADD COLUMN IF NOT EXISTS logic_configuration JSONB NOT NULL DEFAULT '{}'::jsonb;
