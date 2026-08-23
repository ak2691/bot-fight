import { ensureCsrfHeaders } from "../security/csrf.js";
import { apiUrl } from "../config/api.js";

export const PUZZLES_ENDPOINT = apiUrl("/api/puzzles");
export const ADMIN_PUZZLES_ENDPOINT = apiUrl("/api/admin/puzzles");

export async function fetchPuzzles(page = 0, size = 20) {
    const response = await fetch(`${PUZZLES_ENDPOINT}?page=${encodeURIComponent(page)}&size=${encodeURIComponent(size)}`, {
        credentials: "include",
    });
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(body.message ?? `Could not load puzzles (${response.status})`);
    return body;
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
    return body;
}
