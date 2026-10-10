import { validateAbilityStrategyConfiguration as validateStructure } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { brainRuleErrors } from "../../../../../shared/engine/botlogic/code/configuration/brainRules.js";
import { validateBrainSchema } from "./configuration/brainSchema.js";

/**
 * The editor's validation: the engine's editor checks, then what the server checks on submit (the shared
 * brain schema, then the brain rules the sim-worker runs). The engine carries no schema validator, so it
 * stays free of dependencies.
 */
export function validateAbilityStrategyConfiguration(configuration) {
    const result = validateStructure(configuration, { validateSchema: (normalized) => {
        const schemaErrors = validateBrainSchema(normalized).errors;
        return schemaErrors.length ? schemaErrors : brainRuleErrors(normalized);
    } });
    return { ...result, errors: [...new Set(result.errors)] };
}
