import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { CREDIT_CREATORS, CREDITS_ROUTE } from "./credits.js";

const expectedCreators = [
    "Will Tice / unTied Games",
    "FoozleCC",
    "jellyfish0",
    "Pipoya",
    "pimen",
    "SurfaceToAsh",
    "Frostwindz",
    "SpikerMan",
    "codemanu",
];

test("credits creator names remain exact, unique, and ordered", () => {
    assert.deepEqual(CREDIT_CREATORS, expectedCreators);
    assert.equal(new Set(CREDIT_CREATORS).size, expectedCreators.length);
});

test("credits page labels every creator as on itch.io", () => {
    const pageSource = readFileSync(new URL("./CreditsPage.jsx", import.meta.url), "utf8");

    assert.match(pageSource, /\{creator\} on itch\.io/);
});

test("credits route is wired to the page and home navigation", () => {
    const appSource = readFileSync(new URL("../../App.jsx", import.meta.url), "utf8");
    const authLayoutSource = readFileSync(new URL("../auth/AuthLayout.jsx", import.meta.url), "utf8");
    const homeSource = readFileSync(new URL("../home/HomePage.jsx", import.meta.url), "utf8");

    assert.match(appSource, new RegExp(`path=["']${CREDITS_ROUTE}["']`));
    assert.match(authLayoutSource, new RegExp(`to=["']${CREDITS_ROUTE}["']`));
    assert.match(homeSource, new RegExp(`to=["']${CREDITS_ROUTE}["']`));
});
