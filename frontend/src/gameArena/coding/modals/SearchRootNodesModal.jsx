import { useRef, useState } from "react";
import RootNodePriorityInput from "../controls/RootNodePriorityInput.jsx";
import "./SearchRootNodes.css";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";

export default function SearchRootNodesModal({
    roots,
    nodes,
    disabled,
    canRemove,
    onSelect,
    onPriorityChange,
    onRemove,
    onDeleteAll,
    onClose,
}) {
    const [query, setQuery] = useState("");
    const dialogRef = useRef(null);
    const searchInputRef = useRef(null);
    useDialogFocus(dialogRef, { initialFocusRef: searchInputRef, onClose });
    useExclusiveSearchMenu(dialogRef, true, onClose);
    const matchingNodes = nodes.filter((node) => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const root = roots[node.rootIndex];
        const label = `Root ${Number(root?.createdOrder) + 1}`;
        const name = root?.name ?? "Root";
        return !normalizedQuery
            || `${name} ${label}`.toLocaleLowerCase().includes(normalizedQuery);
    });
    return <aside ref={dialogRef} onWheel={(event) => event.stopPropagation()} className="code-node-picker code-node-picker--roots absolute left-20 top-4 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl" role="dialog" aria-modal="true" aria-labelledby="search-root-nodes-title" tabIndex={-1}>
        <header className="mb-3 flex items-center justify-between gap-3"><strong id="search-root-nodes-title" className="tracking-[.12em] text-cyan-200">SEARCH ROOTS</strong><button type="button" onClick={onClose} aria-label="Close root search" className="text-slate-400 hover:text-white">×</button></header>
        <label className="code-node-search-label"><span className="sr-only">Search roots</span><input ref={searchInputRef} aria-label="Search roots" name="root-search" type="search" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search roots…" /></label>
        <div className="code-node-search-results code-root-search-results">{matchingNodes.length ? matchingNodes.map((node) => {
            const root = roots[node.rootIndex];
            const label = `Root ${Number(root?.createdOrder) + 1}`;
            const name = root?.name ?? "Root";
            return <div key={node.id} className="code-root-search-row">
                <span className="search-root-node-root-label">Root <RootNodePriorityInput priority={Number(root?.createdOrder) + 1} max={MAX_VISIBLE_NODES} disabled={disabled} onCommit={(priority) => onPriorityChange(node.rootIndex, priority)} ariaLabel={`Priority for ${label}`} className="search-root-node-priority" /></span>
                <button type="button" onClick={() => onSelect(node)} className="search-root-node-option"><strong>{name}</strong></button>
                <button type="button" disabled={!canRemove} onClick={() => onRemove(node.rootIndex)} aria-label={`Delete ${label}`} className="search-root-node-delete">×</button>
            </div>;
        }) : <p>NO MATCHING ROOTS</p>}</div>
        <footer className="code-root-search-footer"><span>{matchingNodes.length} RESULTS · {roots.length}/{MAX_VISIBLE_NODES} ROOTS</span><button type="button" disabled={disabled || !roots.length} onClick={onDeleteAll} className="search-root-delete-all" aria-label="Delete all roots">DELETE ALL</button></footer>
    </aside>;
}

const MAX_VISIBLE_NODES = 100;
