import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./auth-context";
import {
    GUEST_USER,
    isAnonymousResponse,
    isAuthenticatedResponse,
    isDefinitiveAuthFailure,
} from "./authState";
import { ensureCsrfHeaders } from "../security/csrf";
import { apiUrl } from "../config/api";

async function authFetch(path, options = {}) {
    const method = options.method ?? "GET";
    const response = await fetch(apiUrl(path), {
        ...options,
        credentials: "include",
        headers: {
            "Content-Type": "application/json",
            ...(await ensureCsrfHeaders(method)),
            ...(options.headers ?? {}),
        },
    });
    const body = await response.json().catch(() => ({}));

    if (!response.ok) {
        const message = body && typeof body === "object" && body.message
            ? body.message
            : `Request failed with ${response.status}`;
        const error = new Error(message);
        error.status = response.status;
        error.retryAfter = response.headers.get("Retry-After");
        throw error;
    }

    return body;
}

function normalizeCurrentUserResponse(currentUser) {
    if (isAuthenticatedResponse(currentUser)) return currentUser;
    if (isAnonymousResponse(currentUser)) return GUEST_USER;
    throw new Error("Invalid authentication response");
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState(GUEST_USER);
    const [isLoading, setIsLoading] = useState(true);
    const [authError, setAuthError] = useState(null);

    const refreshUser = useCallback(async () => {
        setIsLoading(true);
        setAuthError(null);
        try {
            const currentUser = await authFetch("/api/auth/me", { method: "GET" });
            const nextUser = normalizeCurrentUserResponse(currentUser);
            setUser(nextUser);
            return nextUser;
        } catch (error) {
            if (isDefinitiveAuthFailure(error)) {
                setUser(GUEST_USER);
                return GUEST_USER;
            }
            // A temporary API, proxy, or network failure is not proof that the
            // session ended. Preserve the current user and let protected routes
            // offer a retry state instead of redirecting to login.
            setAuthError(error);
            return null;
        } finally {
            setIsLoading(false);
        }
    }, []);

    useEffect(() => {
        refreshUser();
    }, [refreshUser]);

    const login = useCallback(async ({ email, password }) => {
        const loggedInUser = await authFetch("/api/auth/login", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        setAuthError(null);
        setUser(loggedInUser);
        return loggedInUser;
    }, []);

    const register = useCallback(async ({ email, username, password }) => {
        return authFetch("/api/auth/register", {
            method: "POST",
            body: JSON.stringify({ email, username, password }),
        });
    }, []);

    const verifyEmail = useCallback(async ({ email, code }) => {
        const verifiedUser = await authFetch("/api/auth/verify-email", {
            method: "POST",
            body: JSON.stringify({ email, code }),
        });
        setAuthError(null);
        setUser(verifiedUser);
        return verifiedUser;
    }, []);

    const resendVerification = useCallback(async ({ email }) => {
        return authFetch("/api/auth/resend-verification", {
            method: "POST",
            body: JSON.stringify({ email }),
        });
    }, []);

    const linkGoogleAccount = useCallback(async ({ email, password }) => {
        const linkedUser = await authFetch("/api/auth/google/link-existing", {
            method: "POST",
            body: JSON.stringify({ email, password }),
        });
        setAuthError(null);
        setUser(linkedUser);
        return linkedUser;
    }, []);

    const completeGoogleUsername = useCallback(async ({ username }) => {
        const completedUser = await authFetch("/api/auth/google/username", {
            method: "POST",
            body: JSON.stringify({ username }),
        });
        setAuthError(null);
        setUser(completedUser);
        return completedUser;
    }, []);

    const updateUsername = useCallback(async ({ username }) => {
        const updatedProfile = await authFetch("/api/profile/username", {
            method: "PUT",
            body: JSON.stringify({ username }),
        });
        try {
            const currentUser = await authFetch("/api/auth/me", { method: "GET" });
            setAuthError(null);
            setUser(normalizeCurrentUserResponse(currentUser));
        } catch (error) {
            if (isDefinitiveAuthFailure(error)) setUser(GUEST_USER);
            throw error;
        }
        return updatedProfile;
    }, []);

    const updateAboutMe = useCallback(async ({ aboutMe }) => authFetch("/api/profile/about-me", {
        method: "PUT",
        body: JSON.stringify({ aboutMe }),
    }), []);

    const logout = useCallback(async () => {
        const guest = await authFetch("/api/auth/logout", { method: "POST" });
        setAuthError(null);
        setUser(guest);
        return guest;
    }, []);

    const value = useMemo(() => ({
        user,
        isLoading,
        authError,
        isAuthenticated: user?.authenticated === true,
        login,
        register,
        verifyEmail,
        resendVerification,
        linkGoogleAccount,
        completeGoogleUsername,
        updateUsername,
        updateAboutMe,
        logout,
        refreshUser,
    }), [user, isLoading, authError, login, register, verifyEmail, resendVerification, linkGoogleAccount, completeGoogleUsername, updateUsername, updateAboutMe, logout, refreshUser]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
