package com.example.botfight.simulation.core.orchestration;

import com.example.botfight.simulation.ecs.entities.ArenaEntity;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * Optional combat log for one simulation run. Mirrors the browser's ecs/combatLog.js: same entry
 * fields, kinds and stage names, so the two logs can be diffed.
 *
 * <p>The log is off unless a caller binds one with {@link #bind} (see
 * {@code DuelSimulationService.simulateLogged}); rated runs never bind one. While bound, the effect,
 * status and stamina funnels append to it through the static {@code record} method without every call
 * in the chain carrying a parameter. The binding is per thread, so concurrent simulations never share it.
 *
 * <p>Entry: tick, stage, kind (trigger | effect | status | spawn | phase | removal | stamina),
 * source/target ("bot&lt;slot&gt;" for a bot, "&lt;type&gt;:&lt;ownerSlot&gt;:&lt;serial&gt;" for an entity, since
 * entity ids differ between runtimes, null when there is none),
 * abilityId, effect, amount.
 */
public final class CombatLog {
    public static final List<String> STAGES = List.of(
            "decide", "act", "resolveHits", "spawn", "entities", "hazards", "settle");

    public record Entry(int tick, String stage, String kind, String source, String target,
                        Integer abilityId, String effect, Double amount) {
    }

    private static final ThreadLocal<CombatLog> ACTIVE = new ThreadLocal<>();

    private final List<Entry> entries = new ArrayList<>();
    private int tick;
    private String stage;
    private Integer abilityId;

    public List<Entry> entries() {
        return entries;
    }

    /** Binds this log to the current thread until the returned handle is closed. */
    public Binding bind() {
        CombatLog previous = ACTIVE.get();
        ACTIVE.set(this);
        return new Binding(previous);
    }

    public static final class Binding implements AutoCloseable {
        private final CombatLog previous;

        private Binding(CombatLog previous) {
            this.previous = previous;
        }

        @Override
        public void close() {
            if (previous == null) ACTIVE.remove();
            else ACTIVE.set(previous);
        }
    }

    public static boolean active() {
        return ACTIVE.get() != null;
    }

    static void beginTick(int tick) {
        CombatLog log = ACTIVE.get();
        if (log == null) return;
        log.tick = tick;
        log.stage = null;
        log.abilityId = null;
    }

    static void stage(String stage) {
        CombatLog log = ACTIVE.get();
        if (log != null) log.stage = stage;
    }

    /**
     * Sets the ability that entries without their own ability are attributed to and returns the
     * previous one, so the caller can restore it in a finally block.
     */
    public static Integer setAbility(Integer abilityId) {
        CombatLog log = ACTIVE.get();
        if (log == null) return null;
        Integer previous = log.abilityId;
        log.abilityId = abilityId;
        return previous;
    }

    private static final Pattern TRAILING_SERIAL = Pattern.compile("(\\d+)$");

    /** "&lt;type&gt;:&lt;ownerSlot&gt;:&lt;serial&gt;": the entity id minus the owner naming that differs between runtimes. */
    public static String entityRef(ArenaEntity entity) {
        if (entity == null) return null;
        Matcher serial = TRAILING_SERIAL.matcher(entity.id() == null ? "" : entity.id());
        return entity.type() + ":" + entity.ownerSlot() + ":" + (serial.find() ? serial.group(1) : "0");
    }

    public static String bot(int slot) {
        return "bot" + slot;
    }

    public static String bot(Integer slot) {
        return slot == null ? null : "bot" + slot;
    }

    public static void record(String kind, String source, String target, Integer abilityId,
                              String effect, Double amount) {
        CombatLog log = ACTIVE.get();
        if (log == null) return;
        log.entries.add(new Entry(log.tick, log.stage, kind, source, target,
                abilityId != null ? abilityId : log.abilityId, effect, rounded(amount)));
    }

    public static void record(String kind, String source, String target, Integer abilityId,
                              String effect, double amount) {
        record(kind, source, target, abilityId, effect, Double.valueOf(amount));
    }

    private static Double rounded(Double value) {
        if (value == null || !Double.isFinite(value)) return null;
        double result = Math.round(value * 1000.0) / 1000.0;
        return result == 0 ? 0.0 : result;
    }
}
