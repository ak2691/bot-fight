import { ensureCsrfHeaders } from "../security/csrf.js";
import { apiUrl } from "../config/api.js";

export const PUZZLES_ENDPOINT = apiUrl("/api/puzzles");
export const ADMIN_PUZZLES_ENDPOINT = apiUrl("/api/admin/puzzles");

const PUZZLE_LIST_CACHE_TTL_MS = 60_000;
const PUZZLE_LIST_CACHE_MAX_ENTRIES = 100;
const MAX_PUZZLE_SEARCH_QUERY_LENGTH = 100;
const puzzleListCache = new Map();

export function clearPuzzleListCache() {
    puzzleListCache.clear();
}

export async function fetchPuzzles(page = 0, size = 20, query = "") {
    const normalizedPage = Math.max(0, Number(page) || 0);
    const normalizedSize = Math.min(20, Math.max(1, Number(size) || 20));
    const normalizedQuery = String(query ?? "").trim().slice(0, MAX_PUZZLE_SEARCH_QUERY_LENGTH);
    const cacheKey = `${normalizedPage}:${normalizedSize}:${normalizedQuery}`;
    const cached = puzzleListCache.get(cacheKey);
    if (cached && cached.expiresAt > Date.now()) return cached.promise;
    if (cached) puzzleListCache.delete(cacheKey);

    const params = new URLSearchParams({
        page: String(normalizedPage),
        size: String(normalizedSize),
    });
    if (normalizedQuery) params.set("query", normalizedQuery);

    const request = fetch(`${PUZZLES_ENDPOINT}?${params.toString()}`, {
        credentials: "include",
    }).then(async (response) => {
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.message ?? `Could not load puzzles (${response.status})`);
        return body;
    });

    puzzleListCache.set(cacheKey, {
        expiresAt: Date.now() + PUZZLE_LIST_CACHE_TTL_MS,
        promise: request,
    });
    while (puzzleListCache.size > PUZZLE_LIST_CACHE_MAX_ENTRIES) {
        puzzleListCache.delete(puzzleListCache.keys().next().value);
    }
    request.catch(() => {
        if (puzzleListCache.get(cacheKey)?.promise === request) puzzleListCache.delete(cacheKey);
    });
    return request;
}

export async function fetchPuzzle(puzzleNumber) {
    const response = await fetch(`${PUZZLES_ENDPOINT}/${encodeURIComponent(puzzleNumber)}`, {
        credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    const message = typeof body === "string" ? body : body.message;
    if (!response.ok) throw new Error(message ?? `Could not load puzzle (${response.status})`);
    return body;
}

export async function submitPuzzleAttempt(puzzleNumber, payload) {
    const response = await fetch(`${PUZZLES_ENDPOINT}/${encodeURIComponent(puzzleNumber)}/attempt`, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders("POST")),
        },
        body: JSON.stringify(payload ?? {}),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errors = Array.isArray(body.errors) && body.errors.length ? `: ${body.errors.join("; ")}` : "";
        const message = typeof body === "string" ? body : body.message;
        throw new Error(`${message ?? `Could not simulate puzzle (${response.status})`}${errors}`);
    }
    clearPuzzleListCache();
    return body;
}

export async function savePuzzle(payload) {
    const response = await fetch(ADMIN_PUZZLES_ENDPOINT, {
        method: "POST",
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders("POST")),
        },
        body: JSON.stringify(payload),
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
        const errors = Array.isArray(body.errors) && body.errors.length ? `: ${body.errors.join("; ")}` : "";
        throw new Error(`${body.message ?? `Could not save puzzle (${response.status})`}${errors}`);
    }
    clearPuzzleListCache();
    return body;
}
