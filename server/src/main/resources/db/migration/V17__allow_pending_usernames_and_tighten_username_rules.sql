ALTER TABLE users
    ALTER COLUMN username DROP NOT NULL;

ALTER TABLE users
    DROP CONSTRAINT IF EXISTS users_username_length;

ALTER TABLE users
    ADD CONSTRAINT users_username_valid
        CHECK (username IS NULL OR username ~ '^[A-Za-z0-9_-]{3,20}$');
