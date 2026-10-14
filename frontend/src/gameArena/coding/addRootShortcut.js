export const ADD_ROOT_SHORTCUT_STORAGE_KEY = "botfight.workspace.addRootShortcut";
export const DEFAULT_ADD_ROOT_SHORTCUT = "r";

export function normalizeAddRootShortcut(value) {
    return typeof value === "string" && /^[a-z0-9]$/i.test(value)
        ? value.toLowerCase()
        : null;
}

export function readAddRootShortcut(storage) {
    try {
        const saved = (storage ?? globalThis.localStorage).getItem(ADD_ROOT_SHORTCUT_STORAGE_KEY);
        return normalizeAddRootShortcut(saved) ?? DEFAULT_ADD_ROOT_SHORTCUT;
    } catch {
        return DEFAULT_ADD_ROOT_SHORTCUT;
    }
}

export function saveAddRootShortcut(value, storage) {
    const normalized = normalizeAddRootShortcut(value);
    if (!normalized) return false;
    try {
        (storage ?? globalThis.localStorage).setItem(ADD_ROOT_SHORTCUT_STORAGE_KEY, normalized);
        return true;
    } catch {
        return false;
    }
}

export function isAddRootShortcutKeydown(event, shortcut) {
    if (event.defaultPrevented || event.repeat || event.isComposing
        || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return false;
    if (event.target?.closest?.('input, textarea, select, [contenteditable]:not([contenteditable="false"])')) return false;
    return typeof event.key === "string" && event.key.toLowerCase() === shortcut;
}

// Workspace shortcuts: one letter or number each, saved on this browser. No two actions share a key.
export const WORKSPACE_SHORTCUTS = Object.freeze({
    addRoot: { storageKey: ADD_ROOT_SHORTCUT_STORAGE_KEY, fallback: DEFAULT_ADD_ROOT_SHORTCUT, label: "Add root key", hint: "Adds a root when nothing is selected in the code workspace." },
    addNode: { storageKey: "botfight.workspace.addNodeShortcut", fallback: "f", label: "Add node key", hint: "Opens the node menu in the code workspace." },
    search: { storageKey: "botfight.workspace.searchShortcut", fallback: "s", label: "Search key", hint: "Opens the root search, even when the code workspace is closed." },
});

export function readWorkspaceShortcut(action, storage) {
    const { storageKey, fallback } = WORKSPACE_SHORTCUTS[action];
    try {
        return normalizeAddRootShortcut((storage ?? globalThis.localStorage).getItem(storageKey)) ?? fallback;
    } catch {
        return fallback;
    }
}

// Returns null on success, otherwise the reason it was refused.
export function saveWorkspaceShortcut(action, value, storage) {
    const normalized = normalizeAddRootShortcut(value);
    if (!normalized) return "Choose one letter or number (A–Z, 0–9).";
    const clash = Object.keys(WORKSPACE_SHORTCUTS).find((other) => other !== action && readWorkspaceShortcut(other, storage) === normalized);
    if (clash) return `${normalized.toUpperCase()} is already used by "${WORKSPACE_SHORTCUTS[clash].label}".`;
    try {
        (storage ?? globalThis.localStorage).setItem(WORKSPACE_SHORTCUTS[action].storageKey, normalized);
        return null;
    } catch {
        return "This browser could not save the shortcut.";
    }
}

export const isWorkspaceShortcutKeydown = isAddRootShortcutKeydown;
