package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Authoritative Sniper and Fireball rework; mirrors the frontend SniperFireballParity tests. */
class SniperFireballParityTest {
    private static final double START_HP = 300;
    private final JsonMapper jsonMapper = new JsonMapper();
    private final DuelSimulationService service = newService();

    private static DuelSimulationService newService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new BotCodeService());
        ActionExecutionService actions = new ActionExecutionService(botStateService);
        return new DuelSimulationService(
                new ConditionResolutionService(new ConditionEvaluationService(), actions),
                new ReplayMappingService(), botStateService, actions);
    }

    private JsonNode brain(int abilityId, boolean faceOpponent) {
        String face = faceOpponent ? "{\"action\":\"rotate_toward_enemy\",\"selectable\":\"opponent\"}," : "";
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":[%d]},
                     "roots":[{"priority":1,"branches":[{"priority":1,"branchType":"if",
                       "conditions":[{"type":"always"}],"actions":[%s{"action":%d}],"children":[]}]}]}
                    """.formatted(abilityId, face, abilityId));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private JsonNode idleBrain() {
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":[]},"roots":[]}
                    """);
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private MatchPlaybackDTO fight(JsonNode attackerBrain, double attackerRotation,
                                   double defenderX, double defenderY, int durationMs) {
        return service.simulate(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("sniper".getBytes()),
                DuelSimulationService.DUEL_RULESET_VERSION, 7L,
                new DuelArenaRequest(1600, 1600, durationMs),
                List.of(new DuelBotRequest(UUID.nameUUIDFromBytes("a".getBytes()), "a", 1, 100, 400,
                                attackerRotation, 60, "custom", attackerBrain, null, 1),
                        new DuelBotRequest(UUID.nameUUIDFromBytes("d".getBytes()), "d", 2, defenderX, defenderY,
                                270.0, 60, "custom", idleBrain(), null, 2))));
    }

    private static double defenderHpAtEnd(MatchPlaybackDTO result) {
        return result.frames().getLast().bots().stream().filter(bot -> bot.slot() == 2)
                .findFirst().orElseThrow().hp();
    }

    @Test
    void contractsMatchTheReworkTable() {
        AbilityContracts.AbilityPhase sniper = AbilityContracts.forAbility(3).phases().getFirst();
        assertThat(sniper.hitbox().range()).isEqualTo(1200d);
        assertThat(sniper.hitbox().width()).isEqualTo(6d);
        assertThat(sniper.effects().getFirst().amount()).isEqualTo(40d);
        assertThat(sniper.effects().getFirst().falloff()).isNull();

        AbilityContracts.AbilityPhase fireball = AbilityContracts.forAbility(5).phases().getFirst();
        assertThat(fireball.hitbox().width()).isEqualTo(64d);
        assertThat(fireball.hitbox().length()).isEqualTo(64d);
        assertThat(fireball.effects().getFirst().amount()).isEqualTo(20d);
        assertThat(fireball.visual().visualSize()).isEqualTo(60d);
        assertThat(AbilityContracts.forAbility(5).lifetime().duration()).isEqualTo(1_400);
    }

    @Test
    void sniperHitsAtMaxRangeAndMissesBeyondIt() {
        JsonNode sniper = brain(3, false);
        // Ray range 1200 plus the target radius (30) and half the ray width (3).
        assertThat(defenderHpAtEnd(fight(sniper, 90, 100 + 1_200, 400, 1_100))).isEqualTo(START_HP - 40);
        assertThat(defenderHpAtEnd(fight(sniper, 90, 100 + 1_232, 400, 1_100))).isEqualTo(START_HP - 40);
        assertThat(defenderHpAtEnd(fight(sniper, 90, 100 + 1_234, 400, 1_100))).isEqualTo(START_HP);
        assertThat(defenderHpAtEnd(fight(sniper, 90, 100 + 1_400, 400, 1_100))).isEqualTo(START_HP);
        // Flat damage: no falloff between close and far shots.
        assertThat(defenderHpAtEnd(fight(sniper, 90, 100 + 150, 400, 1_100))).isEqualTo(START_HP - 40);
    }

    @Test
    void sniperRayWidthSetsItsSideEdges() {
        JsonNode sniper = brain(3, false);
        // Target radius 30 + half ray width 3 = 33 lateral reach.
        assertThat(defenderHpAtEnd(fight(sniper, 90, 600, 400 + 32, 1_100))).isEqualTo(START_HP - 40);
        assertThat(defenderHpAtEnd(fight(sniper, 90, 600, 400 + 34, 1_100))).isEqualTo(START_HP);
    }

    @Test
    void sniperAimFollowsRotationDuringTheWindupAndFiresFromTheReleasePose() {
        // The bot starts facing north and the target sits due east. Without turning, the shot misses.
        assertThat(defenderHpAtEnd(fight(brain(3, false), 0, 700, 400, 1_100))).isEqualTo(START_HP);
        // Turning toward the opponent during the 900 ms wind-up aims the release shot.
        MatchPlaybackDTO turning = fight(brain(3, true), 0, 700, 400, 1_100);
        assertThat(defenderHpAtEnd(turning)).isEqualTo(START_HP - 40);
        var firing = turning.frames().stream()
                .filter(frame -> frame.bots().get(1).hp() < START_HP).findFirst().orElseThrow();
        assertThat(firing.elapsedMs()).isEqualTo(900);
        assertThat(firing.bots().getFirst().rotation()).isEqualTo(90.0);
    }

    @Test
    void fireballTravelsAboutSevenHundredUnitsOverItsFourteenHundredMsLife() {
        MatchPlaybackDTO result = fight(brain(5, false), 90, 1_500, 1_000, 2_000);
        List<Double> xs = result.frames().stream()
                .flatMap(frame -> frame.entities().stream())
                .filter(entity -> Integer.valueOf(5).equals(entity.abilityId()))
                .map(MatchPlaybackDTO.ArenaEntityDTO::x).toList();
        assertThat(xs).isNotEmpty();
        double travelled = xs.getLast() - xs.getFirst();
        assertThat(travelled).isBetween(600d, 750d);
        long frames = result.frames().stream()
                .filter(frame -> frame.entities().stream()
                        .anyMatch(entity -> Integer.valueOf(5).equals(entity.abilityId()))).count();
        assertThat(frames).isLessThanOrEqualTo(15);
    }

    @Test
    void fireballHitboxEdgesAreSixtyFourBySixtyFour() {
        JsonNode fireball = brain(5, false);
        // 64x64 box plus the 30-unit target radius gives about 62 units of lateral reach.
        assertThat(defenderHpAtEnd(fight(fireball, 90, 500, 400 + 60, 2_000))).isLessThan(START_HP);
        assertThat(defenderHpAtEnd(fight(fireball, 90, 500, 400 + 66, 2_000))).isEqualTo(START_HP);
        // Damage is 20 plus burn ticks, never the old 15.
        assertThat(START_HP - defenderHpAtEnd(fight(fireball, 90, 500, 400, 600))).isEqualTo(20);
    }
}
