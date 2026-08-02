package com.example.botfight.simulation;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.MatchPlaybackDTO;
import com.example.botfight.simulation.DuelSimulationService.DuelArenaRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelFighterRequest;
import com.example.botfight.simulation.DuelSimulationService.DuelSimulationRequest;
import com.example.botfight.simulation.DuelSimulationService.ObstacleRequest;
import com.example.botfight.simulation.combat.CombatCatalog;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Disabled;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class DuelSimulationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final DuelSimulationService service = new DuelSimulationService(
            new CombatCatalog());
    private final JsonNode idleBrain = brain("[]");

    @Test
    void producesDrawWhenNeitherBrainChoosesWinningAction() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(200, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, idleBrain),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.status()).isEqualTo("COMPLETED");
        assertThat(result.result()).isEqualTo("DRAW");
        assertThat(result.winnerUserId()).isNull();
    }

    @Test
    void customLoadoutUsesAllocatedHpAndArenaHasNoFixtures() throws Exception {
        JsonNode loadoutBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":["swing"],"statPoints":{"maxHp":2,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                 "blocks":[]}
                """);
        MatchPlaybackDTO result = service.simulate(request(
                new DuelArenaRequest(1000, 1000, 0, List.of(new ObstacleRequest("core_1", "core", 500.0, 50.0, 120))),
                fighter("fighter-1", "One", 1, 100, 500, "custom", loadoutBrain),
                fighter("fighter-2", "Two", 2, 900, 500, "custom", loadoutBrain)));

        assertThat(result.initialState().obstacles()).isEmpty();
        assertThat(result.initialState().fighters()).extracting(MatchPlaybackDTO.FighterPlacementDTO::hp).containsOnly(120);
        assertThat(result.result()).isEqualTo("DRAW");
    }

    @Test
    void fighterKnockoutIsTheOnlyWinningCondition() throws Exception {
        JsonNode attackerBrain = jsonMapper.readTree("""
                {"version":"melee-logic-blocks-v2",
                 "loadout":{"abilities":["swing"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":4,"attackSpeed":0}},
                 "blocks":[{"priority":1,"conditions":[{"type":"always"}],"action":"swing"}]}
                """);
        JsonNode defenderBrain = jsonMapper.readTree("""
                {"version":"melee-logic-blocks-v2",
                 "loadout":{"abilities":["block"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                 "blocks":[]}
                """);
        MatchPlaybackDTO result = service.simulate(request(
                new DuelArenaRequest(1000, 1000, 10_000, List.of()),
                fighter("fighter-1", "One", 1, 480, 500, "custom", attackerBrain),
                fighter("fighter-2", "Two", 2, 520, 500, "custom", defenderBrain)));

        assertThat(result.result()).isEqualTo("FIGHTER_WIN");
        assertThat(result.winnerUserId()).isEqualTo(UUID.nameUUIDFromBytes("fighter-1".getBytes()));
    }

    @Test
    void lowerPriorityNumberOverridesEarlierHigherNumberMovement() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_outward"},
                          {"priority":5,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_inward"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(-4.0);
    }

    @Test
    void higherPriorityHpRuleStaysSelectedOverLowerPriorityDistanceEngage() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"expression","left":"my.hp","comparator":"gt","right":{"type":"number","value":50}}],"action":"move_outward"},
                          {"priority":2,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":10}}],"action":"move_inward"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(-4.0);
    }

    @Test
    void targetRelativeRetreatUsesOppositeFacingWhenFightersOverlapExactly() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 500, 500, brain("""
                        [{"priority":1,"conditions":[{"type":"always"}],"action":"move_outward"}]
                        """)),
                fighter("fighter-2", "Two", 2, 500, 500, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isLessThan(500);
        assertThat(result.frames().getFirst().fighters().getFirst().y()).isEqualTo(500);
    }

    @Test
    void expressionConditionsSelectBlocksFromStateVariables() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"target.distance",
                              "comparator":"gt",
                              "right":{"type":"variable","value":"my.hp"}
                            }],
                            "action":"move_inward"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void expressionConditionsCompareBooleanVariables() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"my.selectedAbilityReady",
                              "ability":"dash",
                              "comparator":"eq",
                              "right":{"type":"boolean","value":true}
                            }],
                            "action":"dash"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(115);
    }

    @Test
    void shortestTargetBearingDifferenceIsNeverNegative() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 500, 500, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"target.relativeBearing",
                              "comparator":"lt",
                              "right":{"type":"number","value":10}
                            }],
                            "action":"move_west"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 500, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(500);
    }

    @Test
    void conditionJoinsCanUseOrAndCoordinates() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
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
                            "action":"move_inward"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void positionExpressionVariablesReadPlayerAndOpponentCoordinates() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {
                            "priority":1,
                            "conditions":[{
                              "type":"expression",
                              "left":"my.x",
                              "comparator":"lt",
                              "right":{"type":"number","value":150}
                            }],
                            "action":"move_east"
                          },
                          {
                            "priority":2,
                            "conditions":[{
                              "type":"expression",
                              "left":"opponent.y",
                              "comparator":"gt",
                              "right":{"type":"number","value":350}
                            }],
                            "action":"move_north"
                          }
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(100);
        assertThat(result.frames().getFirst().fighters().getFirst().y()).isEqualTo(400.0);
    }

    @Test
    void samePriorityMoveAndDashBlocksCombineActionHeads() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":3,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_inward"},
                          {"priority":3,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"dash"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(40.0);
    }

    @Test
    void doNotDashSuppressesDashWithoutBlockingDashDirectionMovement() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"conditions":[{"type":"expression","left":"my.hp","comparator":"gt","right":{"type":"number","value":50}}],"action":"no_dash"},
                          {"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"dash"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x() - 100).isEqualTo(4.0);
    }

    @Disabled("Removed arena-object contract")
    @Test
    void clusterPriorityAndSharedConditionsSelectNestedBlocks() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of(new ObstacleRequest("object_1", "healthPack", 300.0, 400.0, 42))),
                fighter("fighter-1", "One", 1, 400, 400, brainWithClusters("""
                        [{"priority":5,"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_inward"}]
                        """, """
                        [{
                          "priority":1,
                          "conditions":[{"type":"expression","left":"my.hp","comparator":"lt","right":{"type":"number","value":126}}],
                          "blocks":[{
                            "conditions":[{"type":"target_health_pack","target":"object_1"}],
                            "action":"move_inward",
                            "actionTarget":"object_1"
                          }]
                        }]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isLessThan(400.0);
    }

    @Disabled("Cores were removed from duel-v1")
    @Test
    void destroyingOpponentCoreWinsRound() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(30_000, List.of()),
                fighter("attacker", "Attacker", 1, 800, 1450, brain("""
                        [{"conditions":[{"type":"always"}],"action":"swing","actionTarget":"opponent_core"}]
                        """)),
                fighter("target", "Target", 2, 400, 400, idleBrain)));

        assertThat(result.result()).isEqualTo("FIGHTER_WIN");
        assertThat(result.winnerUserId()).isEqualTo(UUID.nameUUIDFromBytes("attacker".getBytes()));
        assertThat(result.frames().getLast().obstacles())
                .filteredOn(obstacle -> "core_2".equals(obstacle.id()))
                .singleElement()
                .satisfies(core -> assertThat(core.hp()).isZero());
    }

    @Test
    void rangedFireGunUsesFacingRayAndLinearFalloff() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"fire_gun","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 300, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(112);
        assertThat(result.frames().getFirst().fighters().getFirst().attackActive()).isTrue();
    }

    @Test
    void rangedReplayTracerOnlyMarksShotFrames() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"fire_gun","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 300, 400, idleBrain)));

        assertThat(result.frames().get(0).fighters().getFirst().attackActive()).isTrue();
        assertThat(result.frames().get(1).fighters().getFirst().attackActive()).isFalse();
        assertThat(result.frames().get(11).fighters().getFirst().attackActive()).isTrue();
    }

    @Test
    void rangedGunUsesTenRoundMagazineAndThreeSecondReload() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(15_000, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"fire_gun","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 900, 400, idleBrain)));

        List<MatchPlaybackDTO.ReplayFrameDTO> shotFrames = result.frames().stream()
                .filter(frame -> frame.fighters().getFirst().attackActive())
                .toList();
        MatchPlaybackDTO.ReplayFrameDTO emptyMagazineFrame = result.frames().stream()
                .filter(frame -> frame.fighters().getFirst().gunAmmo() == 0)
                .findFirst()
                .orElseThrow();
        MatchPlaybackDTO.ReplayFrameDTO firstPostReloadShot = shotFrames.stream()
                .filter(frame -> frame.elapsedMs() > emptyMagazineFrame.elapsedMs())
                .findFirst()
                .orElseThrow();

        assertThat(result.frames().getFirst().fighters().getFirst().gunAmmo()).isEqualTo(9);
        assertThat(emptyMagazineFrame.fighters().getFirst().gunReloadMs()).isGreaterThan(0);
        assertThat(firstPostReloadShot.elapsedMs() - emptyMagazineFrame.elapsedMs()).isGreaterThanOrEqualTo(3_000);
        assertThat(firstPostReloadShot.fighters().getFirst().gunAmmo()).isEqualTo(9);
    }

    @Test
    void fireGunIsGatedToRangedFighters() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"expression","left":"target.distance","comparator":"lt","right":{"type":"number","value":700}}],"action":"fire_gun"}]
                        """)),
                fighter("target", "Target", 2, 300, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(125);
        assertThat(result.frames().getFirst().fighters().getFirst().attackActive()).isFalse();
    }

    @Test
    void rangedGrenadeExplodesImmediatelyWhenItTouchesOpponent() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"throw_grenade","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"throw_grenade"}]
                        """)),
                fighter("target", "Target", 2, 190, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(80);
        assertThat(result.frames().getFirst().obstacles())
                .anyMatch(obstacle -> "grenadeExplosion".equals(obstacle.type()));
    }

    @Test
    void rangedGrenadeExplodesOneSecondAfterStoppingWithSteppedFalloff() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(3000, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"throw_grenade","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"throw_grenade"}]
                        """)),
                fighter("target", "Target", 2, 530, 400, idleBrain)));

        MatchPlaybackDTO.ReplayFrameDTO explosionFrame = result.frames().stream()
                .filter(frame -> frame.obstacles().stream().anyMatch(obstacle -> "grenadeExplosion".equals(obstacle.type())))
                .findFirst()
                .orElseThrow();
        assertThat(explosionFrame.fighters().get(1).hp()).isEqualTo(90);
        MatchPlaybackDTO.ObstaclePlacementDTO movingGrenade = result.frames().stream()
                .flatMap(frame -> frame.obstacles().stream())
                .filter(obstacle -> "grenade".equals(obstacle.type()))
                .filter(obstacle -> Math.hypot(obstacle.velocityX(), obstacle.velocityY()) > 0)
                .findFirst()
                .orElseThrow();
        assertThat(movingGrenade.velocityX()).isNotZero();
    }

    @Test
    void replayFireballFramesIncludeVelocityForProjectileTrails() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("mage", "Mage", 1, 100, 400, "mage", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"shoot_fireball","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"shoot_fireball"}]
                        """)),
                fighter("target", "Target", 2, 700, 400, idleBrain)));

        MatchPlaybackDTO.ObstaclePlacementDTO fireball = result.frames().stream()
                .flatMap(frame -> frame.obstacles().stream())
                .filter(obstacle -> "fireball".equals(obstacle.type()))
                .findFirst()
                .orElseThrow();
        assertThat(fireball.velocityX()).isNotZero();
        assertThat(fireball.velocityY()).isZero();
    }

    @Test
    void mageFireballHitsOnceAndAppliesRefreshingBurn() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1500, List.of()),
                fighter("mage", "Mage", 1, 100, 400, "mage", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"shoot_fireball","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"shoot_fireball"}]
                        """)),
                fighter("target", "Target", 2, 190, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(110);
        assertThat(result.frames().getLast().fighters().get(1).hp()).isLessThanOrEqualTo(108);
        assertThat(result.frames().getFirst().fighters().getFirst().gunAmmo()).isEqualTo(3);
        assertThat(result.frames().getFirst().obstacles())
                .noneMatch(obstacle -> "fireball".equals(obstacle.type()));
    }

    @Test
    void attackSpeedShortensCooldownAtActivationWithoutSpeedingUpReplayTime() throws Exception {
        JsonNode fastSwingBrain = jsonMapper.readTree("""
                {"version":"melee-logic-blocks-v2",
                 "loadout":{"abilities":["swing"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":5}},
                 "blocks":[{"priority":1,"conditions":[{"type":"always"}],"action":"swing"}],"clusters":[]}
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(150, List.of()),
                fighter("fast-swing", "One", 1, 100, 400, "custom", fastSwingBrain),
                fighter("idle", "Two", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        int initialCooldown = result.frames().get(0).fighters().getFirst().swingCooldownMs();
        int nextCooldown = result.frames().get(1).fighters().getFirst().swingCooldownMs();
        assertThat(initialCooldown).isEqualTo(667);
        assertThat(nextCooldown).isEqualTo(567);
    }

    @Test
    void repeatedFireballsRefreshBurnDurationWithoutPostponingBurnTicks() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(3500, List.of()),
                fighter("mage", "Mage", 1, 100, 400, "mage", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"shoot_fireball","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"shoot_fireball"}]
                        """)),
                fighter("target", "Target", 2, 190, 400, idleBrain)));

        int finalHp = result.frames().getLast().fighters().get(1).hp();
        assertThat(finalHp).isLessThan(65);
    }

    @Test
    void mageStunDealsFiveDamageAndLocksTargetActionsForTwelveTicks() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(2_200, List.of()),
                fighter("mage", "Mage", 1, 100, 400, "mage", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"stun","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"stun"}]
                        """)),
                fighter("target", "Target", 2, 200, 400, "melee", brain("""
                        [{"conditions":[{"type":"always"}],"action":"move_outward"}]
                        """))));

        assertThat(result.frames().stream().map(frame -> frame.fighters().get(1).hp()).distinct().toList()).containsExactly(120);
        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(120);
        assertThat(result.frames().getFirst().fighters().getFirst().attackActive()).isTrue();
        double stunnedX = result.frames().getFirst().fighters().get(1).x();
        assertThat(result.frames().get(11).fighters().get(1).x()).isEqualTo(stunnedX);
        assertThat(result.frames().get(12).fighters().get(1).x()).isGreaterThan(stunnedX);
    }

    @Test
    void opponentGrenadeCanBeUsedAsConditionAndMovementTarget() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(300, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", brain("""
                        [{
                          "conditions":[{"type":"expression","left":"target.exists","leftTarget":"opponent_grenade","comparator":"eq","right":{"type":"boolean","value":true}}],
                          "action":"move_inward",
                          "actionTarget":"opponent_grenade"
                        }]
                        """)),
                fighter("ranged", "Ranged", 2, 700, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"my.selectedAbilityReady","ability":"throw_grenade","comparator":"eq","right":{"type":"boolean","value":true}}],"action":"throw_grenade"}]
                        """))));

        assertThat(result.frames().get(1).fighters().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void grenadeIsGatedToRangedFighters() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", brain("""
                        [{"conditions":[{"type":"always"}],"action":"throw_grenade"}]
                        """)),
                fighter("target", "Target", 2, 190, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(125);
        assertThat(result.frames().getFirst().obstacles())
                .noneMatch(obstacle -> "grenadeExplosion".equals(obstacle.type()));
    }

    @Test
    void dashIsGatedToMeleeFighters() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", brain("""
                        [{"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"dash"}]
                        """)),
                fighter("target", "Target", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(100.0);
    }

    @Test
    void alwaysConditionCanMoveArenaRelativeDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{"conditions":[{"type":"always"}],"action":"move_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(100.0);
        assertThat(result.frames().getFirst().fighters().getFirst().y()).isEqualTo(396.0);
    }

    @Test
    void alwaysConditionCanDashArenaRelativeDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isEqualTo(100.0);
        assertThat(result.frames().getFirst().fighters().getFirst().y()).isEqualTo(360.0);
    }

    @Test
    void logicTreeUsesNestedFirstMatchAndEarliestCreatedColumnForConflicts() throws Exception {
        JsonNode tree = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "columns":[
                    {"id":"later","createdOrder":20,"branches":[
                      {"id":"later-root","branchType":"if","createdOrder":1,"conditions":[{"type":"always"}],"action":"move_west"}
                    ]},
                    {"id":"earlier","createdOrder":10,"branches":[
                      {"id":"parent","branchType":"if","createdOrder":1,"conditions":[{"type":"always"}],"action":"move_stop","children":[
                        {"id":"false","branchType":"if","createdOrder":1,"conditions":[{"type":"expression","left":"my.hp","comparator":"lt","right":{"type":"number","value":1}}],"action":"move_west"},
                        {"id":"fallback","branchType":"else","createdOrder":2,"conditions":[],"action":"move_east"}
                      ]}
                    ]}
                  ]
                }
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("tree", "Tree", 1, 400, 400, tree),
                fighter("idle", "Idle", 2, 1200, 1200, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isGreaterThan(400.0);
    }

    @Test
    void dashLeavesMeleeAtMaxMovementSpeedInDashDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1200, List.of()),
                fighter("fighter-1", "One", 1, 100, 700, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().get(9).fighters().getFirst().y()).isEqualTo(300.0);
        assertThat(result.frames().get(10).fighters().getFirst().y()).isEqualTo(300.0);
    }

    @Test
    void dashUsesOneCooldownInsteadOfCharges() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(1200, List.of()),
                fighter("fighter-1", "One", 1, 100, 700, brain("""
                        [{"conditions":[{"type":"always"}],"action":"dash_north"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().get(0).fighters().getFirst().y()).isEqualTo(660.0);
        assertThat(result.frames().get(9).fighters().getFirst().y()).isEqualTo(300.0);
        assertThat(result.frames().get(10).fighters().getFirst().y()).isEqualTo(300.0);
    }

    @Test
    void heavySlashAppliesFiveTwoDamageBleedTicks() {
        JsonNode attackerBrain = customBrain("[\"heavy_slash\"]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"opponent.hp","comparator":"gt","right":{"type":"number","value":69}}],"action":"heavy_slash"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(6_000, List.of()),
                fighter("slasher", "Slasher", 1, 400, 500, "custom", attackerBrain),
                fighter("target", "Target", 2, 500, 500, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().get(2).fighters().get(1).hp()).isEqualTo(70);
        assertThat(result.frames().get(52).fighters().get(1).hp()).isEqualTo(60);
    }

    @Test
    void blockedHeavySlashRemovesEveryShieldChargeWithoutDamageOrBleed() {
        JsonNode slashBrain = customBrain("[\"heavy_slash\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"heavy_slash"}]
                """);
        JsonNode blockBrain = customBrain("[\"block\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"block"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(400, List.of()),
                fighter("slasher", "Slasher", 1, 400, 500, "custom", slashBrain),
                fighter("blocker", "Blocker", 2, 490, 500, "custom", blockBrain)));

        var defender = result.frames().get(2).fighters().get(1);
        assertThat(defender.hp()).isEqualTo(100);
        assertThat(defender.blockCharges()).isZero();
        assertThat(defender.bleedRemainingMs()).isZero();
    }

    @Test
    void shieldBlocksFireballAndAttachedRayEffects() {
        JsonNode blockBrain = customBrain("[\"block\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"block"}]
                """);
        JsonNode fireballBrain = customBrain("[\"shoot_fireball\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"shoot_fireball"}]
                """);
        MatchPlaybackDTO fireball = service.simulate(request(
                arena(200, List.of()),
                fighter("fireball", "Fireball", 1, 400, 500, "custom", fireballBrain),
                fighter("blocker-fire", "Blocker", 2, 490, 500, "custom", blockBrain)));
        var fireballDefender = fireball.frames().getFirst().fighters().get(1);
        assertThat(fireballDefender.hp()).isEqualTo(100);
        assertThat(fireballDefender.burnRemainingMs()).isZero();
        assertThat(fireballDefender.blockCharges()).isEqualTo(4);

        for (String ability : List.of("concussive_shot", "rail_shot")) {
            JsonNode shotBrain = customBrain("[\"" + ability + "\"]", """
                    [{"priority":1,"conditions":[{"type":"always"}],"action":"%s"}]
                    """.formatted(ability));
            MatchPlaybackDTO result = service.simulate(request(
                    arena("rail_shot".equals(ability) ? 1_000 : 600, List.of()),
                    fighter("shot-" + ability, "Shooter", 1, 400, 500, "custom", shotBrain),
                    fighter("block-" + ability, "Blocker", 2, 490, 500, "custom", blockBrain)));
            var defender = result.frames().getLast().fighters().get(1);
            assertThat(defender.hp()).as(ability).isEqualTo(100);
            assertThat(defender.slowedMs()).as(ability).isZero();
            assertThat(defender.shockRemainingMs()).as(ability).isZero();
            assertThat(defender.blockCharges()).as(ability).isEqualTo(4);
        }
    }

    @Test
    void releasingShieldStartsIndependentTwoSecondCooldown() {
        JsonNode retreatBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"move_outward"}]
                """);
        JsonNode conditionalBlock = customBrain("[\"block\"]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"target.distance","comparator":"lt","right":{"type":"number","value":100}}],"action":"block"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(1_000, List.of()),
                fighter("retreat", "Retreat", 1, 400, 500, "custom", retreatBrain),
                fighter("conditional-block", "Blocker", 2, 490, 500, "custom", conditionalBlock)));

        int activeIndex = java.util.stream.IntStream.range(0, result.frames().size())
                .filter(index -> result.frames().get(index).fighters().get(1).blockActive())
                .findFirst().orElseThrow();
        var released = result.frames().stream().skip(activeIndex + 1L)
                .map(frame -> frame.fighters().get(1))
                .filter(fighter -> !fighter.blockActive())
                .findFirst().orElseThrow();
        assertThat(released.blockCooldownMs()).isEqualTo(2_000);
        assertThat(released.blockCharges()).isEqualTo(5);
    }

    @Test
    void temporalRewindReturnsToActivationSnapshotAfterThreeSeconds() {
        JsonNode rewindBrain = customBrain("[\"temporal_rewind\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"move_east"},
                  {"priority":1,"conditions":[{"type":"always"}],"action":"temporal_rewind"}
                ]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(3_500, List.of()),
                fighter("rewinder", "Rewinder", 1, 400, 500, "custom", rewindBrain),
                fighter("target", "Target", 2, 1200, 500, "custom", customBrain("[]", "[]"))));

        double activationX = result.frames().getFirst().fighters().getFirst().x();
        assertThat(result.frames().get(28).fighters().getFirst().x()).isGreaterThan(activationX);
        assertThat(result.frames().get(30).fighters().getFirst().x()).isEqualTo(activationX);
    }

    @Test
    void phaseStrikePassesThroughDamagesAndFacesTargetAfterLanding() {
        JsonNode phaseBrain = customBrain("[\"phase_strike\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"phase_strike"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("phaser", "Phaser", 1, 400, 500, "custom", phaseBrain),
                fighter("target", "Target", 2, 500, 500, "custom", customBrain("[]", "[]"))));

        var attacker = result.frames().getFirst().fighters().getFirst();
        var defender = result.frames().getFirst().fighters().get(1);
        assertThat(attacker.x()).isEqualTo(550.0);
        assertThat(attacker.rotation()).isEqualTo(270.0);
        assertThat(defender.hp()).isEqualTo(86);
    }

    @Test
    void reactiveArmorReducesAndReflectsIncomingDamage() {
        JsonNode slashBrain = customBrain("[\"heavy_slash\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"heavy_slash"}]
                """);
        JsonNode armorBrain = customBrain("[\"reactive_armor\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"reactive_armor"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(300, List.of()),
                fighter("slasher", "Slasher", 1, 400, 500, "custom", slashBrain),
                fighter("armor", "Armor", 2, 500, 500, "custom", armorBrain)));

        assertThat(result.frames().get(2).fighters()).extracting(MatchPlaybackDTO.FighterPlacementDTO::hp).containsExactly(85, 85);
    }

    @Test
    void repulsorBurstDealsDamageAndPushes250UnitsButBlockOnlyPreventsDamage() {
        JsonNode burstBrain = customBrain("[\"repulsor_burst\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"repulsor_burst"}]
                """);
        JsonNode blockBrain = customBrain("[\"block\"]", """
                [{"priority":1,"conditions":[{"type":"always"}],"action":"block"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("caster", "Caster", 1, 400, 500, "custom", burstBrain),
                fighter("target", "Target", 2, 480, 500, "custom", customBrain("[]", "[]"))));

        var defender = result.frames().getFirst().fighters().get(1);
        assertThat(defender.hp()).isEqualTo(80);
        assertThat(defender.x()).isEqualTo(730.0);

        MatchPlaybackDTO blockedResult = service.simulate(request(
                arena(100, List.of()),
                fighter("caster", "Caster", 1, 400, 500, "custom", burstBrain),
                fighter("blocker", "Blocker", 2, 480, 500, "custom", blockBrain)));
        var blocked = blockedResult.frames().getFirst().fighters().get(1);
        assertThat(blocked.hp()).isEqualTo(100);
        assertThat(blocked.x()).isEqualTo(730.0);
        assertThat(blocked.blockCharges()).isEqualTo(4);
    }

    @Test
    void normalMovementAcceleratesAndMeleeCapsFasterThanRanged() {
        JsonNode moveBrain = brain("""
                [{"conditions":[{"type":"expression","left":"target.distance","comparator":"gt","right":{"type":"number","value":100}}],"action":"move_inward"}]
                """);
        MatchPlaybackDTO meleeResult = service.simulate(request(
                arena(1500, List.of()),
                fighter("melee", "Melee", 1, 100, 400, "melee", moveBrain),
                fighter("target", "Target", 2, 700, 400, idleBrain)));
        MatchPlaybackDTO rangedResult = service.simulate(request(
                arena(1500, List.of()),
                fighter("ranged", "Ranged", 1, 100, 400, "ranged", moveBrain),
                fighter("target", "Target", 2, 700, 400, idleBrain)));

        assertThat(meleeResult.frames().get(0).fighters().getFirst().x()).isEqualTo(104.0);
        assertThat(meleeResult.frames().get(1).fighters().getFirst().x()).isEqualTo(112.0);
        assertThat(meleeResult.frames().get(11).fighters().getFirst().x()).isEqualTo(232.0);
        assertThat(rangedResult.frames().get(11).fighters().getFirst().x()).isEqualTo(192.0);
        assertThat(meleeResult.frames().getLast().fighters().getFirst().x())
                .isGreaterThan(rangedResult.frames().getLast().fighters().getFirst().x());
    }

    @Test
    void oppositeMovementInputBrakesBeforeReversingDirection() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(500, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"expression","left":"my.edgeDistance","comparator":"gt","right":{"type":"number","value":75}}],"action":"move_west"},
                          {"priority":2,"conditions":[{"type":"always"}],"action":"move_east"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().get(0).fighters().getFirst().x()).isEqualTo(104.0);
        assertThat(result.frames().get(1).fighters().getFirst().x()).isEqualTo(112.0);
        assertThat(result.frames().get(2).fighters().getFirst().x()).isEqualTo(112.0);
        assertThat(result.frames().get(3).fighters().getFirst().x()).isEqualTo(108.0);
        assertThat(result.frames().get(4).fighters().getFirst().x()).isEqualTo(100.0);
    }

    @Test
    void releasedAxisDecaysByOneTickWhileOppositeAxisBrakesHarder() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(700, List.of()),
                fighter("fighter-1", "One", 1, 400, 400, brain("""
                        [
                          {"priority":1,"conditions":[{"type":"expression","left":"my.edgeDistance","comparator":"gt","right":{"type":"number","value":360}}],"action":"move_northeast"},
                          {"priority":2,"conditions":[{"type":"always"}],"action":"move_west"}
                        ]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        double previousXDelta = result.frames().get(4).fighters().getFirst().x()
                - result.frames().get(3).fighters().getFirst().x();
        double nextXDelta = result.frames().get(5).fighters().getFirst().x()
                - result.frames().get(4).fighters().getFirst().x();
        double previousYDelta = result.frames().get(4).fighters().getFirst().y()
                - result.frames().get(3).fighters().getFirst().y();
        double nextYDelta = result.frames().get(5).fighters().getFirst().y()
                - result.frames().get(4).fighters().getFirst().y();

        assertThat(Math.abs(previousXDelta - nextXDelta - 4.0)).isLessThan(0.01);
        assertThat(Math.abs(nextYDelta)).isLessThan(Math.abs(previousYDelta));
    }

    @Test
    void abilitiesDoNotImplicitlyRotateTowardTheirTarget() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(500, List.of()),
                fighter("fighter-1", "One", 1, 400, 400, brain("""
                        [{"priority":1,"conditions":[{"type":"always"}],"action":"swing","actionTarget":"opponent"}]
                        """)),
                fighter("fighter-2", "Two", 2, 400, 100, idleBrain)));

        assertThat(result.frames()).allSatisfy(frame ->
                assertThat(frame.fighters().getFirst().rotation()).isEqualTo(90.0));
    }

    @Test
    void explicitRotationActionStillTurnsTowardItsTarget() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(200, List.of()),
                fighter("fighter-1", "One", 1, 400, 400, brain("""
                        [{"priority":1,"conditions":[{"type":"always"}],"action":"rotate_toward_enemy","actionTarget":"opponent"}]
                        """)),
                fighter("fighter-2", "Two", 2, 400, 100, idleBrain)));

        assertThat(result.frames().getFirst().fighters().getFirst().rotation()).isNotEqualTo(0.0);
    }

    @Test
    void pistolAndConcussiveShotsUseTheFighterCircleInsteadOfAnAngularCone() throws Exception {
        for (String ability : List.of("pistol_shot", "concussive_shot")) {
            JsonNode attackerBrain = jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1",
                     "loadout":{"abilities":["%s"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                     "blocks":[{"priority":1,"conditions":[{"type":"always"}],"action":"%s"}]}
                    """.formatted(ability, ability));
            JsonNode defenderBrain = jsonMapper.readTree("""
                    {"version":"bot-logic-tree-v1",
                     "loadout":{"abilities":[],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                     "blocks":[]}
                    """);

            MatchPlaybackDTO miss = service.simulate(request(
                    arena(700, List.of()),
                    fighter("fighter-1", "One", 1, 100, 400, "custom", attackerBrain),
                    fighter("fighter-2", "Two", 2, 500, 500, "custom", defenderBrain)));
            MatchPlaybackDTO edgeHit = service.simulate(request(
                    arena(700, List.of()),
                    fighter("fighter-1", "One", 1, 100, 400, "custom", attackerBrain),
                    fighter("fighter-2", "Two", 2, 500, 425, "custom", defenderBrain)));

            assertThat(miss.frames().getLast().fighters().get(1).hp()).as(ability + " cone miss").isEqualTo(100);
            assertThat(edgeHit.frames().getLast().fighters().get(1).hp()).as(ability + " circle hit").isLessThan(100);
        }
    }

    @Test
    void noDashDoesNotSuppressAnEligiblePistolShot() throws Exception {
        JsonNode attackerBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":["pistol_shot"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                 "blocks":[
                   {"priority":1,"conditions":[{"type":"always"}],"action":"no_dash"},
                   {"priority":1,"conditions":[{"type":"always"}],"action":"pistol_shot"}
                 ]}
                """);
        JsonNode defenderBrain = jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1",
                 "loadout":{"abilities":[],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                 "blocks":[]}
                """);

        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("fighter-1", "One", 1, 100, 400, "custom", attackerBrain),
                fighter("fighter-2", "Two", 2, 500, 400, "custom", defenderBrain)));

        assertThat(result.frames().getFirst().fighters().get(1).hp()).isEqualTo(96);
    }

    @Disabled("Removed arena-object contract")
    @Test
    void buffObjectsGrantEffectsWhenKilledByLastHit() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(3_200, List.of(new ObstacleRequest("object_buff_1", "overdrive", 150.0, 400.0, 76))),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{"priority":1,"conditions":[{"type":"always"}],"action":"swing","actionTarget":"object_buff_1"}]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().getLast().obstacles())
                .extracting(MatchPlaybackDTO.ObstaclePlacementDTO::type)
                .doesNotContain("overdrive");
    }

    @Disabled("Removed arena-object contract")
    @Test
    void generatedCenterBuffsAreEvenlySpacedAroundCenterObjective() {
        List<MatchPlaybackDTO.ObstaclePlacementDTO> obstacles = service.createMatchObstaclePlacements(
                123L,
                1600,
                1600,
                List.of(
                        fighter("fighter-1", "One", 1, 100, 400, idleBrain),
                        fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(obstacles).hasSize(3);
        assertThat(obstacles).extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                .doesNotContain("object_1", "object_2", "object_3");

        MatchPlaybackDTO.ObstaclePlacementDTO center = obstacles.stream()
                .filter(obstacle -> "object_center".equals(obstacle.id()))
                .findFirst()
                .orElseThrow();
        MatchPlaybackDTO.ObstaclePlacementDTO left = obstacles.stream()
                .filter(obstacle -> "object_buff_1".equals(obstacle.id()))
                .findFirst()
                .orElseThrow();
        MatchPlaybackDTO.ObstaclePlacementDTO right = obstacles.stream()
                .filter(obstacle -> "object_buff_2".equals(obstacle.id()))
                .findFirst()
                .orElseThrow();

        assertThat(center.x() - left.x()).isEqualTo(right.x() - center.x());
        assertThat(center.x() - left.x()).isEqualTo(400.0);
        assertThat(left.y()).isEqualTo(center.y());
        assertThat(right.y()).isEqualTo(center.y());
    }

    @Disabled("Removed arena-object contract")
    @Test
    void radarJammerAppliesJammedAfterFiveSecondCapture() {
        MatchPlaybackDTO result = service.simulate(request(
                arena(5_500, List.of(new ObstacleRequest("object_center", "radarJammer", 100.0, 400.0, 92))),
                fighter("fighter-1", "One", 1, 100, 400, brain("""
                        [{
                          "priority":1,
                          "conditions":[{
                            "type":"expression",
                            "left":"opponent.jammedMs",
                            "comparator":"gt",
                            "right":{"type":"number","value":4}
                          }],
                          "action":"move_east"
                        }]
                        """)),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.frames().get(49).obstacles())
                .extracting(MatchPlaybackDTO.ObstaclePlacementDTO::id)
                .doesNotContain("object_center");
        assertThat(result.frames().getLast().fighters().getFirst().x()).isGreaterThan(100);
    }

    @Disabled("Removed arena-object contract")
    @Test
    void explicitArenaKeepsAllCenterAndPlayerObjectsWithoutRandomPadding() {
        List<ObstacleRequest> objects = List.of(
                new ObstacleRequest("object_center", "radarJammer", 400.0, 400.0, 92),
                new ObstacleRequest("object_buff_1", "overdrive", 200.0, 400.0, 76),
                new ObstacleRequest("object_buff_2", "barrier", 600.0, 400.0, 76),
                new ObstacleRequest("object_1", "healthPack", 300.0, 120.0, 42),
                new ObstacleRequest("object_2", "projectileWall", 340.0, 200.0, 120),
                new ObstacleRequest("object_3", "bouncyWall", 380.0, 220.0, 120),
                new ObstacleRequest("object_4", "healthPack", 300.0, 680.0, 42),
                new ObstacleRequest("object_5", "projectileWall", 340.0, 600.0, 120),
                new ObstacleRequest("object_6", "bouncyWall", 380.0, 580.0, 120));

        MatchPlaybackDTO result = service.simulate(request(
                arena(0, objects),
                fighter("fighter-1", "One", 1, 100, 400, idleBrain),
                fighter("fighter-2", "Two", 2, 700, 400, idleBrain)));

        assertThat(result.initialState().obstacles()).hasSize(11);
        assertThat(result.initialState().obstacles()).filteredOn(obstacle -> "core".equals(obstacle.type())).hasSize(2);
        assertThat(result.initialState().obstacles())
                .filteredOn(obstacle -> "object_6".equals(obstacle.id()))
                .singleElement()
                .satisfies(obstacle -> {
                    assertThat(obstacle.x()).isEqualTo(380.0);
                    assertThat(obstacle.y()).isEqualTo(580.0);
                });
    }

    private DuelSimulationRequest request(
            DuelArenaRequest arena,
            DuelFighterRequest first,
            DuelFighterRequest second) {
        return new DuelSimulationRequest(
                UUID.nameUUIDFromBytes("match".getBytes()),
                DuelSimulationService.DUEL_RULESET_VERSION,
                123L,
                arena,
                List.of(first, second));
    }

    private DuelArenaRequest arena(int durationMs, List<ObstacleRequest> obstacles) {
        return new DuelArenaRequest(1600, 1600, durationMs, obstacles);
    }

    private DuelFighterRequest fighter(String id, String username, int slot, double x, double y, JsonNode brain) {
        return fighter(id, username, slot, x, y, "melee", brain);
    }

    private DuelFighterRequest fighter(String id, String username, int slot, double x, double y, String selectedLoadout, JsonNode brain) {
        return new DuelFighterRequest(
                UUID.nameUUIDFromBytes(id.getBytes()),
                username,
                slot,
                x,
                y,
                slot == 1 ? 90.0 : 270.0,
                60,
                selectedLoadout,
                brain);
    }

    private JsonNode brain(String blocksJson) {
        return brainWithClusters(blocksJson, "[]");
    }

    @Test
    void targetDirectionSupportsAReversedRangeThatWrapsAroundTheCircle() {
        JsonNode directionBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"target.bearingFromMe","comparator":"range","target":"opponent","right":{"type":"range","min":32,"max":30}}],"action":"move_west"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(100, List.of()),
                fighter("walker", "Walker", 1, 500, 400, "custom", directionBrain),
                fighter("target", "Target", 2, 400, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getFirst().fighters().getFirst().x()).isLessThan(500);
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
                arena(800, List.of()),
                fighter("fireball-first", "One", 1, 100, 400, "custom", fireballFirst),
                fighter("idle-1", "Two", 2, 700, 400, "custom", idle)));

        assertThat(afterFireball.frames().getFirst().fighters().getFirst().fireballCharges()).isEqualTo(3);
        assertThat(afterFireball.frames()).anyMatch(frame -> "concussive_shot".equals(frame.fighters().getFirst().preparingAbility()));

        JsonNode concussiveFirst = customBrain("[\"shoot_fireball\",\"concussive_shot\"]", """
                [
                  {"priority":1,"conditions":[{"type":"always"}],"action":"concussive_shot"},
                  {"priority":2,"conditions":[{"type":"always"}],"action":"shoot_fireball"}
                ]
                """);
        MatchPlaybackDTO afterConcussive = service.simulate(request(
                arena(800, List.of()),
                fighter("concussive-first", "One", 1, 100, 400, "custom", concussiveFirst),
                fighter("idle-2", "Two", 2, 700, 400, "custom", idle)));

        assertThat(afterConcussive.frames()).anyMatch(frame -> "concussive_shot".equals(frame.fighters().getFirst().preparingAbility()));
        assertThat(afterConcussive.frames().getLast().fighters().getFirst().fireballCharges()).isEqualTo(3);
    }

    @Test
    void authoritativeSimulatorExecutesAndClampsCustomVariableNodes() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":99990}],
                  "columns":[
                    {"createdOrder":0,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"always"}],"actions":[{"action":"variable","variableId":"custom.counter","operation":"add","value":50}],"children":[]}]},
                    {"createdOrder":1,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"expression","left":"custom.counter","comparator":"eq","right":{"type":"number","value":99999}}],"actions":[{"action":"move_walk","movementMode":"absolute","movementDirection":"east"}],"children":[]}]}
                  ]
                }
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(400, List.of()),
                fighter("variables", "Variables", 1, 100, 400, "custom", variableBrain),
                fighter("idle", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().fighters().getFirst().x()).isGreaterThan(100);
    }

    @Test
    void authoritativeSimulatorActivatesAbilityFromIncrementedCustomVariable() throws Exception {
        JsonNode variableBrain = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["swing"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                  "columns":[
                    {"createdOrder":0,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"always"}],"actions":[{"action":"variable","variableId":"custom.counter","terms":[{"operator":"add","operand":{"type":"number","value":1}}]}],"children":[]}]},
                    {"createdOrder":1,"branches":[{"branchType":"if","createdOrder":0,"conditions":[{"type":"expression","left":"custom.counter","comparator":"gte","right":{"type":"number","value":2}}],"actions":[{"action":"swing"}],"children":[]}]}
                  ]
                }
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(1_000, List.of()),
                fighter("variables-ability", "Variables", 1, 100, 400, "custom", variableBrain),
                fighter("idle-ability", "Idle", 2, 180, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames()).anyMatch(frame -> frame.fighters().getFirst().swingActive());
        assertThat(result.frames().getLast().fighters().get(1).hp()).isLessThan(100);
    }

    @Test
    void authoritativeSimulatorExposesElapsedMatchSeconds() {
        JsonNode timedBrain = customBrain("[]", """
                [{"priority":1,"conditions":[{"type":"expression","left":"match.elapsedSeconds","comparator":"gte","right":{"type":"number","value":0.2}}],"action":"move_west"}]
                """);
        MatchPlaybackDTO result = service.simulate(request(
                arena(500, List.of()),
                fighter("timer", "Timer", 1, 500, 400, "custom", timedBrain),
                fighter("idle-timer", "Idle", 2, 700, 400, "custom", customBrain("[]", "[]"))));

        assertThat(result.frames().getLast().fighters().getFirst().x()).isLessThan(500);
    }

    private JsonNode customBrain(String abilitiesJson, String blocksJson) {
        try {
            return jsonMapper.readTree("""
                    {"version":"melee-logic-blocks-v2","loadout":{"abilities":%s,"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},"blocks":%s,"clusters":[]}
                    """.formatted(abilitiesJson, blocksJson));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }

    private JsonNode brainWithClusters(String blocksJson, String clustersJson) {
        try {
            return jsonMapper.readTree("""
                    {
                      "version":"melee-logic-blocks-v2",
                      "blocks":%s,
                      "clusters":%s
                    }
                    """.formatted(blocksJson, clustersJson));
        } catch (Exception ex) {
            throw new IllegalStateException(ex);
        }
    }
}
