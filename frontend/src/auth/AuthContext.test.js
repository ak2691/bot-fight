import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { Buffer } from "node:buffer";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));

// Minimal hook runtime standing in for React (no renderer/jsdom is installed).
const FAKE_REACT = `
const rt = globalThis.__rt = { slots: [], i: 0, effects: [] };
const same = (a, b) => a && b && a.length === b.length && a.every((v, k) => Object.is(v, b[k]));
export function createContext(v) { return { Provider: "Provider", v }; }
export function useState(init) {
  const k = rt.i++;
  if (!(k in rt.slots)) rt.slots[k] = { v: typeof init === "function" ? init() : init };
  const s = rt.slots[k];
  return [s.v, (n) => { n = typeof n === "function" ? n(s.v) : n; s.v = n; }];
}
export function useRef(init) { const k = rt.i++; if (!(k in rt.slots)) rt.slots[k] = { current: init }; return rt.slots[k]; }
function memo(f, deps) { const k = rt.i++; const s = rt.slots[k]; if (s && same(s.deps, deps)) return s.v; rt.slots[k] = { deps, v: f() }; return rt.slots[k].v; }
export const useMemo = memo;
export function useCallback(f, deps) { return memo(() => f, deps); }
export function useEffect(f, deps) { const k = rt.i++; const s = rt.slots[k]; if (s && same(s.deps, deps)) return; rt.slots[k] = { deps }; rt.effects.push(f); }
export function useContext() { return null; }
`;
const FAKE_JSX = `
export function jsx(type, props) { return { type, props }; }
export const jsxs = jsx; export const Fragment = "Fragment";
`;

function render(AuthProvider) {
    const rt = globalThis.__rt;
    rt.i = 0;
    const el = AuthProvider({ children: null });
    const effects = rt.effects.splice(0);
    effects.forEach((f) => f());
    return el.props.value;
}

test("isLoading is cleared when login happens while the initial /api/auth/me is pending", async () => {
    const result = await build({
        entryPoints: [path.join(here, "AuthContext.jsx")],
        bundle: true, write: false, format: "esm", platform: "node", jsx: "automatic",
        plugins: [{
            name: "fake-react",
            setup(b) {
                b.onResolve({ filter: /^react$/ }, () => ({ path: "react", namespace: "fake" }));
                b.onResolve({ filter: /^react\/jsx(-dev)?-runtime$/ }, () => ({ path: "jsx", namespace: "fake" }));
                b.onLoad({ filter: /.*/, namespace: "fake" }, (a) => ({
                    contents: a.path === "react" ? FAKE_REACT : FAKE_JSX,
                    loader: "js",
                }));
            },
        }],
    });
    const code = result.outputFiles[0].text;
    const mod = await import("data:text/javascript;base64," + Buffer.from(code).toString("base64"));

    let releaseMe;
    const mePending = new Promise((r) => { releaseMe = r; });
    const json = (status, body) => ({ ok: status < 300, status, headers: { get: () => null }, json: async () => body });
    globalThis.fetch = async (url) => {
        const u = String(url);
        if (u.endsWith("/api/auth/me")) { await mePending; return json(200, { authenticated: false, guest: false }); }
        if (u.endsWith("/api/auth/csrf")) return json(200, { token: "t", headerName: "X-XSRF-TOKEN" });
        if (u.endsWith("/api/auth/login")) return json(200, { authenticated: true, guest: false, username: "u" });
        return json(404, {});
    };
    globalThis.document ??= { cookie: "" };

    // Mount: initial /me starts and stays pending.
    let value = render(mod.AuthProvider);
    assert.equal(value.isLoading, true);

    // User logs in while /me is pending (bumps the auth revision).
    await value.login({ email: "a@b.c", password: "pw" });

    // Initial /me finally resolves (stale by revision).
    releaseMe();
    await new Promise((r) => setTimeout(r, 20));

    value = render(mod.AuthProvider);
    assert.equal(value.isAuthenticated, true);
    assert.equal(value.isLoading, false, "isLoading must not stay true after login superseded the initial /me");
});
