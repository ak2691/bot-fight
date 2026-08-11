ALTER TABLE users
    ADD COLUMN email_verified BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE email_verifications (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id UUID NOT NULL,
    code_hash VARCHAR(255) NOT NULL,
    sent_at TIMESTAMPTZ NOT NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT email_verifications_user_id_unique UNIQUE (user_id),
    CONSTRAINT email_verifications_user_id_fk
        FOREIGN KEY (user_id)
        REFERENCES users (id)
        ON DELETE CASCADE,
    CONSTRAINT email_verifications_expiry_after_sent
        CHECK (expires_at > sent_at)
);

CREATE INDEX email_verifications_expires_at_idx ON email_verifications (expires_at);
