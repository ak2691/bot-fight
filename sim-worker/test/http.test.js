import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import test from 'node:test';
import { createWorkerService } from '../src/server.js';
import { engineVersion, hashContracts } from '../src/version.js';

const secret = 'test-only-sim-worker-secret';
const uuid = (slot) => `00000000-0000-4000-8000-${String(slot).padStart(12, '0')}`;

// A tiny duel-v1 request: empty brains, no abilities, 1000 ms (10 ticks), two teams far apart.
function requestFor(botCount = 2) {
    return {
        matchId: uuid(99),
        rulesetVersion: 'duel-v1',
        seed: 1,
        arena: { width: 1200, height: 1200, durationMs: 1000 },
        bots: Array.from({ length: botCount }, (_, index) => ({
            userId: uuid(index + 1),
            username: `bot${index + 1}`,
            slot: index + 1,
            x: 300 + index * 600,
            y: 600,
            rotation: index === 0 ? 90 : 270,
            size: 60,
            selectedLoadout: 'custom',
            initialHp: null,
            teamNumber: index + 1,
            brain: { version: 'bot-logic-tree-v2', roots: [], loadout: { abilities: [] } },
        })),
    };
}

async function start(t, options = {}) {
    const service = createWorkerService({ secret, threads: 1, logger: () => {}, ...options });
    service.server.listen(0, '127.0.0.1');
    await once(service.server, 'listening');
    t.after(() => service.close());
    const base = `http://127.0.0.1:${service.server.address().port}`;
    const call = async (body, headers = {}) => {
        const response = await fetch(`${base}/simulate`, {
            method: 'POST',
            headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret, ...headers },
            body: typeof body === 'string' ? body : JSON.stringify(body),
        });
        const json = await response.json();
        assert.equal(response.headers.get('x-engine-version'), service.version.engineVersion);
        assert.equal(json.engineVersion, service.version.engineVersion);
        return { status: response.status, json };
    };
    return { ...service, base, call };
}

test('a tiny two-bot duel round-trips over HTTP as a draw with ten frames', async (t) => {
    const service = await start(t);
    const { status, json } = await service.call(requestFor());
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.replay.result, 'DRAW');
    assert.equal(json.replay.frames.length, 10);
    assert.equal(json.puzzle, undefined);
});

test('requests without the shared secret get 401 and are not simulated', async (t) => {
    const service = await start(t);
    const missing = await service.call(requestFor(), { 'x-sim-worker-secret': '' });
    assert.equal(missing.status, 401);
    assert.equal(missing.json.error.code, 'UNAUTHORIZED');
    const wrong = await service.call(requestFor(), { 'x-sim-worker-secret': 'nope' });
    assert.equal(wrong.status, 401);
});

test('a one-bot roster is refused with 400 INVALID_SIMULATION', async (t) => {
    const service = await start(t);
    const { status, json } = await service.call(requestFor(1));
    assert.equal(status, 400);
    assert.equal(json.error.code, 'INVALID_SIMULATION');
    assert.equal((await service.call(requestFor())).status, 200);
});

test('health, malformed JSON, non-object bodies and depth limits keep the service available', async (t) => {
    const service = await start(t);
    const health = await fetch(`${service.base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await health.json()).engineVersion, engineVersion().engineVersion);
    for (const bad of ['{', 'null', '[]', '"text"', '['.repeat(65) + ']'.repeat(65)]) {
        assert.equal((await service.call(bad)).status, 400, bad.slice(0, 20));
    }
    const removed = await fetch(`${service.base}/validate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret }, body: '{}' });
    assert.equal(removed.status, 404);
    assert.equal((await removed.json()).engineVersion, service.version.engineVersion);
    assert.equal((await service.call(requestFor())).status, 200);
});

test('body cap rejects declared and chunked oversized uploads', async (t) => {
    const service = await start(t, { maxBodyBytes: 128 });
    assert.equal((await service.call(' '.repeat(129))).status, 413);
    const response = await new Promise((resolve, reject) => {
        const req = http.request(`${service.base}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret } }, (res) => {
            let body = ''; res.on('data', (chunk) => { body += chunk; }); res.on('end', () => resolve({ status: res.statusCode, body: JSON.parse(body) }));
        });
        req.on('error', reject); req.write(' '.repeat(64)); req.end(' '.repeat(65));
    });
    assert.equal(response.status, 413);
    assert.equal(response.body.engineVersion, service.version.engineVersion);
});

test('tick cap rejects a 10-tick duel when only 5 ticks are allowed', async (t) => {
    const service = await start(t, { maxTicks: 5 });
    const { status, json } = await service.call(requestFor());
    assert.equal(status, 400);
    assert.equal(json.error.code, 'TICK_LIMIT');
});

test('slow uploads get 408 and release admission capacity', async (t) => {
    const service = await start(t, { bodyTimeoutMs: 100, maxQueue: 0 });
    const status = await new Promise((resolve, reject) => {
        const req = http.request(`${service.base}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret } }, (res) => {
            res.resume(); res.on('end', () => { req.destroy(); resolve(res.statusCode); });
        });
        req.on('error', reject); req.write('{');
    });
    assert.equal(status, 408);
    assert.equal((await service.call(requestFor())).status, 200);
});

test('CPU-bound timeout terminates its thread, health remains responsive, bounded pool recovers', async (t) => {
    const service = await start(t, { taskTimeoutMs: 1000, maxQueue: 0,
        workerFilename: fileURLToPath(new URL('./fixtures/blocking-worker.js', import.meta.url)) });
    // Warm the pool so the deadline measures the CPU loop rather than startup.
    assert.equal((await service.call(requestFor())).status, 200);
    const oldThread = service.pool.threads[0];
    const exiting = once(oldThread, 'exit');
    const stalled = requestFor();
    stalled.seed = 42;
    const running = service.call(stalled);
    await once(service.pool, 'message');
    const health = await fetch(`${service.base}/health`);
    assert.equal(health.status, 200);
    assert.equal((await service.call(requestFor())).status, 503);
    assert.equal((await running).status, 504);
    await exiting;
    let recovered;
    for (let attempt = 0; attempt < 50; attempt++) {
        recovered = await service.call(requestFor());
        if (recovered.status !== 503) break;
        await delay(20);
    }
    assert.equal(recovered.status, 200);
    assert.notEqual(service.pool.threads[0], oldThread);
});

test('version hash covers exact shared/engine bytes and filenames, skipping tests folders', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'botfight-version-'));
    try {
        mkdirSync(path.join(dir, 'match')); mkdirSync(path.join(dir, 'match', 'tests'));
        writeFileSync(path.join(dir, 'match', 'a.js'), 'export {};');
        const initial = hashContracts(dir);
        assert.equal(hashContracts(dir), initial);
        writeFileSync(path.join(dir, 'match', 'tests', 'a.test.js'), 'changed test only');
        assert.equal(hashContracts(dir), initial, 'tests folders are not hashed');
        writeFileSync(path.join(dir, 'match', 'a.js'), 'export const changed = true;');
        assert.notEqual(hashContracts(dir), initial);
        const changed = hashContracts(dir);
        writeFileSync(path.join(dir, 'match', 'b.js'), '');
        assert.notEqual(hashContracts(dir), changed);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('engine version never throws and reports a full commit or "unknown"', () => {
    const version = engineVersion();
    assert.match(version.commit, /^([0-9a-f]{40}|unknown)$/);
    assert.equal(version.engineVersion, `${version.commit}:${version.contractsHash}`);
});

test('startup requires a secret and valid bounds', () => {
    assert.throws(() => createWorkerService({ env: {} }), /SECRET/);
    assert.throws(() => createWorkerService({ secret, maxTicks: 1201 }), /maxTicks/);
});

test('close() drains an in-flight simulation instead of cutting the connection', async (t) => {
    const dir = mkdtempSync(path.join(tmpdir(), 'worker-shutdown-'));
    t.after(() => rmSync(dir, { recursive: true, force: true }));
    const file = path.join(dir, 'slow-worker.mjs');
    writeFileSync(file, `import { parentPort } from 'node:worker_threads';
export default function slow() {
    parentPort.postMessage('running');
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 400); // finite, legitimately slow task
    return { status: 200, body: { done: true } };
}`);
    const service = createWorkerService({ secret, threads: 1, logger: () => {}, workerFilename: pathToFileURL(file).href });
    service.server.listen(0, '127.0.0.1');
    await once(service.server, 'listening');
    const base = `http://127.0.0.1:${service.server.address().port}`;
    const running = fetch(`${base}/simulate`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret },
        body: '{}',
    }).then(async (r) => ({ status: r.status, json: await r.json() }), (e) => ({ error: e.message }));
    await once(service.pool, 'message'); // task is now executing inside the worker
    await service.close();               // what SIGTERM does (index.js:8-11)
    const result = await running;
    assert.equal(result.error, undefined, `in-flight request was cut off: ${result.error}`);
    assert.equal(result.status, 200);
});
