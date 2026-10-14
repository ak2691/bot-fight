import { createServer } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { availableParallelism } from 'node:os';
import { fileURLToPath } from 'node:url';
import Piscina from 'piscina';
import { engineVersion } from './version.js';

class HttpError extends Error {
    constructor(status, code) { super(code); this.status = status; this.code = code; }
}

function boundedInteger(value, fallback, name, min = 1, max = Number.MAX_SAFE_INTEGER) {
    const parsed = value == null ? fallback : Number(value);
    if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}`);
    return parsed;
}

function checkDepth(text, limit) {
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (const ch of text) {
        if (quoted) {
            if (escaped) escaped = false;
            else if (ch === '\\') escaped = true;
            else if (ch === '"') quoted = false;
        } else if (ch === '"') quoted = true;
        else if (ch === '{' || ch === '[') {
            if (++depth > limit) throw new HttpError(400, 'JSON_DEPTH_LIMIT');
        } else if (ch === '}' || ch === ']') depth--;
    }
}

function readBody(req, maxBytes, timeoutMs) {
    return new Promise((resolve, reject) => {
        let size = 0;
        const chunks = [];
        const timer = setTimeout(() => finish(new HttpError(408, 'BODY_TIMEOUT')), timeoutMs);
        function cleanup() {
            clearTimeout(timer);
            req.off('data', data); req.off('end', end); req.off('error', failed); req.off('aborted', aborted);
        }
        function finish(error, value) {
            cleanup();
            if (error) { req.resume(); reject(error); } else resolve(value);
        }
        function data(chunk) {
            size += chunk.length;
            if (size > maxBytes) finish(new HttpError(413, 'BODY_TOO_LARGE'));
            else chunks.push(chunk);
        }
        function end() { finish(null, Buffer.concat(chunks)); }
        function failed() { finish(new HttpError(400, 'INVALID_BODY')); }
        function aborted() { finish(new HttpError(400, 'INCOMPLETE_BODY')); }
        req.on('data', data); req.on('end', end); req.on('error', failed); req.on('aborted', aborted);
        if (Number(req.headers['content-length']) > maxBytes) finish(new HttpError(413, 'BODY_TOO_LARGE'));
    });
}

export function createWorkerService(options = {}) {
    const env = options.env ?? process.env;
    const secret = options.secret ?? env.SIM_WORKER_SECRET;
    if (typeof secret !== 'string' || !secret.trim()) throw new Error('SIM_WORKER_SECRET is required');
    const expectedSecret = Buffer.from(secret);
    const version = options.version ?? engineVersion();
    const threads = boundedInteger(options.threads ?? env.SIM_WORKER_THREADS, availableParallelism(), 'threads');
    const maxQueue = boundedInteger(options.maxQueue ?? env.SIM_WORKER_MAX_QUEUE, threads * 2, 'maxQueue', 0);
    const maxBodyBytes = boundedInteger(options.maxBodyBytes ?? env.SIM_WORKER_MAX_BODY_BYTES, 1_048_576, 'maxBodyBytes');
    const maxTicks = boundedInteger(options.maxTicks ?? env.SIM_WORKER_MAX_TICKS, 1200, 'maxTicks', 1, 1200);
    const taskTimeoutMs = boundedInteger(options.taskTimeoutMs ?? env.SIM_WORKER_TASK_TIMEOUT_MS, 10_000, 'taskTimeoutMs');
    const bodyTimeoutMs = boundedInteger(options.bodyTimeoutMs ?? env.SIM_WORKER_BODY_TIMEOUT_MS, 5_000, 'bodyTimeoutMs');
    const logger = options.logger ?? ((entry) => console.log(JSON.stringify(entry)));
    const pool = new Piscina({
        filename: options.workerFilename ?? fileURLToPath(new URL('./worker.js', import.meta.url)),
        minThreads: threads, maxThreads: threads, maxQueue, concurrentTasksPerWorker: 1,
    });
    pool.on('error', (error) => logger({ event: 'pool_error', message: error.message, engineVersion: version.engineVersion }));
    let active = 0;
    let closing = false;
    const server = createServer({ maxHeaderSize: 16_384 }, async (req, res) => {
        const started = performance.now();
        const send = (status, body) => {
            if (res.destroyed || res.writableEnded) return;
            res.writeHead(status, { 'content-type': 'application/json', 'x-engine-version': version.engineVersion, 'connection': 'close' });
            res.end(JSON.stringify(body));
            logger({ event: 'http_response', method: req.method, path: req.url, status, durationMs: Math.round(performance.now() - started), engineVersion: version.engineVersion });
        };
        const fail = (status, code, issues = []) => send(status, { engineVersion: version.engineVersion, error: { code, issues } });
        if (req.method === 'GET' && req.url === '/health') {
            send(closing ? 503 : 200, { status: closing ? 'stopping' : 'ok', ...version, threads });
            return;
        }
        const task = req.method === 'POST' && req.url === '/simulate' ? 'default' : undefined;
        if (!task) { fail(404, 'NOT_FOUND'); req.resume(); return; }
        const supplied = Buffer.from(req.headers['x-sim-worker-secret'] ?? '');
        if (supplied.length !== expectedSecret.length || !timingSafeEqual(supplied, expectedSecret)) { fail(401, 'UNAUTHORIZED'); req.resume(); return; }
        if (closing || active >= threads + maxQueue) { fail(503, 'WORKER_BUSY'); req.resume(); return; }
        if (req.headers['content-type']?.split(';')[0].trim().toLowerCase() !== 'application/json') { fail(415, 'JSON_REQUIRED'); req.resume(); return; }
        active++;
        const controller = new AbortController();
        const disconnected = () => { if (!res.writableEnded) controller.abort(); };
        res.on('close', disconnected);
        let timer;
        let timedOut = false;
        try {
            const bytes = await readBody(req, maxBodyBytes, bodyTimeoutMs);
            let request;
            try {
                const text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
                checkDepth(text, 64);
                request = JSON.parse(text);
            } catch (error) {
                if (error instanceof HttpError) throw error;
                throw new HttpError(400, 'INVALID_JSON');
            }
            if (controller.signal.aborted) return;
            timer = setTimeout(() => { timedOut = true; controller.abort(); }, taskTimeoutMs);
            // Piscina cancellation stops the actual worker thread, even during synchronous CPU work.
            const reply = await pool.run({ request, engineVersion: version.engineVersion, maxTicks }, { name: task, signal: controller.signal });
            if (reply.status === 200) send(200, reply.body);
            else fail(reply.status, reply.error.code, reply.error.issues);
        } catch (error) {
            if (timedOut) fail(504, 'SIMULATION_TIMEOUT');
            else if (error instanceof HttpError) fail(error.status, error.code);
            else if (['Task queue is at limit', 'No task queue available and all Workers are busy'].includes(error.message)) fail(503, 'WORKER_BUSY');
            else if (!controller.signal.aborted) { logger({ event: 'task_error', message: error.message, engineVersion: version.engineVersion }); fail(500, 'SIMULATION_FAILED'); }
        } finally {
            clearTimeout(timer);
            res.off('close', disconnected);
            active--;
        }
    });
    server.headersTimeout = 10_000;
    server.requestTimeout = bodyTimeoutMs + 10_000;
    server.on('clientError', (_error, socket) => {
        if (!socket.writable) return;
        const body = JSON.stringify({ engineVersion: version.engineVersion, error: { code: 'INVALID_HTTP', issues: [] } });
        socket.end(`HTTP/1.1 400 Bad Request\r\nContent-Type: application/json\r\nX-Engine-Version: ${version.engineVersion}\r\nConnection: close\r\nContent-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
    });
    return {
        server, pool, version,
        async close() {
            closing = true;
            const stopped = new Promise((resolve) => server.close(resolve));
            server.closeAllConnections();
            await pool.destroy();
            await stopped;
        },
    };
}
