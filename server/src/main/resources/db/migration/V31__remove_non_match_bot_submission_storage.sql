-- Match-bound bot brains are authoritative in memory during the match and are
-- copied to match_round_bot_codes after the match. Remove the obsolete
-- standalone submission and validation-result storage.
ALTER TABLE match_participants
    DROP CONSTRAINT IF EXISTS match_participants_bot_brain_submission_id_fk;

DROP INDEX IF EXISTS match_participants_bot_brain_submission_id_idx;

ALTER TABLE match_participants
    DROP COLUMN IF EXISTS bot_brain_submission_id;

DROP TABLE IF EXISTS bot_brain_validation_results;
DROP TABLE IF EXISTS bot_brain_submissions;
