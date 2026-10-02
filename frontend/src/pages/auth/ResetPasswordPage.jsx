import { forwardRef, useEffect, useRef, useState } from "react";
import { Link, Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { newPasswordError, userFacingAuthError } from "../../auth/validation";
import AuthLayout from "./AuthLayout";
import { AuthBanner } from "./AuthFields.jsx";

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
            <AuthLayout title="Reset your password">
                <AuthBanner tone="info" role="status">Checking your reset session...</AuthBanner>
            </AuthLayout>
        );
    }

    return <PasswordResetModal onReset={resetPassword} onComplete={() => navigate("/login?reset=success", { replace: true })} />;
}

function PasswordResetModal({ onReset, onComplete }) {
    const passwordRef = useRef(null);
    const confirmRef = useRef(null);
    const [password, setPassword] = useState("");
    const [confirmPassword, setConfirmPassword] = useState("");
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const [isConfirmVisible, setIsConfirmVisible] = useState(false);
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);

    useEffect(() => {
        passwordRef.current?.focus();
    }, []);

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
        <AuthLayout title="Reset your password" subtitle="Choose a new password for your Bot Fight account.">
            <form onSubmit={handleSubmit} className="auth-form">
                {formError && <AuthBanner tone="error">{formError}</AuthBanner>}
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
                <p className="auth-field__helper">Use 8–128 characters without spaces.</p>
                <button type="submit" disabled={isSubmitting} className="auth-primary-button">
                    {isSubmitting ? "Saving..." : "Save password"}
                </button>
                <Link to="/login" className="auth-link text-center">Cancel</Link>
            </form>
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
        <div className="auth-field">
            <label htmlFor={id} className="auth-field__label">{label}</label>
            <div className="auth-input-wrap">
                <input
                    ref={ref}
                    id={id}
                    name={id}
                    type={visible ? "text" : "password"}
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                    className="auth-input auth-input--password"
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
                    className="auth-password-toggle"
                >
                    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
            {error && <span id={`${id}-error`} className="form-error auth-field__error">{error}</span>}
        </div>
    );
});
