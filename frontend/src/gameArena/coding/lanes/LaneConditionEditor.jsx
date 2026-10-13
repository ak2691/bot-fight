import { useState } from "react";
import { STATE_VARIABLE_BY_ID } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { catalogEntryFor, formatShown, readingLabel, readingOption, storedFromShown } from "./conditionCatalog.js";

const NUMBER_COMPARATORS = Object.freeze([
    { id: "gte", label: "≥" },
    { id: "lte", label: "≤" },
    { id: "eq", label: "=" },
]);

/**
 * The inline editor under a card or switch row, opened by clicking a condition tile. One line: what it reads, the
 * comparator (≥ ≤ =), then the value: a number box, or a "Num | reading" toggle when the right side can be the
 * ability's range. Yes/no readings show a two-option toggle. Remove is quiet red, on the right. Every change calls
 * `onChange(updater)` with `updater(condition) => condition`, which the board applies through laneEdits at once.
 *
 * `title` is what the tile says (the entry's name, or the sentence for a condition the catalog does not know).
 * `entryOverride` is the entry a custom-variable condition reads as (customEntryFor), when the catalog has none.
 */
export default function LaneConditionEditor({ condition, title, abilityId = null, abilityName = null, entryOverride = null, disabled = false, onChange, onRemove }) {
    const entry = entryOverride ?? catalogEntryFor(condition);
    const right = condition.right ?? {};
    const reading = readingOption(entry, abilityId, abilityName);
    const isBoolean = entry ? entry.kind === "boolean" : right.type === "boolean";
    const isNumber = !isBoolean && right.type !== "boolean";

    const setComparator = (comparator) => onChange((current) => ({ ...current, comparator }));
    const setBoolean = (value) => onChange((current) => ({ ...current, comparator: "eq", right: { type: "boolean", value } }));
    const setNumber = () => onChange((current) => ({
        ...current,
        right: { type: "number", value: Math.round(Number(STATE_VARIABLE_BY_ID.get(entry?.variable)?.defaultValue ?? 50)) },
    }));
    const setReading = () => { if (reading) onChange((current) => ({ ...current, right: reading.right })); };

    const comparators = NUMBER_COMPARATORS.some((option) => option.id === condition.comparator)
        ? NUMBER_COMPARATORS
        : [...NUMBER_COMPARATORS, { id: condition.comparator, label: comparatorText(condition.comparator) }];
    const usesReading = right.type === "variable";

    return (
        <div className="lane-editor" role="group" aria-label={`Edit condition: ${title}`}>
            <span className="lane-editor__name">{title}</span>

            {isBoolean && entry && (
                <Segmented
                    label="State"
                    disabled={disabled}
                    value={right.value !== false}
                    options={[{ id: true, label: entry.labels.on }, { id: false, label: entry.labels.off }]}
                    onSelect={setBoolean}
                />
            )}

            {isNumber && (
                <>
                    <Segmented label="Comparator" disabled={disabled} value={condition.comparator} options={comparators} onSelect={setComparator} />
                    {reading ? (
                        <Segmented
                            label="Value"
                            disabled={disabled}
                            value={usesReading ? "reading" : "number"}
                            options={[{ id: "number", label: "Num" }, { id: "reading", label: reading.label }]}
                            onSelect={(choice) => (choice === "reading" ? setReading() : setNumber())}
                        />
                    ) : null}
                    {usesReading && !reading && (
                        <span className="lane-editor__static">{readingLabel(right, abilityName)}</span>
                    )}
                    {!usesReading && (
                        <NumberBox
                            stored={right.value}
                            entry={entry}
                            disabled={disabled}
                            onCommit={(stored) => onChange((current) => ({ ...current, right: { type: "number", value: stored } }))}
                        />
                    )}
                </>
            )}

            <button
                type="button"
                className="lane-editor__remove"
                disabled={disabled}
                onClick={onRemove}
            >
                Remove
            </button>
        </div>
    );
}

function comparatorText(comparator) {
    return ({ lt: "<", gt: ">", neq: "≠" })[comparator] ?? String(comparator ?? "");
}

/** A segmented control: buttons in one bordered strip, the chosen one lit. */
export function Segmented({ label, options, value, onSelect, disabled = false }) {
    return (
        <span className="lane-seg" role="group" aria-label={label}>
            {options.map((option) => {
                const on = option.id === value;
                return (
                    <button
                        key={String(option.id)}
                        type="button"
                        className={`lane-seg__item${on ? " is-on" : ""}`}
                        aria-pressed={on}
                        disabled={disabled}
                        onClick={() => { if (!on) onSelect(option.id); }}
                    >
                        {option.label}
                    </button>
                );
            })}
        </span>
    );
}

/**
 * The number box. It applies on every valid change; a value the engine clamps shows the clamped number, and a value
 * that changed elsewhere (undo) replaces the typed text.
 */
function NumberBox({ stored, entry, disabled, onCommit }) {
    const shown = formatShown(stored, entry);
    const [draft, setDraft] = useState(shown);
    const [seen, setSeen] = useState(shown);
    if (seen !== shown) {
        setSeen(shown);
        setDraft(shown);
    }
    return (
        <span className="lane-editor__value">
            <input
                type="number"
                inputMode="decimal"
                className="lane-editor__num"
                aria-label="Value"
                step={entry?.scale ? 0.1 : 1}
                value={draft}
                disabled={disabled}
                onChange={(event) => {
                    const text = event.target.value;
                    setDraft(text);
                    const value = storedFromShown(text, entry);
                    if (value === null) return;
                    setSeen(formatShown(value, entry));
                    onCommit(value);
                }}
            />
            {entry?.suffix && <span className="lane-editor__unit">{entry.suffix}</span>}
        </span>
    );
}
