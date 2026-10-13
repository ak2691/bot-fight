import { useState } from "react";
import LaneMenuShell, { MenuRailItem } from "./LaneMenuShell.jsx";
import { ActionGlyph } from "./laneIcons.jsx";
import { cardMenuContent, laneRail } from "./cardMenu.js";
import { abilityDetails, statsLine } from "./abilityDetails.js";
import { kindToneOf, LANE_SPECS } from "./laneView.js";
import { initialHighlight, stepHighlight } from "./menuModel.js";
import { ACTION_HEADS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";

const ALL_LANES = LANE_SPECS.map((spec) => spec.lane);

/**
 * The card menu. "+ Card" in a section (`mode` "add": one section's actions, with ready-made cards under them), "Add
 * follow-up" (`mode` "follow": the Actions choices, abilities, dash and cancel), "Add movement while casting" (`mode`
 * "attach": the move and face actions, and a pick sets the card's attached move or face), and "Change" on an action
 * (`mode` "swap": only the actions that fit the card). Abilities are big icon tiles, each with an ⓘ that opens its details
 * (`onDetails(anchor, abilityId)`); the other actions are rows. The footer shows the highlighted action's stats.
 * Picking calls `onPick(item)`: an action item (`item.actionId`) or a ready-made one (`item.template`).
 */
export default function LaneCardMenu({ anchor, mode, lane, railShown = false, actionTypes, templates = [], fits = () => true, onPick, onClose, onDetails, emptyHint = null }) {
    // Every section while a rail search runs, else the current section alone.
    const itemsFor = (text, current) => {
        const lanes = railShown && text.trim() !== "" ? ALL_LANES : [current];
        const content = cardMenuContent({ actionTypes, templates, lanes, query: text, fits, withTemplates: mode === "add" });
        const tiles = content.actions.filter((item) => item.head === ACTION_HEADS.ABILITY);
        const rows = content.actions.filter((item) => item.head !== ACTION_HEADS.ABILITY);
        return { tiles, rows, ready: content.ready, flat: [...tiles, ...rows, ...content.ready] };
    };
    const [query, setQuery] = useState("");
    const [activeLane, setActiveLane] = useState(lane);
    const [highlight, setHighlight] = useState(() => initialHighlight(itemsFor("", lane).flat.length));

    const view = itemsFor(query, activeLane);
    const { flat } = view;

    const changeQuery = (value) => {
        setQuery(value);
        setHighlight(initialHighlight(itemsFor(value, activeLane).flat.length));
    };

    const switchLane = (next) => {
        setActiveLane(next);
        setHighlight(initialHighlight(itemsFor(query, next).flat.length));
    };

    const choose = (index) => {
        const item = flat[index];
        if (item) onPick(item);
    };

    const onKey = (action) => {
        if (action === "choose") {
            choose(highlight);
            return;
        }
        setHighlight(stepHighlight(highlight, flat.length, action));
    };

    const rail = railShown
        ? laneRail(actionTypes, query, fits).map((entry) => (
            <MenuRailItem
                key={entry.lane}
                label={entry.title}
                tone={entry.tone}
                count={entry.count}
                on={entry.lane === activeLane}
                onSelect={() => switchLane(entry.lane)}
            />
        ))
        : null;

    const indexOf = (item) => flat.indexOf(item);
    const hovered = flat[highlight] ?? null;
    const hoveredDetails = hovered?.abilityId != null ? abilityDetails(hovered.abilityId) : null;
    const label = {
        swap: "Change action",
        follow: "Add follow-up",
        attach: "Add movement while casting",
    }[mode] ?? "Add card";
    const placeholder = view.tiles.length > 0 ? "Search ability cards" : "Search cards";

    const tileButton = (item) => {
        const index = indexOf(item);
        const hi = index === highlight;
        return (
            <div key={item.id} className="lane-menu2__tile-wrap">
                <button
                    type="button"
                    className={`lane-menu2__tile${hi ? " is-hi" : ""}`}
                    aria-selected={hi}
                    onMouseEnter={() => setHighlight(index)}
                    onClick={() => choose(index)}
                    style={{ "--lane-tone": kindToneOf(item.head) }}
                >
                    <ActionGlyph abilityId={item.abilityId} head={item.head} size={40} />
                    <span className="lane-menu2__tile-name">{item.name}</span>
                </button>
                {onDetails && (
                    <button
                        type="button"
                        className="lane-menu2__info"
                        aria-label={`Details: ${item.name}`}
                        title="Details"
                        onClick={(event) => {
                            event.stopPropagation();
                            onDetails(event.currentTarget, item.abilityId);
                        }}
                    >
                        ⓘ
                    </button>
                )}
            </div>
        );
    };

    const rowButton = (item, { ready = false } = {}) => {
        const index = indexOf(item);
        const hi = index === highlight;
        return (
            <button
                key={item.id}
                type="button"
                className={`lane-menu2__item${hi ? " is-hi" : ""}`}
                aria-selected={hi}
                style={{ "--lane-tone": kindToneOf(item.head) }}
                onMouseEnter={() => setHighlight(index)}
                onClick={() => choose(index)}
                data-ready={ready ? "" : undefined}
            >
                <ActionGlyph abilityId={item.abilityId} head={item.head} size={22} />
                <span className="lane-menu2__item-name">{item.name}</span>
                <span className="lane-menu2__item-desc">{item.description}</span>
            </button>
        );
    };

    const empty = flat.length === 0;
    return (
        <LaneMenuShell
            label={label}
            anchor={anchor}
            query={query}
            onQuery={changeQuery}
            placeholder={placeholder}
            onKey={onKey}
            onClose={onClose}
            rail={rail}
            footer={hovered
                ? <><strong>{hovered.name}</strong><span>{(hoveredDetails && statsLine(hoveredDetails)) || hovered.description}</span></>
                : <span>{empty && mode === "swap" && !query ? emptyHint ?? "Nothing else fits this card." : "Pick a card to add it."}</span>}
        >
            <div className="lane-menu2__list">
                {view.tiles.length > 0 && <div className="lane-menu2__tiles">{view.tiles.map(tileButton)}</div>}
                {view.rows.map((item) => rowButton(item))}
                {view.ready.length > 0 && (
                    <>
                        <div className="lane-menu2__group-label">Ready-made</div>
                        {view.ready.map((item) => rowButton(item, { ready: true }))}
                    </>
                )}
                {empty && <p className="lane-menu2__empty">{query ? `Nothing matches “${query}”.` : "Nothing to add here."}</p>}
            </div>
        </LaneMenuShell>
    );
}
