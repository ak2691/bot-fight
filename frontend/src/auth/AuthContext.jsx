import { useCallback, useEffect, useMemo, useState } from "react";
import { AuthContext } from "./auth-context";
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
        throw new Error(body.message ?? `Request failed with ${response.status}`);
    }

    return body;
}

export function AuthProvider({ children }) {
    const [user, setUser] = useState({ authenticated: false, username: "guest" });
    const [isLoading, setIsLoading] = useState(true);

    const refreshUser = useCallback(async () => {
        try {
            const currentUser = await authFetch("/api/auth/me", { method: "GET" });
            setUser(currentUser);
            return currentUser;
        } catch {
            const guest = { authenticated: false, username: "guest" };
            setUser(guest);
            return guest;
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
        setUser(linkedUser);
        return linkedUser;
    }, []);

    const completeGoogleUsername = useCallback(async ({ username }) => {
        const completedUser = await authFetch("/api/auth/google/username", {
            method: "POST",
            body: JSON.stringify({ username }),
        });
        setUser(completedUser);
        return completedUser;
    }, []);

    const updateUsername = useCallback(async ({ username }) => {
        const updatedProfile = await authFetch("/api/profile/username", {
            method: "PUT",
            body: JSON.stringify({ username }),
        });
        const currentUser = await authFetch("/api/auth/me", { method: "GET" });
        setUser(currentUser);
        return updatedProfile;
    }, []);

    const updateAboutMe = useCallback(async ({ aboutMe }) => authFetch("/api/profile/about-me", {
        method: "PUT",
        body: JSON.stringify({ aboutMe }),
    }), []);

    const logout = useCallback(async () => {
        const guest = await authFetch("/api/auth/logout", { method: "POST" });
        setUser(guest);
        return guest;
    }, []);

    const value = useMemo(() => ({
        user,
        isLoading,
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
    }), [user, isLoading, login, register, verifyEmail, resendVerification, linkGoogleAccount, completeGoogleUsername, updateUsername, updateAboutMe, logout, refreshUser]);

    return (
        <AuthContext.Provider value={value}>
            {children}
        </AuthContext.Provider>
    );
}
