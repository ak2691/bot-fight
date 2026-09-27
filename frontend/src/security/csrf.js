import { API_BASE_URL, apiUrl } from "../config/api.js";

const CSRF_COOKIE_NAME = "XSRF-TOKEN";
const CSRF_HEADER_NAME = "X-XSRF-TOKEN";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS", "TRACE"]);
let cachedToken = null;

function readCookie(name) {
    const cookie = document.cookie
        .split("; ")
        .find((part) => part.startsWith(`${name}=`));

    return cookie ? decodeURIComponent(cookie.slice(name.length + 1)) : null;
}

export function csrfHeaders(method = "GET") {
    if (SAFE_METHODS.has(method.toUpperCase())) {
        return {};
    }

    const token = cachedToken ?? readCookie(CSRF_COOKIE_NAME);
    return token ? { [CSRF_HEADER_NAME]: token } : {};
}

export async function ensureCsrfHeaders(method = "GET", apiBaseUrl = API_BASE_URL) {
    if (SAFE_METHODS.has(method.toUpperCase())) {
        return {};
    }

    const csrfUrl = apiBaseUrl ? `${apiBaseUrl.replace(/\/+$/, "")}/api/auth/csrf` : apiUrl("/api/auth/csrf");
    const response = await fetch(csrfUrl, {
        cache: "no-store",
        credentials: "include",
    });
    const body = await response.json().catch(() => ({}));

    if (response.ok && body.token) {
        cachedToken = body.token;
        return { [body.headerName ?? CSRF_HEADER_NAME]: body.token };
    }

    const fallbackToken = cachedToken ?? readCookie(CSRF_COOKIE_NAME);
    if (fallbackToken) {
        return { [CSRF_HEADER_NAME]: fallbackToken };
    }

    throw new Error(`Unable to fetch CSRF token (${response.status})`);
}
