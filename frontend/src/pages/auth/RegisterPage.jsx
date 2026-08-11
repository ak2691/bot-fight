import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { passwordError, userFacingAuthError, usernameError } from "../../auth/validation";
import AuthLayout from "./AuthLayout";
import googleIconUrl from "../../assets/googleicon.png";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RegisterPage() {
    const { isAuthenticated, isLoading, register } = useAuth();
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const navigate = useNavigate();
    const emailRef = useRef(null);
    const usernameRef = useRef(null);
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
        const usernameValidationError = usernameError(username);
        if (usernameValidationError) nextErrors.username = usernameValidationError;
        const passwordValidationError = passwordError(password);
        if (passwordValidationError) nextErrors.password = passwordValidationError;
        if (Object.keys(nextErrors).length) {
            setFieldErrors(nextErrors);
            if (nextErrors.email) emailRef.current?.focus();
            else if (nextErrors.username) usernameRef.current?.focus();
            else passwordRef.current?.focus();
            return;
        }

        setIsSubmitting(true);
        try {
            const result = await register({ email: email.trim(), username: username.trim(), password });
            const verificationEmail = result?.email ?? email.trim();
            navigate(`/verify-email?email=${encodeURIComponent(verificationEmail)}`, { replace: true });
        } catch (err) {
            setFormError(userFacingAuthError(err, "Sign up could not be completed. Check your details and try again."));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthLayout
            footer={<Link className="auth-switch-link flex min-h-12 w-full items-center justify-center rounded-lg border border-cyan-500/40 bg-cyan-950/30 px-3 py-3 text-center text-base font-semibold hover:border-cyan-300 hover:bg-cyan-900/40" to="/login">Already have an account? Log in</Link>}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <div className="block text-left">
                    <input
                        ref={emailRef}
                        id="register-email"
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
                        aria-describedby={fieldErrors.email ? "register-email-error" : undefined}
                    />
                    {fieldErrors.email && <span id="register-email-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.email}</span>}
                </div>
                <div className="block text-left">
                    <input
                        ref={usernameRef}
                        id="register-username"
                        name="username"
                        type="text"
                        value={username}
                        onChange={(event) => setUsername(event.target.value)}
                        maxLength={20}
                        pattern="[A-Za-z0-9_-]+"
                        placeholder="Username"
                        aria-label="Username"
                        className="w-full rounded-lg border border-border-lo bg-zinc-950 px-3 py-3 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                        autoComplete="username"
                        required
                        aria-invalid={Boolean(fieldErrors.username)}
                        aria-describedby={fieldErrors.username ? "register-username-error" : undefined}
                    />
                    {fieldErrors.username && <span id="register-username-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.username}</span>}
                </div>
                <div className="block text-left">
                    <div className="relative">
                        <input
                            ref={passwordRef}
                            id="register-password"
                            name="password"
                            type={isPasswordVisible ? "text" : "password"}
                            value={password}
                            onChange={(event) => setPassword(event.target.value)}
                            placeholder="Password"
                            aria-label="Password"
                            className="w-full rounded-lg border border-border-lo bg-zinc-950 px-3 py-3 pr-12 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                            autoComplete="new-password"
                            required
                            aria-invalid={Boolean(fieldErrors.password)}
                            aria-describedby={fieldErrors.password ? "register-password-error" : undefined}
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
                    {fieldErrors.password && <span id="register-password-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.password}</span>}
                </div>
                {formError && <p id="register-form-error" className="form-error text-sm text-red-300" role="alert">{formError}</p>}
                <button
                    type="submit"
                    disabled={isSubmitting}
                    className="auth-primary-button min-h-12 w-full rounded-lg px-4 py-3 text-base font-bold disabled:opacity-60"
                >
                    {isSubmitting ? "Signing up..." : "Sign up"}
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
                <span>Sign up with Google</span>
            </a>
        </AuthLayout>
    );
}
