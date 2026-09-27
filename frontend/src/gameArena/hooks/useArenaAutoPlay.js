import { useCallback, useEffect, useRef, useState } from "react";
import { AUTO_STEP_MS } from "../modelPayloads/arenaConstants.js";
import { buildAutoPlayStartShapes } from "../modelPayloads/arenaShapes.js";
import { advanceArenaPreviewTick } from "../modelPayloads/arenaPreviewSimulation.js";
import { buildTutorialArenaShapes } from "../../tutorial/TutorialPresets.js";

/** Owns the browser-only fixed-step preview loop and its Play/Pause lifecycle. */
export function useArenaAutoPlay({
    isPracticeRoom,
    isPuzzleMode,
    isMatchTesting,
    tutorialMode,
    tutorialStep,
    matchContext,
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

    const stopAutoPlay = useCallback(() => {
        if (autoIntervalRef.current) {
            clearInterval(autoIntervalRef.current);
            autoIntervalRef.current = null;
        }
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
        if (tutorialMode) {
            setShapes(buildTutorialArenaShapes(tutorialStep));
        } else if (!isPuzzleMode && !isPracticeRoom) {
            setShapes((previousShapes) => buildAutoPlayStartShapes(
                previousShapes,
                matchContext,
                isMatchTesting,
            ));
        } else {
            // Puzzle and practice previews keep the current setup; Reset Stats
            // is the explicit action that reinitializes their runtime state.
        }

        autoIntervalRef.current = setInterval(() => {
            setShapes((previousShapes) => advanceArenaPreviewTick(previousShapes, {
                selectedLoadout,
                opponentLoadout,
                testingConfiguration: testingConfigurationRef.current,
                opponentTestingConfiguration: opponentTestingConfigurationRef.current,
            }));
        }, AUTO_STEP_MS);
    }, [
        isAutoPlaying,
        isMatchTesting,
        isPracticeRoom,
        isPuzzleMode,
        matchContext,
        onPuzzleOutcome,
        opponentLoadout,
        opponentTestingConfigurationRef,
        selectedLoadout,
        setIsEditingArena,
        setSelectedId,
        setShapes,
        testingConfigurationRef,
        tutorialMode,
        tutorialStep,
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
