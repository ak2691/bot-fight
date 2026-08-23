CREATE TABLE user_blocks (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    blocker_user_id UUID NOT NULL,
    blocked_user_id UUID NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    CONSTRAINT user_blocks_distinct_users_check CHECK (blocker_user_id <> blocked_user_id),
    CONSTRAINT user_blocks_blocker_fk
        FOREIGN KEY (blocker_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT user_blocks_blocked_fk
        FOREIGN KEY (blocked_user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT user_blocks_pair_unique UNIQUE (blocker_user_id, blocked_user_id)
);

CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_user_id);
