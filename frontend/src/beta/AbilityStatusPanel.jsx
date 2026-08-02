import { BOT_ABILITIES, PROTOTYPE_ABILITY_STATS } from "./loadout/BotLoadout.js";
import { MOVE_STATS } from "./combat/Moves.js";
import { fighterColorRole } from "./pixi/pixiVisualState.js";

const ABILITY_STATUS = Object.freeze({
    swing: { icon: "SW", label: "Sword Swing", detail: (fighter) => cooldownText(fighter.swingCooldownMs) },
    block: { icon: "BL", label: "Shield Block", detail: shieldStatusText },
    dash: { icon: "DA", label: "Dash", detail: (fighter) => Number(fighter.dashCooldownMs ?? 0) > 0 ? timerSuffix(fighter.dashCooldownMs, "cooldown").trim() : "Ready" },
    fire_gun: { icon: "GN", label: "Fire Gun", detail: (fighter) => `${Math.max(0, Number(fighter.gunAmmo ?? 0))} ammo${timerSuffix(fighter.gunReloadMs, "reload") || timerSuffix(fighter.gunCooldownMs, "cooldown")}` },
    throw_grenade: { icon: "GR", label: "Grenade", detail: (fighter) => cooldownText(fighter.grenadeCooldownMs) },
    shoot_fireball: { icon: "FB", label: "Fireball", detail: (fighter) => `${Math.max(0, Number(fighter.fireballCharges ?? 0))} charges${timerSuffix(fighter.fireballReloadMs, "reload") || timerSuffix(fighter.fireballCooldownMs, "cooldown")}` },
    stun: { icon: "ST", label: "Stun", detail: (fighter) => cooldownText(fighter.stunCooldownMs) },
    ...Object.fromEntries(BOT_ABILITIES.filter(({ id }) => PROTOTYPE_ABILITY_STATS[id]).map((ability) => [ability.id, {
        icon: ability.label.split(/\s+/).map((word) => word[0]).join("").slice(0, 2).toUpperCase(),
        label: ability.label,
        detail: (fighter) => prototypeStatusText(fighter, ability.id),
    }])),
});

export default function AbilityStatusPanel({ fighter, showEmptySlot = false }) {
    const abilities = Array.isArray(fighter.abilities) ? fighter.abilities : [];
    const opponent = fighter.id === "opponent-model";
    const fighterName = opponent
        ? fighter.opponentUsername ?? "OPPONENT"
        : fighter.id === "main"
            ? "YOUR BOT"
            : fighter.username ?? `SLOT ${fighter.slot ?? "?"}`;
    const pink = fighterColorRole(fighter) === "pink";
    return (
        <section className={`ability-status-panel ${opponent ? "opponent-status-panel" : ""} w-full rounded-lg border bg-zinc-950/80 p-3 ${pink ? "border-fuchsia-800/70" : "border-cyan-800/70"}`} aria-label={`${fighterName} ability status`}>
            <div className={`mb-2 flex items-center justify-between gap-2 font-mono text-[10px] font-bold tracking-widest ${pink ? "text-fuchsia-200" : "text-cyan-200"}`}>
                <span className="truncate">{fighterName}</span>
                {fighter.hp != null && <span className="shrink-0 tracking-normal text-lime">{Math.ceil(Math.max(0, Number(fighter.hp)))} / {Math.ceil(Math.max(1, Number(fighter.maxHp ?? 100)))} HP</span>}
            </div>
            <div className="max-h-[430px] overflow-y-auto pr-1">
                <div className="flex flex-col gap-2">
                    {Array.from({ length: abilities.length + (showEmptySlot ? 1 : 0) }, (_, index) => {
                        const abilityId = abilities[index];
                        const status = ABILITY_STATUS[abilityId];
                        if (!status) return (
                            <div key={`empty-${index}`} className="flex h-[54px] w-full shrink-0 items-center justify-center rounded border border-dashed border-border-lo bg-zinc-950/40 font-mono text-[9px] tracking-widest text-ink-muted">
                                SLOT {index + 1} - EMPTY
                            </div>
                        );
                        return (
                            <div key={`${abilityId}-${index}`} className="flex h-[54px] w-full min-w-0 shrink-0 items-center gap-2 overflow-hidden rounded border border-border-lo bg-arena-panel px-2 py-1.5">
                                <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded border border-border-hi bg-zinc-900 font-mono text-[8px] font-bold text-ink-white">{status.icon}</span>
                                <span className="min-w-0 overflow-hidden"><span className="block truncate text-[10px] font-bold text-ink-white">{status.label}</span><span className="block truncate font-mono text-[8px] text-ink-muted" title={status.detail(fighter)}>{status.detail(fighter)}</span></span>
                            </div>
                        );
                    })}
                </div>
            </div>
        </section>
    );
}

function prototypeStatusText(fighter, abilityId) {
    const cooldown = Number(fighter.abilityCooldowns?.[abilityId] ?? 0);
    const active = Number(fighter.abilityActiveMs?.[abilityId] ?? 0);
    const charges = fighter.abilityCharges?.[abilityId];
    if (fighter.preparingAbility === abilityId) return `PREPARING ${(Number(fighter.preparingMs ?? 0) / 1000).toFixed(1)}s`;
    if (active > 0) return `ACTIVE ${(active / 1000).toFixed(1)}s`;
    if (cooldown > 0) return `${(cooldown / 1000).toFixed(1)}s cooldown${charges == null ? "" : ` · ${charges} charges`}`;
    return charges == null ? "READY" : `READY · ${charges} charges`;
}

function shieldStatusText(fighter) {
    const charges = Math.max(0, Number(fighter.blockCharges ?? 0));
    const cooldownMs = Math.max(0, Number(fighter.blockCooldownMs ?? 0));
    const rechargeRemainingMs = charges < Number(MOVE_STATS.block.maxCharges)
        ? Math.max(0, Number(MOVE_STATS.block.rechargeMs) - Number(fighter.blockRechargeMs ?? 0))
        : 0;
    const useText = cooldownMs > 0 ? `${(cooldownMs / 1000).toFixed(1)}s` : "READY";
    const chargeText = rechargeRemainingMs > 0 ? `${(rechargeRemainingMs / 1000).toFixed(1)}s` : "FULL";
    return `${charges} CH · USE ${useText} · CHARGE ${chargeText}`;
}

function cooldownText(value) {
    const milliseconds = Math.max(0, Number(value ?? 0));
    return milliseconds > 0 ? `${(milliseconds / 1000).toFixed(1)}s cooldown` : "READY";
}

function timerSuffix(value, label) {
    const milliseconds = Math.max(0, Number(value ?? 0));
    return milliseconds > 0 ? ` · ${(milliseconds / 1000).toFixed(1)}s ${label}` : "";
}
