import { TrashIcon } from "../controls/WorkspaceToolbarBits.jsx";
import { useRef } from "react";
import { actionSupportsAim, BOT_CODE_ACTIONS, MAX_CONDITIONS_PER_BRANCH, MAX_REPEAT_COUNT } from "../../../../../shared/engine/botlogic/code/BotCode.js";
import { ACTION_HEADS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { CHAIN_STEP_TYPES } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import {
    ActionTargetControls,
    ConditionalInspectorRow,
    DeferredNumberInput,
    InfoHint,
    PhaseOrientationControls,
    VariableActionControls,
} from "../nodes/GraphNodes.jsx";
import { actionTargetMode } from "../nodes/actionNodePresentation.js";
import { SegmentedToggle } from "../controls/SegmentedToggle.jsx";
import {
    callBlockReason,
    changeStepAction,
    clampRepeatCount,
    conditionFieldOf,
    msToSeconds,
    secondsToMs,
    setTimedMode,
    stepUsesConditions,
} from "./chainEditing.js";
import { CHAIN_CATEGORY_LABELS } from "./chainStepPresentation.js";

const FLOW_NOTES = Object.freeze({
    [CHAIN_STEP_TYPES.EXIT_LOOP]: "Leaves the nearest Repeat and carries on after it.",
    [CHAIN_STEP_TYPES.END]: "Stops this chain here and goes back to the chain that ran it. At the top level, the chain is over.",
});

const EYEBROWS = Object.freeze({
    [CHAIN_STEP_TYPES.IF]: "IF",
    [CHAIN_STEP_TYPES.ELSE_IF]: "ELSE IF",
    [CHAIN_STEP_TYPES.ELSE_IF]: "ELSE IF",
    [CHAIN_STEP_TYPES.WAIT]: "WAIT",
    [CHAIN_STEP_TYPES.REPEAT]: "REPEAT",
    [CHAIN_STEP_TYPES.RUN_CHAIN]: "RUN CHAIN",
    [CHAIN_STEP_TYPES.EXIT_LOOP]: "EXIT LOOP",
    [CHAIN_STEP_TYPES.END]: "END",
});

function SecondsField({ label, ms, disabled, onCommit }) {
    return <label className="code-inspector-field"><span>{label}</span>
        <div className="cx-seconds">
            <DeferredNumberInput disabled={disabled} min={0.1} max={10} step={0.1} value={msToSeconds(ms)} fallback={0.5} aria-label={`${label} in seconds`} onCommit={(seconds) => onCommit(secondsToMs(seconds))} />
            <span>s</span>
        </div>
    </label>;
}

export function ChainStepInspector({
    step,
    conditionIndex = null,
    number,
    chain,
    chains,
    actionTypes,
    selectableTypes,
    selectableAbilityIds,
    stateVariables,
    defaultVariable,
    untilCondition,
    customVariables,
    disabled,
    canAddAction,
    canMoveUp,
    canMoveDown,
    onUpdate,
    onMove,
    onClose,
    onDelete,
    onOpenChain,
    onPickConditionOperand,
    onPickActionOperand,
    onInspectActionOperand,
    onDismissOperandPicker,
}) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose });
    const isAction = step.type === CHAIN_STEP_TYPES.ACTION;
    const definition = isAction ? actionTypes.find((action) => action.id === step.action) ?? null : null;
    const head = definition?.head ?? null;
    const eyebrow = isAction ? CHAIN_CATEGORY_LABELS[head] ?? "ACTION" : EYEBROWS[step.type] ?? "STEP";
    const title = step.type === CHAIN_STEP_TYPES.REPEAT ? "Repeat" : number ? `Step ${number}` : "Loose block";
    const set = (patch) => onUpdate((current) => ({ ...current, ...patch }));

    const timed = (labels) => {
        const useConditions = stepUsesConditions(step);
        return <>
            <div className="code-inspector-field">
                <span>{labels.heading}</span>
                <SegmentedToggle ariaLabel={labels.heading} disabled={disabled} value={useConditions ? "conditions" : "fixed"} onChange={(next) => {
                    if ((next === "conditions") !== useConditions) onUpdate((current) => setTimedMode(current, next === "conditions", untilCondition));
                }} options={[{ id: "fixed", label: labels.fixed }, { id: "conditions", label: labels.conditions }]} />
            </div>
            {useConditions ? <>
                <SecondsField label="Max" ms={step.maxMs} disabled={disabled} onCommit={(maxMs) => set({ maxMs })} />
            </> : step.type === CHAIN_STEP_TYPES.REPEAT
                ? <label className="code-inspector-field"><span>Times</span>
                    <DeferredNumberInput disabled={disabled} integerOnly digitsOnly min={1} max={MAX_REPEAT_COUNT} step={1} value={step.count ?? 2} fallback={2} aria-label="Repeat count" onCommit={(count) => set({ count: clampRepeatCount(count) })} />
                </label>
                : <SecondsField label="Seconds" ms={step.forMs} disabled={disabled} onCommit={(forMs) => set({ forMs })} />}
        </>;
    };

    const actionBody = () => {
        if (!definition) return <p className="cx-note">This action is not available with the current loadout.</p>;
        const targetMode = actionTargetMode(step, definition);
        const needsTarget = targetMode !== null;
        const abilityLike = (action) => action.head === ACTION_HEADS.ABILITY || action.head === ACTION_HEADS.DASH;
        const abilities = actionTypes.filter(abilityLike);
        return <>
            {(head === ACTION_HEADS.ABILITY || head === ACTION_HEADS.DASH) && <label className="code-inspector-field"><span>Ability</span>
                <select disabled={disabled} aria-label="Ability" value={String(step.action)} onChange={(event) => {
                    const next = abilities.find((action) => String(action.id) === event.target.value);
                    if (next) onUpdate((current) => changeStepAction(current, next, { customVariables, chains }));
                }}>{abilities.map((action) => <option key={action.id} value={String(action.id)}>{String(action.label).replace(/^(?:Ability|Weapon):\s*/, "")}</option>)}</select>
            </label>}
            {definition.variableAction && <VariableActionControls entry={step} variables={customVariables} stateVariables={stateVariables} selectableTypes={selectableTypes} disabled={disabled} canAddAction={canAddAction} allowRemoveAction={false} onChange={onUpdate} onPickOperand={onPickActionOperand} onInspectOperand={onInspectActionOperand} onRemoveAction={() => {}} />}
            {definition.orientationConfig && <PhaseOrientationControls entry={step} disabled={disabled} onChange={onUpdate} />}
            {needsTarget && <ActionTargetControls entry={step} definition={definition} showSprint={definition.id === BOT_CODE_ACTIONS.MOVE_WALK} showFastTurn={definition.id === BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET} selectableTypes={selectableTypes} disabled={disabled} onChange={onUpdate} leadAbilityOptions={actionSupportsAim(definition) ? abilities.filter((action) => action.abilityId != null) : []} />}
            {(head === ACTION_HEADS.MOVEMENT || head === ACTION_HEADS.ROTATION) && <SecondsField label="For" ms={step.forMs} disabled={disabled} onCommit={(forMs) => set({ forMs })} />}
            {head === ACTION_HEADS.CANCEL && <p className="cx-note">Cancels your own wind-up. Nothing happens if you are not winding up.</p>}
        </>;
    };

    const runChainBody = () => <>
        <label className="code-inspector-field"><span>Chain</span>
            <select disabled={disabled} aria-label="Chain to run" value={chains.some((candidate) => candidate.id === step.chainId) ? step.chainId : ""} onChange={(event) => set({ chainId: event.target.value })}>
                {!chains.some((candidate) => candidate.id === step.chainId) && <option value="" disabled>Choose a chain</option>}
                {chains.map((candidate) => {
                    const reason = candidate.id === step.chainId ? null : callBlockReason(chains, chain.id, candidate.id);
                    return <option key={candidate.id} value={candidate.id} disabled={Boolean(reason)} title={reason ?? undefined}>{candidate.name}{reason ? ` (${reason.includes("itself") ? "this chain" : reason.includes("loop") ? "would loop" : "too deep"})` : ""}</option>;
                })}
            </select>
        </label>
        {onOpenChain && chains.some((candidate) => candidate.id === step.chainId) && <button type="button" className="cx-open-chain" onClick={() => onOpenChain(step.chainId)}>Open chain</button>}
    </>;

    let body = null;
    if (isAction) body = actionBody();
    else if ([CHAIN_STEP_TYPES.IF, CHAIN_STEP_TYPES.ELSE_IF].includes(step.type)) body = step.conditions?.[conditionIndex ?? 0] && <ConditionalInspectorRow {...{ stateVariables, defaultVariable, selectableTypes, selectableAbilityIds, disabled }} condition={step.conditions[conditionIndex ?? 0]} index={conditionIndex ?? 0} onPickOperand={(row, operand) => onPickConditionOperand("conditions", row, operand)} onRowChange={(updater) => set({ conditions: step.conditions.map((condition, index) => index === (conditionIndex ?? 0) ? updater(condition) : condition) })} />;
    else if ((step.type === CHAIN_STEP_TYPES.WAIT || step.type === CHAIN_STEP_TYPES.REPEAT) && conditionIndex != null && step[conditionFieldOf(step)]?.[conditionIndex]) {
        const field = conditionFieldOf(step);
        body = <>
            <ConditionalInspectorRow {...{ stateVariables, defaultVariable, selectableTypes, selectableAbilityIds, disabled }} condition={step[field][conditionIndex]} index={conditionIndex} onPickOperand={(row, operand) => onPickConditionOperand(field, row, operand)} onRowChange={(updater) => set({ [field]: step[field].map((condition, index) => (index === conditionIndex ? updater(condition) : condition)) })} />
            <button type="button" className="cx-delete-step cx-trash" aria-label="Remove condition" disabled={disabled || step[field].length <= 1} title={step[field].length <= 1 ? "A step needs at least one condition" : undefined} onClick={() => set({ [field]: step[field].filter((_, index) => index !== conditionIndex) })}><TrashIcon /></button>
        </>;
    }
    else if (step.type === CHAIN_STEP_TYPES.WAIT) body = timed({ heading: "Wait", fixed: "For", conditions: "Conditions" });
    else if (step.type === CHAIN_STEP_TYPES.REPEAT) body = timed({ heading: "Repeat", fixed: "Times", conditions: "While" });
    else if (step.type === CHAIN_STEP_TYPES.RUN_CHAIN) body = runChainBody();
    else body = <p className="cx-note">{FLOW_NOTES[step.type]}</p>;

    return <aside ref={dialogRef} className="code-inspector" data-node-drag-ignore="true" role="dialog" aria-modal="true" aria-label={`${eyebrow} ${title}`} onPointerDown={(event) => event.stopPropagation()} onWheel={(event) => event.stopPropagation()}>
        <header className="code-inspector-header"><div><span>{eyebrow}</span><h2 className="code-inspector-title">{title}</h2></div><button type="button" onClick={onClose} className="modal-close-button" aria-label="Close inspector"><span aria-hidden="true">×</span></button></header>
        <div className="code-inspector-body" onClick={(event) => { if (event.target === event.currentTarget) onDismissOperandPicker?.(); }}>
            <div className="code-cond-row code-action-row cx-fields">
                <div className="code-cond-settings">{body}</div>
            </div>
            <div className="cx-step-footer">
                <span>
                    <button type="button" className="cx-ghost" disabled={disabled || !canMoveUp} onClick={() => onMove(-1)} aria-label="Move step up" title="Move up">↑ Up</button>
                    <button type="button" className="cx-ghost" disabled={disabled || !canMoveDown} onClick={() => onMove(1)} aria-label="Move step down" title="Move down">↓ Down</button>
                </span>
                <button type="button" className="cx-delete-step cx-trash" aria-label="Delete step" title="Delete step" disabled={disabled} onClick={onDelete}><TrashIcon /></button>
            </div>
        </div>
    </aside>;
}
