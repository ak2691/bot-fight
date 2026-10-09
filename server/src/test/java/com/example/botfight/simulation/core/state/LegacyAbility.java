package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.core.orchestration.Bot;

/**
 * Test helpers for the ability records. Fixtures are easiest to write in terms of the old loose fields
 * (an ability's active time, its visible and reserved cooldown, charges, reload, the wind-up); the setters
 * rebuild the ability's record from them and the getters read the derived value back. The browser's
 * testing/legacyAbilityShape.js does the same.
 */
public final class LegacyAbility {
    private LegacyAbility() {}

    private record Fields(int windup, int active, int cooldown, int pending, double targetX, double targetY) {
    }

    private static Fields read(Bot bot, int id) {
        AbilityState.Record record = AbilityState.record(bot, id);
        if (record == null) return new Fields(0, 0, 0, 0, Double.NaN, Double.NaN);
        return new Fields(AbilityState.windupRemainingMs(bot, id), AbilityState.activeRemainingMs(bot, id),
                AbilityState.cooldownRemainingMs(bot, id), AbilityState.pendingCooldownMs(bot, id),
                record.targetX, record.targetY);
    }

    private static void write(Bot bot, int id, Fields fields) {
        AbilityState.Record record = AbilityState.ensure(bot, id);
        record.cooldownMs = 0;
        int cooldown = Math.max(fields.cooldown, fields.pending);
        if (fields.windup > 0) {
            record.stage = AbilityState.Stage.WINDUP;
            record.remainingMs = fields.windup;
            record.targetX = fields.targetX;
            record.targetY = fields.targetY;
            return;
        }
        record.targetX = Double.NaN;
        record.targetY = Double.NaN;
        if (fields.active > 0) {
            record.stage = AbilityState.Stage.ACTIVE;
            record.remainingMs = fields.active;
            record.cooldownMs = cooldown;
        } else if (cooldown > 0) {
            record.stage = AbilityState.Stage.COOLDOWN;
            record.remainingMs = cooldown;
        } else {
            record.stage = AbilityState.Stage.READY;
            record.remainingMs = 0;
        }
    }

    public static void setActive(Bot bot, int id, int ms) {
        Fields f = read(bot, id);
        write(bot, id, new Fields(f.windup, Math.max(0, ms), f.cooldown, f.pending, f.targetX, f.targetY));
    }

    public static void setCooldown(Bot bot, int id, int ms) {
        Fields f = read(bot, id);
        // While active the cooldown is reserved; otherwise it is the visible one.
        write(bot, id, new Fields(f.windup, f.active, f.active > 0 ? 0 : Math.max(0, ms),
                f.active > 0 ? Math.max(0, ms) : 0, f.targetX, f.targetY));
    }

    public static void setPending(Bot bot, int id, int ms) {
        Fields f = read(bot, id);
        write(bot, id, new Fields(f.windup, f.active, f.cooldown, Math.max(0, ms), f.targetX, f.targetY));
    }

    public static void setCharges(Bot bot, int id, int charges) {
        AbilityState.ensure(bot, id).charges = charges;
    }

    public static void setRecharge(Bot bot, int id, int ms) {
        AbilityState.ensure(bot, id).reloadMs = ms;
    }

    /** Starts (or, with {@code ms} 0, ends) a wind-up of {@code id}. */
    public static void setPreparing(Bot bot, Integer id, int ms) {
        setPreparing(bot, id, ms, Double.NaN, Double.NaN);
    }

    public static void setPreparing(Bot bot, Integer id, int ms, double targetX, double targetY) {
        AbilityState.clearWindup(bot);
        if (id == null || ms <= 0) return;
        Fields f = read(bot, id);
        write(bot, id, new Fields(ms, f.active, f.cooldown, f.pending, targetX, targetY));
    }

    public static int activeMs(Bot bot, int id) {
        return AbilityState.activeRemainingMs(bot, id);
    }

    public static int cooldown(Bot bot, int id) {
        return AbilityState.cooldownRemainingMs(bot, id);
    }

    public static int pending(Bot bot, int id) {
        return AbilityState.pendingCooldownMs(bot, id);
    }

    /** The charges entry, or null when the bot has none for the ability. */
    public static Integer charges(Bot bot, int id) {
        AbilityState.Record record = AbilityState.record(bot, id);
        return record == null ? null : record.charges;
    }

    /** The reload entry, or null when the bot has none for the ability. */
    public static Integer recharge(Bot bot, int id) {
        AbilityState.Record record = AbilityState.record(bot, id);
        return record == null ? null : record.reloadMs;
    }

    public static Integer preparingAbility(Bot bot) {
        return AbilityState.preparingAbilityId(bot);
    }

    public static int preparingMs(Bot bot) {
        return AbilityState.preparingRemainingMs(bot);
    }

    /** The stage and time left, e.g. {@code active:200}; the browser tests print the same. */
    public static String stage(Bot bot, int id) {
        AbilityState.Record record = AbilityState.record(bot, id);
        return (record == null ? "ready" : record.stage.name().toLowerCase(java.util.Locale.ROOT)) + ":"
                + (record == null ? 0 : record.remainingMs);
    }
}
