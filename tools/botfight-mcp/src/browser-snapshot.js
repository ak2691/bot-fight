import { pathToFileURL } from "node:url";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(here, "../../..");
const toUrl = (relativePath) => pathToFileURL(path.join(root, relativePath)).href;

const [registry, contractModule, abilities, loadout] = await Promise.all([
    import(toUrl("shared/engine/gameconfig/AbilityRegistry.js")),
    import(toUrl("shared/engine/ecs/contracts/AbilityContracts.js")),
    import(toUrl("shared/engine/gameconfig/Abilities.js")),
    import(toUrl("shared/engine/loadout/BotLoadout.js")),
]);

const timing = Object.fromEntries(Object.keys(registry.ABILITIES).map((id) => [
    id,
    abilities.abilityStats(Number(id)),
]));

const snapshot = {
    schemaVersion: 1,
    registry: registry.ABILITIES,
    timing,
    loadout: Object.fromEntries(loadout.ALL_ABILITY_DEFINITIONS.map((item) => [item.id, item])),
    contracts: contractModule.ABILITY_CONTRACTS,
};

process.stdout.write(`${JSON.stringify(snapshot)}\n`);
