import {
    CLIENT_BUILD_VERSION,
    BOT_SUBMISSION_ENDPOINT,
    TESTING_SESSION_ENDPOINT,
} from "./SubmissionContract.js";
import { ensureCsrfHeaders } from "../security/csrf";
import { API_BASE_URL } from "../config/api.js";
import { normalizeMeleeStrategyConfiguration } from "./BotBrain.js";

export async function buildBotSubmissionPayload({
    brain,
    matchId = null,
    testingSessionId,
    selectedLoadout = "custom",
    loadout = null,
}) {
    const normalizedBrain = {
        ...normalizeMeleeStrategyConfiguration(brain),
        ...(loadout ? { loadout } : {}),
    };

    return {
        matchId,
        testingSessionId,
        selectedLoadout,
        clientBuildVersion: CLIENT_BUILD_VERSION,
        brain: normalizedBrain,
    };
}

export async function submitBotPayload(payload) {
    const response = await fetch(BOT_SUBMISSION_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders("POST", API_BASE_URL)),
        },
        body: JSON.stringify(payload),
    });

    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const validationErrors = Array.isArray(body.errors) && body.errors.length > 0
            ? `: ${body.errors.join(", ")}`
            : "";
        throw new Error(`${body.message ?? `Bot submission failed with ${response.status}`}${validationErrors}`);
    }

    return body;
}

export async function createTestingSession(matchId = null) {
    const endpoint = matchId
        ? `${TESTING_SESSION_ENDPOINT}?matchId=${encodeURIComponent(matchId)}`
        : TESTING_SESSION_ENDPOINT;
    const response = await fetch(endpoint, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders("POST", API_BASE_URL)),
        },
    });

    const responseText = await response.text();
    const body = responseText ? safeJson(responseText) : {};

    if (!response.ok) {
        throw new Error(body.message ?? responseText ?? `Testing session failed with ${response.status}`);
    }

    return body;
}

function safeJson(text) {
    try {
        return JSON.parse(text);
    } catch {
        return {};
    }
}

export async function fetchTestingSessionDuration(testingSessionId) {
    const response = await fetch(`${TESTING_SESSION_ENDPOINT}/${testingSessionId}/duration`, {
        credentials: "include",
    });
    if (!response.ok) return null;

    const body = await response.json();
    return body.testingDurationMs ?? null;
}
