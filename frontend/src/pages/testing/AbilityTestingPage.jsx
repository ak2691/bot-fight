import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import Arena from "../../gameArena/Arena";
import { ABILITY_TEST_PRESETS, findAbilityTestingPreset } from "../../gameArena/testing/AbilityTestingPresets.js";
import { useDialogFocus } from "../../components/useDialogFocus.js";

const INITIAL_MODAL_POSITION = { x: 24, y: 84 };

function titleCase(value) {
    return String(value ?? "")
        .replaceAll("_", " ")
        .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

const STAT_LABELS = Object.freeze({
    damageByRange: "Damage",
    damageRanges: "Ranges",
    damageRangeMode: "Mode",
    damageMinRadius: "Min Radius",
    damageMaxRadius: "Max Radius",
    damageMinDistance: "Min Distance",
    damageMaxDistance: "Max Distance",
});
const DAMAGE_BY_RANGE_KEYS = new Set([
    "damageByRange",
    "damageRanges",
    "damageRangeMode",
    "damageMinRadius",
    "damageMaxRadius",
    "damageMinDistance",
    "damageMaxDistance",
]);

function payloadForPreset(preset) {
    return {
        playerLoadout: preset?.playerLoadout,
        opponentLoadout: preset?.opponentLoadout,
        playerCode: preset?.playerCode,
        opponentCode: preset?.opponentCode,
    };
}

function formatStatLabel(value) {
    return STAT_LABELS[value] ?? titleCase(String(value).replace(/([a-z])([A-Z])/g, "$1 $2"));
}

function formatRangeNumber(value) {
    const number = Number(value);
    if (!Number.isFinite(number)) return String(value);
    return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function formatStatValue(value, key, stats) {
    if (key === "damageRanges" && Array.isArray(value)) {
        if (stats?.damageRangeMode === "interpolated" && value.length > 0) {
            const minimum = stats.damageMinRadius ?? stats.damageMinDistance ?? 0;
            return value.map((end, index) => (
                `${formatRangeNumber(index === 0 ? minimum : value[index - 1])}-${formatRangeNumber(end)}`
            )).join(",");
        }
        if (stats?.damageRangeMode === "continuous" && value.length > 1) {
            return value.slice(0, -1).map((start, index) => (
                `${formatRangeNumber(start)}-${formatRangeNumber(value[index + 1])}`
            )).join(",");
        }
        const maxRange = stats?.damageMaxRadius ?? stats?.damageMaxDistance;
        if (maxRange != null && value.length > 0) {
            return value.map((start, index) => {
                const end = value[index + 1] ?? maxRange;
                return `${formatRangeNumber(start)}-${formatRangeNumber(end)}`;
            }).join(",");
        }
    }
    if (Array.isArray(value)) return value.join(",");
    if (key === "damageRangeMode") return titleCase(value);
    if (typeof value === "boolean") return value ? "Yes" : "No";
    if (value && typeof value === "object") return JSON.stringify(value);
    return String(value ?? "—");
}

function effectLabel(effect) {
    if (effect.type === "debuff" && effect.debuff) return `${titleCase(effect.debuff)} (${formatStatValue(effect.durationMs)} ms)`;
    return titleCase(effect.type);
}

function deliveryDescription(type) {
    return {
        self: "Self — applies to the caster.",
        melee: "Melee — a close-range facing hit.",
        ray: "Ray — an instant line-of-sight hit.",
        projectile: "Projectile — travels toward the target.",
        radial: "Radial — reaches targets around the cast point.",
        field: "Field — persists in an area.",
        trap: "Trap — arms at a placed location.",
        summon: "Summon — creates an independent entity.",
    }[type] ?? titleCase(type);
}

export default function AbilityTestingPage() {
    const navigate = useNavigate();
    const location = useLocation();
    const requestedAbilityId = new URLSearchParams(location.search).get("ability");
    const requestedPreset = findAbilityTestingPreset(requestedAbilityId);
    const requestedPresetId = requestedPreset?.id ?? ABILITY_TEST_PRESETS[0]?.id ?? "";
    const [selectedId, setSelectedId] = useState(requestedPresetId);
    const [runToken, setRunToken] = useState(1);
    const [isChooserMinimized, setIsChooserMinimized] = useState(false);
    const [statsPresetId, setStatsPresetId] = useState(null);

    const resolvedSelectedId = requestedAbilityId == null ? selectedId : requestedPresetId;
    const selectedPreset = ABILITY_TEST_PRESETS.find((preset) => preset.id === resolvedSelectedId) ?? ABILITY_TEST_PRESETS[0];
    const statsPreset = ABILITY_TEST_PRESETS.find((preset) => preset.id === statsPresetId) ?? null;
    const [abilityTestingPayload, setAbilityTestingPayload] = useState(() => payloadForPreset(selectedPreset));

    const selectPreset = (id) => {
        const nextPreset = ABILITY_TEST_PRESETS.find((preset) => preset.id === id) ?? ABILITY_TEST_PRESETS[0];
        setSelectedId(nextPreset?.id ?? "");
        setRunToken((current) => current + 1);
        setStatsPresetId(null);
        setAbilityTestingPayload(payloadForPreset(nextPreset));
        if (nextPreset) navigate(`/ability-testing?ability=${encodeURIComponent(nextPreset.id)}`, { replace: true });
    };

    const selectOffset = (offset) => {
        if (!ABILITY_TEST_PRESETS.length) return;
        const currentIndex = Math.max(0, ABILITY_TEST_PRESETS.findIndex((preset) => preset.id === selectedPreset?.id));
        const nextIndex = (currentIndex + offset + ABILITY_TEST_PRESETS.length) % ABILITY_TEST_PRESETS.length;
        selectPreset(ABILITY_TEST_PRESETS[nextIndex].id);
    };

    const startReplay = () => {
        if (!selectedPreset) return;
        navigate("/ability-testing/replay", {
            state: {
                presetId: selectedPreset.id,
                payload: abilityTestingPayload,
            },
        });
    };

    return (
        <Arena
            abilityTestingMode
            abilityTestingPreset={selectedPreset}
            abilityTestingRunToken={runToken}
            onAbilityTestingPayloadChange={setAbilityTestingPayload}
            roomAside={(
                <AbilityTestingNavigator
                    presets={ABILITY_TEST_PRESETS}
                    selectedId={resolvedSelectedId}
                    onSelect={selectPreset}
                    onPrevious={() => selectOffset(-1)}
                    onNext={() => selectOffset(1)}
                    onTestReplay={startReplay}
                    minimized={isChooserMinimized}
                    onToggleMinimized={() => setIsChooserMinimized((current) => !current)}
                    statsPreset={statsPreset}
                    onOpenStats={setStatsPresetId}
                    onCloseStats={() => setStatsPresetId(null)}
                />
            )}
            onExit={() => navigate("/beta")}
        />
    );
}

function AbilityTestingNavigator({
    presets,
    selectedId,
    onSelect,
    onPrevious,
    onNext,
    onTestReplay,
    minimized,
    onToggleMinimized,
    statsPreset,
    onOpenStats,
    onCloseStats,
}) {
    const [position, setPosition] = useState(INITIAL_MODAL_POSITION);
    const dragRef = useRef(null);

    useEffect(() => {
        const move = (event) => {
            const drag = dragRef.current;
            if (!drag || drag.pointerId !== event.pointerId) return;
            const width = Math.min(304, window.innerWidth - 16);
            const height = 260;
            setPosition({
                x: Math.max(8, Math.min(window.innerWidth - width - 8, event.clientX - drag.offsetX)),
                y: Math.max(56, Math.min(window.innerHeight - height - 8, event.clientY - drag.offsetY)),
            });
        };
        const stop = (event) => {
            if (dragRef.current?.pointerId === event.pointerId) dragRef.current = null;
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", stop);
        window.addEventListener("pointercancel", stop);
        return () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", stop);
            window.removeEventListener("pointercancel", stop);
        };
    }, []);

    const beginDrag = (event) => {
        if (event.button !== 0 || event.target.closest("button")) return;
        event.preventDefault();
        dragRef.current = {
            pointerId: event.pointerId,
            offsetX: event.clientX - position.x,
            offsetY: event.clientY - position.y,
        };
    };

    return (
        <>
            <aside
                className={`fixed z-40 max-h-[calc(100vh-5rem)] overflow-y-auto rounded-lg border border-slate-600/80 bg-[#07111b]/95 text-slate-100 shadow-2xl shadow-black/40 backdrop-blur ${minimized ? "h-11 w-11" : "w-[18rem] max-w-[calc(100vw-1rem)]"}`}
                style={{ left: position.x, top: position.y }}
                aria-label="Ability test lab"
            >
                <div
                    className="flex min-h-11 items-center justify-end border-b border-slate-700/80 px-1.5 cursor-move"
                    onPointerDown={beginDrag}
                    aria-label="Move ability test lab"
                >
                    <button
                        type="button"
                        onClick={onToggleMinimized}
                        aria-label={minimized ? "Restore ability test lab" : "Minimize ability test lab"}
                        title={minimized ? "Restore" : "Minimize"}
                        className="flex h-11 min-h-11 min-w-11 w-11 items-center justify-center rounded border border-transparent font-mono text-lg leading-none text-slate-300 hover:border-cyan-400/70 hover:text-cyan-200"
                    >
                        {minimized ? "+" : "−"}
                    </button>
                </div>

                {!minimized && (
                    <div className="p-2">
                        <div className="max-h-[min(60vh,32rem)] space-y-1 overflow-y-auto pr-0.5" aria-label="Ability test presets">
                            {presets.map((preset) => (
                                <div
                                    key={preset.id}
                                    className={`flex min-h-9 items-stretch rounded border ${preset.id === selectedId ? "border-cyan-400/80 bg-cyan-950/35" : "border-slate-700/70 bg-slate-950/40"}`}
                                >
                                    <button
                                        type="button"
                                        aria-pressed={preset.id === selectedId}
                                        onClick={() => onSelect(preset.id)}
                                        className="min-w-0 flex-1 px-2 py-2 text-left text-xs font-semibold text-slate-100 hover:text-white"
                                    >
                                        <span className="block truncate">{preset.label}</span>
                                    </button>
                                    <button
                                        type="button"
                                        aria-label={`${preset.label} settings`}
                                        title={`${preset.label} settings`}
                                        onClick={() => onOpenStats(preset.id)}
                                        className="flex w-9 flex-none items-start justify-center px-1 pt-1.5 text-sm text-slate-500 hover:text-cyan-200"
                                    >
                                        <span aria-hidden="true">⚙</span>
                                    </button>
                                </div>
                            ))}
                        </div>

                        <div className="mt-2 grid grid-cols-2 gap-1.5">
                            <button
                                type="button"
                                onClick={onPrevious}
                                disabled={!presets.length}
                                aria-label="Previous ability"
                                title="Previous ability"
                                className="h-8 border border-slate-600/70 bg-slate-950/50 font-mono text-lg leading-none text-slate-300 hover:border-cyan-400/70 hover:text-cyan-200 disabled:opacity-30"
                            >
                                ←
                            </button>
                            <button
                                type="button"
                                onClick={onNext}
                                disabled={!presets.length}
                                aria-label="Next ability"
                                title="Next ability"
                                className="h-8 border border-slate-600/70 bg-slate-950/50 font-mono text-lg leading-none text-slate-300 hover:border-cyan-400/70 hover:text-cyan-200 disabled:opacity-30"
                            >
                                →
                            </button>
                        </div>
                        <button
                            type="button"
                            onClick={onTestReplay}
                            className="mt-1.5 h-9 w-full border border-fuchsia-500/70 bg-fuchsia-950/30 font-mono text-[10px] font-bold tracking-widest text-fuchsia-200 hover:bg-fuchsia-900/45 disabled:opacity-50"
                        >
                            Test Replay
                        </button>
                    </div>
                )}
            </aside>

            {statsPreset && (
                <AbilityStatsModal preset={statsPreset} onClose={onCloseStats} />
            )}
        </>
    );
}

function AbilityStatsModal({ preset, onClose }) {
    const dialogRef = useRef(null);
    const closeButtonRef = useRef(null);
    useDialogFocus(dialogRef, { initialFocusRef: closeButtonRef, onClose, lockScroll: true });
    const allStats = Object.entries(preset.stats ?? {}).filter(([key]) => (
        !(Array.isArray(preset.stats?.damageByRange) && ["damage", "falloffDamage"].includes(key))
    ));
    const damageByRangeStats = allStats.filter(([key]) => DAMAGE_BY_RANGE_KEYS.has(key));
    const stats = allStats.filter(([key]) => !DAMAGE_BY_RANGE_KEYS.has(key));
    const deliveryType = preset.delivery?.type;
    const shield = preset.shieldInteraction;
    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 p-4"
            role="presentation"
            onMouseDown={(event) => {
                if (event.target === event.currentTarget) onClose();
            }}
        >
            <section
                ref={dialogRef}
                className="max-h-[min(80vh,40rem)] w-[min(28rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-cyan-400/50 bg-[#07111b] p-4 text-slate-100 shadow-2xl shadow-black/60"
                role="dialog"
                aria-modal="true"
                aria-labelledby="ability-stats-title"
                tabIndex={-1}
            >
                <header className="flex items-start justify-between gap-3">
                    <h2 id="ability-stats-title" className="text-base font-bold text-white">{preset.label}</h2>
                    <button
                        ref={closeButtonRef}
                        type="button"
                        onClick={onClose}
                        aria-label="Close ability settings"
                        title="Close"
                        className="flex h-11 min-h-11 min-w-11 w-11 items-center justify-center border border-slate-600/70 font-mono text-lg leading-none text-slate-300 hover:border-cyan-400/70 hover:text-cyan-200"
                    >
                        ×
                    </button>
                </header>

                <div className="mt-4 space-y-4">
                    <div>
                        <p className="font-mono text-[9px] tracking-widest text-cyan-300">DELIVERY</p>
                        <p className="mt-1 text-xs text-slate-300">{deliveryDescription(deliveryType)}</p>
                    </div>

                    {damageByRangeStats.length > 0 && (
                        <div>
                            <p className="font-mono text-[9px] tracking-widest text-cyan-300">DAMAGE BY RANGE</p>
                            <dl className="mt-1 divide-y divide-slate-800 border border-slate-800">
                                {damageByRangeStats.map(([key, value]) => (
                                    <div key={key} className="flex justify-between gap-4 px-2 py-1.5 font-mono text-[10px]">
                                        <dt className="text-slate-500">{formatStatLabel(key)}</dt>
                                        <dd className="text-right text-slate-200">{formatStatValue(value, key, preset.stats)}</dd>
                                    </div>
                                ))}
                            </dl>
                            <p className="mt-1 text-[10px] text-slate-500">Range starts are inclusive; the next range owns a shared boundary.</p>
                        </div>
                    )}

                    {stats.length > 0 && <div>
                        <p className="font-mono text-[9px] tracking-widest text-cyan-300">STATS</p>
                        <dl className="mt-1 divide-y divide-slate-800 border border-slate-800">
                            {stats.map(([key, value]) => (
                                <div key={key} className="flex justify-between gap-4 px-2 py-1.5 font-mono text-[10px]">
                                    <dt className="text-slate-500">{formatStatLabel(key)}</dt>
                                    <dd className="text-right text-slate-200">{formatStatValue(value, key, preset.stats)}</dd>
                                </div>
                            ))}
                        </dl>
                    </div>}

                    <div>
                        <p className="font-mono text-[9px] tracking-widest text-cyan-300">EFFECTS</p>
                        <p className="mt-1 text-xs text-slate-300">
                            {preset.effects?.length ? preset.effects.map(effectLabel).join(" · ") : "None"}
                        </p>
                    </div>

                    <div>
                        <p className="font-mono text-[9px] tracking-widest text-cyan-300">SHIELD</p>
                        <dl className="mt-1 divide-y divide-slate-800 border border-slate-800">
                            <div className="flex justify-between gap-4 px-2 py-1.5 font-mono text-[10px]">
                                <dt className="text-slate-500">Mode</dt>
                                <dd className="text-right text-slate-200">{titleCase(shield?.mode ?? "none")}</dd>
                            </div>
                            {shield?.prevents?.length > 0 && (
                                <div className="flex justify-between gap-4 px-2 py-1.5 font-mono text-[10px]">
                                    <dt className="text-slate-500">Prevents</dt>
                                    <dd className="text-right text-slate-200">{shield.prevents.map(titleCase).join(" / ")}</dd>
                                </div>
                            )}
                            {shield?.chargeCost != null && (
                                <div className="flex justify-between gap-4 px-2 py-1.5 font-mono text-[10px]">
                                    <dt className="text-slate-500">Charge Cost</dt>
                                    <dd className="text-right text-slate-200">{titleCase(shield.chargeCost)}</dd>
                                </div>
                            )}
                            {shield?.halfArcDegrees != null && (
                                <div className="flex justify-between gap-4 px-2 py-1.5 font-mono text-[10px]">
                                    <dt className="text-slate-500">Half Arc</dt>
                                    <dd className="text-right text-slate-200">{formatStatValue(shield.halfArcDegrees)}°</dd>
                                </div>
                            )}
                        </dl>
                    </div>
                </div>
            </section>
        </div>
    );
}
