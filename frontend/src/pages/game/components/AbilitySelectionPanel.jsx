import { useState } from "react";
import { AbilityModal } from "../../catalogue/AbilityCataloguePage.jsx";
import { abilityTypeLabels, typeTagClass } from "../../catalogue/abilityTypeTags.js";
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
    players = [],
    remaining,
    roundNumber,
    abilityOffers,
    guaranteedAbilityId = null,
    submitting,
    error,
    onSurrender,
    surrenderPending = false,
    hasSurrendered = false,
    canSurrender = false,
}) {
    const playerLocked = Boolean(player?.loadoutSelected);
    const roster = (players.length > 0 ? players : [player, opponent])
        .filter(Boolean)
        .filter((participant, index, all) => (
            participant.userId == null
                ? index === all.findIndex((candidate) => candidate === participant)
                : index === all.findIndex((candidate) => String(candidate.userId) === String(participant.userId))
        ))
        .map((participant, index) => ({
            ...participant,
            teamNumber: Number(participant.teamNumber) > 0
                ? Number(participant.teamNumber)
                : index === 0 ? 1 : 2,
        }));
    const ownTeamNumber = Number(player?.teamNumber) > 0 ? Number(player.teamNumber) : 1;
    const teamGroups = [...new Set(roster.map((participant) => participant.teamNumber))]
        .sort((first, second) => first - second)
        .map((teamNumber) => ({
            teamNumber,
            participants: roster.filter((participant) => participant.teamNumber === teamNumber),
        }));
    const ownTeam = teamGroups.find((group) => group.teamNumber === ownTeamNumber)
        ?? { teamNumber: ownTeamNumber, participants: player ? [player] : [] };
    const opponentTeams = teamGroups.filter((group) => group.teamNumber !== ownTeamNumber);
    const ownTeamReady = ownTeam.participants.length > 0
        && ownTeam.participants.every((participant) => Boolean(participant.loadoutSelected));
    const opponentsReady = opponentTeams.length > 0
        && opponentTeams.every((group) => group.participants.every((participant) => Boolean(participant.loadoutSelected)));
    const allPlayersReady = roster.length > 0
        && roster.every((participant) => Boolean(participant.loadoutSelected));
    const draft = loadoutDraftState(loadout, roundNumber, abilityOffers);
    const { normalized, draftRule, offeredAbilityIds, inheritedAbilityIds, draftedAbilities, draftedAbilityIds, hasAllDraftPicks } = draft;
    const [selectedAbility, setSelectedAbility] = useState(null);
    // The largest timer value seen this round sizes the countdown ring.
    const [ringTotal, setRingTotal] = useState(1);
    const secondsLeft = Math.max(0, Number(remaining) || 0);
    if (secondsLeft > ringTotal) setRingTotal(secondsLeft);
    const toggleAbility = (id) => {
        if (playerLocked || inheritedAbilityIds.has(id)) return;
        onChange(toggleDraftAbility(normalized, draft.roundNumber, abilityOffers, id));
    };
    const picks = draftRule.picks;
    const offeredAbilities = BOT_ABILITIES.filter((ability) => offeredAbilityIds.has(ability.id));
    const hasGuaranteedOffer = guaranteedAbilityId != null
        && offeredAbilities.some((ability) => String(ability.id) === String(guaranteedAbilityId));
    const pickedCount = draftedAbilities.length;
    const allPicked = pickedCount >= picks;
    const timerTone = secondsLeft <= 5 ? "#f87171" : secondsLeft <= 15 ? "#fbbf24" : "#34d399";
    const RING_RADIUS = 20;
    const ringCircumference = 2 * Math.PI * RING_RADIUS;
    const ringOffset = ringCircumference * (1 - Math.min(1, secondsLeft / ringTotal));
    const meLabel = (participant) => (
        player?.userId != null && participant.userId != null && String(player.userId) === String(participant.userId)
    );
    const rosterChips = teamGroups.flatMap((group) => group.participants.map((participant) => ({ participant, teamNumber: group.teamNumber })));
    const lockLabel = submitting
        ? "LOCKING IN..."
        : playerLocked
            ? "LOCKED IN"
            : "LOCK IN";
    const statusLine = allPlayersReady
        ? "All players locked in"
        : ownTeamReady
            ? "Your team is ready"
            : null;
    const opponentSummary = opponentsReady ? "opponent locked" : "opponent choosing";

    return (
        <section className="flex min-h-[calc(100vh-72px)] items-start justify-center px-3 pb-28 pt-6 sm:items-center sm:px-6 sm:pb-8">
            <div className="w-full max-w-[1100px] rounded-2xl border border-[#262c33] bg-[#0f1418] p-4 sm:p-6">
                <div className="flex items-start justify-between gap-4">
                    <div className="min-w-0">
                        <p className="text-[11px] font-semibold uppercase text-cyan-300">Round {draft.roundNumber} of 3 &middot; Draft</p>
                        <h1 className="mt-1 font-display text-2xl font-bold text-white sm:text-3xl">Pick {picks} {picks === 1 ? "ability" : "abilities"}</h1>
                        <p className="mt-1 hidden text-xs text-slate-400 sm:block">
                            From these {draftRule.offered}.{hasGuaranteedOffer ? " Your guaranteed offer is marked." : ""}
                        </p>
                    </div>
                    <div className="flex shrink-0 items-center gap-3">
                        <div className="hidden items-center gap-2 sm:flex" role="status" aria-live="polite" aria-label={`${pickedCount} of ${picks} abilities selected`}>
                            {Array.from({ length: picks }, (_, index) => {
                                const picked = BOT_ABILITIES.find((ability) => ability.id === draftedAbilities[index]);
                                return (
                                    <span key={index} className={`grid h-11 w-11 place-items-center rounded-lg ${picked ? "border border-emerald-400/70 bg-emerald-500/10" : "border border-dashed border-[#3a444d] text-xs text-slate-500"}`} title={picked?.label}>
                                        {picked ? <AbilityCatalogueIcon ability={picked} className="h-8 w-8 object-contain" /> : index + 1}
                                    </span>
                                );
                            })}
                        </div>
                        <div className="relative h-14 w-14" role="timer" aria-label={`${secondsLeft} seconds left`}>
                            <svg viewBox="0 0 48 48" className="h-14 w-14 -rotate-90" aria-hidden="true">
                                <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke="#262c33" strokeWidth="4" />
                                <circle cx="24" cy="24" r={RING_RADIUS} fill="none" stroke={timerTone} strokeWidth="4" strokeLinecap="round" strokeDasharray={ringCircumference} strokeDashoffset={ringOffset} style={{ transition: "stroke-dashoffset 400ms linear, stroke 200ms ease" }} />
                            </svg>
                            <span className="absolute inset-0 grid place-items-center font-display text-lg font-bold tabular-nums" style={{ color: timerTone }}>{secondsLeft}</span>
                        </div>
                    </div>
                </div>
                {remaining === 0 && (
                    <div role="status" aria-live="polite" className="mt-4 flex items-center gap-3 rounded-lg border border-cyan-900/60 bg-cyan-950/15 px-4 py-3 text-xs text-cyan-200/80">
                        <span className="h-2 w-2 animate-pulse rounded-full bg-cyan-300/80" aria-hidden="true" />
                        <span>Preparing building session &middot; finalizing loadouts</span>
                    </div>
                )}
                {error && (
                    <div role="alert" className="mt-4 rounded-lg border border-red-700/70 bg-red-950/35 px-4 py-3 text-sm text-red-200">
                        {error}
                    </div>
                )}
                <div className="mt-4 grid grid-cols-2 gap-3 sm:mt-5 sm:grid-cols-3">
                    {offeredAbilities.map((ability) => {
                        const pickIndex = draftedAbilities.indexOf(ability.id);
                        const active = draftedAbilityIds.has(ability.id);
                        const guaranteed = guaranteedAbilityId != null
                            && String(guaranteedAbilityId) === String(ability.id);
                        const unavailable = playerLocked || (!active && hasAllDraftPicks);
                        const types = abilityTypeLabels(ability);
                        return (
                            <div key={ability.id} className="relative">
                                <button
                                    type="button"
                                    disabled={unavailable}
                                    aria-pressed={active}
                                    onClick={() => toggleAbility(ability.id)}
                                    className={`ability-card group relative block min-h-36 w-full overflow-hidden rounded-xl border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-emerald-200 sm:min-h-44 ${active
                                        ? "cursor-pointer border-emerald-400 bg-emerald-500/10 shadow-[0_0_0_1px_rgba(52,211,153,.5)]"
                                        : unavailable
                                            ? `cursor-not-allowed border-[#262c33] bg-[#0b0f12] ${allPicked && !playerLocked ? "opacity-45" : "opacity-35 saturate-0"}`
                                            : "cursor-pointer border-[#262c33] bg-[#0b0f12] hover:border-slate-500"}`}
                                >
                                    <AbilityCatalogueIcon ability={ability} className="ability-card-art" />
                                    <span className="ability-card-gradient" aria-hidden="true" />
                                    {active && (
                                        <span className="pointer-events-none absolute left-2.5 top-2.5 z-10 grid h-6 w-6 place-items-center rounded-full bg-emerald-500 font-display text-xs font-bold text-white" aria-label={`Pick ${pickIndex + 1}`}>
                                            {pickIndex + 1}
                                        </span>
                                    )}
                                    <span className="ability-card-content absolute inset-x-0 bottom-0 flex items-end justify-between gap-2 px-3 py-2.5">
                                        <span className="min-w-0">
                                            <span className="block truncate font-display text-sm font-bold text-white sm:text-base">{ability.label}</span>
                                            <span className="mt-1 flex flex-wrap gap-1">
                                                {types.map((type) => (
                                                    <span key={type} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${typeTagClass(type)}`}>{type}</span>
                                                ))}
                                            </span>
                                        </span>
                                        {guaranteed && (
                                            <span className="pointer-events-none shrink-0 rounded border border-amber-400/50 bg-amber-500/10 px-1.5 py-0.5 text-[10px] font-bold text-amber-300">
                                                Guaranteed
                                            </span>
                                        )}
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
                                    className="info-circle-icon absolute right-2.5 top-2.5 z-20 h-5 w-5 cursor-pointer select-none opacity-80 transition duration-150 hover:scale-110 hover:opacity-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-cyan-200"
                                />
                            </div>
                        );
                    })}
                </div>
                <div className="fixed inset-x-0 bottom-0 z-30 border-t border-[#262c33] bg-[#0f1418]/95 px-3 py-2.5 backdrop-blur sm:static sm:z-auto sm:mt-4 sm:rounded-xl sm:border sm:bg-[#12181d] sm:p-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                        <div className="hidden min-w-0 flex-1 flex-wrap items-center gap-2 sm:flex" aria-label="Draft status">
                            {rosterChips.map(({ participant, teamNumber }) => {
                                const self = meLabel(participant);
                                const locked = Boolean(participant.loadoutSelected);
                                return (
                                    <span key={participant.userId ?? participant.username} className="inline-flex items-center gap-2 rounded-lg border border-[#262c33] bg-[#0f1418] px-2.5 py-1.5 text-xs">
                                        <span className={`h-5 w-5 rounded-full ${teamNumber === ownTeamNumber ? "bg-sky-600" : "bg-rose-700"}`} aria-hidden="true" />
                                        <span className="flex flex-col leading-tight">
                                            <span className="font-semibold text-slate-100">{self ? "You" : (participant.username ?? "Player")}</span>
                                            <span className={`text-[10px] ${locked ? "text-emerald-400" : "text-slate-500"}`}>
                                                {locked ? "🔒 Locked in" : self ? `Choosing · ${pickedCount}/${picks}` : "Choosing"}
                                            </span>
                                        </span>
                                    </span>
                                );
                            })}
                            {statusLine && <span className="text-[11px] text-slate-400" role="status">{statusLine}</span>}
                        </div>
                        <p className="min-w-0 flex-1 text-xs text-slate-400 sm:hidden" role="status">{pickedCount}/{picks} picked &middot; {opponentSummary}</p>
                        <button
                            type="button"
                            onClick={onSurrender}
                            aria-label={hasSurrendered ? "WITHDRAW FORFEIT VOTE" : surrenderPending ? "UPDATING FORFEIT VOTE" : "VOTE TO FORFEIT"}
                            title={hasSurrendered ? "WITHDRAW FORFEIT VOTE" : surrenderPending ? "UPDATING FORFEIT VOTE" : "VOTE TO FORFEIT"}
                            disabled={!canSurrender || surrenderPending}
                            className="inline-flex min-h-9 items-center gap-1.5 px-2 text-xs font-semibold text-rose-400 hover:text-rose-300 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                            <MatchToolIcon name="flag" className="h-3.5 w-3.5" />
                            <span className="max-sm:hidden">{hasSurrendered ? "WITHDRAW FORFEIT" : surrenderPending ? "UPDATING VOTE" : "Surrender vote"}</span>
                        </button>
                        <div className="flex flex-col items-stretch sm:items-end">
                            <button
                                type="button"
                                onClick={onLockLoadout}
                                disabled={submitting || playerLocked || normalized.abilities.length > MAX_EQUIPPED_ABILITIES}
                                className="inline-flex min-h-11 min-w-36 items-center justify-center gap-2 rounded-xl border-b-[3px] border-[#1f6b3f] bg-[#2fa866] px-6 font-display text-base font-bold text-white hover:bg-[#38bd74] disabled:cursor-not-allowed disabled:border-[#1a2026] disabled:bg-[#1b232a] disabled:text-slate-400 sm:min-h-12 sm:min-w-44"
                            >
                                <svg viewBox="0 0 24 24" className="h-4 w-4 fill-none stroke-current" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></svg>
                                {lockLabel}
                            </button>
                        </div>
                    </div>
                    <p className="mt-2 hidden text-right text-[11px] text-slate-500 sm:block">Unpicked slots are filled randomly when you lock in or time runs out.</p>
                </div>
            </div>
            {selectedAbility && <AbilityModal ability={selectedAbility} onClose={() => setSelectedAbility(null)} />}
        </section>
    );
}
