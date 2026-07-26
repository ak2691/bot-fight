package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.ModelSubmissionPayloadDTO;
import com.example.botfight.simulation.combat.CombatCatalog;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Disabled;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class ModelSubmissionValidationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final ModelSubmissionValidationService service = new ModelSubmissionValidationService(
            jsonMapper,
            new CombatCatalog());

    @Test
    void acceptsValidDeterministicBrainContract() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getStatus()).isEqualTo("ACCEPTED");
        assertThat(result.getComputedModelHash()).isNull();
        assertThat(result.getWarnings()).contains(
                "trainingDurationMs will be computed from the server-owned training session");
    }

    @Test
    void acceptsEmptyLogicBlockList() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"melee-logic-tree-v1","blocks":[]}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsTheSixAbilityRoundThreeLoadoutMaximum() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "loadout":{
                    "abilities":["swing","block","rail_shot","micro_dash","orbital_strike","null_zone"],
                    "statPoints":{"maxHp":3,"moveSpeed":3,"attackDamage":3,"attackSpeed":3}
                  },
                  "blocks":[]
                }
                """));

        assertThat(service.validate(payload).isAccepted()).isTrue();
    }

    @Disabled("Removed arena-object contract")
    @Test
    void acceptsClusteredLogicBlocksWithinLimit() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[],
                  "clusters":[
                    {
                      "id":"cluster-1",
                      "priority":4,
                      "conditions":[{"type":"my_hp_lt","value":50}],
                      "blocks":[
                        {"id":"block-1","priority":1,"action":"move_inward","conditions":[{"type":"target_health_pack","target":"object_1"}]}
                      ]
                    }
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsNestedLogicColumns() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "columns":[{
                    "id":"column-1","createdOrder":1,
                    "branches":[{
                      "id":"branch-1","branchType":"if","createdOrder":1,
                      "action":"move_inward","conditions":[{"type":"always"}],
                      "children":[
                        {"id":"nested-1","branchType":"if","createdOrder":2,"action":"dash","conditions":[{"type":"always"}],"children":[]},
                        {"id":"nested-2","branchType":"else","createdOrder":3,"action":"move_stop","conditions":[],"children":[]}
                      ]
                    }]
                  }]
                }
                """));

        var result = service.validate(payload);
        assertThat(result.getErrors()).isEmpty();
        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void rejectsElseBeforeElseIfInLogicColumn() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"melee-logic-tree-v1","columns":[{"id":"column-1","branches":[
                  {"id":"first","branchType":"if","action":"move_inward","conditions":[{"type":"always"}],"children":[]},
                  {"id":"fallback","branchType":"else","action":"stop","conditions":[],"children":[]},
                  {"id":"late","branchType":"else_if","action":"move_outward","conditions":[{"type":"always"}],"children":[]}
                ]}]}
                """));

        var result = service.validate(payload);
        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).anyMatch(error -> error.contains("else branch must be last"));
    }

    @Disabled("Removed arena boost/timer variables")
    @Test
    void acceptsPositionAndBuffTimerExpressionConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {
                      "id":"block-1",
                      "priority":1,
                      "action":"move_center",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.x",
                          "comparator":"lt",
                          "right":{"type":"number","value":240}
                        },
                        {
                          "type":"expression",
                          "left":"opponent.y",
                          "comparator":"gte",
                          "right":{"type":"number","value":300}
                        },
                        {
                          "type":"expression",
                          "left":"my.overdriveMs",
                          "comparator":"gt",
                          "right":{"type":"number","value":2}
                        },
                        {
                          "type":"expression",
                          "left":"opponent.commandLockedMs",
                          "comparator":"lte",
                          "right":{"type":"number","value":1}
                        }
                      ]
                    }
                  ],
                  "clusters":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsExpressionConditionsWithVariableComparisons() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {
                      "id":"block-1",
                      "priority":1,
                      "action":"move_inward",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.hp",
                          "comparator":"lt",
                          "right":{"type":"variable","value":"opponent.hp"}
                        },
                        {
                          "type":"expression",
                          "left":"my.x",
                          "comparator":"gte",
                          "right":{"type":"number","value":300}
                        },
                        {
                          "type":"expression",
                          "join":"or",
                          "left":"my.selectedAbilityReady",
                          "ability":"dash",
                          "comparator":"eq",
                          "right":{"type":"boolean","value":true}
                        }
                      ]
                    }
                  ],
                  "clusters":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void rejectsRemovedFixedAbilityVariables() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {
                      "id":"block-1",
                      "priority":1,
                      "action":"move_inward",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.dashReady",
                          "comparator":"lt",
                          "right":{"type":"number","value":1}
                        }
                      ]
                    }
                  ],
                  "clusters":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks[0].conditions[0].left is not an allowed variable");
    }

    @Test
    void ignoresLegacyClientModelHash() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setModelHash("sha256:tampered");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getComputedModelHash()).isNull();
        assertThat(result.getWarnings()).noneMatch(warning -> warning.contains("modelHash"));
    }

    @Test
    void rejectsUnsupportedBrainSchemaVersion() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        ((tools.jackson.databind.node.ObjectNode) payload.getBrain()).put("version", "future-brain-v2");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains("brain.version must be melee-logic-tree-v1");
    }

    @Test
    void ignoresLegacyTrainingFields() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setTrainingSteps(1);
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"trainingSamples":1,"epochsCompleted":1}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Disabled("Actions are loadout-gated instead of class-gated")
    @Test
    void rejectsRangedDashActionsAndOwnDashConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"dash","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks[0].action is not allowed for ranged");
    }

    @Test
    void rejectsRemovedDirectAbilityConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"dash","conditions":[{"type":"my_dash_ready"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks[0].conditions[0].type must be always or expression");
    }

    @Test
    void rejectsRemovedOpponentAbilityConditions() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"move_outward","conditions":[{"type":"opponent_shield_up"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks[0].conditions[0].type must be always or expression");
    }

    @Disabled("Actions are loadout-gated instead of class-gated")
    @Test
    void acceptsRangedGrenadeActionAndRejectsItForMelee() throws Exception {
        ModelSubmissionPayloadDTO rangedPayload = validPayload();
        rangedPayload.setSelectedClass("ranged");
        rangedPayload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"throw_grenade","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var rangedResult = service.validate(rangedPayload);

        assertThat(rangedResult.isAccepted()).isTrue();

        ModelSubmissionPayloadDTO meleePayload = validPayload();
        meleePayload.setSelectedClass("melee");
        meleePayload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"throw_grenade","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var meleeResult = service.validate(meleePayload);

        assertThat(meleeResult.isAccepted()).isFalse();
        assertThat(meleeResult.getErrors()).contains(
                "brain.blocks[0].action is not allowed for melee");
    }

    @Test
    void acceptsAlwaysConditionAndArenaRelativeMovement() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"move_north","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsAlwaysConditionAndArenaRelativeDashForMelee() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "blocks":[
                    {"id":"block-1","priority":1,"action":"dash_north","conditions":[{"type":"always"}]}
                  ]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsOneActionPerExecutionCategoryOnTheSameConditional() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "columns":[{"branches":[{
                    "branchType":"if",
                    "actions":[
                      {"action":"move_inward","actionTarget":"opponent"},
                      {"action":"rotate_toward_enemy","actionTarget":"opponent"},
                      {"action":"swing"}
                    ],
                    "conditions":[{"type":"always"}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).isAccepted()).isTrue();
    }

    @Test
    void rejectsMultipleActionsFromTheSameExecutionCategory() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "columns":[{"branches":[{
                    "branchType":"if",
                    "actions":[{"action":"move_inward"},{"action":"move_outward"}],
                    "conditions":[{"type":"always"}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.columns[0].branches[0] has multiple movement actions");
    }

    @Test
    void validatesFightOnlyTargetsAndLoadoutBudget() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "loadout":{
                    "abilities":["swing","dash","block"],
                    "statPoints":{"maxHp":5,"moveSpeed":4,"attackDamage":4,"attackSpeed":0}
                  },
                  "columns":[{"branches":[{
                    "branchType":"if","action":"fire_gun","actionTarget":"defender_core",
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.loadout.statPoints exceeds the match budget of 12",
                "brain.columns[0].branches[0].actionTarget is not an allowed fight target",
                "brain.columns[0].branches[0].action requires equipped ability fire_gun");
    }

    @Test
    void acceptsGenericSelectedAbilityAmmoCondition() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "loadout":{"abilities":["fire_gun"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "columns":[{"branches":[{
                    "branchType":"if","action":"fire_gun",
                    "conditions":[{"type":"expression","left":"my.selectedAbilityAmmo","ability":"fire_gun","comparator":"gt","right":{"type":"number","value":0}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void acceptsEquippedDuelV1AbilityActionInColumnBrain() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("duel-v1");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "loadout":{"abilities":["concussive_shot"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "columns":[{"branches":[{
                    "branchType":"if","actions":[{"action":"concussive_shot"}],
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void rejectsUnequippedDuelV1VariantAction() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedClass("duel-v1");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"melee-logic-tree-v1",
                  "loadout":{"abilities":[],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "columns":[{"branches":[{
                    "branchType":"if","actions":[{"action":"phase_strike_keep_facing"}],
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors())
                .contains("brain.columns[0].branches[0].actions[0].action requires equipped ability phase_strike");
    }

    @Test
    void acceptsBoundedCustomVariableConditionAndMutationNode() throws Exception {
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"melee-logic-tree-v1","customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                 "columns":[{"branches":[{"branchType":"if","conditions":[{"type":"expression","left":"custom.counter","comparator":"lt","right":{"type":"number","value":10}}],"actions":[{"action":"variable","variableId":"custom.counter","operation":"add","value":1}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void rejectsCustomVariablesWhoseDerivedConditionsExceedSlotBudget() throws Exception {
        String variables = java.util.stream.IntStream.range(0, 51)
                .mapToObj(index -> "{\"id\":\"custom.v" + index + "\",\"name\":\"Variable " + index + "\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[{\"type\":\"always\"}]}")
                .collect(java.util.stream.Collectors.joining(","));
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"melee-logic-tree-v1\",\"customVariables\":[" + variables + "],\"columns\":[]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain.customVariables exceeds the 100 variable-slot limit");
    }

    @Test
    void rejectsMoreThanOneHundredEmptyBrainNodes() throws Exception {
        String columns = java.util.stream.IntStream.range(0, 101)
                .mapToObj(index -> "{\"id\":\"column-" + index + "\",\"name\":\"Node " + index + "\",\"branches\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"melee-logic-tree-v1\",\"customVariables\":[],\"columns\":[" + columns + "]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain.columns exceeds the column limit");
    }

    @Test
    void derivedVariableUsesChargeTheirFullCostToTheConditionBudget() throws Exception {
        String derived = java.util.stream.IntStream.range(0, 99)
                .mapToObj(index -> "{\"type\":\"always\"}")
                .collect(java.util.stream.Collectors.joining(","));
        String uses = java.util.stream.IntStream.range(0, 3)
                .mapToObj(index -> "{\"branchType\":\"" + (index == 0 ? "if" : "else_if") + "\",\"conditions\":[{\"type\":\"expression\",\"left\":\"custom.derived\",\"comparator\":\"eq\",\"right\":{\"type\":\"boolean\",\"value\":true}}],\"actions\":[],\"children\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        ModelSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"melee-logic-tree-v1\",\"customVariables\":[{\"id\":\"custom.derived\",\"name\":\"Derived\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[" + derived + "]}],\"columns\":[{\"branches\":[" + uses + "]}]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain exceeds the total condition limit including derived custom variables");
    }

    private ModelSubmissionPayloadDTO validPayload() throws Exception {
        ModelSubmissionPayloadDTO payload = new ModelSubmissionPayloadDTO();
        payload.setArchitectureVersion("deterministic-logic-v1");
        payload.setFeatureSchemaVersion("duel-logic-features-v1");
        payload.setActionSchemaVersion("melee-logic-actions-v1");
        payload.setModelFormat("logic-blocks-v1");
        payload.setTrainingSessionId("11111111-1111-1111-1111-111111111111");
        payload.setTrainingDurationMs(null);
        payload.setTrainingSteps(0);
        payload.setTrainingMetrics(jsonMapper.readTree("""
                {"version":"deterministic-logic-check-v1","trainingSamples":0,"epochsCompleted":0}
                """));
        payload.setSelectedClass("melee");

        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "melee-logic-tree-v1",
                  "blocks": [
                    {"id":"block-1","action":"move_inward","conditions":[]}
                  ]
                }
                """);
        payload.setBrain(brain);
        payload.setClientBuildVersion("test");
        return payload;
    }
}
