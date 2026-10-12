/**
 * The gameplay vocabulary: the closed sets of names that abilities.json, statuses.json and the engine use.
 * No imports, so the data validator (gameconfig/gameplayValidation.js) can use it without an import cycle
 * with ecs/contracts. The contract modules re-export these names, so existing importers do not change.
 */
export const ENTITY_CATEGORIES = Object.freeze({
    PROJECTILE: "projectile",
    ZONE: "zone",
    TRAP: "trap",
    SUMMON: "summon",
    /** Part of the bot's own attack: it follows the owner and keeps time (see docs/ABILITIES.md, "Attached entities"). */
    ATTACHED: "attached",
});

/** Effect vocabulary. Concrete effect payloads live on the verbs that apply them. */
export const EFFECT_TYPES = Object.freeze({
    DAMAGE: "damage",
    DISPLACE: "displace",
    HEALING: "healing",
    STATUS: "status",
    REMOVE_STATUS: "remove_status",
    RESTORE_STATE: "restore_state",
});

/**
 * A `when` check's measure (an effect's conditions, see docs/ABILITIES.md). `hpRatio`, `distance` and `hasStatus` read
 * a number or a preset name and take `op` and `value`; the rest are true or false and take neither.
 */
export const CONDITION_MEASURES = Object.freeze({
    HP_RATIO: "hpRatio",
    DISTANCE: "distance",
    HAS_STATUS: "hasStatus",
    WINDING_UP: "windingUp",
    FROM_BEHIND: "fromBehind",
    DAMAGE_CONFIRMED: "damageConfirmed",
});

/** The operators of a numeric `when` check. */
export const CONDITION_OPS = Object.freeze({
    LESS: "<",
    LESS_OR_EQUAL: "<=",
    GREATER: ">",
    GREATER_OR_EQUAL: ">=",
});

/** A `displace` effect's `who`: the combatant that moves. `owner` is allowed only in an activation. */
export const DISPLACE_WHO = Object.freeze({
    TARGET: "target",
    OWNER: "owner",
});

/** A `displace` effect's `from`: the point the mover goes away from, toward, or past. */
export const DISPLACE_FROM = Object.freeze({
    SOURCE: "source",
    OWNER: "owner",
    TARGET: "target",
});

/** A `displace` effect's `direction`. `mirror` lands as far past `from` as the mover stood from it. */
export const DISPLACE_DIRECTION = Object.freeze({
    AWAY: "away",
    TOWARD: "toward",
    MIRROR: "mirror",
});

/** Phase host vocabulary of entity phases. */
export const PHASE_TYPES = Object.freeze({
    PROJECTILE: "projectile",
    ZONE: "zone",
    SUMMON: "summon",
});

export const PHASE_EVENT_TYPES = Object.freeze({
    COLLISION: "collision",
    TRIGGER: "trigger",
    HIT: "hit",
    KILLED: "killed",
    LIFETIME_END: "lifetimeEnd",
    SCHEDULE: "schedule",
});

/** Determines when any phase event is evaluated. */
export const EVENT_SCHEDULE_MODES = Object.freeze({
    ONCE: "once",
    REPEAT: "repeat",
    CONTINUOUS: "continuous",
});

/** The verbs of `onActivate` lists and entity event `do` lists. */
export const VERBS = Object.freeze({
    HIT: "hit",
    SPAWN: "spawn",
    MOVE: "move",
    APPLY_EFFECTS: "applyEffects",
    TRANSITION: "transition",
    REMOVE: "remove",
    EMIT_VISUAL: "emitVisual",
});

export const MOVEMENT_MODES = Object.freeze({
    STRAIGHT: "straight",
    STATIC: "static",
    SEEK: "seek",
    FOLLOW_OWNER: "followOwner",
});

/** A `seek` movement's `target`: the nearest living enemy (the default), or the owner (a boomerang's return). */
export const SEEK_TARGETS = Object.freeze({
    NEAREST_ENEMY: "nearestEnemy",
    OWNER: "owner",
});

export const SPAWN_PATTERN_TYPES = Object.freeze({
    FAN: "fan",
    RING: "ring",
    LINE: "line",
});

export const TARGET_POLICY_MODES = Object.freeze({
    ONCE: "once",
    EVERY_TICK: "everyTick",
    INTERVAL: "interval",
});

/**
 * How long a targetPolicy's "already hit" memory lasts. `phase` (the default) resets when the entity changes phase,
 * `entity` never resets, and `activation` is one memory per cast, shared by the cast's hits and the entities it made.
 */
export const TARGET_POLICY_SCOPES = Object.freeze({
    PHASE: "phase",
    ENTITY: "entity",
    ACTIVATION: "activation",
});

/** Semantic target categories used by verbs and entity collision events. */
export const TARGET_KINDS = Object.freeze({
    BOT: "BOT",
    HP_ENTITY: "HP_ENTITY",
    SUMMON: "SUMMON",
    ENTITY: "ENTITY",
});

/** A verb's `targets` list names this to apply to the bot that owns the ability instead of to hit targets. */
export const OWNER_TARGET = "OWNER";

/**
 * A status preset's reaction events (`on.hit`, `on.hitDealt`): run when an attack lands damage on the holder (hit) or
 * when the holder's attack lands damage on another bot (hitDealt). Each names who it acts on, how many charges it
 * spends and which attacks count.
 */
export const STATUS_REACTION_EVENTS = Object.freeze({
    HIT: "hit",
    HIT_DEALT: "hitDealt",
});

/** A reaction event's `target`: the status holder (default) or the bot that owns the attack. */
export const REACTION_TARGETS = Object.freeze({ HOLDER: "holder", ATTACKER: "attacker" });

/** The token a reaction's amount reads: the raw damage of the attack that triggered it. */
export const HIT_AMOUNT_TOKEN = "$hitAmount";

/** Generic, allowlisted status-effect component vocabulary. */
export const STATUS_EFFECT_APPLICATIONS = Object.freeze({
    DAMAGE: "damage",
    MODIFIER: "modifier",
    DAMAGE_IMMUNITY: "damage_immunity",
    STUN: "stun",
    BLOCK: "block",
    MOVEMENT_LOCK: "movement_lock",
});

/** The stats a `modifier` effect scales. Each one is read by one function (StatusContracts.modifierFor). */
export const MODIFIER_STATS = Object.freeze({
    INCOMING_DAMAGE: "incomingDamage",
    OUTGOING_DAMAGE: "outgoingDamage",
    MOVE_SPEED: "moveSpeed",
    TURN_SPEED: "turnSpeed",
    COOLDOWN: "cooldown",
    STAMINA_COST: "staminaCost",
});

/** How the active modifiers of one stat combine: "multiply" = the product of all, "strongest" = the smallest wins. */
export const MODIFIER_STACKING = Object.freeze({
    incomingDamage: "multiply",
    outgoingDamage: "multiply",
    staminaCost: "multiply",
    moveSpeed: "strongest",
    turnSpeed: "strongest",
    cooldown: "strongest",
});

/** What a `block` status effect can stop: a channel's abilities, or one of a bot's movement actions. */
export const BLOCK_ACTIONS = Object.freeze(["ability", "dash", "move", "sprint", "fastTurn"]);
