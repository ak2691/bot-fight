-- Convert known legacy ability identities in persisted brain JSON to permanent
-- numeric IDs. Unknown strings remain visible for validation/quarantine; they
-- are never silently removed. The transform is idempotent for numeric rows.
CREATE OR REPLACE FUNCTION migrate_legacy_ability_id(value text)
RETURNS jsonb LANGUAGE sql IMMUTABLE AS $$
    SELECT CASE value
        WHEN 'swing' THEN '1'::jsonb WHEN 'block' THEN '2'::jsonb
        WHEN 'fire_gun' THEN '3'::jsonb WHEN 'throw_grenade' THEN '4'::jsonb
        WHEN 'shoot_fireball' THEN '5'::jsonb WHEN 'stun' THEN '6'::jsonb
        WHEN 'heavy_slash' THEN '7'::jsonb WHEN 'repulsor_burst' THEN '8'::jsonb
        WHEN 'concussive_shot' THEN '9'::jsonb WHEN 'basic_heal' THEN '10'::jsonb
        WHEN 'proximity_mine' THEN '11'::jsonb WHEN 'pistol_shot' THEN '12'::jsonb
        WHEN 'rail_shot' THEN '13'::jsonb WHEN 'gravity_grenade' THEN '14'::jsonb
        WHEN 'silence_pulse' THEN '15'::jsonb WHEN 'reactive_armor' THEN '16'::jsonb
        WHEN 'hunter_drone' THEN '17'::jsonb WHEN 'wind_burst' THEN '18'::jsonb
        WHEN 'dash' THEN '19'::jsonb WHEN 'lock_on' THEN '20'::jsonb
        WHEN 'temporal_rewind' THEN '21'::jsonb WHEN 'orbital_strike' THEN '22'::jsonb
        WHEN 'absolute_guard' THEN '23'::jsonb WHEN 'null_zone' THEN '24'::jsonb
        WHEN 'phase_strike' THEN '25'::jsonb ELSE to_jsonb(value) END
$$;

CREATE OR REPLACE FUNCTION migrate_brain_ability_ids(node jsonb, parent_key text DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE result jsonb; item record;
BEGIN
    IF jsonb_typeof(node) = 'array' THEN
        SELECT COALESCE(jsonb_agg(
            CASE WHEN parent_key = 'abilities' AND jsonb_typeof(value) = 'string'
                 THEN migrate_legacy_ability_id(value #>> '{}')
                 ELSE migrate_brain_ability_ids(value, NULL) END), '[]'::jsonb)
        INTO result FROM jsonb_array_elements(node);
        RETURN result;
    ELSIF jsonb_typeof(node) = 'object' THEN
        result := '{}'::jsonb;
        FOR item IN SELECT key, value FROM jsonb_each(node) LOOP
            result := result || jsonb_build_object(item.key,
                CASE WHEN item.key IN ('ability','abilityId','ownerAbilityId','preparingAbility','triggeredAbility')
                           AND jsonb_typeof(item.value) = 'string'
                     THEN migrate_legacy_ability_id(item.value #>> '{}')
                     WHEN item.key = 'action' AND jsonb_typeof(item.value) = 'string'
                           AND (migrate_legacy_ability_id(item.value #>> '{}') #>> '{}') <> (item.value #>> '{}')
                     THEN migrate_legacy_ability_id(item.value #>> '{}')
                     ELSE migrate_brain_ability_ids(item.value, item.key) END);
        END LOOP;
        RETURN result;
    END IF;
    RETURN node;
END $$;

UPDATE bot_brain_submissions
SET brain_payload = migrate_brain_ability_ids(brain_payload)
WHERE brain_payload::text ~ '"(swing|block|fire_gun|throw_grenade|shoot_fireball|stun|heavy_slash|repulsor_burst|concussive_shot|basic_heal|proximity_mine|pistol_shot|rail_shot|gravity_grenade|silence_pulse|reactive_armor|hunter_drone|wind_burst|dash|lock_on|temporal_rewind|orbital_strike|absolute_guard|null_zone|phase_strike)"';

DROP FUNCTION migrate_brain_ability_ids(jsonb, text);
DROP FUNCTION migrate_legacy_ability_id(text);
