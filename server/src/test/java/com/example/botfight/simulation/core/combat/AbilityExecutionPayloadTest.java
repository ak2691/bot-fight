package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.core.orchestration.Bot;
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
        assertThat(payload.contract().has(AbilityContracts.MoveVerb.class)).isTrue();
        assertThat(payload.targetX()).isEqualTo(500);
        assertThat(payload.movementDirection()).isEqualTo("north");
    }

    @Test
    void rejectsNonCanonicalActionValuesAtThePayloadBoundary() {
        assertThat(AbilityExecutionPayload.from(
                new Action(0, 0, 0, null, 500, 400, null, null, null))).isNull();
    }

    /** Slash with its hit verb firing from {@code origin}. */
    private static AbilityContracts.AbilityContract slashFiringFrom(AbilityContracts.Spawn origin) {
        AbilityContracts.AbilityContract base = AbilityContracts.forAbility(1);
        AbilityContracts.HitVerb hit = base.hitVerbs().getFirst();
        return new AbilityContracts.AbilityContract(base.abilityId(), base.activation(),
                java.util.List.of(new AbilityContracts.HitVerb(hit.hitbox(), hit.targets(), hit.effects(),
                        hit.nearestOnly(), hit.oncePerTarget(), hit.aim(), origin, hit.knockbackDirection(),
                        hit.pullDirection(), hit.visual())),
                java.util.Map.of(), null);
    }

    @Test
    void resolvesAHitVerbOriginRelativeToTheOwner() {
        AbilityExecutionPayload payload = new AbilityExecutionPayload(
                1, 1, Abilities.definition(1),
                slashFiringFrom(new AbilityContracts.Spawn(10, 20, false, 180,
                        AbilityContracts.RotationSpace.OWNER, 0, 500, 400)),
                Double.NaN, Double.NaN, null, null, null,
                Double.NaN, Double.NaN, Double.NaN);
        Bot bot = new Bot();
        bot.x = 100;
        bot.y = 100;
        bot.rotation = 90;

        assertThat(payload.pose(bot).x()).isEqualTo(120d);
        assertThat(payload.pose(bot).y()).isEqualTo(110d);
        assertThat(payload.pose(bot).rotation()).isEqualTo(270d);

        AbilityExecutionPayload worldPayload = new AbilityExecutionPayload(
                1, 1, Abilities.definition(1),
                slashFiringFrom(new AbilityContracts.Spawn(10, 20, false, -90,
                        AbilityContracts.RotationSpace.WORLD, 0, 500, 400)),
                Double.NaN, Double.NaN, null, null, null,
                Double.NaN, Double.NaN, Double.NaN);
        assertThat(worldPayload.pose(bot).rotation()).isEqualTo(-90d);

        assertThat(new AbilityContracts.Spawn(0, 0, false, 900,
                AbilityContracts.RotationSpace.OWNER, 0, 500, 400).rotation()).isEqualTo(360d);
        assertThat(new AbilityContracts.Spawn(0, 0, false, -900,
                AbilityContracts.RotationSpace.OWNER, 0, 500, 400).rotation()).isEqualTo(-360d);
    }
}
