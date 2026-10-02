import AppNavbar from "../../../components/AppNavbar";
import Toast, { ToastStack } from "../../../components/Toast.jsx";

export default function MatchHeader({ onExit, disconnectNotice, disconnectRemaining, context = null }) {
    return (
        <>
        <AppNavbar onHome={onExit}>
            {context && <span className="mr-auto ml-3 min-w-0 truncate text-xs text-slate-400" data-testid="match-context">{context}</span>}
        </AppNavbar>
        <DisconnectNotice notice={disconnectNotice} remaining={disconnectRemaining} />
        </>
    );
}

export function DisconnectNotice({ notice, remaining }) {
    if (!notice) return null;
    return (
        <ToastStack>
            <Toast
                tone="warning"
                actionLabel={notice.self ? "Reconnect" : null}
                onAction={notice.self ? () => window.location.reload() : null}
            >
                {notice.message}{notice.endsAtMs ? ` (${remaining} s left)` : ""}
            </Toast>
        </ToastStack>
    );
}
