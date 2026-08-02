-- The arena exercises deterministic bot brains; it does not train a model.
ALTER TABLE training_sessions RENAME TO testing_sessions;
ALTER TABLE bot_brain_submissions RENAME COLUMN training_session_id TO testing_session_id;

ALTER INDEX training_sessions_user_id_idx RENAME TO testing_sessions_user_id_idx;
ALTER INDEX training_sessions_started_at_idx RENAME TO testing_sessions_started_at_idx;
ALTER INDEX training_sessions_match_user_idx RENAME TO testing_sessions_match_user_idx;
ALTER INDEX bot_brain_submissions_user_training_session_unique_idx
    RENAME TO bot_brain_submissions_user_testing_session_unique_idx;

ALTER TABLE testing_sessions
    RENAME CONSTRAINT training_sessions_user_id_fk TO testing_sessions_user_id_fk;
ALTER TABLE testing_sessions
    RENAME CONSTRAINT training_sessions_match_id_fk TO testing_sessions_match_id_fk;
