import { decodeBotLoadout, decodeSandboxLoadout, normalizedSandboxLoadout } from "./BotLoadout.js";

export function loadoutDraftForEntry(entry) {
    const supplied = entry?.loadout;
    if (supplied && typeof supplied === "object") return normalizedSandboxLoadout(supplied);
    const encoded = String(supplied ?? "");
    const source = encoded.startsWith("sandbox:")
        ? decodeSandboxLoadout(encoded)
        : decodeBotLoadout(encoded);
    return normalizedSandboxLoadout(source);
}

export function loadoutDraftsForRoster(roster) {
    return Object.fromEntries((roster ?? []).map((entry) => [entry.key, loadoutDraftForEntry(entry)]));
}
