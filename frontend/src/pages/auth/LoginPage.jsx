import { useEffect, useRef, useState } from "react";
import { Link, Navigate, useLocation, useNavigate } from "react-router-dom";
import { useAuth } from "../../auth/auth-context";
import { apiUrl } from "../../config/api";
import { passwordError, userFacingAuthError, usernameError } from "../../auth/validation";
import { isServerUnavailable, LOGIN_SERVER_DOWN_MESSAGE } from "../../auth/serverError.js";
import AuthLayout from "./AuthLayout";
import { AuthBanner, AuthDivider, AuthPasswordField, AuthTextField } from "./AuthFields.jsx";
import googleIconUrl from "../../assets/googleicon.png";

const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export default function LoginPage() {
    const { authError, isAuthenticated, isLoading, login, playAsGuest, linkGoogleAccount, completeGoogleUsername } = useAuth();
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");
    const [fieldErrors, setFieldErrors] = useState({});
    const [formError, setFormError] = useState(null);
    const [isSubmitting, setIsSubmitting] = useState(false);
    const [isGuestSubmitting, setIsGuestSubmitting] = useState(false);
    const [requestServerError, setRequestServerError] = useState(false);
    const navigate = useNavigate();
    const location = useLocation();
    const googleStatus = new URLSearchParams(location.search).get("google");
    const resetCompleted = new URLSearchParams(location.search).get("reset") === "success";
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
        setRequestServerError(false);
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
            const serverUnavailable = isServerUnavailable(err);
            setRequestServerError(serverUnavailable);
            setFormError(serverUnavailable ? null : userFacingAuthError(err, "Login could not be completed. Check your details and try again."));
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleUsernameSubmit = async (event) => {
        event.preventDefault();
        setUsernameErrorMessage(null);
        setRequestServerError(false);
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
            const serverUnavailable = isServerUnavailable(err);
            setRequestServerError(serverUnavailable);
            setUsernameErrorMessage(serverUnavailable ? LOGIN_SERVER_DOWN_MESSAGE : userFacingAuthError(err, "That username could not be saved. Choose another and try again."));
        } finally {
            setIsUsernameSubmitting(false);
        }
    };

    const handlePlayAsGuest = async () => {
        setFormError(null);
        setRequestServerError(false);
        setIsGuestSubmitting(true);
        try {
            await playAsGuest();
            navigate("/home", { replace: true });
        } catch (err) {
            const serverUnavailable = isServerUnavailable(err);
            setRequestServerError(serverUnavailable);
            setFormError(serverUnavailable ? null : userFacingAuthError(err, "Guest mode could not be started. Try again."));
        } finally {
            setIsGuestSubmitting(false);
        }
    };

    if (googleUsernameRequired) {
        return (
            <AuthLayout>
                <UsernameSetupCard
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
        <AuthLayout showcase authTab="login" onPlayAsGuest={handlePlayAsGuest} guestDisabled={isSubmitting || isGuestSubmitting}>
            {(isServerUnavailable(authError) || requestServerError) && (
                <AuthBanner tone="warn">{LOGIN_SERVER_DOWN_MESSAGE}</AuthBanner>
            )}
            {googleLinkRequired && (
                <AuthBanner tone="info" role="status">
                    This Google account matches an existing Bot Fight account. Enter that account's email and password to link Google and sign in.
                </AuthBanner>
            )}
            {googleStatus === "error" && (
                <AuthBanner tone="error">Google sign-in could not be completed. Try again or use your email and password.</AuthBanner>
            )}
            {formError && <AuthBanner tone="error" id="login-form-error">{formError}</AuthBanner>}
            {resetCompleted && <AuthBanner tone="success" role="status">Your password was reset. You can now log in.</AuthBanner>}
            <form onSubmit={handleSubmit} className="auth-form">
                <AuthTextField
                    inputRef={emailRef}
                    id="login-email"
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
                    id="login-password"
                    value={password}
                    onChange={(event) => setPassword(event.target.value)}
                    autoComplete="current-password"
                    error={fieldErrors.password}
                    labelAction={<Link to="/forgot-password" className="auth-link">Forgot password?</Link>}
                />
                <button type="submit" disabled={isSubmitting} className="auth-primary-button">
                    {isSubmitting ? "Logging in..." : "Log in"}
                </button>
            </form>
            <AuthDivider />
            <a href={apiUrl("/oauth2/authorization/google")} className="auth-social-button">
                <img src={googleIconUrl} alt="" aria-hidden="true" className="h-5 w-5 shrink-0" />
                <span>Continue with Google</span>
            </a>
            <button
                type="button"
                onClick={() => void handlePlayAsGuest()}
                disabled={isSubmitting || isGuestSubmitting}
                className="auth-guest-button"
            >
                <strong>Play as guest</strong>
                <small>No account needed · guests play guests</small>
            </button>
        </AuthLayout>
    );
}

function UsernameSetupCard({ username, setUsername, error, isSubmitting, onSubmit }) {
    const usernameRef = useRef(null);
    return (
        <section className="auth-panel w-full" aria-labelledby="username-setup-title">
            <div className="auth-panel__heading">
                <h1 id="username-setup-title">Choose your username</h1>
                <p>Other players will see this name.</p>
            </div>
            <form onSubmit={onSubmit} className="auth-form">
                {error && <AuthBanner tone="error" id="google-username-error">{error}</AuthBanner>}
                <AuthTextField
                    inputRef={usernameRef}
                    id="google-username"
                    name="username"
                    type="text"
                    label="Username"
                    value={username}
                    onChange={(event) => setUsername(event.target.value)}
                    maxLength={20}
                    pattern="[A-Za-z0-9_-]+"
                    autoFocus
                    autoComplete="username"
                    required
                    placeholder="Choose your username"
                    helper="3–20 letters, numbers, underscores or hyphens"
                />
                <button type="submit" disabled={isSubmitting} className="auth-primary-button">
                    {isSubmitting ? "Saving" : "Save username"}
                </button>
            </form>
        </section>
    );
}
