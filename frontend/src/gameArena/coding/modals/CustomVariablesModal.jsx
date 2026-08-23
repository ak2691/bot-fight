import { useRef, useState } from "react";
import {
    CUSTOM_NUMBER_MAX,
    CUSTOM_NUMBER_MIN,
    truncateToNumberPrecision,
    MAX_CUSTOM_VARIABLE_SLOTS,
    countVariableSlots,
} from "../../botlogic/code/BotCode.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { filterCustomVariableEntries } from "../utils/customVariableSearch.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";

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
    return <input {...props} type="text" inputMode="decimal" value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={commit} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); commit(); event.currentTarget.blur(); } }} />;
}

export default function CustomVariablesModal({ configuration, currentValues, maxSlots = MAX_CUSTOM_VARIABLE_SLOTS, idPrefix = "custom", disabled, onChange, onClose }) {
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
        const variable = { id: createCustomVariableId(idPrefix), name: `Variable ${variables.length + 1}`, valueType: "number", initialValue: 0 };
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
        <header className="flex min-h-20 items-center justify-between gap-4 px-6"><div><h2 id="custom-variables-title" className="font-mono text-sm font-bold tracking-widest text-cyan-300">{'{ }'} / CUSTOM VARIABLES</h2><p className="mt-2 font-mono text-[9px] text-ink-muted">{slots}/{maxSlots} VARIABLE SLOTS</p></div><div className="flex flex-wrap justify-end gap-3"><button type="button" disabled={disabled || slots >= maxSlots} onClick={addVariable} className="min-h-11 rounded border border-emerald-700 bg-emerald-950/60 px-5 font-mono text-[10px] font-bold tracking-widest text-emerald-300 disabled:opacity-35">+ ADD VARIABLE</button><button type="button" onClick={onClose} aria-label="Close custom variables" className="code-toolbar-button code-toolbar-close"><span aria-hidden="true">×</span><span className="code-toolbar-close-label">CLOSE</span></button></div></header>
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
                        <label className="w-28 shrink-0 font-mono text-[8px] text-ink-muted">TYPE<select disabled={disabled} value={selectedVariable.valueType} onChange={(event) => update(selectedIndex, { valueType: event.target.value, initialValue: event.target.value === "boolean" ? false : 0 })} className="mt-1 h-8 w-full rounded border border-border-mid bg-zinc-950 px-2 font-mono text-[9px] text-white"><option value="number">NUMBER</option><option value="boolean">BOOLEAN</option></select></label>
                        <label className="w-28 shrink-0 font-mono text-[8px] text-ink-muted">STARTING VALUE{selectedVariable.valueType === "boolean" ? <select disabled={disabled} value={String(selectedVariable.initialValue ?? false)} onChange={(event) => update(selectedIndex, { initialValue: event.target.value === "true" })} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-white"><option value="false">FALSE</option><option value="true">TRUE</option></select> : <DeferredNumberInput key={selectedVariable.id} disabled={disabled} min={CUSTOM_NUMBER_MIN} max={CUSTOM_NUMBER_MAX} value={selectedVariable.initialValue ?? 0} onCommit={(initialValue) => update(selectedIndex, { initialValue })} className="mt-1 h-8 w-full rounded border border-border-lo bg-zinc-950 px-2 font-mono text-[9px] text-white" />}</label>
                    </div>
                </div>}
            </main>
        </div>
        <footer className="border-t border-border-lo px-6 py-4 font-mono text-[9px] text-ink-muted">ⓘ Variables can be referenced by conditional nodes and modify custom variable actions. Current values update live during runtime.</footer>
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
