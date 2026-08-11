package com.example.botfight.service;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.DTO.BotSubmissionPayloadDTO;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import java.util.List;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.Disabled;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;

class BotSubmissionValidationServiceTest {

    private final JsonMapper jsonMapper = new JsonMapper();
    private final BotSubmissionValidationService service = new BotSubmissionValidationService(
            jsonMapper,
            new GameConfigCatalog());

    @Test
    void acceptsValidDeterministicBrainContract() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getStatus()).isEqualTo("ACCEPTED");
        assertThat(result.getWarnings()).isEmpty();
    }

    @Test
    void rejectsStandardAbilitiesInClientLoadoutsBecauseTheyAreGrantedByTheServer() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{
                    "abilities":["dash","lock_on"],
                    "statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}
                  },
                  "roots":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.loadout.abilities contains an invalid or duplicate ability");
    }

    @Test
    void rejectsTheLegacyBasicHealIdFromNewSubmissions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{
                    "abilities":["repair_pulse"],
                    "statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}
                  },
                  "roots":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.loadout.abilities contains an invalid or duplicate ability");
    }

    @Test
    void acceptsEmptyRootList() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[]}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void rejectsRetiredBlocksSchema() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","blocks":[],"clusters":[]}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.blocks is no longer supported",
                "brain.clusters is no longer supported",
                "brain.roots must be an array");
    }

    @Test
    void acceptsTheSixAbilityRoundThreeLoadoutMaximum() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{
                    "abilities":["swing","block","rail_shot","phase_strike","orbital_strike","null_zone"],
                    "statPoints":{"maxHp":3,"moveSpeed":3,"attackDamage":3,"attackSpeed":3}
                  },
                  "roots":[]
                }
                """));

        assertThat(service.validate(payload).isAccepted()).isTrue();
    }

    @Test
    void acceptsNestedLogicRoots() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{
                    "createdOrder":1,
                    "branches":[{
                      "id":"branch-1","branchType":"if","createdOrder":1,
                      "action":"move_walk","movementMode":"target","movementDirection":"toward","conditions":[{"type":"always"}],
                      "children":[
                        {"id":"nested-1","branchType":"if","createdOrder":2,"action":"dash","movementMode":"absolute","movementDirection":"north","conditions":[{"type":"always"}],"children":[]},
                        {"id":"nested-2","branchType":"else","createdOrder":3,"action":"move_walk","movementMode":"absolute","movementDirection":"stop","conditions":[],"children":[]}
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
    void rejectsElseBeforeLaterConditionalInLogicRoot() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[
                  {"id":"first","branchType":"if","action":"move_walk","movementMode":"target","movementDirection":"toward","conditions":[{"type":"always"}],"children":[]},
                  {"id":"fallback","branchType":"else","action":"stop","conditions":[],"children":[]},
                  {"id":"late","branchType":"if","action":"move_walk","movementMode":"target","movementDirection":"away","conditions":[{"type":"always"}],"children":[]}
                ]}]}
                """));

        var result = service.validate(payload);
        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).anyMatch(error -> error.contains("else branch must be last"));
    }

    @Disabled("Removed arena boost/timer variables")
    @Test
    void acceptsPositionAndBuffTimerExpressionConditions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {
                      "id":"node-1",
                      "priority":1,
                      "action":"move_walk","movementMode":"coordinates","movementDirection":"toward","targetX":500,"targetY":400,
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
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsExpressionConditionsWithVariableComparisons() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {
                      "id":"node-1",
                      "priority":1,
                      "action":"move_walk","movementMode":"target","movementDirection":"toward",
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
                          "ability":"lock_on",
                          "comparator":"eq",
                          "right":{"type":"boolean","value":true}
                        }
                      ]
                    }
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void rejectsRemovedFixedAbilityVariables() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {
                      "id":"node-1",
                      "priority":1,
                      "action":"move_walk","movementMode":"target","movementDirection":"toward",
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"my.swingReady",
                          "comparator":"lt",
                          "right":{"type":"number","value":1}
                        }
                      ]
                    }
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].left is not an allowed variable");
    }

    @Test
    void rejectsUnsupportedBrainSchemaVersion() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        ((tools.jackson.databind.node.ObjectNode) payload.getBrain()).put("version", "future-brain-v2");

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains("brain.version must be bot-logic-tree-v1");
    }

    @Test
    void rejectsRemovedDirectAbilityConditions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {"id":"node-1","action":"lock_on","conditions":[{"type":"my_selected_ability_ready"}]}
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].type must be always or expression");
    }

    @Test
    void rejectsRemovedOpponentAbilityConditions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {"id":"node-1","action":"move_walk","movementMode":"target","movementDirection":"away","conditions":[{"type":"opponent_shield_up"}]}
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].type must be always or expression");
    }

    @Test
    void acceptsAlwaysConditionAndArenaRelativeMovement() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {"id":"node-1","action":"move_walk","movementMode":"absolute","movementDirection":"north","conditions":[{"type":"always"}]}
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void rejectsRetiredDirectionalActionIds() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{
                  "branchType":"if","actions":[{"action":"move_inward"}],
                  "conditions":[{"type":"always"}],"children":[]
                }]}]}
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.roots[0].branches[0].actions[0].action is not allowed for duel-v1");
    }

    @Test
    void acceptsAlwaysConditionAndStandardMicroDashForMelee() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {"id":"node-1","action":"dash","movementMode":"absolute","movementDirection":"north","conditions":[{"type":"always"}]}
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsOneActionPerExecutionCategoryOnTheSameConditional() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[{
                    "branchType":"if",
                    "actions":[
                      {"action":"move_walk","movementMode":"target","movementDirection":"toward","actionTarget":"opponent"},
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
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[{
                    "branchType":"if",
                    "actions":[{"action":"move_walk","movementMode":"target","movementDirection":"toward"},{"action":"move_walk","movementMode":"target","movementDirection":"away"}],
                    "conditions":[{"type":"always"}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0] has multiple movement actions");
    }

    @Test
    void validatesFightOnlyTargetsAndLoadoutBudget() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{
                    "abilities":["swing","block"],
                    "statPoints":{"maxHp":5,"moveSpeed":4,"attackDamage":4,"attackSpeed":0}
                  },
                  "roots":[{"branches":[{
                    "branchType":"if","action":"fire_gun","actionTarget":"defender_core",
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.loadout.statPoints exceeds the match budget of 12",
                "brain.roots[0].branches[0].actionTarget is not an allowed fight target",
                "brain.roots[0].branches[0].action requires equipped ability 3");
    }

    @Test
    void acceptsGenericSelectedAbilityAmmoCondition() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["fire_gun"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"fire_gun",
                    "conditions":[{"type":"expression","left":"my.selectedAbilityAmmo","ability":"fire_gun","comparator":"gt","right":{"type":"number","value":0}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void acceptsAndValidatesGenericSelectedStatusEffectCondition() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["shoot_fireball"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":"stop",
                    "conditions":[{"type":"expression","left":"my.selectedStatusEffectActive","statusEffect":"burn","comparator":"eq","right":{"type":"boolean","value":true}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["shoot_fireball"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":"stop",
                    "conditions":[{"type":"expression","left":"my.selectedStatusEffectActive","statusEffect":"not-real","comparator":"eq","right":{"type":"boolean","value":true}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].statusEffect must identify an allowed status effect");
    }

    @Test
    void acceptsStatusEffectDurationComparisonsOnlyAtOneDecimalPrecision() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["shoot_fireball"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":"stop",
                    "conditions":[{"type":"expression","left":"my.selectedStatusEffectDurationMs","statusEffect":"burn","comparator":"gte","right":{"type":"number","value":1.2}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["shoot_fireball"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":"stop",
                    "conditions":[{"type":"expression","left":"my.selectedStatusEffectDurationMs","statusEffect":"burn","comparator":"gte","right":{"type":"number","value":1.23}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].right.value for status-effect duration must use 0.1 second increments");
    }

    @Test
    void acceptsEquippedDuelV1AbilityActionInRootBrain() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("duel-v1");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["concussive_shot"],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","actions":[{"action":"concussive_shot"}],
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void rejectsRetiredConfiguredAbilityVariantAction() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("duel-v1");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[],"statPoints":{"maxHp":0,"moveSpeed":0,"attackDamage":0,"attackSpeed":0}},
                  "roots":[{"branches":[{
                    "branchType":"if","actions":[{"action":"phase_strike_keep_facing"}],
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors())
                .contains("brain.roots[0].branches[0].actions[0].action is not allowed for duel-v1");
    }

    @Test
    void acceptsBoundedCustomVariableConditionAndMutationNode() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                 "roots":[{"branches":[{"branchType":"if","conditions":[{"type":"expression","left":"custom.counter","comparator":"lt","right":{"type":"number","value":10}}],"actions":[{"action":"variable","variableId":"custom.counter","operation":"add","value":1}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void acceptsModuloConditionsWithNegativeDivisorsAndFloorsDecimalOperands() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":-10}],
                  "roots":[{"branches":[{"branchType":"if","conditions":[
                    {"type":"expression","left":"custom.counter","comparator":"modulo",
                     "modulo":{"divisor":-3.5,"comparator":"eq"},"right":{"type":"number","value":-1.5}}
                  ],"actions":[{"action":"move_walk","movementMode":"target","movementDirection":"toward"}],"children":[]}]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    void rejectsZeroAndRecursiveModuloOperatorsAtTheSubmissionBoundary() throws Exception {
        BotSubmissionPayloadDTO zeroPayload = validPayload();
        zeroPayload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"my.hp","comparator":"modulo",
                    "modulo":{"divisor":0,"comparator":"eq"},"right":{"type":"number","value":0}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":"toward"}],"children":[]}]}]}
                """));
        var zeroResult = service.validate(zeroPayload);

        assertThat(zeroResult.isAccepted()).isFalse();
        assertThat(zeroResult.getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].modulo.divisor cannot be 0");

        BotSubmissionPayloadDTO recursivePayload = validPayload();
        recursivePayload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"my.hp","comparator":"modulo",
                    "modulo":{"divisor":5,"comparator":"modulo"},"right":{"type":"number","value":0}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":"toward"}],"children":[]}]}]}
                """));
        var recursiveResult = service.validate(recursivePayload);

        assertThat(recursiveResult.isAccepted()).isFalse();
        assertThat(recursiveResult.getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].modulo.comparator must be an ordinary numeric comparison operator");
    }

    @Test
    void rejectsCustomVariablesWhoseDerivedConditionsExceedSlotBudget() throws Exception {
        String variables = java.util.stream.IntStream.range(0, 51)
                .mapToObj(index -> "{\"id\":\"custom.v" + index + "\",\"name\":\"Variable " + index + "\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[{\"type\":\"always\"}]}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[" + variables + "],\"roots\":[]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain.customVariables exceeds the 100 variable-slot limit");
    }

    @Test
    void rejectsMoreThanOneHundredEmptyBrainNodes() throws Exception {
        String roots = java.util.stream.IntStream.range(0, 101)
                .mapToObj(index -> "{\"branches\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[],\"roots\":[" + roots + "]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain.roots exceeds the root limit");
    }

    @Test
    void derivedVariableUsesChargeTheirFullCostToTheConditionBudget() throws Exception {
        String derived = java.util.stream.IntStream.range(0, 99)
                .mapToObj(index -> "{\"type\":\"always\"}")
                .collect(java.util.stream.Collectors.joining(","));
        String uses = java.util.stream.IntStream.range(0, 3)
                .mapToObj(index -> "{\"branchType\":\"" + (index == 0 ? "if" : "if") + "\",\"conditions\":[{\"type\":\"expression\",\"left\":\"custom.derived\",\"comparator\":\"eq\",\"right\":{\"type\":\"boolean\",\"value\":true}}],\"actions\":[],\"children\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[{\"id\":\"custom.derived\",\"name\":\"Derived\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[" + derived + "]}],\"roots\":[{\"branches\":[" + uses + "]}]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain exceeds the total condition limit including derived custom variables");
    }

    private BotSubmissionPayloadDTO validPayload() throws Exception {
        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setBuildingSessionId("11111111-1111-1111-1111-111111111111");
        payload.setSelectedLoadout("melee");

        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "bot-logic-tree-v1",
                  "roots": [{"branches":[
                    {"id":"node-1","action":"move_walk","movementMode":"target","movementDirection":"toward","conditions":[]}
                  ]}]
                }
                """);
        payload.setBrain(brain);
        payload.setClientBuildVersion("test");
        return payload;
    }
}
