function normalizedBaseUrl(value) {
    return typeof value === "string" ? value.trim().replace(/\/+$/, "") : "";
}

export const API_BASE_URL = normalizedBaseUrl(import.meta.env?.VITE_API_BASE_URL);

export function apiUrl(path) {
    if (!path.startsWith("/")) {
        throw new Error("API paths must be absolute");
    }
    return `${API_BASE_URL}${path}`;
}

export function websocketUrl(path = "/ws") {
    const httpUrl = new URL(apiUrl(path), window.location.origin);
    httpUrl.protocol = httpUrl.protocol === "https:" ? "wss:" : "ws:";
    return httpUrl.toString();
}
