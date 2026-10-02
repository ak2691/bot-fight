import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";

const read = (relative) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), "utf8");
const LAYOUT = read("./AuthLayout.jsx");
const FIELDS = read("./AuthFields.jsx");
const LOGIN = read("./LoginPage.jsx");
const REGISTER = read("./RegisterPage.jsx");
const RESET = read("./ResetPasswordPage.jsx");
const AUTH_CSS = read("./auth.css");
const INDEX_CSS = read("../../index.css");
const NAVBAR_CSS = read("../../components/navbar.css");

test("login keeps its logic and shows labelled fields, banners, Google and guest entries", () => {
    assert.match(LOGIN, /await login\(\{ email: email\.trim\(\), password \}\)/);
    assert.match(LOGIN, /href=\{apiUrl\("\/oauth2\/authorization\/google"\)\}/);
    assert.match(LOGIN, /<AuthPasswordField[\s\S]*labelAction=\{<Link to="\/forgot-password" className="auth-link">Forgot password\?<\/Link>\}/);
    assert.match(LOGIN, /\{isSubmitting \? "Logging in\.\.\." : "Log in"\}/);
});

test("sign up lists username, email, and password with a strength bar and keeps its logic", () => {
    assert.ok(REGISTER.indexOf('id="register-username"') < REGISTER.indexOf('id="register-email"'));
    assert.ok(REGISTER.indexOf('id="register-email"') < REGISTER.indexOf('id="register-password"'));
    assert.match(REGISTER, /await register\(\{ email: email\.trim\(\), username: username\.trim\(\), password \}\)/);
});

test("fields have visible labels, a password toggle with an aria-label, and a client-side strength hint", () => {
    assert.match(FIELDS, /aria-label=\{isPasswordVisible \? "Hide password" : "Show password"\}/);
    assert.match(FIELDS, /\[1, 2, 3\]\.map\(\(segment\)/);
    assert.match(FIELDS, /passwordStrength\(password\)/);
});

