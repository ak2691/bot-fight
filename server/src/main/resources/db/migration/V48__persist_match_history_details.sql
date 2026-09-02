ALTER TABLE match_participants
    ADD COLUMN round_wins INTEGER;

ALTER TABLE match_participants
    ADD CONSTRAINT match_participants_round_wins_check
    CHECK (round_wins IS NULL OR round_wins >= 0);
