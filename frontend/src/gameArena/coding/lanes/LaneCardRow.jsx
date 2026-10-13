import { memo, useRef } from "react";
import { MAX_FOLLOW_UP_DEPTH, MAX_LANE_CONDITIONS_PER_ENTRY } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { ACTION_HEADS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import LaneActionEditor from "./LaneActionEditor.jsx";
import LaneConditionEditor from "./LaneConditionEditor.jsx";
import LaneMenu from "./LaneMenu.jsx";
import { ActionGlyph, LaneIcon } from "./laneIcons.jsx";

/**
 * One card as a row: the priority number (top-level cards only, muted), the action tile (a chevron in the action's kind
 * colour; clicking it opens the action editor under the row), then the attached movement of an ability card (smaller
 * tiles joined by "＋", each opening its own editor), the condition tiles, and a dashed "+ Condition" (which opens the
 * condition menu, anchored to it). The ⋯ menu shows on hover (always, on touch and phones). Follow-ups render recursively
 * under their parent, indented with a left line and no number. An open editor (action, attached movement or condition)
 * sits under the row.
 *
 * Props: `card`; `views` (Map card -> { label, head, tone, abilityId, abilityName, canHaveFollowUps, tiles, attached,
 * definition }, built by the board per configuration); `scope`; `depth` (0 for a top-level card); `index` and `count`
 * among its siblings; `highlight` ({ strong, faint }: the live bar sets, see liveHighlight.js); `editing` (`{ kind:
 * "action", id }`, `{ kind: "attached", id, attached }`, `{ kind, id, index }` for an open condition editor, or null);
 * `moveTargets` (top-level cards only: `[{ label, toScope }]` for the ⋯ menu's "Move to" rows, else null);
 * `customVariables`; `disabled` (read-only: no menu, no add, tiles inert); `onAct(kind, payload)`.
 *
 * Memoised: a live tick re-renders only the rows whose bar changed (`sameRowProps` checks the card's own subtree).
 */
const LaneCardRow = memo(function LaneCardRow({ card, views, scope, depth, index, count, highlight, editing, moveTargets, customVariables, leadAbilityChoices, disabled, onAct }) {
    const rowRef = useRef(null);
    const view = views.get(card);
    if (!view) return null;
    const enabled = card.enabled !== false;
    const base = { scope, cardId: card.id };
    const editingIndex = editing?.kind === "card" && editing.id === card.id ? editing.index : null;
    const actionOpen = editing?.kind === "action" && editing.id === card.id;
    const attachedOpen = editing?.kind === "attached" && editing.id === card.id ? editing.attached : null;
    const followUps = Array.isArray(card.followUps) ? card.followUps : [];
    const canAddCondition = !disabled && card.conditions.length < MAX_LANE_CONDITIONS_PER_ENTRY;
    const canFollow = !disabled && view.canHaveFollowUps && depth < MAX_FOLLOW_UP_DEPTH;
    const canAttach = !disabled && view.head === ACTION_HEADS.ABILITY;
    const isStrong = highlight.strong.has(card.id);
    const isFaint = !isStrong && highlight.faint.has(card.id);
    const attachedView = attachedOpen ? view.attached.find((item) => item.kind === attachedOpen) : null;

    const menuItems = [
        ...(canFollow ? [{ label: "Add follow-up", icon: "cornerDownRight", onSelect: () => onAct("open-card-menu", { ...base, mode: "follow", anchor: rowRef.current }) }] : []),
        ...(canAttach ? [{ label: "Add movement while casting", icon: "walk", onSelect: () => onAct("open-card-menu", { ...base, mode: "attach", anchor: rowRef.current }) }] : []),
        ...(moveTargets ?? []).map((target) => ({ label: target.label, icon: "arrowUp", onSelect: () => onAct("move-scope", { ...base, toScope: target.toScope }) })),
        { label: "Duplicate", icon: "copy", onSelect: () => onAct("duplicate", base) },
        { label: "Move up", icon: "arrowUp", disabled: index === 0, onSelect: () => onAct("move", { ...base, toIndex: index - 1 }) },
        { label: "Move down", icon: "arrowDown", disabled: index >= count - 1, onSelect: () => onAct("move", { ...base, toIndex: index + 1 }) },
        { divider: true },
        { label: enabled ? "Turn off" : "Turn on", icon: enabled ? "eyeOff" : "eye", onSelect: () => onAct("toggle", base) },
        { label: "Delete", icon: "trash", danger: true, onSelect: () => onAct("delete", base) },
    ];

    const openCondition = editingIndex !== null && card.conditions[editingIndex] ? card.conditions[editingIndex] : null;
    const openTile = editingIndex !== null ? view.tiles[editingIndex] : null;

    return (
        <li
            className={`lane-card${enabled ? "" : " is-off"}${isStrong ? " is-live" : ""}${isFaint ? " is-live-faint" : ""}`}
            data-entry-id={card.id}
            style={{ "--lane-tone": view.tone }}
            onDragOver={(event) => {
                if (disabled) return;
                event.preventDefault();
                event.stopPropagation();
            }}
            onDrop={(event) => {
                if (disabled) return;
                event.preventDefault();
                event.stopPropagation();
                onAct("drop", base);
            }}
        >
            <div
                ref={rowRef}
                className="lane-row"
                tabIndex={0}
                draggable={!disabled}
                title={disabled ? undefined : "Drag to reorder, or Alt+↑ / Alt+↓"}
                onDragStart={(event) => {
                    event.stopPropagation();
                    event.dataTransfer.effectAllowed = "move";
                    event.dataTransfer.setData("text/plain", card.id);
                    onAct("drag-start", base);
                }}
                onDragEnd={() => onAct("drag-end", base)}
                onKeyDown={(event) => {
                    // Alt+↑ / Alt+↓ moves the focused card among its siblings.
                    if (disabled || !event.altKey || (event.key !== "ArrowUp" && event.key !== "ArrowDown")) return;
                    event.preventDefault();
                    const toIndex = index + (event.key === "ArrowUp" ? -1 : 1);
                    if (toIndex >= 0 && toIndex < count) onAct("move", { ...base, toIndex });
                }}
            >
                {depth === 0 && <span className="lane-row__num" aria-label={`Priority ${index + 1}`}>{index + 1}</span>}
                <div className="lane-tiles">
                    <ActionTile view={view} disabled={disabled} open={actionOpen} onOpen={() => onAct("open-action", base)} />
                    {view.attached.map((item) => (
                        <AttachedTile
                            key={item.kind}
                            item={item}
                            open={attachedOpen === item.kind}
                            disabled={disabled}
                            onOpen={() => onAct("open-attached", { ...base, kind: item.kind })}
                        />
                    ))}
                    <ConditionTiles
                        tiles={view.tiles}
                        editingIndex={editingIndex}
                        disabled={disabled}
                        onOpen={(conditionIndex) => onAct("open-condition", { ...base, index: conditionIndex })}
                        onAdd={canAddCondition ? (anchor) => onAct("open-condition-menu", { ...base, kind: "card", index: card.conditions.length, anchor }) : null}
                    />
                </div>
                {!enabled && <span className="lane-row__off">Off</span>}
                {!disabled && <LaneMenu label="Card options" triggerClassName="lane-more" className="lane-row__menu" items={menuItems} />}
            </div>
            {actionOpen && (
                <LaneActionEditor
                    entry={card.action}
                    definition={view.definition}
                    label={view.label}
                    customVariables={customVariables}
                    leadAbilityChoices={leadAbilityChoices}
                    disabled={disabled}
                    onField={(key, value) => onAct("set-action-field", { ...base, key, value })}
                    onChange={(anchor) => onAct("open-card-menu", { ...base, mode: "swap", anchor })}
                    onDelete={() => onAct("delete", base)}
                    onDetails={view.abilityId != null ? (anchor) => onAct("open-details", { anchor, abilityId: view.abilityId }) : null}
                />
            )}
            {attachedView && (
                <LaneActionEditor
                    entry={card[attachedOpen]}
                    definition={attachedView.definition}
                    label={attachedView.label}
                    customVariables={customVariables}
                    leadAbilityChoices={leadAbilityChoices}
                    disabled={disabled}
                    attached={attachedOpen}
                    onField={(key, value) => onAct("set-attached-field", { ...base, kind: attachedOpen, key, value })}
                    onChange={(anchor) => onAct("open-card-menu", { ...base, mode: "attach", anchor })}
                    onDelete={() => onAct("remove-attached", { ...base, kind: attachedOpen })}
                />
            )}
            {openCondition && openTile && (
                <LaneConditionEditor
                    condition={openCondition}
                    title={openTile.entry?.name ?? openTile.name}
                    entryOverride={openTile.entry ?? null}
                    abilityId={view.abilityId}
                    abilityName={view.abilityName}
                    disabled={disabled}
                    onChange={(update) => onAct("set-condition", { ...base, index: editingIndex, update })}
                    onRemove={() => onAct("remove-condition", { ...base, index: editingIndex })}
                />
            )}
            {followUps.length > 0 && (
                <ol className="lane-fu">
                    {followUps.map((follow, position) => (
                        <LaneCardRow
                            key={follow.id}
                            card={follow}
                            views={views}
                            scope={scope}
                            depth={depth + 1}
                            index={position}
                            count={followUps.length}
                            highlight={highlight}
                            editing={editing}
                            moveTargets={null}
                            customVariables={customVariables}
                            leadAbilityChoices={leadAbilityChoices}
                            disabled={disabled}
                            onAct={onAct}
                        />
                    ))}
                </ol>
            )}
        </li>
    );
}, sameRowProps);

/**
 * The action at the start of a row: the chevron in the action's kind colour, with the ability's artwork or a kind icon.
 * Clicking it opens the action editor under the row (a button, so the keyboard reaches it too).
 */
export function ActionTile({ view, disabled = false, open = false, onOpen = null }) {
    return (
        <button
            type="button"
            className={`lane-tile lane-tile--action${open ? " is-open" : ""}`}
            aria-expanded={open}
            aria-label={`Action: ${view.label}. Edit`}
            disabled={disabled || !onOpen}
            onClick={() => onOpen?.()}
        >
            <ActionGlyph abilityId={view.abilityId} head={view.head} size={26} />
            <span className="lane-tile__name lane-tile__name--action">{view.label}</span>
        </button>
    );
}

/** An attached movement (move or face) after its ability tile: a smaller tile, joined by "＋"; clicking it edits it. */
function AttachedTile({ item, open, disabled, onOpen }) {
    return (
        <span className="lane-attached">
            <span className="lane-attached__join" aria-hidden="true">＋</span>
            <button
                type="button"
                className={`lane-tile lane-tile--attached${open ? " is-open" : ""}`}
                aria-expanded={open}
                aria-label={`${item.kind === "move" ? "Move" : "Face"} while casting: ${item.label}. Edit`}
                disabled={disabled}
                style={{ "--lane-tone": item.tone }}
                onClick={onOpen}
            >
                <ActionGlyph head={item.head} size={18} />
                <span className="lane-tile__name">{item.label}</span>
            </button>
        </span>
    );
}

/**
 * The condition tiles of a card or switch, then the dashed "+ Condition" (when `onAdd` is given; it receives the button
 * as the menu's anchor). Clicking a tile opens or closes its inline editor (`onOpen(index)`); read-only tiles are inert.
 */
export function ConditionTiles({ tiles, editingIndex = null, disabled = false, onOpen, onAdd = null }) {
    return (
        <>
            {tiles.map((tile, index) => {
                const open = editingIndex === index;
                return (
                    <button
                        key={index}
                        type="button"
                        className={`lane-tile lane-tile--cond${open ? " is-open" : ""}${tile.entry ? "" : " is-unknown"}`}
                        aria-expanded={open}
                        disabled={disabled}
                        onClick={() => onOpen(index)}
                    >
                        {tile.icon && <LaneIcon name={tile.icon} size={16} className="lane-tile__icon" />}
                        <span className="lane-tile__name">{tile.name}</span>
                        {tile.value && <span className="lane-tile__value">{tile.value}</span>}
                    </button>
                );
            })}
            {onAdd && (
                <button type="button" className="lane-add-cond" onClick={(event) => onAdd(event.currentTarget)}>
                    <LaneIcon name="plus" size={13} />
                    <span>Condition</span>
                </button>
            )}
        </>
    );
}

/** The ids of a card and everything under it. */
function subtreeIds(card, ids = []) {
    ids.push(card.id);
    for (const follow of card.followUps ?? []) subtreeIds(follow, ids);
    return ids;
}

/** Re-render a row only when its props changed, or when its live bar changed inside its own subtree. */
function sameRowProps(previous, next) {
    for (const key of Object.keys(next)) {
        if (key !== "highlight" && !Object.is(previous[key], next[key])) return false;
    }
    if (previous.highlight === next.highlight) return true;
    return subtreeIds(next.card).every((id) => (
        previous.highlight.strong.has(id) === next.highlight.strong.has(id)
        && previous.highlight.faint.has(id) === next.highlight.faint.has(id)
    ));
}

export default LaneCardRow;
