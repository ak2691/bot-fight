import { useRef, useState } from "react";
import RootNodePriorityInput from "../controls/RootNodePriorityInput.jsx";
import "./SearchRootNodes.css";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import { priorityForNode } from "../../botlogic/code/configuration/identifiers.js";

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
    quick = false,
}) {
    const [query, setQuery] = useState("");
    const [activeIndex, setActiveIndex] = useState(-1);
    const dialogRef = useRef(null);
    const searchInputRef = useRef(null);
    const optionRefs = useRef([]);
    useDialogFocus(dialogRef, { initialFocusRef: searchInputRef, onClose });
    useExclusiveSearchMenu(dialogRef, true, onClose);
    const orderedNodes = [...nodes].sort((first, second) => (
        rootPriority(roots, first) - rootPriority(roots, second)
        || first.rootIndex - second.rootIndex
    ));
    const matchingNodes = orderedNodes.filter((node) => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const root = roots[node.rootIndex];
        const priority = priorityForNode(root, node.rootIndex + 1);
        const label = `Root ${priority}`;
        const name = root?.name ?? "Root";
        const priorityLabel = `Priority ${priority}`;
        return !normalizedQuery
            || `${name} ${label} ${priorityLabel} root-${priority} ${priority}`.toLocaleLowerCase().includes(normalizedQuery);
    });
    const selectNode = (node) => {
        onSelect(node);
        onClose();
    };
    const moveFromSearch = (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (matchingNodes[0]) selectNode(matchingNodes[0]);
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!matchingNodes.length) return;
            setActiveIndex(0);
            optionRefs.current[0]?.focus();
        }
    };
    const moveFromOption = (event, index) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (index + 1) % matchingNodes.length;
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === "ArrowUp") {
            event.preventDefault();
            if (index === 0) {
                setActiveIndex(-1);
                searchInputRef.current?.focus();
                return;
            }
            const nextIndex = index - 1;
            setActiveIndex(nextIndex);
            optionRefs.current[nextIndex]?.focus();
            return;
        }
        if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            const node = matchingNodes[index];
            if (node) selectNode(node);
        }
    };
    return <aside ref={dialogRef} onWheel={(event) => event.stopPropagation()} className={`code-node-picker code-node-picker--roots absolute left-20 top-4 z-40 w-80 border bg-[#15191d] p-4 font-mono text-[10px] text-white shadow-2xl ${quick ? "code-node-picker--quick-roots" : ""}`} role="dialog" aria-modal="true" aria-labelledby="search-root-nodes-title" tabIndex={-1}>
        <header className="mb-3 flex items-center justify-between gap-3"><strong id="search-root-nodes-title" className="tracking-[.12em] text-cyan-200">{quick ? "QUICK SEARCH ROOTS" : "SEARCH ROOTS"}</strong><button type="button" onClick={onClose} aria-label="Close root search" className="modal-close-button"><span aria-hidden="true">×</span></button></header>
        <label className="code-node-search-label"><span className="sr-only">Search roots</span><input ref={searchInputRef} aria-label="Search roots" name="root-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); optionRefs.current = []; }} onKeyDown={moveFromSearch} placeholder={quick ? "Jump to a root…" : "Search roots…"} /></label>
        <div className="code-node-search-results code-root-search-results">{matchingNodes.length ? matchingNodes.map((node, index) => {
            const root = roots[node.rootIndex];
            const priority = priorityForNode(root, node.rootIndex + 1);
            const label = `Root ${priority}`;
            const name = root?.name ?? "Root";
            return <div
                key={node.id}
                ref={(element) => { optionRefs.current[index] = element; }}
                role="button"
                tabIndex={index === activeIndex ? 0 : -1}
                onKeyDown={(event) => moveFromOption(event, index)}
                onClick={() => selectNode(node)}
                className={`code-root-search-row ${index === activeIndex ? "is-keyboard-active" : ""}`}
                aria-label={`Go to ${name}, ${label}`}
            >
                <div className="search-root-node-priority-wrap" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <RootNodePriorityInput priority={priority} max={MAX_VISIBLE_NODES} disabled={disabled} onCommit={(nextPriority) => onPriorityChange(node.rootIndex, nextPriority)} ariaLabel={`Priority for ${label}`} className="search-root-node-priority" />
                </div>
                <div className="search-root-node-label"><strong>{name}</strong><small>{label}</small></div>
                <button type="button" disabled={!canRemove} onClick={(event) => { event.stopPropagation(); onRemove(node.rootIndex); }} onKeyDown={(event) => event.stopPropagation()} aria-label={`Delete ${label}`} className="search-root-node-delete">×</button>
            </div>;
        }) : <p>NO MATCHING ROOTS</p>}</div>
        <footer className="code-root-search-footer"><span>{matchingNodes.length} RESULTS · {roots.length}/{MAX_VISIBLE_NODES} ROOTS</span><button type="button" disabled={disabled || !roots.length} onClick={onDeleteAll} className="search-root-delete-all" aria-label="Delete all roots">DELETE ALL</button></footer>
    </aside>;
}

function rootPriority(roots, node) {
    return priorityForNode(roots[node.rootIndex], node.rootIndex + 1);
}

const MAX_VISIBLE_NODES = 100;
