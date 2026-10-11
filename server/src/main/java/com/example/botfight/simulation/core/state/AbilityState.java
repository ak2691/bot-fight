package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.gameconfig.AbilityChannels;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.TreeMap;

/**
 * The per-bot ability record, {@code bot.abilityState[abilityId]}, and its accessors; mirrored by the browser's
 * gameconfig/AbilityState.js.
 *
 * <p>A record holds the ability's stage (windup, active, cooldown or ready), the time left in it, the
 * cooldown reserved while it is active (which starts when the active stage ends), the charges and reload of a
 * charge-bearing ability, and the target a wind-up was started with. A missing record is a ready ability.
 * The old loose fields (preparingAbility, abilityActiveMs, ...) no longer exist on a bot; the "legacy" views
 * below derive them for replay DTOs and bot-logic conditions.
 */
public final class AbilityState {
    private AbilityState() {}

    public enum Stage { WINDUP, ACTIVE, COOLDOWN, READY }

    /** One ability's state. A null {@code charges} or {@code reloadMs} means the bot has no such entry. */
    public static final class Record {
        public Stage stage = Stage.READY;
        public int remainingMs;
        /** Only while active: the cooldown that starts when the active stage ends. */
        public int cooldownMs;
        public Integer charges;
        public Integer reloadMs;
        /** Only while winding up: the activation target the wind-up was started with. */
        public double targetX = Double.NaN;
        public double targetY = Double.NaN;
        /** Only while active, for an ability with delayed trigger verbs: the timeline of the activation. */
        public Timeline steps;

        public Record copy() {
            Record copy = new Record();
            copy.stage = stage;
            copy.remainingMs = remainingMs;
            copy.cooldownMs = cooldownMs;
            copy.charges = charges;
            copy.reloadMs = reloadMs;
            copy.targetX = targetX;
            copy.targetY = targetY;
            copy.steps = steps == null ? null : steps.copy();
            return copy;
        }

        /** Back to ready, keeping charges and reload. */
        public void toReady() {
            stage = Stage.READY;
            remainingMs = 0;
            cooldownMs = 0;
            targetX = Double.NaN;
            targetY = Double.NaN;
            steps = null;
        }
    }

    /**
     * The timeline of one activation of an ability with delayed trigger verbs: {@code next} is the index of the
     * next pending verb, {@code activeMs} the active time the activation was given, {@code serial} its activation
     * serial, the target and captured pose its steps may use, and {@code hit} the slots its activation-scoped
     * hits already touched. Mirrors the browser record's {@code steps}.
     */
    public static final class Timeline {
        public int next;
        public int activeMs;
        public int serial;
        public double targetX = Double.NaN;
        public double targetY = Double.NaN;
        public double poseX = Double.NaN;
        public double poseY = Double.NaN;
        public double poseRotation = Double.NaN;
        public final java.util.TreeSet<Integer> hit = new java.util.TreeSet<>();

        public Timeline copy() {
            Timeline copy = new Timeline();
            copy.next = next;
            copy.activeMs = activeMs;
            copy.serial = serial;
            copy.targetX = targetX;
            copy.targetY = targetY;
            copy.poseX = poseX;
            copy.poseY = poseY;
            copy.poseRotation = poseRotation;
            copy.hit.addAll(hit);
            return copy;
        }
    }

    public static Record record(Bot bot, int abilityId) {
        return bot.abilityState.get(abilityId);
    }

    /** The ability's record, created ready if the bot has none yet. */
    public static Record ensure(Bot bot, int abilityId) {
        return bot.abilityState.computeIfAbsent(abilityId, id -> new Record());
    }

    public static Stage stage(Bot bot, int abilityId) {
        Record record = record(bot, abilityId);
        return record == null ? Stage.READY : record.stage;
    }

    private static int remainingIn(Bot bot, int abilityId, Stage stage) {
        Record record = record(bot, abilityId);
        return record != null && record.stage == stage ? Math.max(0, record.remainingMs) : 0;
    }

    public static int windupRemainingMs(Bot bot, int abilityId) {
        return remainingIn(bot, abilityId, Stage.WINDUP);
    }

    public static int activeRemainingMs(Bot bot, int abilityId) {
        return remainingIn(bot, abilityId, Stage.ACTIVE);
    }

    /** The visible cooldown left (after the active stage). */
    public static int cooldownRemainingMs(Bot bot, int abilityId) {
        return remainingIn(bot, abilityId, Stage.COOLDOWN);
    }

    /** The cooldown reserved while the ability is active. */
    public static int pendingCooldownMs(Bot bot, int abilityId) {
        Record record = record(bot, abilityId);
        return record != null && record.stage == Stage.ACTIVE ? Math.max(0, record.cooldownMs) : 0;
    }

    /** Ids of the abilities in a stage with time left, in ascending id order. */
    public static List<Integer> idsInStage(Bot bot, Stage stage) {
        List<Integer> ids = new ArrayList<>();
        new TreeMap<>(bot.abilityState).forEach((id, record) -> {
            if (record.stage == stage && record.remainingMs > 0) ids.add(id);
        });
        return ids;
    }

    /** The ability currently winding up (one at a time per channel; the dash channel never winds up). */
    public static Integer preparingAbilityId(Bot bot) {
        List<Integer> ids = idsInStage(bot, Stage.WINDUP);
        return ids.isEmpty() ? null : ids.getFirst();
    }

    public static int preparingRemainingMs(Bot bot) {
        Integer id = preparingAbilityId(bot);
        return id == null ? 0 : windupRemainingMs(bot, id);
    }

    public static boolean isWindingUp(Bot bot) {
        return preparingAbilityId(bot) != null;
    }

    /** True while an ability of {@code channel} other than {@code exceptAbilityId} is winding up or active. */
    public static boolean channelBusy(Bot bot, String channel, Integer exceptAbilityId) {
        for (Map.Entry<Integer, Record> entry : bot.abilityState.entrySet()) {
            Record record = entry.getValue();
            if (exceptAbilityId != null && entry.getKey().equals(exceptAbilityId)) continue;
            if ((record.stage == Stage.WINDUP || record.stage == Stage.ACTIVE) && record.remainingMs > 0
                    && java.util.Objects.equals(AbilityChannels.channel(entry.getKey()), channel)) return true;
        }
        return false;
    }

    /** True while any ability of {@code channel} (including the one asking) is winding up. */
    public static boolean channelWindingUp(Bot bot, String channel) {
        for (Map.Entry<Integer, Record> entry : bot.abilityState.entrySet()) {
            Record record = entry.getValue();
            if (record.stage == Stage.WINDUP && record.remainingMs > 0
                    && java.util.Objects.equals(AbilityChannels.channel(entry.getKey()), channel)) return true;
        }
        return false;
    }

    /** True while any ability of {@code channel} is winding up or active. */
    public static boolean channelActive(Bot bot, String channel) {
        return channelBusy(bot, channel, null);
    }

    /** Puts an ability back to ready, keeping its charges and reload. */
    public static void ready(Bot bot, int abilityId) {
        Record record = record(bot, abilityId);
        if (record != null) record.toReady();
    }

    /** Ends an ability's active stage: any reserved cooldown starts in full. */
    public static void endActive(Bot bot, int abilityId) {
        Record record = record(bot, abilityId);
        if (record == null || record.stage != Stage.ACTIVE) return;
        int cooldown = Math.max(0, record.cooldownMs);
        record.stage = cooldown > 0 ? Stage.COOLDOWN : Stage.READY;
        record.remainingMs = cooldown;
        record.cooldownMs = 0;
        record.steps = null;
    }

    /** Drops every active stage with no cooldown following it (a bot's effects are cleared at death). */
    public static void clearActiveStages(Bot bot) {
        for (int id : idsInStage(bot, Stage.ACTIVE)) ready(bot, id);
    }

    /** Clears the one wind-up in progress (no cooldown, no charge used). */
    public static void clearWindup(Bot bot) {
        Integer id = preparingAbilityId(bot);
        if (id != null) ready(bot, id);
    }

    /** Deep copy of a bot's records, for state snapshots. */
    public static Map<Integer, Record> copyOf(Map<Integer, Record> records) {
        Map<Integer, Record> copy = new HashMap<>();
        records.forEach((id, record) -> copy.put(id, record.copy()));
        return copy;
    }

    // ---- the old loose fields, derived for replay DTOs and conditions

    /** {@code preparingAbility}: the ability winding up, or null. */
    public static Integer legacyPreparingAbility(Bot bot) {
        return preparingAbilityId(bot);
    }

    /** {@code abilityActiveMs}: remaining active time of every record (0 when it is not active). */
    public static Map<Integer, Integer> legacyActiveMs(Bot bot) {
        Map<Integer, Integer> map = new HashMap<>();
        bot.abilityState.forEach((id, record) -> map.put(id, activeRemainingMs(bot, id)));
        return map;
    }

    /** {@code abilityCooldowns}: the visible cooldown of every record (0 when it is not cooling down). */
    public static Map<Integer, Integer> legacyCooldowns(Bot bot) {
        Map<Integer, Integer> map = new HashMap<>();
        bot.abilityState.forEach((id, record) -> map.put(id, cooldownRemainingMs(bot, id)));
        return map;
    }

    /** {@code abilityCharges}: charges of every record that has any. */
    public static Map<Integer, Integer> legacyCharges(Bot bot) {
        Map<Integer, Integer> map = new HashMap<>();
        bot.abilityState.forEach((id, record) -> {
            if (record.charges != null) map.put(id, record.charges);
        });
        return map;
    }

    /** {@code abilityRechargeMs}: the reload time of every record that has a reload entry. */
    public static Map<Integer, Integer> legacyRechargeMs(Bot bot) {
        Map<Integer, Integer> map = new HashMap<>();
        bot.abilityState.forEach((id, record) -> {
            if (record.reloadMs != null) map.put(id, record.reloadMs);
        });
        return map;
    }
}
