import { useState } from "react";
import { PASSWORD_STRENGTH_LABELS, passwordStrength } from "./authPasswordStrength.js";

// Small tinted banner at the top of the auth card for errors, notices and success messages.
export function AuthBanner({ tone = "error", id, role = "alert", children }) {
    return <p id={id} role={role} className={`auth-banner auth-banner--${tone}`}>{children}</p>;
}

// A visible label above the control, with an optional action (e.g. "Forgot password?") at the right of the label row.
export function AuthField({ id, label, error = null, errorId, helper = null, labelAction = null, children }) {
    return (
        <div className="auth-field">
            <div className="auth-field__label-row">
                <label htmlFor={id} className="auth-field__label">{label}</label>
                {labelAction}
            </div>
            {children}
            {helper && !error && <p className="auth-field__helper">{helper}</p>}
            {error && <span id={errorId} className="form-error auth-field__error">{error}</span>}
        </div>
    );
}

export function AuthTextField({ id, label, inputRef, error, helper, labelAction, ...inputProps }) {
    const errorId = `${id}-error`;
    return (
        <AuthField id={id} label={label} error={error} errorId={errorId} helper={helper} labelAction={labelAction}>
            <input
                ref={inputRef}
                id={id}
                className="auth-input"
                aria-invalid={Boolean(error)}
                aria-describedby={error ? errorId : undefined}
                {...inputProps}
            />
        </AuthField>
    );
}

export function StrengthBar({ password }) {
    const strength = passwordStrength(password);
    return (
        <div className="auth-strength" data-strength={strength} role="status" aria-live="polite">
            <div className="auth-strength__bar" aria-hidden="true">
                {[1, 2, 3].map((segment) => <span key={segment} className={segment <= strength ? "is-filled" : ""} />)}
            </div>
            <span className="auth-strength__label">{strength ? `${PASSWORD_STRENGTH_LABELS[strength]} password` : "Use 8 or more characters"}</span>
        </div>
    );
}

export function AuthPasswordField({ id, label = "Password", value, onChange, inputRef, error, labelAction, showStrength = false, autoComplete, placeholder = "••••••••" }) {
    const [isPasswordVisible, setIsPasswordVisible] = useState(false);
    const errorId = `${id}-error`;
    return (
        <AuthField id={id} label={label} error={error} errorId={errorId} labelAction={labelAction}>
            <div className="auth-input-wrap">
                <input
                    ref={inputRef}
                    id={id}
                    name="password"
                    type={isPasswordVisible ? "text" : "password"}
                    value={value}
                    onChange={onChange}
                    placeholder={placeholder}
                    className="auth-input auth-input--password"
                    autoComplete={autoComplete}
                    required
                    aria-invalid={Boolean(error)}
                    aria-describedby={error ? errorId : undefined}
                />
                <button
                    type="button"
                    onClick={() => setIsPasswordVisible((visible) => !visible)}
                    aria-label={isPasswordVisible ? "Hide password" : "Show password"}
                    aria-pressed={isPasswordVisible}
                    className="auth-password-toggle"
                >
                    <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8">
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
            {showStrength && <StrengthBar password={value} />}
        </AuthField>
    );
}

export function AuthDivider() {
    return (
        <div className="auth-divider" aria-hidden="true">
            <span />
            <b>or</b>
            <span />
        </div>
    );
}
