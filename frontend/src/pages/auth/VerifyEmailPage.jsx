import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate, useSearchParams } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import AuthLayout from "./AuthLayout";
import { userFacingAuthError } from "../../auth/validation";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function VerifyEmailPage() {
    const { isAuthenticated, isLoading, verifyEmail, resendVerification } = useAuth();
    const [searchParams] = useSearchParams();
    const [email, setEmail] = useState(() => searchParams.get("email") ?? "");
    const [code, setCode] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [notice, setNotice] = useState(null);
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
            const nextErrors = { email: "Enter the email address used to register." };
            setFieldErrors(nextErrors);
            emailRef.current?.focus();
            return false;
        }
        return true;
    };

    const handleSubmit = async (event) => {
        event.preventDefault();
        setFieldErrors({});
        setFormError(null);
        setNotice(null);
        if (!validateEmail()) return;
        if (!/^\d{6}$/.test(code)) {
            const nextErrors = { code: "Enter the six-digit code from your email." };
            setFieldErrors(nextErrors);
            codeRef.current?.focus();
            return;
        }

        setIsSubmitting(true);
        try {
            await verifyEmail({ email: email.trim(), code });
            navigate("/home", { replace: true });
        } catch (err) {
            setFormError(userFacingAuthError(err, "Email verification could not be completed. Check the code and try again."));
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
            await resendVerification({ email: email.trim() });
            setCode("");
            setNotice("A new verification code was sent. It is valid for 5 minutes.");
        } catch (err) {
            setFormError(userFacingAuthError(err, "A new verification code could not be sent. Try again."));
        } finally {
            setIsResending(false);
        }
    };

    return (
        <AuthLayout
            title="Verify your email"
            subtitle="Enter the six-digit code we sent to confirm that you own this email address."
            footer={<>Need to start over? <Link className="text-cyan-300 hover:text-cyan-100" to="/register">Sign up again</Link></>}
        >
            <form onSubmit={handleSubmit} className="space-y-4">
                <label htmlFor="verify-email" className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Email</span>
                    <input
                        ref={emailRef}
                        id="verify-email"
                        name="email"
                        type="email"
                        value={email}
                        onChange={(event) => setEmail(event.target.value)}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm text-ink-white outline-none focus:border-cyan-500"
                        autoComplete="email"
                        required
                        aria-invalid={Boolean(fieldErrors.email)}
                        aria-describedby={fieldErrors.email ? "verify-email-error" : undefined}
                    />
                    {fieldErrors.email && <span id="verify-email-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.email}</span>}
                </label>
                <label htmlFor="verify-code" className="block text-left">
                    <span className="text-[11px] uppercase tracking-widest text-ink-muted">Verification code</span>
                    <input
                        ref={codeRef}
                        id="verify-code"
                        name="code"
                        type="text"
                        value={code}
                        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        className="mt-1 w-full rounded border border-border-lo bg-zinc-950 px-3 py-2 text-sm tracking-[0.35em] text-ink-white outline-none focus:border-cyan-500"
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        maxLength={6}
                        placeholder="000000"
                        required
                        aria-invalid={Boolean(fieldErrors.code)}
                        aria-describedby={fieldErrors.code ? "verify-code-error" : "verify-code-help"}
                    />
                    {fieldErrors.code && <span id="verify-code-error" className="form-error mt-1 block text-sm text-red-300">{fieldErrors.code}</span>}
                </label>
                <p id="verify-code-help" className="text-xs text-ink-muted">This code expires 5 minutes after it is sent.</p>
                {formError && <p id="verify-form-error" className="form-error text-sm text-red-300" role="alert">{formError}</p>}
                {notice && <p className="text-sm text-emerald-300" role="status">{notice}</p>}
                <button
                    type="submit"
                    disabled={isSubmitting || isResending}
                    className="w-full rounded bg-cyan-800 px-4 py-2 text-sm font-bold text-cyan-50 hover:bg-cyan-700 disabled:opacity-60"
                >
                    {isSubmitting ? "VERIFYING" : "VERIFY EMAIL"}
                </button>
                <button
                    type="button"
                    onClick={handleResend}
                    disabled={isSubmitting || isResending}
                    className="w-full rounded border border-slate-600 px-4 py-2 text-sm font-bold text-slate-100 hover:border-cyan-400 hover:text-cyan-100 disabled:opacity-60"
                >
                    {isResending ? "SENDING" : "RESEND CODE"}
                </button>
            </form>
        </AuthLayout>
    );
}
