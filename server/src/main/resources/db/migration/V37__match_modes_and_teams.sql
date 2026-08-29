ALTER TABLE matches
    ADD COLUMN mode VARCHAR(20) NOT NULL DEFAULT 'ONES';

ALTER TABLE matches
    ADD CONSTRAINT matches_mode_check CHECK (mode IN ('ONES', 'TWOS', 'CUSTOM'));

ALTER TABLE match_participants
    ADD COLUMN team_number SMALLINT;

ALTER TABLE match_participants
    DROP CONSTRAINT match_participants_slot_check;

ALTER TABLE match_participants
    ADD CONSTRAINT match_participants_slot_check CHECK (slot >= 1);

UPDATE match_participants
SET team_number = slot;

ALTER TABLE match_participants
    ALTER COLUMN team_number SET DEFAULT 1,
    ALTER COLUMN team_number SET NOT NULL;

ALTER TABLE match_participants
    ADD CONSTRAINT match_participants_team_number_check CHECK (team_number >= 1);

CREATE INDEX match_participants_match_team_idx
    ON match_participants (match_id, team_number);
