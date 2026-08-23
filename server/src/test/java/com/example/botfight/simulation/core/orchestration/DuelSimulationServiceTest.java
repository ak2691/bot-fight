package com.example.botfight.simulation.core.orchestration;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.DTO.MatchReplayDTO;
import com.example.botfight.simulation.core.combat.ActionExecutionService;
import com.example.botfight.simulation.core.combat.ProjectileSimulationService;
import com.example.botfight.simulation.core.logic.ConditionResolutionService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelBotRequest;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.core.replay.ReplayMappingService;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.bots.ConditionEvaluationService;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.service.submission.LegacyAbilityPayloadMigration;
import com.example.botfight.simulation.gameconfig.HitStagger;
import java.util.List;
import java.util.Map;
import java.util.Set;
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
        BotStateService botStateService = new BotStateService(catalog, new com.example.botfight.simulation.bots.BotCodeService());
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
    void recordsCompactReplayFramesWithoutFullBotMetadata() throws Exception {
        MatchReplayDTO result = service.simulateCompact(request(
                arena(200),
                bot("compact-1", "One", 1, 100, 400, idleBrain),
                bot("compact-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.initialState().bots()).extracting(MatchReplayDTO.ReplayBotStaticDTO::slot)
                .containsExactly(1, 2);
        assertThat(result.frames()).hasSize(2);
        assertThat(result.frames().getFirst().bots()).extracting(MatchReplayDTO.ReplayBotDTO::slot)
                .containsExactly(1, 2);
        assertThat(result.initialState().bots().getFirst().abilities()).contains(19, 20);
        assertThat(result.initialState().bots().getFirst().abilityCooldowns())
                .containsEntry(19, 0)
                .containsEntry(20, 0);
        String json = jsonMapper.writeValueAsString(result);
        assertThat(json).doesNotContain("userId", "username", "combatLoadout", "abilityCharges");
    }

    @Test
    void compactReplayRetainsGenericAbilityResources() {
        MatchReplayDTO fireGun = service.simulateCompact(request(
                arena(100),
                bot("compact-fire", "Fire", 1, 100, 400, "custom", customBrain("[\"fire_gun\"]", """
                        [{"conditions":[{"type":"always"}],"action":"fire_gun"}]
                        """)),
                bot("compact-target", "Target", 2, 300, 400, "custom", customBrain("[]", "[]"))));
        var fireFrame = fireGun.frames().getFirst().bots().getFirst();

        assertThat(fireFrame.abilityCooldowns()).isNull();
        assertThat(fireFrame.abilityActiveMs()).containsEntry(3, 500);
        assertThat(fireFrame.abilityCharges()).containsEntry(3, 5);

        MatchReplayDTO cooldownOnlyAbilities = service.simulateCompact(request(
                arena(100),
                bot("compact-cooldown-only", "Cooldown", 1, 100, 400, "custom", customBrain(
                        "[\"reactive_armor\",\"hunter_drone\"]", "[]")),
                bot("compact-cooldown-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));
        assertThat(cooldownOnlyAbilities.initialState().bots().getFirst().abilityCharges()).isNull();

        MatchReplayDTO dash = service.simulateCompact(request(
                arena(100),
                bot("compact-dash", "Dash", 1, 100, 700, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash","movementMode":"absolute","movementDirection":"north"}]
                        """)),
                bot("compact-dash-target", "Target", 2, 700, 400, idleBrain)));
        assertThat(dash.frames().getFirst().bots().getFirst().abilityCooldowns()).isNull();

        MatchReplayDTO lockOn = service.simulateCompact(request(
                arena(10_200),
                botWithRotation("compact-lock", "Lock", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"always"}],"action":"lock_on"}]
                        """), 0),
                bot("compact-lock-target", "Target", 2, 700, 400, idleBrain)));
        assertThat(lockOn.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().abilityCooldowns()).containsEntry(20, 9_800));
    }

    @Test
    void customLoadoutUsesDefaultHpAndArenaHasNoFixtures() throws Exception {
        JsonNode loadoutBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":["swing"]},
                 "roots":[]}
                """);
        MatchPlaybackDTO result = service.simulate(request(
                new DuelArenaRequest(1000, 1000, 0),
                bot("bot-1", "One", 1, 100, 500, "custom", loadoutBrain),
                bot("bot-2", "Two", 2, 900, 500, "custom", loadoutBrain)));

        assertThat(result.initialState().entities()).isEmpty();
        assertThat(result.initialState().bots()).extracting(MatchPlaybackDTO.BotStateDTO::hp).containsOnly(150.0);
        assertThat(result.initialState().bots().getFirst().abilityCharges()).doesNotContainKey(2);
        assertThat(result.result()).isEqualTo("DRAW");
    }

    @Test
    void botKnockoutIsTheOnlyWinningCondition() throws Exception {
        JsonNode attackerBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["swing"]},
                 "roots":[{"createdOrder":0,"branches":[{"createdOrder":0,"branchType":"if","conditions":[{"type":"always"}],"actions":[{"action":"swing"}],"children":[]}]}]}
                """);
        JsonNode defenderBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[]},
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
                          {"priority":1,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_walk","movementMode":"target","movementDirection":180},
                          {"priority":5,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_walk","movementMode":"target","movementDirection":0}
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
                          {"priority":1,"conditions":[{"type":"expression","left":"my.hp","comparator":"gt","right":{"type":"number","value":50}}],"action":"move_walk","movementMode":"target","movementDirection":180},
                          {"priority":2,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":10}}],"action":"move_walk","movementMode":"target","movementDirection":0}
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
                        [{"priority":1,"conditions":[{"type":"always"}],"action":"move_walk","movementMode":"target","movementDirection":180}]
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
                            "action":"move_walk","movementMode":"target","movementDirection":0
                          }
                        ]
                        """)),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void targetExistenceAndAgeWaitForAnOpponentSingularityToMature() {
        JsonNode waitingBrain = customBrain("[]", """
                [{"priority":1,"conditions":[
                  {"type":"expression","left":"target.exists","leftTarget":"opponent_singularity_zone","comparator":"eq","right":{"type":"boolean","value":true}},
                  {"type":"expression","left":"target.age","leftTarget":"opponent_singularity_zone","comparator":"gte","right":{"type":"number","value":0.2}}
                ],"action":"move_walk","movementMode":"absolute","movementDirection":"east"}]
                """);
        JsonNode singularityBrain = customBrain("[\"singularity\"]", """
                [{"type":"always","action":"singularity"}]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(300),
                bot("age-reader", "Age Reader", 1, 100, 400, "custom", waitingBrain),
                bot("singularity", "Singularity", 2, 700, 400, "custom", singularityBrain)));

        assertThat(result.frames()).hasSize(3);
        assertThat(result.frames().get(0).bots().getFirst().x()).isEqualTo(100);
        assertThat(result.frames().get(1).bots().getFirst().x()).isEqualTo(100);
        assertThat(result.frames().get(2).bots().getFirst().x()).isNotEqualTo(100.0);
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
    void expressionConditionsReadAbilityActiveStateAndRemainingSeconds() {
        JsonNode activeAwareBrain = customBrain("[\"lock_on\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"lock_on"},
                  {"priority":2,"conditions":[
                    {"type":"expression","left":"my.selectedAbilityActive","ability":"lock_on","comparator":"eq","right":{"type":"boolean","value":true}},
                    {"type":"expression","left":"my.selectedAbilityActiveMs","ability":"lock_on","comparator":"gt","right":{"type":"number","value":0.1}}
                  ],"action":"move_walk","movementMode":"absolute","movementDirection":"east"}
                ]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(800),
                bot("active-aware", "Active", 1, 100, 400, "custom", activeAwareBrain),
                bot("active-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().abilityActiveMs().getOrDefault(20, 0)).isGreaterThan(0));
        assertThat(result.frames().getLast().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void expressionConditionsReadRemainingAbilityPreparationSeconds() {
        JsonNode preparationAwareBrain = customBrain("[\"concussive_shot\"]", """
                [
                  {"priority":1,"conditions":[{"type":"expression","left":"my.selectedAbilityPreparationMs","ability":"concussive_shot","comparator":"gt","right":{"type":"number","value":0.3}}],"action":"move_walk","movementMode":"absolute","movementDirection":"east"},
                  {"priority":2,"conditions":[{"type":"always"}],"action":"concussive_shot"}
                ]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(300),
                bot("preparation-reader", "Reader", 1, 100, 400, "custom", preparationAwareBrain),
                bot("preparation-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        var first = result.frames().getFirst().bots().getFirst();
        var second = result.frames().get(1).bots().getFirst();
        assertThat(first.preparingMs()).isEqualTo(400);
        assertThat(second.preparingMs()).isEqualTo(300);
        assertThat(second.x()).isGreaterThan(first.x());
    }

    @Test
    void abilityPhaseConditionalsTreatActivePreparationAndCooldownAsSeparateStates() {
        GameConfigCatalog catalog = new GameConfigCatalog();
        BotStateService botStateService = new BotStateService(catalog, new com.example.botfight.simulation.bots.BotCodeService());
        ActionExecutionService actionExecutionService = new ActionExecutionService(
                botStateService, new ProjectileSimulationService(botStateService));
        DuelSimulationService.Bot bot = new DuelSimulationService.Bot();
        bot.abilities = Set.of(20);

        bot.abilityActiveMs.put(20, 500);
        bot.abilityCooldowns.put(20, 3000);
        assertThat(actionExecutionService.selectedAbilityReady(bot, 20)).isFalse();
        assertThat(actionExecutionService.selectedAbilityCooldownMs(bot, 20)).isZero();
        assertThat(actionExecutionService.selectedAbilityOnCooldown(bot, 20)).isFalse();

        bot.abilityActiveMs.put(20, 0);
        assertThat(actionExecutionService.selectedAbilityCooldownMs(bot, 20)).isEqualTo(3000);
        assertThat(actionExecutionService.selectedAbilityOnCooldown(bot, 20)).isTrue();
        assertThat(actionExecutionService.selectedAbilityReady(bot, 20)).isFalse();

        bot.abilityCooldowns.put(20, 0);
        bot.preparingAbility = 20;
        bot.preparingMs = 400;
        assertThat(actionExecutionService.selectedAbilityReady(bot, 20)).isFalse();
        assertThat(actionExecutionService.selectedAbilityCooldownMs(bot, 20)).isZero();
        assertThat(actionExecutionService.selectedAbilityOnCooldown(bot, 20)).isFalse();
        assertThat(actionExecutionService.selectedAbilityExecutable(bot, 20)).isTrue();

        bot.preparingAbility = null;
        bot.preparingMs = 0;
        assertThat(actionExecutionService.selectedAbilityReady(bot, 20)).isTrue();
    }

    @Test
    void dashIsBlockedDuringAnotherAbilityActivePhase() {
        JsonNode dashDuringLockOn = customBrain("[\"lock_on\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"lock_on"},
                  {"priority":2,"conditions":[{"type":"expression","left":"my.selectedAbilityActive","ability":"lock_on","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"dash","movementMode":"absolute","movementDirection":"east"}
                ]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(800),
                bot("dash-during-lock", "Dash", 1, 100, 400, "custom", dashDuringLockOn),
                bot("dash-during-lock-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).noneMatch(frame -> Integer.valueOf(19).equals(frame.bots().getFirst().triggeredAbility()));
        assertThat(result.frames()).allSatisfy(frame -> assertThat(frame.bots().getFirst().x()).isEqualTo(100));
    }

    @Test
    void anotherAbilityIsBlockedDuringDashActivePhase() {
        JsonNode abilityDuringDash = customBrain("[\"dash\",\"lock_on\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"dash","movementMode":"absolute","movementDirection":"east"},
                  {"priority":2,"conditions":[{"type":"expression","left":"my.selectedAbilityActive","ability":"dash","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"lock_on"}
                ]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(800),
                bot("ability-during-dash", "Dash", 1, 100, 400, "custom", abilityDuringDash),
                bot("ability-during-dash-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).noneMatch(frame -> Integer.valueOf(20).equals(frame.bots().getFirst().triggeredAbility()));
    }

    @Test
    void everyBotReceivesDashAndLockOnAsStandardAbilities() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("bot-1", "One", 1, 100, 400, idleBrain),
                bot("bot-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.initialState().bots())
                .allSatisfy(bot -> assertThat(bot.abilities()).contains(19, 20));
    }

    @Test
    void dashUsesCooldownWithoutChargesAndLockOnRotatesWithoutMovementOrDamage() {
        MatchPlaybackDTO dash = service.simulate(request(
                arena(100),
                bot("micro", "Micro", 1, 100, 700, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash","movementMode":"absolute","movementDirection":"north"}]
                        """)),
                bot("micro-target", "Target", 2, 700, 400, idleBrain)));
        var dashFrame = dash.frames().getFirst().bots().getFirst();

        assertThat(dashFrame.y()).isLessThan(700);
        assertThat(dashFrame.abilityCharges()).doesNotContainKey(19);
        assertThat(dashFrame.abilityCooldowns()).containsEntry(19, 0);

        MatchPlaybackDTO lockOn = service.simulate(request(
                arena(10_200),
                botWithRotation("lock", "Lock", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"always"}],"action":"lock_on"}]
                        """), 0),
                bot("lock-target", "Target", 2, 700, 400, idleBrain)));
        var lockFrame = lockOn.frames().stream()
                .map(frame -> frame.bots().getFirst())
                .filter(frame -> Integer.valueOf(9_800).equals(frame.abilityCooldowns().get(20)))
                .findFirst()
                .orElseThrow();

        assertThat(lockFrame.x()).isEqualTo(100);
        assertThat(lockFrame.y()).isEqualTo(400);
        assertThat(lockFrame.hp()).isEqualTo(lockOn.initialState().bots().getFirst().hp());
        assertThat(lockFrame.rotation()).isEqualTo(90);
        assertThat(lockFrame.abilityCooldowns()).containsEntry(20, 9_800);
        assertThat(lockFrame.abilityActiveMs()).containsEntry(20, 0);
        assertThat(lockOn.frames()).anySatisfy(frame -> {
            assertThat(frame.bots().getFirst().abilityActiveMs()).containsEntry(20, 200);
            assertThat(frame.bots().getFirst().abilityCooldowns()).containsEntry(20, 0);
        });
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
    void expressionConditionsReadOverclockAsAnActiveStatusAndItsDuration() {
        JsonNode overclockBrain = customBrain("[\"overclock\",\"basic_strike\"]", """
                [
                  {"priority":1,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"overclock","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"overclock"},
                  {"priority":2,"conditions":[{"type":"expression","left":"my.selectedStatusEffectActive","statusEffect":"overclock","comparator":"eq","right":{"type":"boolean","value":true}},{"type":"expression","left":"my.selectedStatusEffectDurationMs","statusEffect":"overclock","comparator":"gt","right":{"type":"number","value":3}}],"action":"basic_strike"}
                ]
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(800),
                bot("overclock-condition", "Overclock", 1, 100, 400, "custom", overclockBrain),
                bot("overclock-target", "Target", 2, 150, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).anySatisfy(frame ->
                assertThat(frame.bots().getFirst().abilityCooldowns()).containsEntry(34, 250));
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
                            "action":"move_walk","movementMode":"target","movementDirection":0
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
                          {"priority":3,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_walk","movementMode":"target","movementDirection":0},
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
        assertThat(result.frames().getFirst().bots().get(1).hp()).isEqualTo(137.167);
        assertThat(result.frames().getFirst().bots().getFirst().abilityActiveMs())
                .containsKey(3);
        assertThat(result.frames().getFirst().bots().getFirst().abilityCooldowns())
                .containsEntry(3, 0);
        assertThat(result.frames().getFirst().bots().getFirst().abilityActiveMs())
                .containsEntry(3, 500);
        assertThat(result.frames().getFirst().bots().getFirst().abilityCharges())
                .containsEntry(3, 5);
    }

    @Test
    void standardAbilityConditionsResolveWithoutRetiredBlockCharges() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("standard-condition", "Standard", 1, 100, 700, "custom", customBrain("[]", """
                        [{"conditions":[{"type":"expression","left":"my.hp","comparator":"gt","right":{"type":"number","value":0}}],"action":"dash","movementMode":"absolute","movementDirection":"north"}]
                        """)),
                bot("standard-target", "Target", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().bots().getFirst().y()).isLessThan(700);
        assertThat(result.frames().getFirst().bots().getFirst().abilityCooldowns()).containsEntry(19, 0);
    }

    @Test
    void basicStrikeIsStandardImmediateDamageWithItsAuthoritativeTiming() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(500),
                bot("basic-striker", "Basic", 1, 100, 400, "custom", customBrain("[]", """
                        [{"conditions":[{"type":"always"}],"action":34}]
                        """)),
                bot("basic-target", "Target", 2, 160, 400, idleBrain)));

        var attacker = result.frames().getFirst().bots().getFirst();
        var defender = result.frames().getFirst().bots().get(1);
        assertThat(attacker.abilities()).contains(34);
        assertThat(attacker.triggeredAbility()).isEqualTo(34);
        assertThat(attacker.abilityCooldowns()).containsEntry(34, 0);
        assertThat(attacker.abilityActiveMs()).containsEntry(34, 200);
        assertThat(defender.hp()).isEqualTo(145);
    }

    @Test
    void overclockOnlyReducesCooldownsCreatedAfterItsActivation() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1_000),
                bot("overclock-caster", "Caster", 1, 100, 400, "custom", customBrain(
                        "[\"basic_strike\",\"overclock\"]", """
                                [
                                  {"priority":1,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"basic_strike","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"basic_strike"},
                                  {"priority":2,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"overclock","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"overclock"}
                                ]
                                """)),
                bot("overclock-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        var overclockFrame = result.frames().stream()
                .filter(frame -> Integer.valueOf(33).equals(frame.bots().getFirst().triggeredAbility()))
                .findFirst()
                .orElseThrow();
        // Overclock now spends 500 ms preparing, so the previous short strike
        // recovery has completed before the status activates.
        assertThat(overclockFrame.bots().getFirst().abilityCooldowns()).containsEntry(34, 0);

        var acceleratedStrike = result.frames().stream()
                .filter(frame -> Integer.valueOf(34).equals(frame.bots().getFirst().triggeredAbility()))
                .filter(frame -> frame.elapsedMs() > overclockFrame.elapsedMs())
                .findFirst()
                .orElseThrow();
        assertThat(acceleratedStrike.bots().getFirst().abilityCooldowns()).containsEntry(34, 0);
    }

    @Test
    void defensiveAbilityDurationsLiveInStatusesAfterTheirPreparation() {
        MatchPlaybackDTO reactiveArmor = service.simulate(request(
                arena(1_000),
                bot("reactive-armor", "Armor", 1, 100, 400, "custom", customBrain(
                        "[\"reactive_armor\"]", "[{\"conditions\":[{\"type\":\"always\"}],\"action\":\"reactive_armor\"}]")),
                bot("reactive-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));
        var armorFrame = reactiveArmor.frames().stream()
                .filter(frame -> Integer.valueOf(16).equals(frame.bots().getFirst().triggeredAbility()))
                .findFirst().orElseThrow();
        assertThat(armorFrame.bots().getFirst().preparingAbility()).isNull();
        assertThat(armorFrame.bots().getFirst().abilityActiveMs()).containsEntry(16, 0);
        assertThat(armorFrame.bots().getFirst().statusEffects()).anySatisfy(status -> {
            assertThat(status.type).isEqualTo("reactive-armor");
            assertThat(status.remainingMs).isEqualTo(4_000);
            assertThat(status.effects).extracting(effect -> effect.type)
                    .containsExactlyInAnyOrder("incoming_damage_modifier", "damage_reflection");
        });

        MatchPlaybackDTO absoluteGuard = service.simulate(request(
                arena(1_000),
                bot("absolute-guard", "Guard", 1, 100, 400, "custom", customBrain(
      "[\"absolute_guard\"]", "[{\"conditions\":[{\"type\":\"always\"}],\"action\":\"absolute_guard\"}]")),
                bot("guard-target", "Target", 2, 700, 400, "custom", customBrain("[]", "[]"))));
        var guardFrame = absoluteGuard.frames().stream()
                .filter(frame -> Integer.valueOf(23).equals(frame.bots().getFirst().triggeredAbility()))
                .findFirst().orElseThrow();
        assertThat(guardFrame.bots().getFirst().abilityActiveMs()).containsEntry(23, 0);
        assertThat(guardFrame.bots().getFirst().statusEffects()).anySatisfy(status -> {
            assertThat(status.type).isEqualTo("absolute-guard");
            assertThat(status.remainingMs).isEqualTo(1_500);
            assertThat(status.effects).extracting(effect -> effect.type)
                    .containsExactly("damage_immunity");
        });
    }

    @Test
    void retiredBlockActionCannotActivate() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("blocker", "Blocker", 1, 100, 400, "custom", customBrain("[]", """
                        [{"conditions":[{"type":"always"}],"action":2}]
                        """)),
                bot("block-target", "Target", 2, 700, 400, idleBrain)));

        var blocker = result.frames().getFirst().bots().getFirst();
        assertThat(blocker.abilities()).doesNotContain(2);
        assertThat(blocker.abilityActiveMs()).doesNotContainKey(2);
        assertThat(blocker.abilityCooldowns()).doesNotContainKey(2);
        assertThat(blocker.abilityCharges()).doesNotContainKey(2);
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
        assertThat(attacker.abilityCooldowns()).containsEntry(4, 0);
        assertThat(result.frames().getFirst().entities())
                .anySatisfy(entity -> assertThat(entity.type()).isEqualTo("grenadeExplosion"));
        assertThat(result.frames().getFirst().bots().get(1).hp()).isLessThan(150);
    }

    @Test
    void windBurstReplayFramesContainAuthoritativeOneHundredFiftyUnitKnockback() {
        JsonNode windBurstBrain = customBrain("[\"wind_burst\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"wind_burst"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(2_000),
                bot("wind-caster", "Caster", 1, 400, 500, "custom", windBurstBrain),
                bot("wind-target", "Target", 2, 520, 500, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames())
                .anySatisfy(frame -> assertThat(frame.bots().get(1).x()).isEqualTo(670.0));
        assertThat(result.frames())
                .filteredOn(frame -> frame.bots().get(1).x() == 670.0)
                .allSatisfy(frame -> assertThat(frame.bots().get(1).hp()).isEqualTo(135));
    }

    @Test
    void newAbilityDemoBrainDrivesTheNewAbilitySet() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(7_000),
                bot("new-ability-demo", "New Ability Demo", 1, 400, 400, "custom", newAbilityDemoBrain()),
                bot("new-ability-target", "Demo Target", 2, 470, 400, "custom", customBrain("[]", "[]"))));

        List<Integer> triggeredAbilities = result.frames().stream()
                .map(frame -> frame.bots().getFirst().triggeredAbility())
                .filter(java.util.Objects::nonNull)
                .distinct()
                .toList();
        assertThat(triggeredAbilities).containsExactly(28, 29, 30, 31, 32, 33);
        assertThat(result.frames()).anySatisfy(frame -> assertThat(frame.bots().getFirst().statusEffects())
                .anySatisfy(status -> {
                    assertThat(status.type).isEqualTo("overclock");
                    assertThat(status.remainingMs).isPositive();
                }));
        assertThat(result.frames()).anySatisfy(frame -> assertThat(frame.entities())
                .anySatisfy(entity -> assertThat(entity.type()).isEqualTo("hunterDrone")));
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
    void targetDirectionSupportsAnUpperAngleBound() {
        JsonNode directionBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"target.bearingFromMe","comparator":"lt","target":"opponent","right":{"type":"number","value":50}}],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("walker", "Walker", 1, 500, 400, "custom", directionBrain),
                bot("target", "Target", 2, 400, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isLessThan(500);
    }

    @Test
    void closingZoneEdgeDistanceUsesSignedBotHitboxClearance() {
        JsonNode brain = customBrain("[\"swing\"]", """
                [
                  {"priority":1,"conditions":[{"type":"expression","left":"my.closingZoneEdgeDistance","comparator":"lt","right":{"type":"number","value":0}}],"action":"swing"}
                ]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(16_100),
                bot("zone-reader", "Zone Reader", 1, 50, 50, "custom", brain),
                bot("zone-idle", "Zone Idle", 2, 1400, 800, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 14_900)
                .singleElement()
                .satisfies(frame -> assertThat(frame.bots().getFirst().triggeredAbility()).isNull());
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 16_000)
                .singleElement()
                .satisfies(frame -> assertThat(frame.bots().getFirst().triggeredAbility()).isNull());
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 16_100)
                .singleElement()
                .satisfies(frame -> assertThat(frame.bots().getFirst().triggeredAbility()).isEqualTo(1));
    }

    @Test
    void opponentClosingZoneEdgeDistanceUsesTheOpponentBotScope() {
        JsonNode brain = customBrain("[\"swing\"]", """
                [
                  {"priority":1,"conditions":[{"type":"expression","left":"opponent.closingZoneEdgeDistance","comparator":"lt","right":{"type":"number","value":-1}}],"action":"swing"}
                ]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(16_100),
                bot("zone-opponent-reader", "Zone Opponent Reader", 1, 800, 800, "custom", brain),
                bot("zone-opponent-outside", "Zone Opponent Outside", 2, 50, 50, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 16_100)
                .singleElement()
                .satisfies(frame -> assertThat(frame.bots().getFirst().triggeredAbility()).isEqualTo(1));
    }

    @Test
    void targetDirectionSupportsTwoStandardBoundsForTheCenteredArc() {
        JsonNode directionBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"target.bearingFromMe","comparator":"gte","target":"opponent","right":{"type":"number","value":-60}},{"type":"expression","left":"target.bearingFromMe","comparator":"lte","target":"opponent","right":{"type":"number","value":60}}],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);
        double[] targetPosition = positionAtBearing(500, 400, 100, 0);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100),
                bot("negative-walker", "Walker", 1, 500, 400, "custom", directionBrain),
                bot("negative-target", "Target", 2, targetPosition[0], targetPosition[1], "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getFirst().bots().getFirst().x()).isLessThan(500);
    }

    @Test
    void targetSpeedUsesBotMovementUnitsPerTick() {
        JsonNode readerBrain = customBrain("[\"swing\"]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"target.speed","comparator":"gt","target":"opponent","right":{"type":"number","value":7}}],"action":"swing"}]
                """);
        JsonNode movementBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"move_walk","movementMode":"absolute","movementDirection":"east"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(400),
                bot("speed-reader", "Reader", 1, 400, 400, "custom", readerBrain),
                bot("speed-target", "Target", 2, 700, 400, "custom", movementBrain)));

        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() < 300)
                .noneMatch(frame -> Integer.valueOf(1).equals(frame.bots().getFirst().triggeredAbility()));
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 300)
                .singleElement()
                .satisfies(frame -> assertThat(frame.bots().getFirst().triggeredAbility()).isEqualTo(1));
    }

    @Test
    void targetFacingBoundsUseOneAngleRepresentationPerRange() {
        JsonNode facingBrain = customBrain("[]", """
                [{"priority":1,"conditions":[
                  {"type":"expression","left":"target.facing","comparator":"gt","target":"opponent","right":{"type":"number","value":10}},
                  {"type":"expression","left":"target.facing","comparator":"lt","target":"opponent","right":{"type":"number","value":50}}
                ],"action":"move_walk","movementMode":"absolute","movementDirection":"west"}]
                """);
        MatchPlaybackDTO inside = service.simulate(request(
                arena(100),
                botWithRotation("facing-inside", "Walker", 1, 500, 400, "custom", facingBrain, 90.0),
                botWithRotation("facing-target-inside", "Target", 2, 400, 400, "custom", customBrain("[]", "[]"), 30.0)));
        MatchPlaybackDTO outside = service.simulate(request(
                arena(100),
                botWithRotation("facing-outside", "Walker", 1, 500, 400, "custom", facingBrain, 90.0),
                botWithRotation("facing-target-outside", "Target", 2, 400, 400, "custom", customBrain("[]", "[]"), 70.0)));

        assertThat(inside.frames().getFirst().bots().getFirst().x()).isLessThan(500);
        assertThat(outside.frames().getFirst().bots().getFirst().x()).isEqualTo(500);
    }

    @Test
    void rotateActionSupportsAbsoluteAngleAndCoordinates() {
        JsonNode absoluteAngleBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"rotate_toward_enemy",
                  "targetMode":"angle","targetAngle":90}]
                """);
        MatchPlaybackDTO angleResult = service.simulate(request(
                arena(100),
                botWithRotation("angle-rotator", "Angle", 1, 500, 400, "custom", absoluteAngleBrain, 0.0),
                botWithRotation("angle-target", "Target", 2, 500, 300, "custom", customBrain("[]", "[]"), 180.0)));
        assertThat(angleResult.frames().getFirst().bots().getFirst().rotation()).isEqualTo(12.0);

        JsonNode coordinateBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"rotate_toward_enemy",
                  "targetMode":"coordinates","targetX":600,"targetY":400}]
                """);
        MatchPlaybackDTO coordinateResult = service.simulate(request(
                arena(100),
                botWithRotation("coordinate-rotator", "Coordinate", 1, 500, 400, "custom", coordinateBrain, 0.0),
                botWithRotation("coordinate-target", "Target", 2, 500, 300, "custom", customBrain("[]", "[]"), 180.0)));
        assertThat(coordinateResult.frames().getFirst().bots().getFirst().rotation()).isEqualTo(12.0);
    }

    @Test
    void globalAbilityLockBlocksDifferentAbilitiesDuringActivePhase() {
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
                .containsEntry(5, 0);
        assertThat(afterFireball.frames()).anyMatch(frame -> frame.bots().getFirst().abilityActiveMs()
                .getOrDefault(5, 0) > 0);
        assertThat(afterFireball.frames()).noneMatch(frame -> frame.bots().getFirst().abilityActiveMs()
                .getOrDefault(5, 0) > 0
                && Integer.valueOf(9).equals(frame.bots().getFirst().preparingAbility()));
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
                .containsEntry(5, 4);
    }

    @Test
    void higherPriorityFireballYieldsToGrenadeDuringItsRecoveryTick() {
        JsonNode fireballThenGrenade = customBrain("[\"throw_grenade\",\"shoot_fireball\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"shoot_fireball"},
                  {"priority":2,"conditions":[{"type":"always"}],"action":"throw_grenade"}
                ]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(1_000),
                bot("fireball-grenade", "One", 1, 100, 400, "custom", fireballThenGrenade),
                bot("idle-grenade-target", "Two", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        List<Integer> triggeredAbilities = result.frames().stream()
                .map(frame -> frame.bots().getFirst().triggeredAbility())
                .filter(java.util.Objects::nonNull)
                .toList();
        assertThat(triggeredAbilities).containsSubsequence(5, 4);
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
        assertThat(first.preparingMs()).isEqualTo(400);
        assertThat(first.x()).isGreaterThan(100.0);
        assertThat(first.rotation()).isEqualTo(12.0);
        assertThat(second.x()).isGreaterThan(first.x());
        assertThat(second.rotation()).isEqualTo(24.0);
        assertThat(second.preparingAbility()).isEqualTo(9);
        assertThat(second.preparingMs()).isEqualTo(300);
    }

    @Test
    void authoritativeSimulatorExecutesAndClampsCustomVariableNodes() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":99990}],
                  "roots":[
                    {"createdOrder":0,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"always"}],"actions":[{"action":"variable","variableId":"custom.counter","terms":[{"operator":"add","operand":{"type":"number","value":50}}]}],"children":[]}]},
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
    void authoritativeSimulatorEvaluatesCustomVariableModuloTermsLeftToRight() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                  "roots":[
                    {"createdOrder":0,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"always"}],"actions":[
                      {"action":"variable","variableId":"custom.counter","terms":[
                        {"operator":"set","operand":{"type":"number","value":3.29}},
                        {"operator":"modulo","operand":{"type":"number","value":2.5}},
                        {"operator":"add","operand":{"type":"number","value":2.59}}
                      ]}
                    ],"children":[]}]},
                    {"createdOrder":1,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"expression","left":"custom.counter","comparator":"eq","right":{"type":"number","value":3.5}}],"actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":"east"}],"children":[]}]}
                  ]
                }
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(400),
                bot("variable-modulo", "Modulo", 1, 100, 400, "custom", variableBrain),
                bot("idle-variable-modulo", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().bots().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void authoritativeSimulatorActivatesAbilityFromIncrementedCustomVariable() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["swing"]},
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
        assertThat(result.frames().getLast().bots().get(1).hp()).isLessThan(150);
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

    @Test
    void authoritativeReplayCarriesRendererOnlyClosingZoneAtConfiguredCadence() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(60_000),
                bot("zone-one", "One", 1, 800, 800, "custom", customBrain("[]", "[]")),
                bot("zone-two", "Two", 2, 800, 800, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).anySatisfy(frame -> assertThat(frame.elapsedMs()).isEqualTo(15_000));
        assertThat(result.frames()).anySatisfy(frame -> assertThat(frame.elapsedMs()).isEqualTo(20_000));
        assertThat(result.frames()).anySatisfy(frame -> assertThat(frame.elapsedMs()).isEqualTo(40_000));
        assertThat(result.frames()).anySatisfy(frame -> assertThat(frame.elapsedMs()).isEqualTo(60_000));
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 20_000)
                .singleElement().satisfies(frame -> assertThat(frame.entities())
                        .filteredOn(entity -> "closingZone".equals(entity.type()))
                        .singleElement().extracting(MatchPlaybackDTO.ArenaEntityDTO::size)
                        .isEqualTo(1_551));
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 35_000)
                .singleElement().satisfies(frame -> assertThat(frame.entities())
                        .filteredOn(entity -> "closingZone".equals(entity.type()))
                        .singleElement().extracting(MatchPlaybackDTO.ArenaEntityDTO::size)
                        .isEqualTo(1_551));
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 40_000)
                .singleElement().satisfies(frame -> assertThat(frame.entities())
                        .filteredOn(entity -> "closingZone".equals(entity.type()))
                        .singleElement().extracting(MatchPlaybackDTO.ArenaEntityDTO::size)
                        .isEqualTo(776));
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 55_000)
                .singleElement().satisfies(frame -> assertThat(frame.entities())
                        .filteredOn(entity -> "closingZone".equals(entity.type()))
                        .singleElement().extracting(MatchPlaybackDTO.ArenaEntityDTO::size)
                        .isEqualTo(776));
        assertThat(result.frames()).filteredOn(frame -> frame.elapsedMs() == 60_000)
                .singleElement().satisfies(frame -> assertThat(frame.entities())
                        .filteredOn(entity -> "closingZone".equals(entity.type()))
                        .singleElement().extracting(MatchPlaybackDTO.ArenaEntityDTO::size)
                        .isEqualTo(0));
    }

    @Test
    void authoritativeSimulationContinuesPastZoneClosureUntilNinetySecondCap() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(90_000),
                bot("long-one", "One", 1, 800, 800, "custom", customBrain("[]", "[]")),
                bot("long-two", "Two", 2, 800, 800, "custom", customBrain("[]", "[]"))));

        assertThat(result.result()).isEqualTo("DRAW");
        assertThat(result.frames().getLast().elapsedMs())
                .isGreaterThan(60_000)
                .isLessThanOrEqualTo(90_000);
    }

    private JsonNode customBrain(String abilitiesJson, String branchesJson) {
        return treeBrain(abilitiesJson, branchesJson);
    }

    private JsonNode newAbilityDemoBrain() {
        return customBrain("[\"tether_bolt\",\"static_snare\",\"disruptor_dart\",\"repeller_drone\",\"siphon_lance\",\"overclock\"]", """
                [
                  {"priority":1,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"tether_bolt","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"tether_bolt"},
                  {"priority":2,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"static_snare","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"static_snare"},
                  {"priority":3,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"disruptor_dart","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"disruptor_dart"},
                  {"priority":4,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"repeller_drone","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"repeller_drone"},
                  {"priority":5,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"siphon_lance","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"siphon_lance"},
                  {"priority":6,"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"overclock","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"overclock"}
                ]
                """);
    }

    private JsonNode treeBrain(String abilitiesJson, String branchesJson) {
        try {
            return jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1","loadout":{"abilities":%s},"roots":[{"createdOrder":0,"branches":%s}]}
                    """.formatted(abilitiesJson, branchesJson));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
