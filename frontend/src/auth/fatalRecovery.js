export function fatalPageMessage(error) {
    const message = String(error?.message ?? error ?? "").toLowerCase();
    if (/dynamically imported|importing a module|loading (?:chunk|css)|chunkloaderror|module script/.test(message)) {
        return "A page file could not be loaded. Refresh the page to load the current version.";
    }
    return "This page could not recover in the current session. Refresh the page to continue.";
}

export function isUnsupportedWebGL(error) {
    const message = String(error?.message ?? error ?? "").toLowerCase();
    return /webgl|graphics context/.test(message)
        && /not supported|unsupported|unavailable|could not be created|failed to create|unable to initialize/.test(message);
}
