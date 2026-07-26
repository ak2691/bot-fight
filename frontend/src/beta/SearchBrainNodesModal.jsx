import { useState } from "react";
import BrainNodePriorityInput from "./BrainNodePriorityInput.jsx";
import "./SearchBrainNodesModal.css";

function clamp(value, min, max) {
    return Math.max(min, Math.min(max, value));
}

export default function SearchBrainNodesModal({
    containerRef,
    brainNodes,
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
    const [position, setPosition] = useState({ x: 20, y: 20 });
    const [panelElement, setPanelElement] = useState(null);
    const matchingNodes = nodes.filter((node) => {
        const normalizedQuery = query.trim().toLocaleLowerCase();
        const brainNode = brainNodes[node.brainNodeIndex];
        return !normalizedQuery
            || String(brainNode?.name ?? "").toLocaleLowerCase().includes(normalizedQuery)
            || String(node.brainNodeIndex + 1).includes(normalizedQuery);
    });
    const beginDrag = (event) => {
        if (event.button !== 0 || event.target?.closest?.("button,input")) return;
        event.preventDefault();
        const containerRect = containerRef.current?.getBoundingClientRect();
        const panelRect = panelElement?.getBoundingClientRect();
        if (!containerRect || !panelRect) return;
        const start = { x: event.clientX, y: event.clientY, position };
        const move = (next) => setPosition({
            x: clamp(start.position.x + next.clientX - start.x, 0, Math.max(0, containerRect.width - panelRect.width)),
            y: clamp(start.position.y + next.clientY - start.y, 0, Math.max(0, containerRect.height - panelRect.height)),
        });
        const end = () => {
            window.removeEventListener("pointermove", move);
            window.removeEventListener("pointerup", end);
            window.removeEventListener("pointercancel", end);
        };
        window.addEventListener("pointermove", move);
        window.addEventListener("pointerup", end);
        window.addEventListener("pointercancel", end);
    };

    return <aside ref={setPanelElement} onWheel={(event) => event.stopPropagation()} className="absolute z-30 flex w-[min(44rem,calc(100%-2rem))] flex-col rounded border border-border-mid bg-[#11171c] p-4 shadow-2xl" style={{ left: position.x, top: position.y }} role="dialog" aria-label="Search brain nodes panel">
        <header onPointerDown={beginDrag} className="flex h-11 cursor-move select-none items-center justify-between font-mono text-sm font-bold tracking-widest text-cyan-300"><span>⌕ / SEARCH NODES</span><button type="button" onClick={onClose} aria-label="Close brain node search" className="h-9 w-9 rounded border border-border-mid text-ink-mid hover:border-cyan-600 hover:text-white">X</button></header>
        <div className="mt-2 flex gap-3"><input autoFocus aria-label="Search brain nodes" value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Type node name or index..." className="h-11 min-w-0 flex-1 rounded border border-cyan-700 bg-zinc-950 px-4 font-mono text-[11px] text-white outline-none focus:border-cyan-400" /><button type="button" disabled={disabled || !brainNodes.length} onClick={onDeleteAll} className="search-brain-delete-all" aria-label="Delete all brain nodes" title="Delete all brain nodes"><svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M9 7V4h6v3m3 0-1 13H7L6 7m4 4v5m4-5v5" /></svg><span>DELETE ALL</span></button></div>
        <div className="mt-3 rounded border border-border-lo bg-zinc-950/40 p-3"><div className="mb-2 flex justify-between font-mono text-[9px] tracking-widest text-ink-muted"><span>{matchingNodes.length} RESULTS</span><span>{brainNodes.length}/{MAX_VISIBLE_NODES} NODES</span></div><div className="max-h-72 min-h-12 space-y-2 overflow-y-auto overscroll-contain">{matchingNodes.length ? matchingNodes.map((node) => {
            const label = brainNodes[node.brainNodeIndex]?.name;
            return <div key={node.id} className="flex h-10 gap-2">
                <BrainNodePriorityInput priority={node.brainNodeIndex + 1} max={brainNodes.length} disabled={disabled} onCommit={(priority) => onPriorityChange(node.brainNodeIndex, priority)} ariaLabel={`Priority for ${label ?? `brain node ${node.brainNodeIndex + 1}`}`} className="search-brain-node-priority" />
                <button type="button" onClick={() => onSelect(node)} className="search-brain-node-option">{label}</button>
                <button type="button" disabled={!canRemove} onClick={() => onRemove(node.brainNodeIndex)} aria-label={`Delete ${label ?? `brain node ${node.brainNodeIndex + 1}`}`} className="search-brain-node-delete">X</button>
            </div>;
        }) : <div className="flex h-10 items-center px-2 font-mono text-[9px] tracking-widest text-ink-muted">NO MATCHING NODES</div>}</div></div>
        <footer className="mt-3 border-t border-border-lo pt-3 font-mono text-[9px] tracking-wide text-ink-muted">ⓘ Click a node to focus it in the workspace&nbsp;&nbsp;•&nbsp;&nbsp;Delete nodes directly from search <span className="float-right text-cyan-300">{matchingNodes.length} RESULTS</span></footer>
    </aside>;
}

const MAX_VISIBLE_NODES = 100;
