import { useEffect, useLayoutEffect, useRef, useState } from "react";
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
    const [menuRowId, setMenuRowId] = useState(null);
    const [popoverStyle, setPopoverStyle] = useState(null);
    const dialogRef = useRef(null);
    const searchInputRef = useRef(null);
    const optionRefs = useRef([]);
    useDialogFocus(dialogRef, { initialFocusRef: searchInputRef, onClose });
    useExclusiveSearchMenu(dialogRef, true, onClose);
    // Anchor the popover under the toolbar search button (phones use a full-width sheet from CSS).
    useLayoutEffect(() => {
        const place = () => {
            const button = dialogRef.current?.closest(".code-workspace")?.querySelector(".code-tb-search");
            if (!button) { setPopoverStyle(null); return; }
            const rect = button.getBoundingClientRect();
            const width = Math.min(Math.max(330, rect.width), window.innerWidth - 16);
            setPopoverStyle({ top: rect.bottom + 4, left: Math.max(8, Math.min(rect.left, window.innerWidth - width - 8)), width });
        };
        place();
        window.addEventListener("resize", place);
        return () => window.removeEventListener("resize", place);
    }, []);
    // Clicking outside closes the popover (the toolbar search button just reopens it).
    useEffect(() => {
        const closeOutside = (event) => {
            const target = event.target;
            if (!(target instanceof Element) || dialogRef.current?.contains(target) || target.closest(".code-tb-search")) return;
            onClose();
        };
        document.addEventListener("pointerdown", closeOutside, true);
        return () => document.removeEventListener("pointerdown", closeOutside, true);
    }, [onClose]);
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
    return <aside ref={dialogRef} onWheel={(event) => event.stopPropagation()} style={popoverStyle} className={`code-rs ${quick ? "code-rs--quick" : ""}`} role="dialog" aria-modal="true" aria-label="Search roots">
        <div className="code-rs-top">
            <label className="code-rs-search"><SearchGlyph /><span className="sr-only">Search roots</span><input ref={searchInputRef} aria-label="Search roots" name="root-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); setMenuRowId(null); optionRefs.current = []; }} onKeyDown={moveFromSearch} placeholder="Search roots" autoComplete="off" /><kbd className="code-rs-kbd">/</kbd></label>
            <button type="button" className="code-rs-cancel" onClick={onClose}>Cancel</button>
        </div>
        <div className="code-rs-results" role="list">{matchingNodes.length ? matchingNodes.map((node, index) => {
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
                className={`code-rs-row ${index === activeIndex ? "is-keyboard-active" : ""}`}
                aria-label={`Go to ${name}, ${label}`}
            >
                <div className="code-rs-order" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <RootNodePriorityInput priority={priority} max={MAX_VISIBLE_NODES} disabled={disabled} onCommit={(nextPriority) => onPriorityChange(node.rootIndex, nextPriority)} ariaLabel={`Priority for ${label}`} className="code-rs-order-input" />
                </div>
                <div className="code-rs-label"><strong>{name}</strong><small>{rootSummary(root)}</small></div>
                <button type="button" disabled={!canRemove} tabIndex={index === activeIndex ? 0 : -1} onClick={(event) => { event.stopPropagation(); onRemove(node.rootIndex); }} onKeyDown={(event) => event.stopPropagation()} aria-label={`Delete ${label}`} title={`Delete ${name}`} className="code-rs-trash"><TrashGlyph /></button>
                <div className="code-rs-more-wrap" onClick={(event) => event.stopPropagation()} onKeyDown={(event) => event.stopPropagation()}>
                    <button type="button" className="code-rs-more" aria-haspopup="menu" aria-expanded={menuRowId === node.id} aria-label={`More actions for ${name}`} onClick={() => setMenuRowId((current) => current === node.id ? null : node.id)}>⋯</button>
                    {menuRowId === node.id && <div className="code-rs-menu" role="menu"><button type="button" role="menuitem" disabled={!canRemove} onClick={() => { setMenuRowId(null); onRemove(node.rootIndex); }}>Delete</button></div>}
                </div>
            </div>;
        }) : <p className="code-rs-empty">No matching roots</p>}</div>
        <footer className="code-rs-footer">
            <div className="code-rs-footer-row">
                <span className="code-rs-hints"><kbd className="code-rs-kbd">↑</kbd><kbd className="code-rs-kbd">↓</kbd> move <kbd className="code-rs-kbd">↵</kbd> jump</span>
                <span className="code-rs-count code-rs-mono">{matchingNodes.length} of {roots.length}</span>
            </div>
            {!query.trim() && <button type="button" disabled={disabled || !roots.length} onClick={onDeleteAll} className="code-rs-delete-all" aria-label="Delete all roots">Delete all roots</button>}
        </footer>
    </aside>;
}

function SearchGlyph() {
    return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M10.5 10.5 14 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" /></svg>;
}

function TrashGlyph() {
    return <svg viewBox="0 0 16 16" width="15" height="15" aria-hidden="true"><path d="M3 4.5h10M6.5 4.5V3h3v1.5M4.5 4.5l.6 8h5.8l.6-8M7 7v3.5M9 7v3.5" fill="none" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

// "3 conditionals · 2 actions", or "Empty" for a root with no conditionals.
function rootSummary(root) {
    let conditionals = 0;
    let actions = 0;
    const visit = (branch) => {
        conditionals += 1;
        const entries = Array.isArray(branch?.actions) ? branch.actions : branch?.action ? [branch] : [];
        actions += entries.filter((entry) => entry?.action && entry.action !== "none").length;
        (branch?.children ?? []).forEach(visit);
    };
    (root?.branches ?? []).forEach(visit);
    if (!conditionals && !actions) return "Empty";
    return `${conditionals} conditional${conditionals === 1 ? "" : "s"} · ${actions} action${actions === 1 ? "" : "s"}`;
}

function rootPriority(roots, node) {
    return priorityForNode(roots[node.rootIndex], node.rootIndex + 1);
}

const MAX_VISIBLE_NODES = 100;
