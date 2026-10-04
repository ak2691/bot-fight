package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.match.MatchPlaybackDTO;
import com.example.botfight.DTO.match.MatchReplayDTO;
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
import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.gameconfig.CompactAbilityCode;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

/** Authoritative weapon timing, damage and knockback; mirrors frontend WeaponParity.test.js. */
class WeaponSimulationParityTest {
    private record Weapon(int id, String name, int damage, int windupMs, int activeMs, int cooldownMs,
                          double knockback) {}

    private static final List<Weapon> WEAPONS = List.of(
            new Weapon(1, "Slash", 8, 0, 300, 500, 0),
            new Weapon(35, "Thrust", 10, 100, 300, 700, 0),
            new Weapon(36, "Cleave", 15, 500, 300, 700, 0),
            new Weapon(37, "Smash", 11, 300, 300, 700, 120));

    private static final double START_HP = 150;
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

    private JsonNode alwaysBrain(int abilityId) {
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":[%d]},
                     "roots":[{"priority":1,"branches":[{"priority":1,"branchType":"if",
                       "conditions":[{"type":"always"}],"actions":[{"action":%d}],"children":[]}]}]}
                    """.formatted(abilityId, abilityId));
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

    private MatchPlaybackDTO fight(Weapon weapon, double defenderOffsetX, int durationMs) {
        return service.simulate(new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("weapon".getBytes()),
                DuelSimulationService.DUEL_RULESET_VERSION, 123L,
                new DuelArenaRequest(1600, 1600, durationMs),
                List.of(request("attacker", 1, 400, 90.0, alwaysBrain(weapon.id())),
                        request("defender", 2, 400 + defenderOffsetX, 270.0, idleBrain()))));
    }

    private static DuelBotRequest request(String id, int slot, double x, double rotation, JsonNode brain) {
        return new DuelBotRequest(UUID.nameUUIDFromBytes(id.getBytes()), id, slot, x, 400, rotation, 60,
                "custom", brain, null, slot);
    }

    private static MatchPlaybackDTO.BotStateDTO defender(MatchPlaybackDTO.ReplayFrameDTO frame) {
        return frame.bots().stream().filter(bot -> bot.slot() == 2).findFirst().orElseThrow();
    }

    private static List<MatchPlaybackDTO.ReplayFrameDTO> hitFrames(MatchPlaybackDTO result) {
        double[] previous = {START_HP};
        return result.frames().stream().filter(frame -> {
            double hp = defender(frame).hp();
            boolean hit = hp < previous[0];
            previous[0] = hp;
            return hit;
        }).toList();
    }

    @Test
    void timingMatchesTheWeaponTable() {
        for (Weapon weapon : WEAPONS) {
            Abilities.AbilityDefinition definition = Abilities.definition(weapon.id());
            assertThat(definition.windupMs()).as(weapon.name() + " windup").isEqualTo(weapon.windupMs());
            assertThat(definition.activeMs()).as(weapon.name() + " active").isEqualTo(weapon.activeMs());
            assertThat(definition.cooldownMs()).as(weapon.name() + " cooldown").isEqualTo(weapon.cooldownMs());
            assertThat(definition.charges()).as(weapon.name() + " has no ammo").isZero();
        }
    }

    @Test
    void damageAndFirstHitTimeFollowTheWindup() {
        for (Weapon weapon : WEAPONS) {
            List<MatchPlaybackDTO.ReplayFrameDTO> hits = hitFrames(fight(weapon, 60, 3_000));
            assertThat(hits).as(weapon.name() + " lands hits").isNotEmpty();
            double damage = START_HP - defender(hits.getFirst()).hp();
            assertThat(damage).as(weapon.name() + " damage").isEqualTo(weapon.damage());
            int stepMs = 100;
            int expectedFirstHit = Math.max(stepMs, (int) Math.ceil(weapon.windupMs() / (double) stepMs) * stepMs);
            assertThat(hits.getFirst().elapsedMs()).as(weapon.name() + " first hit").isEqualTo(expectedFirstHit);
            if (hits.size() > 1) {
                // Cooldown starts after the active phase: active + cooldown before the next cycle.
                assertThat(hits.get(1).elapsedMs() - hits.getFirst().elapsedMs())
                        .as(weapon.name() + " cycle")
                        .isGreaterThanOrEqualTo(weapon.activeMs() + weapon.cooldownMs());
            }
        }
    }

    @Test
    void targetsJustOutsideEffectiveReachTakeNoDamage() {
        for (Weapon weapon : WEAPONS) {
            AbilityContracts.Hitbox hitbox = AbilityContracts.forAbility(weapon.id()).phases().getFirst().hitbox();
            double length = "arc".equals(hitbox.shape()) ? hitbox.range() : hitbox.length();
            double reach = length + 30;
            assertThat(hitFrames(fight(weapon, reach - 1, 1_500))).as(weapon.name() + " inside").isNotEmpty();
            assertThat(hitFrames(fight(weapon, reach + 1, 1_500))).as(weapon.name() + " outside").isEmpty();
        }
    }

    @Test
    void smashPushesTheTargetAwayAndOtherWeaponsDoNot() {
        for (Weapon weapon : WEAPONS) {
            MatchPlaybackDTO result = fight(weapon, 60, 1_500);
            MatchPlaybackDTO.ReplayFrameDTO first = hitFrames(result).getFirst();
            assertThat(defender(first).x()).as(weapon.name() + " x after first hit")
                    .isEqualTo(460 + weapon.knockback());
            assertThat(defender(first).y()).as(weapon.name() + " y").isEqualTo(400);
        }
    }

    @Test
    void weaponsHaveCompactLoadoutCodes() {
        assertThat(CompactAbilityCode.codeForId(35)).isEqualTo("x");
        assertThat(CompactAbilityCode.codeForId(36)).isEqualTo("y");
        assertThat(CompactAbilityCode.codeForId(37)).isEqualTo("z");
        assertThat(CompactAbilityCode.idForCode("x")).isEqualTo(35);
        assertThat(CompactAbilityCode.idForCode("y")).isEqualTo(36);
        assertThat(CompactAbilityCode.idForCode("z")).isEqualTo(37);
    }

    @Test
    void compactReplayCarriesWindupStateForTelegraphs() {
        for (Weapon weapon : WEAPONS.stream().filter(w -> w.windupMs() > 100).toList()) {
            MatchPlaybackDTO playback = fight(weapon, 200, 1_500);
            MatchReplayDTO replay = MatchReplayDTO.from(playback);
            assertThat(replay.frames()).hasSameSizeAs(playback.frames());
            boolean sawWindup = false;
            for (int index = 0; index < playback.frames().size(); index += 1) {
                MatchPlaybackDTO.BotStateDTO full = playback.frames().get(index).bots().stream()
                        .filter(bot -> bot.slot() == 1).findFirst().orElseThrow();
                MatchReplayDTO.ReplayBotDTO compact = replay.frames().get(index).bots().stream()
                        .filter(bot -> bot.slot() == 1).findFirst().orElseThrow();
                assertThat(compact.preparingAbility()).isEqualTo(full.preparingAbility());
                if (full.preparingAbility() != null && full.preparingMs() > 0) {
                    sawWindup = true;
                    assertThat(full.preparingAbility()).isEqualTo(weapon.id());
                    assertThat(compact.preparingMs()).isEqualTo(full.preparingMs());
                    assertThat(full.preparingMs()).isLessThan(weapon.windupMs());
                }
            }
            assertThat(sawWindup).as(weapon.name() + " wind-up frames").isTrue();
        }
    }
}
