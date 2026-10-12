import { activationView, entityContractForAbility, phaseEffects } from "../../../../shared/engine/ecs/contracts/AbilityContracts.js";
import { positiveStatusEffects, presetInterrupts } from "../../../../shared/engine/gameconfig/StatusPresets.js";

// Defence presets read as damage reduction, reflection and immunity chips, not as status rows.
const DEFENCE_KINDS = new Set(["damage_reduction", "damage_reflection", "damage_immunity"]);
const DEFENCE_CHIP_NAMES = Object.freeze({
    damage_reduction: "Damage Reduction",
    damage_reflection: "Damage Reflection",
    damage_immunity: "Damage Immunity",
});

/** A status that reads as a status row or duration: not a defence and not an interrupt. */
function isStatusRowSubtype(subtype) {
    return !presetInterrupts(subtype) && !positiveStatusEffects(subtype).some(({ kind }) => DEFENCE_KINDS.has(kind));
}

/** An ability effect that reads as a status row: a status with no player-facing numbers and no interrupt. */
function isStatusRowEffect(effect) {
    return effect.type === "status" && Boolean(effect.subtype)
        && positiveStatusEffects(effect.subtype).length === 0 && !presetInterrupts(effect.subtype);
}

const STATUS_STAT_KEYS = Object.freeze({
    burn: { damage: "burnDamage", interval: "burnTickMs", duration: "burnDurationMs" },
    bleed: { damage: "bleedDamage", interval: "bleedTickMs", duration: "bleedDurationMs" },
    shock: { damage: "shockDamage", interval: "shockTickMs", duration: "shockDurationMs" },
});

function seconds(milliseconds) {
    const value = Number(milliseconds) / 1000;
    return `${Number.isInteger(value) ? value : value.toFixed(2).replace(/0+$/, "").replace(/\.$/, "")} sec`;
}

function number(value) {
    const numeric = Number(value);
    return Number.isInteger(numeric) ? String(numeric) : numeric.toFixed(2).replace(/0+$/, "").replace(/\.$/, "");
}

function rangeForStats(stats) {
    return stats.range ?? stats.radius ?? stats.distance;
}

function damageRows(stats) {
    const falloff = stats.falloff ?? {};
    const hasFalloff = falloff.maxAmount != null || falloff.minAmount != null;
    if (!hasFalloff) return stats.damage != null ? [{ label: "Damage", value: String(stats.damage) }] : [];

    const maximum = Number(falloff.maxAmount ?? stats.damage ?? 0);
    const minimum = Number(falloff.minAmount ?? maximum);
    const section = "Damage profile";
    const rows = [
        { label: "Min damage", value: number(minimum), section },
        { label: "Max damage", value: number(maximum), section },
    ];
    const falloffStart = Number(falloff.falloffStart ?? 0);
    const falloffEnd = Number(falloff.falloffEnd ?? falloffStart);
    const range = Number(rangeForStats(stats));
    if (falloffStart > 0) rows.push({ label: "Falloff starts", value: `${number(falloffStart)} units`, section });
    if (falloffEnd > falloffStart && Number.isFinite(range) && falloffEnd < range) {
        rows.push({ label: "Falloff ends", value: `${number(falloffEnd)} units`, section });
    }
    return rows;
}

function statusRows(ability, stats) {
    return (ability.effects ?? []).flatMap((effect) => {
        // Buff-like presets (defences) and interrupts are shown as chips and stat rows instead.
        if (!isStatusRowEffect(effect)) return [];
        const keys = STATUS_STAT_KEYS[effect.subtype] ?? {};
        const duration = stats[keys.duration] ?? effect.durationMs;
        const statusName = effect.subtype.replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
        const rows = [{ label: "Status effect", value: duration != null ? `${statusName} (${seconds(duration)})` : statusName }];
        if (stats[keys.interval] != null) rows.push({ label: "Status interval", value: seconds(stats[keys.interval]) });
        if (stats[keys.damage] != null) rows.push({ label: "Status damage", value: String(stats[keys.damage]) });
        return rows;
    });
}

function buffRows(ability) {
    return (ability.buffDetails ?? []).map(({ label, value }) => ({ label, value }));
}

function appendUniqueRows(rows, additions) {
    const existing = new Set(rows.map(({ label, value }) => `${label}\u0000${value}`));
    return [...rows, ...additions.filter(({ label, value }) => {
        const key = `${label}\u0000${value}`;
        if (existing.has(key)) return false;
        existing.add(key);
        return true;
    })];
}

/** A displace reads as the effect it replaced: away is a knockback, toward a pull, and mirror a teleport. */
const isKnockbackEffect = (effect) => effect.type === "displace" && effect.direction === "away";
const isPullEffect = (effect) => effect.type === "displace" && effect.direction === "toward";
const isTeleportEffect = (effect) => effect.type === "displace" && effect.direction === "mirror";

function pullRows(ability, stats) {
    return (ability.effects ?? [])
        .filter(isPullEffect)
        .map((effect) => effect.distance ?? stats.pullPerTick)
        .filter((strength) => Number.isFinite(Number(strength)))
        .map((strength) => ({ label: "Pull strength", value: `${number(strength)} units per tick` }));
}

/**
 * The phases of the entity an ability spawns, as display sections read from shared/gameplay/abilities.json:
 * hitbox, speed, damage and pull per phase. Abilities that spawn nothing (or one phase) have none.
 */
/** Rows for one hitbox, movement and effect list (an entity phase's, or an activation hit's). */
function phaseRows(hitbox, movement, effects) {
    const rows = [];
    if (hitbox?.width != null && hitbox?.length != null) {
        rows.push({ label: "Hitbox width", value: `${number(hitbox.width)} units` }, { label: "Hitbox length", value: `${number(hitbox.length)} units` });
    } else if (hitbox?.radius != null) rows.push({ label: "Radius", value: `${number(hitbox.radius)} units` });
    if (movement?.unitsPerTick != null) rows.push({ label: "Speed", value: `${number(movement.unitsPerTick)} units per tick` });
    for (const effect of effects) {
        if (effect.type === "damage" && effect.falloff) {
            rows.push({ label: "Min damage", value: number(effect.falloff.minAmount) }, { label: "Max damage", value: number(effect.falloff.maxAmount) },
                { label: "Falloff ends", value: `${number(effect.falloff.falloffEnd)} units` });
        } else if (effect.type === "damage") rows.push({ label: "Damage", value: number(effect.amount) });
        else if (isPullEffect(effect)) rows.push({ label: "Pull strength", value: `${number(effect.distance)} units per tick` });
    }
    return rows;
}

function phaseSections(abilityId) {
    const phases = entityContractForAbility(abilityId)?.phases ?? [];
    if (phases.length < 2) return [];
    // An activation hit that comes with entities (Phase Strike's blink box) is shown first, as its own section.
    const activation = activationView(abilityId);
    const activationSections = activation?.hitbox
        ? [{ section: "Activation", rows: phaseRows(activation.hitbox, null, activation.effects ?? []) }]
        : [];
    return [...activationSections, ...phases.map((phase) => ({
        section: `${titleCaseId(phase.id)} phase`,
        rows: phaseRows(phase.hitbox, phase.movement, phaseEffects(phase)),
    }))];
}

function phaseDisplayRows(abilityId) {
    return phaseSections(abilityId).flatMap(({ section, rows }) => rows.map((entry) => ({ ...entry, section })));
}

export function abilityStatsForDisplay(ability) {
    const stats = ability.stats ?? {};
    const authoredPhaseRows = phaseDisplayRows(ability.id);
    if (authoredPhaseRows.length > 0) {
        const rows = [];
        if (stats.cooldownMs != null) rows.push({ label: "Cooldown", value: seconds(stats.cooldownMs) });
        if (stats.activeMs != null || stats.visualMs != null) {
            rows.push({ label: "Active", value: seconds(stats.activeMs ?? stats.visualMs) });
        }
        if (stats.windupMs != null) rows.push({ label: "Preparation time", value: seconds(stats.windupMs) });
        const duration = stats.durationMs ?? null;
        const durationIsStatus = (ability.effects ?? []).some((effect) => isStatusRowEffect(effect) && effect.durationMs === duration);
        if (duration != null && !durationIsStatus) rows.push({ label: "Duration", value: seconds(duration) });
        if (stats.maxCharges != null) rows.push({ label: "Charges", value: String(stats.maxCharges) });
        const resourceDurationMs = stats.reloadMs ?? stats.rechargeMs;
        if (stats.maxCharges != null && resourceDurationMs != null) {
            rows.push({
                label: stats.reloadMs != null ? "Reload" : "Recharge",
                value: seconds(resourceDurationMs),
            });
        }
        return appendUniqueRows([...rows, ...authoredPhaseRows], buffRows(ability));
    }
    const rows = [];
    if (stats.cooldownMs != null) rows.push({ label: "Cooldown", value: seconds(stats.cooldownMs) });
    if (stats.activeMs != null || stats.visualMs != null) rows.push({ label: "Active", value: seconds(stats.activeMs ?? stats.visualMs) });
    if (stats.windupMs != null) rows.push({ label: "Preparation time", value: seconds(stats.windupMs) });
    rows.push(...damageRows(stats));
    const range = rangeForStats(stats);
    if (stats.hitboxWidth != null) rows.push({ label: "Hitbox width", value: `${number(stats.hitboxWidth)} units` });
    if (stats.hitboxLength != null) rows.push({ label: "Hitbox length", value: `${number(stats.hitboxLength)} units` });
    if (range != null) rows.push({ label: stats.radius != null ? "Radius" : "Range", value: `${number(range)} units` });
    const arc = stats.arc ?? stats.coverageDegrees;
    if (arc != null) rows.push({ label: "Arc", value: `${number(arc)}\u00B0` });
    const charges = stats.maxCharges;
    if (charges != null) rows.push({ label: "Charges", value: String(charges) });
    const resourceDurationMs = stats.reloadMs ?? stats.rechargeMs;
    if (charges != null && resourceDurationMs != null) {
        rows.push({
            label: stats.reloadMs != null ? "Reload" : "Recharge",
            value: seconds(resourceDurationMs),
        });
    }
    const duration = stats.durationMs ?? null;
    const durationIsStatus = (ability.effects ?? []).some((effect) => isStatusRowEffect(effect) && effect.durationMs === duration);
    if (duration != null && !durationIsStatus) rows.push({ label: "Duration", value: seconds(duration) });
    rows.push(...statusRows(ability, stats));
    if (stats.healing != null) rows.push({ label: "Effect", value: `Restore ${stats.healing} HP` });
    if ((ability.effects ?? []).some((effect) => effect.type === "healing" && effect.mirrorsDamage)) {
        rows.push({ label: "Effect", value: "Restore damage dealt as HP" });
    }
    if (stats.knockback != null) rows.push({ label: "Effect", value: `${number(stats.knockback)}-unit knockback` });
    rows.push(...pullRows(ability, stats));
    rows.push(...buffRows(ability));
    rows.push(...phaseDisplayRows(ability.id));
    return rows;
}

// ---------------------------------------------------------------------------
// Ability info modal model: at-a-glance tiles, phase steps, effect chips, size diagram, grouped stats.
// Everything is read from the real ability data; no number is invented here.
// ---------------------------------------------------------------------------

const MAX_HIGHLIGHTS = 4;

function titleCaseId(value) {
    return String(value ?? "").replaceAll("_", " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function secondsValue(milliseconds) {
    const value = Number(milliseconds) / 1000;
    return number(value);
}

function statusDefinitions(ability) {
    const stats = ability.stats ?? {};
    const fromStats = Object.entries(stats.statuses ?? {})
        .filter(([id]) => isStatusRowSubtype(id))
        .map(([id, status]) => ({ id, ...status }));
    if (fromStats.length) return fromStats;
    return (ability.effects ?? [])
        .filter((effect) => effect.type === "status" && effect.subtype && isStatusRowSubtype(effect.subtype))
        .map((effect) => ({ id: effect.subtype, amount: effect.amount, durationMs: effect.durationMs, intervalMs: effect.intervalMs }));
}

function damageOverTime(status) {
    const amount = Number(status.amount);
    const interval = Number(status.intervalMs);
    return Number.isFinite(amount) && amount > 0 && Number.isFinite(interval) && interval > 0
        ? amount * 1000 / interval
        : null;
}

function damageHighlight(ability, stats) {
    const falloff = stats.falloff;
    if (falloff && (falloff.maxAmount != null || falloff.minAmount != null)) {
        const maximum = Number(falloff.maxAmount ?? stats.damage ?? 0);
        const minimum = Number(falloff.minAmount ?? maximum);
        const label = ability.phaseTag === "ray" ? "Damage · far to near" : "Damage · edge to centre";
        return { value: `${number(minimum)}–${number(maximum)}`, unit: "", label, tone: "damage" };
    }
    if (Number(stats.damage) > 0) return { value: number(stats.damage), unit: "", label: "Damage", tone: "damage" };
    const dot = statusDefinitions(ability)
        .map((status) => ({ status, perSecond: damageOverTime(status) }))
        .find((entry) => entry.perSecond != null);
    if (dot) return { value: number(dot.perSecond), unit: "/s", label: `${titleCaseId(dot.status.id)} damage`, tone: "damage" };
    return null;
}

function reachHighlight(ability, stats) {
    const arc = stats.arc ?? stats.coverageDegrees;
    const radius = Number(stats.radius);
    if (radius > 0) {
        const blast = ["projectile", "radial"].includes(ability.phaseTag) && (Number(stats.damage) > 0 || stats.falloff);
        return { value: number(radius), unit: "u", label: blast ? "Blast radius" : "Radius", tone: "neutral" };
    }
    const range = Number(stats.range);
    if (range > 0 && Number(arc) > 0) {
        return { value: number(range), unit: `u · ${number(arc)}°`, label: "Reach · arc", tone: "neutral" };
    }
    if (range > 0) return { value: number(range), unit: "u", label: "Range", tone: "neutral" };
    if (Number(stats.distance) > 0) return { value: number(stats.distance), unit: "u", label: "Distance", tone: "neutral" };
    return null;
}

/** Up to four { value, unit, label, tone } tiles; damage (or healing) always leads. */
export function abilityHighlights(ability) {
    const stats = ability?.stats ?? {};
    const tiles = [];
    const push = (tile) => {
        if (tile && tiles.length < MAX_HIGHLIGHTS) tiles.push(Object.freeze(tile));
    };

    const damage = damageHighlight(ability ?? {}, stats);
    if (damage) push(damage);
    else if (Number(stats.healing) > 0) push({ value: number(stats.healing), unit: "HP", label: "Healing", tone: "heal" });

    if (Number(stats.windupMs) > 0) push({ value: secondsValue(stats.windupMs), unit: "s", label: "Wind-up before the hit", tone: "neutral" });
    push(reachHighlight(ability ?? {}, stats));
    if (Number(stats.cooldownMs) > 0) push({ value: secondsValue(stats.cooldownMs), unit: "s", label: "Cooldown", tone: "neutral" });
    if (Number(stats.maxCharges) > 0) {
        const reload = stats.reloadMs ?? stats.rechargeMs;
        push({
            value: number(stats.maxCharges),
            unit: Number(stats.maxCharges) === 1 ? "charge" : "charges",
            label: reload != null ? `${secondsValue(reload)} s ${stats.reloadMs != null ? "reload" : "recharge"}` : "Charges",
            tone: "neutral",
        });
    }
    if (ability?.phaseTag === "projectile" && Number(stats.speed) > 0) {
        push({ value: number(stats.speed), unit: "u/tick", label: ability.entityType === "grenade" ? "Throw speed" : "Projectile speed", tone: "neutral" });
    }
    const statusDurations = new Set(statusDefinitions(ability ?? {}).map((status) => Number(status.durationMs)));
    if (Number(stats.durationMs) > 0 && !statusDurations.has(Number(stats.durationMs))
        && ["self", "zone", "summon", "trap"].includes(ability?.phaseTag)) {
        push({ value: secondsValue(stats.durationMs), unit: "s", label: "Duration", tone: "neutral" });
    }
    return tiles;
}

export function shortUnits(text) {
    return String(text ?? "")
        .replace(/ units per tick/g, " u/tick")
        .replace(/ units/g, " u")
        .replace(/ sec\b/g, " s");
}

function rowValue(rows, label) {
    return rows.find((candidate) => candidate.label === label)?.value ?? null;
}

function phaseStep(sectionName, rows, index) {
    const title = sectionName.replace(/ phase$/i, "");
    const key = title.toLowerCase();
    const speed = rowValue(rows, "Speed");
    const radius = rowValue(rows, "Radius");
    const width = rowValue(rows, "Hitbox width");
    const length = rowValue(rows, "Hitbox length");
    const hitbox = width && length ? `${shortUnits(width).replace(" u", "")} × ${shortUnits(length)} hitbox` : radius ? `${shortUnits(radius)} radius` : null;
    const pull = rowValue(rows, "Pull strength");
    const minDamage = rowValue(rows, "Min damage");
    const maxDamage = rowValue(rows, "Max damage");
    const damage = rowValue(rows, "Damage");
    const falloffEnd = rowValue(rows, "Falloff ends");
    const stationary = speed != null && Number.parseFloat(speed) === 0;
    let line;
    let detail = null;
    if (/^(travel|outbound)$/.test(key)) {
        line = speed ? `Flies at ${shortUnits(speed)}` : "Travels outward";
        detail = hitbox;
    } else if (/^(armed|fuse)$/.test(key)) {
        line = pull ? "Pulls bots in" : stationary ? "Lands and waits" : "Waits to trigger";
        detail = pull ? `Pull ${shortUnits(pull)}${radius ? ` · ${shortUnits(radius)} radius` : ""}` : hitbox;
    } else if (key === "return") {
        line = speed ? `Returns at ${shortUnits(speed)}` : "Returns";
        detail = pull ? `Pull ${shortUnits(pull)}` : null;
    } else if (/^(impact|active|destroyed)$/.test(key)) {
        line = radius ? `${shortUnits(radius)} blast` : "Hits";
        if (minDamage && maxDamage) {
            detail = `${maxDamage} at centre → ${minDamage}${falloffEnd ? ` by ${shortUnits(falloffEnd)}` : " at the edge"}`;
        } else if (damage) {
            detail = `${damage} damage`;
        }
    } else {
        line = rows.slice(0, 2).map((entry) => `${entry.label} ${shortUnits(entry.value)}`).join(" · ");
        detail = rows.slice(2, 4).map((entry) => `${entry.label} ${shortUnits(entry.value)}`).join(" · ") || null;
    }
    return { index: index + 1, title: title.toUpperCase(), key, line, detail };
}

/** Horizontal step strip for abilities with two or more authored phases; empty otherwise. */
export function abilityPhaseSteps(ability) {
    const sections = phaseSections(ability?.id);
    if (sections.length < 2) return [];
    return sections.map(({ section: sectionName, rows }, index) => phaseStep(sectionName, rows, index));
}

const EFFECT_MODAL_IDS = Object.freeze({
    damage: "damage",
    healing: "healing",
    restore_state: "restore_state",
});

/**
 * One chip per distinct effect: an ability with several hits that apply the same effect (Phase Strike's two damage
 * hits) shows it once, as the activation's effect list does.
 */
function distinctEffects(effects) {
    const seen = new Set();
    return effects.filter((effect) => {
        const key = JSON.stringify(effect);
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
    });
}

/** One chip per effect: { key, label, tone: "status" | "combat" | "positive", guideId }. */
export function abilityEffectChips(ability) {
    const stats = ability?.stats ?? {};
    const chips = [];
    const add = (key, label, tone, guideId) => chips.push({ key, label, tone, guideId });
    distinctEffects(ability?.effects ?? []).forEach((effect, index) => {
        const key = `${effect.type}-${effect.subtype ?? ""}-${index}`;
        switch (effect.type) {
            case "damage": {
                const falloff = effect.falloff;
                const amount = falloff
                    ? `${number(falloff.minAmount)}–${number(falloff.maxAmount)}`
                    : effect.amount != null ? number(effect.amount) : null;
                add(key, amount ? `Damage · ${amount}` : "Damage", "combat", "damage");
                break;
            }
            case "status": {
                if (presetInterrupts(effect.subtype)) {
                    add(key, effect.durationMs != null ? `Interrupt · ${number(effect.durationMs)} ms` : "Interrupt", "combat", "interrupt");
                    break;
                }
                const positives = positiveStatusEffects(effect.subtype);
                if (positives.length > 0) {
                    positives.forEach(({ kind, value }, position) => {
                        const positiveKey = `${key}-${position}`;
                        if (kind === "cooldown_recovery") {
                            const duration = effect.durationMs != null ? ` · ${secondsValue(effect.durationMs)} s` : "";
                            add(positiveKey, `${titleCaseId(effect.subtype)}${duration}`, "positive", effect.subtype);
                        } else {
                            add(positiveKey, `${DEFENCE_CHIP_NAMES[kind]} · ${number(Math.round(value * 100))}%`, "positive", kind);
                        }
                    });
                    break;
                }
                const name = titleCaseId(effect.subtype);
                const perSecond = damageOverTime(effect);
                const duration = effect.durationMs != null ? `${secondsValue(effect.durationMs)} s` : null;
                const detail = perSecond != null
                    ? `${number(perSecond)} dmg/s${duration ? ` for ${duration}` : ""}`
                    : duration;
                add(key, detail ? `${name} · ${detail}` : name, "status", effect.subtype);
                break;
            }
            case "healing":
                add(key, effect.mirrorsDamage ? "Healing · damage dealt" : `Healing · ${number(effect.amount ?? stats.healing ?? 0)} HP`, "combat", "healing");
                break;
            case "displace":
                if (isKnockbackEffect(effect)) add(key, `Knockback · ${number(effect.distance ?? stats.knockback ?? 0)} u`, "combat", "knockback");
                else if (isPullEffect(effect)) add(key, `Pull · ${number(effect.distance ?? stats.pullPerTick ?? 0)} u/tick`, "combat", "pull");
                else if (isTeleportEffect(effect)) add(key, "Teleport", "combat", "teleport");
                else add(key, "Displace", "combat", null);
                break;
            case "restore_state":
                add(key, effect.delayMs != null ? `Restore · after ${secondsValue(effect.delayMs)} s` : "Restore", "combat", "restore_state");
                break;
            default:
                add(key, titleCaseId(effect.type), "combat", EFFECT_MODAL_IDS[effect.type] ?? null);
        }
    });
    return chips;
}

function withoutSpeed(rows) {
    return rows.filter((entry) => entry.label !== "Speed");
}

/**
 * Full stat list grouped by section for the collapsed "All stats" block. Hitbox width and length merge
 * into one row, and phases that differ only by speed merge into one group with "a -> b u/tick".
 */
export function abilityStatGroups(ability) {
    const rows = abilityStatsForDisplay(ability);
    const order = [];
    const bySection = new Map();
    rows.forEach((entry) => {
        const name = (entry.section ?? "General").replace(/ phase$/i, "");
        if (!bySection.has(name)) {
            bySection.set(name, []);
            order.push(name);
        }
        bySection.get(name).push({ label: entry.label, value: shortUnits(entry.value) });
    });
    const mergeHitbox = (list) => {
        const width = list.find((entry) => entry.label === "Hitbox width");
        const length = list.find((entry) => entry.label === "Hitbox length");
        if (!width || !length) return list;
        const merged = { label: "Hitbox", value: `${width.value.replace(/ u$/, "")} × ${length.value}` };
        const next = [];
        list.forEach((entry) => {
            if (entry === width) next.push(merged);
            else if (entry !== length) next.push(entry);
        });
        return next;
    };
    const groups = order.map((name) => ({ title: name, rows: mergeHitbox(bySection.get(name)) }));
    const merged = [];
    groups.forEach((group) => {
        const previous = merged.at(-1);
        const sameShape = previous
            && previous.title !== "General"
            && JSON.stringify(withoutSpeed(previous.rows)) === JSON.stringify(withoutSpeed(group.rows))
            && previous.rows.some((entry) => entry.label === "Speed")
            && group.rows.some((entry) => entry.label === "Speed");
        if (!sameShape) {
            merged.push({ title: group.title, rows: [...group.rows] });
            return;
        }
        previous.title = `${previous.title} · ${group.title}`;
        previous.rows = previous.rows.map((entry) => {
            if (entry.label !== "Speed") return entry;
            const other = group.rows.find((candidate) => candidate.label === "Speed");
            const first = entry.value.replace(/ u\/tick$/, "");
            const second = other.value.replace(/ u\/tick$/, "");
            return { label: "Speed", value: first === second ? entry.value : `${first} → ${other.value}` };
        });
    });
    return merged;
}
