/**
 * Converts an authoritative ray range into the sprite width needed for its
 * forward edge to reach that range after the texture's muzzle anchor is
 * applied. This is presentation-only; collision still uses the ability range.
 */
export function visualRayLength(length, muzzleAnchor = 0.04) {
    const safeLength = Math.max(0, Number(length) || 0);
    const anchor = Math.min(0.95, Math.max(0, Number(muzzleAnchor) || 0));
    return safeLength / Math.max(0.05, 1 - anchor);
}
