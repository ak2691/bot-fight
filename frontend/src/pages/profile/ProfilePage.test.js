// Audit executes the real ProfilePage.jsx (bundled with esbuild) against a tiny
// hooks runtime. react, router, auth, notifications, csrf and all other imports are stubbed.
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const pageFile = path.join(here, "ProfilePage.jsx");
const pageSource = fs.readFileSync(pageFile, "utf8");

function importedNames(spec) {
    const names = new Set();
    const re = /import\s+([^;]*?)\s+from\s+"([^"]+)"/gs;
    let m;
    while ((m = re.exec(pageSource))) {
        if (m[2] !== spec) continue;
        const clause = m[1];
        const braces = clause.match(/\{([^}]*)\}/s);
        if (braces) braces[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0]).filter(Boolean).forEach((n) => names.add(n));
        const def = clause.replace(/\{[^}]*\}/s, "").replace(",", "").trim();
        if (def) names.add("default");
    }
    return names;
}

function stubSource(spec) {
    const rt = "globalThis.__rt";
    switch (spec) {
    case "react":
        return `const r=()=>${rt};export const useState=(i)=>r().useState(i);export const useEffect=(f,d)=>r().useEffect(f,d);
export const useCallback=(f,d)=>r().useCallback(f,d);export const useRef=(i)=>r().useRef(i);export const useMemo=(f,d)=>r().useMemo(f,d);
export default {};`;
    case "react/jsx-runtime":
        return "export const jsx=(t,p)=>({t,p});export const jsxs=jsx;export const Fragment='f';";
    case "react-router-dom":
        return `export const useNavigate=()=>()=>{};export const useParams=()=>globalThis.__params;`;
    case "../../auth/auth-context":
        return `export const useAuth=()=>({user:globalThis.__authUser,isGuest:false});`;
    case "../../notifications/notification-context":
        return `export const useNotifications=()=>({hideInvitesFrom:(u)=>globalThis.__hidden.push(u)});`;
    case "../../config/api":
        return `export const apiUrl=(p)=>p;`;
    case "../../security/csrf":
        return `export const ensureCsrfHeaders=async()=>({});`;
    default: {
        const names = importedNames(spec);
        return [...names].map((n) => (n === "default" ? "export default function(){}" : `export const ${n}=()=>{};`)).join("\n");
    }
    }
}

const stubPlugin = {
    name: "stubs",
    setup(b) {
        b.onResolve({ filter: /.*/ }, (args) => {
            if (args.kind === "entry-point") return null;
            return { path: args.path, namespace: "stub" };
        });
        b.onLoad({ filter: /.*/, namespace: "stub" }, (args) => ({ contents: stubSource(args.path), loader: "js" }));
    },
};

async function loadPage() {
    const result = await build({
        entryPoints: [pageFile],
        bundle: true,
        write: false,
        format: "esm",
        jsx: "automatic",
        plugins: [stubPlugin],
        loader: { ".css": "empty" },
        logLevel: "silent",
    });
    const code = result.outputFiles[0].text;
    return import(`data:text/javascript;base64,${Buffer.from(code).toString("base64")}`);
}

function createRuntime() {
    const rt = {
        states: [], effects: [], callbacks: [], refs: [], si: 0, ei: 0, ci: 0, ri: 0, dirty: false,
        useState(initial) {
            const i = rt.si++;
            if (!(i in rt.states)) rt.states[i] = { v: typeof initial === "function" ? initial() : initial };
            const slot = rt.states[i];
            return [slot.v, (n) => {
                const next = typeof n === "function" ? n(slot.v) : n;
                if (!Object.is(next, slot.v)) { slot.v = next; rt.dirty = true; }
            }];
        },
        useRef(initial) {
            const i = rt.ri++;
            if (!(i in rt.refs)) rt.refs[i] = { current: initial };
            return rt.refs[i];
        },
        useCallback(fn, deps) {
            const i = rt.ci++;
            const prev = rt.callbacks[i];
            if (prev && deps.every((d, k) => Object.is(d, prev.deps[k]))) return prev.fn;
            rt.callbacks[i] = { fn, deps };
            return fn;
        },
        useMemo(fn, deps) { return rt.useCallback(fn, deps)(); },
        useEffect(fn, deps) {
            const i = rt.ei++;
            const prev = rt.effects[i];
            if (prev && deps && deps.every((d, k) => Object.is(d, prev.deps[k]))) return;
            rt.pending.push(() => {
                if (prev?.cleanup) prev.cleanup();
                rt.effects[i] = { deps, cleanup: fn() };
            });
            rt.effects[i] = { ...(prev ?? {}), deps };
        },
        pending: [],
    };
    return rt;
}

test("a Block response for profile A must not mark profile B as blocked", async () => {
    const { default: ProfilePage } = await loadPage();
    const rt = createRuntime();
    globalThis.__rt = rt;
    globalThis.__hidden = [];
    globalThis.__authUser = { id: 1, username: "me" };
    globalThis.window = globalThis.window ?? { setTimeout, clearTimeout };

    const pendingPost = {};
    const realFetch = globalThis.fetch;
    globalThis.fetch = (url, opts = {}) => {
        const json = (body) => Promise.resolve({ ok: true, json: async () => body });
        if (opts.method === "POST") {
            return new Promise((resolve) => { pendingPost.resolve = () => resolve({ ok: true, json: async () => ({ blocked: true }) }); });
        }
        if (String(url).includes("/api/blocks/status/")) return json({ blocked: false });
        return new Promise(() => {}); // profile/history/puzzles never settle
    };

    let latestToggle;
    const render = () => {
        for (let guard = 0; guard < 20; guard++) {
            rt.si = rt.ei = rt.ci = rt.ri = 0;
            rt.dirty = false;
            rt.pending = [];
            ProfilePage();
            rt.pending.forEach((run) => run());
            if (!rt.dirty && rt.pending.length === 0) break;
        }
    };
    // Capture toggleBlock: it is the last useCallback registered in the component.
    const grab = () => { latestToggle = rt.callbacks[rt.callbacks.length - 1].fn; };
    const flush = () => new Promise((r) => setTimeout(r, 0));
    const blockState = () => rt.states[18].v;

    try {
        globalThis.__params = { username: "alice" };
        render();
        await flush(); render();
        assert.equal(blockState(), "idle", "alice status loaded");

        grab();
        const clicked = latestToggle(); // user clicks Block on alice; POST in flight
        render();
        assert.equal(blockState(), "saving");

        globalThis.__params = { username: "bob" }; // same mounted component, route changes
        render();
        await flush(); render();
        assert.equal(blockState(), "idle", "bob's own status (not blocked) loaded");

        pendingPost.resolve(); // alice's block response finally arrives
        await clicked;
        render();

        assert.equal(blockState(), "idle", "viewing bob, who was never blocked, must not show blocked");

        // Returning to the same route must not make the old request current again.
        globalThis.__params = { username: "alice" };
        render(); await flush(); render();
        grab();
        const clickedBeforeRouteCycle = latestToggle();
        render();
        globalThis.__params = { username: "bob" };
        render(); await flush(); render();
        globalThis.__params = { username: "alice" };
        render(); await flush(); render();
        assert.equal(blockState(), "idle");
        pendingPost.resolve();
        await clickedBeforeRouteCycle;
        render();
        assert.equal(blockState(), "idle", "A→B→A route cycle must discard the first A request");

        // A different signed-in account viewing the same route owns separate block state.
        grab();
        const clickedBeforeAccountSwitch = latestToggle();
        render();
        globalThis.__authUser = { id: 2, username: "other" };
        render(); await flush(); render();
        assert.equal(blockState(), "idle", "new account's block status loaded");
        pendingPost.resolve();
        await clickedBeforeAccountSwitch;
        render();
        assert.equal(blockState(), "idle", "previous account's Block response must be discarded");
    } finally {
        globalThis.fetch = realFetch;
    }
});
