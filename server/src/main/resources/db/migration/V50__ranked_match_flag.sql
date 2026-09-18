ALTER TABLE matches
    ADD COLUMN IF NOT EXISTS ranked BOOLEAN NOT NULL DEFAULT true;

UPDATE matches
SET ranked = false
WHERE mode = 'CUSTOM';
