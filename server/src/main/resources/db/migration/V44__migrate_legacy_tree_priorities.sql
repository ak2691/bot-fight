-- Convert the legacy zero-based tree-order field used by saved puzzle JSON.
--
-- A tree node's array position is the editor position. Its priority is only
-- execution metadata, so this migration never reorders roots/branches and
-- never changes their IDs or nodePositions metadata.
--
-- Legacy conditional objects also used `priority` for the old flat action
-- priority. Preserve that value as `actionPriority` before replacing it with
-- the canonical conditional priority. Puzzle history is intentionally not
-- rewritten: match_round_bot_codes is immutable audit data and the server
-- continues to read both formats for replay compatibility.

CREATE OR REPLACE FUNCTION botfight_migrate_tree_priorities(node jsonb, parent_key text DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    result jsonb;
    item record;
    legacy_order numeric;
BEGIN
    IF node IS NULL THEN
        RETURN NULL;
    ELSIF jsonb_typeof(node) = 'array' THEN
        SELECT COALESCE(
            jsonb_agg(
                botfight_migrate_tree_priorities(array_entry.value, parent_key)
                ORDER BY array_entry.ordinality
            ),
            '[]'::jsonb
        )
        INTO result
        FROM jsonb_array_elements(node) WITH ORDINALITY AS array_entry(value, ordinality);
        RETURN result;
    ELSIF jsonb_typeof(node) = 'object' THEN
        result := '{}'::jsonb;
        FOR item IN SELECT key, value FROM jsonb_each(node) LOOP
            result := result || jsonb_build_object(
                item.key,
                botfight_migrate_tree_priorities(item.value, item.key)
            );
        END LOOP;

        IF parent_key IN ('roots', 'branches', 'children')
                AND jsonb_typeof(node -> 'createdOrder') = 'number'
                AND (node ->> 'createdOrder')::numeric >= 0
                AND trunc((node ->> 'createdOrder')::numeric)
                    = (node ->> 'createdOrder')::numeric THEN
            legacy_order := (node ->> 'createdOrder')::numeric;

            IF parent_key IN ('branches', 'children')
                    AND node ? 'priority'
                    AND NOT (node ? 'actionPriority') THEN
                result := result || jsonb_build_object('actionPriority', node -> 'priority');
            END IF;

            result := (result - 'createdOrder' - 'priority')
                    || jsonb_build_object('priority', trunc(legacy_order) + 1);
        END IF;
        RETURN result;
    END IF;

    RETURN node;
END;
$$;

DO $$
DECLARE
    changed_puzzles integer;
    changed_puzzle_bots integer;
BEGIN
    UPDATE puzzles
    SET logic_configuration = botfight_migrate_tree_priorities(logic_configuration),
        updated_at = now()
    WHERE logic_configuration IS DISTINCT FROM botfight_migrate_tree_priorities(logic_configuration);
    GET DIAGNOSTICS changed_puzzles = ROW_COUNT;

    UPDATE puzzle_bots
    SET brain_payload = botfight_migrate_tree_priorities(brain_payload)
    WHERE brain_payload IS DISTINCT FROM botfight_migrate_tree_priorities(brain_payload);
    GET DIAGNOSTICS changed_puzzle_bots = ROW_COUNT;

    RAISE NOTICE 'Tree priority migration updated % puzzle row(s) and % puzzle bot brain(s)',
        changed_puzzles, changed_puzzle_bots;
END
$$;

DROP FUNCTION botfight_migrate_tree_priorities(jsonb, text);
