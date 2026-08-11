-- Match construction owns a building session; migrate persisted legacy names in place.
ALTER TABLE testing_sessions RENAME TO building_sessions;
ALTER TABLE bot_brain_submissions RENAME COLUMN testing_session_id TO building_session_id;

ALTER INDEX testing_sessions_user_id_idx RENAME TO building_sessions_user_id_idx;
ALTER INDEX testing_sessions_started_at_idx RENAME TO building_sessions_started_at_idx;
ALTER INDEX testing_sessions_match_user_idx RENAME TO building_sessions_match_user_idx;
ALTER INDEX bot_brain_submissions_user_testing_session_unique_idx
    RENAME TO bot_brain_submissions_user_building_session_unique_idx;

ALTER TABLE building_sessions
    RENAME CONSTRAINT testing_sessions_user_id_fk TO building_sessions_user_id_fk;
ALTER TABLE building_sessions
    RENAME CONSTRAINT testing_sessions_match_id_fk TO building_sessions_match_id_fk;
