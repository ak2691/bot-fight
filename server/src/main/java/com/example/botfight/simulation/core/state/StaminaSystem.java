package com.example.botfight.simulation.core.state;

import static com.example.botfight.simulation.gameconfig.MovementConfig.FAST_TURN_DRAIN_PER_TICK;
import static com.example.botfight.simulation.gameconfig.MovementConfig.REGEN_DELAY_MS;
import static com.example.botfight.simulation.gameconfig.MovementConfig.REGEN_PER_TICK;
import static com.example.botfight.simulation.gameconfig.MovementConfig.STAMINA_MAX;
import static com.example.botfight.simulation.gameconfig.MovementConfig.WINDUP_CANCEL_COST;

import com.example.botfight.simulation.core.orchestration.CombatLog;
import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.gameconfig.AbilityChannels;

/**
 * Stamina rules, mirrored by the browser's gameconfig/StaminaSystem.js.
 *
 * <p>A tick works like the browser's: readiness (Dash, cancel, sprint) is judged on the state the
 * previous tick left, which is what conditions saw. {@link Tick} advances the regen pause and
 * regeneration from that state, collects this tick's spends, and writes the result when finished, so
 * a spend in tick N gives N+1..N+5 of no regeneration and regeneration from N+6. A hit refund is paid
 * when the tick settles ({@code BotStateService.settleTick}) and never touches the pause.
 */
public final class StaminaSystem {
    private StaminaSystem() {}

    public static int stamina(Bot bot) {
        return Math.max(0, Math.min(STAMINA_MAX, bot.stamina));
    }

    /**
     * Time until the bot can afford an ability's stamina cost, assuming no further stamina is spent: what is
     * left of the regeneration pause, then the ticks of regeneration. 0 when it costs nothing or is affordable.
     */
    public static int staminaWaitMs(Bot bot, int abilityId) {
        int missing = AbilityChannels.staminaCost(abilityId) - stamina(bot);
        if (missing <= 0) return 0;
        int lockout = Math.max(0, bot.staminaRegenDelayMs);
        int regenMs = (int) Math.ceil(missing / (double) REGEN_PER_TICK) * 100;
        return lockout + regenMs;
    }

    /** Stamina-side readiness: the bot must have enough stamina to pay the ability's cost (0 for most). */
    public static boolean abilityStaminaReady(Bot bot, int abilityId) {
        return stamina(bot) >= AbilityChannels.staminaCost(abilityId);
    }

    /**
     * Fast turn needs the drain in stamina; at 0 stamina it simply cannot run until the bot refills. Judged
     * on the state the previous tick left.
     */
    public static boolean canFastTurn(Bot bot) {
        return stamina(bot) >= FAST_TURN_DRAIN_PER_TICK;
    }

    /** Adds refunded stamina (capped at the maximum) without touching the regeneration pause. */
    public static void refund(Bot bot, int amount) {
        if (amount <= 0) return;
        CombatLog.record("stamina", null, CombatLog.bot(bot.slot), null, "refund", amount);
        bot.stamina = Math.min(STAMINA_MAX, stamina(bot) + amount);
    }

    public static boolean canCancelWindup(Bot bot) {
        return AbilityState.isWindingUp(bot) && stamina(bot) >= WINDUP_CANCEL_COST;
    }

    /** One tick of stamina bookkeeping. */
    public static final class Tick {
        private final int slot;
        private final int stamina;
        private final int regenDelayMs;
        private int spent;
        private boolean spentAny;
        private boolean sprinting;
        private boolean fastTurning;

        private Tick(Bot bot, int elapsedMs) {
            this.slot = bot.slot;
            int delay = Math.max(0, bot.staminaRegenDelayMs);
            int current = stamina(bot);
            boolean regenerates = delay <= 0 && current < STAMINA_MAX;
            this.stamina = regenerates ? Math.min(STAMINA_MAX, current + REGEN_PER_TICK) : current;
            this.regenDelayMs = Math.max(0, delay - elapsedMs);
        }

        public void spend(int amount) {
            if (amount <= 0) return;
            CombatLog.record("stamina", null, CombatLog.bot(slot), null, "spend", amount);
            spent += amount;
            spentAny = true;
        }

        /** Pays the stamina an activation of the ability costs; an ability with no cost leaves the pause alone. */
        public void spendForAbility(int abilityId) {
            spend(AbilityChannels.staminaCost(abilityId));
        }

        public void setSprinting(boolean value) {
            sprinting = value;
        }

        public void setFastTurning(boolean value) {
            fastTurning = value;
        }

        /** Writes the tick's result: spends clamp at 0 and restart the regen pause. */
        public void finish(Bot bot) {
            int result = Math.max(0, stamina - spent);
            bot.stamina = result;
            bot.staminaRegenDelayMs = spentAny ? REGEN_DELAY_MS : regenDelayMs;
            bot.sprinting = sprinting;
            bot.fastTurning = fastTurning;
        }
    }

    public static Tick begin(Bot bot, int elapsedMs) {
        return new Tick(bot, elapsedMs);
    }

    /** Clears the wind-up with no cooldown or used charge; the caller pays through {@link Tick#spend}. */
    public static void clearWindup(Bot bot) {
        AbilityState.clearWindup(bot);
    }

    public static int cancelCost() {
        return WINDUP_CANCEL_COST;
    }
}
