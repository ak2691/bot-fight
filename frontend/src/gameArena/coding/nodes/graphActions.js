import { BOT_CODE_SELECTABLES } from "../../botlogic/code/contracts/BotLogicContracts.js";

export function graphBranchActions(branch) {
    if (Array.isArray(branch?.actions)) return branch.actions.filter((entry) => entry.action && entry.action !== "none");
    return branch?.action && branch.action !== "none" ? [{ action: branch.action, selectable: branch.selectable ?? BOT_CODE_SELECTABLES.OPPONENT }] : [];
}

// A branch mirrors its first action in the legacy flat fields. The action's own id must not be one of them: it would
// replace the branch's id, so the conditional and its action would share a graph id and the wiring would tangle.
export function setGraphActions(branch, actions) {
    const first = actions[0] ?? { action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT };
    const { id: _actionId, linkId: _linkId, ...legacyFields } = first;
    return { ...branch, actions, ...legacyFields };
}
