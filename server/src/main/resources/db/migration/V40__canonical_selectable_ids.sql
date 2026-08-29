-- Convert legacy bot/entity selector ids in database-backed puzzle JSON.
-- Flyway runs this once per database. The IS DISTINCT FROM checks below keep
-- already-canonical JSON untouched, so rerunning the SQL is also safe.

CREATE OR REPLACE FUNCTION migrate_legacy_selectable_id(value text)
RETURNS text
LANGUAGE sql
IMMUTABLE
AS $$
    SELECT CASE
        WHEN value ~ '^opponent(:.*)?$'
            THEN regexp_replace(value, '^opponent', 'opponent_1')
        WHEN value ~ '^my_(grenade|fireball|proximity_mine|gravity_zone|silence_wave|hunter_drone|windburst_projectile|temporal_rewind_zone|orbital_zone|null_zone|singularity_zone|tether_bolt|static_snare|repeller_drone)(:.*)?$'
            THEN regexp_replace(value, '^my_', 'my_bot_')
        WHEN value ~ '^opponent_(grenade|fireball|proximity_mine|gravity_zone|silence_wave|hunter_drone|windburst_projectile|temporal_rewind_zone|orbital_zone|null_zone|singularity_zone|tether_bolt|static_snare|repeller_drone)(:.*)?$'
            THEN regexp_replace(value, '^opponent_', 'opponent_1_')
        ELSE value
    END
$$;

CREATE OR REPLACE FUNCTION migrate_brain_selectable_ids(node jsonb)
RETURNS jsonb
LANGUAGE plpgsql
IMMUTABLE
AS $$
DECLARE
    result jsonb;
    item record;
BEGIN
    IF node IS NULL THEN
        RETURN NULL;
    ELSIF jsonb_typeof(node) = 'array' THEN
        SELECT COALESCE(
            jsonb_agg(migrate_brain_selectable_ids(array_entry.value) ORDER BY array_entry.ordinality),
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
                CASE
                    WHEN item.key IN (
                        'selectable',
                        'selectable1',
                        'selectable2',
                        'leftSelectable',
                        'rightSelectable',
                        'target'
                    ) AND jsonb_typeof(item.value) = 'string'
                    THEN to_jsonb(migrate_legacy_selectable_id(item.value #>> '{}'))
                    ELSE migrate_brain_selectable_ids(item.value)
                END
            );
        END LOOP;
        RETURN result;
    END IF;

    RETURN node;
END
$$;

DO $$
DECLARE
    changed_puzzles integer;
    changed_puzzle_bots integer;
BEGIN
    UPDATE puzzles
    SET win_conditions = migrate_brain_selectable_ids(win_conditions),
        lose_conditions = migrate_brain_selectable_ids(lose_conditions),
        logic_configuration = migrate_brain_selectable_ids(logic_configuration),
        updated_at = now()
    WHERE win_conditions IS DISTINCT FROM migrate_brain_selectable_ids(win_conditions)
       OR lose_conditions IS DISTINCT FROM migrate_brain_selectable_ids(lose_conditions)
       OR logic_configuration IS DISTINCT FROM migrate_brain_selectable_ids(logic_configuration);
    GET DIAGNOSTICS changed_puzzles = ROW_COUNT;

    UPDATE puzzle_bots
    SET brain_payload = migrate_brain_selectable_ids(brain_payload)
    WHERE brain_payload IS DISTINCT FROM migrate_brain_selectable_ids(brain_payload);
    GET DIAGNOSTICS changed_puzzle_bots = ROW_COUNT;

    RAISE NOTICE 'Canonical selectable migration updated % puzzle row(s) and % puzzle bot brain(s)',
        changed_puzzles, changed_puzzle_bots;
END
$$;

DROP FUNCTION migrate_brain_selectable_ids(jsonb);
DROP FUNCTION migrate_legacy_selectable_id(text);
