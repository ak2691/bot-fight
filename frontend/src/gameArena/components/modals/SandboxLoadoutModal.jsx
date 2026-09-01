import { useRef } from "react";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { getAbilityCatalogueIcon, getAbilityCatalogueIconLayout } from "../../../abilityCatalogueIcons.js";
import { loadoutDraftForEntry } from "../../loadout/sandboxLoadout.js";
import { PUZZLE_OPPONENT_TEAM } from "../../../pages/puzzles/puzzleRoster.js";

function abilityDisplayTag(tag) {
    return String(tag ?? "")
        .replaceAll("-", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function SandboxAbilityCard({ ability, selected, onToggle }) {
    const iconPath = getAbilityCatalogueIcon(ability.id);
    return (
        <button
            type="button"
            aria-pressed={selected}
            aria-label={`${selected ? "Unequip" : "Equip"} ${ability.label}`}
            onClick={() => onToggle(ability.id)}
            className={`gray-button-surface ability-card ability-card-${ability.round} group relative min-h-52 w-full overflow-hidden rounded-none border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 ${selected
                ? "-translate-y-1 cursor-pointer border-green-400 bg-green-950/25 shadow-[0_8px_24px_rgba(114,182,93,0.12)] ring-2 ring-green-300/75 ring-offset-2 ring-offset-[#171a1c] hover:border-green-300"
                : "cursor-pointer border-slate-700/75 bg-[#202427]/85 hover:border-green-700 hover:bg-green-950/15"
                }`}
        >
            {iconPath && (
                <img
                    src={iconPath}
                    alt=""
                    aria-hidden="true"
                    className={`ability-card-art ability-card-art-${getAbilityCatalogueIconLayout(ability.id)}`}
                    onError={(event) => {
                        event.currentTarget.hidden = true;
                    }}
                />
            )}
            <span className="ability-card-gradient" aria-hidden="true" />
            <span className="absolute right-4 top-2 font-display-action text-6xl text-white/[.035]" aria-hidden="true">
                {String(ability.id).padStart(2, "0")}
            </span>
            <span className="ability-card-content absolute inset-x-0 bottom-0 border-t border-white/10 px-5 py-4">
                {selected && <span className="mb-1 block font-mono text-[9px] font-bold tracking-[.2em] text-green-200">EQUIPPED</span>}
                <span className="block font-display-action text-xl uppercase tracking-wider text-white">{ability.label}</span>
                <span className="mt-2 flex flex-wrap gap-1.5">
                    <span className="font-mono text-[8px] font-bold tracking-[.16em] text-green-300/70">{ability.kind.toUpperCase()}</span>
                    {(ability.catalogueTags ?? []).map((tag) => (
                        <span key={tag} className="border border-green-400/40 px-1.5 py-0.5 font-mono text-[8px] font-bold uppercase tracking-[.12em] text-green-300/80">
                            {abilityDisplayTag(tag)}
                        </span>
                    ))}
                </span>
            </span>
        </button>
    );
}

export default function SandboxLoadoutModal({
    activeLoadoutEntry,
    activeLoadoutIndex,
    activeSandboxLoadout,
    loadoutEditorRoster,
    sandboxLoadoutDrafts,
    sandboxLoadoutSearch,
    visibleSandboxAbilities,
    onApply,
    onClose,
    onCycle,
    onSearchChange,
    onSelectBot,
    onToggleAbility,
}) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, {
        onClose,
        lockScroll: true,
        enabled: Boolean(activeLoadoutEntry),
    });

    if (!activeLoadoutEntry) return null;

    return (
        <div
            ref={dialogRef}
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
            className="fixed inset-0 z-[100] flex items-center justify-center overflow-y-auto bg-[#02070de8] p-4 backdrop-blur-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="sandbox-loadout-title"
            tabIndex={-1}
            onKeyDown={(event) => {
                if (event.key !== "Enter" || event.target.closest?.(".modal-close-button")) return;
                event.preventDefault();
                onApply();
            }}
        >
            <div className="max-h-[92vh] w-full max-w-6xl overflow-y-auto border border-green-400/60 bg-[#171a1c] p-5 text-white shadow-[0_32px_100px_rgba(0,0,0,.72)] sm:p-7">
                <div className="flex items-start justify-between gap-4 border-b border-slate-700/70 pb-5">
                    <div>
                        <p className="font-mono text-[10px] font-bold tracking-[.28em] text-green-300">BOT LOADOUT EDITOR</p>
                        <h2 id="sandbox-loadout-title" className="mt-2 font-display-action text-4xl uppercase tracking-wide text-white sm:text-5xl">{activeLoadoutEntry.username} loadout</h2>
                        <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-400">Choose abilities for every bot in this room.</p>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close sandbox loadout editor" className="modal-close-button"><span aria-hidden="true">×</span></button>
                </div>

                <div className="mt-5 flex items-center gap-2">
                    <button type="button" aria-label="Show previous bot loadout" title="Previous bot" onClick={() => onCycle(-1)} disabled={loadoutEditorRoster.length < 2} className="code-bot-selector__arrow code-loadout-selector__arrow">‹</button>
                    <div className="flex min-w-0 flex-1 gap-2 overflow-x-auto pb-1" role="tablist" aria-label="Select bot loadout">
                        {loadoutEditorRoster.map((entry) => {
                            const draft = sandboxLoadoutDrafts[entry.key] ?? loadoutDraftForEntry(entry);
                            const active = entry.key === activeLoadoutEntry.key;
                            const teamLabel = Number(entry.teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM";
                            return (
                                <button
                                    type="button"
                                    key={entry.key}
                                    role="tab"
                                    aria-selected={active}
                                    onClick={() => onSelectBot(entry.key)}
                                    className={`min-w-32 shrink-0 rounded border px-3 py-2 text-left transition ${active
                                        ? "border-green-400 bg-green-950/30 text-white shadow-[0_0_0_1px_rgba(114,182,93,.22)]"
                                        : "border-slate-700/80 bg-slate-950/25 text-slate-400 hover:border-green-700/70 hover:text-slate-200"
                                        }`}
                                >
                                    <span className="block truncate text-xs font-bold">{entry.username}</span>
                                    <span className="mt-1 block truncate font-mono text-[8px] tracking-widest text-green-300/70">{teamLabel} · {draft.abilities.length} EQUIPPED</span>
                                </button>
                            );
                        })}
                    </div>
                    <button type="button" aria-label="Show next bot loadout" title="Next bot" onClick={() => onCycle(1)} disabled={loadoutEditorRoster.length < 2} className="code-bot-selector__arrow code-loadout-selector__arrow">›</button>
                </div>

                <div className="mt-5 flex flex-col gap-4 border-y border-slate-700/70 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                        <p className="font-mono text-[10px] font-bold tracking-[.2em] text-green-300">{Number(activeLoadoutEntry.teamNumber) === PUZZLE_OPPONENT_TEAM ? "RED TEAM" : "BLUE TEAM"} · LOADOUT {Math.max(1, activeLoadoutIndex + 1)}/{loadoutEditorRoster.length}</p>
                        <p className="mt-1 text-sm text-slate-400">{activeSandboxLoadout.abilities.length} abilities equipped</p>
                    </div>
                    <label className="flex min-h-10 w-full items-center rounded border border-slate-700 bg-[#202427] px-3 focus-within:border-green-400 sm:max-w-xs">
                        <span className="mr-2 text-slate-500" aria-hidden="true">⌕</span>
                        <span className="sr-only">Search abilities by name</span>
                        <input
                            type="search"
                            value={sandboxLoadoutSearch}
                            onChange={(event) => onSearchChange(event.target.value)}
                            placeholder="Search abilities by name"
                            className="min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-slate-600"
                        />
                    </label>
                </div>

                <div className="mt-6 space-y-8">
                    {[1, 2, 3].map((round) => {
                        const roundAbilities = visibleSandboxAbilities.filter((ability) => ability.round === round);
                        if (roundAbilities.length === 0) return null;
                        return (
                            <section key={round} aria-labelledby={`sandbox-round-${round}-title`}>
                                <div className="mb-4 flex items-end justify-between gap-4 border-b border-slate-700/60 pb-3">
                                    <div>
                                        <p className="font-mono text-[9px] font-bold tracking-[.28em] text-slate-500">DRAFT TIER 0{round}</p>
                                        <h3 id={`sandbox-round-${round}-title`} className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white">Round {round}</h3>
                                    </div>
                                    <span className="font-mono text-[9px] tracking-widest text-green-300">{roundAbilities.length} ABILITIES</span>
                                </div>
                                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                                    {roundAbilities.map((ability) => (
                                        <SandboxAbilityCard
                                            key={ability.id}
                                            ability={ability}
                                            selected={activeSandboxLoadout.abilities.includes(ability.id)}
                                            onToggle={onToggleAbility}
                                        />
                                    ))}
                                </div>
                            </section>
                        );
                    })}
                    {visibleSandboxAbilities.length === 0 && (
                        <p className="border border-slate-700/70 bg-slate-950/30 px-4 py-6 text-sm text-slate-400">No abilities match “{sandboxLoadoutSearch.trim()}”. Search by ability name.</p>
                    )}
                </div>

                <div className="mt-7 flex flex-col gap-4 border-t border-slate-700/70 pt-5 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-slate-500">Switching players keeps each draft until you close this editor or apply all loadouts.</p>
                    <button type="button" onClick={onApply} className="gray-button-surface min-h-11 rounded border border-green-400/70 bg-green-950/20 px-6 font-mono text-[11px] font-bold tracking-widest text-green-200 hover:bg-green-950/40">APPLY LOADOUTS</button>
                </div>
            </div>
        </div>
    );
}
