import {
    CLIENT_BUILD_VERSION,
    BOT_SUBMISSION_ENDPOINT,
    BUILDING_SESSION_ENDPOINT,
} from "./SubmissionContract.js";
import { ensureCsrfHeaders } from "../../../security/csrf";
import { API_BASE_URL } from "../../../config/api.js";
import { normalizeAbilityStrategyConfiguration } from "../code/BotCode.js";

export async function buildBotSubmissionPayload({
    code,
    matchId = null,
    buildingSessionId = null,
    selectedLoadout = "custom",
    loadout = null,
}) {
    const normalizedCode = {
        ...normalizeAbilityStrategyConfiguration(code),
        ...(loadout ? { loadout } : {}),
    };

    return {
        matchId,
        buildingSessionId,
        selectedLoadout,
        clientBuildVersion: CLIENT_BUILD_VERSION,
        brain: normalizedCode,
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

export async function createBuildingSession(matchId = null) {
    const endpoint = matchId
        ? `${BUILDING_SESSION_ENDPOINT}?matchId=${encodeURIComponent(matchId)}`
        : BUILDING_SESSION_ENDPOINT;
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
        throw new Error(body.message ?? responseText ?? `Building session failed with ${response.status}`);
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

export async function fetchBuildingSessionDuration(buildingSessionId) {
    const response = await fetch(`${BUILDING_SESSION_ENDPOINT}/${buildingSessionId}/duration`, {
        credentials: "include",
    });
    if (!response.ok) return null;

    const body = await response.json();
    return body.buildingDurationMs ?? null;
}
