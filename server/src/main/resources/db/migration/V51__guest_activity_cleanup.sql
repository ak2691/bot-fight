ALTER TABLE users
    ADD COLUMN IF NOT EXISTS guest_last_seen_at TIMESTAMPTZ;

UPDATE users
SET guest_last_seen_at = COALESCE(guest_last_seen_at, created_at)
WHERE is_guest = true;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_guest_expiry_check;

ALTER TABLE users
    ADD CONSTRAINT users_guest_expiry_check
        CHECK (
            (is_guest = false AND role IN ('USER', 'ADMIN')
                AND guest_expires_at IS NULL AND guest_last_seen_at IS NULL)
            OR (is_guest = true AND role = 'GUEST'
                AND guest_expires_at IS NOT NULL AND guest_last_seen_at IS NOT NULL)
        );

CREATE INDEX IF NOT EXISTS users_guest_last_seen_idx
    ON users (guest_last_seen_at)
    WHERE is_guest = true;
