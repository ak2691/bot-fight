import assert from "node:assert/strict";
import test from "node:test";
import {
    matchEventOpponent,
    matchEventParticipants,
    matchEventViewer,
} from "./matchEventParticipants.js";

test("match event participants identify the viewer and opposing player in a 1v1", () => {
    const event = {
        eventSchemaVersion: 2,
        viewerUserId: "user-2",
        players: [
            { userId: "user-1", username: "Pilot 1", slot: 1, teamNumber: 1 },
            { userId: "user-2", username: "Pilot 2", slot: 2, teamNumber: 2 },
        ],
    };

    assert.equal(matchEventViewer(event).username, "Pilot 2");
    assert.equal(matchEventOpponent(event).username, "Pilot 1");
    assert.equal(matchEventParticipants(event).length, 2);
});

test("match event opponent selection uses the opposing team for a 2v2 viewer", () => {
    const event = {
        eventSchemaVersion: 2,
        viewerUserId: "user-4",
        players: [
            { userId: "user-1", username: "Pilot 1", slot: 1, teamNumber: 1 },
            { userId: "user-2", username: "Pilot 2", slot: 2, teamNumber: 1 },
            { userId: "user-3", username: "Pilot 3", slot: 3, teamNumber: 2 },
            { userId: "user-4", username: "Pilot 4", slot: 4, teamNumber: 2 },
        ],
    };

    assert.equal(matchEventViewer(event).username, "Pilot 4");
    assert.equal(matchEventOpponent(event).username, "Pilot 1");
});

test("malformed or incomplete participant events do not invent a viewer", () => {
    assert.equal(matchEventViewer({ eventSchemaVersion: 2, players: [{ userId: "user-1" }] }), null);
    assert.equal(matchEventOpponent({ eventSchemaVersion: 2, viewerUserId: "missing", players: [] }), null);
});

test("legacy unversioned participant events are rejected", () => {
    const legacyEvent = {
        player: { userId: "user-1" },
        opponent: { userId: "user-2" },
        players: [{ userId: "user-1" }, { userId: "user-2" }],
    };

    assert.deepEqual(matchEventParticipants(legacyEvent), []);
    assert.equal(matchEventViewer(legacyEvent), null);
    assert.equal(matchEventOpponent(legacyEvent), null);
});
