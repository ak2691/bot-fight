package com.example.botfight.simulation.core.state;

import com.example.botfight.simulation.gameconfig.Abilities;
import com.example.botfight.simulation.core.orchestration.DuelSimulationService;
import java.util.List;
import java.util.function.Consumer;
import java.util.function.ObjIntConsumer;
import java.util.function.ToIntFunction;

/** Advances bot-local state transitions that resolve after a captured delay. */
final class DeferredStateSystem {
    private static final List<DeferredStateContract> CONTRACTS = List.of(
            new DeferredStateContract(
                    bot -> bot.temporalRewindMs,
                    (bot, value) -> bot.temporalRewindMs = value,
                    bot -> bot.temporalRewindPulseMs,
                    (bot, value) -> bot.temporalRewindPulseMs = value,
                    bot -> (int) Abilities.stat(21, "intervalMs", 400),
                    bot -> {
                        bot.x = bot.temporalRewindX;
                        bot.y = bot.temporalRewindY;
                        bot.hp = Math.min(bot.maxHp, bot.temporalRewindHp);
                    }));

    private DeferredStateSystem() {}

    public static boolean tick(DuelSimulationService.Bot bot, int elapsedMs) {
        int elapsed = Math.max(0, elapsedMs);
        boolean completed = false;
        for (DeferredStateContract contract : CONTRACTS) {
            completed |= advance(bot, contract, elapsed);
        }
        return completed;
    }

    private static boolean advance(DuelSimulationService.Bot bot,
                                   DeferredStateContract contract,
                                   int elapsedMs) {
        int remainingBefore = Math.max(0, contract.remaining().applyAsInt(bot));
        int remaining = Math.max(0, remainingBefore - elapsedMs);
        boolean completes = remainingBefore > 0 && remaining == 0;

        contract.remainingSetter().accept(bot, remaining);
        if (completes) contract.complete().accept(bot);
        if (contract.completionVisual() != null) {
            int visualRemaining = completes
                    ? Math.max(0, contract.completionVisualDuration().applyAsInt(bot))
                    : Math.max(0, contract.completionVisual().applyAsInt(bot) - elapsedMs);
            contract.completionVisualSetter().accept(bot, visualRemaining);
        }
        return completes;
    }

    private record DeferredStateContract(
            ToIntFunction<DuelSimulationService.Bot> remaining,
            ObjIntConsumer<DuelSimulationService.Bot> remainingSetter,
            ToIntFunction<DuelSimulationService.Bot> completionVisual,
            ObjIntConsumer<DuelSimulationService.Bot> completionVisualSetter,
            ToIntFunction<DuelSimulationService.Bot> completionVisualDuration,
            Consumer<DuelSimulationService.Bot> complete) {
    }
}
