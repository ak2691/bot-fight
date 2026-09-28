-- Puzzle logic written before coordinate-versioning used top-left/Y-down values.
-- Keep its behavior fixed by assigning the legacy brain schema as its explicit
-- coordinate discriminator. New writes are validated with an explicit version.
UPDATE puzzles
SET logic_configuration = jsonb_set(
    logic_configuration,
    '{version}',
    '"bot-logic-tree-v1"'::jsonb,
    true
)
WHERE jsonb_typeof(logic_configuration) = 'object'
  AND (
      NOT (logic_configuration ? 'version')
      OR logic_configuration -> 'version' = 'null'::jsonb
  );
