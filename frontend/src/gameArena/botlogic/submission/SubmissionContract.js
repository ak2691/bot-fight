import { apiUrl } from "../../../config/api.js";

const ENV = import.meta.env ?? {};

export const CLIENT_BUILD_VERSION =
    ENV.VITE_CLIENT_BUILD_VERSION ?? "local-dev";

export const BOT_SUBMISSION_ENDPOINT =
    apiUrl("/api/bot-submissions");

export const BUILDING_SESSION_ENDPOINT =
    apiUrl("/api/building-sessions");

// Compatibility alias for callers that still use the pre-rename symbol.
export const TESTING_SESSION_ENDPOINT = BUILDING_SESSION_ENDPOINT;
