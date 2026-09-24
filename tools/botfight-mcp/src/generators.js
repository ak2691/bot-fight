const jsString = (value) => JSON.stringify(value);
const jsLiteral = (value, indent = 0) => {
    const spaces = " ".repeat(indent);
    const nextSpaces = " ".repeat(indent + 4);
    if (Array.isArray(value)) {
        if (!value.length) return "[]";
        return `[\n${value.map((item) => `${nextSpaces}${jsLiteral(item, indent + 4)}`).join(",\n")}\n${spaces}]`;
    }
    if (value && typeof value === "object") {
        const entries = Object.entries(value);
        if (!entries.length) return "{}";
        return `{\n${entries.map(([key, item]) => `${nextSpaces}${/^[A-Za-z_$][A-Za-z0-9_$]*$/.test(key) ? key : jsString(key)}: ${jsLiteral(item, indent + 4)}`).join(",\n")}\n${spaces}}`;
    }
    return jsString(value);
};

const snake = (value) => String(value)
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toUpperCase();
const javaEnum = (type, value) => value == null ? "null" : `${type}.${snake(value)}`;
const javaString = (value) => value == null ? "null" : JSON.stringify(value);
const javaNumber = (value) => value == null ? "null" : Number.isInteger(value) ? `${value}.0` : `${value}d`;
const javaInt = (value) => value == null ? "null" : `${Math.trunc(value)}`;
const javaBool = (value, fallback = false) => value == null ? `${fallback}` : `${value}`;
const javaList = (items, render) => !items?.length ? "List.of()" : `List.of(${items.map(render).join(", ")})`;
const javaSet = (items, render) => !items?.length ? "Set.of()" : `Set.of(${items.map(render).join(", ")})`;
const javaMap = (entries, render) => {
    const pairs = Object.entries(entries ?? {});
    if (!pairs.length) return "Map.of()";
    return `Map.ofEntries(${pairs.map(([key, value]) => `Map.entry(${javaString(key)}, ${render(value)})`).join(", ")})`;
};

function javaFalloff(value) {
    if (!value) return "null";
    return `new Falloff(${javaNumber(value.minAmount)}, ${javaNumber(value.maxAmount)}, ${javaInt(value.minDurationMs)}, ${javaInt(value.maxDurationMs)}, ${javaNumber(value.falloffStart)}, ${javaNumber(value.falloffEnd)})`;
}

function javaEffect(value) {
    return `new Effect(${javaEnum("EffectType", value.type)}, ${javaString(value.subtype)}, ${javaNumber(value.amount ?? 0)}, ${value.durationMs ?? 0}, ${javaBool(value.runtimeComputed)}, ${javaString(value.recipient)}, ${javaBool(value.requiresConfirmedDamage)}, ${javaBool(value.mirrorsDamage)}, ${javaString(value.distanceMode)}, ${javaFalloff(value.falloff)}, ${javaInt(value.intervalMs)}, ${javaInt(value.movementLockMs)}, ${javaList(value.targetKinds, (item) => javaEnum("TargetKind", item))})`;
}

function javaSpawn(value, targeting = {}) {
    const spawn = value ?? {};
    const offset = spawn.offset ?? {};
    const fallbackX = typeof targeting.defaultX === "number" ? targeting.defaultX : 500;
    const fallbackY = typeof targeting.defaultY === "number" ? targeting.defaultY : 400;
    return `new Spawn(${javaNumber(offset.x ?? 0)}, ${javaNumber(offset.y ?? 0)}, ${targeting.position === "target"}, ${javaNumber(spawn.rotation ?? 0)}, ${javaEnum("RotationSpace", spawn.rotationSpace ?? "owner")}, ${javaNumber(targeting.clampToRadius ?? 0)}, ${javaNumber(fallbackX)}, ${javaNumber(fallbackY)})`;
}

function javaMovement(value) {
    if (!value) return "null";
    return `new PhaseMovement(${javaNumber(value.speed ?? 0)}, ${javaNumber(value.turnDegrees ?? 0)}, ${javaNumber(value.size ?? 0)}, ${javaNumber(value.distance)}, ${javaInt(value.trailMs)}, ${javaString(value.blockedByStatus)}, ${javaString(value.direction)})`;
}

function javaTrigger(value) {
    if (!value) return "null";
    return `new Trigger(${javaNumber(value.radius)}, ${javaInt(value.lifetimeMs)}, ${javaBool(value.attackHits)}, ${javaBool(value.projectileOverlap)}, ${javaBool(value.botContact)}, ${javaBool(value.chain)})`;
}

function javaHitbox(value) {
    if (!value) return "null";
    return `new Hitbox(${javaString(value.shape)}, ${javaNumber(value.radius)}, ${javaNumber(value.range)}, ${javaNumber(value.arc)}, ${javaNumber(value.radiusMultiplier ?? 1)}, ${javaNumber(value.width)}, ${javaNumber(value.length)}, ${javaBool(value.includeTargetRadius)})`;
}

function javaHealth(value) {
    if (!value) return "null";
    return `new Health(${javaNumber(value.hp)}, ${javaNumber(value.maxHp)}, ${javaBool(value.allowFriendlyDamage)})`;
}

function javaVisual(value) {
    if (!value) return "null";
    return `new Visual(${javaString(value.type)}, ${javaString(value.state)}, ${javaNumber(value.visualSize)}, ${javaInt(value.visibleMs)})`;
}

function javaSchedule(value) {
    if (!value) return "null";
    return `new EventSchedule(${javaEnum("EventScheduleMode", value.mode)}, ${javaInt(value.intervalMs)}, ${javaBool(value.startImmediately, true)}, ${javaInt(value.count)})`;
}

function javaTargetPolicy(value) {
    if (!value) return "null";
    return `new TargetPolicy(${javaEnum("TargetPolicyMode", value.mode)}, ${javaString(value.intervalStat ?? value.interval)}, ${javaInt(value.intervalMs)})`;
}

function javaEvent(value) {
    const transition = value.transition ? `new Transition(${javaString(value.transition.to)})` : "null";
    return `new PhaseEvent(${javaList(value.actions, (item) => javaEnum("PhaseAction", item))}, ${javaSet(value.effectTypes, (item) => javaEnum("EffectType", item))}, ${transition}, ${javaSchedule(value.schedule)}, ${javaString(value.visualType)}, ${javaInt(value.visibleMs)}, ${javaNumber(value.visualSize)}, ${javaTargetPolicy(value.targetPolicy)}, ${javaList(value.targetKinds, (item) => javaEnum("TargetKind", item))}, ${javaSet(value.statusTypes, javaString)}, ${javaString(value.pullDirection)}, ${javaBool(value.recheckCollisionOnTransition, true)})`;
}

function javaExecution(value) {
    if (!value) return "null";
    return `new Execution(${javaEnum("PhaseEventType", value.event)}, ${javaString(value.interval)}, ${javaInt(value.intervalMs)}, ${javaBool(value.startImmediately, true)}, ${javaString(value.abilityId)})`;
}

function javaHit(value) {
    if (!value) return "null";
    return `new Hit(${javaEnum("HitMode", value.mode)}, ${javaBool(value.removeOnHit)}, ${javaBool(value.oncePerTarget)}, ${javaString(value.knockbackDirection)})`;
}

function javaPhaseOrientation(value) {
    if (!value) return "null";
    return `new PhaseOrientation(${javaString(value.mode)}, ${javaString(value.targetSource)})`;
}

function javaPhase(value) {
    const eventMap = Object.fromEntries(Object.entries(value.events ?? {}).map(([key, item]) => [snake(key), item]));
    const effects = value.effects ?? [];
    const effectOverrides = Object.fromEntries(Object.entries(value.effectOverrides ?? {}).map(([key, override]) => [key,
        `new EffectOverride(${javaNumber(override.amount)}, ${javaInt(override.durationMs)}, ${javaFalloff(override.falloff)})`,
    ]));
    const phaseEvents = Object.keys(eventMap).length
        ? `Map.ofEntries(${Object.entries(eventMap).map(([key, event]) => `Map.entry(${javaEnum("PhaseEventType", key)}, ${javaEvent(event)})`).join(", ")})`
        : "Map.of()";
    return `new AbilityPhase(${javaString(value.id)}, ${javaEnum("PhaseType", value.type)}, ${javaMovement(value.movement)}, ${javaTrigger(value.trigger)}, ${javaHitbox(value.hitbox)}, ${javaHealth(value.health)}, ${javaList(effects, javaEffect)}, ${javaVisual(value.visual)}, ${phaseEvents}, ${javaInt(value.durationMs)}, ${javaExecution(value.execution)}, ${javaBool(value.transitionOnly)}, ${javaBool(value.skipOwner)}, ${javaHit(value.hit)}, ${javaInt(value.visibleMs)}, ${javaMap(value.statOverrides, javaNumber)}, ${javaMap(effectOverrides, (item) => item)}, ${value.startMs ?? 0}, ${javaPhaseOrientation(value.orientation)})`;
}

function javaEntityAbility(value) {
    return `new EntityAbility(${javaString(value.id)}, ${javaSpawn(value.spawn)}, ${javaList(value.phases, javaPhase)})`;
}

function javaContract(spec) {
    const { contract, category } = spec;
    const isAttached = category === "botAttached";
    const owner = contract.targeting.owner === "none" ? "NONE" : "OWNER";
    const lifetime = contract.lifetime ?? {};
    const mode = lifetime.timerMode ?? (isAttached ? "NONE" : "AGE");
    const state = contract.state ?? {};
    const damageMultiplierFromOwner = state.damageMultiplier?.context === "damageMultiplier"
        && state.damageMultiplier?.fallback?.ownerStat === "attackDamageMultiplier";
    const activation = contract.activation ?? {};
    return `new AbilityContract(${spec.abilityId}, ${javaString(contract.entityType)}, ${javaString(contract.runtimeType)}, ${javaEnum("Category", category)}, ${javaSpawn(contract.spawn, contract.targeting)}, SelectableOwner.${owner}, new Lifetime(${javaEnum("TimerMode", mode)}, ${lifetime.duration ?? 0}, ${lifetime.add ?? 0}), new InitialState(${javaBool(state.armed)}, ${damageMultiplierFromOwner}), new Activation(${javaString(activation.targetMode)}, ${javaBool(activation.captureAtActivation)}, ${javaString(activation.phaseFacingDefault)}, ${javaBool(activation.ignoresGlobalAbilityLock)}, ${javaBool(activation.teleportOncePerActivation)}), ${javaList(contract.phases, javaPhase)}, ${javaList(contract.abilities, javaEntityAbility)})`;
}

function browserContractEntry(spec) {
    const { contract, category, abilityId } = spec;
    const browserPhase = (phase) => {
        const value = structuredClone(phase);
        value.effects = (value.effects ?? []).map((effect) => {
            const next = { ...effect };
            if (effect.type === "buff" && effect.subtype != null) {
                next.buff = effect.subtype;
                delete next.subtype;
            }
            if (effect.type === "restore_state" && effect.durationMs != null) {
                next.delayMs = effect.durationMs;
                delete next.durationMs;
            }
            return next;
        });
        return value;
    };
    const phaseCalls = (phases, indent = 8) => phases.map((phase) => `${" ".repeat(indent)}phase(${jsLiteral(browserPhase(phase), indent)}),`).join("\n");
    if (category === "botAttached") {
        return `${abilityId}: attachedAbility({\n    activation: ${jsLiteral(contract.activation ?? {}, 4)},\n    spawn: ${jsLiteral(contract.spawn, 4)},\n    phase: phase(${jsLiteral(browserPhase(contract.phases[0]), 4)}),\n}),`;
    }
    const embedded = (contract.abilities ?? []).map((ability) => `        entityAbility(${jsString(ability.id)}, {\n            spawn: ${jsLiteral(ability.spawn, 12)},\n            phases: [\n${phaseCalls(ability.phases, 16)}\n            ],\n        }),`).join("\n");
    const fields = [
        `        entityType: ${jsString(contract.entityType)},`,
        `        runtimeType: ${jsString(contract.runtimeType)},`,
        `        category: ${jsString(category)},`,
        `        spawn: ${jsLiteral(contract.spawn, 8)},`,
        `        targeting: ${jsLiteral(contract.targeting, 8)},`,
        `        lifetime: ${jsLiteral(contract.lifetime, 8)},`,
        `        state: ${jsLiteral(contract.state, 8)},`,
        `        activation: ${jsLiteral(contract.activation, 8)},`,
        `        phases: [\n${phaseCalls(contract.phases, 12)}\n        ],`,
        `        abilities: [${embedded ? `\n${embedded}\n        ` : ""}],`,
    ].join("\n");
    return `${abilityId}: entity(${abilityId}, {\n${fields}\n    }),`;
}

function sourceSnippets(spec) {
    const { abilityId, id, name, label, round, summary, visualInterpolation, timing, category } = spec;
    const browserResourceModel = timing.resourceModel === "RELOAD_WHEN_EMPTY" ? "reload" : undefined;
    const browserTiming = {
        ...(timing.maxCharges > 0 ? { maxCharges: timing.maxCharges } : {}),
        ...(timing.maxCharges > 0 ? { resourceModel: browserResourceModel, chargeType: "ammunition" } : {}),
        ...(timing.reloadMs > 0 ? { reloadMs: timing.reloadMs } : {}),
        ...(timing.cooldownMs > 0 ? { cooldownMs: timing.cooldownMs } : {}),
        ...(timing.windupMs > 0 ? { windupMs: timing.windupMs } : {}),
        ...(timing.activeMs > 0 ? { activeMs: timing.activeMs } : {}),
        ...(timing.durationMs > 0 ? { durationMs: timing.durationMs } : {}),
    };
    const backendResource = timing.resourceModel;
    const backendTiming = `Map.entry(${abilityId}, timing(${timing.cooldownMs}, ${timing.windupMs}, ${timing.activeMs}, ${timing.durationMs}${timing.maxCharges > 0 ? `, ${timing.maxCharges}, ${timing.reloadMs}, ResourceModel.${backendResource}` : ""}))`;
    const notes = [
        "Add the ability to the authoritative allowed-loadout/action rules and round-offer metadata; the generated snippets do not edit validators or policy code.",
        "Add any required action payload, targeting, status, visual asset/renderer, replay, or effect-system extension. The declarative contract cannot implement a new runtime behavior by itself.",
        "Preserve ID permanence. The assigned abilityId is selected from the maximum runtime or saved spec ID plus one; never reuse a gap.",
    ];
    const customMappings = [];
    if (contractHasSymbolicTargetDefault(spec.contract)) {
        customMappings.push("Browser spawn fallback uses owner.x/owner.y, while the Java Spawn record stores numeric defaults (500/400); implement the matching authoritative fallback if that symbolic behavior is required.");
    }
    if (contractHasPresenceEffect(spec.contract)) {
        customMappings.push("A whileInside status has no dedicated Java Effect field. Verify that the phase's continuous event and status lifecycle implement presence semantics on both runtimes.");
    }
    if (spec.contract.activation?.capture) {
        customMappings.push("Browser activation.capture values have no matching Java Activation fields; add the authoritative capture payload/logic for these keys.");
    }
    if (contractHasUnrepresentableMultiplier(spec.contract)) {
        customMappings.push("Java Effect stores amount but not the browser multiplier override; add the matching server behavior or align multiplier with the Java-derived amount semantics.");
    }
    notes.push(...customMappings);
    return {
        browser: {
            "frontend/src/gameArena/gameconfig/AbilityRegistry.js": `${abilityId}: Object.freeze({ id: ${abilityId}, name: ${jsString(id)}, label: ${jsString(label)}, type: "ability" }),`,
            "frontend/src/gameArena/gameconfig/Abilities.js": `${abilityId}: ${jsLiteral(browserTiming, 4)},`,
            "frontend/src/gameArena/loadout/BotLoadout.js": `{ id: ${abilityId}, round: ${round}, visualInterpolation: ${jsString(visualInterpolation)},${round === 0 ? " standard: true," : ""} summary: ${jsString(summary)} },`,
            "frontend/src/gameArena/ecs/contracts/AbilityContracts.js": browserContractEntry(spec),
        },
        backend: {
            "server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityRegistry.java": `register(names, ${abilityId}, ${javaString(id)});`,
            "server/src/main/java/com/example/botfight/simulation/gameconfig/Abilities.java": backendTiming,
            "server/src/main/java/com/example/botfight/simulation/ecs/contracts/AbilityContracts.java": `contracts.put(${abilityId}, ${javaContract(spec)});`,
        },
        placement: {
            browserContracts: category === "botAttached"
                ? "RAW_ATTACHED_ABILITY_CONTRACTS_BY_ID"
                : "ENTITY_CONTRACTS",
            backendContracts: category === "botAttached" ? "attachedCatalog()" : "entityCatalog()",
            timing: "Add the map entry to ABILITY_TIMING_BY_ID and TIMING_CATALOG; the server AbilityDefinition is derived.",
            additionalIntegration: notes,
        },
    };
}

export function generateAbilityScaffold(spec) {
    const customExtension = Boolean(spec.implementationNotes.browser || spec.implementationNotes.backend || spec.implementationNotes.visual)
        || contractHasSymbolicTargetDefault(spec.contract)
        || contractHasPresenceEffect(spec.contract)
        || Boolean(spec.contract.activation?.capture)
        || contractHasUnrepresentableMultiplier(spec.contract);
    return {
        generatorVersion: 1,
        abilityId: spec.abilityId,
        slug: spec.id,
        canonicalSpec: spec,
        generatedSnippets: sourceSnippets(spec),
        extensionPoints: {
            implementationNotes: spec.implementationNotes,
            customBehaviorRequired: customExtension,
            notes: [
                "These deterministic snippets fill identity, timing, loadout metadata, and declarative phase contract boilerplate.",
                "They are insertable source fragments, not a direct patch to gameplay files. Extend generic ECS/effect/render/replay systems when the spec needs behavior unsupported by current contract types.",
                "After applying the fragments and any custom implementation, run check_ability_parity to get a field-level browser/backend report.",
            ],
        },
    };
}

function allEffects(contract) {
    return (contract.phases ?? []).flatMap((phase) => phase.effects ?? [])
        .concat((contract.abilities ?? []).flatMap((ability) => (ability.phases ?? []).flatMap((phase) => phase.effects ?? [])));
}

function contractHasSymbolicTargetDefault(contract) {
    return [contract.targeting?.defaultX, contract.targeting?.defaultY].some((value) => typeof value === "string");
}

function contractHasPresenceEffect(contract) {
    return allEffects(contract).some((effect) => effect.type === "status" && effect.whileInside === true);
}

function contractHasUnrepresentableMultiplier(contract) {
    return allEffects(contract).some((effect) => {
        if (effect.multiplier == null) return false;
        const expected = effect.type === "buff" ? 1 - Number(effect.amount ?? 0) : Number(effect.amount ?? 0);
        return Math.abs(Number(effect.multiplier) - expected) > 1e-9;
    });
}
