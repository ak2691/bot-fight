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
