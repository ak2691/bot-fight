const SITEMAP_ICON_URL = "/assets/arena-toolbar/sitemap-icon.svg";

export default function MatchToolIcon({ name, className = "h-5 w-5" }) {
    if (name === "node") {
        const maskStyle = {
            WebkitMaskImage: `url("${SITEMAP_ICON_URL}")`,
            maskImage: `url("${SITEMAP_ICON_URL}")`,
            WebkitMaskPosition: "center",
            maskPosition: "center",
            WebkitMaskRepeat: "no-repeat",
            maskRepeat: "no-repeat",
            WebkitMaskSize: "contain",
            maskSize: "contain",
        };
        return <span aria-hidden="true" className={`${className} flex-none bg-current`} style={maskStyle} />;
    }

    const paths = {
        status: <><circle cx="12" cy="12" r="7"/><path d="M12 2v3m0 14v3M2 12h3m14 0h3"/></>,
        tools: <><path d="m14 6 4-4 4 4-4 4M3 21l8-8m-5 8-3-3 8-8"/><path d="m14 14 7 7m-4-11 4 4"/></>,
        play: <path d="m8 5 11 7-11 7Z"/>,
        pause: <><path d="M8 5v14"/><path d="M16 5v14"/></>,
        stats: <path d="M5 20v-7h3v7m4 0V8h3v12m4 0V4h3v16"/>,
        measure: <><path d="m4 17 13-13 3 3L7 20Z"/><path d="m8 15 2 2m1-5 2 2m1-5 2 2"/></>,
        edit: <><path d="M4 20h5L20 9l-5-5L4 15Z"/><path d="m13 6 5 5"/></>,
        target: <><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="1"/><path d="M12 2v4m0 12v4M2 12h4m12 0h4"/></>,
        opponent: <><circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/></>,
        save: <path d="M6 3h12v18l-6-4-6 4Z"/>,
        load: <><path d="M12 3v12m-4-8 4-4 4 4"/><path d="M5 14v6h14v-6"/></>,
        reset: <><path d="M4 11a8 8 0 1 1 2 6"/><path d="M4 5v6h6"/></>,
        check: <><circle cx="12" cy="12" r="9"/><path d="m8 12 3 3 6-7"/></>,
        stop: <><circle cx="12" cy="12" r="9"/><path d="M9 9h6v6H9z"/></>,
        finish: <><path d="M5 21V4"/><path d="M5 5h12l-2 4 2 4H5"/></>,
        flag: <><path d="M5 22V3"/><path d="M5 4h13l-3 4 3 4H5"/></>,
    };
    return <svg aria-hidden="true" viewBox="0 0 24 24" className={`${className} flex-none`} fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">{paths[name] ?? paths.tools}</svg>;
}
