import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import AppNavbar from "../../components/AppNavbar.jsx";
import {
    deleteChatReport,
    fetchChatReport,
    fetchChatReportAudit,
    fetchChatReports,
    resolveChatReport,
} from "../../chatModeration/chatModerationApi.js";

const STATUS_FILTERS = ["", "OPEN", "ACTIONED", "DISMISSED", "RESOLVED"];
const RESOLUTION_STATUSES = ["ACTIONED", "DISMISSED", "RESOLVED"];

export default function ChatReportsPage() {
    const [filter, setFilter] = useState("OPEN");
    const [reports, setReports] = useState([]);
    const [selectedId, setSelectedId] = useState(null);
    const [detail, setDetail] = useState(null);
    const [audit, setAudit] = useState([]);
    const [resolutionStatus, setResolutionStatus] = useState("ACTIONED");
    const [resolutionNote, setResolutionNote] = useState("");
    const [busy, setBusy] = useState(false);
    const [error, setError] = useState("");
    const [notice, setNotice] = useState("");

    const loadReports = useCallback(async () => {
        try {
            const result = await fetchChatReports({ status: filter });
            setReports(result.content ?? []);
            setError("");
            if (selectedId && !(result.content ?? []).some((report) => report.reportId === selectedId)) {
                setSelectedId(null);
                setDetail(null);
                setAudit([]);
            }
        } catch {
            setError("Chat reports could not be loaded.");
        }
    }, [filter, selectedId]);

    useEffect(() => { loadReports(); }, [loadReports]);

    const selectReport = async (reportId) => {
        setSelectedId(reportId);
        setDetail(null);
        setAudit([]);
        setError("");
        try {
            const [nextDetail, nextAudit] = await Promise.all([
                fetchChatReport(reportId),
                fetchChatReportAudit(reportId),
            ]);
            setDetail(nextDetail);
            setAudit(nextAudit);
        } catch {
            setError("Report details could not be loaded.");
        }
    };

    const resolve = async (event) => {
        event.preventDefault();
        if (!detail || busy) return;
        setBusy(true);
        setError("");
        try {
            await resolveChatReport(detail.reportId, resolutionStatus, resolutionNote);
            setNotice("Report resolved.");
            setResolutionNote("");
            await selectReport(detail.reportId);
            await loadReports();
        } catch {
            setError("Report could not be resolved.");
        } finally {
            setBusy(false);
        }
    };

    const remove = async () => {
        if (!detail || detail.status === "OPEN" || busy) return;
        setBusy(true);
        setError("");
        try {
            await deleteChatReport(detail.reportId);
            setNotice("Resolved report deleted. Its administrative audit remains available.");
            setSelectedId(null);
            setDetail(null);
            setAudit([]);
            await loadReports();
        } catch {
            setError("Report could not be deleted.");
        } finally {
            setBusy(false);
        }
    };

    return (
        <main className="chat-reports-page min-h-screen bg-[#171a1c] font-interface text-slate-100">
            <AppNavbar account currentPage="chat-reports" />
            <section className="mx-auto w-full max-w-7xl px-5 py-8 sm:px-8 sm:py-12">
                <header className="mb-7 flex flex-wrap items-end justify-between gap-4 border-b border-slate-800 pb-5">
                    <div>
                        <p className="font-mono text-[10px] font-bold tracking-[.24em] text-cyan-400">ADMINISTRATION</p>
                        <h1 className="mt-2 text-4xl font-bold uppercase text-white">Chat reports</h1>
                    </div>
                    <Link className="font-mono text-xs text-cyan-200 underline" to="/admin/puzzles/new">Puzzle administration</Link>
                </header>
                <div className="mb-5 flex items-center gap-3">
                    <label htmlFor="chat-report-filter" className="font-mono text-[10px] tracking-widest text-slate-400">STATUS</label>
                    <select id="chat-report-filter" value={filter} onChange={(event) => setFilter(event.target.value)} className="border border-slate-600 bg-[#202427] px-3 py-2 text-sm">
                        {STATUS_FILTERS.map((status) => <option key={status || "ALL"} value={status}>{status || "All reports"}</option>)}
                    </select>
                    <button type="button" className="border border-slate-600 px-3 py-2 text-xs" onClick={loadReports}>Refresh</button>
                </div>
                {notice && <p role="status" className="mb-4 border border-emerald-400/30 bg-emerald-950/20 px-4 py-3 text-sm text-emerald-200">{notice}</p>}
                {error && <p role="alert" className="mb-4 border border-rose-400/30 bg-rose-950/20 px-4 py-3 text-sm text-rose-200">{error}</p>}
                <div className="grid gap-5 lg:grid-cols-[minmax(18rem,0.8fr)_minmax(0,1.5fr)]">
                    <section className="min-w-0 border border-slate-800 bg-[#0b1218]" aria-label="Chat report list">
                        <h2 className="border-b border-slate-800 px-4 py-3 font-mono text-xs tracking-widest text-slate-400">REPORTS ({reports.length})</h2>
                        <div className="max-h-[70vh] overflow-y-auto">
                            {reports.length === 0 ? <p className="px-4 py-6 text-sm text-slate-500">No reports in this view.</p> : reports.map((report) => (
                                <button key={report.reportId} type="button" onClick={() => selectReport(report.reportId)} className={`block w-full border-b border-slate-800 px-4 py-3 text-left hover:bg-slate-900 ${selectedId === report.reportId ? "bg-slate-900" : ""}`}>
                                    <span className="flex items-center justify-between gap-3 text-sm"><strong>{report.reason.replaceAll("_", " ")}</strong><span className="text-[10px] text-slate-400">{report.status}</span></span>
                                    <span className="mt-1 block text-xs text-slate-400">{report.contextType.replaceAll("_", " ")} · {report.senderUsername}</span>
                                    <span className="mt-1 block text-[10px] text-slate-500">{formatDate(report.createdAt)} · reporter {report.reporterUsername}</span>
                                </button>
                            ))}
                        </div>
                    </section>
                    <section className="min-w-0 border border-slate-800 bg-[#0b1218]" aria-label="Chat report details">
                        {!detail ? <p className="px-5 py-8 text-sm text-slate-500">Select a report to review its evidence and actions.</p> : (
                            <div className="space-y-5 p-5">
                                <header className="flex flex-wrap items-start justify-between gap-4 border-b border-slate-800 pb-4">
                                    <div>
                                        <p className="font-mono text-[10px] tracking-widest text-cyan-300">{detail.status} · {detail.reason.replaceAll("_", " ")}</p>
                                        <h2 className="mt-2 text-xl font-bold">Message from {detail.senderUsername}</h2>
                                        <p className="mt-1 text-xs text-slate-400">Reported by {detail.reporterUsername} · {formatDate(detail.messageSentAt)}</p>
                                    </div>
                                    <span className="text-xs text-slate-500">{detail.contextType.replaceAll("_", " ")}</span>
                                </header>
                                <blockquote className="whitespace-pre-wrap break-words border-l-2 border-cyan-500 bg-slate-900/70 px-4 py-3 text-sm text-slate-100">{detail.message}</blockquote>
                                <div className="grid gap-3 text-xs text-slate-400 sm:grid-cols-2">
                                    <p>Reporter note: <span className="whitespace-pre-wrap text-slate-200">{detail.note || "None"}</span></p>
                                    <p>Context ID: <code className="break-all text-slate-200">{detail.contextId}</code></p>
                                </div>
                                {detail.status === "OPEN" ? (
                                    <form onSubmit={resolve} className="space-y-3 border-t border-slate-800 pt-4">
                                        <h3 className="font-mono text-xs tracking-widest text-slate-300">RESOLVE REPORT</h3>
                                        <label className="block text-xs text-slate-400">Outcome
                                            <select value={resolutionStatus} onChange={(event) => setResolutionStatus(event.target.value)} className="mt-1 block w-full border border-slate-600 bg-[#202427] px-3 py-2 text-sm text-white">
                                                {RESOLUTION_STATUSES.map((status) => <option key={status} value={status}>{status}</option>)}
                                            </select>
                                        </label>
                                        <label className="block text-xs text-slate-400">Admin note (optional)
                                            <textarea value={resolutionNote} onChange={(event) => setResolutionNote(event.target.value)} maxLength={500} rows={3} className="mt-1 block w-full border border-slate-600 bg-[#202427] px-3 py-2 text-sm text-white" />
                                        </label>
                                        <button type="submit" disabled={busy} className="border border-emerald-400/50 px-4 py-2 text-xs font-bold text-emerald-200 disabled:opacity-50">{busy ? "Saving…" : "Save resolution"}</button>
                                    </form>
                                ) : (
                                    <div className="border-t border-slate-800 pt-4 text-xs text-slate-400">
                                        <p>Resolved by {detail.resolverUsername || "system"} · {formatDate(detail.resolvedAt)}</p>
                                        <p className="mt-2 whitespace-pre-wrap">Admin note: {detail.resolutionNote || "None"}</p>
                                        <button type="button" onClick={remove} disabled={busy} className="mt-4 border border-rose-400/50 px-4 py-2 text-xs text-rose-200 disabled:opacity-50">Delete resolved report</button>
                                    </div>
                                )}
                                <details className="border-t border-slate-800 pt-3">
                                    <summary className="cursor-pointer font-mono text-[10px] tracking-widest text-slate-400">ADMIN ACTION AUDIT</summary>
                                    <ol className="mt-3 space-y-2 text-xs text-slate-400">
                                        {audit.map((entry) => <li key={entry.auditId}>{formatDate(entry.createdAt)} · {entry.actorUsername || "System"} · {entry.action} {entry.detail || ""}</li>)}
                                    </ol>
                                </details>
                            </div>
                        )}
                    </section>
                </div>
            </section>
        </main>
    );
}

function formatDate(value) {
    if (!value) return "—";
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}
