CREATE TABLE player_ratings (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    mode VARCHAR(20) NOT NULL,
    rating INTEGER NOT NULL DEFAULT 1000,
    rated_matches INTEGER NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    version BIGINT NOT NULL DEFAULT 0,
    CONSTRAINT player_ratings_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT player_ratings_mode_check
        CHECK (mode IN ('ONES', 'TWOS')),
    CONSTRAINT player_ratings_rating_nonnegative
        CHECK (rating >= 0),
    CONSTRAINT player_ratings_rated_matches_nonnegative
        CHECK (rated_matches >= 0),
    CONSTRAINT player_ratings_user_mode_unique
        UNIQUE (user_id, mode)
);

CREATE INDEX player_ratings_mode_rating_idx
    ON player_ratings (mode, rating);

-- Existing accounts receive both queue ratings at the system starting value.
-- Historical match rows are deliberately left unchanged: before this table
-- existed there were no authoritative per-match rating snapshots to replay.
INSERT INTO player_ratings (user_id, mode)
SELECT user_row.id, mode_value.mode
FROM users user_row
CROSS JOIN (VALUES ('ONES'::VARCHAR(20)), ('TWOS'::VARCHAR(20))) AS mode_value(mode)
ON CONFLICT (user_id, mode) DO NOTHING;

-- Keep the invariant for accounts created after this migration as well.
CREATE OR REPLACE FUNCTION initialize_player_ratings_for_user()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    INSERT INTO player_ratings (user_id, mode)
    VALUES (NEW.id, 'ONES'), (NEW.id, 'TWOS')
    ON CONFLICT (user_id, mode) DO NOTHING;
    RETURN NEW;
END
$$;

CREATE TRIGGER users_initialize_player_ratings
    AFTER INSERT ON users
    FOR EACH ROW
    EXECUTE FUNCTION initialize_player_ratings_for_user();
