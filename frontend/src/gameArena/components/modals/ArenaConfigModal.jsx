import { useEffect, useRef, useState } from "react";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { BASE_BOT_HP, BOT_CENTER_MAX_X, BOT_CENTER_MAX_Y, BOT_CENTER_MIN_X, BOT_CENTER_MIN_Y } from "../../modelPayloads/arenaConstants.js";
import { normalizePracticeConfig } from "../../practiceRoomStorage.js";
import { PUZZLE_OPPONENT_TEAM, PUZZLE_PLAYER_TEAM } from "../../../pages/puzzles/puzzleRoster.js";

function arenaBotDisplayName(bot) {
    const teamNumber = Number(bot?.teamNumber);
    const slot = Number(bot?.slot) || 1;
    if (teamNumber === PUZZLE_PLAYER_TEAM && slot === 1) return "My Bot";
    return teamNumber === PUZZLE_PLAYER_TEAM ? `Teammate ${slot - 1}` : `Opponent ${slot}`;
}

function arenaTeamLabel(teamNumber) {
    return Number(teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM";
}

function DeferredNumberInput({ value, onCommit, ...props }) {
    const [draftValue, setDraftValue] = useState(() => String(value ?? ""));

    useEffect(() => {
        // Re-sync after a committed value or bot selection changes while
        // preserving the raw value during the active edit.
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setDraftValue(String(value ?? ""));
    }, [value]);

    const commit = () => onCommit?.(draftValue);

    return (
        <input
            {...props}
            type="number"
            value={draftValue}
            onChange={(event) => setDraftValue(event.target.value)}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                event.currentTarget.blur();
            }}
        />
    );
}

export default function ArenaConfigModal({ draft, defaults = null, onClose, onSave, eyebrow, title, titleId, saveLabel, restoreLabel = null, showTeamSizeControls = true }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, {
        onClose,
        lockScroll: true,
        enabled: true,
    });
    const [localDraft, setLocalDraft] = useState(() => normalizePracticeConfig(draft));
    const [selectedIndex, setSelectedIndex] = useState(0);
    const bots = localDraft.bots;
    const selectedBotIndex = Math.min(selectedIndex, Math.max(0, bots.length - 1));
    const selectedBot = bots[selectedBotIndex] ?? bots[0];
    const teamNumber = Number(selectedBot?.teamNumber) === PUZZLE_OPPONENT_TEAM
        ? PUZZLE_OPPONENT_TEAM
        : PUZZLE_PLAYER_TEAM;
    const tone = teamNumber === PUZZLE_OPPONENT_TEAM ? "red" : "blue";
    const updateTeamSize = (field, rawValue) => {
        setLocalDraft((current) => normalizePracticeConfig({ ...current, [field]: rawValue }));
    };
    const updateElapsedTime = (rawValue) => {
        setLocalDraft((current) => {
            const seconds = Number(rawValue);
            const fallbackSeconds = Number(current.initialElapsedMs ?? 0) / 1000;
            const resolvedSeconds = Number.isFinite(seconds) ? seconds : fallbackSeconds;
            return normalizePracticeConfig({ ...current, initialElapsedMs: resolvedSeconds * 1000 });
        });
    };
    const updateBot = (field, rawValue) => {
        setLocalDraft((current) => normalizePracticeConfig({
            ...current,
            bots: current.bots.map((bot, index) => index === selectedBotIndex ? { ...bot, [field]: rawValue } : bot),
        }));
    };
    const cycle = (direction) => {
        if (bots.length < 2) return;
        setSelectedIndex((current) => (Math.min(current, bots.length - 1) + direction + bots.length) % bots.length);
    };
    const restoreDefaults = () => {
        if (!defaults) return;
        setLocalDraft(normalizePracticeConfig(defaults));
        setSelectedIndex(0);
    };
    const inputClass = `mt-1 h-9 w-full border bg-slate-950 px-2 text-center font-interface-numeric text-sm text-white outline-none ${tone === "red" ? "border-red-900/80 focus:border-red-400" : "border-cyan-900/80 focus:border-cyan-400"}`;

    return (
        <div className="fixed inset-0 z-[110] grid place-items-center bg-black/75 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
            <section ref={dialogRef} className="max-h-[92vh] w-[min(92vw,560px)] overflow-y-auto rounded-xl border border-cyan-700/70 bg-[#11171a] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
                <header className="flex items-center justify-between gap-4 border-b border-slate-700/80 bg-slate-950/70 px-5 py-4">
                    <div><p className="font-mono text-[9px] font-bold tracking-[.2em] text-cyan-300">{eyebrow}</p><h2 id={titleId} className="mt-1 text-lg font-bold text-white">{title}</h2></div>
                    <button type="button" onClick={onClose} aria-label={`Close ${title}`} className="modal-close-button"><span aria-hidden="true">×</span></button>
                </header>
                <div className="space-y-4 p-5">
                    <div className="space-y-2">
                        {showTeamSizeControls && <>
                            <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300">
                                <span>BLUE TEAM PLAYERS</span>
                                <DeferredNumberInput min="1" max="2" step="1" value={localDraft.playerTeamSize} onCommit={(value) => updateTeamSize("playerTeamSize", value)} aria-label="Number of blue team players" className="h-9 w-24 border-2 border-cyan-400/80 bg-cyan-950/20 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-300" />
                            </label>
                            <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300">
                                <span>RED TEAM PLAYERS</span>
                                <DeferredNumberInput min="1" max="2" step="1" value={localDraft.opponentTeamSize} onCommit={(value) => updateTeamSize("opponentTeamSize", value)} aria-label="Number of red team players" className="h-9 w-24 border-2 border-red-400/80 bg-red-950/20 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-red-300" />
                            </label>
                        </>}
                        <label className="flex min-h-11 items-center justify-between gap-4 border-b border-slate-800/80 pb-2 font-mono text-[9px] text-slate-300">
                            <span>TIME AT / SEC</span>
                            <DeferredNumberInput min="0" max="60" step="1" value={Math.round(localDraft.initialElapsedMs / 1000)} onCommit={updateElapsedTime} aria-label="Arena elapsed time in seconds" className="h-9 w-24 border border-slate-700 bg-slate-950 px-2 text-center font-interface-numeric text-sm text-white outline-none focus:border-cyan-400" />
                        </label>
                    </div>
                    <section className={`rounded border p-3 ${tone === "red" ? "border-red-900/60 bg-red-950/20" : "border-cyan-400/65 bg-cyan-950/30"}`}>
                        <div className="mb-2 flex items-center justify-between"><h3 className="font-mono text-[10px] font-bold tracking-[.16em] text-cyan-200">STARTING STATS</h3></div>
                        <div className="code-bot-selector-stack w-full max-w-none">
                            <div className={`code-bot-selector ${tone === "red" ? "is-red" : "is-blue"}`} role="group" aria-label="Select starting stats">
                                <button type="button" aria-label="Show previous bot" title="Previous bot" onClick={() => cycle(-1)} disabled={bots.length < 2} className="code-bot-selector__arrow">‹</button>
                                <div className="code-bot-selector__current" aria-live="polite">
                                    <span className="code-bot-selector__name">{arenaBotDisplayName(selectedBot)}</span>
                                    <span className="code-bot-selector__meta">{arenaTeamLabel(teamNumber)} · STARTING STATS · {Math.max(1, selectedBotIndex + 1)}/{bots.length}</span>
                                </div>
                                <button type="button" aria-label="Show next bot" title="Next bot" onClick={() => cycle(1)} disabled={bots.length < 2} className="code-bot-selector__arrow">›</button>
                            </div>
                        </div>
                        <div className="mt-3 grid grid-cols-2 gap-2">
                            <label className="font-mono text-[8px] text-slate-500">X<DeferredNumberInput min={BOT_CENTER_MIN_X} max={BOT_CENTER_MAX_X} step="1" value={selectedBot?.startX ?? BOT_CENTER_MIN_X} onCommit={(value) => updateBot("startX", value)} aria-label={`${arenaBotDisplayName(selectedBot)} starting X position`} className={inputClass} /></label>
                            <label className="font-mono text-[8px] text-slate-500">Y<DeferredNumberInput min={BOT_CENTER_MIN_Y} max={BOT_CENTER_MAX_Y} step="1" value={selectedBot?.startY ?? BOT_CENTER_MIN_Y} onCommit={(value) => updateBot("startY", value)} aria-label={`${arenaBotDisplayName(selectedBot)} starting Y position`} className={inputClass} /></label>
                            <label className="font-mono text-[8px] text-slate-500">ROTATION<DeferredNumberInput min="-360" max="360" step="1" value={selectedBot?.rotation ?? 0} onCommit={(value) => updateBot("rotation", value)} aria-label={`${arenaBotDisplayName(selectedBot)} starting rotation`} className={inputClass} /></label>
                            <label className="font-mono text-[8px] text-slate-500">HP<DeferredNumberInput min="1" max={BASE_BOT_HP} step="1" value={selectedBot?.startHp ?? BASE_BOT_HP} onCommit={(value) => updateBot("startHp", value)} aria-label={`${arenaBotDisplayName(selectedBot)} starting HP`} className={inputClass} /></label>
                        </div>
                    </section>
                </div>
                <footer className="flex flex-wrap items-center justify-between gap-2 border-t border-slate-700/80 bg-slate-950/70 px-5 py-4">
                    {defaults && restoreLabel ? <button type="button" onClick={restoreDefaults} className="gray-button-surface min-h-10 border border-amber-400/70 px-4 font-mono text-[9px] font-bold tracking-[.12em] text-amber-200">{restoreLabel}</button> : <span />}
                    <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className="gray-button-surface min-h-10 border border-slate-600 px-5 font-mono text-[10px] font-bold tracking-[.16em] text-slate-300">CANCEL</button><button type="button" onClick={() => onSave(localDraft)} className="gray-button-surface min-h-10 border border-cyan-400 px-5 font-mono text-[10px] font-bold tracking-[.16em] text-cyan-100">{saveLabel}</button></div>
                </footer>
            </section>
        </div>
    );
}
