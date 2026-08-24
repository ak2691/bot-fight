export const GUEST_USER = Object.freeze({ authenticated: false, username: "guest" });

export function isAuthenticatedResponse(user) {
    return user?.authenticated === true;
}

export function isAnonymousResponse(user) {
    return user?.authenticated === false;
}

export function isDefinitiveAuthFailure(error) {
    return Number(error?.status) === 401;
}

export function authUnavailableMessage(error) {
    return Number(error?.status) === 429
        ? "Too many requests. Try again shortly."
        : "Unable to verify your session right now. Try again.";
}
