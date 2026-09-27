import { apiUrl } from "../config/api.js";
import { ensureCsrfHeaders } from "../security/csrf.js";

const REASONS = new Set(["HARASSMENT", "HATE_OR_SLURS", "THREATS", "SEXUAL_CONTENT", "SPAM", "OTHER"]);

async function request(path, options = {}) {
    const response = await fetch(apiUrl(path), {
        credentials: "include",
        ...options,
    });
    if (response.status === 204) return null;
    const body = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error("Chat moderation request failed.");
    return body;
}

export function submitChatReport(messageId, reason, note = "") {
    if (!messageId || !REASONS.has(reason)) throw new Error("Choose a report reason.");
    return ensureCsrfHeaders("POST").then((csrf) => request(
        `/api/chat-reports/${encodeURIComponent(messageId)}`,
        {
            method: "POST",
            headers: { "Content-Type": "application/json", ...csrf },
            body: JSON.stringify({ reason, note }),
        },
    ));
}

export function fetchChatReports({ status = "", page = 0, size = 50 } = {}) {
    const params = new URLSearchParams({ page: String(page), size: String(size) });
    if (status) params.set("status", status);
    return request(`/api/admin/chat-reports?${params.toString()}`);
}

export function fetchChatReport(reportId) {
    return request(`/api/admin/chat-reports/${encodeURIComponent(reportId)}`);
}

export function fetchChatReportAudit(reportId) {
    return request(`/api/admin/chat-reports/${encodeURIComponent(reportId)}/audit`);
}

export async function resolveChatReport(reportId, status, note = "") {
    const csrf = await ensureCsrfHeaders("PATCH");
    return request(`/api/admin/chat-reports/${encodeURIComponent(reportId)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json", ...csrf },
        body: JSON.stringify({ status, note }),
    });
}

export async function deleteChatReport(reportId) {
    const csrf = await ensureCsrfHeaders("DELETE");
    return request(`/api/admin/chat-reports/${encodeURIComponent(reportId)}`, {
        method: "DELETE",
        headers: csrf,
    });
}
