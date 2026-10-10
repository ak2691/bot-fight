import { readWorkspaceShortcut } from "../addRootShortcut.js";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import RootNodePriorityInput from "../controls/RootNodePriorityInput.jsx";
import "./SearchRootNodes.css";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import { useExclusiveSearchMenu } from "../utils/codeMenuEvents.js";
import { priorityForNode } from "../../../../../shared/engine/botlogic/code/configuration/identifiers.js";
import { countChainSteps } from "../chains/chainEditing.js";

const FILTER_MIN_ITEMS = 6;

export default function SearchRootNodesModal({
    chains = null,
    onOpenChain = null,
    onRemoveChain = null,
    roots,
    nodes,
    disabled,
    canRemove,
    onSelect,
    onPriorityChange,
    onMoveRoot = null,
    onRemove,
    onDeleteAll,
    onClose,
    quick = false,
}) {
    const [query, setQuery] = useState("");
    // The Chains tab exists only where the workspace can open a chain.
    const [tab, setTab] = useState("roots");
    const showingChains = Boolean(chains) && tab === "chains";
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
            const bar = (button.closest("header") ?? button).getBoundingClientRect();
            setPopoverStyle({ top: Math.max(rect.bottom, bar.bottom) + 8, left: Math.max(8, Math.min(rect.left + rect.width / 2 - width / 2, window.innerWidth - width - 8)), width });
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
    const normalizedChainQuery = query.trim().toLocaleLowerCase();
    const matchingChains = (chains ?? []).filter((chain) => !normalizedChainQuery || chain.name.toLocaleLowerCase().includes(normalizedChainQuery));
    // Keyboard navigation and Enter work on whichever list the tab shows.
    const matchingItems = showingChains ? matchingChains : matchingNodes;
    // Short lists are read at a glance, so the filter box only appears once there is something to filter.
    const itemCount = showingChains ? (chains ?? []).length : roots.length;
    const showFilter = itemCount > FILTER_MIN_ITEMS || query !== "";
    // Without the filter box the arrow keys start on the first row.
    useEffect(() => {
        if (showFilter || !matchingItems.length) return;
        setActiveIndex(0);
        optionRefs.current[0]?.focus();
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [showFilter, tab]);
    const selectNode = (node) => {
        onSelect(node);
        onClose();
    };
    const selectItem = (item) => {
        if (!showingChains) {
            selectNode(item);
            return;
        }
        onOpenChain?.(item.id);
        onClose();
    };
    const changeTab = (next) => {
        setTab(next);
        setActiveIndex(-1);
        setMenuRowId(null);
        optionRefs.current = [];
        searchInputRef.current?.focus();
    };
    const moveFromSearch = (event) => {
        if (event.key === "Enter") {
            event.preventDefault();
            if (matchingItems[0]) selectItem(matchingItems[0]);
            return;
        }
        if (event.key === "ArrowDown") {
            event.preventDefault();
            if (!matchingItems.length) return;
            setActiveIndex(0);
            optionRefs.current[0]?.focus();
        }
    };
    const moveFromOption = (event, index) => {
        if (event.key === "ArrowDown") {
            event.preventDefault();
            const nextIndex = (index + 1) % matchingItems.length;
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
            const item = matchingItems[index];
            if (item) selectItem(item);
        }
    };
    // ---- Dragging a root to a new place in the order --------------------------------------------
    // Press and hold a row, then move: the row follows the pointer and a line shows where it will land. The gap nearest
    // the dragged row's top edge wins, so putting its top edge above the first row's drops it first, and just under a
    // row drops it after that row. Mouse and pen only (a touch drag would fight scrolling), and only while unfiltered.
    const [drag, setDrag] = useState(null);
    const swallowClickRef = useRef(false);
    const canDragRoots = Boolean(onMoveRoot) && !disabled && !showingChains && query.trim() === "";
    const gapIndexFor = (topEdge, fromIndex) => {
        const rows = optionRefs.current.slice(0, matchingNodes.length);
        const gaps = [];
        rows.forEach((row, index) => {
            if (!row || index === fromIndex) return;
            const rect = row.getBoundingClientRect();
            if (!gaps.length) gaps.push({ y: rect.top, slot: index });
            gaps.push({ y: rect.bottom, slot: index + 1 });
        });
        if (!gaps.length) return null;
        return gaps.reduce((best, gap) => (Math.abs(gap.y - topEdge) < Math.abs(best.y - topEdge) ? gap : best));
    };
    const beginRowDrag = (event, index) => {
        if (!canDragRoots || event.button !== 0 || event.pointerType === "touch" || event.target.closest?.("button,input,.code-rs-order,.code-rs-more-wrap")) return;
        const rowRect = event.currentTarget.getBoundingClientRect();
        const start = { x: event.clientX, y: event.clientY };
        const grabY = event.clientY - rowRect.top;
        const node = matchingNodes[index];
        let active = false;
        let landing = null;
        const move = (next) => {
            if (!active) {
                if (Math.hypot(next.clientX - start.x, next.clientY - start.y) < 5) return;
                active = true;
            }
            landing = gapIndexFor(next.clientY - grabY, index);
            const gap = landing ? optionRefs.current.slice(0, matchingNodes.length)[Math.max(0, Math.min(matchingNodes.length - 1, landing.slot))] : null;
            const container = gap?.parentElement.getBoundingClientRect();
            setDrag({ index, label: roots[node.rootIndex]?.name ?? "Root", top: next.clientY - grabY, left: rowRect.left, width: rowRect.width, height: rowRect.height, lineY: landing && container ? landing.y - container.top + gap.parentElement.scrollTop : null });
        };
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
            if (!active) return;
            swallowClickRef.current = true;
            window.setTimeout(() => { swallowClickRef.current = false; }, 60);
            setDrag(null);
            // `slot` counts rows with the dragged one removed from the list's order, so after removal it is the new index.
            if (landing) {
                const slot = landing.slot > index ? landing.slot - 1 : landing.slot;
                if (slot !== index) onMoveRoot(node.rootIndex, slot);
            }
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };
    return <aside ref={dialogRef} onWheel={(event) => event.stopPropagation()} style={popoverStyle} className={`code-rs ${quick ? "code-rs--quick" : ""}`} role="dialog" aria-modal="true" aria-label={showingChains ? "Chains" : "Roots"}>
        <div className="code-rs-top">
            {showFilter ? <label className="code-rs-search"><SearchGlyph /><span className="sr-only">{showingChains ? "Filter chains" : "Filter roots"}</span><input ref={searchInputRef} aria-label={showingChains ? "Filter chains" : "Filter roots"} name="root-search" type="search" value={query} onChange={(event) => { setQuery(event.target.value); setActiveIndex(-1); setMenuRowId(null); optionRefs.current = []; }} onKeyDown={moveFromSearch} placeholder={showingChains ? "Filter chains" : "Filter roots"} autoComplete="off" /><kbd className="code-rs-kbd">{readWorkspaceShortcut("search").toUpperCase()}</kbd></label> : <strong className="code-rs-title">{showingChains ? "Chains" : "Roots"}</strong>}
            <button type="button" className="code-rs-cancel" onClick={onClose}>Cancel</button>
        </div>
        {chains && <div className="code-rs-tabs" role="tablist" aria-label="Roots or chains">
            <button type="button" role="tab" aria-selected={!showingChains} className={!showingChains ? "is-active" : ""} onClick={() => changeTab("roots")}>Roots <span className="code-rs-mono">{roots.length}</span></button>
            <button type="button" role="tab" aria-selected={showingChains} className={showingChains ? "is-active" : ""} onClick={() => changeTab("chains")}>Chains <span className="code-rs-mono">{chains.length}</span></button>
        </div>}
        {showingChains ? <div className="code-rs-results" role="list">{matchingChains.length ? matchingChains.map((chain, index) => {
            const steps = countChainSteps(chain);
            return <div
                key={chain.id}
                ref={(element) => { optionRefs.current[index] = element; }}
                role="button"
                tabIndex={index === activeIndex ? 0 : -1}
                onKeyDown={(event) => moveFromOption(event, index)}
                onClick={() => selectItem(chain)}
                className={`code-rs-row code-rs-row--chain ${index === activeIndex ? "is-keyboard-active" : ""}`}
                aria-label={`Open ${chain.name}, ${steps} ${steps === 1 ? "step" : "steps"}`}
            >
                <div className="code-rs-label"><strong>{chain.name}</strong><small>{steps} {steps === 1 ? "step" : "steps"}</small></div>
                <button type="button" disabled={!canRemove || !onRemoveChain} tabIndex={index === activeIndex ? 0 : -1} onClick={(event) => { event.stopPropagation(); onRemoveChain(chain.id); }} onKeyDown={(event) => event.stopPropagation()} aria-label={`Delete ${chain.name}`} title={`Delete ${chain.name}`} className="code-rs-trash"><TrashGlyph /></button>
            </div>;
        }) : <p className="code-rs-empty">{chains.length ? "No matching chains" : "No chains yet"}</p>}</div>
        : <div className="code-rs-results" role="list">{drag && drag.lineY != null && <div className="code-rs-drop-line" style={{ top: drag.lineY }} />}{drag && <div className="code-rs-ghost" style={{ top: drag.top, left: drag.left, width: drag.width, height: drag.height }}>{drag.label}</div>}{matchingNodes.length ? matchingNodes.map((node, index) => {
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
                onPointerDown={(event) => beginRowDrag(event, index)}
                onClick={() => { if (!swallowClickRef.current) selectNode(node); }}
                className={`code-rs-row ${index === activeIndex ? "is-keyboard-active" : ""} ${canDragRoots ? "is-draggable" : ""} ${drag?.index === index ? "is-dragged" : ""}`}
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
        }) : <p className="code-rs-empty">No matching roots</p>}</div>}
        <footer className="code-rs-footer">
            <div className="code-rs-footer-row">
                <span className="code-rs-hints"><kbd className="code-rs-kbd">↑</kbd><kbd className="code-rs-kbd">↓</kbd> move <kbd className="code-rs-kbd">↵</kbd> {showingChains ? "open" : "jump"}</span>
                <span className="code-rs-count code-rs-mono">{matchingItems.length} of {showingChains ? chains.length : roots.length}</span>
            </div>
            {!showingChains && !query.trim() && <button type="button" disabled={disabled || !roots.length} onClick={onDeleteAll} className="code-rs-delete-all" aria-label="Delete all roots">Delete all roots</button>}
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
