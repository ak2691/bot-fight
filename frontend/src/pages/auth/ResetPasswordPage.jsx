import { forwardRef, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { newPasswordError, userFacingAuthError } from "../../auth/validation";
import { useDialogFocus } from "../../components/useDialogFocus.js";
import AuthLayout from "./AuthLayout";

export default function ResetPasswordPage() {
    const { isAuthenticated, isLoading, passwordResetStatus, resetPassword } = useAuth();
    const [status, setStatus] = useState("checking");
    const navigate = useNavigate();

    useEffect(() => {
        if (isLoading) return undefined;
        if (isAuthenticated) {
            navigate("/home", { replace: true });
            return undefined;
        }

        let mounted = true;
        passwordResetStatus()
            .then((result) => {
                if (!mounted) return;
                if (result?.valid === true) {
                    setStatus("ready");
                } else {
                    navigate("/forgot-password?expired=true", { replace: true });
                }
            })
            .catch(() => {
                if (mounted) navigate("/forgot-password?expired=true", { replace: true });
            });

        return () => {
            mounted = false;
        };
    }, [isAuthenticated, isLoading, navigate, passwordResetStatus]);

    if (!isLoading && isAuthenticated) {
        return <Navigate to="/home" replace />;
    }

    if (status !== "ready") {
        return (
            <AuthLayout showBrand={false} showPanel={false}>
                <div className="fixed inset-0 z-50 grid place-items-center p-4">
                    <div className="w-full max-w-sm rounded-2xl border border-cyan-400/50 bg-[#081824] p-6 text-center shadow-[0_24px_90px_rgba(0,0,0,.6)]">
                        <p className="text-sm text-slate-300" role="status">Checking your reset session...</p>
                    </div>
                </div>
            </AuthLayout>
        );
    }

    return <PasswordResetModal onReset={resetPassword} onComplete={() => navigate("/login?reset=success", { replace: true })} />;
}

function PasswordResetModal({ onReset, onComplete }) {
    const dialogRef = useRef(null);
    const passwordRef = useRef(null);
    const confirmRef = useRef(null);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isConfirmVisible, setIsConfirmVisible] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useDialogFocus(dialogRef, { initialFocusRef: passwordRef, lockScroll: true });

    const handleSubmit = async (event) => {
        event.preventDefault();
        setFieldErrors({});
        setFormError(null);
        const nextErrors = {};
        const passwordValidationError = newPasswordError(password);
        if (passwordValidationError) nextErrors.password = passwordValidationError;
        if (password !== confirmPassword) nextErrors.confirmPassword = "Passwords do not match.";
        if (Object.keys(nextErrors).length) {
            setFieldErrors(nextErrors);
            if (nextErrors.password) passwordRef.current?.focus();
            else confirmRef.current?.focus();
            return;
        }

        setIsSubmitting(true);
        try {
            await onReset({ password, confirmPassword });
            onComplete();
        } catch (err) {
            setFormError(userFacingAuthError(err, "Your password could not be reset. Request a new code and try again."));
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <AuthLayout showBrand={false} showPanel={false}>
            <div ref={dialogRef} className="fixed inset-0 z-50 flex min-h-screen items-center justify-center p-4" role="dialog" aria-modal="true" aria-labelledby="password-reset-title" tabIndex={-1}>
                <div className="w-full max-w-sm rounded-2xl border border-cyan-400/50 bg-[#081824] p-5 shadow-[0_24px_90px_rgba(0,0,0,.6)] sm:p-6">
                    <h1 id="password-reset-title" className="text-center text-2xl font-bold text-white">Reset your password</h1>
                    <p className="mt-2 text-center text-sm text-slate-400">Choose a new password for your Bot Fight account.</p>
                    <form onSubmit={handleSubmit} className="mt-5 flex flex-col gap-4">
                        <PasswordInput
                            ref={passwordRef}
                            id="reset-password"
                            label="New password"
                            value={password}
                            onChange={setPassword}
                            visible={isPasswordVisible}
                            onToggle={() => setIsPasswordVisible((visible) => !visible)}
                            error={fieldErrors.password}
                            autoComplete="new-password"
                        />
                        <PasswordInput
                            ref={confirmRef}
                            id="reset-password-confirm"
                            label="Confirm password"
                            value={confirmPassword}
                            onChange={setConfirmPassword}
                            visible={isConfirmVisible}
                            onToggle={() => setIsConfirmVisible((visible) => !visible)}
                            error={fieldErrors.confirmPassword}
                            autoComplete="new-password"
                        />
                        <p className="text-xs text-slate-500">Use 8–128 characters without spaces.</p>
                        {formError && <p className="form-error text-sm text-red-300" role="alert">{formError}</p>}
                        <button type="submit" disabled={isSubmitting} className="arena-toolbar-button arena-toolbar-button--neutral w-full disabled:opacity-60">
                            {isSubmitting ? "SAVING..." : "SAVE PASSWORD"}
                        </button>
                        <Link to="/login" className="text-center text-sm text-slate-400 hover:text-cyan-200">Cancel</Link>
                    </form>
                </div>
            </div>
        </AuthLayout>
    );
}

const PasswordInput = forwardRef((props, ref) => {
    const {
        id,
        label,
        value,
        onChange,
        visible,
        onToggle,
        error,
        autoComplete,
    } = props;
    return (
        <label htmlFor={id} className="block text-left">
            <span className="text-[11px] uppercase tracking-widest text-ink-muted">{label}</span>
            <div className="relative mt-1">
                <input
                    ref={ref}
                    id={id}
                    name={id}
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="w-full rounded border border-border-lo bg-zinc-950 px-3 py-3 pr-12 text-sm text-ink-white outline-none placeholder:text-slate-400 focus:border-cyan-500"
                    autoComplete={autoComplete}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? `${id}-error` : undefined}
                />
                <button
                    type="button"
                    onClick={onToggle}
                    aria-label={visible ? `Hide ${label.toLowerCase()}` : `Show ${label.toLowerCase()}`}
                    aria-pressed={visible}
                    className="auth-password-toggle absolute inset-y-0 right-0 flex w-12 items-center justify-center rounded-r border-0 bg-transparent p-0 text-slate-400 hover:border-transparent hover:bg-transparent hover:text-cyan-200"
                >
                    <svg aria-hidden="true" className="h-6 w-6" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
                        {visible ? (
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
            {error && <span id={`${id}-error`} className="form-error mt-1 block text-sm text-red-300">{error}</span>}
        </label>
    );
});
