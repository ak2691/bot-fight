export const MAX_PUZZLE_SUBMISSIONS = 10;

const STORAGE_PREFIX = "botfight-puzzle-submissions-v1";
const KNOWN_STATUSES = new Set(["solved", "failed", "error"]);

export function puzzleSubmissionsStorageKey(userKey, puzzleNumber) {
    const owner = String(userKey ?? "").trim() || "guest";
    const puzzle = String(puzzleNumber ?? "").trim();
    return `${STORAGE_PREFIX}:${encodeURIComponent(owner)}:${encodeURIComponent(puzzle)}`;
}

export function loadPuzzleSubmissions(userKey, puzzleNumber, storage = browserStorage()) {
    if (!storage) return [];
    try {
        const parsed = JSON.parse(storage.getItem(puzzleSubmissionsStorageKey(userKey, puzzleNumber)) ?? "[]");
        if (!Array.isArray(parsed)) return [];
        return parsed.map(normalizeSubmission).filter(Boolean).slice(0, MAX_PUZZLE_SUBMISSIONS);
    } catch {
        return [];
    }
}

export function savePuzzleSubmission(userKey, puzzleNumber, submission, storage = browserStorage()) {
    const current = loadPuzzleSubmissions(userKey, puzzleNumber, storage);
    const nextSubmission = normalizeSubmission({
        ...submission,
        id: submission?.id ?? createSubmissionId(),
        submittedAt: submission?.submittedAt ?? new Date().toISOString(),
    });
    if (!nextSubmission) return current;

    const next = [nextSubmission, ...current].slice(0, MAX_PUZZLE_SUBMISSIONS);
    if (!storage) return next;
    try {
        storage.setItem(puzzleSubmissionsStorageKey(userKey, puzzleNumber), JSON.stringify(next));
    } catch {
        // Submission history is a convenience; a full or unavailable browser store
        // must not make an authoritative puzzle attempt fail.
    }
    return next;
}

function normalizeSubmission(value) {
    if (!value || typeof value !== "object" || !value.brain || typeof value.brain !== "object") return null;
    const submittedAt = String(value.submittedAt ?? "");
    if (!submittedAt || !Number.isFinite(Date.parse(submittedAt))) return null;
    const status = KNOWN_STATUSES.has(value.status) ? value.status : "failed";
    return {
        id: String(value.id ?? `${submittedAt}-${Math.random().toString(36).slice(2)}`),
        submittedAt,
        status,
        message: String(value.message ?? "").slice(0, 240),
        brain: value.brain,
    };
}

function createSubmissionId() {
    return globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function browserStorage() {
    if (typeof window === "undefined") return null;
    try {
        return window.localStorage;
    } catch {
        return null;
    }
}
