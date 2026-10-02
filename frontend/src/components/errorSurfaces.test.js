import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const app = read("../App.jsx");

test("unknown routes render the 404 screen with the navbar and a Go home action", () => {
    const notFound = read("../pages/NotFoundPage.jsx");
    assert.match(app, /<Route path="\*" element=\{<NotFoundPage \/>\} \/>/);
    assert.match(notFound, /<AppNavbar/);
    assert.match(notFound, /isAuthenticated \? "\/home" : "\/login"/);
});

