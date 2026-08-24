import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { passwordError, userFacingAuthError, usernameError } from "../../auth/validation";
import AuthLayout from "./AuthLayout";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import googleIconUrl from "../../assets/googleicon.png";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function LoginPage() {
    const { isAuthenticated, isLoading, login, linkGoogleAccount, completeGoogleUsername } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const googleStatus = new URLSearchParams(location.search).get("google");
    const googleLinkRequired = googleStatus === "link-required";
    const googleUsernameRequired = googleStatus === "username-required";
    const [googleUsername, setGoogleUsername] = useState("");
    const [usernameErrorMessage, setUsernameErrorMessage] = useState(null);
    const [isUsernameSubmitting, setIsUsernameSubmitting] = useState(false);
    const emailRef = useRef(null);
    const passwordRef = useRef(null);

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
        setFieldErrors({});
        setFormError(null);
        const nextErrors = {};

        if (!EMAIL_PATTERN.test(email.trim())) {
            nextErrors.email = "Enter a valid email address.";
        }
        const passwordValidationError = passwordError(password);
        if (passwordValidationError) nextErrors.password = passwordValidationError;
        if (Object.keys(nextErrors).length) {
            setFieldErrors(nextErrors);
            if (nextErrors.email) emailRef.current?.focus();
            else passwordRef.current?.focus();
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
            setFormError(userFacingAuthError(err, "Login could not be completed. Check your details and try again."));
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
            setUsernameErrorMessage(userFacingAuthError(err, "That username could not be saved. Choose another and try again."));
        } finally {
            setIsUsernameSubmitting(false);
        }
    };

    if (googleUsernameRequired) {
        return (
            <AuthLayout showBrand={false} showPanel={false}>
                <UsernameSetupModal
                    username={googleUsername}
                    setUsername={setGoogleUsername}
                    error={usernameErrorMessage}
                    isSubmitting={isUsernameSubmitting}
                    onSubmit={handleUsernameSubmit}
                />
            </AuthLayout>
        );
    }

    return (
        <AuthLayout
            footer={<Link className="auth-switch-link flex min-h-12 w-full items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-3 text-center text-base font-semibold hover:border-cyan-300 hover:bg-cyan-900/40" to="/register">No account yet? Sign up!</Link>}
        >
                    {googleLinkRequired && (
                        <div className="mb-4 rounded border border-cyan-700/70 bg-cyan-950/30 px-3 py-3 text-sm text-cyan-100">
                            This Google account matches an existing Bot Fight account. Enter that account's email and password to link Google and sign in.
                        </div>
                    )}
                    {googleStatus === "error" && (
                        <p className="form-error mb-4 text-sm text-red-300" role="alert">Google sign-in could not be completed. Try again or use your email and password.</p>
                    )}
                    <form onSubmit={handleSubmit} className="space-y-4">
                        <div className="block text-left">
                            <input
                                ref={emailRef}
                                id="login-email"
                                name="email"
                                type="email"
                                value={email}
                                onChange={(event) => setEmail(event.target.value)}
                                placeholder="Email"
                                aria-label="Email"
                                className="w-full rounded-lg border border-border-lo bg-zinc-950 px-3 py-3 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                                autoComplete="email"
                                required
                                aria-invalid={Boolean(fieldErrors.email)}
                                aria-describedby={fieldErrors.email ? "login-email-error" : undefined}
                            />
                            {fieldErrors.email && <span id="login-email-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.email}</span>}
                        </div>
                        <div className="block text-left">
                            <div className="relative">
                                <input
                                    ref={passwordRef}
                                    id="login-password"
                                    name="password"
                                    type={isPasswordVisible ? "text" : "password"}
                                    value={password}
                                    onChange={(event) => setPassword(event.target.value)}
                                    placeholder="Password"
                                    aria-label="Password"
                                    className="w-full rounded-lg border border-border-lo bg-zinc-950 px-3 py-3 pr-12 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                                    autoComplete="current-password"
                                    required
                                    aria-invalid={Boolean(fieldErrors.password)}
                                    aria-describedby={fieldErrors.password ? "login-password-error" : undefined}
                                />
                                <button
                                    type="button"
                                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                                    aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                                    aria-pressed={isPasswordVisible}
                                    className="auth-password-toggle absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r-lg border-0 bg-transparent p-0 text-slate-400 hover:border-transparent hover:bg-transparent hover:text-cyan-200"
                                >
                                    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                                        {isPasswordVisible ? (
                                            <>
                                                <path d="M2.5 12s3.5-6 9.5-6 9.5 6 9.5 6-3.5 6-9.5 6-9.5-6-9.5-6Z" />
                                                <circle cx="12" cy="12" r="2.5" />
                                            </>
                                        ) : (
                                            <>
                                                <path d="m3 3 18 18" />
                                                <path d="M10.6 5.2A10.4 10.4 0 0 1 12 5c6 0 9.5 7 9.5 7a18.5 18.5 0 0 1-3.2 3.8M6.2 6.3C3.7 8 2.5 12 2.5 12s3.5 7 9.5 7c1 0 1.9-.2 2.7-.5" />
                                                <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
                                            </>
                                        )}
                                    </svg>
                                </button>
                            </div>
                            {fieldErrors.password && <span id="login-password-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.password}</span>}
                        </div>
                        {formError && <p id="login-form-error" className="form-error text-sm text-red-300" role="alert">{formError}</p>}
                        <button
                            type="submit"
                            disabled={isSubmitting}
                            className="auth-primary-button min-h-12 w-full rounded-lg px-4 py-3 text-base font-bold disabled:opacity-60"
                        >
                            {isSubmitting ? "Logging in..." : "Log in"}
                        </button>
                    </form>
                    <div className="my-5 flex items-center gap-3 text-[11px] uppercase tracking-widest text-ink-muted">
                        <span className="h-px flex-1 bg-border-lo" />
                        <span>or</span>
                        <span className="h-px flex-1 bg-border-lo" />
                    </div>
                    <a
                        href={apiUrl("/oauth2/authorization/google")}
                        className="auth-social-button flex min-h-12 w-full items-center justify-center gap-3 rounded-lg border border-slate-600 bg-slate-900 px-4 py-3 text-center text-base font-bold hover:border-cyan-400"
                    >
                        <img src={googleIconUrl} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" />
                        <span>Log in with Google</span>
                    </a>
        </AuthLayout>
    );
}

function UsernameSetupModal({ username, setUsername, error, isSubmitting, onSubmit }) {
    const dialogRef = useRef(null);
    const usernameRef = useRef(null);
    useDialogFocus(dialogRef, { initialFocusRef: usernameRef, lockScroll: true });
    return (
        <div ref={dialogRef} className="fixed inset-0 z-50 flex min-h-screen items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="username-setup-title" tabIndex={-1}>
            <div className="w-full max-w-sm rounded-2xl border border-cyan-400/50 bg-[#081824] p-5 shadow-[0_24px_90px_rgba(0,0,0,.6)]">
                <h2 id="username-setup-title" className="text-center text-2xl font-bold text-white">Choose your username</h2>
                <form onSubmit={onSubmit} className="mt-5 flex flex-col items-center gap-4">
                        <input
                            ref={usernameRef}
                            id="google-username"
                            name="username"
                            type="text"
                            value={username}
                            onChange={(event) => setUsername(event.target.value)}
                            maxLength={20}
                            pattern="[A-Za-z0-9_-]+"
                            autoFocus
                            autoComplete="username"
                            required
                            aria-invalid={Boolean(error)}
                            aria-describedby={error ? "google-username-error" : undefined}
                            placeholder="Username"
                            aria-label="Username"
                            className="w-full max-w-xs rounded border border-border-lo bg-zinc-950 px-3 py-3 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                        />
                    {error && <p id="google-username-error" className="form-error w-full max-w-xs text-sm text-red-300" role="alert">{error}</p>}
                    <button type="submit" disabled={isSubmitting} className="arena-toolbar-button arena-toolbar-button--neutral username-save-button max-w-xs">
                        {isSubmitting ? "SAVING" : "SAVE USERNAME"}
                    </button>
                </form>
            </div>
        </div>
    );
}
