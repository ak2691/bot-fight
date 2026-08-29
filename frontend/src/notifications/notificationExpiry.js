export const INVITE_NOTIFICATION_TTL_MS = 30_000;

function timestampMs(value) {
    if (value instanceof Date) return value.getTime();
    const numeric = Number(value);
    if (typeof value === "number" || (typeof value === "string" && value.trim() !== "" && Number.isFinite(numeric))) {
        return numeric;
    }
    const parsed = Date.parse(String(value ?? ""));
    return Number.isFinite(parsed) ? parsed : Number.NaN;
}

export function displayExpiryForInvite(invite, now = Date.now(), existingExpiry = null) {
    const rememberedExpiry = Number(existingExpiry);
    if (existingExpiry != null && Number.isFinite(rememberedExpiry)) return rememberedExpiry;

    const createdAt = timestampMs(invite?.createdAt);
    if (!Number.isFinite(createdAt)) return now + INVITE_NOTIFICATION_TTL_MS;

    // Do not show a server snapshot for longer than thirty seconds from its
    // creation, or longer than thirty seconds after this client received it.
    return Math.min(
        createdAt + INVITE_NOTIFICATION_TTL_MS,
        now + INVITE_NOTIFICATION_TTL_MS,
    );
}

export function normalizeIncomingInvites(incoming, previous = [], now = Date.now(), hiddenIds = new Set()) {
    const previousById = new Map((previous ?? [])
        .filter((invite) => invite?.inviteId != null)
        .map((invite) => [String(invite.inviteId), invite]));
    return (Array.isArray(incoming) ? incoming : [])
        .filter((invite) => invite?.inviteId != null)
        .map((invite) => {
            const key = String(invite.inviteId);
            if (hiddenIds.has(key)) return null;
            const previousInvite = previousById.get(key);
            const displayExpiresAt = displayExpiryForInvite(
                invite,
                now,
                previousInvite?.displayExpiresAt,
            );
            if (displayExpiresAt <= now) {
                hiddenIds.add(key);
                return null;
            }
            return { ...previousInvite, ...invite, displayExpiresAt };
        })
        .filter(Boolean);
}

export function mergeIncomingInvite(current, invite, now = Date.now(), hiddenIds = new Set()) {
    const key = invite?.inviteId == null ? null : String(invite.inviteId);
    const remaining = removeExpiredInvites(current ?? [], now, hiddenIds)
        .filter((candidate) => String(candidate?.inviteId) !== key);
    return [...remaining, ...normalizeIncomingInvites([invite], current, now, hiddenIds)];
}

export function removeExpiredInvites(invites, now = Date.now(), hiddenIds = new Set()) {
    let changed = false;
    const next = (invites ?? []).filter((invite) => {
        const key = invite?.inviteId == null ? null : String(invite.inviteId);
        const displayExpiresAt = displayExpiryForInvite(invite, now, invite?.displayExpiresAt);
        const expired = displayExpiresAt <= now || (key != null && hiddenIds.has(key));
        if (expired) {
            if (key != null) hiddenIds.add(key);
            changed = true;
            return false;
        }
        return true;
    });
    return changed ? next : invites;
}
