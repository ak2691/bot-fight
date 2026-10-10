export function installBuildVersionReload({
    target = window,
    document = target.document,
    buildVersion = import.meta.env?.VITE_BUILD_VERSION ?? "development",
    delayMs = 1800,
} = {}) {
    const originalFetch = target.fetch.bind(target);
    let scheduled = false;
    target.fetch = async (...args) => {
        const response = await originalFetch(...args);
        const version = response.headers.get("X-Build-Version");
        if (version && version !== buildVersion && !scheduled) {
            scheduled = true;
            const notice = document.createElement("div");
            notice.setAttribute("role", "status");
            notice.textContent = "Botfight has been updated. Reloading in a moment…";
            Object.assign(notice.style, { position: "fixed", top: "16px", left: "50%", transform: "translateX(-50%)",
                zIndex: "2147483647", padding: "14px 20px", background: "#172033", color: "white", borderRadius: "8px" });
            document.body.appendChild(notice);
            target.setTimeout(() => target.location.reload(), delayMs);
        }
        return response;
    };
}
