import { useRef, useState } from "react";
import { MAX_CHAIN_NAME_LENGTH } from "../../botlogic/code/configuration/constants.js";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import "./NewChainDialog.css";

// Creating a chain jumps into it, so it asks for a name first: Enter or "Add chain" creates it, Esc or a click outside cancels.
export function NewChainDialog({ defaultName, onConfirm, onCancel }) {
    const [name, setName] = useState(defaultName);
    const dialogRef = useRef(null);
    const inputRef = useRef(null);
    useDialogFocus(dialogRef, { initialFocusRef: inputRef, onClose: onCancel });
    const confirm = () => onConfirm(name);
    return <div className="code-nc-backdrop" onPointerDown={(event) => { if (event.target === event.currentTarget) onCancel(); }}>
        <form ref={dialogRef} className="code-nc" role="dialog" aria-modal="true" aria-label="New chain" onSubmit={(event) => { event.preventDefault(); confirm(); }} onWheel={(event) => event.stopPropagation()}>
            <label className="code-nc-field">
                <span>Name</span>
                <input ref={inputRef} autoFocus onFocus={(event) => event.target.select()} value={name} maxLength={MAX_CHAIN_NAME_LENGTH} onChange={(event) => setName(event.target.value)} placeholder={defaultName} autoComplete="off" aria-label="Chain name" />
            </label>
            <div className="code-nc-actions">
                <button type="button" className="code-nc-cancel" onClick={onCancel}>Cancel</button>
                <button type="submit" className="code-nc-add">Add chain</button>
            </div>
        </form>
    </div>;
}
