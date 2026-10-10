import assert from 'node:assert/strict';
import { once } from 'node:events';
import { setTimeout as delay } from 'node:timers/promises';
import http from 'node:http';
import { readFileSync, readdirSync, mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';
import Ajv2020 from 'ajv/dist/2020.js';
import { createWorkerService } from '../src/server.js';
import { engineVersion, hashContracts } from '../src/version.js';
import { normalizeAbilityStrategyConfiguration } from '../../shared/engine/botlogic/code/BotCode.js';
import { STANDARD_ABILITY_IDS } from '../../shared/engine/loadout/BotLoadout.js';
import { stateHash } from '../../frontend/src/gameArena/testing/goldenScenarioRunner.js';

const read = (relative) => JSON.parse(readFileSync(new URL(relative, import.meta.url), 'utf8'));
const scenarios = read('../../shared/gameplay-tests/goldenScenarios.json');
const golden = read('../../shared/gameplay-tests/golden.browser.json');
const responseValid = new Ajv2020({ strict: false }).compile(read('../../shared/schemas/simulation-response.schema.json'));
const secret = 'test-only-sim-worker-secret';
const uuid = (slot) => `00000000-0000-4000-8000-${String(slot).padStart(12, '0')}`;
function brainOf(bot) {
    // The engine normalizer returns the tree; loadout is a separate contract field.
    return {
        ...normalizeAbilityStrategyConfiguration({ version: 'bot-logic-tree-v2', roots: bot.roots }),
        loadout: { abilities: bot.abilities.filter((id) => !STANDARD_ABILITY_IDS.includes(id)) },
    };
}
function requestFor(scenario = scenarios.scenarios[0]) {
    return {
        matchId: uuid(99), rulesetVersion: 'duel-v2', seed: 1,
        arena: { ...scenarios.arena, durationMs: scenario.ticks * 100 },
        bots: scenario.bots.map((bot) => ({
            userId: uuid(bot.slot), username: `bot${bot.slot}`, slot: bot.slot,
            x: bot.x, y: bot.y, rotation: bot.rotation, size: 60, selectedLoadout: 'custom',
            teamNumber: bot.slot, initialHp: bot.hp ?? null,
            // Legacy golden trees are normalized at the caller, as Spring submissions are.
            brain: brainOf(bot),
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
        const response = await fetch(`${base}/simulate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret, ...headers }, body: typeof body === 'string' ? body : JSON.stringify(body) });
        const json = await response.json();
        assert.equal(response.headers.get('x-engine-version'), service.version.engineVersion);
        assert.equal(json.result?.engineVersion ?? json.engineVersion, service.version.engineVersion);
        return { status: response.status, json };
    };
    return { ...service, base, call };
}

test('all golden scenarios over real HTTP match every browser golden replay hash', async (t) => {
    const service = await start(t);
    for (const scenario of scenarios.scenarios) {
        await t.test(scenario.id, async () => {
            const { status, json } = await service.call({ ...requestFor(scenario), diagnostics: { stateHashes: true } });
            assert.equal(status, 200, JSON.stringify(json));
            assert.ok(responseValid(json), JSON.stringify(responseValid.errors));
            const frames = json.replay.batches.flatMap((batch) => batch.frames);
            assert.ok(frames.length > 0);
            assert.equal(frames.length, json.result.segmentEndMs / 100);
            assert.deepEqual(frames.map((frame) => stateHash(frame.shapes)), golden.scenarios[scenario.id].hashes.slice(0, frames.length));
            assert.deepEqual(json.diagnostics.stateHashes, golden.scenarios[scenario.id].hashes.slice(0, frames.length));
        });
    }
});

test('health, secret, malformed JSON, schema and semantic failures preserve service availability', async (t) => {
    const service = await start(t);
    const health = await fetch(`${service.base}/health`);
    assert.equal(health.status, 200);
    assert.deepEqual((await health.json()).engineVersion, engineVersion().engineVersion);
    assert.equal((await service.call(requestFor(), { 'x-sim-worker-secret': '' })).status, 401);
    for (const bad of ['{', 'null', '[]', '{}', '{"seed":1e400}', '['.repeat(65) + ']'.repeat(65)]) assert.equal((await service.call(bad)).status, 400);
    const invalidBrain = requestFor(); invalidBrain.bots[0].brain.smuggled = true;
    const invalid = await service.call(invalidBrain);
    assert.equal(invalid.status, 400); assert.ok(invalid.json.error.issues.length);
    const badRoster = requestFor(); badRoster.bots[1].slot = 1;
    assert.equal((await service.call(badRoster)).status, 400);
    const badSeed = requestFor(); badSeed.seed = 9007199254740992;
    assert.equal((await service.call(badSeed)).status, 400);
    const badSegment = requestFor(); badSegment.segments = [{ endsAtMs: 101, bots: [] }];
    assert.equal((await service.call(badSegment)).status, 400);
    const unknown = await fetch(`${service.base}/nope`);
    assert.equal(unknown.status, 404); assert.equal((await unknown.json()).engineVersion, service.version.engineVersion);
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
    assert.equal(response.status, 413); assert.equal(response.body.engineVersion, service.version.engineVersion);
});

test('tick cap rejects valid requests before running the fight', async (t) => {
    const service = await start(t, { maxTicks: 1 });
    assert.equal((await service.call(requestFor())).json.error.code, 'TICK_LIMIT');
    const segmented = requestFor(); segmented.segments = [{ endsAtMs: 200, bots: [] }];
    assert.equal((await service.call(segmented)).status, 400);
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
    const stalled = requestFor(); stalled.seed = 42;
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

test('version hash covers exact gameplay/schema bytes and filenames', () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'botfight-version-'));
    try {
        mkdirSync(path.join(dir, 'gameplay')); mkdirSync(path.join(dir, 'schemas'));
        writeFileSync(path.join(dir, 'gameplay', 'a.json'), '{}');
        writeFileSync(path.join(dir, 'schemas', 'a.json'), '{}');
        const initial = hashContracts(dir);
        assert.equal(hashContracts(dir), initial);
        writeFileSync(path.join(dir, 'schemas', 'a.json'), '{"changed":true}');
        assert.notEqual(hashContracts(dir), initial);
        const changed = hashContracts(dir);
        writeFileSync(path.join(dir, 'gameplay', 'a.json'), '[]');
        assert.notEqual(hashContracts(dir), changed);
    } finally { rmSync(dir, { recursive: true, force: true }); }
});

test('startup requires a secret and valid bounds', () => {
    assert.throws(() => createWorkerService({ env: {} }), /SECRET/);
    assert.throws(() => createWorkerService({ secret, maxTicks: 1201 }), /maxTicks/);
});

test('segmented replay is deterministic and preserves version and segment-relative times', async (t) => {
    const service = await start(t);
    const request = requestFor();
    request.segments = [{ endsAtMs: 100, bots: [] }, { endsAtMs: 200, bots: [{ slot: 1, selectedLoadout: 'custom', brain: request.bots[0].brain }] }];
    request.recordFromMs = 100;
    const first = await service.call(request);
    assert.equal(first.status, 200);
    assert.equal(first.json.result.segmentEndMs, 200);
    assert.equal(first.json.replay.batches[0].frames[0].elapsedMs, 100);
    assert.deepEqual((await service.call(request)).json, first.json);
});

test('bounded diagnostics preserve deterministic hashes and accept exact long seeds', async (t) => {
    const service = await start(t);
    const request = requestFor();
    request.arena.durationMs = 1000;
    request.seed = '9223372036854775807';
    request.diagnostics = { stateHashes: true, stopAtMs: 200 };
    const { status, json } = await service.call(request);
    assert.equal(status, 200, JSON.stringify(json));
    assert.ok(responseValid(json), JSON.stringify(responseValid.errors));
    assert.equal(json.result.segmentEndMs, 200);
    assert.equal(json.diagnostics.stateHashes.length, 2);
    const full = await service.call({ ...request, diagnostics: { stateHashes: true } });
    assert.deepEqual(json.diagnostics.stateHashes, full.json.diagnostics.stateHashes.slice(0, 2));
    const normal = await service.call({ ...request, diagnostics: undefined });
    assert.equal(normal.json.diagnostics, undefined);
    for (const seed of ['9223372036854775808', '-9223372036854775809', '01']) {
        assert.equal((await service.call({ ...request, seed })).status, 400);
    }
    assert.equal((await service.call({ ...request, diagnostics: { stopAtMs: 101 } })).status, 400);
});


test('authority puzzle rules run inside the real HTTP worker and return their stopping tick', async (t) => {
    const service = await start(t);
    const request = requestFor();
    const win = { kind: 'win', branches: [{ conditions: [{ type: 'always' }] }] };
    request.puzzle = { logicConfiguration: { version: 'bot-logic-tree-v2', customVariables: [], roots: [win] }, timeLimitMs: 1000 };
    request.arena.durationMs = 1000;
    const { status, json } = await service.call(request);
    assert.equal(status, 200, JSON.stringify(json));
    assert.equal(json.result.puzzleStatus, 'solved');
    assert.equal(json.result.segmentEndMs, 100);
    assert.ok(responseValid(json), JSON.stringify(responseValid.errors));
    request.puzzle.logicConfiguration.roots = [];
    const failed = await service.call(request);
    assert.equal(failed.json.result.puzzleStatus, 'failed');
});

test('validate runs the brain schema and brain rules on every shared fixture', async (t) => {
    const service = await start(t);
    const check = async (body) => {
        const response = await fetch(`${service.base}/validate`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-sim-worker-secret': secret }, body: JSON.stringify(body) });
        const json = await response.json();
        // A brain nested past the JSON depth cap is refused before validation (400 JSON_DEPTH_LIMIT).
        return response.status === 200 ? json.errors : [json.error.code];
    };
    const dir = new URL('../../shared/brain-tests/', import.meta.url);
    for (const kind of ['valid', 'invalid']) {
        for (const name of readdirSync(new URL(kind, dir))) {
            const { brain, options } = JSON.parse(readFileSync(new URL(`${kind}/${name}`, dir), 'utf8'));
            const errors = await check({ brain, ...options });
            if (kind === 'valid') assert.deepEqual(errors, [], name);
            else assert.ok(errors.length > 0, name);
        }
    }
    const rules = { version: 'bot-logic-tree-v2', customVariables: [], roots: [{ kind: 'win', branches: [{ conditions: [{ type: 'always' }], children: [] }] }] };
    assert.deepEqual(await check({ brain: rules, puzzleRules: true }), []);
    assert.ok((await check({ brain: rules })).length > 0, 'a puzzle root kind is not part of a brain');
});
