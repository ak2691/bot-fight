import {
    CLIENT_BUILD_VERSION,
    BOT_SUBMISSION_ENDPOINT,
} from "./SubmissionContract.js";
import { ensureCsrfHeaders } from "../../../security/csrf";
import { API_BASE_URL } from "../../../config/api.js";
import { normalizeAbilityStrategyConfiguration } from "../code/BotCode.js";

export async function buildBotSubmissionPayload({
    code,
    matchId = null,
    roundNumber = null,
    phase = null,
    selectedLoadout = "custom",
    loadout = null,
}) {
    const normalizedCode = {
        ...normalizeAbilityStrategyConfiguration(code),
        ...(loadout ? { loadout } : {}),
    };

    return {
        matchId,
        roundNumber,
        phase,
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
