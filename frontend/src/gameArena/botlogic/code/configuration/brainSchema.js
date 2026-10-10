import Ajv2020 from "ajv/dist/2020.js";
import brainSchema from "../../../../../../shared/schemas/brain.schema.json" with { type: "json" };

let validator = null;

function compiled() {
    if (!validator) {
        // allErrors reports every problem at once, like the server; strict is off for the generated if/then style.
        validator = new Ajv2020({ allErrors: true, strict: false }).compile(brainSchema);
    }
    return validator;
}

/**
 * Validates a (normalized) brain against shared/schemas/brain.schema.json, the same file the server checks.
 * Returns `{ valid, errors }` where each error is `"<json path>: <message>"`, with paths like `brain.roots[0]`.
 */
export function validateBrainSchema(brain) {
    const validate = compiled();
    const valid = validate(brain);
    return { valid, errors: valid ? [] : (validate.errors ?? []).map(formatSchemaError) };
}

/** Converts an ajv instance path (`/roots/0/branches`) into the server's style (`brain.roots[0].branches`). */
export function formatSchemaError(error) {
    const path = String(error.instancePath ?? "").split("/").filter(Boolean)
        .map((segment) => (/^\d+$/.test(segment) ? `[${segment}]` : `.${segment}`)).join("");
    return `brain${path}: ${error.message}`;
}

