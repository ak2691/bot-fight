package com.example.botfight.simulation;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.simulation.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.bot.ConditionEvaluationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.service.LegacyAbilityPayloadMigration;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Disabled;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class DuelSimulationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final DuelSimulationService service = newService();
    private final JsonNode idleBrain = brain("[]");

    private DuelSimulationService newService() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new com.example.botfight.simulation.bot.BotCodeService());
        ProjectileSimulationService projectileSimulationService = new ProjectileSimulationService(botStateService);
        ActionExecutionService actionExecutionService = new ActionExecutionService(botStateService, projectileSimulationService);
        ConditionResolutionService conditionResolutionService = new ConditionResolutionService(new ConditionEvaluationService(), actionExecutionService);
        return new DuelSimulationService(conditionResolutionService, new ReplayMappingService(),
                botStateService, projectileSimulationService, actionExecutionService);
    }

    @Test
    void producesDrawWhenNeitherBrainChoosesWinningAction() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(200),
                bot("bot-1", "One", 1, 100, 400, idleBrain),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.result()).isEqualTo("DRAW");
        assertThat(result.winnerUserId()).isNull();
    }

    @Test
    void customLoadoutUsesAllocatedHpAndArenaHasNoFixtures() throws Exception {
        JsonNode loadoutBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":["swing"],"statPoints":{"maxHp":2,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                 "roots":[]}
                """);
        MatchPlaybackDTO result = service.simulate(request(
                new DuelArenaRequest(1000, 1000, 0),
                bot("bot-1", "One", 1, 100, 500, "custom", loadoutBrain),
                bot("bot-2", "Two", 2, 900, 500, "custom", loadoutBrain)));

        assertThat(result.initialState().entities()).isEmpty();
        assertThat(result.initialState().bots()).extracting(MatchPlaybackDTO.BotStateDTO::hp).containsOnly(120);
        assertThat(result.result()).isEqualTo("DRAW");
    }

    @Test
    void botKnockoutIsTheOnlyWinningCondition() throws Exception {
        JsonNode attackerBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":["swing"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":4,"attackSpeed":0}},
                 "roots":[{"createdOrder":0,"branches":[{"createdOrder":0,"branchType":"if","conditions":[{"type":"always"}],"actions":[{"action":"swing"}],"children":[]}]}]}
                """);
        JsonNode defenderBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":["block"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                 "roots":[]}
                """);
        MatchPlaybackDTO result = service.simulate(request(
                new DuelArenaRequest(1000, 1000, 10_000),
                bot("bot-1", "One", 1, 480, 500, "custom", attackerBrain),
                bot("bot-2", "Two", 2, 520, 500, "custom", defenderBrain)));

        assertThat(result.result()).isEqualTo("BOT_WIN");
        assertThat(result.winnerUserId()).isEqualTo(UUID.nameUUIDFromBytes("bot-1".getBytes()));
    }

    @Test
    void lowerPriorityNumberOverridesEarlierHigherNumberMovement() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_walk","movementMode":"target","movementDirection":"away"},
                          {"priority":5,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_walk","movementMode":"target","movementDirection":"toward"}
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x() - 100).isEqualTo(-4.0);
    }

    @Test
    void higherPriorityHpRuleStaysSelectedOverLowerPriorityDistanceEngage() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"expression","left":"my.hp","comparator":"gt","right":{"type":"number","value":50}}],"action":"move_walk","movementMode":"target","movementDirection":"away"},
                          {"priority":2,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":10}}],"action":"move_walk","movementMode":"target","movementDirection":"toward"}
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x() - 100).isEqualTo(-4.0);
    }

    @Test
    void targetRelativeRetreatUsesOppositeFacingWhenBotsOverlapExactly() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 500, 500, brain("""
                        [{"priority":1,"conditions":[{"type":"always"}],"action":"move_walk","movementMode":"target","movementDirection":"away"}]
                        """)),
                bot("bot-2", "Two", 2, 500, 500, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isLessThan(500);
        assertThat(result.frames().getFirst().bots().getFirst().y()).isEqualTo(500);
    }

    @Test
    void expressionConditionsSelectBlocksFromStateVariables() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"target.distance",
                              "comparator":"gt",
                              "right":{"type":"variable","value":"my.hp"}
                            }],
                            "action":"move_walk","movementMode":"target","movementDirection":"toward"
                          }
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void expressionConditionsCompareBooleanVariables() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"my.selectedAbilityReady",
                              "ability":"lock_on",
                              "comparator":"eq",
                              "right":{"type":"boolean","value":true}
                            }],
                            "action":"lock_on"
                          }
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isEqualTo(100.0);
        assertThat(result.frames().getFirst().bots().getFirst().rotation()).isEqualTo(90.0);
        assertThat(result.frames()).anySatisfy(frame ->
                    assertThat(frame.bots().getFirst().preparingAbility()).isEqualTo(20));
        assertThat(result.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().rotation()).isEqualTo(90.0));
    }

    @Test
    void everyBotReceivesMicroDashAndLockOnAsStandardAbilities() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, idleBrain),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.initialState().bots())
                .allSatisfy(bot -> assertThat(bot.abilities()).contains(19, 20));
    }

    @Test
    void microDashStartsWithOneChargeAndLockOnRotatesWithoutMovementOrDamage() {
        MatchPlaybackDTO microDash = service.simulate(request(
                arena(100),
                bot("micro", "Micro", 1, 100, 700, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash","movementMode":"absolute","movementDirection":"north"}]
                        """)),
                bot("micro-target", "Target", 2, 700, 400, idleBrain)));
        var microFrame = microDash.frames().getFirst().bots().getFirst();

        assertThat(microFrame.y()).isLessThan(700);
        assertThat(microFrame.abilityCharges()).containsEntry(19, 0);
        assertThat(microFrame.abilityCooldowns()).containsEntry(19, 1500);

        MatchPlaybackDTO lockOn = service.simulate(request(
                arena(10_200),
                botWithRotation("lock", "Lock", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"always"}],"action":"lock_on"}]
                        """), 0),
                bot("lock-target", "Target", 2, 700, 400, idleBrain)));
        var lockFrame = lockOn.frames().stream()
                .map(frame -> frame.bots().getFirst())
                .filter(frame -> Integer.valueOf(10_000).equals(frame.abilityCooldowns().get(20)))
                .findFirst()
                .orElseThrow();

        assertThat(lockFrame.x()).isEqualTo(100);
        assertThat(lockFrame.y()).isEqualTo(400);
        assertThat(lockFrame.hp()).isEqualTo(lockOn.initialState().bots().getFirst().hp());
        assertThat(lockFrame.rotation()).isEqualTo(90);
        assertThat(lockFrame.abilityCooldowns()).containsEntry(20, 10_000);
        assertThat(lockFrame.abilityActiveMs()).containsEntry(20, 200);
        assertThat(lockOn.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().abilityCooldowns().get(20)).isEqualTo(100));
        assertThat(lockOn.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().preparingAbility()).isEqualTo(20));
    }

    @Test
    void expressionConditionsReadAnActiveStatusEffectOnTheObservedBot() {
        JsonNode attacker = customBrain("[\"concussive_shot\"]", """
                [{"conditions":[{"type":"always"}],"action":"concussive_shot"}]
                """);
        JsonNode statusAwareDefender = customBrain("[]", """
                [{"conditions":[{"type":"expression","left":"my.selectedStatusEffectActive","statusEffect":"slow","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(1_500),
                bot("status-attacker", "Attacker", 1, 100, 400, "custom", attacker),
                bot("status-defender", "Defender", 2, 200, 400, "custom", statusAwareDefender)));

        assertThat(result.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().abilityActiveMs()).containsEntry(9, 300));
        assertThat(result.frames().getLast().bots().get(1).x()).isLessThan(200);
    }

    @Test
    void expressionConditionsCompareStatusEffectDurationInSeconds() {
        JsonNode attacker = customBrain("[\"concussive_shot\"]", """
                [{"conditions":[{"type":"always"}],"action":"concussive_shot"}]
                """);
        JsonNode durationAwareDefender = customBrain("[]", """
                [{"conditions":[{"type":"expression","left":"my.selectedStatusEffectDurationMs","statusEffect":"slow","comparator":"gt","right":{"type":"number","value":0.5}}],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(1_500),
                bot("duration-attacker", "Attacker", 1, 100, 400, "custom", attacker),
                bot("duration-defender", "Defender", 2, 200, 400, "custom", durationAwareDefender)));

        assertThat(result.frames().getLast().bots().get(1).x()).isLessThan(200);
    }

    @Test
    void shortestTargetBearingDifferenceIsNeverNegative() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 500, 500, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"target.relativeBearing",
                              "comparator":"lt",
                              "right":{"type":"number","value":10}
                            }],
                            "action":"move_walk","movementMode":"absolute","movementDirection":"west"
                          }
                        ]
                        """)),
                bot("bot-2", "Two", 2, 500, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isEqualTo(500);
    }

    @Test
    void conditionJoinsCanUseOrAndCoordinates() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[
                              {
                                "type":"expression",
                                "left":"my.x",
                                "comparator":"gt",
                                "right":{"type":"number","value":500}
                              },
                              {
                                "type":"expression",
                                "join":"or",
                                "left":"opponent.y",
                                "comparator":"eq",
                                "right":{"type":"number","value":400}
                              }
                            ],
                            "action":"move_walk","movementMode":"target","movementDirection":"toward"
                          }
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void positionExpressionVariablesReadPlayerAndOpponentCoordinates() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"my.x",
                              "comparator":"lt",
                              "right":{"type":"number","value":150}
                            }],
                            "action":"move_walk","movementMode":"absolute","movementDirection":"east"
                          },
                          {
                            "priority":2,
                            "conditions":[{
                              "type":"expression",
                              "left":"opponent.y",
                              "comparator":"gt",
                              "right":{"type":"number","value":350}
                            }],
                            "action":"move_walk","movementMode":"absolute","movementDirection":"north"
                          }
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isGreaterThan(100);
        assertThat(result.frames().getFirst().bots().getFirst().y()).isEqualTo(400.0);
    }

    @Test
    void samePriorityMoveAndLockOnBlocksCombineActionHeads() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":3,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_walk","movementMode":"target","movementDirection":"toward"},
                          {"priority":3,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"lock_on"}
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x() - 100).isEqualTo(4.0);
    }

    @Test
    void rangedFireGunUsesFacingRayAndLinearFalloff() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("ranged", "Ranged", 1, 100, 400, "custom", customBrain("[\"fire_gun\"]", """
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"fire_gun","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"fire_gun"}]
                        """)),
                bot("target", "Target", 2, 300, 400, idleBrain)));
        assertThat(result.frames().getFirst().bots().get(1).hp()).isEqualTo(87);
        assertThat(result.frames().getFirst().bots().getFirst().abilityActiveMs())
                .containsKey(3);
        assertThat(result.frames().getFirst().bots().getFirst().abilityCooldowns())
                .containsEntry(3, 1_000);
        assertThat(result.frames().getFirst().bots().getFirst().abilityCharges())
                .containsEntry(3, 9);
    }

    @Test
    void grenadeUsesGenericAbilityStateAndArenaEntityReplay() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("grenadier", "Grenadier", 1, 100, 400, "custom", customBrain("[\"throw_grenade\"]", """
                        [{"conditions":[{"type":"always"}],"action":"throw_grenade"}]
                        """)),
                bot("target", "Target", 2, 190, 400, idleBrain)));

        var attacker = result.frames().getFirst().bots().getFirst();
        assertThat(attacker.abilityCooldowns()).containsEntry(4, 12_000);
        assertThat(result.frames().getFirst().entities())
                .anySatisfy(entity -> assertThat(entity.type()).isEqualTo("grenadeExplosion"));
        assertThat(result.frames().getFirst().bots().get(1).hp()).isLessThan(100);
    }

    @Test
    void windBurstReplayFramesContainAuthoritativeNinetyUnitKnockback() {
        JsonNode windBurstBrain = customBrain("[\"wind_burst\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"wind_burst"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(2_000),
                bot("wind-caster", "Caster", 1, 400, 500, "custom", windBurstBrain),
                bot("wind-target", "Target", 2, 520, 500, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames())
                .anySatisfy(frame -> assertThat(frame.bots().get(1).x()).isEqualTo(610.0));
        assertThat(result.frames())
                .filteredOn(frame -> frame.bots().get(1).x() == 610.0)
                .allSatisfy(frame -> assertThat(frame.bots().get(1).hp()).isEqualTo(85));
    }

    private DuelSimulationRequest request(
            DuelArenaRequest arena,
            DuelBotRequest first,
            DuelBotRequest second) {
        return new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("match".getBytes()),
                DuelSimulationService.DUEL_RULESET_VERSION,
                123L,
                arena,
                List.of(first, second));
    }

    private DuelArenaRequest arena(int durationMs) {
        return new DuelArenaRequest(1600, 1600, durationMs);
    }

    private DuelBotRequest bot(String id, String username, int slot, double x, double y, JsonNode brain) {
        return bot(id, username, slot, x, y, "melee", brain);
    }

    private DuelBotRequest bot(String id, String username, int slot, double x, double y, String selectedLoadout, JsonNode brain) {
        return botWithRotation(id, username, slot, x, y, selectedLoadout, brain, slot == 1 ? 90.0 : 270.0);
    }

    private DuelBotRequest botWithRotation(String id, String username, int slot, double x, double y, String selectedLoadout, JsonNode brain, double rotation) {
        return new DuelBotRequest(
                UUID.nameUUIDFromBytes(id.getBytes()),
                username,
                slot,
                x,
                y,
                rotation,
                60,
                selectedLoadout,
                LegacyAbilityPayloadMigration.normalize(brain));
    }

    private static double[] positionAtBearing(double originX, double originY, double distance, double bearingDegrees) {
        double radians = Math.toRadians(bearingDegrees);
        return new double[] {
                originX + Math.sin(radians) * distance,
                originY - Math.cos(radians) * distance,
        };
    }

    private JsonNode brain(String branchesJson) {
        return treeBrain("[]", branchesJson);
    }

    @Test
    void targetDirectionSupportsAReversedRangeThatWrapsAroundTheCircle() {
        JsonNode directionBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"target.bearingFromMe","comparator":"range","target":"opponent","right":{"type":"range","min":32,"max":30}}],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("walker", "Walker", 1, 500, 400, "custom", directionBrain),
                bot("target", "Target", 2, 400, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isLessThan(500);
    }

    @Test
    void sharedAbilityHeadFallsThroughBetweenFireballAndConcussiveShot() {
        JsonNode idle = customBrain("[]", "[]");
        JsonNode fireballFirst = customBrain("[\"shoot_fireball\",\"concussive_shot\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"shoot_fireball"},
                  {"priority":2,"conditions":[{"type":"always"}],"action":"concussive_shot"}
                ]
                """);
        MatchPlaybackDTO afterFireball = service.simulate(request(
                arena(800),
                bot("fireball-first", "One", 1, 100, 400, "custom", fireballFirst),
                bot("idle-1", "Two", 2, 700, 400, "custom", idle)));

        assertThat(afterFireball.frames().getFirst().bots().getFirst().abilityCharges())
                .containsEntry(5, 3);
        assertThat(afterFireball.frames().getFirst().bots().getFirst().abilityCooldowns())
                .containsEntry(5, 667);
        assertThat(afterFireball.frames()).anyMatch(frame -> Integer.valueOf(9).equals(frame.bots().getFirst().preparingAbility()));

        JsonNode concussiveFirst = customBrain("[\"shoot_fireball\",\"concussive_shot\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"concussive_shot"},
                  {"priority":2,"conditions":[{"type":"always"}],"action":"shoot_fireball"}
                ]
                """);
        MatchPlaybackDTO afterConcussive = service.simulate(request(
                arena(800),
                bot("concussive-first", "One", 1, 100, 400, "custom", concussiveFirst),
                bot("idle-2", "Two", 2, 700, 400, "custom", idle)));

        assertThat(afterConcussive.frames()).anyMatch(frame -> Integer.valueOf(9).equals(frame.bots().getFirst().preparingAbility()));
        assertThat(afterConcussive.frames().getLast().bots().getFirst().abilityCharges())
                .containsEntry(5, 3);
    }

    @Test
    void abilityPreparationDoesNotInterruptMovementOrRotation() {
        JsonNode castingBrain = customBrain("[\"concussive_shot\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"move_walk","movementMode":"absolute","movementDirection":"east"},
                  {"priority":2,"conditions":[{"type":"always"}],"action":"rotate_toward_enemy","actionTarget":"opponent"},
                  {"priority":3,"conditions":[{"type":"always"}],"action":"concussive_shot"}
                ]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(200),
                botWithRotation("casting", "Casting", 1, 100, 400, "custom", castingBrain, 0.0),
                bot("target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        var first = result.frames().getFirst().bots().getFirst();
        var second = result.frames().get(1).bots().getFirst();
        assertThat(first.preparingAbility()).isEqualTo(9);
        assertThat(first.x()).isGreaterThan(100.0);
        assertThat(first.rotation()).isEqualTo(12.0);
        assertThat(second.x()).isGreaterThan(first.x());
        assertThat(second.rotation()).isEqualTo(24.0);
        assertThat(second.preparingAbility()).isEqualTo(9);
    }

    @Test
    void authoritativeSimulatorExecutesAndClampsCustomVariableNodes() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":99990}],
                  "roots":[
                    {"createdOrder":0,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"always"}],"actions":[{"action":"variable","variableId":"custom.counter","operation":"add","value":50}],"children":[]}]},
                    {"createdOrder":1,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"expression","left":"custom.counter","comparator":"eq","right":{"type":"number","value":99999}}],"actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":"east"}],"children":[]}]}
                  ]
                }
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(400),
                bot("variables", "Variables", 1, 100, 400, "custom", variableBrain),
                bot("idle", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void authoritativeSimulatorAppliesModuloToCustomIntegerVariables() throws Exception {
        JsonNode moduloBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":-10}],
                  "roots":[{"branches":[{"branchType":"if","conditions":[
                    {"type":"expression","left":"custom.counter","comparator":"modulo",
                     "modulo":{"divisor":-3,"comparator":"eq"},"right":{"type":"number","value":-1}}
                  ],"actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":"east"}],"children":[]}]}]
                }
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(400),
                bot("modulo", "Modulo", 1, 100, 400, "custom", moduloBrain),
                bot("idle-modulo", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void authoritativeSimulatorTreatsModuloByZeroAsFalseInsideOr() throws Exception {
        JsonNode moduloBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[{"branchType":"if","conditions":[
                    {"type":"expression","left":"my.hp","comparator":"modulo",
                     "modulo":{"divisor":0,"comparator":"eq"},"right":{"type":"number","value":0}},
                    {"type":"always","join":"or"}
                  ],"actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":"east"}],"children":[]}]}]
                }
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(400),
                bot("zero-modulo", "Modulo", 1, 100, 400, "custom", moduloBrain),
                bot("idle-zero-modulo", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void authoritativeSimulatorFloorsFractionalModuloOperands() throws Exception {
        JsonNode moduloBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[{"branchType":"if","conditions":[
                    {"type":"expression","left":"my.x","comparator":"modulo",
                     "modulo":{"divisor":3.5,"comparator":"eq"},"right":{"type":"number","value":1.5}}
                  ],"actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":"east"}],"children":[]}]}]
                }
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(400),
                bot("fractional-modulo", "Modulo", 1, 100.5, 400, "custom", moduloBrain),
                bot("idle-fractional-modulo", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().bots().getFirst().x()).isGreaterThan(100.5);
    }

    @Test
    void authoritativeSimulatorActivatesAbilityFromIncrementedCustomVariable() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["swing"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                  "roots":[
                    {"createdOrder":0,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"always"}],"actions":[{"action":"variable","variableId":"custom.counter","terms":[{"operator":"add","operand":{"type":"number","value":1}}]}],"children":[]}]},
                    {"createdOrder":1,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"expression","left":"custom.counter","comparator":"gte","right":{"type":"number","value":2}}],"actions":[{"action":"swing"}],"children":[]}]}
                  ]
                }
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(1_000),
                bot("variables-ability", "Variables", 1, 100, 400, "custom", variableBrain),
                bot("idle-ability", "Idle", 2, 180, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).anyMatch(frame -> Integer.valueOf(1).equals(frame.bots().getFirst().triggeredAbility()));
        assertThat(result.frames().getLast().bots().get(1).hp()).isLessThan(100);
    }

    @Test
    void authoritativeSimulatorExposesElapsedMatchSeconds() {
        JsonNode timedBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"match.elapsedSeconds","comparator":"gte","right":{"type":"number","value":0.2}}],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(500),
                bot("timer", "Timer", 1, 500, 400, "custom", timedBrain),
                bot("idle-timer", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().bots().getFirst().x()).isLessThan(500);
    }

    private JsonNode customBrain(String abilitiesJson, String branchesJson) {
        return treeBrain(abilitiesJson, branchesJson);
    }

    private JsonNode treeBrain(String abilitiesJson, String branchesJson) {
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":%s,"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},"roots":[{"createdOrder":0,"branches":%s}]}
                    """.formatted(abilitiesJson, branchesJson));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
