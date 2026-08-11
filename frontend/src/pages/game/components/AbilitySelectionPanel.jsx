import { useState } from "react";
import { AbilityModal } from "../../catalogue/AbilityCataloguePage.jsx";
import { getAbilityCatalogueIcon } from "../../../abilityCatalogueIcons.js";
import { BOT_ABILITIES, MAX_EQUIPPED_ABILITIES, STAT_POINT_BUDGET_PER_ROUND, botStatsForLoadout, normalizedBotLoadout } from "../../../gameArena/loadout/BotLoadout.js";
import { loadoutDraftState, toggleDraftAbility } from "../../../matchmaking/loadoutDraft.js";

function LoadoutStatIcon({ stat }) {
    const commonProps = {
        fill: "none",
        stroke: "currentColor",
        strokeLinecap: "round",
        strokeLinejoin: "round",
        strokeWidth: 1.7,
    };

    if (stat === "maxHp") {
        return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="M12 21s7-3.3 7-9.5V5.8L12 3 5 5.8v5.7C5 17.7 12 21 12 21Z" /><path d="M9 11.5h6M12 8.5v6" /></svg>;
    }
    if (stat === "moveSpeed") {
        return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="M8 3h5l-1 5 2 4 5 2.5c1.2.6 1.6 2 .9 3.2-.4.8-1.2 1.3-2.1 1.3H7l-2-2 2-3V8l1-5Z" /><path d="M7 14h5M4 20h14" /></svg>;
    }
    if (stat === "attackDamage") {
        return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="m14.5 3 6.5 6.5-8 8-2.5-.5-.5-2.5 8-8L14.5 3Z" /><path d="m10.5 16.5-5 5-3-3 5-5M15.5 5.5l3 3" /></svg>;
    }
    return <svg viewBox="0 0 24 24" aria-hidden="true" className="h-7 w-7" {...commonProps}><path d="m13 2-7 11h5l-1 9 8-12h-5V2Z" /></svg>;
}

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



export default function AbilitySelectionPanel({ loadout, onChange, onLockLoadout, player, opponent, remaining, roundNumber, abilityOffers, submitting, error }) {
    const playerLocked = Boolean(player?.loadoutSelected);
    const opponentLocked = Boolean(opponent?.loadoutSelected);
    const draft = loadoutDraftState(loadout, roundNumber, abilityOffers);
    const { normalized, draftRule, offeredAbilityIds, inheritedAbilityIds, draftedAbilities, draftedAbilityIds, hasAllDraftPicks } = draft;
    const spent = Object.values(normalized.statPoints).reduce((sum, value) => sum + value, 0);
    const roundBudget = STAT_POINT_BUDGET_PER_ROUND * draft.roundNumber;
    const stats = botStatsForLoadout(normalized);
    const [selectedAbility, setSelectedAbility] = useState(null);
    const toggleAbility = (id) => {
        if (playerLocked || inheritedAbilityIds.has(id)) return;
        onChange(toggleDraftAbility(normalized, draft.roundNumber, abilityOffers, id));
    };
    const changePoint = (key, delta) => {
        if (delta > 0 && spent >= roundBudget) return;
        onChange(normalizedBotLoadout({ ...normalized, statPoints: { ...normalized.statPoints, [key]: Math.max(0, normalized.statPoints[key] + delta) } }));
    };

    return (
        <section className="flex min-h-[calc(100vh-72px)] items-center justify-center bg-[radial-gradient(circle_at_50%_25%,rgba(8,79,116,0.16),transparent_48%)] px-4 py-8 sm:px-6">
            <div className="w-full max-w-[1080px]">
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
                <div className="mt-6 grid gap-6 lg:grid-cols-[1.45fr_1fr]">
                    <div>
                        <div className="mb-3 rounded border border-cyan-900/60 bg-cyan-950/15 px-4 py-3 font-mono text-[10px] tracking-widest text-cyan-100" role="status" aria-live="polite">
                            <span className="text-cyan-300">ABILITIES SELECTED {draftedAbilities.length}/{draftRule.picks}</span>
                            {draftedAbilities.length > 0 && (
                                <span className="ml-3 text-ink-muted">
                                    {draftedAbilities.map((id) => BOT_ABILITIES.find((ability) => ability.id === id)?.label ?? id).join(" · ")}
                                </span>
                            )}
                        </div>
                        <div className="grid grid-cols-3 gap-3">
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
                                            className={`ability-card group relative block min-h-52 w-full overflow-hidden rounded-none border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200 ${
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
                                        <button
                                            type="button"
                                            onClick={() => setSelectedAbility(ability)}
                                            aria-label={`View ${ability.label} stats`}
                                            className="absolute right-3 top-3 z-20 grid h-9 min-h-9 min-w-9 w-9 place-items-center rounded-full border border-cyan-500/70 bg-slate-950/85 p-0 font-mono text-base font-bold text-cyan-100 shadow-[0_4px_14px_rgba(0,0,0,.35)] transition hover:border-cyan-200 hover:bg-cyan-900/70 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
                                        >
                                            i
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                    <div className="rounded border border-slate-700/70 bg-[#081522]/75 p-4 shadow-[inset_0_0_35px_rgba(8,47,73,0.1)]">
                        <div className="font-mono text-xs tracking-widest text-cyan">STAT POINTS {spent}/{roundBudget}</div>
                        {[ ["maxHp", "HP", stats.maxHp], ["moveSpeed", "MOVE", stats.moveSpeed], ["attackDamage", "DAMAGE", `${stats.attackDamagePercent}%`], ["attackSpeed", "ATTACK SPEED", `${stats.attackSpeedPercent}%`] ].map(([key,label,value]) => (
                            <div key={key} className="mt-4 flex items-center gap-2">
                                <span className="shrink-0 text-cyan-300"><LoadoutStatIcon stat={key} /></span>
                                <span className="shrink-0 font-mono text-[10px] tracking-widest text-slate-300">{label}:</span>
                                <span className="shrink-0 font-mono text-sm text-white">{value}</span>
                                <button type="button" aria-label={`Decrease ${label}`} disabled={playerLocked || normalized.statPoints[key] <= 0} onClick={() => changePoint(key,-1)} className="ml-auto h-11 min-h-11 min-w-11 w-11 rounded border border-slate-700 text-lg text-slate-300 transition hover:border-cyan-700 hover:text-cyan-200 disabled:cursor-not-allowed disabled:opacity-30">&minus;</button>
                                <button type="button" aria-label={`Increase ${label}`} disabled={playerLocked || spent >= roundBudget} onClick={() => changePoint(key,1)} className="h-11 min-h-11 min-w-11 w-11 rounded border border-cyan-800 text-lg text-cyan-300 transition hover:border-cyan-400 hover:bg-cyan-950/30 disabled:cursor-not-allowed disabled:opacity-30">+</button>
                            </div>
                        ))}
                    </div>
                </div>
                <div className="mt-5 flex flex-wrap items-center justify-between gap-3 rounded border border-slate-700/70 bg-[#081522]/75 p-4">
                    <div className="font-mono text-[10px] tracking-widest text-ink-muted">
                        <span className="mr-3 text-cyan">&#9679;</span>
                        YOU: <span className={playerLocked ? "text-green-300" : "text-amber-200"}>{playerLocked ? "LOCKED" : "CHOOSING"}</span>
                        <span className="mx-3 text-border-hi">/</span>
                        {opponent?.username ?? "OPP"}: <span className={opponentLocked ? "text-green-300" : "text-amber-200"}>{opponentLocked ? "LOCKED" : "CHOOSING"}</span>
                    </div>
                    <button
                        type="button"
                        onClick={onLockLoadout}
                        disabled={submitting || playerLocked || normalized.abilities.length > MAX_EQUIPPED_ABILITIES}
                        className="h-11 min-w-52 rounded border border-cyan-600/80 bg-cyan-950/25 px-5 font-mono text-[11px] font-bold tracking-[0.16em] text-cyan-200 transition hover:border-cyan-300 hover:bg-cyan-900/30 disabled:cursor-not-allowed disabled:opacity-50"
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
            {selectedAbility && <AbilityModal ability={selectedAbility} onClose={() => setSelectedAbility(null)} />}
        </section>
    );
}
