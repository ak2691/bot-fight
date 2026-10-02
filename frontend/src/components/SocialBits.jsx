const ICON_PATHS = {
    users: <><circle cx="9" cy="8" r="3.2" /><path d="M3 19c.6-3.3 2.6-5 6-5s5.4 1.7 6 5" /><circle cx="17.5" cy="9" r="2.4" /><path d="M17 14.3c2.3 0 3.6 1.4 4 4" /></>,
    bell: <><path d="M6.8 10.3a5.2 5.2 0 0 1 10.4 0c0 5.6 2.2 6.1 2.2 7.1H4.6c0-1 2.2-1.5 2.2-7.1Z" /><path d="M9.8 20h4.4" /></>,
    bellOff: <><path d="M9.8 20h4.4" /><path d="M6.8 10.3c0 5.6-2.2 6.1-2.2 7.1H17" /><path d="M8.4 6.3a5.2 5.2 0 0 1 8.8 4c0 1.9.3 3.2.7 4.2" /><path d="m4 4 16 16" /></>,
    plus: <path d="M12 5v14M5 12h14" />,
    gear: <><circle cx="12" cy="12" r="3" /><path d="M12 2.8v2.4M12 18.8v2.4M4.6 7.4l2 1.2M17.4 15.4l2 1.2M4.6 16.6l2-1.2M17.4 8.6l2-1.2" /></>,
    lock: <><rect x="5" y="11" width="14" height="9" rx="2" /><path d="M8 11V8a4 4 0 0 1 8 0v3" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 7.5V12l3 2" /></>,
    send: <path d="m4 12 16-8-5 16-3-7Z" />,
    chat: <path d="M5 5.5h14v10H9l-4 3v-13Z" />,
    alert: <><circle cx="12" cy="12" r="9" /><path d="M12 7.5v5m0 3.2h.01" /></>,
    check: <><circle cx="12" cy="12" r="9" /><path d="m8 12.3 2.6 2.6L16 9.5" /></>,
    more: <><circle cx="12" cy="5" r="1.6" /><circle cx="12" cy="12" r="1.6" /><circle cx="12" cy="19" r="1.6" /></>,
};

export function Icon({ name, className = "h-4 w-4" }) {
    return (
        <svg viewBox="0 0 24 24" className={`${className} shrink-0 fill-none stroke-current`} strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {ICON_PATHS[name]}
        </svg>
    );
}
