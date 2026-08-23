import AppNavbar from "../../../components/AppNavbar";

export default function MatchHeader({ onExit, disconnectNotice, disconnectRemaining }) {
    return (
        <>
        <AppNavbar onHome={onExit} />
        <DisconnectNotice notice={disconnectNotice} remaining={disconnectRemaining} />
        </>
    );
}

export function DisconnectNotice({ notice, remaining }) {
    if (!notice) return null;
    return (
        <aside role="alert" className="fixed inset-x-4 top-16 z-[100] mx-auto max-w-xl rounded-xl border border-amber-400/60 bg-[#171208f2] px-5 py-4 shadow-[0_18px_60px_rgba(0,0,0,.5)] backdrop-blur">
            <div className="flex items-center gap-4">
                <div className="grid h-11 w-11 flex-none place-items-center rounded-full border border-amber-400/50 font-mono text-lg font-bold text-amber-300">
                    {notice.endsAtMs ? remaining : "!"}
                </div>
                <div className="min-w-0 flex-1">
                    <p className="font-mono text-[10px] font-bold tracking-[.18em] text-amber-300">CONNECTION INTERRUPTED</p>
                    <p className="mt-1 text-sm leading-5 text-slate-200">{notice.message}</p>
                </div>
                {notice.self && (
                    <button type="button" onClick={() => window.location.reload()} className="gray-button-surface flex-none border border-cyan-400/50 px-3 py-2 text-xs font-bold text-cyan-200">
                        Reconnect
                    </button>
                )}
            </div>
        </aside>
    );
}
