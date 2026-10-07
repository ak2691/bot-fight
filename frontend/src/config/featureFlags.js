/**
 * Public puzzles are hidden for now. The server flag `botfight.puzzles.public-enabled` (default false)
 * makes the public puzzle endpoints not-found for non-admins; this mirrors it in the client so the nav links,
 * tiles and routes disappear for them too. Build with `VITE_PUZZLES_PUBLIC_ENABLED=true` (and set the server
 * flag) to restore everything. Admins always see puzzles, and the admin builder is never affected.
 */
export const PUZZLES_PUBLIC_ENABLED = import.meta.env?.VITE_PUZZLES_PUBLIC_ENABLED === "true";

export function puzzlesVisibleTo(user, publicEnabled = PUZZLES_PUBLIC_ENABLED) {
    return publicEnabled === true || user?.admin === true;
}
