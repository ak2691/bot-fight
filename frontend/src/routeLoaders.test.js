import assert from "node:assert/strict";
import test from "node:test";
import { createBrowserPreloader } from "./routeLoaders.js";

test("browser preloader is inert outside the browser", async () => {
    let calls = 0;
    const preload = createBrowserPreloader(() => {
        calls += 1;
    });

    await preload();
    assert.equal(calls, 0);
});

test("browser preloader shares in-flight work and safely recovers from rejection", async () => {
    const originalWindow = globalThis.window;
    globalThis.window = {};
    try {
        let calls = 0;
        let release;
        const pending = new Promise((resolve) => { release = resolve; });
        const preload = createBrowserPreloader(async () => {
            calls += 1;
            await pending;
        });

        const first = preload();
        const second = preload();
        assert.strictEqual(first, second);
        assert.equal(calls, 0, "work starts on the microtask after page code returns");
        release();
        await Promise.all([first, second]);
        assert.equal(calls, 1);

        let shouldFail = true;
        const retryable = createBrowserPreloader(async () => {
            calls += 1;
            if (shouldFail) {
                shouldFail = false;
                throw new Error("preload failed");
            }
        });
        await assert.doesNotReject(retryable());
        await assert.doesNotReject(retryable());
        assert.equal(calls, 3);
    } finally {
        if (originalWindow === undefined) delete globalThis.window;
        else globalThis.window = originalWindow;
    }
});
