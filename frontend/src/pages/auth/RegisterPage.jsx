import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { passwordError, userFacingAuthError, usernameError } from "../../auth/validation";
import AuthLayout from "./AuthLayout";
import { AuthBanner, AuthDivider, AuthPasswordField, AuthTextField } from "./AuthFields.jsx";
import googleIconUrl from "../../assets/googleicon.png";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function RegisterPage() {
    const { isAuthenticated, isLoading, register, playAsGuest } = useAuth();
    const [email, setEmail] = useState("");
    const [username, setUsername] = useState("");
    const [password, setPassword] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGuestSubmitting, setIsGuestSubmitting] = useState(false);
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

    const handlePlayAsGuest = async () => {
        setFormError(null);
        setIsGuestSubmitting(true);
        try {
            await playAsGuest();
            navigate("/home", { replace: true });
        } catch (err) {
            setFormError(userFacingAuthError(err, "Guest mode could not be started. Try again."));
        } finally {
            setIsGuestSubmitting(false);
        }
    };

    return (
        <AuthLayout showcase authTab="register" onPlayAsGuest={handlePlayAsGuest} guestDisabled={isSubmitting || isGuestSubmitting}>
            {formError && <AuthBanner tone="error" id="register-form-error">{formError}</AuthBanner>}
            <form onSubmit={handleSubmit} className="auth-form">
                <AuthTextField
                    inputRef={usernameRef}
                    id="register-username"
                    name="username"
                    type="text"
                    label="Username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    maxLength={20}
                    pattern="[A-Za-z0-9_-]+"
                    placeholder="Choose your username"
                    autoComplete="username"
                    required
                    helper="Shown to other players"
                    error={fieldErrors.username}
                />
                <AuthTextField
                    inputRef={emailRef}
                    id="register-email"
                    name="email"
                    type="email"
                    label="Email"
                    value={email}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="you@example.com"
                    autoComplete="email"
                    required
                    error={fieldErrors.email}
                />
                <AuthPasswordField
                    inputRef={passwordRef}
                    id="register-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="new-password"
                    error={fieldErrors.password}
                    showStrength
                />
                <button type="submit" disabled={isSubmitting} className="auth-primary-button">
                    {isSubmitting ? "Creating account..." : "Create account"}
                </button>
            </form>
            <AuthDivider />
            <a href={apiUrl("/oauth2/authorization/google")} className="auth-social-button">
                <img src={googleIconUrl} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span>Sign up with Google</span>
            </a>
        </AuthLayout>
    );
}
