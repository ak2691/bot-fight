package com.example.botfight.simulation.core.state;

import static com.example.botfight.simulation.gameconfig.MovementConfig.DASH_ABILITY_ID;
import static com.example.botfight.simulation.gameconfig.MovementConfig.DASH_COST;
import static com.example.botfight.simulation.gameconfig.MovementConfig.DASH_GAP_MS;
import static com.example.botfight.simulation.gameconfig.MovementConfig.FAST_TURN_DRAIN_PER_TICK;
import static com.example.botfight.simulation.gameconfig.MovementConfig.REGEN_DELAY_MS;
import static com.example.botfight.simulation.gameconfig.MovementConfig.REGEN_PER_TICK;
import static com.example.botfight.simulation.gameconfig.MovementConfig.STAMINA_MAX;
import static com.example.botfight.simulation.gameconfig.MovementConfig.WINDUP_CANCEL_COST;

import com.example.botfight.simulation.core.orchestration.DuelSimulationService.Bot;

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

    public static boolean dashReady(Bot bot) {
        return stamina(bot) >= DASH_COST && bot.dashGapMs <= 0;
    }

    /** Time until Dash can start again, assuming no further stamina is spent. */
    public static int dashWaitMs(Bot bot) {
        int gap = Math.max(0, bot.dashGapMs);
        int missing = DASH_COST - stamina(bot);
        if (missing <= 0) return gap;
        int lockout = Math.max(0, bot.staminaRegenDelayMs);
        int regenMs = (int) Math.ceil(missing / (double) REGEN_PER_TICK) * 100;
        return Math.max(gap, lockout + regenMs);
    }

    /** Stamina-side readiness: only Dash is gated, on stamina and its gap. */
    public static boolean abilityStaminaReady(Bot bot, int abilityId) {
        return abilityId != DASH_ABILITY_ID || dashReady(bot);
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
        bot.stamina = Math.min(STAMINA_MAX, stamina(bot) + amount);
    }

    public static boolean canCancelWindup(Bot bot) {
        return bot.preparingAbility != null && bot.preparingMs > 0 && stamina(bot) >= WINDUP_CANCEL_COST;
    }

    /** One tick of stamina bookkeeping. */
    public static final class Tick {
        private final int stamina;
        private final int regenDelayMs;
        private final int dashGapMs;
        private int spent;
        private boolean spentAny;
        private boolean dashStarted;
        private boolean sprinting;
        private boolean fastTurning;

        private Tick(Bot bot, int elapsedMs) {
            int delay = Math.max(0, bot.staminaRegenDelayMs);
            int current = stamina(bot);
            boolean regenerates = delay <= 0 && current < STAMINA_MAX;
            this.stamina = regenerates ? Math.min(STAMINA_MAX, current + REGEN_PER_TICK) : current;
            this.regenDelayMs = Math.max(0, delay - elapsedMs);
            this.dashGapMs = Math.max(0, bot.dashGapMs - elapsedMs);
        }

        public void spend(int amount) {
            if (amount <= 0) return;
            spent += amount;
            spentAny = true;
        }

        /** Dash pays stamina and starts its gap instead of a cooldown. */
        public void spendDash() {
            spend(DASH_COST);
            dashStarted = true;
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
            bot.dashGapMs = dashStarted ? DASH_GAP_MS : dashGapMs;
            bot.sprinting = sprinting;
            bot.fastTurning = fastTurning;
        }
    }

    public static Tick begin(Bot bot, int elapsedMs) {
        return new Tick(bot, elapsedMs);
    }

    /** Clears the wind-up with no cooldown or used charge; the caller pays through {@link Tick#spend}. */
    public static void clearWindup(Bot bot) {
        bot.preparingAbility = null;
        bot.preparingMs = 0;
        bot.preparingTargetX = Double.NaN;
        bot.preparingTargetY = Double.NaN;
    }

    public static int cancelCost() {
        return WINDUP_CANCEL_COST;
    }
}
