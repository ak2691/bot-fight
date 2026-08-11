package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class LegacyAbilityPayloadMigrationTest {
    private final JsonMapper jsonMapper = new JsonMapper();

    @Test
    void legacyNamesNormalizeAtTheExplicitBoundaryAndNumericIdsRemainStable() throws Exception {
        var legacy = jsonMapper.readTree("""
                {"loadout":{"abilities":["heavy_slash",13],"statPoints":{}},
                 "roots":[{"branches":[{"action":"heavy_slash","conditions":[{"ability":"rail_shot"}]}]}]}
                """);

        var normalized = LegacyAbilityPayloadMigration.normalize(legacy);

        assertThat(normalized.at("/loadout/abilities/0").intValue()).isEqualTo(7);
        assertThat(normalized.at("/loadout/abilities/1").intValue()).isEqualTo(13);
        assertThat(normalized.at("/roots/0/branches/0/action").intValue()).isEqualTo(7);
        assertThat(normalized.at("/roots/0/branches/0/conditions/0/ability").intValue()).isEqualTo(13);
        assertThat(LegacyAbilityPayloadMigration.normalize(normalized)).isEqualTo(normalized);
    }

    @Test
    void malformedNamesRemainVisibleForFailClosedValidation() throws Exception {
        var malformed = jsonMapper.readTree("""
                {"loadout":{"abilities":["invented_ability"],"statPoints":{}},
                 "roots":[{"branches":[{"action":"invented_ability","conditions":[{"ability":"invented_ability"}]}]}]}
                """);

        var normalized = LegacyAbilityPayloadMigration.normalize(malformed);
        assertThat(normalized.at("/loadout/abilities/0").textValue()).isEqualTo("invented_ability");
        assertThat(normalized.at("/roots/0/branches/0/action").textValue()).isEqualTo("invented_ability");
        assertThat(normalized.at("/roots/0/branches/0/conditions/0/ability").textValue()).isEqualTo("invented_ability");
    }

    @Test
    void partialPersistedLoadoutsStillNormalizeTheirAbilityList() throws Exception {
        var partial = jsonMapper.readTree("""
                {"loadout":{"abilities":["pistol_shot"]}}
                """);

        assertThat(LegacyAbilityPayloadMigration.normalize(partial)
                .at("/loadout/abilities/0").intValue()).isEqualTo(12);
    }
}
