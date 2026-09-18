ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_guest_expiry_check;

ALTER TABLE users
    ADD CONSTRAINT users_guest_expiry_check
        CHECK (
            (is_guest = false AND role IN ('USER', 'ADMIN')
                AND guest_expires_at IS NULL)
            OR (is_guest = true AND role = 'GUEST'
                AND guest_expires_at IS NOT NULL)
        );

DROP INDEX IF EXISTS users_guest_last_seen_idx;

ALTER TABLE users
    DROP COLUMN IF EXISTS guest_last_seen_at;
