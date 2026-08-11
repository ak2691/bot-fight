import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const logoSource = readFileSync(new URL("./BotLogo.jsx", import.meta.url), "utf8");
const navbarSource = readFileSync(new URL("./AppNavbar.jsx", import.meta.url), "utf8");
const authLayoutSource = readFileSync(new URL("../pages/auth/AuthLayout.jsx", import.meta.url), "utf8");

test("bot logo uses the supplied PNG and renders BF when it fails", () => {
    assert.match(logoSource, /bot-design\.png/);
    assert.match(logoSource, /onError=\{\(\) => setImageFailed\(true\)\}/);
    assert.match(logoSource, />BF<\/span>/);
    assert.match(logoSource, /showLabel = false/);
    assert.match(logoSource, /showLabel && <span>BF<\/span>/);
});

test("navbar and authentication layout both use the Bot Fight wordmark", () => {
    assert.match(navbarSource, /className="app-brand-link[^"]*font-interface[^"]*"/);
    assert.match(navbarSource, /<span className="text-cyan-400">BOT<\/span>/);
    assert.match(navbarSource, /<span className="text-fuchsia-400">FIGHT<\/span>/);

    assert.match(authLayoutSource, /className="auth-brand home-title[^"]*"/);
    assert.match(authLayoutSource, /<span className="home-title-bot block">BOT<\/span>/);
    assert.match(authLayoutSource, /<span className="home-title-fight block">FIGHT<\/span>/);
    assert.doesNotMatch(authLayoutSource, /<BotLogo/);
});
