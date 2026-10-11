package com.example.botfight.simulation.gameconfig;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.function.Consumer;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ArrayNode;
import tools.jackson.databind.node.ObjectNode;

/** One valid gameplay data set, then one broken copy per rule of the GameplayData check list. */
class GameplayDataTest {
    private static final JsonMapper MAPPER = new JsonMapper();
    private static final Path DIR = Path.of("..", "shared", "gameplay");

    private static String read(String name) throws IOException {
        return Files.readString(DIR.resolve(name), StandardCharsets.UTF_8);
    }

    private interface Edit {
        void apply(ObjectNode abilities, ObjectNode statuses, ObjectNode movement, ObjectNode channels);
    }

    /** Parses a copy of the shipped files after `edit`, expecting the load to fail with a message containing `expected`. */
    private static void assertBroken(String expected, Edit edit) throws IOException {
        ObjectNode abilities = (ObjectNode) MAPPER.readTree(read("abilities.json"));
        ObjectNode statuses = (ObjectNode) MAPPER.readTree(read("statuses.json"));
        ObjectNode movement = (ObjectNode) MAPPER.readTree(read("movement.json"));
        ObjectNode channels = (ObjectNode) MAPPER.readTree(read("channels.json"));
        edit.apply(abilities, statuses, movement, channels);
        assertThatThrownBy(() -> GameplayData.parse(
                abilities.toString(), statuses.toString(), movement.toString(), channels.toString()))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining(expected);
    }

    private static void abilityEdit(String expected, int id, Consumer<ObjectNode> edit) throws IOException {
        assertBroken(expected, (abilities, statuses, movement, channels) -> edit.accept(ability(abilities, id)));
    }

    private static ObjectNode ability(ObjectNode abilities, int id) {
        for (JsonNode node : abilities.get("abilities")) {
            if (node.get("id").asInt() == id) return (ObjectNode) node;
        }
        throw new IllegalArgumentException("no ability " + id);
    }

    private static ObjectNode verb(ObjectNode ability, int index) {
        return (ObjectNode) ability.get("onTrigger").get(index);
    }

    private static ObjectNode entity(ObjectNode ability) {
        return (ObjectNode) ability.get("entities").iterator().next();
    }

    private static ObjectNode phase(ObjectNode ability, int index) {
        return (ObjectNode) entity(ability).get("phases").get(index);
    }

    private static ObjectNode eventVerb(ObjectNode ability, String eventType, String kind, int phaseIndex) {
        for (JsonNode node : phase(ability, phaseIndex).get("on").get(eventType).get("do")) {
            if (kind.equals(node.get("do").asString())) return (ObjectNode) node;
        }
        throw new IllegalArgumentException("no " + kind + " verb in " + eventType);
    }

    @Test
    void theShippedFilesAreValid() throws IOException {
        GameplayData data = GameplayData.parse(
                read("abilities.json"), read("statuses.json"), read("movement.json"), read("channels.json"));
        assertThat(data.abilities().abilities()).hasSize(36);
        assertThat(data.statuses().statuses()).containsKeys("burn", "silence", "stun", "slow", "shock", "bleed");
        assertThat(data.channels().channels()).containsKeys("ability", "dash");
        assertThat(GameplayData.get()).isNotNull();
    }

    // 1. identity
    @Test
    void idsAreUniquePositiveIntegers() throws IOException {
        abilityEdit("duplicate id 1", 3, ability -> ability.put("id", 1));
        abilityEdit("is not a positive integer", 3, ability -> ability.put("id", 0));
        abilityEdit("duplicate name", 3, ability -> ability.put("name", "slash"));
        abilityEdit("duplicate label", 3, ability -> ability.put("label", "Slash"));
    }

    // 2. vocabularies
    @Test
    void unknownVocabularyValuesFailTheLoad() throws IOException {
        abilityEdit("Invalid gameplay data", 4, ability -> phase(ability, 0).put("type", "bogus"));
        abilityEdit("Invalid gameplay data", 4, ability -> entity(ability).put("category", "bogus"));
        abilityEdit("Invalid gameplay data", 1, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(0)).put("type", "bogus"));
        abilityEdit("Invalid gameplay data", 4, ability -> {
            ObjectNode events = (ObjectNode) phase(ability, 0).get("on");
            events.set("bogus", events.get("collision"));
        });
        abilityEdit("Invalid gameplay data", 4, ability -> ((ObjectNode) phase(ability, 0).get("movement")).put("mode", "bogus"));
        abilityEdit("Invalid gameplay data", 1, ability -> ((ArrayNode) ((ObjectNode) verb(ability, 0).get("effects").get(0))
                .get("targetKinds")).add("NOBODY"));
        abilityEdit("unknown verbTarget", 1, ability -> ((ArrayNode) verb(ability, 0).get("targets")).add("NOBODY"));
        abilityEdit("unknown triggerVerb", 1, ability -> verb(ability, 0).put("do", "bogus"));
        abilityEdit("unknown patternType", 4, ability -> {
            ObjectNode pattern = verb(ability, 0).putObject("pattern");
            pattern.put("type", "bogus").put("count", 3);
        });
        abilityEdit("unknown hitAim", 17, ability -> eventVerb(ability, "schedule", "hit", 0).put("aim", "bogus"));
        assertBroken("unknown statusEffectType", (abilities, statuses, movement, channels) ->
                ((ObjectNode) statuses.get("statuses").get("burn").get("effects").get(0)).put("type", "bogus"));
        assertBroken("unknown statusMode", (abilities, statuses, movement, channels) ->
                ((ObjectNode) statuses.get("statuses").get("burn").get("effects").get(0)).put("mode", "bogus"));
    }

    @Test
    void unknownPropertiesFailTheLoad() throws IOException {
        abilityEdit("Invalid gameplay data", 1, ability -> ability.put("surprise", 1));
        assertBroken("Invalid gameplay data", (abilities, statuses, movement, channels) -> movement.put("surprise", 1));
        assertBroken("Invalid gameplay data", (abilities, statuses, movement, channels) ->
                ((ObjectNode) statuses.get("statuses").get("burn")).put("surprise", 1));
    }

    // 3. transitions and spawns, 4. where each verb may run
    @Test
    void transitionsAndSpawnsNameRealTargets() throws IOException {
        abilityEdit("is not a phase of this entity", 4, ability -> eventVerb(ability, "lifetimeEnd", "transition", 0).put("to", "nowhere"));
        abilityEdit("is not an entity of this ability", 4, ability -> verb(ability, 0).put("entity", "nowhere"));
    }

    @Test
    void eachVerbRunsWhereItIsAllowed() throws IOException {
        abilityEdit("unknown triggerVerb", 1, ability -> ((ArrayNode) ability.get("onTrigger")).addObject().put("do", "transition").put("to", "x"));
        abilityEdit("unknown triggerVerb", 1, ability -> ((ArrayNode) ability.get("onTrigger")).addObject().put("do", "remove"));
        abilityEdit("unknown eventVerb", 4, ability -> ((ArrayNode) phase(ability, 0).get("on").get("collision").get("do")).addObject().put("do", "move"));
        abilityEdit("must target OWNER", 10, ability -> {
            ArrayNode targets = (ArrayNode) verb(ability, 0).get("targets");
            targets.removeAll();
            targets.add("BOT");
        });
        abilityEdit("needs at least one verb", 1, ability -> ((ArrayNode) ability.get("onTrigger")).removeAll());
        abilityEdit("hit needs at least one effect", 1, ability -> ((ArrayNode) verb(ability, 0).get("effects")).removeAll());
        abilityEdit("hit needs targets", 1, ability -> ((ArrayNode) verb(ability, 0).get("targets")).removeAll());
        abilityEdit("needs a hitbox", 1, ability -> verb(ability, 0).putNull("hitbox"));
        abilityEdit("move needs distance and unitsPerTick", 19, ability -> verb(ability, 0).putNull("distance"));
        abilityEdit("unknown faceTarget", 20, ability -> verb(ability, 0).put("target", "somewhere"));
        abilityEdit("emitVisual needs a positive visibleMs", 4, ability -> eventVerb(ability, "collision", "emitVisual", 2).put("visibleMs", 0));
    }

    // 5. milliseconds
    @Test
    void millisecondsAreWholeTicksWithinBounds() throws IOException {
        abilityEdit("is not a multiple of 100 ms", 1, ability -> ((ObjectNode) ability.get("timing")).put("cooldownMs", 250));
        abilityEdit("is not a whole number of ms", 1, ability -> ((ObjectNode) ability.get("timing")).put("windupMs", 5_000_000));
        abilityEdit("is not a multiple of 100 ms", 5, ability ->
                ((ObjectNode) eventVerb(ability, "collision", "applyEffects", 0).get("effects").get(1)).put("durationMs", 5050));
        abilityEdit("is not a multiple of 100 ms", 4, ability -> eventVerb(ability, "collision", "emitVisual", 2).put("visibleMs", 250));
        abilityEdit("is not a whole number of ms", 11, ability -> ((ObjectNode) entity(ability).get("lifetime")).put("duration", -100));
        assertBroken("regenDelayMs", (abilities, statuses, movement, channels) -> ((ObjectNode) movement.get("config")).put("regenDelayMs", 450));
    }

    // 6. counts and sizes
    @Test
    void aTriggersRadiusIsTriggerRadiusAndTheHitboxDoesNotStandInForIt() throws IOException {
        // Proximity Mine's armed phase has a trigger event and no collision, hit or killed event.
        abilityEdit("needs its own radius", 11, ability -> ((ObjectNode) phase(ability, 1).get("trigger")).putNull("radius"));
        abilityEdit("a trigger event needs a trigger", 11, ability -> phase(ability, 1).putNull("trigger"));
        abilityEdit("no collision, hit or killed event uses the hitbox", 11,
                ability -> ((ObjectNode) phase(ability, 1).get("hitbox")).put("radius", 87.5));
        // Snare Bomb keeps a body hitbox next to a different trigger radius because it has health and a killed event.
        abilityEdit("no collision, hit or killed event uses the hitbox", 29, ability -> {
            ((ObjectNode) phase(ability, 0).get("on")).remove("killed");
            phase(ability, 0).putNull("health");
        });
    }

    @Test
    void countsAndSizesAreInBounds() throws IOException {
        abilityEdit("maxCharges", 12, ability -> ((ObjectNode) ability.get("timing")).put("maxCharges", 0));
        abilityEdit("health.hp", 17, ability -> ((ObjectNode) phase(ability, 0).get("health")).put("hp", 0));
        abilityEdit("hitbox.radius", 8, ability -> ((ObjectNode) verb(ability, 0).get("hitbox")).put("radius", 99_999));
        abilityEdit("visual.visualSize", 1, ability -> ((ObjectNode) verb(ability, 0).get("visual")).put("visualSize", 5000));
        abilityEdit("hitbox.arc", 1, ability -> ((ObjectNode) verb(ability, 0).get("hitbox")).put("arc", 400));
        abilityEdit("pattern.count", 4, ability -> verb(ability, 0).putObject("pattern").put("type", "ring").put("count", 13));
        abilityEdit("pattern.count", 4, ability -> verb(ability, 0).putObject("pattern").put("type", "ring").put("count", 0));
        abilityEdit("fan needs spreadDeg", 4, ability -> verb(ability, 0).putObject("pattern").put("type", "fan").put("count", 3));
        abilityEdit("line needs spacing", 4, ability -> verb(ability, 0).putObject("pattern").put("type", "line").put("count", 3));
    }

    @Test
    void spawnPatternsOfOneToTwelveEntitiesAreValid() throws IOException {
        for (int count : new int[] {1, 7, 12}) {
            ObjectNode abilities = (ObjectNode) MAPPER.readTree(read("abilities.json"));
            ObjectNode pattern = verb(ability(abilities, 4), 0).putObject("pattern");
            pattern.put("type", "fan").put("count", count).put("spreadDeg", 40);
            GameplayData.parse(abilities.toString(), read("statuses.json"), read("movement.json"), read("channels.json"));
        }
    }

    // 7. effect fields
    @Test
    void effectsCarryTheFieldsTheirTypeNeeds() throws IOException {
        abilityEdit("damage needs amount or falloff", 1, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(0)).putNull("amount"));
        abilityEdit("knockback needs amount", 8, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(1)).putNull("amount"));
        abilityEdit("status needs durationMs or whileInside", 9, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(1)).putNull("durationMs"));
        abilityEdit("buff needs buff", 33, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(0)).putNull("buff"));
        abilityEdit("interrupt needs durationMs", 30, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(1)).putNull("durationMs"));
        abilityEdit("restore_state needs delayMs", 21, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(0)).putNull("delayMs"));
        abilityEdit("damage_reduction needs durationMs", 16, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(0)).putNull("durationMs"));
        abilityEdit("teleport needs distanceMode or amount", 25, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(0)).putNull("distanceMode"));
    }

    // 8. statuses
    @Test
    void statusEffectsNameAPresetAndTokensAreKnown() throws IOException {
        abilityEdit("has no preset in statuses.json", 9, ability -> ((ObjectNode) verb(ability, 0).get("effects").get(1)).put("subtype", "zap"));
        assertBroken("has no preset in statuses.json", (abilities, statuses, movement, channels) -> ((ObjectNode) statuses.get("statuses")).remove("slow"));
        assertBroken("unknown token", (abilities, statuses, movement, channels) ->
                ((ObjectNode) statuses.get("statuses").get("burn").get("effects").get(0)).put("amount", "$bogus"));
    }

    // 9. movement
    @Test
    void movementNumbersAreWholeAndInBounds() throws IOException {
        assertBroken("ticks every 100 ms", (abilities, statuses, movement, channels) -> movement.put("tickMs", 50));
        assertBroken("staminaMax", (abilities, statuses, movement, channels) -> ((ObjectNode) movement.get("config")).put("staminaMax", 100.5));
        assertBroken("windupCancelCost", (abilities, statuses, movement, channels) -> ((ObjectNode) movement.get("config")).put("windupCancelCost", -1));
        assertBroken("sprintDrainPerTick", (abilities, statuses, movement, channels) -> ((ObjectNode) movement.get("config")).put("sprintDrainPerTick", 5000));
    }

    // 10. channels and stamina costs
    @Test
    void abilitiesNameAChannelAndOnlyTheDashChannelMayCostStamina() throws IOException {
        abilityEdit("unknown channel", 1, ability -> ability.put("channel", "bogus"));
        abilityEdit("only the dash channel may declare a stamina cost", 1, ability ->
                ability.putObject("cost").put("stamina", 10));
        abilityEdit("only the dash channel may declare a stamina cost", 19, ability -> ability.put("channel", "ability"));
        abilityEdit("cost.stamina", 19, ability -> ((ObjectNode) ability.get("cost")).put("stamina", 0));
        abilityEdit("cost.stamina", 19, ability -> ((ObjectNode) ability.get("cost")).put("stamina", 150));
        assertBroken("has no preset in statuses.json", (abilities, statuses, movement, channels) ->
                ((tools.jackson.databind.node.ArrayNode) channels.get("channels").get("dash").get("blockedByStatuses")).add("bogus"));
        assertBroken("is not one of the channel's blockedByStatuses", (abilities, statuses, movement, channels) ->
                ((tools.jackson.databind.node.ArrayNode) channels.get("channels").get("ability").get("notReadyWhileStatuses")).add("slow"));
        assertBroken("notReadyWhileStatuses", (abilities, statuses, movement, channels) ->
                ((ObjectNode) channels.get("channels").get("dash")).put("notReadyWhileStatuses", "slow"));
    }

    // 11. movement modes and timer events
    @Test
    void entityPhasesMoveInAKnownModeAndTimerEventsRepeat() throws IOException {
        abilityEdit("straight movement needs unitsPerTick above 0", 4, ability -> ((ObjectNode) phase(ability, 0).get("movement")).put("unitsPerTick", 0));
        abilityEdit("seek movement needs unitsPerTick above 0", 17, ability -> ((ObjectNode) phase(ability, 0).get("movement")).put("unitsPerTick", 0));
        abilityEdit("seek needs turnDegrees", 17, ability -> ((ObjectNode) phase(ability, 0).get("movement")).putNull("turnDegrees"));
        abilityEdit("a schedule event repeats", 17, ability -> ((ObjectNode) phase(ability, 0).get("on").get("schedule").get("schedule")).put("mode", "once"));
        abilityEdit("a schedule event needs intervalMs", 17, ability -> ((ObjectNode) phase(ability, 0).get("on").get("schedule").get("schedule")).putNull("intervalMs"));
        abilityEdit("only a schedule event waits for its hit", 4, ability -> ((ObjectNode) phase(ability, 0).get("on").get("collision")).put("waitForHit", true));
    }

    @Test
    void followOwnerEntitiesAreValid() throws IOException {
        ObjectNode abilities = (ObjectNode) MAPPER.readTree(read("abilities.json"));
        ObjectNode grenade = entity(ability(abilities, 4));
        ObjectNode movement = (ObjectNode) grenade.get("phases").get(0).get("movement");
        movement.put("mode", "followOwner");
        movement.putNull("unitsPerTick");
        GameplayData.parse(abilities.toString(), read("statuses.json"), read("movement.json"), read("channels.json"));
    }
}
