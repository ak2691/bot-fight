-- Normalize legacy tree priorities in immutable match-history snapshots.
--
-- This changes only the JSON representation: array order, node IDs,
-- nodePositions, actionPriority, submission fingerprints, and match metadata
-- remain unchanged. Keeping history canonical lets the simulator use one
-- priority contract without a legacy createdOrder branch.

CREATE OR REPLACE FUNCTION botfight_migrate_match_tree_priorities(node jsonb, parent_key text DEFAULT NULL)
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
                botfight_migrate_match_tree_priorities(array_entry.value, parent_key)
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
                botfight_migrate_match_tree_priorities(item.value, item.key)
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
    changed_match_round_bots integer;
BEGIN
    UPDATE match_round_bot_codes
    SET brain_payload = botfight_migrate_match_tree_priorities(brain_payload)
    WHERE brain_payload IS DISTINCT FROM botfight_migrate_match_tree_priorities(brain_payload);
    GET DIAGNOSTICS changed_match_round_bots = ROW_COUNT;

    RAISE NOTICE 'Match history tree priority migration updated % brain(s)',
        changed_match_round_bots;
END
$$;

DROP FUNCTION botfight_migrate_match_tree_priorities(jsonb, text);
