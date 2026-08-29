import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { userFacingAuthError } from "../../auth/validation";
import AuthLayout from "./AuthLayout";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function ForgotPasswordPage() {
    const {
        isAuthenticated,
        isLoading,
        requestPasswordReset,
        verifyPasswordReset,
    } = useAuth();
    const [searchParams] = useSearchParams();
    const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
    const [code, setCode] = useState("");
    const [step, setStep] = useState("request");
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [notice, setNotice] = useState(
        searchParams.get("expired") === "true"
            ? "Your reset session expired. Request a new code to continue."
            : null,
    );
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isResending, setIsResending] = useState(false);
    const navigate = useNavigate();
    const emailRef = useRef(null);
    const codeRef = useRef(null);

    useEffect(() => {
        if (isAuthenticated) {
            navigate("/home", { replace: true });
        }
    }, [isAuthenticated, navigate]);

    if (!isLoading && isAuthenticated) {
        return <Navigate to="/home" replace />;
    }

    const validateEmail = () => {
        if (!EMAIL_PATTERN.test(email.trim())) {
            setFieldErrors({ email: "Enter the email address for your account." });
            emailRef.current?.focus();
            return false;
        }
        return true;
    };

    const requestCode = async () => {
        setFieldErrors({});
        setFormError(null);
        if (!validateEmail()) return false;

        await requestPasswordReset({ email: email.trim() });
        setStep("verify");
        setCode("");
        setNotice("If that address uses email/password sign-in, a six-digit reset code is on its way. Use the most recent code; it expires in 5 minutes.");
        navigate(`/forgot-password?email=${encodeURIComponent(email.trim())}`, { replace: true });
        return true;
    };

    const handleRequest = async (event) => {
        event.preventDefault();
        setIsSubmitting(true);
        try {
            await requestCode();
        } catch (err) {
            setFormError(userFacingAuthError(err, "A reset code could not be sent. Try again shortly."));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleVerify = async (event) => {
        event.preventDefault();
        setFieldErrors({});
        setFormError(null);
        setNotice(null);
        if (!validateEmail()) return;
        if (!/^\d{6}$/.test(code)) {
            setFieldErrors({ code: "Enter the six-digit code from your email." });
            codeRef.current?.focus();
            return;
        }

        setIsSubmitting(true);
        try {
            await verifyPasswordReset({ email: email.trim(), code });
            navigate("/reset-password", { replace: true });
        } catch (err) {
            setFormError(userFacingAuthError(err, "The reset code could not be verified. Check the code and try again."));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleResend = async () => {
        setFieldErrors({});
        setFormError(null);
        setNotice(null);
        if (!validateEmail()) return;

        setIsResending(true);
        try {
            await requestPasswordReset({ email: email.trim() });
            setCode("");
            setNotice("If that address uses email/password sign-in, a reset code is on its way. Use the most recent code; it expires in 5 minutes.");
        } catch (err) {
            setFormError(userFacingAuthError(err, "A new reset code could not be sent. Try again shortly."));
        } finally {
            setIsResending(false);
        }
    };

    return (
        <AuthLayout
            title={step === "request" ? "Forgot your password?" : "Check your email"}
            subtitle={step === "request"
                ? "Enter your account email and we’ll send a verification code to reset your password."
                : "Enter the six-digit verification code we sent before it expires."}
            footer={<>Remembered it? <Link className="text-cyan-300 hover:text-cyan-100" to="/login">Log in</Link></>}
        >
            {step === "request" ? (
                <form onSubmit={handleRequest} className="space-y-4">
                    <label htmlFor="forgot-password-email" className="block text-left">
                        <span className="text-[11px] uppercase tracking-widest text-ink-muted">Email</span>
                        <input
                            ref={emailRef}
                            id="forgot-password-email"
                            name="email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-3 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                            autoComplete="email"
                            autoFocus
                            required
                            aria-invalid={Boolean(fieldErrors.email)}
                            aria-describedby={fieldErrors.email ? "forgot-password-email-error" : undefined}
                            placeholder="Email"
                        />
                        {fieldErrors.email && <span id="forgot-password-email-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.email}</span>}
                    </label>
                    {formError && <p className="form-error text-sm text-red-300" role="alert">{formError}</p>}
                    {notice && <p className="text-sm text-emerald-300" role="status">{notice}</p>}
                    <button
                        type="submit"
                        disabled={isSubmitting}
                        className="auth-primary-button min-h-12 w-full rounded-lg px-4 py-3 text-base font-bold disabled:opacity-60"
                    >
                        {isSubmitting ? "SENDING..." : "SEND RESET CODE"}
                    </button>
                </form>
            ) : (
                <form onSubmit={handleVerify} className="space-y-4">
                    <label htmlFor="reset-code-email" className="block text-left">
                        <span className="text-[11px] uppercase tracking-widest text-ink-muted">Email</span>
                        <input
                            ref={emailRef}
                            id="reset-code-email"
                            name="email"
                            type="email"
                            value={email}
                            onChange={(event) => setEmail(event.target.value)}
                            className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-3 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                            autoComplete="email"
                            required
                            aria-invalid={Boolean(fieldErrors.email)}
                            aria-describedby={fieldErrors.email ? "reset-code-email-error" : undefined}
                        />
                        {fieldErrors.email && <span id="reset-code-email-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.email}</span>}
                    </label>
                    <label htmlFor="reset-code" className="block text-left">
                        <span className="text-[11px] uppercase tracking-widest text-ink-muted">Verification code</span>
                        <input
                            ref={codeRef}
                            id="reset-code"
                            name="code"
                            type="text"
                            value={code}
                            onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                            className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-3 text-sm tracking-[0.35em] text-ink-white outline-none focus:border-cyan-500"
                            inputMode="numeric"
                            autoComplete="one-time-code"
                            maxLength={6}
                            placeholder="000000"
                            autoFocus
                            required
                            aria-invalid={Boolean(fieldErrors.code)}
                            aria-describedby={fieldErrors.code ? "reset-code-error" : "reset-code-help"}
                        />
                        {fieldErrors.code && <span id="reset-code-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.code}</span>}
                    </label>
                    <p id="reset-code-help" className="text-xs text-ink-muted">The code expires 5 minutes after it is sent.</p>
                    {formError && <p className="form-error text-sm text-red-300" role="alert">{formError}</p>}
                    {notice && <p className="text-sm text-emerald-300" role="status">{notice}</p>}
                    <button
                        type="submit"
                        disabled={isSubmitting || isResending}
                        className="auth-primary-button min-h-12 w-full rounded-lg px-4 py-3 text-base font-bold disabled:opacity-60"
                    >
                        {isSubmitting ? "VERIFYING..." : "VERIFY CODE"}
                    </button>
                    <button
                        type="button"
                        onClick={handleResend}
                        disabled={isSubmitting || isResending}
                        className="w-full rounded border border-slate-600 px-4 py-3 text-sm font-bold text-slate-100 hover:border-cyan-400 hover:text-cyan-100 disabled:opacity-60"
                    >
                        {isResending ? "SENDING..." : "RESEND CODE"}
                    </button>
                    <button
                        type="button"
                        onClick={() => { setStep("request"); setCode(""); setNotice(null); setFormError(null); setFieldErrors({}); }}
                        className="w-full text-sm text-slate-400 hover:text-cyan-200"
                    >
                        Use a different email
                    </button>
                </form>
            )}
        </AuthLayout>
    );
}
