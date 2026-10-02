import { useRef, useState } from "react";
import {
    CUSTOM_NUMBER_MAX,
    CUSTOM_NUMBER_MIN,
    truncateToNumberPrecision,
    MAX_CUSTOM_VARIABLE_SLOTS,
    countVariableSlots,
} from "../../botlogic/code/BotCode.js";
import { BOT_CODE_SELECTABLES } from "../../botlogic/code/contracts/BotLogicContracts.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { filterCustomVariableEntries } from "../utils/customVariableSearch.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import AddIcon from "../controls/AddIcon.jsx";

function createCustomVariableId(idPrefix = "custom") {
    const prefix = String(idPrefix || "custom").replace(/\.+$/, "") || "custom";
    return `${prefix}.${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`;
}

function clampNumber(value, min, max, fallback) {
    const text = String(value ?? "").trim();
    if (!text) return fallback;
    const numeric = Number(text);
    if (!Number.isFinite(numeric)) return text.startsWith("-") ? min : max;
    return truncateToNumberPrecision(Math.max(min, Math.min(max, numeric)));
}

function DeferredNumberInput({ value, onCommit, min, max, fallback = 0, ...props }) {
    const [draft, setDraft] = useState(String(value ?? fallback));
    const commit = () => {
        const normalized = clampNumber(draft, min, max, fallback);
        setDraft(String(normalized));
        onCommit(normalized);
    };
    return <input {...props} type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

function DeferredTextInput({ value, onCommit, ...props }) {
    const [draft, setDraft] = useState(String(value ?? ""));
    const sanitize = (next) => String(next ?? "").replace(/[^A-Za-z0-9 _-]/g, "").replace(/\s+/g, " ").slice(0, 40);
    const commit = () => {
        const normalized = sanitize(draft).trim();
        const next = /^[A-Za-z]/.test(normalized) ? normalized : String(value ?? "Variable");
        setDraft(next);
        onCommit(next);
    };
    return <input {...props} value={draft} onChange={(event) => setDraft(sanitize(event.target.value))} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

// How many nodes (conditions and variable actions) reference a custom variable.
function countVariableReferences(configuration, variableId) {
    let count = 0;
    const operandUses = (operand) => operand?.type === "variable" && operand.value === variableId;
    const visitBranch = (branch) => {
        for (const condition of branch?.conditions ?? []) {
            if (condition?.left === variableId || operandUses(condition?.right)) count += 1;
        }
        const actions = Array.isArray(branch?.actions) ? branch.actions : branch?.action ? [branch] : [];
        for (const entry of actions) {
            if (entry?.action !== "variable") continue;
            const terms = Array.isArray(entry.terms) ? entry.terms : [];
            if (entry.variableId === variableId || operandUses(entry.operand) || terms.some((term) => operandUses(term?.operand))) count += 1;
        }
        (branch?.children ?? []).forEach(visitBranch);
    };
    (configuration?.roots ?? []).forEach((root) => (root?.branches ?? []).forEach(visitBranch));
    return count;
}

function formatLiveValue(value) {
    return typeof value === "boolean" ? String(value) : String(value);
}

function BracesIcon() {
    return <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M6 2.5C4.5 2.5 4.5 4 4.5 5.5S4.5 7.5 3 8c1.5.5 1.5 1.5 1.5 2.5S4.5 13.5 6 13.5M10 2.5c1.5 0 1.5 1.5 1.5 3S11.5 7.5 13 8c-1.5.5-1.5 1.5-1.5 2.5s0 3-1.5 3" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function SearchGlyph() {
    return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function TrashGlyph() {
    return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M7 7v3.5M9 7v3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

export default function CustomVariablesModal({ configuration, currentValues, maxSlots = MAX_CUSTOM_VARIABLE_SLOTS, idPrefix = "custom", disabled, onChange, onClose }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true });
    useExclusiveSearchMenu(dialogRef, true, onClose);
    const variables = configuration?.customVariables ?? [];
    const [query, setQuery] = useState("");
    const [selectedVariableId, setSelectedVariableId] = useState(() => variables[0]?.id ?? null);
    // Phones show the list and the detail as separate screens.
    const [showDetail, setShowDetail] = useState(false);
    const visibleVariables = filterCustomVariableEntries(variables, query);
    const effectiveSelectedVariableId = variables.some((variable) => variable.id === selectedVariableId) ? selectedVariableId : variables[0]?.id ?? null;
    const selectedIndex = variables.findIndex((variable) => variable.id === effectiveSelectedVariableId);
    const selectedVariable = selectedIndex >= 0 ? variables[selectedIndex] : null;
    const slots = countVariableSlots(configuration);
    const atLimit = slots >= maxSlots;
    const update = (index, next) => onChange(updateCustomVariableConfiguration(configuration, index, next));
    const addVariable = () => {
        if (disabled || atLimit) return;
        const variable = { id: createCustomVariableId(idPrefix), name: `Variable ${variables.length + 1}`, valueType: "number", initialValue: 0 };
        onChange({ ...configuration, customVariables: [...variables, variable] });
        setSelectedVariableId(variable.id);
        setShowDetail(true);
        setQuery("");
    };
    const removeSelectedVariable = () => {
        const uses = countVariableReferences(configuration, selectedVariable.id);
        if (uses > 0 && !window.confirm(`Used in ${uses} node${uses === 1 ? "" : "s"}. Delete anyway?`)) return;
        const nextSelection = variables[selectedIndex + 1]?.id ?? variables[selectedIndex - 1]?.id ?? null;
        onChange(removeCustomVariableConfiguration(configuration, selectedVariable.id));
        setSelectedVariableId(nextSelection);
        setShowDetail(false);
    };
    const usedIn = selectedVariable ? countVariableReferences(configuration, selectedVariable.id) : 0;
    const liveValue = selectedVariable ? (currentValues?.[selectedVariable.id] ?? selectedVariable.initialValue ?? (selectedVariable.valueType === "boolean" ? false : 0)) : null;
    const newVariableButton = <button type="button" disabled={disabled || atLimit} onClick={addVariable} className="code-cv-new" title={atLimit ? "Variable limit reached" : undefined}><AddIcon className="code-cv-new-icon" /> New variable</button>;
    return <div className="code-custom-variables-overlay absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/75 p-6" role="presentation"><section ref={dialogRef} data-screen={showDetail ? "detail" : "list"} className="code-cv" role="dialog" aria-modal="true" aria-labelledby="custom-variables-title" tabIndex={-1}>
        <header className="code-cv-header">
            <span className="code-cv-header-icon"><BracesIcon /></span>
            <h2 id="custom-variables-title">Custom variables</h2>
            <span className="code-cv-count code-cv-mono">{slots} / {maxSlots}</span>
            <button type="button" onClick={onClose} aria-label="Close custom variables" title="Close" className="code-cv-close"><span aria-hidden="true">×</span></button>
        </header>
        <div className="code-cv-body">
            <aside className="code-cv-list-pane">
                <label className="code-cv-search"><SearchGlyph /><span className="sr-only">Search variables</span><input aria-label="Search custom variables" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search variables" /></label>
                <div className="code-cv-list" role="listbox" aria-label="Custom variables">
                    {visibleVariables.map(({ variable }) => <button key={variable.id} type="button" role="option" aria-selected={variable.id === effectiveSelectedVariableId} onClick={() => { setSelectedVariableId(variable.id); setShowDetail(true); }} className={`code-cv-row ${variable.id === effectiveSelectedVariableId ? "is-selected" : ""}`}>
                        <span className="code-cv-row-name">{variable.name || "Untitled variable"}</span>
                        <span className={`code-cv-tag ${variable.valueType === "boolean" ? "is-boolean" : "is-number"}`}>{variable.valueType === "boolean" ? "True/false" : "Number"}</span>
                        <span className="code-cv-row-value code-cv-mono">{variable.valueType === "boolean" ? ((currentValues?.[variable.id] ?? variable.initialValue) ? "T" : "F") : formatLiveValue(currentValues?.[variable.id] ?? variable.initialValue ?? 0)}</span>
                        <span className="code-cv-row-chevron" aria-hidden="true">›</span>
                    </button>)}
                    {variables.length > 0 && !visibleVariables.length && <p className="code-cv-empty-note">No variables match “{query}”.</p>}
                    {!variables.length && <div className="code-cv-empty">
                        <strong>No variables yet</strong>
                        <p>Custom variables store a number or a true/false value your bot can read and change.</p>
                    </div>}
                </div>
                {newVariableButton}
            </aside>
            <main className="code-cv-detail">
                {!selectedVariable && <div className="code-cv-empty code-cv-detail-empty"><p>Select a variable to configure it.</p></div>}
                {selectedVariable && <div className="code-cv-form">
                    <div className="code-cv-detail-head">
                        <button type="button" className="code-cv-back" onClick={() => setShowDetail(false)} aria-label="Back to variable list"><span aria-hidden="true">‹</span></button>
                        <strong>{selectedVariable.name}</strong>
                    </div>
                    <label className="code-cv-field"><span>Name</span><DeferredTextInput key={`${selectedVariable.id}:${selectedVariable.name}`} aria-label="Variable name" disabled={disabled} value={selectedVariable.name} maxLength={40} onCommit={(name) => update(selectedIndex, { name })} className="code-cv-input code-cv-input-name" /></label>
                    <div className="code-cv-row-fields">
                        <div className="code-cv-field"><span id="cv-type-label">Type</span>
                            <div className="code-cv-segmented" role="group" aria-labelledby="cv-type-label">
                                {[["number", "Number"], ["boolean", "True / false"]].map(([type, label]) => <button key={type} type="button" disabled={disabled} aria-pressed={selectedVariable.valueType === type} className={selectedVariable.valueType === type ? "is-active" : ""} onClick={() => { if (selectedVariable.valueType !== type) update(selectedIndex, { valueType: type, initialValue: type === "boolean" ? false : 0 }); }}>{label}</button>)}
                            </div>
                        </div>
                        <div className="code-cv-field"><span id="cv-start-label">Starts at</span>
                            {selectedVariable.valueType === "boolean"
                                ? <div className="code-cv-segmented" role="group" aria-labelledby="cv-start-label">
                                    {[[false, "False"], [true, "True"]].map(([value, label]) => <button key={label} type="button" disabled={disabled} aria-pressed={Boolean(selectedVariable.initialValue) === value} className={Boolean(selectedVariable.initialValue) === value ? "is-active" : ""} onClick={() => update(selectedIndex, { initialValue: value })}>{label}</button>)}
                                </div>
                                : <DeferredNumberInput key={selectedVariable.id} aria-labelledby="cv-start-label" disabled={disabled} min={CUSTOM_NUMBER_MIN} max={CUSTOM_NUMBER_MAX} value={selectedVariable.initialValue ?? 0} onCommit={(initialValue) => update(selectedIndex, { initialValue })} className="code-cv-input code-cv-input-number code-cv-mono" />}
                        </div>
                    </div>
                    <div className="code-cv-live">
                        <span className="code-cv-live-dot" aria-hidden="true" />
                        <span>Live value</span>
                        <strong className="code-cv-mono">{formatLiveValue(liveValue)}</strong>
                        <span className="code-cv-live-uses">Used in {usedIn} node{usedIn === 1 ? "" : "s"}</span>
                    </div>
                    <button type="button" disabled={disabled} onClick={removeSelectedVariable} className="code-cv-delete"><TrashGlyph /> Delete variable</button>
                </div>}
            </main>
        </div>
    </section></div>;
}

function updateCustomVariableConfiguration(configuration, variableIndex, updates) {
    const variables = configuration?.customVariables ?? [];
    const current = variables[variableIndex];
    if (!current) return configuration;
    const typeChanged = updates.valueType && updates.valueType !== current.valueType;
    const customVariables = variables.map((variable, index) => index === variableIndex ? { ...variable, ...updates } : variable);
    if (!typeChanged) return { ...configuration, customVariables };
    return rewriteVariableActions({ ...configuration, customVariables }, current.id, (entry) => {
        const next = { ...entry, operation: "set" };
        delete next.terms;
        if (updates.valueType === "boolean") {
            next.value = false;
            delete next.operand;
        } else {
            delete next.value;
            next.terms = [{ operator: "set", operand: { type: "number", value: 0 } }];
            delete next.operand;
        }
        return next;
    });
}

function removeCustomVariableConfiguration(configuration, variableId) {
    const customVariables = (configuration?.customVariables ?? []).filter((variable) => variable.id !== variableId).map((variable) => {
        const next = { ...variable };
        delete next.conditions;
        return next;
    });
    const cleaned = pruneEmptyModifyRoots(rewriteVariableActions({ ...configuration, customVariables }, variableId, () => null));
    return rewriteConfigurationConditions(cleaned, (conditions) => filterVariableConditions(conditions, variableId));
}

function pruneEmptyModifyRoots(configuration) {
    const roots = (configuration?.roots ?? []).flatMap((root) => {
        if (root?.kind !== "modify") return [root];
        const branches = pruneModifyBranches(root.branches);
        return branches.length ? [{ ...root, branches }] : [];
    });
    return { ...configuration, roots };
}

function pruneModifyBranches(branches) {
    return (branches ?? []).map((branch) => ({
        ...branch,
        children: pruneModifyBranches(branch?.children),
    })).filter((branch) => hasExecutableAction(branch) || branch.children.length > 0);
}

function hasExecutableAction(branch) {
    const actions = Array.isArray(branch?.actions)
        ? branch.actions
        : branch?.action ? [branch] : [];
    return actions.some((entry) => entry?.action && entry.action !== "none");
}

function rewriteVariableActions(configuration, variableId, rewrite) {
    const mapBranch = (branch) => {
        const actions = (branch.actions ?? []).map((entry) => entry.action === "variable" && entry.variableId === variableId ? rewrite(entry) : entry).filter(Boolean);
        const legacyMatches = branch.action === "variable" && branch.variableId === variableId;
        const first = actions[0] ?? (legacyMatches ? { action: "none", selectable: BOT_CODE_SELECTABLES.OPPONENT } : null);
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
