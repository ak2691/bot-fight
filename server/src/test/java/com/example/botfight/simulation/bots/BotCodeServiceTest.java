package com.example.botfight.simulation.bots;

import static org.assertj.core.api.Assertions.assertThat;

import org.junit.jupiter.api.Test;
import tools.jackson.databind.json.JsonMapper;

class BotCodeServiceTest {
    private final BotCodeService service = new BotCodeService();
    private final JsonMapper jsonMapper = JsonMapper.builder().build();

    @Test
    void readsOnlyTheSubmittedAbilityArrayAndServerGrantedAbilities() throws Exception {
        var brain = jsonMapper.readTree("""
                {"loadout":{"abilities":[7,13]}}
                """);

        assertThat(service.readAbilities(brain))
                .containsExactly(19, 20, 34, 7, 13);
    }

    @Test
    void missingLegacyLoadoutDoesNotGrantClassAbilities() throws Exception {
        assertThat(service.readAbilities(jsonMapper.readTree("{}")))
                .containsExactly(19, 20, 34);
    }
}
