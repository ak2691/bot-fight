// The model both lanes menus share (condition menu, card menu): word-prefix search over an item's name, description
// and keywords; sections with counts (a group with no match stays in the rail, faded); and the keyboard model
// (↑ ↓ Enter Esc). Pure, with no JSX, so the menus' behaviour is tested without a DOM.

/** The lower-case words of a text, split on anything that is not a letter or a digit. */
export function menuWords(text) {
    return String(text ?? "").toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
}

/** An item matches when every typed word starts a word of its name, description or keywords (case-insensitive). */
export function itemMatches(item, query) {
    const tokens = menuWords(query);
    if (tokens.length === 0) return true;
    const words = menuWords([item.name, item.description, ...(item.keywords ?? [])].join(" "));
    return tokens.every((token) => words.some((word) => word.startsWith(token)));
}

/** The items that match the query, in their order. */
export function filterItems(items, query) {
    return items.filter((item) => itemMatches(item, query));
}

/**
 * Sections for a list. `groups` is [{ id, label, tone, items }]; each group keeps its place and gets its matching items,
 * its `count`, and `shown` (false when nothing matched, so the rail fades it). An empty group still appears.
 */
export function sectionsFor(groups, query) {
    return groups.map((group) => {
        const items = filterItems(group.items, query);
        return { ...group, items, count: items.length, shown: items.length > 0 };
    });
}

/** The matching items of every section as one flat list, which the keyboard walks. */
export function flatItems(sections) {
    return sections.flatMap((section) => section.items);
}

/** The highlight to show after the query changes: the first match, or -1 when nothing matches. */
export function initialHighlight(count) {
    return count > 0 ? 0 : -1;
}

/** What a key means inside a menu: "next", "prev", "choose", "close", or null for any other key. */
export function menuKeyAction(key) {
    switch (key) {
        case "ArrowDown": return "next";
        case "ArrowUp": return "prev";
        case "Enter": return "choose";
        case "Escape": return "close";
        default: return null;
    }
}

/** The highlight after a next or prev step, clamped at both ends (no wrap). Other actions leave it as it is. */
export function stepHighlight(current, count, action) {
    if (count <= 0) return -1;
    if (action !== "next" && action !== "prev") return current;
    if (current < 0) return 0;
    return action === "next" ? Math.min(count - 1, current + 1) : Math.max(0, current - 1);
}

export const MENU_HEIGHT = 300;
const MENU_GAP = 6;
const MENU_EDGE = 8;

/**
 * Where a desktop menu goes: under its anchor (a `DOMRect`-like `{ left, top, bottom }`), shifted left so it stays on the
 * viewport, and above the anchor when there is no room below. `viewport` is `{ width, height }`.
 */
export function anchoredPosition(rect, { width, height = MENU_HEIGHT, viewport }) {
    const fitted = Math.min(width, viewport.width - MENU_EDGE * 2);
    const left = Math.max(MENU_EDGE, Math.min(rect.left, viewport.width - fitted - MENU_EDGE));
    const below = rect.bottom + MENU_GAP;
    const fitsBelow = below + height + MENU_EDGE <= viewport.height;
    const above = rect.top - MENU_GAP - height;
    const top = !fitsBelow && above >= MENU_EDGE ? above : below;
    return { left, top, width: fitted, height };
}

/** The fields that name what a menu is for. Two openings with the same anchor and these fields are the same target. */
const MENU_TARGET_FIELDS = Object.freeze(["type", "mode", "cardId", "id", "kind", "index", "scope"]);

/**
 * Whether opening `next` again is a re-click of the open menu (which then closes it), rather than a different menu or
 * another mode on the same button (which switches to it). "Add follow-up" then "Add movement while casting" on one row
 * is two modes of the card menu, so the second one replaces the first.
 */
export function isSameMenuTarget(current, next) {
    if (!current || !next || current.anchor !== next.anchor) return false;
    return MENU_TARGET_FIELDS.every((field) => current[field] === next[field]);
}
