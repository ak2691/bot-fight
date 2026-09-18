ALTER TABLE users
    ADD COLUMN IF NOT EXISTS is_guest BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS guest_expires_at TIMESTAMPTZ;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_role_check;

ALTER TABLE users
    ADD CONSTRAINT users_role_check CHECK (role IN ('USER', 'ADMIN', 'GUEST'));

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_guest_expiry_check;

ALTER TABLE users
    ADD CONSTRAINT users_guest_expiry_check
        CHECK (
            (is_guest = false AND role IN ('USER', 'ADMIN') AND guest_expires_at IS NULL)
            OR (is_guest = true AND role = 'GUEST' AND guest_expires_at IS NOT NULL)
        );

CREATE INDEX IF NOT EXISTS users_guest_expiry_idx
    ON users (guest_expires_at)
    WHERE is_guest = true;
