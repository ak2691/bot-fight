/** Pick the error icon from the error text when the caller does not say which kind it is. */
export function inferErrorKind(text) {
    const value = String(text ?? "").toLowerCase();
    if (/webgl|renderer|graphics/.test(value)) return "renderer";
    if (/connect|server|network|session|offline/.test(value)) return "connection";
    return "generic";
}
