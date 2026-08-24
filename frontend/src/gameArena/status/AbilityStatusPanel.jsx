import { useState } from "react";
import { getAbilityCatalogueIcon } from "../../abilityCatalogueIcons.js";
import { abilityDefinition } from "../loadout/BotLoadout.js";
import { BASE_BOT_HP } from "../modelPayloads/arenaConstants.js";
import { formatHp } from "../gameconfig/visualState.js";
import { botColorRole } from "../pixi/pixiVisualState.js";
import { ABILITY_RING_COLORS, abilityChargeCountFor, abilityRingArcPath, abilityRingColorFor, abilityStatusFor, fallbackAbilityText, formatAbilityTimer } from "./abilityStatusPresentation.js";

const ABILITY_RING_CENTER = 18;
const ABILITY_RING_RADIUS = 15.5;
const ABILITY_RING_STROKE_WIDTH = 3;

export default function AbilityStatusPanel({ bot }) {
    const abilities = Array.isArray(bot?.abilities) ? bot.abilities : [];
    const opponent = bot?.id === "opponent-model";
    const botName = opponent
        ? bot.opponentUsername ?? "OPPONENT"
        : bot?.id === "main"
            ? "YOUR BOT"
            : bot?.username ?? `SLOT ${bot?.slot ?? "?"}`;
    const red = botColorRole(bot) === "red";
    return (
        <section
            className="ability-status-panel h-[17.5rem] w-full rounded-lg border border-slate-700/80 bg-zinc-950/90 p-3"
            aria-label={`${botName} ability status`}
        >
            <div className="ability-status-panel__header mb-2 flex min-h-4 items-center justify-between gap-2 font-mono text-[10px] font-bold tracking-widest">
                <span className={`truncate ${red ? "text-[#ff7166]" : "text-[#57b8ff]"}`}>{botName}</span>
                <div className="flex shrink-0 items-center gap-2">
                    {bot?.hp != null && (
                        <span className="tracking-normal text-lime">
                            {formatHp(bot.hp)} / {formatHp(Math.max(1, Number(bot.maxHp ?? BASE_BOT_HP)))} HP
                        </span>
                    )}
                </div>
            </div>
            <div className="ability-status-panel__abilities grid h-[14.5rem] auto-rows-[4.5rem] grid-cols-3 gap-x-1 gap-y-2 overflow-y-auto pr-1">
                {abilities.map((abilityId, index) => (
                    <AbilityStatusCircle key={`${abilityId}-${index}`} bot={bot} abilityId={abilityId} />
                ))}
            </div>
        </section>
    );
}

function AbilityStatusCircle({ bot, abilityId }) {
    const definition = abilityDefinition(abilityId);
    const label = definition?.label ?? humanizeAbilityId(abilityId);
    const iconPath = getAbilityCatalogueIcon(abilityId);
    const status = abilityStatusFor(bot, abilityId);
    const [imageFailed, setImageFailed] = useState(false);
    const timer = formatAbilityTimer(status.remainingMs);
    const charges = abilityChargeCountFor(bot, abilityId);
    const stateLabel = timer ? `${status.state}, ${timer} remaining` : status.state;

    return (
        <div
            className="flex min-w-0 flex-col items-center"
            role="img"
            aria-label={`${label}: ${stateLabel}`}
            title={`${label}: ${stateLabel}`}
        >
            <div className="flex h-4 w-full items-end justify-center overflow-hidden whitespace-nowrap font-mono text-[9px] leading-3 text-slate-300" aria-hidden="true">
                {timer}
            </div>
            <AbilityRing status={status} abilityId={abilityId} label={label} iconPath={iconPath} imageFailed={imageFailed} charges={charges} onImageError={(event) => {
                setImageFailed(true);
                event.currentTarget.hidden = true;
            }} />
        </div>
    );
}

function AbilityRing({ status, abilityId, label, iconPath, imageFailed, charges, onImageError }) {
    const statusProgress = Math.max(0, Math.min(1, Number(status.progress ?? 0)));
    const ringProgress = ["active", "preparing", "ready"].includes(status.state) ? 1 : statusProgress;
    const ringColor = abilityRingColorFor(abilityId, status);
    const partialRingPath = abilityRingArcPath(ringProgress, ABILITY_RING_CENTER, ABILITY_RING_RADIUS);

    return (
        <div
            className="relative mt-1 h-9 w-9 shrink-0 rounded-full"
            data-ability-state={status.state}
            data-ring-progress={ringProgress}
        >
            <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 36 36" aria-hidden="true">
                <circle cx={ABILITY_RING_CENTER} cy={ABILITY_RING_CENTER} r={ABILITY_RING_RADIUS} fill="none" stroke={ABILITY_RING_COLORS.idle} strokeWidth={ABILITY_RING_STROKE_WIDTH} vectorEffect="non-scaling-stroke" />
                {ringProgress === 1 && (
                    <circle cx={ABILITY_RING_CENTER} cy={ABILITY_RING_CENTER} r={ABILITY_RING_RADIUS} fill="none" stroke={ringColor} strokeWidth={ABILITY_RING_STROKE_WIDTH} vectorEffect="non-scaling-stroke" />
                )}
                {partialRingPath && (
                    <path d={partialRingPath} fill="none" stroke={ringColor} strokeWidth={ABILITY_RING_STROKE_WIDTH} vectorEffect="non-scaling-stroke" strokeLinecap="butt" />
                )}
            </svg>
            <div className="absolute inset-[4px] grid place-items-center overflow-hidden rounded-full bg-[#0a111a]">
                {(!iconPath || imageFailed) && (
                    <span className="font-mono text-[10px] font-bold tracking-tight text-slate-200" aria-hidden="true">
                        {fallbackAbilityText(abilityId, label)}
                    </span>
                )}
                {iconPath && (
                    <img
                        src={iconPath}
                        alt=""
                        aria-hidden="true"
                        className="absolute inset-0 h-full w-full object-contain p-1"
                        onError={onImageError}
                    />
                )}
            </div>
            {charges != null && (
                <span className="absolute -bottom-1 -right-2 min-w-4 rounded bg-zinc-950 px-0.5 text-center font-mono text-[10px] font-bold leading-4 text-slate-100" aria-hidden="true">
                    {charges}
                </span>
            )}
        </div>
    );
}

function humanizeAbilityId(abilityId) {
    return String(abilityId || "Unknown ability")
        .replace(/[_-]+/g, " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}
