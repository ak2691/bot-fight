import { useState } from "react";
import { editorFields } from "./actionEditorModel.js";
import { Segmented } from "./LaneConditionEditor.jsx";

/**
 * The inline action editor (mockup section 6), opened by an action tile or an attached movement tile. One line: the
 * action's name, an ⓘ for an ability (its details panel, `onDetails(anchor)`), "Change" (opens the card menu in swap mode,
 * or in attach mode for an attached movement, keeping the card's conditions), then the fields from editorFields: Target
 * as a segmented control with only the targets this action supports, the action's own settings, and Aim for abilities.
 * "Delete card" is quiet red on the right; an attached movement says "Remove" instead (it does not delete the card).
 *
 * `onField(key, value)` applies one field; `onChange(anchor)` opens the menu under the Change button; `onDelete()`
 * removes the card (the board confirms when it has follow-ups) or the attached movement (`attached` is "move" or "face").
 */
export default function LaneActionEditor({ entry, definition, label, customVariables = [], leadAbilityChoices = [], disabled = false, attached = null, onField, onChange, onDelete, onDetails = null }) {
    const fields = editorFields(entry, definition, { customVariables, leadAbilityChoices });
    return (
        <div className="lane-editor lane-editor--action" role="group" aria-label={`Edit ${attached ? "movement" : "action"}: ${label}`}>
            <span className="lane-editor__name">{label}</span>
            {onDetails && definition?.abilityId != null && (
                <button type="button" className="lane-editor__info" aria-label={`About ${label}`} title="Details" onClick={(event) => onDetails(event.currentTarget)}>
                    ⓘ
                </button>
            )}
            <button type="button" className="lane-editor__link" disabled={disabled} onClick={(event) => onChange(event.currentTarget)}>
                Change
            </button>
            {fields.map((field) => (
                <FieldControl
                    key={`${field.key}:${field.kind}:${field.label}`}
                    field={field}
                    disabled={disabled}
                    onChange={(value) => onField(field.key, value)}
                />
            ))}
            <button type="button" className="lane-editor__remove" disabled={disabled} onClick={onDelete}>
                {attached ? "Remove" : "Delete card"}
            </button>
        </div>
    );
}

function FieldControl({ field, disabled, onChange }) {
    if (field.kind === "select") {
        return (
            <span className="lane-editor__field">
                <span className="lane-editor__label">{field.label}</span>
                <select
                    className="lane-editor__select"
                    aria-label={field.label}
                    value={field.value ?? ""}
                    disabled={disabled}
                    onChange={(event) => onChange(Number(event.target.value))}
                >
                    {field.value == null && <option value="">Pick one</option>}
                    {field.options.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
                </select>
            </span>
        );
    }
    if (field.kind === "segmented") {
        return (
            <span className="lane-editor__field">
                <span className="lane-editor__label">{field.label}</span>
                <Segmented label={field.label} disabled={disabled} value={field.value} options={field.options} onSelect={onChange} />
            </span>
        );
    }
    if (field.kind === "switch") {
        return (
            <span className="lane-editor__field">
                <span className="lane-editor__label">{field.label}</span>
                <button
                    type="button"
                    role="switch"
                    aria-checked={field.value}
                    aria-label={field.label}
                    className={`lane-switch${field.value ? " is-on" : ""}`}
                    disabled={disabled}
                    onClick={() => onChange(!field.value)}
                >
                    <span className="lane-switch__knob" aria-hidden="true" />
                </button>
            </span>
        );
    }
    return <NumberField field={field} disabled={disabled} onChange={onChange} />;
}

/** A number box: applies each valid change at once; text that is not a number waits until it is one. */
function NumberField({ field, disabled, onChange }) {
    const shown = String(field.value);
    const [draft, setDraft] = useState(shown);
    const [seen, setSeen] = useState(shown);
    if (seen !== shown) {
        setSeen(shown);
        setDraft(shown);
    }
    return (
        <span className="lane-editor__field">
            <span className="lane-editor__label">{field.label}</span>
            <span className="lane-editor__value">
                <input
                    type="number"
                    inputMode="decimal"
                    className="lane-editor__num"
                    aria-label={field.label}
                    min={field.min}
                    max={field.max}
                    step={field.step ?? 1}
                    value={draft}
                    disabled={disabled}
                    onChange={(event) => {
                        const text = event.target.value;
                        setDraft(text);
                        if (text.trim() === "" || !Number.isFinite(Number(text))) return;
                        const value = Number(text);
                        setSeen(String(value));
                        onChange(value);
                    }}
                />
                {field.unit && <span className="lane-editor__unit">{field.unit}</span>}
            </span>
        </span>
    );
}
