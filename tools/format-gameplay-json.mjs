// Formats shared/gameplay/*.json: a value that fits on one line stays on one line, so an ability reads top
// to bottom. Fields that do not apply are left out (absent means "does not apply").
// Run from the repository root after editing the files: node tools/format-gameplay-json.mjs
import { readFileSync, writeFileSync } from "node:fs";

const FILES = ["abilities", "statuses", "channels", "movement"].map((name) => `shared/gameplay/${name}.json`);
const WIDTH = 110;

function withoutNulls(value) {
    if (Array.isArray(value)) return value.map(withoutNulls);
    if (value && typeof value === "object") {
        return Object.fromEntries(Object.entries(value)
            .filter(([, entry]) => entry !== null)
            .map(([key, entry]) => [key, withoutNulls(entry)]));
    }
    return value;
}

function inline(value) {
    if (Array.isArray(value)) return `[${value.map(inline).join(", ")}]`;
    if (value && typeof value === "object") {
        const entries = Object.entries(value).map(([key, entry]) => `${JSON.stringify(key)}: ${inline(entry)}`);
        return entries.length ? `{ ${entries.join(", ")} }` : "{}";
    }
    return JSON.stringify(value);
}

/** `column` is where the value starts on its line; `indent` is the line's indentation. */
function format(value, indent, column) {
    const flat = inline(value);
    if (column + flat.length <= WIDTH || value === null || typeof value !== "object") return flat;
    const inner = `${indent}  `;
    const lines = Array.isArray(value)
        ? value.map((entry) => inner + format(entry, inner, inner.length))
        : Object.entries(value).map(([key, entry]) => {
            const head = `${inner}${JSON.stringify(key)}: `;
            return head + format(entry, inner, head.length);
        });
    const [open, close] = Array.isArray(value) ? ["[", "]"] : ["{", "}"];
    return `${open}\n${lines.join(",\n")}\n${indent}${close}`;
}

for (const file of FILES) {
    const data = withoutNulls(JSON.parse(readFileSync(file, "utf8")));
    writeFileSync(file, `${format(data, "", 0)}\n`);
}
