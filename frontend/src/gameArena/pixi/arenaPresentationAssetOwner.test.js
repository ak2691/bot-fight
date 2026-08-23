import test from "node:test";
import assert from "node:assert/strict";
import {
    ARENA_ASSET_STATUS,
    REQUIRED_ARENA_PRESENTATION_PATHS,
    createArenaPresentationAssetOwner,
    isArenaPresentationReady,
} from "./arenaPresentationAssetOwner.js";

const ARRAY_PATHS = new Set(REQUIRED_ARENA_PRESENTATION_PATHS.filter((path) => [
    "rays.fire_gun",
    "rays.pistol_shot",
    "rays.concussive_shot",
    "rays.rail_shot",
    "muzzleFlash",
    "stun",
    "dashSmoke",
    "windburst",
    "fireball",
    "grenadeMineExplosion",
    "gravityGrenade",
    "silencePulse",
    "nullZone",
    "temporalRewind",
    "repulsorBlast",
    "shield",
    "meleeSlash",
    "heavySlash",
    "phaseStrike",
].includes(path)));

function completeCatalogue(value = { id: "texture" }) {
    const abilities = {};
    REQUIRED_ARENA_PRESENTATION_PATHS.forEach((path) => {
        const parts = path.split(".");
        const leaf = parts.pop();
        const parent = parts.reduce((current, part) => {
            current[part] ??= {};
            return current[part];
        }, abilities);
        parent[leaf] = ARRAY_PATHS.has(path) ? [value] : value;
    });
    return { abilities };
}

function ownerWithLoader(loadCatalogue, loadAsset = async () => ({ id: "loaded" })) {
    return createArenaPresentationAssetOwner({ loadCatalogue, loadAsset });
}

test("concurrent preload calls share one in-flight promise", async () => {
    let loadCalls = 0;
    const owner = ownerWithLoader(async (loadAsset) => ({
        abilities: {
            ...completeCatalogue().abilities,
            bot: await loadAsset("bot.png", "bot.bot"),
        },
    }), async () => {
        loadCalls += 1;
        await new Promise((resolve) => setTimeout(resolve, 0));
        return { id: "bot-texture" };
    });

    const first = owner.preload();
    const second = owner.preload();
    assert.strictEqual(first, second);
    await first;
    assert.equal(loadCalls, 1);
    assert.equal(owner.getState().status, ARENA_ASSET_STATUS.READY);
    assert.equal(owner.getState().loadedCount, 1);
    assert.equal(owner.getState().totalCount, 1);
});

test("completed preload reuses the catalogue without loading again", async () => {
    let catalogueCalls = 0;
    const owner = ownerWithLoader(async () => {
        catalogueCalls += 1;
        return completeCatalogue();
    });

    const firstPromise = owner.preload();
    const secondPromise = owner.preload();
    assert.strictEqual(firstPromise, secondPromise);
    const first = await firstPromise;
    const thirdPromise = owner.preload();
    const fourthPromise = owner.preload();
    assert.strictEqual(thirdPromise, fourthPromise);
    assert.strictEqual(firstPromise, thirdPromise);
    const second = await thirdPromise;

    assert.strictEqual(first, second);
    assert.equal(catalogueCalls, 1);
});

test("failed preload exposes the asset and retry safely starts a new attempt", async () => {
    const loadCounts = new Map();
    const owner = ownerWithLoader(async (loadAsset) => {
        const bot = await loadAsset("bot.png", "bot.bot");
        const drone = await loadAsset("drone.png", "entity.hunterDrone");
        return {
            abilities: {
                ...completeCatalogue().abilities,
                bot,
                drone,
            },
        };
    }, async (url) => {
        loadCounts.set(url, (loadCounts.get(url) ?? 0) + 1);
        if (url === "bot.png" && loadCounts.get(url) === 1) throw new Error("404");
        return { id: `${url}-texture` };
    });

    await assert.rejects(owner.preload(), (error) => error.assetId === "bot.bot");
    assert.equal(owner.getState().status, ARENA_ASSET_STATUS.FAILED);
    assert.equal(owner.getState().error.assetId, "bot.bot");
    assert.equal(loadCounts.get("bot.png"), 1);
    assert.equal(loadCounts.get("drone.png") ?? 0, 0);

    await assert.rejects(owner.preload());
    assert.equal(loadCounts.get("bot.png"), 1);

    const recovered = await owner.retry();
    assert.equal(recovered.abilities.bot.id, "bot.png-texture");
    assert.equal(loadCounts.get("bot.png"), 2);
    assert.equal(loadCounts.get("drone.png"), 1);
    assert.equal(owner.getState().status, ARENA_ASSET_STATUS.READY);
    assert.equal(owner.getState().loadedCount, 2);
    assert.equal(owner.getState().totalCount, 2);
});

test("home readiness stays gated until the shared catalogue is ready", () => {
    assert.equal(isArenaPresentationReady({ status: ARENA_ASSET_STATUS.LOADING, catalogue: null }), false);
    assert.equal(isArenaPresentationReady({ status: ARENA_ASSET_STATUS.FAILED, catalogue: null }), false);
    assert.equal(isArenaPresentationReady({ status: ARENA_ASSET_STATUS.READY, catalogue: { abilities: {} } }), true);
});

test("catalogue validation rejects missing required presentation resources", async () => {
    const owner = ownerWithLoader(async () => ({ abilities: { bot: { id: "only-texture" } } }));

    await assert.rejects(owner.preload(), /missing drone/);
    assert.equal(owner.getState().status, ARENA_ASSET_STATUS.FAILED);
});
