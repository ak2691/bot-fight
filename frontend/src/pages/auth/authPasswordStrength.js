// Client-side hint only. The server's password rules are unchanged and stay authoritative.
const CHARACTER_CLASSES = [/[a-z]/, /[A-Z]/, /\d/, /[^A-Za-z0-9]/];

export const PASSWORD_STRENGTH_LABELS = Object.freeze(["", "Weak", "Okay", "Strong"]);

// 0 = empty, 1 = weak, 2 = okay, 3 = strong, from length and character variety.
export function passwordStrength(password) {
    const value = String(password ?? "");
    if (!value) return 0;
    const variety = CHARACTER_CLASSES.filter((pattern) => pattern.test(value)).length;
    if (value.length >= 12 && variety >= 3) return 3;
    if (value.length >= 8 && variety >= 2) return 2;
    return 1;
}
