import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");

test("PlayerAvatar is a rounded square with radius near 23% of its size", () => {
    const source = read("./PlayerAvatar.jsx");
    assert.match(source, /Math\.round\(size \* 0\.23\)/);
    assert.deepEqual([56, 36, 30, 24].map((size) => Math.round(size * 0.23)), [13, 8, 7, 6]);
    assert.match(read("../index.css"), /\.player-avatar \{[\s\S]*?"Chakra Petch"[\s\S]*?font-weight: 700;/);
});

