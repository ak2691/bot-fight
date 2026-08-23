import { useEffect, useState } from "react";

export default function RootNodePriorityInput({
    priority,
    max,
    disabled = false,
    onCommit,
    className = "",
    ariaLabel = "Root node priority",
    ...inputProps
}) {
    const [draft, setDraft] = useState(String(priority));

    useEffect(() => {
        setDraft(String(priority));
    }, [priority]);

    const commit = () => {
        if (!draft) {
            setDraft(String(priority));
            return;
        }
        const nextPriority = Math.max(1, Math.min(max, Number.parseInt(draft, 10)));
        setDraft(String(nextPriority));
        if (nextPriority !== priority) onCommit(nextPriority);
    };
    return (
        <input
            {...inputProps}
            type="text"
            inputMode="numeric"
            aria-label={ariaLabel}
            value={draft}
            disabled={disabled}
            onChange={(event) => {
                if (/^\d*$/.test(event.target.value)) setDraft(event.target.value);
            }}
            onBlur={commit}
            onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                commit();
                event.currentTarget.blur();
            }}
            className={className}
        />
    );
}
