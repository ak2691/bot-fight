import { useRef, useState } from "react";
import {
    countVariableSlots,
} from "../../botlogic/code/BotCode.js";
import { CUSTOM_NUMBER_MAX, CUSTOM_NUMBER_MIN, truncateToNumberPrecision, MAX_CUSTOM_VARIABLE_SLOTS } from "../../botlogic/code/configuration/constants.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { filterCustomVariableEntries } from "../utils/customVariableSearch.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import AddIcon from "../controls/AddIcon.jsx";
import { describeCondition } from "../nodes/conditionSummary.js";
import { conditionSummaryLookups } from "../nodes/GraphNodes.jsx";
import { variableActionSummary } from "../nodes/actionNodePresentation.js";
import { variableActionTerms } from "../nodes/actionOperandEdits.js";
import { collectVariableUses, removeVariableFromConfiguration, rewriteVariableActions } from "../variableUsage.js";

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

function formatLiveValue(value) {
    return String(value);
}

function SearchGlyph() {
    return <svg viewBox="0 0 16 16" width="14" height="14" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

const placesLabel = (count) => `${count} place${count === 1 ? "" : "s"}`;

export default function CustomVariablesModal({ resetChoices = null, onResetChoiceChange = null, configuration, currentValues, stateVariables = [], selectableTypes, maxSlots = MAX_CUSTOM_VARIABLE_SLOTS, idPrefix = "custom", disabled, onChange, onClose, onJumpToUse }) {
    const dialogRef = useRef(null);
    const searchRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true });
    useExclusiveSearchMenu(dialogRef, true, onClose);
    const variables = configuration?.customVariables ?? [];
    const [query, setQuery] = useState("");
    const [selectedVariableId, setSelectedVariableId] = useState(() => variables[0]?.id ?? null);
    // Phones show the list, the detail and the uses as separate screens.
    const [screen, setScreen] = useState("list");
    const visibleVariables = filterCustomVariableEntries(variables, query);
    const effectiveSelectedVariableId = variables.some((variable) => variable.id === selectedVariableId) ? selectedVariableId : variables[0]?.id ?? null;
    const selectedIndex = variables.findIndex((variable) => variable.id === effectiveSelectedVariableId);
    const selectedVariable = selectedIndex >= 0 ? variables[selectedIndex] : null;
    const slots = countVariableSlots(configuration);
    const atLimit = slots >= maxSlots;
    const meterState = slots >= maxSlots ? "is-full" : slots >= maxSlots * 0.85 ? "is-near" : "";
    const update = (index, next) => onChange(updateCustomVariableConfiguration(configuration, index, next));
    const lookups = conditionSummaryLookups(stateVariables, selectableTypes);
    const uses = selectedVariable ? collectVariableUses(configuration, selectedVariable.id, {
        condition: (condition) => describeCondition(condition, lookups),
        action: (entry) => {
            const target = variables.find((variable) => variable.id === entry.variableId);
            if (!target) return "Variable";
            const terms = target.valueType === "boolean"
                ? [{ operator: "set", operand: entry.operand ?? { type: "boolean", value: entry.value ?? false } }]
                : variableActionTerms(entry);
            return `${target.name} = ${variableActionSummary({ target, terms, stateVariables })}`;
        },
    }) : [];
    const addVariable = () => {
        if (disabled || atLimit) return;
        const variable = { id: createCustomVariableId(idPrefix), name: `Variable ${variables.length + 1}`, valueType: "number", initialValue: 0 };
        onChange({ ...configuration, customVariables: [...variables, variable] });
        setSelectedVariableId(variable.id);
        setScreen("detail");
        setQuery("");
    };
    const removeSelectedVariable = () => {
        if (uses.length > 0 && !window.confirm(`Used in ${placesLabel(uses.length)}. Delete anyway?`)) return;
        const nextSelection = variables[selectedIndex + 1]?.id ?? variables[selectedIndex - 1]?.id ?? null;
        onChange(removeVariableFromConfiguration(configuration, selectedVariable.id));
        setSelectedVariableId(nextSelection);
        setScreen("list");
    };
    const jumpToUse = (use) => {
        onClose();
        onJumpToUse?.(use.target);
    };
    const handleKeyDown = (event) => {
        if (event.key === "/" && !/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName ?? "")) {
            event.preventDefault();
            searchRef.current?.focus();
        }
    };
    const liveValue = selectedVariable ? (currentValues?.[selectedVariable.id] ?? selectedVariable.initialValue ?? (selectedVariable.valueType === "boolean" ? false : 0)) : null;
    const newVariableButton = <button type="button" disabled={disabled || atLimit} onClick={addVariable} className="code-cv-new" title={atLimit ? "Variable limit reached" : undefined}><AddIcon className="code-cv-new-icon" /> New variable</button>;
    return <div className="code-custom-variables-overlay absolute inset-0 z-50 flex items-center justify-center overflow-hidden bg-black/75 p-6" role="presentation"><section ref={dialogRef} data-screen={screen} className="code-cv" role="dialog" aria-modal="true" aria-labelledby="custom-variables-title" tabIndex={-1} onKeyDown={handleKeyDown}>
        <header className="code-cv-header">
            <h2 id="custom-variables-title">Variables</h2>
            <span className={`code-cv-meter ${meterState}`} title={`${slots} of ${maxSlots} variable slots used`}>
                <span className="code-cv-meter-bar" aria-hidden="true"><b style={{ width: `${Math.min(100, Math.round((maxSlots > 0 ? slots / maxSlots : 0) * 100))}%` }} /></span>
                <span className="code-cv-mono">{slots} / {maxSlots}</span>
            </span>
            <button type="button" onClick={onClose} aria-label="Close variables" title="Close" className="code-cv-close"><span aria-hidden="true">×</span></button>
        </header>
        <div className="code-cv-body">
            <aside className="code-cv-list-pane">
                <label className="code-cv-search"><SearchGlyph /><span className="sr-only">Search variables</span><input ref={searchRef} aria-label="Search variables" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search" /><kbd>/</kbd></label>
                <div className="code-cv-list" role="listbox" aria-label="Variables">
                    {visibleVariables.map(({ variable }) => <button key={variable.id} type="button" role="option" aria-selected={variable.id === effectiveSelectedVariableId} onClick={() => { setSelectedVariableId(variable.id); setScreen("detail"); }} className={`code-cv-row ${variable.id === effectiveSelectedVariableId ? "is-selected" : ""}`}>
                        <span className="code-cv-row-name">{variable.name || "Untitled variable"}</span>
                        <span className={`code-cv-tag ${variable.valueType === "boolean" ? "is-boolean" : "is-number"}`}>{variable.valueType === "boolean" ? "True/false" : "Number"}</span>
                        <span className="code-cv-row-value code-cv-mono">{formatLiveValue(currentValues?.[variable.id] ?? variable.initialValue ?? (variable.valueType === "boolean" ? false : 0))}</span>
                        <span className="code-cv-row-chevron" aria-hidden="true">›</span>
                    </button>)}
                    {variables.length > 0 && !visibleVariables.length && <p className="code-cv-empty-note">No variables match “{query}”.</p>}
                    {!variables.length && <div className="code-cv-empty">
                        <strong>No variables yet</strong>
                        <p>Variables store a number or a true/false value your bot can read and change.</p>
                    </div>}
                </div>
                {newVariableButton}
            </aside>
            <main className="code-cv-detail">
                {!selectedVariable && <div className="code-cv-empty code-cv-detail-empty"><p>Select a variable to configure it.</p></div>}
                {selectedVariable && <div className="code-cv-form">
                    <div className="code-cv-detail-head">
                        <button type="button" className="code-cv-back" onClick={() => setScreen(screen === "uses" ? "detail" : "list")} aria-label={screen === "uses" ? "Back to variable" : "Back to variable list"}><span aria-hidden="true">‹</span></button>
                        <strong>{selectedVariable.name}</strong>
                    </div>
                    <label className="code-cv-field"><span>Name</span><DeferredTextInput key={`${selectedVariable.id}:${selectedVariable.name}`} aria-label="Variable name" disabled={disabled} value={selectedVariable.name} maxLength={40} onCommit={(name) => update(selectedIndex, { name })} className="code-cv-input code-cv-input-name" /></label>
                    <div className="code-cv-field"><span id="cv-type-label">Type</span>
                        <div className="code-cv-segmented" role="group" aria-labelledby="cv-type-label">
                            {[["number", "Number"], ["boolean", "True/false"]].map(([type, label]) => <button key={type} type="button" disabled={disabled} aria-pressed={selectedVariable.valueType === type} className={selectedVariable.valueType === type ? "is-active" : ""} onClick={() => { if (selectedVariable.valueType !== type) update(selectedIndex, { valueType: type, initialValue: type === "boolean" ? false : 0 }); }}>{label}</button>)}
                        </div>
                    </div>
                    <div className="code-cv-field"><span id="cv-start-label">Starts at</span>
                        {selectedVariable.valueType === "boolean"
                            ? <div className="code-cv-segmented" role="group" aria-labelledby="cv-start-label">
                                {[[false, "False"], [true, "True"]].map(([value, label]) => <button key={label} type="button" disabled={disabled} aria-pressed={Boolean(selectedVariable.initialValue) === value} className={Boolean(selectedVariable.initialValue) === value ? "is-active" : ""} onClick={() => update(selectedIndex, { initialValue: value })}>{label}</button>)}
                            </div>
                            : <DeferredNumberInput key={selectedVariable.id} aria-labelledby="cv-start-label" disabled={disabled} min={CUSTOM_NUMBER_MIN} max={CUSTOM_NUMBER_MAX} value={selectedVariable.initialValue ?? 0} onCommit={(initialValue) => update(selectedIndex, { initialValue })} className="code-cv-input code-cv-input-number code-cv-mono" />}
                    </div>
                    <div className="code-cv-rule" />
                    <div className="code-cv-field"><span>Live value</span><span className="code-cv-live"><span className="code-cv-live-dot" aria-hidden="true" /><span className="code-cv-mono">{formatLiveValue(liveValue)}</span></span></div>
                    {resetChoices && onResetChoiceChange && <div className="code-cv-field"><span id="cv-carry-label">Next round</span>
                        <div className="code-cv-segmented" role="group" aria-labelledby="cv-carry-label">
                            {[[false, "Keep last value"], [true, "Reset to start"]].map(([reset, label]) => <button key={label} type="button" aria-pressed={(resetChoices[selectedVariable.id] === true) === reset} className={(resetChoices[selectedVariable.id] === true) === reset ? "is-active" : ""} onClick={() => onResetChoiceChange(selectedVariable.id, reset)}>{label}</button>)}
                        </div>
                    </div>}
                    <button type="button" className="code-cv-field code-cv-usedrow" disabled={uses.length === 0} onClick={() => setScreen("uses")}>
                        <span>{uses.length ? `Used in ${placesLabel(uses.length)}` : "Not used yet"}</span>
                        {uses.length > 0 && <span className="code-cv-usedrow-go" aria-hidden="true">{placesLabel(uses.length)} ›</span>}
                    </button>
                    {uses.length > 0 && <ul className="code-cv-uses" aria-label={`Where ${selectedVariable.name} is used`}>
                        {uses.map((use) => <li key={use.key}>
                            <button type="button" className="code-cv-use" onClick={() => jumpToUse(use)} title={`${use.where}: ${use.text}`}>
                                <span className="code-cv-use-kind">{use.kind}</span>
                                <span className="code-cv-use-text">{use.where} › {use.text}</span>
                            </button>
                        </li>)}
                    </ul>}
                    <button type="button" disabled={disabled} onClick={removeSelectedVariable} className="code-cv-delete">Delete variable</button>
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
    const customVariables = variables.map((variable, index) => (index === variableIndex ? { ...variable, ...updates } : variable));
    if (!typeChanged) return { ...configuration, customVariables };
    // A changed type resets the variable (and the actions that write it, anywhere) to the default for the new type.
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
