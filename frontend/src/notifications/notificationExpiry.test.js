import assert from "node:assert/strict";
import test from "node:test";
import {
    INVITE_NOTIFICATION_TTL_MS,
    mergeIncomingInvite,
    normalizeIncomingInvites,
    removeExpiredInvites,
} from "./notificationExpiry.js";

const now = Date.parse("2026-08-29T12:00:00Z");

test("invite notifications expire thirty seconds after their server creation or receipt", () => {
    const [createdRecently] = normalizeIncomingInvites([
        { inviteId: "recent", createdAt: new Date(now - 5_000).toISOString() },
    ], [], now);
    const [withoutCreatedAt] = normalizeIncomingInvites([
        { inviteId: "no-created-at" },
    ], [], now);
    const [alreadyOld] = normalizeIncomingInvites([
        { inviteId: "old", createdAt: new Date(now - INVITE_NOTIFICATION_TTL_MS).toISOString() },
    ], [], now);

    assert.equal(createdRecently.displayExpiresAt, now + INVITE_NOTIFICATION_TTL_MS - 5_000);
    assert.equal(withoutCreatedAt.displayExpiresAt, now + INVITE_NOTIFICATION_TTL_MS);
    assert.equal(alreadyOld, undefined);
});

test("invite refreshes preserve local deadlines and do not resurrect hidden notifications", () => {
    const hiddenIds = new Set();
    const [first] = mergeIncomingInvite([], { inviteId: "party-1" }, now, hiddenIds);
    const [refreshed] = normalizeIncomingInvites([
        { inviteId: "party-1", inviterUsername: "Updated name" },
    ], [first], now + 10_000, hiddenIds);

    assert.equal(refreshed.displayExpiresAt, first.displayExpiresAt);
    assert.equal(refreshed.inviterUsername, "Updated name");

    const remaining = removeExpiredInvites([refreshed], first.displayExpiresAt, hiddenIds);
    assert.deepEqual(remaining, []);
    assert.deepEqual(normalizeIncomingInvites([
        { inviteId: "party-1" },
    ], [], first.displayExpiresAt + 1, hiddenIds), []);
});
