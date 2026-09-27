-- Keep the existing lower(username) B-tree for exact username lookups. This
-- partial GIN index accelerates the verified, non-guest substring search.
CREATE EXTENSION IF NOT EXISTS pg_trgm;

CREATE INDEX users_verified_username_lower_trgm_idx
    ON users USING gin (lower(username) gin_trgm_ops)
    WHERE is_guest = false AND email_verified = true;
