package com.example.botfight.simulation.core.combat;

import com.example.botfight.simulation.ecs.contracts.AbilityContracts.ApplyEffectsVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.EmitVisualVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.FaceVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.HitVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.MoveVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.RemoveVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.SpawnVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.TransitionVerb;
import com.example.botfight.simulation.ecs.contracts.AbilityContracts.Verb;
import java.util.List;

/**
 * The one verb executor. An ability's {@code onTrigger} list and every entity event's {@code do} list run
 * through {@link #execute}; a {@link Host} says what each verb does where it runs:
 * <ul>
 *   <li>the act stage: the owner bot faces and moves, then its spawn verbs create entities;</li>
 *   <li>the resolveHits stage: the owner's effects apply and the hits land on the roster;</li>
 *   <li>an entity event: the entity hits, spawns, applies effects, changes phase, emits a visual or removes
 *       itself.</li>
 * </ul>
 * A trigger verb runs in the tick stage that owns it ({@link Stage}). Mirrors the browser's
 * {@code ecs/abilities/verbs.js}.
 */
public final class AbilityVerbs {
    private AbilityVerbs() {}

    /** The tick stage that runs a trigger verb. */
    public enum Stage { ACT, RESOLVE_HITS }

    /** What the verbs do in one place; a verb the place does not support is ignored. */
    public interface Host {
        default void hit(HitVerb verb) {}
        default void applyEffects(ApplyEffectsVerb verb) {}
        default void spawn(SpawnVerb verb) {}
        default void move(MoveVerb verb) {}
        default void face(FaceVerb verb) {}
        default void transition(TransitionVerb verb) {}
        default void remove(RemoveVerb verb) {}
        default void emitVisual(EmitVisualVerb verb) {}

        /** True once a verb ended the run (an entity removed itself), so later verbs are skipped. */
        default boolean finished() { return false; }
    }

    public static Stage stageOf(Verb verb) {
        return verb instanceof ApplyEffectsVerb || verb instanceof HitVerb ? Stage.RESOLVE_HITS : Stage.ACT;
    }

    public static void execute(Verb verb, Host host) {
        switch (verb) {
            case HitVerb hit -> host.hit(hit);
            case ApplyEffectsVerb apply -> host.applyEffects(apply);
            case SpawnVerb spawn -> host.spawn(spawn);
            case MoveVerb move -> host.move(move);
            case FaceVerb face -> host.face(face);
            case TransitionVerb transition -> host.transition(transition);
            case RemoveVerb remove -> host.remove(remove);
            case EmitVisualVerb emit -> host.emitVisual(emit);
        }
    }

    /** Runs every verb in order until the host reports the run finished. */
    public static void run(List<Verb> verbs, Host host) {
        for (Verb verb : verbs) {
            execute(verb, host);
            if (host.finished()) return;
        }
    }

    /** The index just past the verbs that run on the trigger tick (all of them when none is delayed). */
    public static int triggerEnd(List<Verb> verbs) {
        int delayed = com.example.botfight.simulation.ecs.contracts.AbilityContracts.firstDelayedIndex(verbs);
        return delayed < 0 ? verbs.size() : delayed;
    }

    /** Runs the trigger verbs that belong to {@code stage}, in order. */
    public static void run(List<Verb> verbs, Stage stage, Host host) {
        for (Verb verb : verbs) {
            if (stageOf(verb) == stage) execute(verb, host);
        }
    }
}
