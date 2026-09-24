# Bot Fight ability authoring MCP

This local stdio MCP keeps ability authoring tied to the current game contracts. It reads the live browser modules and compiled Java runtime, validates canonical AbilitySpec data, and emits deterministic source fragments for both runtimes.

The MCP handles permanent IDs, catalog/timing boilerplate, normalized phases, effect/event formatting, hitbox/target fields, and paired Java/browser constructors. It returns custom simulation, renderer, loadout-policy, and replay extension points for the coding agent to implement. Generated fragments are reviewable output; the MCP does not silently edit live gameplay files.

## Connect it

The project MCP entry is in .codex/config.toml. It runs node tools/botfight-mcp/src/server.js from the repository root. Restart Codex after adding or changing the project MCP configuration.

The server needs Node.js, Java 21, and the repository Maven wrapper. The Java read-only snapshot is compiled and invoked on parity/catalog calls. No game database or Spring application startup is needed.

## Tool capabilities

### get_ability_catalog

Returns permanent ability IDs and slugs from both runtime registries, browser label/category, phase IDs/count, cooldown/windup/active/duration, charge and reload values, draft round, standard status, interpolation mode, and summary. It reports the next candidate ID as max(runtime IDs, saved spec IDs) + 1 and returns the count of saved specs.

- includeContracts: true adds raw browser phase contracts to each row.
- includeParity: true adds the full field mismatch list and coverage notes.

### get_ability_contract

For one numeric ability ID, returns raw browser identity, loadout metadata, timing/projection, normalized contract, backend identity, timing/projection, contract, and the field-by-field parity result for that ID.

### get_ability_authoring_guide

Loads the current repository rules for add or edit from the ability guides, effect contract, visual/combat regression checklist, and frontend/server context maps. The default response contains relevant sections; includeFullSourceDocs: true returns full source documents. It includes the authoring flow, constraints, and source paths.

### list_ability_specs

Lists saved MCP-authored specs/<slug>.json files and their assigned IDs. A saved spec is the authoring record; game runtimes do not load it until its generated source fragments are integrated.

### add_ability

Accepts one structured AbilitySpec. It:

1. rejects unsupported fields, types, categories, phase/event/effect enums, invalid geometry, missing event targets, invalid transitions, and malformed schedules/visual timings;
2. assigns the next unused permanent numeric ID and rejects duplicate slugs;
3. saves the canonical spec under tools/botfight-mcp/specs/;
4. returns paired browser and Java snippets for identity, timing/resources, loadout metadata, and ability contracts, plus exact insertion points and implementation extension points.

The assigned ID is reserved by the saved spec, even before its runtime entries are integrated. IDs are not reused.

### edit_ability

Accepts a numeric ability ID and an RFC 7396 JSON Merge Patch. It starts from that ability's saved spec, including a new unintegrated draft, or seeds a complete spec from current runtime records. It prevents ID/slug changes, validates and saves the result, returns the regenerated browser/Java fragments, and includes the current pre-edit parity report. A null patch value removes an optional field.

### check_ability_parity

Compares all abilities, or one numeric ID, from live browser and Java runtime snapshots. It returns JSON with status, checkedSections, sectionMismatchCounts, totalMismatchCount, and mismatches[]. Each mismatch includes an exact path, browser value, backend value, and mismatch kind.

It compares identity, timing/resources, compatibility projections for damage/range/arc/falloff, and shared contract values for category, spawn, owner targeting, lifetime duration/add, activation flags, phase order/type, movement, triggers, hitboxes, health, ordered effects and effect targets, visuals, event actions/transitions/schedules/target policies/targets, and nested entity abilities.

The report normalizes known representation-only differences: enum casing, omitted versus default values, browser nested versus Java flattened spawn offsets, maxCharges/reloadMs versus charges/rechargeMs, effect subtype aliases, capture metadata, and redundant ray length. It does not execute combat or prove behavior implemented outside the shared metadata.

## AbilitySpec shape

~~~json
{
  "schemaVersion": 1,
  "id": "tether_bolt",
  "name": "Tether Bolt",
  "label": "Tether Bolt",
  "category": "PROJECTILE",
  "round": 1,
  "summary": "Launch a bolt that pulls and slows on contact.",
  "visualInterpolation": "linear",
  "timing": {
    "cooldownMs": 5000,
    "windupMs": 0,
    "activeMs": 300,
    "durationMs": 600,
    "maxCharges": 0,
    "reloadMs": 0,
    "resourceModel": "NONE"
  },
  "contract": {
    "entityType": "tether_bolt",
    "runtimeType": "tetherBolt",
    "spawn": {
      "offset": { "x": 0, "y": 0 },
      "rotation": 0,
      "rotationSpace": "OWNER"
    },
    "targeting": { "owner": "OWNER" },
    "lifetime": { "timerMode": "AGE", "duration": 600, "add": 0 },
    "state": {
      "damageMultiplier": {
        "context": "damageMultiplier",
        "fallback": { "ownerStat": "attackDamageMultiplier", "fallback": 1 }
      }
    },
    "activation": {},
    "phases": [
      {
        "id": "outbound",
        "type": "PROJECTILE",
        "movement": { "speed": 100, "direction": "forward" },
        "hitbox": { "shape": "rectangle", "width": 18, "length": 18 },
        "effects": [
          { "type": "DAMAGE", "amount": 10, "targetKinds": ["BOT", "HP_ENTITY"] },
          { "type": "STATUS", "subtype": "slow", "durationMs": 1200, "targetKinds": ["BOT", "SUMMON"] }
        ],
        "visual": { "type": "tetherBolt", "visualSize": 18 },
        "durationMs": 400,
        "events": {
          "COLLISION": {
            "actions": ["APPLY_EFFECTS", "TRANSITION"],
            "transition": { "to": "return" },
            "schedule": { "mode": "ONCE" },
            "targetPolicy": { "mode": "ONCE" },
            "targetKinds": ["BOT", "HP_ENTITY"],
            "recheckCollisionOnTransition": false
          },
          "LIFETIME_END": {
            "actions": ["TRANSITION"],
            "transition": { "to": "return" },
            "schedule": { "mode": "ONCE" },
            "recheckCollisionOnTransition": false
          }
        },
        "hit": { "mode": "NEAREST" }
      },
      {
        "id": "return",
        "type": "PROJECTILE",
        "movement": { "speed": 150, "direction": "backward" },
        "hitbox": { "shape": "rectangle", "width": 18, "length": 18 },
        "effects": [
          { "type": "PULL", "amount": 250, "targetKinds": ["BOT", "SUMMON"] }
        ],
        "visual": { "type": "tetherBolt", "visualSize": 18 },
        "durationMs": 200,
        "events": {
          "COLLISION": {
            "actions": ["APPLY_EFFECTS"],
            "schedule": { "mode": "CONTINUOUS" },
            "targetPolicy": { "mode": "ONCE" },
            "targetKinds": ["BOT", "SUMMON"],
            "pullDirection": "OWNER"
          }
        }
      }
    ],
    "abilities": []
  },
  "implementationNotes": {
    "browser": "Add custom movement/combat behavior only if the phase contract cannot express it.",
    "backend": "Mirror any generic behavior extension in the authoritative system.",
    "visual": "Use the existing tetherBolt renderer; add a renderer only if it is not registered."
  }
}
~~~

Top-level required fields are id, name, category, round, summary, visualInterpolation, timing.cooldownMs, and contract.phases. The MCP assigns abilityId; omit it from add_ability. Categories are botAttached, projectile, trap, summon, or zone. Rounds are 0-3; round 0 marks a standard ability. Phase/event/effect enum names accept the current camelCase/lowercase form or uppercase form shown in this example.

Phase events and effect payloads have separate targetKinds: event kinds gate which collisions can reach the event, and effect kinds gate which reached targets can receive each effect. The validator inserts runtime default target kinds if omitted. Transitions must reference declared phase IDs. Visual event emissions require a positive visibleMs. Repeat schedules require a positive integer intervalMs.

## Integration boundary

The generator emits insertable snippets for:

- browser: frontend/src/gameArena/gameconfig/AbilityRegistry.js, Abilities.js, loadout/BotLoadout.js, and ecs/contracts/AbilityContracts.js;
- server: server/src/main/java/com/example/botfight/simulation/gameconfig/AbilityRegistry.java, Abilities.java, and ecs/contracts/AbilityContracts.java.

It also names remaining project-specific work: server allowed-loadout/action policy, targeting/action payloads, new generic effects, Pixi renderers/assets, replay fields, and tests when the spec needs them. It does not write these game files, run tests, validate submissions, simulate a match, manage candidate batches, or compile strategies.

## Parity response limitations

Shared metadata parity does not cover loadout offer/ownership policy, code/action payload semantics, replay serialization, generic runtime implementation, Pixi drawing, or collision execution. The JSON coverage.notes lists these limits. Backend timer mode, initial armed state, and compatibility-only fields have no direct browser field; shared lifetime duration, phase duration, event scheduling, and event visuals are compared where represented.
