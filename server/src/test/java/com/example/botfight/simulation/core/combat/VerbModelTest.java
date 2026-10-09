package com.example.botfight.simulation.core.combat;

import static org.assertj.core.api.Assertions.assertThat;

import com.example.botfight.simulation.bots.BotCodeService;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Action;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Arena;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.core.state.BotStateService;
import com.example.botfight.simulation.ecs.abilities.AbilityEntitySystem;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.entities.AbilityEntityFactory;
import com.example.botfight.simulation.ecs.entities.ArenaBounds;
import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import com.example.botfight.simulation.gameconfig.GameConfigCatalog;
import com.example.botfight.simulation.gameconfig.GameplayData;
import java.nio.charset.StandardCharsets;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.Set;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import tools.jackson.databind.JsonNode;
import tools.jackson.databind.json.JsonMapper;
import tools.jackson.databind.node.ObjectNode;

/**
 * Mirrors frontend ecs/tests/VerbModel.test.js; keep the scenarios in step. These tests swap real ability IDs
 * for small test abilities written in the shared schema, so the whole path runs: trigger, spawn verbs, entity
 * tick.
 */
class VerbModelTest {
    private static final JsonMapper MAPPER = new JsonMapper();
    private static final Path ABILITIES = Path.of("..", "shared", "gameplay", "abilities.json");

    private static final String ORIGIN = "{\"offset\":{\"x\":0,\"y\":0},\"rotation\":0,\"rotationSpace\":\"owner\"}";
    private static final String STATIC = "{\"mode\":\"static\",\"unitsPerTick\":0,\"direction\":null,"
            + "\"turnDegrees\":null,\"size\":null}";
    private static final String FOLLOW = "{\"mode\":\"followOwner\",\"unitsPerTick\":null,\"direction\":null,"
            + "\"turnDegrees\":null,\"size\":null}";

    private final BotStateService stateService = new BotStateService(new GameConfigCatalog(), new BotCodeService());
    private final ActionExecutionService executor = new ActionExecutionService(stateService);
    private final Arena arena = new Arena(1000, 800, 1000);

    // ---- test data in the abilities.json schema

    private static String phase(String id, String movement, String durationMs, String on) {
        return "{\"id\":\"" + id + "\",\"type\":\"zone\",\"durationMs\":" + durationMs + ",\"startMs\":null,"
                + "\"transitionOnly\":null,\"skipOwner\":null,\"movement\":" + movement + ","
                + "\"hitbox\":{\"shape\":\"circle\",\"radius\":20,\"range\":null,\"arc\":null,\"width\":null,"
                + "\"length\":null,\"radiusMultiplier\":1,\"includeTargetRadius\":null},"
                + "\"health\":null,\"trigger\":null,\"visual\":null,\"on\":" + on + "}";
    }

    private static String entity(String runtimeType, boolean bindToCast, String spawnOffsetY, String phases) {
        return "{\"runtimeType\":\"" + runtimeType + "\",\"category\":\"zone\","
                + "\"spawn\":{\"offset\":{\"x\":0,\"y\":" + spawnOffsetY + "},\"rotation\":0,\"rotationSpace\":\"owner\"},"
                + "\"targeting\":{\"owner\":\"owner\",\"position\":null,\"defaultX\":null,\"defaultY\":null,"
                + "\"clampToRadius\":null},\"lifetime\":{\"timerMode\":\"none\",\"duration\":null,\"add\":null},"
                + "\"initialState\":{\"armed\":true,\"damageMultiplierFromOwner\":false},\"state\":null,"
                + "\"bindToCast\":" + bindToCast + ",\"phases\":[" + phases + "]}";
    }

    private static String spawn(String entityName, String pattern) {
        return "{\"do\":\"spawn\",\"entity\":\"" + entityName + "\",\"pattern\":" + pattern + "}";
    }

    private static String event(String verbs) {
        return "{\"targets\":[\"BOT\"],\"schedule\":{\"mode\":\"once\",\"intervalMs\":null,\"count\":null,"
                + "\"startImmediately\":true},\"targetPolicy\":null,\"recheckCollisionOnTransition\":true,"
                + "\"nearestOnly\":false,\"waitForHit\":false,\"do\":[" + verbs + "]}";
    }

    /** Ability {@code id} keeps its shipped timing and gets these trigger verbs and entities. */
    private static GameplayData.AbilityData ability(int id, String onTrigger, String entities) throws Exception {
        JsonNode shipped = MAPPER.readTree(Files.readString(ABILITIES, StandardCharsets.UTF_8));
        ObjectNode base = null;
        for (JsonNode node : shipped.get("abilities")) {
            if (node.get("id").asInt() == id) base = (ObjectNode) node;
        }
        base.set("onTrigger", MAPPER.readTree("[" + onTrigger + "]"));
        base.set("entities", MAPPER.readTree(entities));
        return GameplayData.parseAbility(base.toString());
    }

    private static String grenadeEntity() throws Exception {
        JsonNode shipped = MAPPER.readTree(Files.readString(ABILITIES, StandardCharsets.UTF_8));
        for (JsonNode node : shipped.get("abilities")) {
            if (node.get("id").asInt() == 4) return node.get("entities").toString();
        }
        throw new IllegalStateException();
    }

    // ---- bots and ticks

    private static Bot caster(int abilityId) {
        Bot bot = new Bot();
        bot.userId = UUID.nameUUIDFromBytes("verb-model".getBytes());
        bot.slot = 1;
        bot.x = 300;
        bot.y = 300;
        bot.size = 60;
        bot.rotation = 90;
        bot.hp = 150;
        bot.maxHp = 150;
        bot.moveSpeed = 8;
        bot.attackSpeedMultiplier = 1.0;
        bot.attackDamageMultiplier = 1.0;
        bot.abilities = Set.of(abilityId);
        return bot;
    }

    private static Action cast(int abilityId) {
        return new Action(0, 0, 0, abilityId, 900, 400, null, null, null, false, false, false, null);
    }

    private static Action idle() {
        return new Action(0, 0, 0, null, 900, 400, null, null, null, false, false, false, null);
    }

    /** Casts the ability, ticking through any wind-up, and returns the bot on the tick it triggered. */
    private Bot castUntilTriggered(Bot bot, int abilityId) {
        for (int tick = 0; tick < 40; tick += 1) {
            bot.triggeredAbility = null;
            executor.execute(bot, cast(abilityId), arena);
            if (bot.triggeredAbility != null) return bot;
        }
        throw new IllegalStateException("the ability never triggered");
    }

    private static AbilityEntitySystem.Combat<Bot> combat() {
        return new AbilityEntitySystem.Combat<>() {
            @Override public void damage(Bot bot, double amount) {}

            @Override public void damageFromOwner(List<Bot> bots, int ownerSlot, Bot target, double amount,
                                                  double sourceX, double sourceY) {}

            @Override public boolean entityHitByCurrentAttack(ArenaEntity entity, List<Bot> bots,
                                                              List<ArenaEntity> entities) {
                return false;
            }

            @Override public String spawnEntityId(List<Bot> bots, int ownerSlot, String idPrefix, String parentEntityId) {
                Bot owner = bots.stream().filter(bot -> bot.slot == ownerSlot).findFirst().orElse(null);
                return owner == null ? null : idPrefix + "-" + owner.userId + "-" + owner.abilityEntitySerial++;
            }

            @Override public boolean castActive(List<Bot> bots, int ownerSlot, int abilityId) {
                return bots.stream().filter(bot -> bot.slot == ownerSlot).findFirst()
                        .map(owner -> AbilityState.stage(owner, abilityId) == AbilityState.Stage.ACTIVE).orElse(false);
            }

            @Override public double[] ownerPose(List<Bot> bots, int ownerSlot) {
                return bots.stream().filter(bot -> bot.slot == ownerSlot).findFirst()
                        .map(owner -> new double[] {owner.x, owner.y, owner.rotation}).orElse(null);
            }
        };
    }

    private static List<ArenaEntity> tick(List<ArenaEntity> entities, Bot bot) {
        return AbilityEntitySystem.tick(entities, List.of(bot), new ArenaBounds(1000, 800), 100, combat());
    }

    private static double heading(ArenaEntity entity) {
        return Math.toDegrees(Math.atan2(entity.velocityX(), -entity.velocityY()));
    }

    // ---- tests

    @Test
    void aFanSpawnCreatesItsEntitiesInIndexOrderWithSerialsInThatOrder() throws Exception {
        GameplayData.AbilityData fan = ability(4,
                spawn("grenade", "{\"type\":\"fan\",\"count\":7,\"spreadDeg\":40}"), grenadeEntity());
        AbilityContracts.withTestAbilities(List.of(fan), () -> {
            Bot bot = castUntilTriggered(caster(4), 4);
            List<ArenaEntity> spawned = bot.abilitySpawn;

            assertThat(spawned).hasSize(7);
            assertThat(spawned).as("serials in index order")
                    .extracting(entity -> entity.id().substring(entity.id().lastIndexOf('-') + 1))
                    .containsExactly("1", "2", "3", "4", "5", "6", "7");
            assertThat(bot.abilityEntitySerial).isEqualTo(8);
            for (int index = 0; index < 7; index += 1) {
                assertThat(heading(spawned.get(index))).isCloseTo(90 - 20 + index * 40.0 / 6, org.assertj.core.data.Offset.offset(1e-9));
            }
            assertThat(spawned).allMatch(entity -> entity.x() == spawned.getFirst().x()
                    && entity.y() == spawned.getFirst().y());
            return null;
        });
    }

    @Test
    void spawnPatternsPlaceOneEntityAheadARingAndALine() {
        assertThat(AbilityEntityFactory.placements(null)).containsExactly(AbilityEntityFactory.Placement.AHEAD);
        assertThat(AbilityEntityFactory.placements(new AbilityContracts.SpawnPattern(
                AbilityContracts.PatternType.FAN, 1, 90, 0))).containsExactly(AbilityEntityFactory.Placement.AHEAD);
        assertThat(AbilityEntityFactory.placements(new AbilityContracts.SpawnPattern(
                AbilityContracts.PatternType.RING, 4, 0, 0))).extracting(AbilityEntityFactory.Placement::angle)
                .containsExactly(0.0, 90.0, 180.0, 270.0);
        assertThat(AbilityEntityFactory.placements(new AbilityContracts.SpawnPattern(
                AbilityContracts.PatternType.LINE, 3, 0, 20))).extracting(AbilityEntityFactory.Placement::lateral)
                .containsExactly(-20.0, 0.0, 20.0);
        assertThat(AbilityEntityFactory.placements(new AbilityContracts.SpawnPattern(
                AbilityContracts.PatternType.RING, 12, 0, 0))).hasSize(12);
    }

    private static GameplayData.AbilityData beam(boolean bound) throws Exception {
        String beam = entity("testBeam", bound, "50", phase("active", FOLLOW, "null", "{}"));
        return ability(5, spawn("testBeam", "null"), "{\"testBeam\":" + beam + "}");
    }

    @Test
    void aFollowOwnerEntityBoundToTheCastEndsWhenTheCastIsInterrupted() throws Exception {
        AbilityContracts.withTestAbilities(List.of(beam(true)), () -> {
            Bot bot = castUntilTriggered(caster(5), 5);
            ArenaEntity spawned = bot.abilitySpawn.getFirst();
            assertThat(spawned.bindToCast()).isTrue();
            assertThat(AbilityState.stage(bot, 5)).isEqualTo(AbilityState.Stage.ACTIVE);

            // Moving and turning the owner carries the entity: it stays 50 units ahead of it.
            bot.x = 500;
            bot.y = 200;
            bot.rotation = 180;
            List<ArenaEntity> following = tick(List.of(spawned), bot);
            assertThat(following).hasSize(1);
            double ahead = Math.toRadians(180 - 90);
            assertThat(following.getFirst().x()).isCloseTo(500 + Math.cos(ahead) * 50, org.assertj.core.data.Offset.offset(1e-9));
            assertThat(following.getFirst().y()).isCloseTo(200 + Math.sin(ahead) * 50, org.assertj.core.data.Offset.offset(1e-9));
            assertThat(following.getFirst().rotation()).isEqualTo(180);

            // An interrupt ends the active stage, and the entity goes with it.
            BotStateService.interruptCurrentAbility(bot);
            assertThat(AbilityState.stage(bot, 5)).isNotEqualTo(AbilityState.Stage.ACTIVE);
            assertThat(tick(following, bot)).isEmpty();
            return null;
        });
    }

    @Test
    void aBoundEntityAlsoEndsWhenTheActiveStageRunsOut() throws Exception {
        AbilityContracts.withTestAbilities(List.of(beam(true)), () -> {
            Bot bot = castUntilTriggered(caster(5), 5);
            List<ArenaEntity> entities = bot.abilitySpawn;
            int ticks = 0;
            while (!entities.isEmpty() && ticks < 40) {
                bot.triggeredAbility = null;
                executor.execute(bot, idle(), arena);
                entities = tick(entities, bot);
                ticks += 1;
            }
            assertThat(ticks).isBetween(1, 39);
            assertThat(AbilityState.stage(bot, 5)).isNotEqualTo(AbilityState.Stage.ACTIVE);
            return null;
        });
    }

    @Test
    void anEntityThatIsNotBoundOutlivesAnInterruptedCast() throws Exception {
        AbilityContracts.withTestAbilities(List.of(beam(false)), () -> {
            Bot bot = castUntilTriggered(caster(5), 5);
            BotStateService.interruptCurrentAbility(bot);
            assertThat(tick(bot.abilitySpawn, bot)).hasSize(1);
            return null;
        });
    }

    @Test
    void aSpawnVerbInsideAnEntityEventCreatesItsEntitiesFromTheParentsPose() throws Exception {
        String parent = entity("testParent", false, "0", phase("active", STATIC, "200",
                "{\"lifetimeEnd\":" + event(spawn("child", "{\"type\":\"ring\",\"count\":3}")
                        + ",{\"do\":\"remove\"}") + "}"));
        String child = entity("testChild", false, "0", phase("active", STATIC, "null", "{}"));
        GameplayData.AbilityData parentAbility = ability(5, spawn("parent", "null"),
                "{\"parent\":" + parent + ",\"child\":" + child + "}");
        AbilityContracts.withTestAbilities(List.of(parentAbility), () -> {
            Bot bot = castUntilTriggered(caster(5), 5);
            ArenaEntity parentEntity = bot.abilitySpawn.getFirst().withPosition(400, 250, 0, 0);
            List<ArenaEntity> world = tick(List.of(parentEntity), bot);
            assertThat(world).as("the parent is still alive").hasSize(1);
            world = tick(world, bot);

            assertThat(world).as("the parent ended and left its three children").hasSize(3);
            assertThat(world).allMatch(entity -> entity.type().equals("testChild")
                    && entity.x() == 400 && entity.y() == 250);
            assertThat(world).extracting(ArenaEntity::entityKey).containsOnly("child");
            assertThat(bot.abilityEntitySerial).isEqualTo(5).as("serials continue after the parent's");
            assertThat(world).extracting(entity -> entity.id().substring(entity.id().lastIndexOf('-') + 1))
                    .containsExactly("2", "3", "4");
            return null;
        });
    }
}
