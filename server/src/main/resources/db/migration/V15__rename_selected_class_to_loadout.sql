-- Loadouts replaced the obsolete class concept; preserve existing selections in place.
ALTER TABLE bot_brain_submissions RENAME COLUMN selected_class TO selected_loadout;
ALTER TABLE match_participants RENAME COLUMN selected_class TO selected_loadout;

ALTER INDEX bot_brain_submissions_selected_class_idx
    RENAME TO bot_brain_submissions_selected_loadout_idx;
ALTER INDEX match_participants_selected_class_idx
    RENAME TO match_participants_selected_loadout_idx;
