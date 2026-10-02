import { useRef, useState } from "react";
import { createPortal } from "react-dom";
import { AbilityModal } from "../catalogue/AbilityCataloguePage.jsx";
import { getAbilityCatalogueIcon } from "../../abilityCatalogueIcons.js";
import { ALL_ABILITY_DEFINITIONS } from "../../gameArena/loadout/BotLoadout.js";
import { GUARANTEE_ROUNDS, abilityForRound } from "./queueGuarantees.js";
import { abilityTypeLabels, typeTagClass } from "../catalogue/abilityTypeTags.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import "./guarantees.css";

function AbilitySlotIcon({ ability }) {
    const iconPath = getAbilityCatalogueIcon(ability?.id);
    return (
        <span className={`hq-slot__icon ${ability ? "is-set" : ""}`} aria-hidden="true">
            {iconPath ? (
                <img
                    src={iconPath}
                    alt=""
                    onError={(event) => {
                        event.currentTarget.hidden = true;
                    }}
                />
            ) : (
                <span className="hq-slot__unknown">?</span>
            )}
        </span>
    );
}

function QueueGuaranteeDialog({ round, selectedAbility, onSelect, onClear, onClose, onInfo }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    const [search, setSearch] = useState("");
    const query = search.trim().toLowerCase();
    const abilities = ALL_ABILITY_DEFINITIONS
        .filter((ability) => ability.round === round)
        .filter((ability) => !query || `${ability.label} ${abilityTypeLabels(ability).join(" ")}`.toLowerCase().includes(query));
    const selectedIcon = selectedAbility ? getAbilityCatalogueIcon(selectedAbility.id) : null;

    useDialogFocus(dialogRef, {
        initialFocusRef: closeButtonRef,
        onClose,
        lockScroll: true,
    });

    return createPortal(
        <div
            className="fixed inset-0 z-[110] flex items-center justify-center bg-black/75 p-4 backdrop-blur-sm max-sm:p-0"
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
                className="game-dialog flex max-h-[85vh] w-full max-w-[880px] flex-col overflow-hidden rounded-xl border border-[#262c33] bg-[#0f1418] shadow-2xl max-sm:h-full max-sm:max-h-none max-sm:rounded-none"
            >
                <header className="flex shrink-0 items-start justify-between gap-4 border-b border-[#262c33] px-5 py-3.5">
                    <div>
                        <h2 id="queue-guarantee-dialog-title" className="font-display text-lg font-bold text-white">
                            Round {round} guaranteed offer
                        </h2>
                        <p className="mt-0.5 text-xs text-slate-400">
                            Pick one. It&apos;s added to your round {round} offers every match.
                        </p>
                    </div>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close round guarantee picker"
                        className="modal-close-button"
                    >
                        <span aria-hidden="true">×</span>
                    </button>
                </header>

                <div className="flex shrink-0 flex-wrap items-center gap-3 border-b border-[#262c33] px-5 py-3">
                    <p className="flex min-w-0 flex-1 basis-40 items-center gap-2 text-xs text-slate-400">
                        Current:
                        {selectedIcon && (
                            <span className="hq-slot__icon is-set !h-6 !w-6" aria-hidden="true">
                                <img src={selectedIcon} alt="" />
                            </span>
                        )}
                        <strong className="truncate font-display text-[13px] text-white">{selectedAbility?.label ?? "Random"}</strong>
                    </p>
                    <input
                        type="search"
                        value={search}
                        onChange={(event) => setSearch(event.target.value)}
                        placeholder="Search"
                        aria-label="Search abilities by name or type"
                        className="h-8 w-44 rounded-md border border-[#262c33] bg-[#12181d] px-2.5 text-xs text-white outline-none focus:border-cyan-400 max-sm:order-last max-sm:w-full"
                    />
                    <button
                        type="button"
                        onClick={onClear}
                        disabled={!selectedAbility}
                        className="h-8 rounded-md border border-[#2d353c] bg-[#12181d] px-3 text-xs font-semibold text-slate-200 hover:bg-white/[.06] disabled:cursor-default disabled:opacity-45 disabled:hover:bg-[#12181d]"
                    >
                        Use random
                    </button>
                </div>

                <div className="min-h-0 flex-1 overflow-y-auto p-5">
                    {abilities.length === 0 && <p className="text-center text-sm text-slate-500">No abilities match that search.</p>}
                    <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
                        {abilities.map((ability) => {
                            const iconPath = getAbilityCatalogueIcon(ability.id);
                            const active = selectedAbility?.id === ability.id;
                            return (
                                <div key={ability.id} className="relative">
                                    <button
                                        type="button"
                                        onClick={() => onSelect(ability)}
                                        aria-pressed={active}
                                        className={`gp-card${active ? " is-selected" : ""}`}
                                    >
                                        {iconPath && (
                                            <img
                                                src={iconPath}
                                                alt=""
                                                aria-hidden="true"
                                                className="gp-card__art"
                                                onError={(event) => {
                                                    event.currentTarget.hidden = true;
                                                }}
                                            />
                                        )}
                                        <span className="gp-card__label">
                                            <span className="gp-card__name">{ability.label}</span>
                                            <span className="gp-card__tags">
                                                {abilityTypeLabels(ability).map((type) => (
                                                    <span key={type} className={`rounded border px-1.5 py-0.5 text-[10px] font-semibold ${typeTagClass(type)}`}>{type}</span>
                                                ))}
                                            </span>
                                        </span>
                                    </button>
                                    {active && <span className="gp-card__check" aria-hidden="true">✓</span>}
                                    <button
                                        type="button"
                                        aria-label={`View ${ability.label} stats`}
                                        title={`View ${ability.label} stats`}
                                        onClick={() => onInfo(ability)}
                                        className="gp-card__info"
                                    >
                                        <img src="/assets/arena-toolbar/info-circle-icon.png" alt="" aria-hidden="true" className="info-circle-icon h-4 w-4 opacity-85" />
                                    </button>
                                </div>
                            );
                        })}
                    </div>
                </div>
            </section>
        </div>,
        document.body,
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
            <section aria-labelledby="queue-guarantees-title" className="hq-guarantees">
                <h3 id="queue-guarantees-title" className="hq-guarantees__title">
                    Guaranteed offers <span>· optional · one per draft round</span>
                </h3>

                <div className="hq-slots">
                    {GUARANTEE_ROUNDS.map((round) => {
                        const ability = abilityForRound(values, round);
                        return (
                            <button
                                key={round}
                                type="button"
                                disabled={disabled}
                                onClick={() => openPicker(round)}
                                aria-label={`Choose round ${round} guarantee`}
                                title={ability ? `Round ${round}: ${ability.label}` : `Round ${round}: random`}
                                className={`hq-slot ${ability ? "is-set" : ""}`}
                            >
                                <AbilitySlotIcon ability={ability} />
                                <span className="hq-slot__text">
                                    <small>Round {round}</small>
                                    <strong>{ability?.label ?? "Random"}</strong>
                                </span>
                            </button>
                        );
                    })}
                    <span className="hq-slots__caption" aria-hidden="true">R1 · R2 · R3</span>
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
            {infoAbility && createPortal(
                <AbilityModal
                    ability={infoAbility}
                    onClose={() => setInfoAbility(null)}
                    overlayClassName="z-[120]"
                />,
                document.body,
            )}
        </>
    );
}
