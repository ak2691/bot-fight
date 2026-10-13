// Which taps open a node's side panel. A tap on an action selects it and opens its panel. A tap on a conditional
// only selects it; a tap on one of its condition rows opens that row once the conditional is already selected.
// Ctrl/Cmd taps add to the selection and never open anything.
export function tapOpensPanel({ isAction = false, additive = false, alreadySelected = false, onRow = false }) {
    if (additive) return false;
    if (onRow) return alreadySelected;
    return isAction;
}
