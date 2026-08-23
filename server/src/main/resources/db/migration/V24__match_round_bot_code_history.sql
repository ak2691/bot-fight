CREATE TABLE match_round_bot_codes (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    match_id UUID NOT NULL,
    user_id UUID NOT NULL,
    round_number INTEGER NOT NULL,
    phase VARCHAR(30) NOT NULL,
    submission_fingerprint VARCHAR(64),
    selected_loadout VARCHAR(40),
    brain_schema_version VARCHAR(50) NOT NULL,
    client_build_version VARCHAR(100),
    brain_payload JSONB NOT NULL,
    submitted_at TIMESTAMPTZ NOT NULL,
    CONSTRAINT match_round_bot_codes_match_id_fk
        FOREIGN KEY (match_id) REFERENCES matches (id) ON DELETE CASCADE,
    CONSTRAINT match_round_bot_codes_user_id_fk
        FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
    CONSTRAINT match_round_bot_codes_round_positive
        CHECK (round_number > 0),
    CONSTRAINT match_round_bot_codes_match_round_phase_user_unique
        UNIQUE (match_id, round_number, phase, user_id)
);

CREATE INDEX match_round_bot_codes_match_user_round_idx
    ON match_round_bot_codes (match_id, user_id, round_number);
