-- Reconcile the persistence names introduced with the registration and building DTO/domain changes.
-- Keep this forward-only so previously applied migrations remain immutable.

DO $$
BEGIN
    IF to_regclass('public.building_sessions') IS NULL
       AND to_regclass('public.testing_sessions') IS NOT NULL THEN
        ALTER TABLE testing_sessions RENAME TO building_sessions;
    END IF;
END $$;

DO $$
BEGIN
    IF EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bot_brain_submissions'
          AND column_name = 'testing_session_id'
    ) AND NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'bot_brain_submissions'
          AND column_name = 'building_session_id'
    ) THEN
        ALTER TABLE bot_brain_submissions
            RENAME COLUMN testing_session_id TO building_session_id;
    END IF;
END $$;

ALTER TABLE users
    ADD COLUMN IF NOT EXISTS email_verified BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE profiles
    ADD COLUMN IF NOT EXISTS about_me VARCHAR(500) NOT NULL DEFAULT '';

CREATE TABLE IF NOT EXISTS email_verifications (
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

CREATE INDEX IF NOT EXISTS email_verifications_expires_at_idx
    ON email_verifications (expires_at);
