package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import org.junit.jupiter.api.Test;

class AbilityExecutionPayloadTest {
    @Test
    void joinsCanonicalActionToAuthoritativeContractAndDefinition() {
        AbilityExecutionPayload payload = AbilityExecutionPayload.from(
                new Action(0, 0, 0, 19, 500, 400, "absolute", "north", null));

        assertThat(payload.actionId()).isEqualTo(19);
        assertThat(payload.abilityId()).isEqualTo(19);
        assertThat(payload.definition().activationModel())
                .isEqualTo(com.example.botfight.simulation.gameconfig.Abilities.ActivationModel.CONFIGURED);
        assertThat(payload.contract().execution().movement()).isNotNull();
        assertThat(payload.targetX()).isEqualTo(500);
        assertThat(payload.movementDirection()).isEqualTo("north");
    }

    @Test
    void rejectsNonCanonicalActionValuesAtThePayloadBoundary() {
        assertThat(AbilityExecutionPayload.from(
                new Action(0, 0, 0, null, 500, 400, null, null, null))).isNull();
    }
}
