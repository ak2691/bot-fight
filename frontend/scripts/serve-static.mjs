import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import { extname, isAbsolute, relative, resolve, sep } from "node:path";

const SCRIPT_DIR = fileURLToPath(new URL(".", import.meta.url));
const DEFAULT_ROOT = resolve(SCRIPT_DIR, "../dist");
const IMMUTABLE_CACHE_CONTROL = "public, max-age=31536000, immutable";
const HTML_CACHE_CONTROL = "no-store, no-cache, must-revalidate";
const MIME_TYPES = new Map([
    [".css", "text/css; charset=utf-8"],
    [".html", "text/html; charset=utf-8"],
    [".ico", "image/x-icon"],
    [".jpeg", "image/jpeg"],
    [".jpg", "image/jpeg"],
    [".js", "text/javascript; charset=utf-8"],
    [".json", "application/json; charset=utf-8"],
    [".map", "application/json; charset=utf-8"],
    [".otf", "font/otf"],
    [".png", "image/png"],
    [".svg", "image/svg+xml"],
    [".ttf", "font/ttf"],
    [".wasm", "application/wasm"],
    [".webp", "image/webp"],
    [".woff", "font/woff"],
    [".woff2", "font/woff2"],
]);

export function createStaticServer({ root = DEFAULT_ROOT } = {}) {
    const documentRoot = resolve(root);
    return createServer(async (request, response) => {
        if (request.method !== "GET" && request.method !== "HEAD") {
            response.writeHead(405, { Allow: "GET, HEAD", "Cache-Control": HTML_CACHE_CONTROL });
            response.end();
            return;
        }

        let pathname;
        try {
            pathname = decodeURIComponent(new URL(request.url ?? "/", "http://localhost").pathname);
        } catch {
            response.writeHead(400, { "Cache-Control": HTML_CACHE_CONTROL });
            response.end("Bad request");
            return;
        }

        const requestedFile = safeResolve(documentRoot, pathname);
        let filePath = requestedFile;
        let fileInfo = filePath ? await regularFileInfo(filePath) : null;
        if (!fileInfo) {
            filePath = resolve(documentRoot, "index.html");
            fileInfo = await regularFileInfo(filePath);
        }
        if (!fileInfo) {
            response.writeHead(404, { "Cache-Control": HTML_CACHE_CONTROL });
            response.end("Not found");
            return;
        }

        const contentType = MIME_TYPES.get(extname(filePath).toLowerCase()) ?? "application/octet-stream";
        const isHtml = extname(filePath).toLowerCase() === ".html";
        const cacheControl = isHtml
            ? HTML_CACHE_CONTROL
            : isContentHashedAsset(filePath) ? IMMUTABLE_CACHE_CONTROL : HTML_CACHE_CONTROL;
        response.writeHead(200, {
            "Cache-Control": cacheControl,
            "Content-Length": fileInfo.size,
            "Content-Type": contentType,
            "X-Content-Type-Options": "nosniff",
        });
        if (request.method === "HEAD") {
            response.end();
            return;
        }
        createReadStream(filePath).on("error", () => {
            if (!response.headersSent) response.writeHead(500, { "Cache-Control": HTML_CACHE_CONTROL });
            response.end();
        }).pipe(response);
    });
}

function safeResolve(root, pathname) {
    const decodedPath = pathname.replace(/^\/+/, "");
    const candidate = resolve(root, decodedPath || "index.html");
    const pathFromRoot = relative(root, candidate);
    if (pathFromRoot === ".." || pathFromRoot.startsWith(`..${sep}`) || isAbsolute(pathFromRoot)) return null;
    return candidate;
}

async function regularFileInfo(path) {
    try {
        const info = await stat(path);
        return info.isFile() ? info : null;
    } catch {
        return null;
    }
}

function isContentHashedAsset(filePath) {
    const filename = filePath.slice(filePath.lastIndexOf(sep) + 1);
    return /(?:-|\.)[A-Za-z0-9_-]{8,}\.[^.]+$/.test(filename);
}

function readPort(args = process.argv.slice(2)) {
    const index = args.indexOf("--port");
    const configuredPort = index >= 0 ? Number(args[index + 1]) : Number(process.env.PORT ?? 5173);
    return Number.isInteger(configuredPort) && configuredPort >= 0 && configuredPort <= 65535
        ? configuredPort
        : 5173;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))) {
    const port = readPort();
    const hostIndex = process.argv.indexOf("--host");
    const host = hostIndex >= 0 ? process.argv[hostIndex + 1] : "0.0.0.0";
    createStaticServer().listen(port, host, () => {
        process.stdout.write(`Serving frontend on ${host}:${port}\n`);
    });
}
