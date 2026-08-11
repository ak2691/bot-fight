import { useEffect, useRef, useState } from "react";
import {
    CUSTOM_INTEGER_MAX,
    CUSTOM_INTEGER_MIN,
    CONDITION_COMPARATORS,
    MAX_CUSTOM_VARIABLE_SLOTS,
    countVariableSlots,
    createExpressionCondition,
} from "../../botlogic/code/BotCode.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { filterCustomVariableEntries } from "../utils/customVariableSearch.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";

function createCustomVariableId() {
    return `custom.${Date.now().toString(36)}`;
}

function clampNumber(value, min, max, fallback) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return text.startsWith("-") ? min : max;
    return Math.max(min, Math.min(max, Math.round(numeric)));
}

function DeferredNumberInput({ value, onCommit, min, max, fallback = 0, ...props }) {
    const [draft, setDraft] = useState(String(value ?? fallback));
    const commit = () => {
        const normalized = clampNumber(draft, min, max, fallback);
        setDraft(String(normalized));
        onCommit(normalized);
    };
    return <input {...props} type="text" inputMode="numeric" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } }} />;
}

export default function CustomVariablesModal({ configuration, currentValues, disabled, stateVariables, defaultVariable, onChange, onClose }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true });
    useExclusiveSearchMenu(dialogRef, true, onClose);
    const variables = configuration?.customVariables ?? [];
    const [query, setQuery] = useState("");
    const [selectedVariableId, setSelectedVariableId] = useState(() => variables[0]?.id ?? null);
    const visibleVariables = filterCustomVariableEntries(variables, query);
    const effectiveSelectedVariableId = variables.some((variable) => variable.id === selectedVariableId) ? selectedVariableId : variables[0]?.id ?? null;
    const selectedIndex = variables.findIndex((variable) => variable.id === effectiveSelectedVariableId);
    const selectedVariable = selectedIndex >= 0 ? variables[selectedIndex] : null;
    const slots = countVariableSlots(configuration);
    const update = (index, next) => onChange(updateCustomVariableConfiguration(configuration, index, next));
    const addVariable = () => {
        const variable = { id: createCustomVariableId(), name: `Variable ${variables.length + 1}`, valueType: "number", initialValue: 0 };
        onChange({ ...configuration, customVariables: [...variables, variable] });
        setSelectedVariableId(variable.id);
        setQuery("");
    };
    const removeSelectedVariable = () => {
        const nextSelection = variables[selectedIndex + 1]?.id ?? variables[selectedIndex - 1]?.id ?? null;
        onChange(removeCustomVariableConfiguration(configuration, selectedVariable.id));
        setSelectedVariableId(nextSelection);
    };
    return <div className="absolute inset-0 z-50 flex items-center justify-center overflow-y-auto bg-black/75 p-6" role="presentation"><section ref={dialogRef} className="flex h-[min(82vh,760px)] w-[min(94vw,1180px)] flex-col overflow-hidden rounded border border-emerald-900 bg-[#11171a] shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="custom-variables-title" tabIndex={-1}>
        <header className="flex min-h-20 items-center justify-between gap-4 px-6"><div><h2 id="custom-variables-title" className="font-mono text-sm font-bold tracking-widest text-cyan-300">{'{ }'} / CUSTOM VARIABLES</h2><p className="mt-2 font-mono text-[9px] text-ink-muted">{slots}/{MAX_CUSTOM_VARIABLE_SLOTS} VARIABLE SLOTS</p></div><div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={disabled || slots >= MAX_CUSTOM_VARIABLE_SLOTS} onClick={addVariable} className="min-h-11 rounded border border-emerald-700 bg-emerald-950/60 px-5 font-mono text-[10px] font-bold tracking-widest text-emerald-300 disabled:opacity-35">+ ADD VARIABLE</button><button type="button" onClick={onClose} aria-label="Close custom variables" className="min-h-11 rounded border border-border-mid px-5 font-mono text-[10px] text-ink-mid">CLOSE&nbsp; ×</button></div></header>
        <div className="grid min-h-0 flex-1 grid-cols-1 border-t border-border-lo md:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="flex min-h-0 flex-col border-b border-border-lo bg-[#15191d] p-4 md:border-r md:border-b-0">
                <label className="font-mono text-[9px] text-ink-muted"><span className="sr-only">Search variables</span><input aria-label="Search custom variables" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search variables…" className="h-[38px] w-full rounded-none border border-slate-400/50 bg-[#090b0d] px-2.5 font-mono text-[10px] text-white outline-none" /></label>
                <div className="mt-1.5 grid min-h-0 flex-1 content-start gap-0 overflow-y-auto border border-slate-400/50 bg-[#090b0d] py-1" role="listbox" aria-label="Custom variables">
                    {visibleVariables.map(({ variable }) => <button key={variable.id} type="button" role="option" aria-selected={variable.id === effectiveSelectedVariableId} onClick={() => setSelectedVariableId(variable.id)} className={`flex w-full items-center justify-between gap-3 rounded-none border-0 px-2.5 py-2.5 text-left font-mono transition-colors ${variable.id === effectiveSelectedVariableId ? "bg-emerald-400/20 text-emerald-100" : "bg-transparent text-slate-200 hover:bg-emerald-300/20 hover:text-white"}`}>
                        <strong className="min-w-0 truncate text-[10px]">{variable.name || "UNTITLED VARIABLE"}</strong><small className="shrink-0 text-[7px] text-emerald-300">{variable.valueType === "boolean" ? "TRUE / FALSE" : "NUMBER"}</small>
                    </button>)}
                    {!variables.length && <p className="px-3 py-4 font-mono text-[9px] tracking-widest text-ink-muted">NO CUSTOM VARIABLES YET</p>}
                    {variables.length > 0 && !visibleVariables.length && <p className="px-3 py-4 font-mono text-[9px] tracking-widest text-ink-muted">NO VARIABLES MATCH “{query}”.</p>}
                </div>
            </aside>
            <main className="min-h-0 overflow-y-auto bg-[#11171a]">
                {!selectedVariable && <div className="flex h-full min-h-40 items-center justify-center px-6 font-mono text-[10px] tracking-widest text-ink-muted">SELECT A VARIABLE TO CONFIGURE</div>}
                {selectedVariable && <div className="p-5 sm:p-6">
                    <div className="flex items-center justify-between gap-4 border-b border-border-lo pb-3"><p className="font-mono text-[8px] tracking-[.18em] text-emerald-400">VARIABLE CONFIGURATION</p><div className="flex items-center gap-3"><span className="font-mono text-[8px] font-bold text-emerald-300">CURRENT: {String(currentValues?.[selectedVariable.id] ?? selectedVariable.initialValue)}</span><button type="button" disabled={disabled} onClick={removeSelectedVariable} className="border-0 bg-transparent p-1 font-mono text-[9px] text-red-300 hover:text-red-100 disabled:opacity-35">DELETE</button></div></div>
                    <div className="flex flex-wrap items-end gap-2.5 pt-4">
                        <label className="w-56 min-w-40 font-mono text-[8px] text-ink-muted">NAME<input aria-label="Variable name" disabled={disabled} value={selectedVariable.name} maxLength={40} onChange={(event) => update(selectedIndex, { name: event.target.value })} className="mt-1 h-8 w-full rounded border border-border-mid bg-zinc-950 px-2 font-mono text-[9px] text-white" /></label>
                        <label className="w-28 shrink-0 font-mono text-[8px] text-ink-muted">TYPE<select disabled={disabled} value={selectedVariable.valueType} onChange={(event) => update(selectedIndex, { valueType: event.target.value, initialValue: event.target.value === "boolean" ? false : 0, conditions: [] })} className="mt-1 h-8 w-full rounded border border-border-mid bg-zinc-950 px-2 font-mono text-[9px] text-white"><option value="number">INTEGER</option><option value="boolean">BOOLEAN</option></select></label>
                        <label className="w-28 shrink-0 font-mono text-[8px] text-ink-muted">STARTING VALUE{selectedVariable.valueType === "boolean" ? <select disabled={disabled} value={String(selectedVariable.initialValue ?? false)} onChange={(event) => update(selectedIndex, { initialValue: event.target.value === "true" })} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-white"><option value="false">FALSE</option><option value="true">TRUE</option></select> : <DeferredNumberInput key={selectedVariable.id} disabled={disabled} min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={selectedVariable.initialValue ?? 0} onCommit={(initialValue) => update(selectedIndex, { initialValue })} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-white" />}</label>
                    </div>
                    {selectedVariable.valueType === "boolean" && <div className="mt-4 border-t border-border-lo pt-3">
                        <BooleanVariableConditions variable={selectedVariable} customVariables={variables} disabled={disabled} stateVariables={stateVariables.filter((candidate) => candidate.id !== selectedVariable.id)} defaultVariable={defaultVariable} slots={slots} onChange={(conditions) => update(selectedIndex, { conditions })} />
                    </div>}
                </div>}
            </main>
        </div>
        <footer className="border-t border-border-lo px-6 py-4 font-mono text-[9px] text-ink-muted">ⓘ Variables can be referenced by Roots. Current values update live during runtime.</footer>
    </section></div>;
}

function BooleanVariableConditions({ variable, customVariables, disabled, stateVariables, defaultVariable, slots, onChange }) {
    const [picker, setPicker] = useState(null);
    const [pickerQuery, setPickerQuery] = useState("");
    const pickerSearchRef = useRef(null);
    const conditions = variable.conditions ?? [];
    const definitionFor = (variableId) => {
        const definition = stateVariables.find((candidate) => candidate.id === variableId);
        const customVariable = customVariables.find((candidate) => candidate.id === variableId);
        return customVariable && definition ? { ...definition, valueType: customVariable.valueType === "boolean" ? "boolean" : "number" } : definition;
    };
    const updateCondition = (rowIndex, updater) => onChange(conditions.map((condition, index) => index === rowIndex ? updater(condition) : condition));
    const openPicker = (rowIndex, operand) => { setPicker({ rowIndex, operand }); setPickerQuery(""); };
    const chooseVariable = (variableId) => {
        const condition = conditions[picker.rowIndex];
        const definition = definitionFor(variableId) ?? defaultVariable;
        if (picker.operand === 1) {
            const next = variableId === "always" ? { type: "always" } : createExpressionCondition(definition);
            updateCondition(picker.rowIndex, () => ({ ...next, ...(condition.join === "or" ? { join: "or" } : {}) }));
        } else {
            updateCondition(picker.rowIndex, (current) => ({ ...current, right: { type: "variable", value: variableId } }));
        }
        setPicker(null);
    };
    const pickerCondition = picker ? conditions[picker.rowIndex] : null;
    const pickerLeft = definitionFor(pickerCondition?.left) ?? defaultVariable;
    const normalizedQuery = pickerQuery.trim().toLocaleLowerCase();
    const pickerVariables = stateVariables.map((candidate) => definitionFor(candidate.id) ?? candidate).filter((candidate) => picker?.operand === 1 || candidate.valueType === pickerLeft.valueType).filter((candidate) => !normalizedQuery || `${candidate.label} ${candidate.id}`.toLocaleLowerCase().includes(normalizedQuery));
    useEffect(() => {
        if (!picker) return;
        pickerSearchRef.current?.focus();
        pickerSearchRef.current?.select();
    }, [picker]);
    return <div className="relative">
        <div className="space-y-2">
            {conditions.map((condition, conditionIndex) => {
                const leftDefinition = definitionFor(condition.left) ?? defaultVariable;
                const comparators = CONDITION_COMPARATORS.filter((candidate) => candidate.id !== "modulo" && candidate.valueTypes.includes(leftDefinition.valueType));
                const comparator = comparators.some((candidate) => candidate.id === condition.comparator) ? condition.comparator : comparators[0]?.id ?? "eq";
                return <div key={`${conditionIndex}-${condition.type}`} className="code-compact-condition-wrap"><div className="code-compact-condition">
                    <span className="code-condition-prefix font-mono text-[9px] text-amber-200">{conditionIndex ? (condition.join === "or" ? "OR" : "AND") : "IF"}</span>
                    {condition.type === "always" ? <button type="button" className="code-condition-socket col-span-3" disabled={disabled} onClick={() => openPicker(conditionIndex, 1)}>ALWAYS</button> : <>
                        <ModalConditionOperand operand={1} condition={condition} stateVariables={stateVariables} disabled={disabled} onPickVariable={() => openPicker(conditionIndex, 1)} />
                        <select aria-label="Comparator" disabled={disabled} value={comparator} onChange={(event) => updateCondition(conditionIndex, (current) => ({ ...current, comparator: event.target.value }))} className="code-operator-socket">{comparators.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.label}</option>)}</select>
                        <ModalConditionOperand operand={2} condition={condition} stateVariables={stateVariables} disabled={disabled} onPickVariable={() => openPicker(conditionIndex, 2)} onUseRaw={() => updateCondition(conditionIndex, (current) => ({ ...current, right: { type: leftDefinition.valueType === "boolean" ? "boolean" : "number", value: leftDefinition.valueType === "boolean" ? false : 0 } }))} onNumberChange={(value) => updateCondition(conditionIndex, (current) => ({ ...current, right: { type: "number", value } }))} onBooleanChange={(value) => updateCondition(conditionIndex, (current) => ({ ...current, right: { type: "boolean", value } }))} />
                    </>}
                    <button type="button" className="code-condition-row-remove" disabled={disabled} onClick={() => onChange(conditions.filter((_, index) => index !== conditionIndex))} aria-label={`Remove condition ${conditionIndex + 1}`}>×</button>
                </div></div>;
            })}
        </div>
        <div className="code-compact-footer mt-3 border border-slate-400/15">
            <button type="button" disabled={disabled || slots >= MAX_CUSTOM_VARIABLE_SLOTS} onClick={() => onChange([...conditions, createExpressionCondition(defaultVariable.id)])}>+ AND</button>
            <button type="button" disabled={disabled || slots >= MAX_CUSTOM_VARIABLE_SLOTS} onClick={() => onChange([...conditions, { ...createExpressionCondition(defaultVariable.id), join: "or" }])}>+ OR</button>
            <span className="ml-auto px-2 font-mono text-[8px] text-ink-muted">+1 VARIABLE SLOT</span>
        </div>
        {picker && <div className="code-node-picker code-node-picker--variable absolute left-8 top-10 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl" role="dialog" aria-label="Add variable input" onWheel={(event) => event.stopPropagation()}>
            <div className="mb-3 flex items-center justify-between gap-3"><strong className="tracking-[.12em] text-cyan-200">ADD VARIABLE INPUT</strong><button type="button" onClick={() => setPicker(null)} className="text-slate-400 hover:text-white" aria-label="Close variable search">×</button></div>
            <label className="code-node-search-label"><span className="sr-only">Search variables</span><input ref={pickerSearchRef} autoFocus value={pickerQuery} onChange={(event) => setPickerQuery(event.target.value)} placeholder="Search variables…" /></label>
            <div className="code-node-search-results">{picker.operand === 1 && (!normalizedQuery || "always".includes(normalizedQuery)) && <button type="button" onClick={() => chooseVariable("always")}><strong>ALWAYS</strong><small>TRUE / FALSE</small></button>}{pickerVariables.map((definition) => <button key={definition.id} type="button" onClick={() => chooseVariable(definition.id)}><strong>{definition.label}</strong><small>{definition.valueType === "boolean" ? "TRUE / FALSE" : "NUMBER"}</small></button>)}</div>
        </div>}
    </div>;
}

function ModalConditionOperand({ operand, condition, stateVariables, disabled, onPickVariable, onUseRaw, onNumberChange, onBooleanChange }) {
    const definition = operand === 1 ? stateVariables.find((candidate) => candidate.id === condition.left) : condition.right?.type === "variable" ? stateVariables.find((candidate) => candidate.id === condition.right.value) : null;
    const rawBoolean = operand === 2 && condition.right?.type === "boolean";
    const rawNumber = operand === 2 && condition.right?.type === "number";
    return <div className={`code-condition-input ${definition ? "is-variable" : "is-raw"}`}>
        {definition ? <span className="code-condition-input-value">{definition.label}</span> : rawBoolean ? <select aria-label="Boolean value" disabled={disabled} value={String(condition.right.value)} onChange={(event) => onBooleanChange(event.target.value === "true")}><option value="true">TRUE</option><option value="false">FALSE</option></select> : rawNumber ? <DeferredNumberInput aria-label="Number value" disabled={disabled} min={CUSTOM_INTEGER_MIN} max={CUSTOM_INTEGER_MAX} value={condition.right.value} onCommit={onNumberChange} /> : <span className="code-condition-input-placeholder">INPUT {operand}</span>}
        {definition && operand === 2 ? <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onUseRaw} aria-label="Use a raw value" title="Use a raw value">−</button> : <button type="button" className="code-condition-input-toggle" disabled={disabled} onClick={onPickVariable} aria-label={`Choose input ${operand} variable`} title="Choose a variable">+</button>}
    </div>;
}

function updateCustomVariableConfiguration(configuration, variableIndex, updates) {
    const variables = configuration?.customVariables ?? [];
    const current = variables[variableIndex];
    if (!current) return configuration;
    const typeChanged = updates.valueType && updates.valueType !== current.valueType;
    const customVariables = variables.map((variable, index) => index === variableIndex ? { ...variable, ...updates } : variable);
    if (!typeChanged) return { ...configuration, customVariables };
    return rewriteVariableActions({ ...configuration, customVariables }, current.id, (entry) => ({ ...entry, operation: "set", value: updates.valueType === "boolean" ? false : 0 }));
}

function removeCustomVariableConfiguration(configuration, variableId) {
    const customVariables = (configuration?.customVariables ?? []).filter((variable) => variable.id !== variableId).map((variable) => ({ ...variable, conditions: filterVariableConditions(variable.conditions, variableId) }));
    const cleaned = rewriteVariableActions({ ...configuration, customVariables }, variableId, () => null);
    return rewriteConfigurationConditions(cleaned, (conditions) => filterVariableConditions(conditions, variableId));
}

function rewriteVariableActions(configuration, variableId, rewrite) {
    const mapBranch = (branch) => {
        const actions = (branch.actions ?? []).map((entry) => entry.action === "variable" && entry.variableId === variableId ? rewrite(entry) : entry).filter(Boolean);
        const legacyMatches = branch.action === "variable" && branch.variableId === variableId;
        const first = actions[0] ?? (legacyMatches ? { action: "none", actionTarget: "opponent" } : null);
        return { ...branch, ...(first ? { ...first, actions } : { actions }), children: (branch.children ?? []).map(mapBranch) };
    };
    return { ...configuration, roots: (configuration.roots ?? []).map((root) => ({ ...root, branches: (root.branches ?? []).map(mapBranch) })) };
}

function rewriteConfigurationConditions(configuration, rewrite) {
    const mapBranch = (branch) => ({ ...branch, conditions: rewrite(branch.conditions), children: (branch.children ?? []).map(mapBranch) });
    return { ...configuration, roots: (configuration.roots ?? []).map((root) => ({ ...root, branches: (root.branches ?? []).map(mapBranch) })) };
}

function filterVariableConditions(conditions, variableId) {
    return (conditions ?? []).filter((condition) => condition?.left !== variableId && condition?.right?.value !== variableId);
}
