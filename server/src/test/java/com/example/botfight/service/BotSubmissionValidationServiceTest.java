package com.example.botfight.service;

import com.example.botfight.service.submission.BotSubmissionValidationService;

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
                    "abilities":[19,20]
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
    void rejectsNonNumericAbilityIdsFromNewSubmissions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{
                    "abilities":["repair_pulse"]
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
    void rejectsNamedAbilityPayloadsFromNewSubmissions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":["swing"]},
                  "roots":[{"branches":[
                    {"action":"swing","conditions":[{"type":"always"}]}
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.loadout.abilities contains an invalid or duplicate ability",
                "brain.roots[0].branches[0].action is not allowed for duel-v1");
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
                    "abilities":[1,7,13,25,22,24]
                  },
                  "roots":[]
                }
                """));

        assertThat(service.validate(payload).isAccepted()).isTrue();
    }

    @Test
    void acceptsBoundedEditorNodePositionsAlongsideTheBrain() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "nodePositions":{
                    "rootNode:root-1":{"x":156,"y":50},
                    "condition:branch-1:root:root-1":{"x":80.25,"y":300.5}
                  },
                  "roots":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    void rejectsInvalidEditorNodePositions() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "nodePositions":{"rootNode:root-1":{"x":-1,"y":"50"}},
                  "roots":[]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.nodePositions.rootNode:root-1.x must be a finite coordinate from 0 to 1000000",
                "brain.nodePositions.rootNode:root-1.y must be a finite coordinate from 0 to 1000000");
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
                      "action":"move_walk","movementMode":"target","movementDirection":0,"conditions":[{"type":"always"}],
                      "children":[
                        {"id":"nested-1","branchType":"if","createdOrder":2,"action":19,"movementMode":"absolute","movementDirection":"north","conditions":[{"type":"always"}],"children":[]},
                        {"id":"nested-2","branchType":"else","createdOrder":3,"action":"move_walk","movementMode":"absolute","movementDirection":0,"conditions":[],"children":[]}
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
    void acceptsCanonicalOneBasedTreePriorities() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{
                    "id":"root-1","priority":2,"branches":[{
                      "id":"branch-1","branchType":"if","priority":1,
                      "action":"move_walk","movementMode":"target","movementDirection":0,
                      "conditions":[{"type":"always"}],"children":[]
                    }]
                  }]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    void rejectsZeroBasedCanonicalTreePriority() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"priority":0,"branches":[]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isFalse();
        assertThat(result.getErrors()).contains(
                "brain.roots[0].priority must be an integer between 1 and 100");
    }

    @Test
    void acceptsSignedMovementAnglesAndRejectsAnglesOutsideOneTurn() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[
                  {"action":"move_walk","movementMode":"coordinates","movementDirection":-90,
                   "targetX":500,"targetY":400,"targetOffsetX":80,"targetOffsetY":-60,"conditions":[]}
                ]}]}
                """));

        var accepted = service.validate(payload);

        assertThat(accepted.isAccepted()).isTrue();
        assertThat(accepted.getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[
                  {"action":"move_walk","movementMode":"target","movementDirection":361,"conditions":[]}
                ]}]}
                """));

        var rejected = service.validate(payload);

        assertThat(rejected.isAccepted()).isFalse();
        assertThat(rejected.getErrors()).anyMatch(error -> error.contains("movementDirection is not allowed"));
    }

    @Test
    void rejectsElseBeforeLaterConditionalInLogicRoot() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[
                  {"id":"first","branchType":"if","action":"move_walk","movementMode":"target","movementDirection":0,"conditions":[{"type":"always"}],"children":[]},
                  {"id":"fallback","branchType":"else","action":"stop","conditions":[],"children":[]},
                  {"id":"late","branchType":"if","action":"move_walk","movementMode":"target","movementDirection":180,"conditions":[{"type":"always"}],"children":[]}
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
                      "action":"move_walk","movementMode":"coordinates","movementDirection":0,"targetX":500,"targetY":400,
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"selectable.x","leftSelectable":"my_bot",
                          "comparator":"lt",
                          "right":{"type":"number","value":240}
                        },
                        {
                          "type":"expression",
                          "left":"selectable.y","leftSelectable":"opponent",
                          "comparator":"gte",
                          "right":{"type":"number","value":300}
                        },
                        {
                          "type":"expression",
                          "left":"bot.selectedAbilityActiveMs","leftSelectable":"my_bot","ability":33,
                          "comparator":"gt",
                          "right":{"type":"number","value":2}
                        },
                        {
                          "type":"expression",
                          "left":"bot.selectedStatusEffectDurationMs","leftSelectable":"opponent",
                          "statusEffect":"silence",
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
    void boundsRootNamesAtTwentyFiveCharactersAndAllowsSpaces() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"name":"Close Range Priority Root","branches":[]}]
                }
                """));

        assertThat(service.validate(payload).isAccepted()).isTrue();

        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"name":"12345678901234567890123456","branches":[]}]
                }
                """));

        var rejected = service.validate(payload);

        assertThat(rejected.isAccepted()).isFalse();
        assertThat(rejected.getErrors()).contains(
                "brain.roots[0].name must be 1 to 25 characters");
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
                      "action":"move_walk","movementMode":"target","movementDirection":0,
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"selectable.hp","leftSelectable":"my_bot",
                          "comparator":"lt",
                          "right":{"type":"variable","value":"selectable.hp"},"rightSelectable":"opponent"
                        },
                        {
                          "type":"expression",
                          "left":"selectable.x","leftSelectable":"my_bot",
                          "comparator":"gte",
                          "right":{"type":"number","value":300}
                        },
                        {
                          "type":"expression",
                          "join":"or",
                          "left":"bot.selectedAbilityReady","leftSelectable":"my_bot",
                          "ability":20,
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
    void acceptsPuzzleRuleGraphWithCustomVariableModifyAction() throws Exception {
        JsonNode puzzleRules = jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[
                    {"id":"custom.puzzle.counter","name":"Counter","valueType":"number","initialValue":0}
                  ],
                  "roots":[
                    {"kind":"modify","branches":[
                      {"conditions":[{"type":"always"}],"actions":[
                        {"action":"variable","variableId":"custom.puzzle.counter","terms":[
                          {"operator":"add","operand":{"type":"number","value":1}}
                        ]}
                      ],"children":[]}
                    ]},
                    {"kind":"win","branches":[
                      {"action":"none","conditions":[
                        {"type":"expression","left":"custom.puzzle.counter","comparator":"gte","right":{"type":"number","value":1}}
                      ],"actions":[],"children":[]}
                    ]}
                  ]
                }
                """);

        var errors = service.validateForSimulation(puzzleRules);

        assertThat(errors).isEmpty();
    }

    @Test
    void rejectsUnsupportedFixedAbilityVariables() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("ranged");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {
                      "id":"node-1",
                      "priority":1,
                      "action":"move_walk","movementMode":"target","movementDirection":0,
                      "conditions":[
                        {
                          "type":"expression",
                          "left":"bot.swingReady",
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
                    {"id":"node-1","action":20,"conditions":[{"type":"my_selected_ability_ready"}]}
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
                    {"id":"node-1","action":"move_walk","movementMode":"target","movementDirection":180,"conditions":[{"type":"opponent_shield_up"}]}
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
                    {"id":"node-1","action":"move_walk","movementMode":"absolute","movementDirection":0,"conditions":[{"type":"always"}]}
                  ]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
    }

    @Test
    void acceptsSignedAbsoluteWalkDegrees() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {"id":"node-1","action":"move_walk","movementMode":"absolute","movementDirection":-90,"conditions":[{"type":"always"}]}
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
    void acceptsAlwaysConditionAndStandardDashForMelee() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("melee");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "roots":[{"branches":[
                    {"id":"node-1","action":19,"movementMode":"absolute","movementDirection":"north","conditions":[{"type":"always"}]}
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
                      {"action":"move_walk","movementMode":"target","movementDirection":0,"selectable":"opponent"},
                      {"action":"rotate_toward_enemy","selectable":"opponent"},
                      {"action":1}
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
                    "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0},{"action":"move_walk","movementMode":"target","movementDirection":180}],
                    "conditions":[{"type":"always"}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0] has multiple movement actions");
    }

    @Test
    void validatesFightOnlyTargets() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{
                    "abilities":[1,"block"]
                  },
                  "roots":[{"branches":[{
                    "branchType":"if","action":3,"selectable":"defender_core",
                    "conditions":[{"type":"always"}],"children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].selectable is not an allowed selectable",
                "brain.roots[0].branches[0].action requires equipped ability 3");
    }

    @Test
    void acceptsGenericSelectedAbilityChargesCondition() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[3]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":3,
                    "conditions":[{"type":"expression","left":"bot.selectedAbilityCharges","ability":3,"comparator":"gt","right":{"type":"number","value":0}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void validatesSelectedAbilityMetadataWhenTheAbilityVariableIsOnTheRight() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[33]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":0,
                    "conditions":[{"type":"expression","left":"selectable.hp","leftSelectable":"my_bot","comparator":"lt","right":{"type":"variable","value":"bot.selectedAbilityCooldownMs"},"rightSelectable":"my_bot","ability":33}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        ((tools.jackson.databind.node.ObjectNode) payload.getBrain().at("/roots/0/branches/0/conditions/0")).remove("ability");
        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].ability must identify an allowed equipped ability");
    }

    @Test
    void acceptsAmmunitionChargesAndRejectsSwordSwingCharges() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[3]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":19,
                    "conditions":[{"type":"expression","left":"bot.selectedAbilityCharges","ability":3,"comparator":"gt","right":{"type":"number","value":0}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[1]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":1,
                    "conditions":[{"type":"expression","left":"bot.selectedAbilityCharges","ability":1,"comparator":"gt","right":{"type":"number","value":0}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].ability must identify an ability with charges");
    }

    @Test
    void acceptsAndValidatesGenericSelectedStatusEffectCondition() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[5]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":0,
                    "conditions":[{"type":"expression","left":"bot.selectedStatusEffectActive","statusEffect":"slow","comparator":"eq","right":{"type":"boolean","value":true}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[5]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":0,
                    "conditions":[{"type":"expression","left":"bot.selectedStatusEffectActive","statusEffect":"not-real","comparator":"eq","right":{"type":"boolean","value":true}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].statusEffect must identify an allowed status effect");
    }

    @Test
    void acceptsStatusEffectDurationComparisonsWithDecimalInputs() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("custom");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[5]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":0,
                    "conditions":[{"type":"expression","left":"bot.selectedStatusEffectDurationMs","statusEffect":"burn","comparator":"gte","right":{"type":"number","value":1.2}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[5]},
                  "roots":[{"branches":[{
                    "branchType":"if","action":"move_walk","movementMode":"absolute","movementDirection":0,
                    "conditions":[{"type":"expression","left":"bot.selectedStatusEffectDurationMs","statusEffect":"burn","comparator":"gte","right":{"type":"number","value":1.23}}],
                    "children":[]
                  }]}]
                }
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void acceptsEquippedDuelV1AbilityActionInRootBrain() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setSelectedLoadout("duel-v1");
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "loadout":{"abilities":[9]},
                  "roots":[{"branches":[{
                    "branchType":"if","actions":[{"action":9}],
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
                  "loadout":{"abilities":[]},
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
                {"version":"bot-logic-tree-v1","customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":3.29}],
                 "roots":[{"branches":[{"branchType":"if","conditions":[{"type":"expression","left":"custom.counter","comparator":"lt","right":{"type":"number","value":10.29}}],"actions":[{"action":"variable","variableId":"custom.counter","operation":"add","operand":{"type":"number","value":1.29}}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void acceptsStandardDirectionalAngleComparisons() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"selectable.absoluteBearing","comparator":"lt",
                    "right":{"type":"number","value":50}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void acceptsSignedNetHpChangeButRejectsNegativePlainHp() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"selectable.hpNetChangeLastTick","leftSelectable":"my_bot","comparator":"lt",
                    "right":{"type":"number","value":-5}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).isAccepted()).isTrue();

        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"selectable.hp","leftSelectable":"my_bot","comparator":"lt",
                    "right":{"type":"number","value":-5}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].right.value cannot be negative for this number variable");
    }

    @Test
    void healthConditionalsAcceptNonHealthTargetsAndResolveThemAsZero() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"selectable.hp","selectable":"opponent_grenade","comparator":"gt",
                    "right":{"type":"number","value":0}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"selectable.hp","selectable":"opponent_hunter_drone","comparator":"gt",
                    "right":{"type":"number","value":0}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void rotateActionAcceptsAbsoluteAngleAndCoordinates() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"always"}],
                  "actions":[{"action":"rotate_toward_enemy","targetMode":"angle","targetAngle":-90}],"children":[]}]}]}
                """));
        assertThat(service.validate(payload).getErrors()).isEmpty();

        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"always"}],
                  "actions":[{"action":"rotate_toward_enemy","targetMode":"coordinates","targetX":100,"targetY":200}],"children":[]}]}]}
                """));
        assertThat(service.validate(payload).getErrors()).isEmpty();
    }

    @Test
    void rejectsUnsupportedTargetModeOnTargetOnlyAbility() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"always"}],
                  "actions":[{"action":20,"targetMode":"coordinates","targetX":100,"targetY":200}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].actions[0].targetMode is not supported for this action");
    }

    @Test
    void rejectsSingleAngleValuesOutsideTheSignedFullTurn() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","roots":[{"branches":[{"branchType":"if",
                  "conditions":[{"type":"expression","left":"selectable.facing","comparator":"gt",
                    "right":{"type":"number","value":361}}],
                  "actions":[{"action":"move_walk","movementMode":"target","movementDirection":0}],"children":[]}]}]}
                """));

        assertThat(service.validate(payload).getErrors()).contains(
                "brain.roots[0].branches[0].conditions[0].right.value must be an angle from -360 to 360 degrees");
    }

    @Test
    void acceptsModuloCustomVariableTermsInDeclaredOrder() throws Exception {
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("""
                {
                  "version":"bot-logic-tree-v1",
                  "customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                  "roots":[{"branches":[{"branchType":"if","conditions":[{"type":"always"}],
                    "actions":[{"action":"variable","variableId":"custom.counter","terms":[
                      {"operator":"set","operand":{"type":"number","value":10}},
                      {"operator":"add","operand":{"type":"number","value":5}},
                      {"operator":"modulo","operand":{"type":"number","value":4}},
                      {"operator":"subtract","operand":{"type":"number","value":1}}
                    ]}],"children":[]}]}]
                }
                """));

        var result = service.validate(payload);

        assertThat(result.isAccepted()).isTrue();
        assertThat(result.getErrors()).isEmpty();
    }

    @Test
    void customVariableOperandsConsumeActionSlotsWithoutCreatingActionEntries() throws Exception {
        String fillerActions = java.util.stream.IntStream.range(0, 98)
                .mapToObj(index -> "{\"action\":\"move_walk\"}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree(""
                + "{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[{\"id\":\"custom.counter\",\"name\":\"Counter\",\"valueType\":\"number\",\"initialValue\":0}],"
                + "\"roots\":[{\"branches\":[{\"branchType\":\"if\",\"conditions\":[{\"type\":\"always\"}],\"actions\":["
                + fillerActions
                + ", {\"action\":\"variable\",\"variableId\":\"custom.counter\",\"terms\":[{\"operator\":\"set\",\"operand\":{\"type\":\"number\",\"value\":10}},{\"operator\":\"add\",\"operand\":{\"type\":\"number\",\"value\":1}},{\"operator\":\"modulo\",\"operand\":{\"type\":\"number\",\"value\":2}}]}],\"children\":[]}]}]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain tree actions exceed the action node limit");
    }

    @Test
    void rejectsZeroModuloOperandsAtTheSubmissionBoundary() throws Exception {
        BotSubmissionPayloadDTO zeroPayload = validPayload();
        zeroPayload.setBrain(jsonMapper.readTree("""
                {"version":"bot-logic-tree-v1","customVariables":[{"id":"custom.counter","name":"Counter","valueType":"number","initialValue":0}],
                 "roots":[{"branches":[{"branchType":"if","conditions":[{"type":"always"}],
                   "actions":[{"action":"variable","variableId":"custom.counter","operation":"modulo","operand":{"type":"number","value":0}}],"children":[]}]}]}
                """));
        var zeroResult = service.validate(zeroPayload);

        assertThat(zeroResult.isAccepted()).isFalse();
        assertThat(zeroResult.getErrors()).contains(
                "brain.roots[0].branches[0].actions[0].operand modulo operand cannot be 0");
    }

    @Test
    void rejectsRetiredCustomVariableConditions() throws Exception {
        String variables = java.util.stream.IntStream.range(0, 51)
                .mapToObj(index -> "{\"id\":\"custom.v" + index + "\",\"name\":\"Variable " + index + "\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[{\"type\":\"always\"}]}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[" + variables + "],\"roots\":[]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain.customVariables[0].conditions are no longer supported");
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
    void customVariableConditionsAreRetired() throws Exception {
        String derived = java.util.stream.IntStream.range(0, 99)
                .mapToObj(index -> "{\"type\":\"always\"}")
                .collect(java.util.stream.Collectors.joining(","));
        String uses = java.util.stream.IntStream.range(0, 3)
                .mapToObj(index -> "{\"branchType\":\"" + (index == 0 ? "if" : "if") + "\",\"conditions\":[{\"type\":\"expression\",\"left\":\"custom.derived\",\"comparator\":\"eq\",\"right\":{\"type\":\"boolean\",\"value\":true}}],\"actions\":[],\"children\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[{\"id\":\"custom.derived\",\"name\":\"Derived\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[" + derived + "]}],\"roots\":[{\"branches\":[" + uses + "]}]}"));

        assertThat(service.validate(payload).getErrors()).contains("brain.customVariables[0].conditions are no longer supported");
    }

    @Test
    void customVariableDefinitionsDoNotAddConditionSlots() throws Exception {
        String branches = java.util.stream.IntStream.range(0, 300)
                .mapToObj(index -> "{\"branchType\":\"if\",\"conditions\":[{\"type\":\"always\"}],\"action\":\"" + (index == 0 ? "move_walk" : "none") + "\",\"children\":[]}")
                .collect(java.util.stream.Collectors.joining(","));
        BotSubmissionPayloadDTO payload = validPayload();
        payload.setBrain(jsonMapper.readTree("{\"version\":\"bot-logic-tree-v1\",\"customVariables\":[{\"id\":\"custom.unused\",\"name\":\"Unused\",\"valueType\":\"boolean\",\"initialValue\":false,\"conditions\":[{\"type\":\"always\"}]}],\"roots\":[{\"branches\":[" + branches + "]}] }"));

        var result = service.validate(payload);
        assertThat(result.getErrors()).contains("brain.customVariables[0].conditions are no longer supported");
    }

    private BotSubmissionPayloadDTO validPayload() throws Exception {
        BotSubmissionPayloadDTO payload = new BotSubmissionPayloadDTO();
        payload.setMatchId(java.util.UUID.fromString("11111111-1111-1111-1111-111111111111"));
        payload.setRoundNumber(1);
        payload.setPhase("BUILDING");
        payload.setSelectedLoadout("melee");

        JsonNode brain = jsonMapper.readTree("""
                {
                  "version": "bot-logic-tree-v1",
                  "roots": [{"branches":[
                    {"id":"node-1","action":"move_walk","movementMode":"target","movementDirection":0,"conditions":[]}
                  ]}]
                }
                """);
        payload.setBrain(brain);
        payload.setClientBuildVersion("test");
        return payload;
    }
}
