/** Every step in a chain, nested steps included, in definition order. */
export function* walkChainSteps(steps) {
    for (const step of steps ?? []) {
        yield step;
        yield* walkChainSteps(step.then);
        if (step.type === "if" && !Array.isArray(step.steps) && step.else?.length) yield { type: "elseIf", conditions: [] };
        yield* walkChainSteps(step.else);
        yield* walkChainSteps(step.steps);
    }
}

/** The conditions a step reads, whichever field holds them. */
export function stepConditionLists(step) {
    return [step?.conditions, step?.untilConditions, step?.whileConditions].filter(Array.isArray);
}

/** The chain's stack plus its loose blocks (which never run but still count toward every limit). */
export function* walkChainStepsWithLoose(chain) {
    yield* walkChainSteps(chain?.steps);
    for (const entry of Array.isArray(chain?.loose) ? chain.loose : []) {
        if (entry?.step && typeof entry.step === "object") yield* walkChainSteps([entry.step]);
    }
}
