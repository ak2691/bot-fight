import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createStaticServer } from "./serve-static.mjs";

test("static serving prevents index caching and caches hashed assets immutably", async (context) => {
    const root = await mkdtemp(join(tmpdir(), "machiner-static-"));
    await mkdir(join(root, "assets"));
    await writeFile(join(root, "index.html"), "<main>app</main>");
    await writeFile(join(root, "assets", "index-a1b2c3d4.js"), "export default 1;");
    const server = createStaticServer({ root });
    await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
    context.after(async () => {
        await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
        await rm(root, { recursive: true, force: true });
    });
    const base = `http://127.0.0.1:${server.address().port}`;

    const index = await fetch(`${base}/`);
    const hashedAsset = await fetch(`${base}/assets/index-a1b2c3d4.js`);
    const clientRoute = await fetch(`${base}/match`);

    assert.equal(index.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    assert.equal(hashedAsset.headers.get("cache-control"), "public, max-age=31536000, immutable");
    assert.equal(clientRoute.headers.get("cache-control"), "no-store, no-cache, must-revalidate");
    assert.equal(await clientRoute.text(), "<main>app</main>");
});
