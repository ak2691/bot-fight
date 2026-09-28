export default function AddIcon({ size = "normal", className = "" }) {
    const sizeClass = size === "large" ? "coding-add-icon--large" : "coding-add-icon--normal";
    return <svg
        viewBox="0 0 16 16"
        className={`coding-add-icon ${sizeClass} ${className}`.trim()}
        aria-hidden="true"
        focusable="false"
    >
        <path d="M8 3v10M3 8h10" />
    </svg>;
}
