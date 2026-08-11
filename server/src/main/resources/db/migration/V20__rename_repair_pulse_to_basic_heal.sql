-- Rename persisted textual Basic Heal identifiers. Compact selected_loadout
-- values remain unchanged because the canonical compact code is still "e".
UPDATE bot_brain_submissions
SET brain_payload = replace(brain_payload::text, '"repair_pulse"', '"basic_heal"')::jsonb
WHERE brain_payload::text LIKE '%"repair_pulse"%';
