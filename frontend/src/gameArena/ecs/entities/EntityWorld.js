/**
 * Runs deterministic entity systems in declaration order. A system receives the
 * complete immutable stage result and returns only the fields it changed.
 */
export function runEntityWorld(initialWorld, systems) {
    return systems.reduce((world, system) => {
        const result = system(world);
        return result ? { ...world, ...result } : world;
    }, initialWorld);
}

/** Keeps the component view and the replay-compatible flat fields aligned. */
export function withComponentState(entity, changes) {
    const next = { ...entity, ...changes };
    return {
        ...next,
        components: {
            ...next.components,
            transform: {
                ...next.components?.transform,
                x: next.x,
                y: next.y,
                rotation: next.rotation ?? 0,
            },
            collider: {
                ...next.components?.collider,
                size: next.size ?? 0,
            },
            motion: {
                ...next.components?.motion,
                x: next.velocityX ?? 0,
                y: next.velocityY ?? 0,
                traveled: next.traveled ?? 0,
            },
            lifetime: {
                ...next.components?.lifetime,
                ageMs: next.ageMs ?? 0,
                remainingMs: next.remainingMs ?? null,
            },
            ...(next.hp == null ? {} : {
                health: {
                    ...next.components?.health,
                    hp: next.hp,
                    maxHp: next.maxHp ?? next.hp,
                },
            }),
        },
    };
}

/** Advances the standalone lifetime age without changing any other timer. */
export function advanceEntityAge(entity, stepMs) {
    const ageMs = Math.max(0, Number(entity.ageMs ?? 0)) + Math.max(0, Number(stepMs ?? 0));
    return withComponentState(entity, { ageMs });
}

export function lifetimeSystem(stepMs) {
    return (world) => ({
        entities: world.entities
            .map((entity) => {
                const aged = advanceEntityAge(entity, stepMs);
                return aged.remainingMs == null
                    ? aged
                    : withComponentState(aged, { remainingMs: Number(aged.remainingMs) - stepMs });
            })
            .filter((entity) => entity.remainingMs == null || entity.remainingMs > 0),
    });
}

export function movementSystem({ width, height }) {
    return (world) => ({
        entities: world.entities.map((entity) => {
            if (!Number(entity.velocityX) && !Number(entity.velocityY)) return entity;
            const radius = Number(entity.size ?? 0) / 2;
            const x = clamp(Number(entity.x) + Number(entity.velocityX ?? 0), radius, width - radius);
            const y = clamp(Number(entity.y) + Number(entity.velocityY ?? 0), radius, height - radius);
            return {
                ...entity,
                x,
                y,
                traveled: Number(entity.traveled ?? 0) + Math.hypot(x - Number(entity.x), y - Number(entity.y)),
            };
        }),
    });
}

export function systemForTypes(types, update) {
    const accepted = new Set(types);
    return (world) => {
        let bots = world.bots;
        const entities = [];
        for (const entity of world.entities) {
            if (!accepted.has(entity.type)) {
                entities.push(entity);
                continue;
            }
            const result = update(entity, { ...world, bots });
            if (result?.bots) bots = result.bots;
            if (result?.entity) entities.push(result.entity);
            else if (result == null) entities.push(entity);
        }
        return { entities, bots };
    };
}

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}
