import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";
import { createFight } from "../modelPayloads/arenaPreviewSimulation.js";

/**
 * Owns the browser-only fixed-step preview loop and its Play/Pause lifecycle.
 *
 * The running fight lives in a ref; React state only ever receives `fight.frame()`, new plain objects, so no
 * working object leaves the engine. A shapes change that did not come from a frame of this fight (a drag, a
 * reset) starts the fight over from those shapes, as the next tick used to read them.
 */
export function useArenaAutoPlay({
    isPracticeRoom,
    isPuzzleMode,
    shapes,
    selectedLoadout,
    opponentLoadout,
    testingConfigurationRef,
    opponentTestingConfigurationRef,
    setShapes,
    setSelectedId,
    setIsEditingArena,
    onPuzzleOutcome,
}) {
    const [isAutoPlaying, setIsAutoPlaying] = useState(false);
    const autoIntervalRef = useRef(null);
    const fightRef = useRef(null);
    const shapesRef = useRef(shapes);
    const emittedFramesRef = useRef(new WeakSet());

    useLayoutEffect(() => {
        shapesRef.current = shapes;
        const fight = fightRef.current;
        if (fight && !emittedFramesRef.current.has(shapes)) {
            fightRef.current = createFight(shapes, fight.options);
        }
    }, [shapes]);

    const stopAutoPlay = useCallback(() => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
        fightRef.current = null;
        setIsAutoPlaying(false);
    }, []);

    const runAutoPlay = useCallback(() => {
        if (isAutoPlaying || autoIntervalRef.current) return;
        if (isPracticeRoom && typeof document !== "undefined" && document.hidden) {
            setIsEditingArena(true);
            return;
        }
        if (isPuzzleMode) onPuzzleOutcome?.(null);
        setIsEditingArena(false);
        setIsAutoPlaying(true);
        setSelectedId(null);

        fightRef.current = createFight(shapesRef.current, { selectedLoadout, opponentLoadout });
        autoIntervalRef.current = setInterval(() => {
            const fight = fightRef.current;
            if (!fight) return;
            // Code edits take effect on the next tick: the brains are read from the refs every step.
            fight.step({
                testingConfiguration: testingConfigurationRef.current,
                opponentTestingConfiguration: opponentTestingConfigurationRef.current,
            });
            const frame = fight.frame();
            emittedFramesRef.current.add(frame);
            setShapes(frame);
        }, AUTO_STEP_MS);
    }, [
        isAutoPlaying,
        isPracticeRoom,
        isPuzzleMode,
        onPuzzleOutcome,
        opponentLoadout,
        opponentTestingConfigurationRef,
        selectedLoadout,
        setIsEditingArena,
        setSelectedId,
        setShapes,
        testingConfigurationRef,
    ]);

    useEffect(() => () => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
    }, []);

    useEffect(() => {
        if (!isPracticeRoom) return undefined;
        const pausePracticePreviewWhenHidden = () => {
            if (!document.hidden || !autoIntervalRef.current) return;
            stopAutoPlay();
            setIsEditingArena(true);
        };
        document.addEventListener("visibilitychange", pausePracticePreviewWhenHidden);
        pausePracticePreviewWhenHidden();
        return () => document.removeEventListener("visibilitychange", pausePracticePreviewWhenHidden);
    }, [isPracticeRoom, setIsEditingArena, stopAutoPlay]);

    return { isAutoPlaying, runAutoPlay, stopAutoPlay };
}
