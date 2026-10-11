package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.core.orchestration.Bot;
import com.example.botfight.simulation.core.state.AbilityState;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Verb;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;
import java.util.TreeSet;

/**
 * The timeline of an ability's delayed trigger verbs ({@code atMs} above 0). The activation record holds the
 * index of the next pending verb ({@link AbilityState.Timeline}); nothing is scheduled ahead, {@link #due} derives
 * what comes due from the active time left. An ability that is no longer active (it was interrupted, or its bot
 * died) has no pending steps. Mirrors the timeline functions of the browser's {@code ecs/abilities/verbs.js}.
 */
public final class AbilityTimeline {
    private AbilityTimeline() {}

    /**
     * One ability's steps that came due on a tick: the verbs {@code [from, to)} of its {@code onTrigger}, the
     * activation serial of the cast, the pose and target it captured, and the targets its {@code activation}-scoped
     * hits already touched.
     */
    public record DueStep(int abilityId, int from, int to, int serial, double poseX, double poseY,
                          double poseRotation, double targetX, double targetY, Set<Integer> hit) {
        public boolean hasPose() {
            return Double.isFinite(poseX) && Double.isFinite(poseY) && Double.isFinite(poseRotation);
        }
    }

    /**
     * Called when an ability has just triggered (its active stage started and the act verbs ran): an ability
     * with delayed steps records the index of the first one, the active time it was given, its target and the
     * captured pose its steps may use.
     */
    public static void start(Bot bot, AbilityExecutionPayload activated, int activeMs) {
        int abilityId = activated.abilityId();
        List<Verb> verbs = activated.verbs();
        int next = AbilityContracts.firstDelayedIndex(verbs);
        AbilityState.Record record = AbilityState.record(bot, abilityId);
        if (next < 0 || record == null || record.stage != AbilityState.Stage.ACTIVE) {
            if (record != null) record.steps = null;
            return;
        }
        AbilityState.Timeline steps = new AbilityState.Timeline();
        steps.next = next;
        steps.activeMs = activeMs;
        steps.targetX = activated.targetX();
        steps.targetY = activated.targetY();
        boolean captures = verbs.stream().anyMatch(verb -> "captured".equals(AbilityContracts.poseOf(verb)));
        if (captures && activated.hasCapturedPose()) {
            steps.poseX = activated.capturedOriginX();
            steps.poseY = activated.capturedOriginY();
            steps.poseRotation = activated.capturedRotation();
        }
        record.steps = steps;
    }

    /** Stamps the activation serial the tick settled on onto the timeline of an ability that triggered this tick. */
    public static void stampSerial(Bot bot, Set<Integer> justActivated) {
        for (int abilityId : justActivated) {
            AbilityState.Record record = AbilityState.record(bot, abilityId);
            if (record != null && record.steps != null) record.steps.serial = bot.activationSerial;
        }
    }

    /**
     * The steps due on this tick, found from the active time the abilities have used up once the tick ends: each
     * active ability (other than one that triggered this tick) hands over every pending verb whose {@code atMs}
     * it has reached and moves its next-step index past them. In ascending ability id order.
     */
    public static List<DueStep> due(Bot bot, int elapsedMs, Set<Integer> justActivated) {
        List<DueStep> due = new ArrayList<>();
        for (Map.Entry<Integer, AbilityState.Record> entry : new TreeMap<>(bot.abilityState).entrySet()) {
            int abilityId = entry.getKey();
            AbilityState.Record record = entry.getValue();
            AbilityState.Timeline steps = record.steps;
            if (steps == null || record.stage != AbilityState.Stage.ACTIVE || justActivated.contains(abilityId)) continue;
            AbilityContracts.AbilityContract contract = AbilityContracts.forAbility(abilityId);
            List<Verb> verbs = contract == null ? List.of() : contract.onTrigger();
            int used = steps.activeMs - Math.max(0, record.remainingMs - elapsedMs);
            int next = steps.next;
            while (next < verbs.size() && AbilityContracts.atMs(verbs.get(next)) <= used) next += 1;
            if (next == steps.next) continue;
            due.add(new DueStep(abilityId, steps.next, next, steps.serial, steps.poseX, steps.poseY,
                    steps.poseRotation, steps.targetX, steps.targetY, new TreeSet<>(steps.hit)));
            steps.next = next;
        }
        return due;
    }
}
