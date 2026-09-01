import { useRef, useState } from "react";
import { AbilityModal } from "../catalogue/AbilityCataloguePage.jsx";
import { getAbilityCatalogueIcon, getAbilityCatalogueIconLayout } from "../../abilityCatalogueIcons.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";

const GUARANTEE_ROUNDS = [1, 2, 3];

function abilityForRound(values, round) {
    const abilityId = Number(values?.[round - 1]);
    if (!Number.isInteger(abilityId)) return null;
    return ALL_ABILITY_DEFINITIONS.find((ability) => (
        ability.id === abilityId && ability.round === round
    )) ?? null;
}

function AbilitySlotIcon({ ability }) {
    const iconPath = getAbilityCatalogueIcon(ability?.id);
    return (
        <span className={`grid h-10 w-10 shrink-0 place-items-center border sm:h-11 sm:w-11 ${ability
            ? "border-green-400/70 bg-green-950/35 shadow-[0_0_20px_rgba(114,182,93,.14)]"
            : "border-dashed border-slate-600 bg-slate-950/40"}`}>
            {iconPath ? (
                <img
                    src={iconPath}
                    alt=""
                    aria-hidden="true"
                    className="h-full w-full object-contain p-1"
                    onError={(event) => {
                        event.currentTarget.hidden = true;
                    }}
                />
            ) : (
                <span className="font-mono text-[9px] tracking-[.16em] text-slate-500">RANDOM</span>
            )}
        </span>
    );
}

function QueueGuaranteeDialog({ round, selectedAbility, onSelect, onClear, onClose, onInfo }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const abilities = ALL_ABILITY_DEFINITIONS.filter((ability) => ability.round === round);

    useDialogFocus(dialogRef, {
        initialFocusRef: closeButtonRef,
        onClose,
        lockScroll: true,
    });

    return (
        <div
            className="fixed inset-0 z-[900] flex items-center justify-center bg-black/75 px-4 py-6 backdrop-blur-sm"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                role="dialog"
                aria-modal="true"
                aria-labelledby="queue-guarantee-dialog-title"
                tabIndex={-1}
                className="flex max-h-[min(860px,calc(100dvh-3rem))] w-full max-w-6xl flex-col overflow-hidden border border-green-400/45 bg-[#0b1116] shadow-[0_24px_90px_rgba(0,0,0,.65)]"
            >
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-700/80 bg-[#111a20] px-5 py-4 sm:px-7">
                    <div>
                        <p className="font-mono text-[9px] font-bold tracking-[.28em] text-green-300">QUEUE LOADOUT IDENTITY</p>
                        <h2 id="queue-guarantee-dialog-title" className="mt-2 font-display-action text-3xl uppercase tracking-wide text-white sm:text-4xl">
                            Round {round} guarantee
                        </h2>
                        <p className="mt-1 max-w-2xl text-sm leading-5 text-slate-400">
                            Choose one ability from this round. It will be added to your round {round} offer pool every match.
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close round guarantee picker"
                        className="grid h-9 w-9 shrink-0 place-items-center border border-slate-600 text-2xl font-light leading-none text-slate-300 transition hover:border-green-400 hover:text-white"
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div className="min-h-0 overflow-y-auto px-5 py-5 sm:px-7">
                    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-slate-800 pb-4">
                        <p className="font-mono text-[10px] tracking-[.18em] text-slate-400">
                            {selectedAbility ? `SELECTED · ${selectedAbility.label.toUpperCase()}` : "EMPTY SLOT · RANDOM OFFER POOL"}
                        </p>
                        <button
                            type="button"
                            onClick={onClear}
                            className={`border px-3 py-2 font-mono text-[9px] font-bold tracking-[.16em] transition ${selectedAbility
                                ? "border-amber-400/60 text-amber-200 hover:border-amber-300 hover:text-white"
                                : "cursor-default border-slate-800 text-slate-600"}`}
                            disabled={!selectedAbility}
                        >
                            USE RANDOM FOR ROUND {round}
                        </button>
                    </div>

                    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                        {abilities.map((ability, index) => {
                            const iconPath = getAbilityCatalogueIcon(ability.id);
                            const active = selectedAbility?.id === ability.id;
                            return (
                                <div key={ability.id} className="relative">
                                    <button
                                        type="button"
                                        onClick={() => onSelect(ability)}
                                        aria-pressed={active}
                                        className={`ability-card ability-card-${round} group relative min-h-48 w-full overflow-hidden rounded-none border p-0 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 ${active ? "ability-card-selected" : "border-slate-700/75 bg-[#091522]/85 hover:border-green-700 hover:bg-green-950/15"}`}
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
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <span className="ability-card-content absolute inset-x-0 bottom-0 border-t border-white/10 px-4 py-3">
                                            {active && <span className="mb-1 block font-mono text-[9px] font-bold tracking-[.2em] text-green-200">GUARANTEED</span>}
                                            <span className="block font-display-action text-lg uppercase tracking-wider text-white">{ability.label}</span>
                                            <span className="mt-1 block font-mono text-[8px] font-bold tracking-[.16em] text-green-300/70">ROUND {round} ABILITY</span>
                                        </span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`View ${ability.label} stats`}
                                        title={`View ${ability.label} stats`}
                                        onClick={() => onInfo(ability)}
                                        className="absolute right-3 top-3 z-20 grid h-7 w-7 place-items-center rounded-full border border-slate-300/25 bg-slate-950/60 transition hover:scale-110 hover:border-green-300 hover:bg-slate-950/90 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200"
                                    >
                                        <img
                                            src="/assets/arena-toolbar/info-circle-icon.png"
                                            alt=""
                                            aria-hidden="true"
                                            className="h-5 w-5 opacity-85"
                                        />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>
        </div>
    );
}

export default function QueueAbilityGuaranteePicker({ values = [], onChange, disabled = false }) {
    const [openRound, setOpenRound] = useState(null);
    const [infoAbility, setInfoAbility] = useState(null);
    const activeRound = Number(openRound);
    const activeAbility = GUARANTEE_ROUNDS.includes(activeRound)
        ? abilityForRound(values, activeRound)
        : null;

    const openPicker = (round) => {
        if (disabled) return;
        setInfoAbility(null);
        setOpenRound(round);
    };

    const closePicker = () => {
        setOpenRound(null);
    };

    const showAbilityInfo = (ability) => {
        setInfoAbility(ability);
        setOpenRound(null);
    };

    const selectAbility = (ability) => {
        onChange?.(activeRound, ability.id);
        closePicker();
    };

    const clearAbility = () => {
        onChange?.(activeRound, null);
        closePicker();
    };

    return (
        <>
            <section aria-labelledby="queue-guarantees-title" className="mt-4">
                <h2 id="queue-guarantees-title" className="font-mono text-[10px] font-bold tracking-[.2em] text-green-300">Guaranteed Offers</h2>

                <div className="mt-2 grid gap-2 sm:grid-cols-3">
                    {GUARANTEE_ROUNDS.map((round) => {
                        const ability = abilityForRound(values, round);
                        return (
                            <button
                                key={round}
                                type="button"
                                disabled={disabled}
                                onClick={() => openPicker(round)}
                                aria-label={`Choose round ${round} guarantee`}
                                className={`flex min-h-16 items-center gap-2 border px-2 py-2 text-left transition focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-green-200 sm:min-h-[4.5rem] ${ability
                                    ? "border-green-400/60 bg-green-950/20 hover:border-green-300"
                                    : "border-slate-700/80 bg-slate-950/30 hover:border-green-700/70"} ${disabled ? "cursor-not-allowed opacity-45" : ""}`}
                            >
                                <AbilitySlotIcon ability={ability} />
                                <span className="min-w-0">
                                    <span className="block font-mono text-[8px] font-bold tracking-[.14em] text-green-300">ROUND {round}</span>
                                    <span className="mt-0.5 block truncate font-display-action text-sm tracking-wide text-white sm:text-base">
                                        {ability?.label ?? "Random Ability"}
                                    </span>
                                </span>
                            </button>
                        );
                    })}
                </div>
            </section>

            {openRound != null && (
                <QueueGuaranteeDialog
                    round={activeRound}
                    selectedAbility={activeAbility}
                    onSelect={selectAbility}
                    onClear={clearAbility}
                    onClose={closePicker}
                    onInfo={showAbilityInfo}
                />
            )}
            {infoAbility && (
                <AbilityModal ability={infoAbility} onClose={() => setInfoAbility(null)} />
            )}
        </>
    );
}
