import { useState } from "react";
import { submitChatReport } from "./chatModerationApi.js";

const REASONS = [
    ["HARASSMENT", "Harassment"],
    ["HATE_OR_SLURS", "Hate speech or slurs"],
    ["THREATS", "Threats"],
    ["SEXUAL_CONTENT", "Sexual content"],
    ["SPAM", "Spam"],
    ["OTHER", "Other"],
];

export default function ChatReportButton({ messageId }) {
    const [reason, setReason] = useState("");
    const [note, setNote] = useState("");
    const [state, setState] = useState("closed");

    if (!isServerMessageId(messageId)) return null;

    const submit = async (event) => {
        event.preventDefault();
        if (!reason || state === "sending") return;
        setState("sending");
        try {
            await submitChatReport(messageId, reason, note);
            setState("sent");
        } catch {
            setState("error");
        }
    };

    return (
        <details className="chat-report" onToggle={(event) => {
            if (!event.currentTarget.open && state !== "sent") setState("closed");
        }}>
            <summary className="chat-report__toggle" aria-label="Report this chat message">Report</summary>
            <form className="chat-report__form" onSubmit={submit}>
                <label className="chat-report__label">
                    Reason
                    <select value={reason} onChange={(event) => setReason(event.target.value)} required disabled={state === "sending" || state === "sent"}>
                        <option value="">Choose a reason</option>
                        {REASONS.map(([value, label]) => <option key={value} value={value}>{label}</option>)}
                    </select>
                </label>
                <label className="chat-report__label">
                    Note (optional)
                    <textarea value={note} onChange={(event) => setNote(event.target.value)} maxLength={300} rows={2} disabled={state === "sending" || state === "sent"} />
                </label>
                {state === "sent" ? (
                    <p className="chat-report__status" role="status">Thanks for letting us know.</p>
                ) : (
                    <>
                        {state === "error" && <p className="chat-report__status" role="status">Your report could not be submitted. Please try again later.</p>}
                        <button type="submit" disabled={!reason || state === "sending"}>{state === "sending" ? "Sending…" : "Send report"}</button>
                    </>
                )}
            </form>
        </details>
    );
}

function isServerMessageId(value) {
    return typeof value === "string" && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value);
}
