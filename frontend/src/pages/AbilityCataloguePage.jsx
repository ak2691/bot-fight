import { useEffect, useRef, useState } from "react";
import AppNavbar from "../components/AppNavbar";
import { ABILITY_STATS } from "../beta/combat/Abilities.js";
import { MOVE_STATS } from "../beta/combat/Moves.js";
import { BOT_ABILITIES } from "../beta/loadout/BotLoadout.js";

const ROUNDS = [1, 2, 3];
const ABILITY_MEDIA_ROOT = "/assets/ability-list";

function abilityVideoPath(abilityId) {
    return `${ABILITY_MEDIA_ROOT}/videos/${abilityId}.mp4`;
}

function abilityPosterPath(abilityId) {
    return `${ABILITY_MEDIA_ROOT}/posters/${abilityId}.webp`;
}

const STAT_LABELS = Object.freeze({
    cooldownMs: "Cooldown",
    windupMs: "Wind-up",
    visualMs: "Active window",
    activeMs: "Active window",
    durationMs: "Duration",
    delayMs: "Delay",
    rechargeMs: "Charge recovery",
    reloadMs: "Reload",
    shotCooldownMs: "Shot interval",
    burnTickMs: "Burn interval",
    burnDurationMs: "Burn duration",
    bleedTickMs: "Bleed interval",
    bleedDurationMs: "Bleed duration",
    shockTickMs: "Shock interval",
    shockDurationMs: "Shock duration",
    comboWindowMs: "Combo window",
    movementLockMs: "Movement lock",
    interruptMs: "Interrupt",
    damage: "Damage",
    maxDamage: "Maximum damage",
    minDamage: "Minimum damage",
    damageStep: "Damage step",
    shockDamage: "Shock damage / tick",
    bleedDamage: "Bleed damage / tick",
    burnDamage: "Burn damage / tick",
    maxComboDamage: "Maximum combo damage",
    healing: "Healing",
    range: "Range",
    radius: "Radius",
    explosionRadius: "Explosion radius",
    distance: "Distance",
    passThroughDistance: "Pass-through distance",
    knockback: "Knockback",
    size: "Projectile size",
    speed: "Speed / tick",
    speedPerTick: "Speed / tick",
    waveSpeedPerTick: "Wave speed / tick",
    maxCharges: "Charges",
    ammoMax: "Ammunition",
    arcDegrees: "Arc",
    coverageDegrees: "Coverage",
    falloffDamage: "Damage falloff",
});

const TIME_STATS = new Set([
    "cooldownMs", "windupMs", "visualMs", "activeMs", "durationMs", "delayMs",
    "rechargeMs", "reloadMs", "shotCooldownMs", "burnTickMs", "burnDurationMs",
    "bleedTickMs", "bleedDurationMs", "shockTickMs", "shockDurationMs",
    "comboWindowMs", "movementLockMs", "interruptMs",
]);

const DISTANCE_STATS = new Set([
    "range", "radius", "explosionRadius", "distance", "passThroughDistance",
    "knockback", "size",
]);

const OMITTED_STATS = new Set(["entity", "projectile", "beam"]);

function formatSeconds(milliseconds) {
    const seconds = Number(milliseconds) / 1000;
    return `${Number.isInteger(seconds) ? seconds : seconds.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} sec`;
}

function formatStatValue(key, value) {
    if (TIME_STATS.has(key)) return formatSeconds(value);
    if (DISTANCE_STATS.has(key)) return `${value} units`;
    if (key.endsWith("Degrees")) return `${value}°`;
    if (key === "falloffDamage") return value.join(" → ");
    if (["speed", "speedPerTick", "waveSpeedPerTick"].includes(key)) return `${value} units / tick`;
    return String(value);
}

function statsForAbility(ability) {
    const stats = ABILITY_STATS[ability.id] ?? MOVE_STATS[ability.id] ?? {};
    return Object.entries(stats)
        .filter(([key]) => !OMITTED_STATS.has(key))
        .map(([key, value]) => ({
            label: STAT_LABELS[key] ?? key.replace(/([A-Z])/g, " $1").replace(/^./, (letter) => letter.toUpperCase()),
            value: formatStatValue(key, value),
        }));
}

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function playerFacingEffects(ability) {
    const effects = ability.effects.flatMap((effect) => {
        if (effect.type === "spawn_entity") return [];
        if (effect.type === "debuff" && effect.debuff) return [titleCase(effect.debuff)];
        return [titleCase(effect.type)];
    });
    return [...new Set(effects)];
}

function AbilityVideo({ ability }) {
    const [videoUnavailable, setVideoUnavailable] = useState(false);
    const videoPath = abilityVideoPath(ability.id);

    return (
        <div className="border-b border-slate-700/70 bg-[#030910] px-4 py-5 sm:px-8 sm:py-7">
            <div className="mb-3 flex items-end justify-between gap-4">
                <div>
                    <p className="font-mono text-[9px] font-bold tracking-[.24em] text-fuchsia-300">ABILITY DEMONSTRATION</p>
                    <p className="mt-1 text-xs text-slate-500">Autoplays and loops while this detail panel is open.</p>
                </div>
                <span className="hidden font-mono text-[8px] tracking-widest text-slate-600 sm:block">16:9 VIDEO</span>
            </div>
            <div className="relative aspect-video overflow-hidden border border-slate-700/70 bg-slate-950">
                {!videoUnavailable && (
                    <video
                        key={ability.id}
                        className="h-full w-full object-cover"
                        autoPlay
                        loop
                        muted
                        playsInline
                        preload="metadata"
                        poster={abilityPosterPath(ability.id)}
                        aria-label={`${ability.label} demonstration`}
                        onError={() => setVideoUnavailable(true)}
                    >
                        <source src={videoPath} type="video/mp4" onError={() => setVideoUnavailable(true)} />
                    </video>
                )}
                {videoUnavailable && (
                    <div className="absolute inset-0 grid place-items-center bg-[#030910] p-6 text-center">
                        <div>
                            <div className="mx-auto grid h-12 w-12 place-items-center border border-fuchsia-400/25 bg-fuchsia-950/20 text-xl text-fuchsia-300" aria-hidden="true">▶</div>
                            <p className="mt-4 text-sm font-semibold text-slate-300">No video yet.</p>

                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}

function AbilityModal({ ability, onClose }) {
    const closeButtonRef = useRef(null);
    const stats = statsForAbility(ability);
    const effects = playerFacingEffects(ability).join(" · ");

    useEffect(() => {
        const previousOverflow = document.body.style.overflow;
        document.body.style.overflow = "hidden";
        closeButtonRef.current?.focus();
        const handleKeyDown = (event) => {
            if (event.key === "Escape") onClose();
        };
        window.addEventListener("keydown", handleKeyDown);
        return () => {
            document.body.style.overflow = previousOverflow;
            window.removeEventListener("keydown", handleKeyDown);
        };
    }, [onClose]);

    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-[#02070de8] p-4 backdrop-blur-sm" onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
        }}>
            <section
                role="dialog"
                aria-modal="true"
                aria-labelledby="ability-modal-title"
                className="ability-modal max-h-[92vh] w-full max-w-4xl overflow-y-auto border border-fuchsia-500/50 bg-[#07131f] shadow-[0_32px_100px_rgba(0,0,0,.72)]"
            >
                <div className="relative overflow-hidden border-b border-slate-700/70 px-6 py-7 sm:px-8">
                    <div className={`ability-modal-glow ability-modal-glow-${ability.round}`} aria-hidden="true" />
                    <div className="relative flex items-start justify-between gap-6">
                        <div>
                            <p className="font-mono text-[10px] font-bold tracking-[.28em] text-fuchsia-300">
                                ROUND {ability.round} · {ability.kind.toUpperCase()}
                            </p>
                            <h2 id="ability-modal-title" className="mt-2 font-display-action text-4xl uppercase tracking-wide text-white sm:text-5xl">
                                {ability.label}
                            </h2>
                            <p className="mt-3 max-w-xl text-sm leading-6 text-slate-300">{ability.summary}</p>
                        </div>
                        <button
                            ref={closeButtonRef}
                            type="button"
                            onClick={onClose}
                            aria-label={`Close ${ability.label} details`}
                            className="grid h-10 w-10 flex-none place-items-center rounded-none border border-fuchsia-500/40 bg-slate-950/60 p-0 text-xl text-slate-300 hover:border-fuchsia-300/70 hover:text-white"
                        >
                            ×
                        </button>
                    </div>
                </div>

                <AbilityVideo ability={ability} />

                <div className="grid gap-7 px-6 py-7 sm:px-8 lg:grid-cols-[1.35fr_.65fr]">
                    <div>
                        <h3 className="font-mono text-[10px] font-bold tracking-[.24em] text-slate-400">COMBAT STATS</h3>
                        <dl className="mt-3 grid grid-cols-2 border-l border-t border-slate-700/70 sm:grid-cols-3">
                            {stats.map((stat) => (
                                <div key={stat.label} className="min-h-24 border-b border-r border-slate-700/70 bg-slate-950/35 p-4">
                                    <dt className="text-xs leading-4 text-slate-500">{stat.label}</dt>
                                    <dd className="mt-2 font-mono text-sm font-bold text-slate-100">{stat.value}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>

                    <aside className="border border-slate-700/70 bg-slate-950/35 p-5">
                        <h3 className="font-mono text-[10px] font-bold tracking-[.24em] text-fuchsia-300">MECHANICS</h3>
                        <dl className="mt-4 space-y-5">
                            <div>
                                <dt className="text-xs text-slate-500">Delivery</dt>
                                <dd className="mt-1 text-sm font-semibold text-slate-200">{titleCase(ability.delivery?.type)}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-slate-500">Effects</dt>
                                <dd className="mt-1 text-sm leading-6 text-slate-200">{effects || "None"}</dd>
                            </div>
                            <div>
                                <dt className="text-xs text-slate-500">Shield interaction</dt>
                                <dd className="mt-1 text-sm font-semibold text-slate-200">{titleCase(ability.shieldInteraction?.mode)}</dd>
                            </div>
                        </dl>
                    </aside>
                </div>
            </section>
        </div>
    );
}

export default function AbilityCataloguePage() {
    const [selectedAbility, setSelectedAbility] = useState(null);

    return (
        <main className="ability-catalogue min-h-screen bg-[#050d16] font-interface text-slate-100">
            <AppNavbar account currentPage="abilities" />

            <header className="relative overflow-hidden border-b border-slate-800/80 px-5 py-14 sm:px-8 sm:py-20">
                <div className="ability-hero-glow" aria-hidden="true" />
                <div className="relative mx-auto max-w-7xl">
                    <p className="font-mono text-[10px] font-bold tracking-[.32em] text-fuchsia-300">COMBAT DATABASE</p>
                    <h1 className="mt-3 font-display-action text-5xl uppercase tracking-wide text-white sm:text-7xl">Ability List</h1>
                    <p className="mt-4 max-w-2xl text-base leading-7 text-slate-400">
                        Explore every combat ability and named move available in the three-round draft. Select one to inspect its current arena stats.
                    </p>
                </div>
            </header>

            <div className="mx-auto max-w-7xl space-y-16 px-5 py-12 sm:px-8 sm:py-16">
                {ROUNDS.map((round) => {
                    const roundAbilities = BOT_ABILITIES.filter((ability) => ability.round === round);
                    return (
                        <section key={round} aria-labelledby={`round-${round}-title`}>
                            <div className="mb-6 flex items-end justify-between gap-6 border-b border-slate-700/60 pb-3">
                                <div>
                                    <p className="font-mono text-[9px] font-bold tracking-[.28em] text-slate-500">DRAFT TIER 0{round}</p>
                                    <h2 id={`round-${round}-title`} className="mt-1 font-display-action text-3xl uppercase tracking-wider text-white">
                                        Round {round}
                                    </h2>
                                </div>
                                <span className="font-mono text-[10px] tracking-widest text-fuchsia-300">{roundAbilities.length} MOVES</span>
                            </div>

                            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
                                {roundAbilities.map((ability, index) => (
                                    <button
                                        key={ability.id}
                                        type="button"
                                        onClick={() => setSelectedAbility(ability)}
                                        className={`ability-card ability-card-${round} group relative min-h-56 overflow-hidden rounded-none border p-0 text-left`}
                                        aria-label={`View ${ability.label} stats`}
                                    >
                                        <img
                                            src={abilityPosterPath(ability.id)}
                                            alt=""
                                            aria-hidden="true"
                                            className="absolute inset-0 h-full w-full object-cover transition duration-200 group-hover:scale-[1.025]"
                                            onError={(event) => {
                                                event.currentTarget.hidden = true;
                                            }}
                                        />
                                        <span className="absolute right-4 top-2 font-display-action text-6xl text-white/[.035]" aria-hidden="true">
                                            {String(index + 1).padStart(2, "0")}
                                        </span>
                                        <span className="absolute inset-x-0 bottom-0 border-t border-white/10 bg-[#06101bdb] px-5 py-4 backdrop-blur-sm">
                                            <span className="block font-display-action text-xl uppercase tracking-wider text-white">{ability.label}</span>
                                            <span className="mt-1 block font-mono text-[8px] font-bold tracking-[.24em] text-slate-500">{ability.kind.toUpperCase()}</span>
                                        </span>
                                    </button>
                                ))}
                            </div>
                        </section>
                    );
                })}
            </div>

            {selectedAbility && <AbilityModal ability={selectedAbility} onClose={() => setSelectedAbility(null)} />}
        </main>
    );
}
