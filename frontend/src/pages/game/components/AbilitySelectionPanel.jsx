import { useState } from "react";
import { AbilityModal } from "../../catalogue/AbilityCataloguePage.jsx";
import { getAbilityCatalogueIcon } from "../../../abilityCatalogueIcons.js";
import MatchToolIcon from "../../../gameArena/coding/controls/MatchToolIcon.jsx";
import { BOT_ABILITIES, MAX_EQUIPPED_ABILITIES } from "../../../gameArena/loadout/BotLoadout.js";
import { loadoutDraftState, toggleDraftAbility } from "../../../matchmaking/loadoutDraft.js";

function AbilityCatalogueIcon({ ability, className }) {
    const iconPath = getAbilityCatalogueIcon(ability?.id);
    if (!iconPath) return null;

    return (
        <img
            src={iconPath}
            alt=""
            aria-hidden="true"
            className={className}
            onError={(event) => {
                event.currentTarget.hidden = true;
            }}
        />
    );
}



export default function AbilitySelectionPanel({
    loadout,
    onChange,
    onLockLoadout,
    player,
    opponent,
    remaining,
    roundNumber,
    abilityOffers,
    submitting,
    error,
    onSurrender,
    surrenderPending = false,
    hasSurrendered = false,
    canSurrender = false,
}) {
    const playerLocked = Boolean(player?.loadoutSelected);
    const opponentLocked = Boolean(opponent?.loadoutSelected);
    const draft = loadoutDraftState(loadout, roundNumber, abilityOffers);
    const { normalized, draftRule, offeredAbilityIds, inheritedAbilityIds, draftedAbilities, draftedAbilityIds, hasAllDraftPicks } = draft;
    const [selectedAbility, setSelectedAbility] = useState(null);
    const toggleAbility = (id) => {
        if (playerLocked || inheritedAbilityIds.has(id)) return;
        onChange(toggleDraftAbility(normalized, draft.roundNumber, abilityOffers, id));
    };
    return (
        <section className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-[radial-gradient(circle_at_50%_25%,rgba(8,79,116,0.16),transparent_48%)] px-4 py-8 sm:px-6">
            <div className="w-full max-w-[1280px]">
                <div className="flex flex-wrap items-end justify-between gap-4">
                    <div>
                        <p className="font-mono text-xs tracking-[0.25em] text-cyan">ROUND LOADOUT</p>
                        <h1 className="mt-2 font-display-action text-5xl uppercase tracking-wide text-white sm:text-6xl">Build your bot</h1>
                        <p className="mt-2 text-sm text-ink-muted">Select {draftRule.picks} of {draftRule.offered} abilities</p>
                    </div>
                    <div className="text-right">
                        <div className="font-mono text-[10px] tracking-[0.22em] text-cyan">ROUND TIMER</div>
                        <div className="mt-1 font-mono text-5xl font-bold text-cyan-300 [text-shadow:0_0_22px_rgba(34,211,238,0.24)]">{remaining}</div>
                    </div>
                </div>
                {remaining === 0 && (
                    <div role="status" aria-live="polite" className="mt-4 flex items-center gap-3 rounded border border-cyan-900/60 bg-cyan-950/15 px-4 py-3 font-mono text-[10px] tracking-widest text-cyan-200/80">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300/80" aria-hidden="true" />
                        <span>PREPARING BUILDING SESSION &middot; FINALIZING LOADOUTS</span>
                    </div>
                )}
                {error && (
                    <div role="alert" className="mt-4 rounded border border-red-700/70 bg-red-950/35 px-4 py-3 text-sm text-red-200">
                        {error}
                    </div>
                )}
                <div className="mt-6">
                    <div>
                        <div className="mb-3 rounded border border-cyan-900/60 bg-cyan-950/15 px-4 py-3 font-mono text-[10px] tracking-widest text-cyan-100" role="status" aria-live="polite">
                            <span className="text-cyan-300">ABILITIES SELECTED {draftedAbilities.length}/{draftRule.picks}</span>
                            {draftedAbilities.length > 0 && (
                                <span className="ml-3 text-ink-muted">
                                    {draftedAbilities.map((id) => BOT_ABILITIES.find((ability) => ability.id === id)?.label ?? id).join(" · ")}
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
                            {BOT_ABILITIES.filter((ability) => offeredAbilityIds.has(ability.id)).map((ability) => {
                                const active = draftedAbilityIds.has(ability.id);
                                const unavailable = playerLocked || (!active && hasAllDraftPicks);
                                return (
                                    <div key={ability.id} className="relative">
                                        <button
                                            type="button"
                                            disabled={unavailable}
                                            aria-pressed={active}
                                            onClick={() => toggleAbility(ability.id)}
                                            className={`gray-button-surface ability-card group relative block min-h-52 w-full overflow-hidden rounded-none border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 ${
                                                active
                                                    ? "-translate-y-1 cursor-pointer border-cyan-400 bg-cyan-950/35 shadow-[0_8px_24px_rgba(8,145,178,0.12)] ring-2 ring-cyan-300/75 ring-offset-2 ring-offset-[#050d16] hover:border-cyan-300"
                                                    : unavailable
                                                        ? "cursor-not-allowed border-slate-800 bg-slate-950/45 opacity-35 saturate-0"
                                                        : "cursor-pointer border-slate-700/75 bg-[#091522]/85 hover:border-cyan-700 hover:bg-cyan-950/15"
                                            }`}
                                        >
                                            <AbilityCatalogueIcon ability={ability} className="ability-card-art" />
                                            <span className="ability-card-gradient" aria-hidden="true" />
                                            <span className="ability-card-content absolute inset-x-0 bottom-0 px-5 py-4">
                                                {active && <span className="mb-1 block font-mono text-[9px] font-bold tracking-[.2em] text-cyan-200">SELECTED</span>}
                                                <span className="block font-display-action text-xl uppercase tracking-wider text-white">{ability.label}</span>
                                            </span>
                                        </button>
                                        <img
                                            src="/assets/arena-toolbar/info-circle-icon.png"
                                            alt=""
                                            role="button"
                                            aria-label={`View ${ability.label} stats`}
                                            tabIndex={0}
                                            onClick={() => setSelectedAbility(ability)}
                                            onKeyDown={(event) => {
                                                if (event.key !== "Enter" && event.key !== " ") return;
                                                event.preventDefault();
                                                setSelectedAbility(ability);
                                            }}
                                            className="info-circle-icon absolute right-3 top-3 z-20 h-5 w-5 cursor-pointer select-none opacity-80 transition duration-150 hover:scale-110 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
                                        />
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700/70 bg-[#081522]/75 p-4">
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">
                        <span className="mr-3 text-cyan">&#9679;</span>
                        YOU: <span className={playerLocked ? "text-green-300" : "text-amber-200"}>{playerLocked ? "LOCKED" : "CHOOSING"}</span>
                        <span className="mx-3 text-border-hi">/</span>
                        {opponent?.username ?? "OPP"}: <span className={opponentLocked ? "text-green-300" : "text-amber-200"}>{opponentLocked ? "LOCKED" : "CHOOSING"}</span>
                    </div>
                    <div className="flex flex-wrap items-center gap-3">
                        <button
                            type="button"
                            onClick={onSurrender}
                            aria-label={hasSurrendered ? "RESIGNED" : surrenderPending ? "SURRENDERING" : "FORFEIT"}
                            title={hasSurrendered ? "RESIGNED" : surrenderPending ? "SURRENDERING" : "FORFEIT"}
                            disabled={!canSurrender || surrenderPending || hasSurrendered}
                            className="gray-button-surface flex h-11 items-center justify-center gap-2 rounded border border-red-700/70 px-4 font-mono text-[11px] font-bold tracking-[0.16em] text-red-300 transition hover:border-red-400 disabled:cursor-not-allowed disabled:opacity-40"
                        >
                            <MatchToolIcon name="flag" className="h-4 w-4" />
                            {hasSurrendered ? "RESIGNED" : surrenderPending ? "SURRENDERING" : "FORFEIT"}
                        </button>
                        <button
                            type="button"
                            onClick={onLockLoadout}
                            disabled={submitting || playerLocked || normalized.abilities.length > MAX_EQUIPPED_ABILITIES}
                            className="gray-button-surface h-11 min-w-52 rounded border border-cyan-600/80 px-5 font-mono text-[11px] font-bold tracking-[0.16em] text-cyan-200 transition hover:border-cyan-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            {submitting
                                ? "LOCKING LOADOUT"
                                : playerLocked
                                ? "LOADOUT LOCKED"
                                : draftedAbilities.length === draftRule.picks
                                    ? "LOCK LOADOUT"
                                    : `LOCK + AUTO-PICK ${draftRule.picks - draftedAbilities.length}`}
                        </button>
                    </div>
                </div>
            </div>
            {selectedAbility && <AbilityModal ability={selectedAbility} onClose={() => setSelectedAbility(null)} />}
        </section>
    );
}
