const MAX_REPORTED_MISMATCHES = 500;

const asObject = (value) => value && typeof value === "object" && !Array.isArray(value) ? value : {};
const withoutNulls = (value) => {
    if (Array.isArray(value)) return value.map(withoutNulls);
    if (!value || typeof value !== "object") return value;
    const result = {};
    for (const [key, item] of Object.entries(value)) {
        if (item == null) continue;
        const normalized = withoutNulls(item);
        if (normalized && typeof normalized === "object" && !Array.isArray(normalized)
            && Object.keys(normalized).length === 0) continue;
        result[key] = normalized;
    }
    return result;
};

const enumToken = (value) => typeof value === "string"
    ? value.replace(/([a-z0-9])([A-Z])/g, "$1_$2").replace(/[\s-]+/g, "_").toUpperCase()
    : value;
const lowerCamel = (value) => String(value).toLowerCase().replace(/_([a-z0-9])/g, (_, letter) => letter.toUpperCase());
const enumList = (values) => [...new Set((values ?? []).map(enumToken))].sort();
const isZero = (value) => typeof value === "number" && Math.abs(value) < 1e-12;

function normalizeSpawn(contract, side) {
    const spawn = asObject(contract.spawn);
    const offset = asObject(spawn.offset);
    const normalized = {
        offset: {
            x: side === "browser" ? offset.x : spawn.offsetX,
            y: side === "browser" ? offset.y : spawn.offsetY,
        },
        rotation: spawn.rotation ?? 0,
        rotationSpace: enumToken(spawn.rotationSpace ?? "OWNER"),
    };
    return withoutNulls(normalized);
}

function normalizeState(contract, side) {
    const value = side === "browser" ? asObject(contract.state) : asObject(contract.initialState);
    const damageMultiplier = asObject(value.damageMultiplier);
    const multiplierFromOwner = side === "browser"
        ? damageMultiplier.context === "damageMultiplier"
            && damageMultiplier.fallback?.ownerStat === "attackDamageMultiplier"
        : Boolean(value.damageMultiplierFromOwner);
    const state = { damageMultiplierFromOwner: multiplierFromOwner };
    if (!state.damageMultiplierFromOwner) delete state.damageMultiplierFromOwner;
    return state;
}

function normalizeEffect(effect, side, phase) {
    const source = asObject(effect);
    const type = enumToken(source.type);
    const durationMs = source.durationMs ?? (side === "browser" ? source.delayMs : undefined);
    const collisionEvent = Object.entries(asObject(phase?.events))
        .find(([eventType]) => enumToken(eventType) === "COLLISION")?.[1];
    const continuouslyApplied = String(collisionEvent?.schedule?.mode ?? "").toUpperCase() === "CONTINUOUS";
    let effectiveMultiplier;
    if (type === "DAMAGE_REDUCTION" || type === "DAMAGE_REFLECTION") {
        effectiveMultiplier = side === "browser" ? source.multiplier ?? source.amount : source.amount;
    } else if (type === "BUFF") {
        effectiveMultiplier = side === "browser"
            ? source.multiplier ?? (1 - Number(source.amount ?? 0))
            : 1 - Number(source.amount ?? 0);
    }
    const presenceMode = side === "browser"
        ? Boolean(source.whileInside)
        : type === "STATUS" && isZero(durationMs) && continuouslyApplied;
    const normalized = {
        type,
        subtype: source.subtype ?? (side === "browser" ? source.buff : null),
        amount: source.amount,
        durationMs,
        effectiveMultiplier,
        whileInside: presenceMode,
        runtimeComputed: source.runtimeComputed,
        recipient: source.recipient,
        requiresConfirmedDamage: source.requiresConfirmedDamage,
        mirrorsDamage: source.mirrorsDamage,
        distanceMode: source.distanceMode,
        falloff: source.falloff,
        intervalMs: source.intervalMs,
        movementLockMs: source.movementLockMs,
        targetKinds: enumList(source.targetKinds),
    };
    if (isZero(normalized.amount)) delete normalized.amount;
    if (isZero(normalized.durationMs)) delete normalized.durationMs;
    if (isZero(normalized.effectiveMultiplier)) delete normalized.effectiveMultiplier;
    if (!normalized.whileInside) delete normalized.whileInside;
    // Java's runtimeComputed marker is an execution hint for the same shared
    // falloff payload; the browser computes it directly from that payload.
    delete normalized.runtimeComputed;
    if (normalized.requiresConfirmedDamage === false) delete normalized.requiresConfirmedDamage;
    if (normalized.mirrorsDamage === false) delete normalized.mirrorsDamage;
    return withoutNulls(normalized);
}

function normalizeEvent(event, side) {
    const source = asObject(event);
    const rawSchedule = asObject(source.schedule);
    const scheduleMode = String(rawSchedule.mode ?? "ONCE").toUpperCase();
    const schedule = { mode: scheduleMode };
    if (scheduleMode === "REPEAT") {
        if (rawSchedule.intervalMs != null) schedule.intervalMs = rawSchedule.intervalMs;
        if (rawSchedule.count != null) schedule.count = rawSchedule.count;
        schedule.startImmediately = rawSchedule.startImmediately ?? true;
    }
    const policy = asObject(source.targetPolicy);
    const targetPolicy = Object.keys(policy).length === 0 ? null : {
        mode: enumToken(policy.mode),
        intervalStat: policy.intervalStat ?? policy.interval ?? null,
        intervalMs: policy.intervalMs,
    };
    const actions = (source.actions ?? []).map(enumToken);
    const hasVisual = source.visualType != null;
    if (hasVisual && !actions.includes("EMIT_VISUAL")) {
        const removeAt = actions.indexOf("REMOVE");
        actions.splice(removeAt < 0 ? actions.length : removeAt, 0, "EMIT_VISUAL");
    }
    const normalized = {
        actions,
        transition: source.transition,
        schedule,
        visualType: source.visualType,
        visibleMs: source.visibleMs,
        visualSize: source.visualSize,
        targetPolicy,
        targetKinds: enumList(source.targetKinds),
        statusTypes: [...new Set(source.statusTypes ?? [])].map((item) => String(item).toLowerCase()).sort(),
        pullDirection: source.pullDirection,
        recheckCollisionOnTransition: source.recheckCollisionOnTransition,
    };
    // effectTypes is a derived compatibility projection; phase.effects is the
    // ordered payload source inspected by both executors.
    if (side === "browser") delete normalized.effectTypes;
    if (normalized.recheckCollisionOnTransition === true) delete normalized.recheckCollisionOnTransition;
    return withoutNulls(normalized);
}

function normalizePhase(phase, side) {
    const source = asObject(phase);
    const movement = asObject(source.movement);
    const hitbox = asObject(source.hitbox);
    const trigger = asObject(source.trigger);
    const health = asObject(source.health);
    const visual = asObject(source.visual);
    const execution = asObject(source.execution);
    const hit = asObject(source.hit);
    const orientation = asObject(source.orientation);
    const events = {};
    for (const [eventType, event] of Object.entries(asObject(source.events))) {
        events[enumToken(eventType)] = normalizeEvent(event, side);
    }
    const normalizedMovement = {
        speed: movement.speed,
        turnDegrees: movement.turnDegrees,
        size: movement.size,
        distance: movement.distance,
        trailMs: movement.trailMs,
        blockedByStatus: movement.blockedByStatus,
        direction: movement.direction,
    };
    for (const key of ["turnDegrees", "size"]) {
        if (isZero(normalizedMovement[key])) delete normalizedMovement[key];
    }
    const normalizedHitbox = {
        shape: hitbox.shape,
        radius: hitbox.radius,
        range: hitbox.range,
        arc: hitbox.arc,
        radiusMultiplier: hitbox.radiusMultiplier,
        width: hitbox.width,
        length: hitbox.length,
        includeTargetRadius: hitbox.includeTargetRadius,
    };
    if (normalizedHitbox.radiusMultiplier === 1) delete normalizedHitbox.radiusMultiplier;
    if (normalizedHitbox.includeTargetRadius === false) delete normalizedHitbox.includeTargetRadius;
    if (normalizedHitbox.shape === "ray" && normalizedHitbox.length === normalizedHitbox.range) delete normalizedHitbox.length;
    const normalizedHealth = {
        hp: health.hp,
        maxHp: health.maxHp,
        allowFriendlyDamage: health.allowFriendlyDamage,
    };
    if (normalizedHealth.allowFriendlyDamage === false) delete normalizedHealth.allowFriendlyDamage;
    const normalizedVisual = {
        type: visual.type,
        state: visual.state,
        visualSize: visual.visualSize,
        visibleMs: visual.visibleMs,
    };
    const normalizedExecution = {
        event: execution.event == null ? null : enumToken(execution.event),
        interval: execution.interval,
        intervalMs: execution.intervalMs,
        startImmediately: execution.startImmediately,
        abilityId: execution.abilityId,
    };
    const normalizedHit = { mode: hit.mode == null ? null : enumToken(hit.mode) };
    for (const key of ["attackHits", "projectileOverlap", "botContact", "chain"]) {
        if (trigger[key] === false) delete trigger[key];
    }
    const hasNonDefaultMovement = Object.entries(normalizedMovement)
        .some(([key, value]) => value != null && !(key === "speed" && isZero(value)));
    const activation = asObject(source.activation);
    const normalizedActivation = {};
    for (const [key, value] of Object.entries(activation)) {
        if (value == null || value === false) continue;
        normalizedActivation[key] = value;
    }
    const normalized = {
        id: source.id,
        type: enumToken(source.type),
        movement: hasNonDefaultMovement ? normalizedMovement : null,
        trigger: Object.keys(trigger).length ? trigger : null,
        hitbox: Object.keys(hitbox).length ? normalizedHitbox : null,
        health: Object.keys(health).length ? normalizedHealth : null,
        effects: (source.effects ?? []).map((item) => normalizeEffect(item, side, source)),
        visual: source.visual == null ? null : normalizedVisual,
        events,
        durationMs: source.durationMs,
        execution: Object.keys(execution).length ? normalizedExecution : null,
        transitionOnly: source.transitionOnly,
        skipOwner: source.skipOwner,
        hit: hit.mode == null ? null : normalizedHit,
        // The Java field mirrors visual.visibleMs for compatibility. The visual
        // payload is the shared contract, so compare its timing only there.
        statOverrides: source.statOverrides,
        effectOverrides: source.effectOverrides,
        startMs: source.startMs,
        orientation: Object.keys(orientation).length ? orientation : null,
    };
    if (normalized.transitionOnly === false) delete normalized.transitionOnly;
    if (normalized.skipOwner === false) delete normalized.skipOwner;
    if (isZero(normalized.startMs) || normalized.startMs === -1) delete normalized.startMs;
    return withoutNulls(normalized);
}

function normalizeEntityAbility(ability, side) {
    const source = asObject(ability);
    const spawn = asObject(source.spawn);
    const offset = asObject(spawn.offset);
    const normalizedSpawn = {
        offset: { x: side === "browser" ? offset.x : spawn.offsetX, y: side === "browser" ? offset.y : spawn.offsetY },
        rotation: spawn.rotation ?? 0,
        rotationSpace: enumToken(spawn.rotationSpace ?? "OWNER"),
    };
    return withoutNulls({
        id: source.id,
        spawn: normalizedSpawn,
        phases: (source.phases ?? []).map((item) => normalizePhase(item, side)),
    });
}

function normalizeActivation(value) {
    const normalized = {};
    for (const [key, item] of Object.entries(asObject(value))) {
        if (item == null || item === false) continue;
        normalized[key] = item;
    }
    return normalized;
}

export function normalizeContract(contract, side) {
    const source = asObject(contract);
    const rawLifetime = asObject(source.lifetime);
    const rawSpawn = asObject(source.spawn);
    const rawTargeting = asObject(source.targeting);
    const normalizedLifetime = {
        duration: rawLifetime.duration,
        add: rawLifetime.add,
    };
    if (isZero(normalizedLifetime.duration)) delete normalizedLifetime.duration;
    if (isZero(normalizedLifetime.add)) delete normalizedLifetime.add;
    const browserCapture = side === "browser" ? asObject(source.activation).capture : null;
    const activation = normalizeActivation(source.activation);
    if (browserCapture && Object.keys(browserCapture).length > 0) {
        activation.captureAtActivation = true;
        delete activation.capture;
    }
    const targeting = {
        owner: enumToken(side === "browser" ? rawTargeting.owner : source.selectableOwner),
    };
    const positionTargets = side === "browser"
        ? rawTargeting.position === "target"
        : Boolean(rawSpawn.targetPosition);
    if (positionTargets) {
        targeting.position = "target";
        const clampToRadius = side === "browser" ? rawTargeting.clampToRadius : rawSpawn.clampToRadius;
        const defaultX = side === "browser" ? rawTargeting.defaultX : rawSpawn.defaultX;
        const defaultY = side === "browser" ? rawTargeting.defaultY : rawSpawn.defaultY;
        if (clampToRadius != null && !isZero(clampToRadius)) targeting.clampToRadius = clampToRadius;
        if (defaultX != null) targeting.defaultX = defaultX;
        if (defaultY != null) targeting.defaultY = defaultY;
    }
    const normalized = {
        abilityId: source.abilityId,
        entityType: source.entityType,
        runtimeType: source.runtimeType,
        category: enumToken(source.category),
        spawn: normalizeSpawn(source, side),
        targeting,
        lifetime: normalizedLifetime,
        state: normalizeState(source, side),
        activation,
        phases: (source.phases ?? []).map((item) => normalizePhase(item, side)),
        abilities: (source.abilities ?? []).map((item) => normalizeEntityAbility(item, side)),
    };
    return withoutNulls(normalized);
}

function normalizeTiming(entry, side) {
    const source = asObject(entry);
    const resourceModel = side === "browser"
        ? source.resourceModel === "reload" ? "RELOAD_WHEN_EMPTY" : "NONE"
        : enumToken(source.resourceModel ?? "NONE");
    const normalized = {
        cooldownMs: source.cooldownMs,
        windupMs: source.windupMs,
        activeMs: source.activeMs,
        durationMs: source.durationMs,
        maxCharges: side === "browser" ? source.maxCharges : source.charges,
        reloadMs: side === "browser" ? source.reloadMs : source.rechargeMs,
        resourceModel,
    };
    for (const [key, value] of Object.entries(normalized)) {
        if (key !== "resourceModel" && isZero(value)) delete normalized[key];
    }
    if (normalized.resourceModel === "NONE") delete normalized.resourceModel;
    return withoutNulls(normalized);
}

function normalizeDerived(entry, side) {
    const source = asObject(entry);
    return withoutNulls({
        damage: source.damage ?? 0,
        range: source.range ?? 0,
        arc: source.arc ?? 0,
        falloff: source.falloff,
    });
}

function makeDiff(front, back, pathName, diffs) {
    if (diffs.length >= MAX_REPORTED_MISMATCHES) return;
    if (front === back) return;
    if (typeof front === "number" && typeof back === "number"
        && Math.abs(front - back) <= 1e-9) return;
    if (Array.isArray(front) || Array.isArray(back)) {
        if (!Array.isArray(front) || !Array.isArray(back)) {
            diffs.push({ path: pathName, browser: front ?? null, backend: back ?? null, kind: "type_mismatch" });
            return;
        }
        const comparableEnumList = /\.(targetKinds|statusTypes|effectTypes)$/.test(pathName);
        const left = comparableEnumList ? [...front].sort() : front;
        const right = comparableEnumList ? [...back].sort() : back;
        if (left.length !== right.length) {
            diffs.push({ path: pathName, browser: left, backend: right, kind: "length_mismatch" });
            return;
        }
        for (let index = 0; index < left.length; index += 1) {
            makeDiff(left[index], right[index], `${pathName}[${index}]`, diffs);
            if (diffs.length >= MAX_REPORTED_MISMATCHES) return;
        }
        return;
    }
    const leftObject = front && typeof front === "object";
    const rightObject = back && typeof back === "object";
    if (leftObject || rightObject) {
        if (!leftObject || !rightObject) {
            diffs.push({ path: pathName, browser: front ?? null, backend: back ?? null, kind: "type_mismatch" });
            return;
        }
        const keys = [...new Set([...Object.keys(front), ...Object.keys(back)])].sort();
        for (const key of keys) {
            if (!(key in front) || !(key in back)) {
                diffs.push({
                    path: pathName ? `${pathName}.${key}` : key,
                    browser: key in front ? front[key] : null,
                    backend: key in back ? back[key] : null,
                    kind: key in front ? "backend_missing" : "browser_missing",
                });
            } else {
                makeDiff(front[key], back[key], pathName ? `${pathName}.${key}` : key, diffs);
            }
            if (diffs.length >= MAX_REPORTED_MISMATCHES) return;
        }
        return;
    }
    diffs.push({ path: pathName, browser: front ?? null, backend: back ?? null, kind: "value_mismatch" });
}

const rawIdentity = (snapshot, id, side) => {
    const row = snapshot.registry?.[id];
    if (side === "browser") return row ? { id: Number(row.id), name: row.name } : null;
    return row == null ? null : { id: Number(id), name: row };
};

export function buildAbilityParityReport(browserSnapshot, backendSnapshot, abilityId = null) {
    const browserIds = Object.keys(browserSnapshot.registry ?? {}).map(Number);
    const backendIds = Object.keys(backendSnapshot.registry ?? {}).map(Number);
    const allIds = [...new Set([...browserIds, ...backendIds])].sort((a, b) => a - b);
    const requested = abilityId == null ? allIds : [Number(abilityId)];
    const mismatches = [];
    const checkedAbilities = [];
    const sectionCounts = { identity: 0, timing: 0, projectedValues: 0, contract: 0 };

    for (const id of requested) {
        const start = mismatches.length;
        const frontIdentity = rawIdentity(browserSnapshot, id, "browser");
        const backIdentity = rawIdentity(backendSnapshot, id, "backend");
        let before = mismatches.length;
        if (!frontIdentity && !backIdentity) {
            mismatches.push({ path: `abilities[${id}].identity`, browser: null, backend: null, kind: "missing_both" });
        } else {
            makeDiff(frontIdentity, backIdentity, `abilities[${id}].identity`, mismatches);
        }
        sectionCounts.identity += mismatches.length - before;

        const frontTiming = browserSnapshot.timing?.[id];
        const backTiming = backendSnapshot.timing?.[id];
        before = mismatches.length;
        if (frontIdentity || backIdentity) {
            makeDiff(
                frontTiming ? normalizeTiming(frontTiming, "browser") : null,
                backTiming ? normalizeTiming(backTiming, "backend") : null,
                `abilities[${id}].timing`,
                mismatches,
            );
            sectionCounts.timing += mismatches.length - before;

            before = mismatches.length;
            makeDiff(
                frontTiming ? normalizeDerived(frontTiming, "browser") : null,
                backTiming ? normalizeDerived(backTiming, "backend") : null,
                `abilities[${id}].projectedValues`,
                mismatches,
            );
            sectionCounts.projectedValues += mismatches.length - before;

            before = mismatches.length;
            const frontContract = browserSnapshot.contracts?.[id];
            const backContract = backendSnapshot.contracts?.[id];
            makeDiff(
                frontContract ? normalizeContract(frontContract, "browser") : null,
                backContract ? normalizeContract(backContract, "backend") : null,
                `abilities[${id}].contract`,
                mismatches,
            );
            sectionCounts.contract += mismatches.length - before;
        }
        checkedAbilities.push({ abilityId: id, mismatchCount: mismatches.length - start });
        if (mismatches.length >= MAX_REPORTED_MISMATCHES) break;
    }

    const totalMismatchCount = mismatches.length;
    const truncated = totalMismatchCount >= MAX_REPORTED_MISMATCHES;
    return {
        schemaVersion: 1,
        status: totalMismatchCount === 0 ? "pass" : "mismatch",
        scope: abilityId == null ? "catalog" : "ability",
        abilityId: abilityId == null ? null : Number(abilityId),
        checkedAbilityCount: checkedAbilities.length,
        checkedSections: ["identity", "timing", "projectedValues", "contract"],
        sectionMismatchCounts: sectionCounts,
        totalMismatchCount,
        truncated,
        mismatches,
        checkedAbilities,
        coverage: {
            browserRuntime: "AbilityRegistry, abilityStats, BotLoadout metadata, and ABILITY_CONTRACTS",
            backendRuntime: "AbilityRegistry.all, Abilities.CATALOG, and AbilityContracts.all",
            browserCatalogMetadataCompared: false,
            backendValidationAndLoadoutPolicyCompared: false,
            notes: [
                "The report compares runtime identity, timing/resources, compatibility projections, and normalized phase contracts.",
                "Browser loadout round, summary, tags, and interpolation are returned by get_ability_catalog but have no single mirrored backend catalog record.",
                "Backend lifetime timerMode, initial armed flag, phase hit compatibility flags, event effectTypes, and runtimeComputed are representation fields. Browser and Java target-position defaults, clamp radii, and owner targeting are compared.",
                "This is a metadata parity check. It does not execute combat or prove collision/effect runtime behavior equivalent.",
            ],
        },
        sourceFiles: [
            "frontend/src/gameArena/gameconfig/AbilityRegistry.js",
            "frontend/src/gameArena/gameconfig/Abilities.js",
            "frontend/src/gameArena/loadout/BotLoadout.js",
            "frontend/src/gameArena/ecs/contracts/AbilityContracts.js",
            "server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityRegistry.java",
            "server/src/main/java/com/example/botfight/simulation/gameconfig/Abilities.java",
            "server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java",
        ],
    };
}

export function catalogRows(browserSnapshot, backendSnapshot, { includeContracts = false, savedSpecs = [] } = {}) {
    const ids = [...new Set([
        ...Object.keys(browserSnapshot.registry ?? {}).map(Number),
        ...Object.keys(backendSnapshot.registry ?? {}).map(Number),
    ])].sort((a, b) => a - b);
    const abilities = ids.map((id) => {
        const browserIdentity = browserSnapshot.registry?.[id] ?? null;
        const backendName = backendSnapshot.registry?.[id] ?? null;
        const browserContract = browserSnapshot.contracts?.[id] ?? null;
        const browserTiming = browserSnapshot.timing?.[id] ?? null;
        const loadout = browserSnapshot.loadout?.[id] ?? null;
        const result = {
            abilityId: id,
            slug: browserIdentity?.name ?? backendName ?? null,
            label: browserIdentity?.label ?? null,
            category: browserContract?.category ?? null,
            phaseCount: browserContract?.phases?.length ?? 0,
            phaseIds: (browserContract?.phases ?? []).map(({ id: phaseId }) => phaseId),
            cooldownMs: browserTiming?.cooldownMs ?? null,
            windupMs: browserTiming?.windupMs ?? null,
            activeMs: browserTiming?.activeMs ?? null,
            durationMs: browserTiming?.durationMs ?? null,
            charges: browserTiming?.maxCharges ?? 0,
            reloadMs: browserTiming?.reloadMs ?? 0,
            round: loadout?.round ?? null,
            standard: Boolean(loadout?.standard),
            visualInterpolation: loadout?.visualInterpolation ?? null,
            summary: loadout?.summary ?? null,
            registryParity: browserIdentity?.name === backendName,
        };
        if (includeContracts) result.browserContract = browserContract;
        return result;
    });
    const reservedIds = savedSpecs.map((row) => Number(row.abilityId)).filter(Number.isSafeInteger);
    const nextId = Math.max(0, ...ids, ...reservedIds) + 1;
    return {
        schemaVersion: 1,
        abilityCount: abilities.length,
        suggestedNextAbilityId: nextId,
        savedSpecCount: savedSpecs.length,
        idsArePermanent: true,
        abilities,
    };
}
