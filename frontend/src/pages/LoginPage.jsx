import { useEffect, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../auth/auth-context";
import { apiUrl } from "../config/api";
import { passwordError, usernameError } from "../auth/validation";
import AuthLayout from "./AuthLayout";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function LoginPage() {
    const { isAuthenticated, isLoading, login, linkGoogleAccount, completeGoogleUsername } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [error, setError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const googleStatus = new URLSearchParams(location.search).get("google");
    const googleLinkRequired = googleStatus === "link-required";
    const googleUsernameRequired = googleStatus === "username-required";
    const [isUsernamePromptOpen, setIsUsernamePromptOpen] = useState(googleUsernameRequired);
    const [googleUsername, setGoogleUsername] = useState("");
    const [usernameErrorMessage, setUsernameErrorMessage] = useState(null);
    const [isUsernameSubmitting, setIsUsernameSubmitting] = useState(false);

    useEffect(() => {
        if (googleUsernameRequired) setIsUsernamePromptOpen(true);
    }, [googleUsernameRequired]);

    useEffect(() => {
        if (isAuthenticated) {
            navigate("/home", { replace: true });
        }
    }, [isAuthenticated, navigate]);

    if (!isLoading && isAuthenticated) {
        return <Navigate to="/home" replace />;
    }

    const handleSubmit = async (event) => {
        event.preventDefault();
        setError(null);

        if (!EMAIL_PATTERN.test(email.trim())) {
            setError("Enter a valid email address.");
            return;
        }
        const passwordValidationError = passwordError(password);
        if (passwordValidationError) {
            setError(passwordValidationError);
            return;
        }

        setIsSubmitting(true);
        try {
            if (googleLinkRequired) {
                await linkGoogleAccount({ email: email.trim(), password });
            } else {
                await login({ email: email.trim(), password });
            }
            navigate(location.state?.from?.pathname ?? "/home", { replace: true });
        } catch (err) {
            setError(err.message);
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUsernameSubmit = async (event) => {
        event.preventDefault();
        setUsernameErrorMessage(null);
        const validationError = usernameError(googleUsername);
        if (validationError) {
            setUsernameErrorMessage(validationError);
            return;
        }

        setIsUsernameSubmitting(true);
        try {
            await completeGoogleUsername({ username: googleUsername.trim() });
            navigate("/home", { replace: true });
        } catch (err) {
            setUsernameErrorMessage(err.message);
        } finally {
            setIsUsernameSubmitting(false);
        }
    };

    return (
        <AuthLayout
            title="Login"
            subtitle="Enter the arena with your saved fighter work."
            footer={<>No account yet? <Link className="text-cyan-300 hover:text-cyan-100" to="/register">Register</Link></>}
        >
            {googleUsernameRequired && isUsernamePromptOpen && (
                <UsernameSetupModal
                    username={googleUsername}
                    setUsername={setGoogleUsername}
                    error={usernameErrorMessage}
                    isSubmitting={isUsernameSubmitting}
                    onSubmit={handleUsernameSubmit}
                    onClose={() => setIsUsernamePromptOpen(false)}
                />
            )}
            {googleLinkRequired && (
                <div className="mb-4 rounded border border-cyan-700/70 bg-cyan-950/30 px-3 py-3 text-sm text-cyan-100">
                    This Google account matches an existing Bot Fight account. Enter that account's email and password to link Google and sign in.
                </div>
            )}
            {googleStatus === "error" && (
                <p className="mb-4 text-sm text-red-400">Google sign-in could not be completed. Try again or use your email and password.</p>
            )}
            <form onSubmit={handleSubmit} className="space-y-4">
                <label className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Email</span>
                    <input
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="email"
                    />
                </label>
                <label className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Password</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(event) => setPassword(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="current-password"
                    />
                </label>
                {error && <p className="text-sm text-red-400">{error}</p>}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="w-full rounded bg-cyan-800 px-4 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-700 disabled:opacity-60"
                >
                    {isSubmitting ? "LOGGING IN" : "LOGIN"}
                </button>
            </form>
            <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-ink-muted">
                <span className="h-px flex-1 bg-border-lo" />
                <span>or</span>
                <span className="h-px flex-1 bg-border-lo" />
            </div>
            <a
                href={apiUrl("/oauth2/authorization/google")}
                className="block w-full rounded border border-slate-600 bg-slate-900 px-4 py-2 text-center text-sm font-bold text-slate-100 hover:border-cyan-400 hover:text-cyan-100"
            >
                Continue with Google
            </a>
        </AuthLayout>
    );
}

function UsernameSetupModal({ username, setUsername, error, isSubmitting, onSubmit, onClose }) {
    return (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 px-5" role="dialog" aria-modal="true" aria-labelledby="username-setup-title">
            <div className="w-full max-w-md rounded-2xl border border-cyan-400/50 bg-[#081824] p-6 shadow-[0_24px_90px_rgba(0,0,0,.6)]">
                <div className="flex items-start justify-between gap-4">
                    <div>
                        <p className="font-mono text-[10px] font-bold tracking-[.25em] text-cyan-400">ACCOUNT SETUP</p>
                        <h2 id="username-setup-title" className="mt-2 text-2xl font-bold text-white">Choose your username</h2>
                    </div>
                    <button type="button" onClick={onClose} aria-label="Close username setup" className="border border-slate-600 bg-slate-900 px-3 py-1 text-slate-300 hover:border-cyan-400">×</button>
                </div>
                <p className="mt-4 text-sm leading-6 text-slate-400">Your Google account is ready. Pick a unique username before entering the arena.</p>
                <form onSubmit={onSubmit} className="mt-5 space-y-4">
                    <label className="block text-left">
                        <span className="text-[11px] uppercase tracking-widest text-ink-muted">Username</span>
                        <input
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            maxLength={20}
                            pattern="[A-Za-z0-9_-]+"
                            autoFocus
                            autoComplete="username"
                            className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        />
                    </label>
                    <p className="text-xs text-slate-500">3–20 characters: letters, numbers, underscores, and hyphens only.</p>
                    {error && <p className="text-sm text-red-400">{error}</p>}
                    <button type="submit" disabled={isSubmitting} className="w-full rounded bg-cyan-800 px-4 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-700 disabled:opacity-60">
                        {isSubmitting ? "SAVING" : "SAVE USERNAME"}
                    </button>
                </form>
            </div>
        </div>
    );
}
