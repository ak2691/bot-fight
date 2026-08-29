export const USERNAME_PATTERN = /^[A-Za-z0-9_-]+$/;
export const MIN_USERNAME_LENGTH = 3;
export const MAX_USERNAME_LENGTH = 20;

export function usernameError(value) {
    const username = value.trim();
    if (username.length < MIN_USERNAME_LENGTH || username.length > MAX_USERNAME_LENGTH) {
        return "Username must be between 3 and 20 characters.";
    }
    if (!USERNAME_PATTERN.test(username)) {
        return "Username may only contain letters, numbers, underscores, and hyphens.";
    }
    return null;
}

export function passwordError(value, { required = true } = {}) {
    if (required && value.length === 0) return "Enter your password.";
    if (/\s/.test(value)) return "Password cannot contain spaces.";
    return null;
}

export function newPasswordError(value) {
    if (value.length === 0) return "Enter a new password.";
    if (value.length < 8 || value.length > 128) return "Password must be between 8 and 128 characters.";
    if (/\s/.test(value)) return "Password cannot contain spaces.";
    return null;
}

export function userFacingAuthError(error, fallback) {
    const message = String(error?.message ?? "").trim();
    if (!message || /request failed with \d{3}|exception|stack trace|java\.|org\.|sql|database error/i.test(message)) {
        return fallback;
    }
    return message;
}
