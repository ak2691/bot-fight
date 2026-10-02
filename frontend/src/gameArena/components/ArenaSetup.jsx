import { useEffect, useRef, useState } from "react";
import Stepper from "../../components/Stepper.jsx";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import {
    ARENA_HEIGHT_UNITS,
    ARENA_WIDTH_UNITS,
    BASE_BOT_HP,
    BOT_SIZE,
    PRACTICE_OPPONENT_PUBLIC_START,
    PRACTICE_PLAYER_PUBLIC_START,
    PUBLIC_BOT_CENTER_MAX_X,
    PUBLIC_BOT_CENTER_MAX_Y,
    PUBLIC_BOT_CENTER_MIN_X,
    PUBLIC_BOT_CENTER_MIN_Y,
} from "../modelPayloads/arenaConstants.js";
import { normalizePracticeConfig } from "../practiceRoomStorage.js";
import { arenaBotDisplayName, mapPointToArena, teamOf } from "./arenaSetupHelpers.js";
import {
    MAX_PUZZLE_TEAM_SIZE,
    MIN_PUZZLE_TEAM_SIZE,
    PUZZLE_OPPONENT_TEAM,
    PUZZLE_PLAYER_TEAM,
} from "../../pages/puzzles/puzzleRoster.js";

const HALF_WIDTH = ARENA_WIDTH_UNITS / 2;
const HALF_HEIGHT = ARENA_HEIGHT_UNITS / 2;
const GRID_STEP = 150;
const TEAM_COLORS = Object.freeze({ [PUZZLE_PLAYER_TEAM]: "#3b82c4", [PUZZLE_OPPONENT_TEAM]: "#c4453b" });
const FACING_TICK_LENGTH = BOT_SIZE * 1.1;

function defaultStartFor(bot, defaults) {
    const key = `${teamOf(bot)}:${Number(bot.slot) || 1}`;
    const fromDefaults = defaults?.bots?.find((candidate) => `${teamOf(candidate)}:${Number(candidate.slot) || 1}` === key)
        ?? defaults?.bots?.find((candidate) => teamOf(candidate) === teamOf(bot));
    if (fromDefaults) return { startX: fromDefaults.startX, startY: fromDefaults.startY, rotation: fromDefaults.rotation };
    const fallback = teamOf(bot) === PUZZLE_PLAYER_TEAM ? PRACTICE_PLAYER_PUBLIC_START : PRACTICE_OPPONENT_PUBLIC_START;
    return { startX: fallback.x, startY: fallback.y, rotation: fallback.rotation };
}

function DeferredNumberInput({ value, onCommit, ...props }) {
    const [draftValue, setDraftValue] = useState(() => String(value ?? ""));

    useEffect(() => {
        // Re-sync after a drag or bot switch while keeping the raw text during an active edit.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraftValue(String(value ?? ""));
    }, [value]);

    return (
        <input
            {...props}
            type="number"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={() => onCommit?.(draftValue)}
            onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.currentTarget.blur();
            }}
        />
    );
}

function StartingMap({ bots, selectedIndex, onSelect, onMove }) {
    const svgRef = useRef(null);
    const draggingRef = useRef(false);
    const gridLines = [];
    for (let offset = -HALF_WIDTH + GRID_STEP; offset < HALF_WIDTH; offset += GRID_STEP) {
        if (offset !== 0) gridLines.push(offset);
    }

    const moveTo = (event, index) => {
        const rect = svgRef.current?.getBoundingClientRect();
        if (!rect || rect.width === 0) return;
        const point = mapPointToArena(event.clientX, event.clientY, rect);
        onMove(index, point);
    };

    return (
        <svg
            ref={svgRef}
            viewBox={`${-HALF_WIDTH} ${-HALF_HEIGHT} ${ARENA_WIDTH_UNITS} ${ARENA_HEIGHT_UNITS}`}
            className="aspect-square w-full touch-none select-none rounded-lg border border-[#262c33] bg-[#0b0f12]"
            role="group"
            aria-label="Starting positions map. Drag a bot to move it."
        >
            {gridLines.map((offset) => (
                <g key={offset} stroke="#1c2329" strokeWidth="2">
                    <line x1={offset} y1={-HALF_HEIGHT} x2={offset} y2={HALF_HEIGHT} />
                    <line x1={-HALF_WIDTH} y1={offset} x2={HALF_WIDTH} y2={offset} />
                </g>
            ))}
            <g stroke="#2d3740" strokeWidth="3">
                <line x1="0" y1={-HALF_HEIGHT} x2="0" y2={HALF_HEIGHT} />
                <line x1={-HALF_WIDTH} y1="0" x2={HALF_WIDTH} y2="0" />
            </g>
            {bots.map((bot, index) => {
                const selected = index === selectedIndex;
                const radians = (Number(bot.rotation) || 0) * Math.PI / 180;
                // Compass facing: 0 is up, positive turns clockwise; screen Y is flipped.
                const tipX = Math.sin(radians) * FACING_TICK_LENGTH;
                const tipY = -Math.cos(radians) * FACING_TICK_LENGTH;
                const cx = Number(bot.startX) || 0;
                const cy = -(Number(bot.startY) || 0);
                return (
                    <g
                        key={`${teamOf(bot)}-${bot.slot}`}
                        transform={`translate(${cx} ${cy})`}
                        className="cursor-grab"
                        onPointerDown={(event) => {
                            event.currentTarget.setPointerCapture?.(event.pointerId);
                            draggingRef.current = true;
                            onSelect(index);
                            moveTo(event, index);
                        }}
                        onPointerMove={(event) => { if (draggingRef.current) moveTo(event, index); }}
                        onPointerUp={(event) => {
                            draggingRef.current = false;
                            event.currentTarget.releasePointerCapture?.(event.pointerId);
                        }}
                        onPointerCancel={() => { draggingRef.current = false; }}
                    >
                        <title>{arenaBotDisplayName(bot)}</title>
                        {selected && <circle r={BOT_SIZE * 0.95} fill="none" stroke="#e6edf3" strokeWidth="5" opacity=".85" />}
                        <circle r={BOT_SIZE * 0.7} fill={TEAM_COLORS[teamOf(bot)]} />
                        <line x1="0" y1="0" x2={tipX} y2={tipY} stroke="#e6edf3" strokeWidth="8" strokeLinecap="round" />
                        {/* Larger invisible target so small dots are easy to grab. */}
                        <circle r={BOT_SIZE * 1.3} fill="transparent" />
                    </g>
                );
            })}
        </svg>
    );
}

function SectionLabel({ children }) {
    return <h3 className="mb-2 mt-5 text-[10px] font-bold uppercase text-slate-500 first:mt-0">{children}</h3>;
}

/**
 * Shared arena setup, used by the practice room, the puzzle test room and the puzzle builder:
 * team sizes, a start time, and starting positions on a draggable mini map. `onApply` receives
 * the normalized draft; nothing is persisted here.
 */
export default function ArenaSetup({
    draft,
    defaults = null,
    onClose,
    onApply,
    title = "Arena setup",
    subtitle = "Practice room",
    titleId = "arena-setup-title",
    showTeamSizeControls = true,
    maxElapsedSeconds = 60,
}) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true, enabled: true });
    const [localDraft, setLocalDraft] = useState(() => normalizePracticeConfig(draft));
    const [selectedIndex, setSelectedIndex] = useState(0);
    const bots = localDraft.bots;
    const selectedBotIndex = Math.min(selectedIndex, Math.max(0, bots.length - 1));
    const selectedBot = bots[selectedBotIndex] ?? bots[0];
    const selectedTeam = teamOf(selectedBot);

    const updateBot = (index, updates) => {
        setLocalDraft((current) => normalizePracticeConfig({
            ...current,
            bots: current.bots.map((bot, botIndex) => (botIndex === index ? { ...bot, ...updates } : bot)),
        }));
    };
    const updateField = (field, rawValue) => updateBot(selectedBotIndex, { [field]: rawValue });
    const moveBot = (index, point) => updateBot(index, { startX: point.x, startY: point.y });
    const cycle = (direction) => {
        if (bots.length < 2) return;
        setSelectedIndex((current) => (Math.min(current, bots.length - 1) + direction + bots.length) % bots.length);
    };
    const updateTeamSize = (field, value) => setLocalDraft((current) => normalizePracticeConfig({ ...current, [field]: value }));
    const updateElapsed = (seconds) => setLocalDraft((current) => normalizePracticeConfig({ ...current, initialElapsedMs: seconds * 1000 }));
    const resetPositions = () => setLocalDraft((current) => normalizePracticeConfig({
        ...current,
        bots: current.bots.map((bot) => ({ ...bot, ...defaultStartFor(bot, defaults) })),
    }));
    const fieldClass = "h-8 w-full rounded-md border border-[#262c33] bg-[#0b0f12] px-2 text-center font-display text-sm font-bold text-white outline-none focus:border-cyan-400";
    const botName = arenaBotDisplayName(selectedBot);

    return (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 px-4 pb-4 pt-[5.5rem] backdrop-blur-sm max-sm:grid-rows-[minmax(0,1fr)] max-sm:items-stretch max-sm:p-0 max-sm:pt-[72px]" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section
                ref={dialogRef}
                className="arena-setup flex max-h-[calc(100dvh-7.5rem)] w-[min(94vw,31rem)] flex-col overflow-hidden rounded-2xl border border-[#262c33] bg-[#0f1418] text-slate-100 shadow-2xl max-sm:h-full max-sm:max-h-none max-sm:w-full max-sm:rounded-none max-sm:border-0"
                role="dialog"
                aria-modal="true"
                aria-labelledby={titleId}
                tabIndex={-1}
            >
                <header className="flex items-start justify-between gap-4 border-b border-[#262c33] px-5 py-4">
                    <div className="min-w-0">
                        <h2 id={titleId} className="font-display text-xl font-bold text-white">{title}</h2>
                        {subtitle && <p className="mt-0.5 text-xs text-slate-500">{subtitle}</p>}
                    </div>
                    <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="modal-close-button"><span aria-hidden="true">×</span></button>
                </header>

                <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
                    <SectionLabel>Teams</SectionLabel>
                    {showTeamSizeControls && (
                        <>
                            <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[#1c2228]">
                                <span className="flex items-center gap-2 text-sm text-slate-200"><span className="h-2 w-2 rounded-sm bg-[#3b82c4]" aria-hidden="true" />Blue players</span>
                                <Stepper value={localDraft.playerTeamSize} min={MIN_PUZZLE_TEAM_SIZE} max={MAX_PUZZLE_TEAM_SIZE} onChange={(value) => updateTeamSize("playerTeamSize", value)} ariaLabel="Number of blue team players" />
                            </div>
                            <div className="flex min-h-11 items-center justify-between gap-4 border-b border-[#1c2228]">
                                <span className="flex items-center gap-2 text-sm text-slate-200"><span className="h-2 w-2 rounded-sm bg-[#c4453b]" aria-hidden="true" />Red players</span>
                                <Stepper value={localDraft.opponentTeamSize} min={MIN_PUZZLE_TEAM_SIZE} max={MAX_PUZZLE_TEAM_SIZE} onChange={(value) => updateTeamSize("opponentTeamSize", value)} ariaLabel="Number of red team players" />
                            </div>
                        </>
                    )}
                    <div className="flex min-h-12 items-center justify-between gap-4">
                        <div>
                            <p className="text-sm text-slate-200">Start at</p>
                            <p className="text-[11px] text-slate-500">Skip ahead, e.g. to test the shrinking zone</p>
                        </div>
                        <Stepper value={Math.round(localDraft.initialElapsedMs / 1000)} min={0} max={maxElapsedSeconds} unit=" s" onChange={updateElapsed} ariaLabel="Arena elapsed time in seconds" />
                    </div>

                    <SectionLabel>Starting positions <span className="font-normal normal-case text-slate-600">&middot; drag bots on the map</span></SectionLabel>
                    <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                        <StartingMap bots={bots} selectedIndex={selectedBotIndex} onSelect={setSelectedIndex} onMove={moveBot} />
                        <div className="min-w-0 space-y-2">
                            <div className="flex items-center gap-1.5 rounded-md border border-[#262c33] bg-[#12181d] px-2 py-1.5" role="group" aria-label="Select bot">
                                <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: TEAM_COLORS[selectedTeam] }} aria-hidden="true" />
                                <span className="min-w-0 flex-1 truncate text-sm font-semibold text-white" aria-live="polite">{botName}</span>
                                <button type="button" aria-label="Show previous bot" title="Previous bot" onClick={() => cycle(-1)} disabled={bots.length < 2} className="px-1 text-slate-400 hover:text-white disabled:opacity-30">&lsaquo;</button>
                                <span className="text-[11px] text-slate-500">{selectedBotIndex + 1}/{bots.length}</span>
                                <button type="button" aria-label="Show next bot" title="Next bot" onClick={() => cycle(1)} disabled={bots.length < 2} className="px-1 text-slate-400 hover:text-white disabled:opacity-30">&rsaquo;</button>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                                <label className="text-[10px] text-slate-500">X
                                    <DeferredNumberInput min={PUBLIC_BOT_CENTER_MIN_X} max={PUBLIC_BOT_CENTER_MAX_X} step="1" value={selectedBot?.startX ?? 0} onCommit={(value) => updateField("startX", value)} aria-label={`${botName} starting X coordinate`} className={fieldClass} />
                                </label>
                                <label className="text-[10px] text-slate-500">Y
                                    <DeferredNumberInput min={PUBLIC_BOT_CENTER_MIN_Y} max={PUBLIC_BOT_CENTER_MAX_Y} step="1" value={selectedBot?.startY ?? 0} onCommit={(value) => updateField("startY", value)} aria-label={`${botName} starting Y coordinate`} className={fieldClass} />
                                </label>
                                <label className="text-[10px] text-slate-500">Facing (&deg;)
                                    <DeferredNumberInput min="-360" max="360" step="1" value={selectedBot?.rotation ?? 0} onCommit={(value) => updateField("rotation", value)} aria-label={`${botName} starting rotation`} className={fieldClass} />
                                </label>
                                <label className="text-[10px] text-slate-500">HP
                                    <DeferredNumberInput min="1" max={BASE_BOT_HP} step="1" value={selectedBot?.startHp ?? BASE_BOT_HP} onCommit={(value) => updateField("startHp", value)} aria-label={`${botName} starting HP`} className={fieldClass} />
                                </label>
                            </div>
                            <button type="button" onClick={resetPositions} className="text-[11px] font-semibold text-slate-400 hover:text-white">&#8634; Reset positions</button>
                        </div>
                    </div>
                </div>

                <footer className="flex items-center justify-end gap-2 border-t border-[#262c33] px-5 py-3">
                    <button type="button" onClick={onClose} className="min-h-10 rounded-lg border border-[#2d353c] bg-[#12181d] px-5 text-sm font-semibold text-slate-200 hover:border-slate-500">Cancel</button>
                    <button type="button" onClick={() => onApply(localDraft)} className="min-h-10 rounded-lg border-b-[3px] border-[#0f5f78] bg-[#2088ac] px-6 font-display text-sm font-bold text-white hover:brightness-110">APPLY</button>
                </footer>
            </section>
        </div>
    );
}
