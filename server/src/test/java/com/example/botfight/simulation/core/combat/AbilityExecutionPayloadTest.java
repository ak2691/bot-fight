package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.gameconfig.Abilities;
import org.junit.jupiter.api.Test;

class AbilityExecutionPayloadTest {
    @Test
    void joinsCanonicalActionToAuthoritativeContractAndDefinition() {
        AbilityExecutionPayload payload = AbilityExecutionPayload.from(
                new Action(0, 0, 0, 19, 500, 400, "absolute", "north", null));

        assertThat(payload.actionId()).isEqualTo(19);
        assertThat(payload.abilityId()).isEqualTo(19);
        assertThat(payload.contract().phases().getFirst().movement()).isNotNull();
        assertThat(payload.targetX()).isEqualTo(500);
        assertThat(payload.movementDirection()).isEqualTo("north");
    }

    @Test
    void rejectsNonCanonicalActionValuesAtThePayloadBoundary() {
        assertThat(AbilityExecutionPayload.from(
                new Action(0, 0, 0, null, 500, 400, null, null, null))).isNull();
    }

    @Test
    void resolvesAnAttachedRootSpawnRelativeToTheOwner() {
        AbilityContracts.AbilityContract base = AbilityContracts.forAbility(1);
        AbilityContracts.AbilityContract contract = new AbilityContracts.AbilityContract(
                base.abilityId(), base.entityType(), base.runtimeType(), base.category(),
                new AbilityContracts.Spawn(10, 20, false, 180,
                        AbilityContracts.RotationSpace.OWNER, 0, 500, 400),
                base.selectableOwner(), base.lifetime(), base.initialState(), base.activation(),
                base.phases(), base.abilities());
        AbilityExecutionPayload payload = new AbilityExecutionPayload(
                1, 1, Abilities.definition(1), contract,
                Double.NaN, Double.NaN, null, null, null,
                Double.NaN, Double.NaN, Double.NaN);
        Bot bot = new Bot();
        bot.x = 100;
        bot.y = 100;
        bot.rotation = 90;

        assertThat(payload.pose(bot).x()).isEqualTo(120d);
        assertThat(payload.pose(bot).y()).isEqualTo(110d);
        assertThat(payload.pose(bot).rotation()).isEqualTo(270d);

        AbilityContracts.AbilityContract worldContract = new AbilityContracts.AbilityContract(
                base.abilityId(), base.entityType(), base.runtimeType(), base.category(),
                new AbilityContracts.Spawn(10, 20, false, -90,
                        AbilityContracts.RotationSpace.WORLD, 0, 500, 400),
                base.selectableOwner(), base.lifetime(), base.initialState(), base.activation(),
                base.phases(), base.abilities());
        AbilityExecutionPayload worldPayload = new AbilityExecutionPayload(
                1, 1, Abilities.definition(1), worldContract,
                Double.NaN, Double.NaN, null, null, null,
                Double.NaN, Double.NaN, Double.NaN);
        assertThat(worldPayload.pose(bot).rotation()).isEqualTo(-90d);

        assertThat(new AbilityContracts.Spawn(0, 0, false, 900,
                AbilityContracts.RotationSpace.OWNER, 0, 500, 400).rotation()).isEqualTo(360d);
        assertThat(new AbilityContracts.Spawn(0, 0, false, -900,
                AbilityContracts.RotationSpace.OWNER, 0, 500, 400).rotation()).isEqualTo(-360d);
    }
}
