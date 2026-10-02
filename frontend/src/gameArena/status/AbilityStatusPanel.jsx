import { useState } from "react";
import { getAbilityCatalogueIcon } from "../../abilityCatalogueIcons.js";
import { AbilityModal } from "../../pages/catalogue/AbilityCataloguePage.jsx";
import { STANDARD_ABILITY_IDS, abilityDefinition } from "../loadout/BotLoadout.js";
import { BASE_BOT_HP } from "../modelPayloads/arenaConstants.js";
import { formatHp } from "../gameconfig/visualState.js";
import { botColorRole } from "../pixi/pixiVisualState.js";
import { abilityChargeCountFor, abilityRingColorFor, abilityStatusFor, fallbackAbilityText, formatAbilityTimer, statusParticipantNumber } from "./abilityStatusPresentation.js";

const HP_SEGMENTS = 10;
const BASE_ABILITY_IDS = new Set(STANDARD_ABILITY_IDS);

export default function AbilityStatusPanel({ bot, abilityInfoEnabled = false, statusRoster = [], showParticipantNumbers = false }) {
    const abilities = Array.isArray(bot?.abilities) ? bot.abilities : [];
    const [selectedAbility, setSelectedAbility] = useState(null);
    const opponent = bot?.id === "opponent-model";
    const botName = opponent
        ? bot.opponentUsername ?? bot?.username ?? "OPPONENT"
        : bot?.username ?? `SLOT ${bot?.slot ?? "?"}`;
    const red = botColorRole(bot) === "red";
    const isCurrentUser = bot?.isCurrentUser === true;
    const participantNumber = showParticipantNumbers ? statusParticipantNumber(bot, statusRoster) : null;
    const accessibleBotName = `${botName}${isCurrentUser ? " (Me)" : participantNumber != null ? ` (${participantNumber})` : ""}`;
    const teamTag = red ? "RED" : "BLUE";
    // Base abilities lead in their own group; loadout abilities follow. A group with no abilities renders nothing.
    const indexedAbilities = abilities.map((abilityId, index) => ({ abilityId, index }));
    const baseAbilities = indexedAbilities.filter(({ abilityId }) => BASE_ABILITY_IDS.has(abilityId));
    const loadoutAbilities = indexedAbilities.filter(({ abilityId }) => !BASE_ABILITY_IDS.has(abilityId));
    const hasHp = bot?.hp != null;
    const maxHp = Math.max(1, Number(bot?.maxHp ?? BASE_BOT_HP));

    return (
        <>
            <section
                className={`ability-status-panel hud-fighter ${red ? "is-red" : "is-blue"}`}
                aria-label={`${accessibleBotName} ability status`}
            >
                <div className="hud-fighter__id">
                    <svg className="hud-face" viewBox="0 0 240 240" aria-hidden="true">
                        <circle cx="120" cy="120" r="96" />
                        <circle className="hud-face__eye" cx="72" cy="171" r="7" />
                        <circle className="hud-face__eye" cx="168" cy="171" r="7" />
                        <rect className="hud-face__eye" x="88" y="201" width="64" height="4" />
                    </svg>
                    <div className="ability-status-panel__header hud-fighter__names">
                        <span className="hud-fighter__tag">{teamTag}</span>
                        {participantNumber != null && <span className="hud-fighter__tag hud-fighter__tag--number">{participantNumber}</span>}
                        {isCurrentUser && <span className="hud-fighter__you">You</span>}
                    </div>
                    <span className="ability-status-panel__name hud-fighter__name" title={botName}>{botName}</span>
                </div>
                {hasHp && <HpBar hp={Number(bot.hp)} maxHp={maxHp} />}
                <div className="ability-status-panel__abilities hud-fighter__abilities">
                    {[["base", baseAbilities], ["loadout", loadoutAbilities]].map(([group, entries]) => entries.length > 0 && (
                        <div key={group} className={`hud-abilities hud-abilities--${group}`}>
                            {entries.map(({ abilityId, index }) => (
                                <AbilityStatusTile
                                    key={`${abilityId}-${index}`}
                                    bot={bot}
                                    abilityId={abilityId}
                                    onAbilityInfo={abilityInfoEnabled ? setSelectedAbility : null}
                                />
                            ))}
                        </div>
                    ))}
                </div>
            </section>
            {abilityInfoEnabled && selectedAbility && (
                <AbilityModal ability={selectedAbility} onClose={() => setSelectedAbility(null)} />
            )}
        </>
    );
}

function HpBar({ hp, maxHp }) {
    const fraction = Math.max(0, Math.min(1, hp / maxHp));
    const filled = hp > 0 ? Math.max(1, Math.ceil(fraction * HP_SEGMENTS)) : 0;
    const tone = fraction > 0.6 ? "is-high" : fraction > 0.3 ? "is-mid" : "is-low";
    return (
        <div className="ability-status-panel__hp hud-hp" role="meter" aria-label="HP" aria-valuemin={0} aria-valuemax={maxHp} aria-valuenow={Math.max(0, hp)} aria-valuetext={`${formatHp(hp)} of ${formatHp(maxHp)} HP`}>
            <div className="hud-hp__row">
                <span>HP</span>
                <strong>{formatHp(hp)}</strong>
            </div>
            <div className={`hud-hp__bar ${tone}`} aria-hidden="true">
                {Array.from({ length: HP_SEGMENTS }, (_, index) => (
                    <span key={index} className={index < filled ? "is-filled" : ""} />
                ))}
            </div>
        </div>
    );
}

function AbilityStatusTile({ bot, abilityId, onAbilityInfo = null }) {
    const definition = abilityDefinition(abilityId);
    const label = definition?.label ?? humanizeAbilityId(abilityId);
    const iconPath = getAbilityCatalogueIcon(abilityId);
    const status = abilityStatusFor(bot, abilityId);
    const [imageFailed, setImageFailed] = useState(false);
    const timer = formatAbilityTimer(status.remainingMs);
    const charges = abilityChargeCountFor(bot, abilityId);
    const stateLabel = timer ? `${status.state}, ${timer} remaining` : status.state;
    const canOpenAbilityInfo = Boolean(definition && typeof onAbilityInfo === "function");
    const statusProgress = Math.max(0, Math.min(1, Number(status.progress ?? 0)));
    const tileProgress = ["active", "preparing", "ready"].includes(status.state) ? 1 : statusProgress;
    // The cooldown fill covers the part of the tile that is still recharging.
    const coolingFraction = status.state === "cooldown" ? 1 - tileProgress : 0;
    const handleImageError = (event) => {
        setImageFailed(true);
        event.currentTarget.hidden = true;
    };
    const tile = (
        <div
            className="ability-status-ring hud-ability"
            data-ability-state={status.state}
            data-ring-progress={tileProgress}
            style={{ "--hud-ability-ring": abilityRingColorFor(abilityId, status) }}
        >
            <div className="hud-ability__face">
                {(!iconPath || imageFailed) && (
                    <span className="hud-ability__text" aria-hidden="true">
                        {fallbackAbilityText(abilityId, label)}
                    </span>
                )}
                {iconPath && (
                    <img
                        src={iconPath}
                        alt=""
                        aria-hidden="true"
                        className="hud-ability__icon"
                        onError={handleImageError}
                    />
                )}
                <span className="hud-ability__cooldown" style={{ height: `${(coolingFraction * 100).toFixed(1)}%` }} aria-hidden="true" />
                {timer && (
                    <span className="ability-status-panel__timer hud-ability__timer" aria-hidden="true">{timer}</span>
                )}
            </div>
            {charges != null && (
                <span className="hud-ability__charges" aria-hidden="true">{charges}</span>
            )}
        </div>
    );

    return (
        <div
            className="hud-ability-slot"
            role={canOpenAbilityInfo ? undefined : "img"}
            aria-label={`${label}: ${stateLabel}`}
            title={canOpenAbilityInfo ? undefined : `${label}: ${stateLabel}`}
        >
            {canOpenAbilityInfo ? (
                <button
                    type="button"
                    className="ability-status-icon-button"
                    aria-label={`View ${label} ability information`}
                    title={`View ${label} ability information`}
                    onClick={() => onAbilityInfo(definition)}
                >
                    {tile}
                </button>
            ) : tile}
        </div>
    );
}

function humanizeAbilityId(abilityId) {
    return String(abilityId || "Unknown ability")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
