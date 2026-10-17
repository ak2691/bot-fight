ALTER TABLE password_reset_requests ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
ALTER TABLE email_verifications ADD COLUMN failed_attempts INTEGER NOT NULL DEFAULT 0;
