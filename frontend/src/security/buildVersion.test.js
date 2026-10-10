import test from 'node:test';
import assert from 'node:assert/strict';
import { installBuildVersionReload } from './buildVersion.js';

test('only a different server build schedules one notice and reload, preserving responses', async () => {
    const notices = [], timers = [];
    let version = 'same', reloads = 0;
    const response = { headers: { get: () => version } };
    const target = {
        fetch: async () => response,
        document: { createElement: () => ({ setAttribute() {}, style: {} }), body: { appendChild: (node) => notices.push(node) } },
        setTimeout: (callback, delay) => timers.push({ callback, delay }),
        location: { reload: () => reloads++ },
    };
    installBuildVersionReload({ target, buildVersion: 'same', delayMs: 1800 });
    assert.equal(await target.fetch('/api/me'), response);
    assert.equal(timers.length, 0);
    version = null;
    await target.fetch('/api/me');
    assert.equal(timers.length, 0);
    version = 'new';
    await Promise.all([target.fetch('/api/me'), target.fetch('/api/time')]);
    assert.equal(notices.length, 1);
    assert.equal(timers.length, 1);
    assert.match(notices[0].textContent, /Reloading/);
    assert.equal(timers[0].delay, 1800);
    assert.equal(reloads, 0);
    timers[0].callback();
    assert.equal(reloads, 1);
});
