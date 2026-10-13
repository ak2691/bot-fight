import { useCallback, useMemo, useRef, useState } from "react";
import LaneMenuShell, { MenuRailItem } from "./LaneMenuShell.jsx";
import { LaneIcon } from "./laneIcons.jsx";
import { flatItems, initialHighlight, sectionsFor, stepHighlight } from "./menuModel.js";

/**
 * The condition menu, opened from a card's or switch's "+ Condition". Groups are the rail (with counts; an empty group
 * fades), the list is one scrolling column with sticky headers. Typing filters live and highlights the first match;
 * ↑ ↓ move, Enter picks. Picking calls `onPick(item)`, and the board adds the condition and opens its editor.
 *
 * `groups` comes from conditionMenuGroups (conditionMenu.js); `onOpenVariables` opens the Variables dialog from the
 * empty Variables group.
 */
export default function LaneConditionMenu({ anchor, groups, onPick, onOpenVariables, onClose }) {
    const [query, setQuery] = useState("");
    const [highlight, setHighlight] = useState(() => initialHighlight(flatItems(sectionsFor(groups, "")).length));
    const [activeGroup, setActiveGroup] = useState(groups[0]?.id ?? null);
    const listRef = useRef(null);
    const headRefs = useRef(new Map());
    const itemRefs = useRef(new Map());

    const sections = useMemo(() => sectionsFor(groups, query), [groups, query]);
    const flat = useMemo(() => flatItems(sections), [sections]);
    const shownIndex = new Map(flat.map((item, index) => [item.id, index]));

    const changeQuery = (value) => {
        setQuery(value);
        setHighlight(initialHighlight(flatItems(sectionsFor(groups, value)).length));
    };

    const choose = useCallback((index) => {
        const item = flat[index];
        if (item) onPick(item);
    }, [flat, onPick]);

    const onKey = (action) => {
        if (action === "choose") {
            choose(highlight);
            return;
        }
        const next = stepHighlight(highlight, flat.length, action);
        setHighlight(next);
        const item = flat[next];
        if (item) itemRefs.current.get(item.id)?.scrollIntoView?.({ block: "nearest" });
    };

    const jumpTo = (groupId) => {
        setActiveGroup(groupId);
        headRefs.current.get(groupId)?.scrollIntoView?.({ block: "start" });
    };

    // The rail follows the list: the last section whose header has scrolled to the top is the active one.
    const onScroll = () => {
        const list = listRef.current;
        if (!list) return;
        let current = sections[0]?.id ?? null;
        for (const section of sections) {
            const head = headRefs.current.get(section.id);
            if (head && head.offsetTop - list.scrollTop <= 8) current = section.id;
        }
        if (current !== activeGroup) setActiveGroup(current);
    };

    const rail = sections.map((section) => (
        <MenuRailItem
            key={section.id}
            label={section.label}
            tone={section.tone}
            count={section.count}
            on={section.id === activeGroup}
            onSelect={() => jumpTo(section.id)}
        />
    ));

    return (
        <LaneMenuShell
            label="Condition menu"
            anchor={anchor}
            query={query}
            onQuery={changeQuery}
            placeholder="Search conditions"
            onKey={onKey}
            onClose={onClose}
            rail={rail}
        >
            <div className="lane-menu2__list" ref={listRef} onScroll={onScroll}>
                {sections.filter((section) => !query || section.items.length > 0).map((section) => (
                    <section key={section.id} aria-label={section.label}>
                        <div
                            className="lane-menu2__sec"
                            style={{ color: section.tone }}
                            ref={(node) => { if (node) headRefs.current.set(section.id, node); else headRefs.current.delete(section.id); }}
                        >
                            {section.label.toUpperCase()}
                        </div>
                        {section.id === "variables" && section.items.length === 0 && !query && (
                            <div className="lane-menu2__empty">
                                No variables yet.{" "}
                                <button type="button" className="lane-menu2__link" onClick={onOpenVariables}>Open Variables</button>
                            </div>
                        )}
                        {section.items.map((item) => {
                            const index = shownIndex.get(item.id);
                            const hi = index === highlight;
                            return (
                                <button
                                    key={item.id}
                                    type="button"
                                    role="option"
                                    aria-selected={hi}
                                    className={`lane-menu2__item${hi ? " is-hi" : ""}`}
                                    ref={(node) => { if (node) itemRefs.current.set(item.id, node); else itemRefs.current.delete(item.id); }}
                                    onMouseEnter={() => setHighlight(index)}
                                    onClick={() => choose(index)}
                                >
                                    <LaneIcon name={item.icon} size={15} className="lane-menu2__item-icon" />
                                    <span className="lane-menu2__item-name">{item.name}</span>
                                    <span className="lane-menu2__item-desc">{item.description}</span>
                                </button>
                            );
                        })}
                    </section>
                ))}
                {flat.length === 0 && query && <p className="lane-menu2__empty">Nothing matches “{query}”.</p>}
            </div>
        </LaneMenuShell>
    );
}
