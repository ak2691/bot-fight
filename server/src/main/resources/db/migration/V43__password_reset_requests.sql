CREATE TABLE password_reset_requests (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT password_reset_requests_user_id_unique UNIQUE (user_id),
    CONSTRAINT password_reset_requests_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT password_reset_requests_expiry_after_sent
        CHECK (expires_at > sent_at)
);

CREATE INDEX password_reset_requests_expires_at_idx ON password_reset_requests (expires_at);
