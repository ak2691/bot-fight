import { Assets, Rectangle, Texture } from "pixi.js";
import botDesignUrl from "../../assets/arena/abilities/bot/bot-design.png";
import droneDesignUrl from "../../assets/arena/abilities/bot/drone-design.png";
import fireGunUrl from "../../assets/arena/abilities/rays/fire-gun.png";
import muzzleFlashUrl from "../../assets/arena/abilities/rays/muzzle-flash.png";
import railShotUrl from "../../assets/arena/abilities/rays/rail-shot.webp";
import stunUrl from "../../assets/arena/abilities/stun/stun.png";
import dashSmokeUrl from "../../assets/arena/abilities/movement/dash-smoke.png";
import grenadeMineExplosionUrl from "../../assets/arena/abilities/explosions/grenade-mine-explosions.png";
import silencePulseUrl from "../../assets/arena/abilities/zones/silence-pulse.webp";
import temporalRewindUrl from "../../assets/arena/abilities/support/temporal-rewind.png";
import repulsorBlastUrl from "../../assets/arena/abilities/repulsorblast/spritesheet.png";
import orbitalExplosionUrl from "../../assets/arena/abilities/orbital-strike/orbitalstrike-explosion/spritesheet.png";
import frostRingSheetUrl from "../../assets/arena/abilities/frostring/IceShatter_96x96.png";
import singularityAtlasUrl from "../../assets/arena/abilities/singularity/atlas_11.webp";
import meleeSlashesUrl from "../../assets/arena/melee-slashes-sheet.png";
import windburstSheetUrl from "../../assets/arena/abilities/wind-burst/atlas_17.webp";
import grenadeMoving001Url from "../../assets/arena/abilities/projectiles/grenade/moving-001.png";
import grenadeMoving002Url from "../../assets/arena/abilities/projectiles/grenade/moving-002.png";
import grenadeMoving003Url from "../../assets/arena/abilities/projectiles/grenade/moving-003.png";
import grenadeMoving004Url from "../../assets/arena/abilities/projectiles/grenade/moving-004.png";
import grenadeStatic001Url from "../../assets/arena/abilities/projectiles/grenade/static-001.png";
import grenadeStatic002Url from "../../assets/arena/abilities/projectiles/grenade/static-002.png";
import grenadeStatic003Url from "../../assets/arena/abilities/projectiles/grenade/static-003.png";
import grenadeStatic004Url from "../../assets/arena/abilities/projectiles/grenade/static-004.png";
import grenadeDetonate001Url from "../../assets/arena/abilities/projectiles/grenade/detonate-001.png";
import grenadeDetonate002Url from "../../assets/arena/abilities/projectiles/grenade/detonate-002.png";
import fireball001Url from "../../assets/arena/abilities/projectiles/fireball/001.png";
import fireball002Url from "../../assets/arena/abilities/projectiles/fireball/002.png";
import fireball003Url from "../../assets/arena/abilities/projectiles/fireball/003.png";
import fireball004Url from "../../assets/arena/abilities/projectiles/fireball/004.png";
import fireball005Url from "../../assets/arena/abilities/projectiles/fireball/005.png";
import { FIREBALL_FRAME_NAMES, orderedAnimationFrames } from "./abilityAnimationFrames.js";

const FIREBALL_URLS = orderedAnimationFrames({
    "001.png": fireball001Url,
    "002.png": fireball002Url,
    "003.png": fireball003Url,
    "004.png": fireball004Url,
    "005.png": fireball005Url,
}, FIREBALL_FRAME_NAMES);
const GRENADE_MOVING_URLS = [grenadeMoving001Url, grenadeMoving002Url, grenadeMoving003Url, grenadeMoving004Url];
const GRENADE_STATIC_URLS = [grenadeStatic001Url, grenadeStatic002Url, grenadeStatic003Url, grenadeStatic004Url];
const GRENADE_DETONATE_URLS = [grenadeDetonate001Url, grenadeDetonate002Url];
const PHASE_STRIKE_URLS = sortedAssetUrls(import.meta.glob("../../assets/arena/abilities/support/phase-strike/*.png", { eager: true, query: "?url", import: "default" }));

const MUZZLE_ANCHORS = new WeakMap();

export function textureMuzzleAnchor(texture, fallback = 0.04) {
    return MUZZLE_ANCHORS.get(texture) ?? fallback;
}

/** Loads supplied art and only slices its existing sheets into Pixi textures. */
export function loadAbilitySpriteCatalogue(loadAsset = defaultLoadAsset) {
    return Promise.all([
        loadAsset(botDesignUrl, "bot.bot"),
        loadAsset(droneDesignUrl, "entity.hunterDrone"),
        loadAsset(fireGunUrl, "ray.fire_gun"),
        loadAsset(muzzleFlashUrl, "effect.muzzleFlash"),
        loadAsset(railShotUrl, "ray.rail_shot"),
        loadAsset(stunUrl, "effect.stun"),
        loadAsset(dashSmokeUrl, "effect.dashSmoke"),
        loadAsset(grenadeMineExplosionUrl, "effect.grenadeMineExplosion"),
        loadAsset(silencePulseUrl, "entity.silenceWave"),
        loadAsset(temporalRewindUrl, "entity.temporalRewindZone"),
        loadAsset(repulsorBlastUrl, "effect.repulsorBurst"),
        loadAsset(orbitalExplosionUrl, "entity.orbitalExplosion"),
        loadAsset(frostRingSheetUrl, "effect.frostRing"),
        loadAsset(singularityAtlasUrl, "entity.singularity"),
        loadAsset(meleeSlashesUrl, "effect.meleeSlashes"),
        loadAsset(windburstSheetUrl, "projectile.windburstProjectile"),
        loadFrames(FIREBALL_URLS, "projectile.fireball", loadAsset),
        loadFrames(GRENADE_MOVING_URLS, "projectile.grenade.moving", loadAsset),
        loadFrames(GRENADE_STATIC_URLS, "projectile.grenade.static", loadAsset),
        loadFrames(GRENADE_DETONATE_URLS, "projectile.grenade.detonate", loadAsset),
        loadFrames(PHASE_STRIKE_URLS, "effect.phaseStrike", loadAsset),
    ]).then(([bot, drone, fireGun, muzzleFlash, railShot, stun, dashSmoke, grenadeMineExplosion,
            silencePulse, temporalRewind, repulsorBlast, orbitalExplosion, frostRing, singularity,
            meleeSlashes, windburst, fireball, grenadeMoving, grenadeStatic, grenadeDetonate,
            phaseStrike]) => ({
            bot,
            drone,
            rays: Object.freeze({
                gun: [fireGun],
                fire_gun: [fireGun],
                // Nine rail frames arranged row-major in a 2 x 5 guide. The
                // tenth cell is the green guide marker, not animation art.
                // Per-frame anchors remove the changing transparent lead-in.
                rail_shot: withMuzzleAnchors(
                    sliceGrid(railShot, 2, 5).slice(0, 9),
                    [366, 349, 332, 272, 247, 16, 0, 0, 5].map((pixels) => pixels / 2048),
                ),
            }),
            muzzleFlash: sliceGrid(muzzleFlash, 4, 2),
            // This is one tall supplied stun frame, not a two-row sheet.
            stun: [stun],
            dashSmoke: sliceGrid(dashSmoke, 5, 1),
            // Three complete frames stacked from top to bottom.
            windburst: sliceGrid(windburst, 1, 3),
            fireball,
            grenade: Object.freeze({ moving: grenadeMoving, static: grenadeStatic, detonate: grenadeDetonate }),
            grenadeMineExplosion: sliceGrid(grenadeMineExplosion, 8, 1),
            silencePulse: sliceGrid(silencePulse, 2, 3).slice(0, 5),
            temporalRewind: sliceGrid(temporalRewind, 5, 3),
            repulsorBlast: sliceGrid(repulsorBlast, 10, 1),
            // Two six-frame color rows; Pixi tinting supplies the bot color. Cleave's sweep reads the second row.
            meleeSlash: sliceGrid(meleeSlashes, 6, 2).slice(0, 6),
            heavySlash: sliceGrid(meleeSlashes, 6, 2).slice(6, 12),
            orbitalExplosion: sliceGrid(orbitalExplosion, 9, 1),
            frostRing: sliceGrid(frostRing, 49, 1),
            singularity: pingPongFrames(sliceGrid(singularity, 2, 2)),
            phaseStrike,
        }));
}

function sortedAssetUrls(glob) {
    return Object.entries(glob).sort(([first], [second]) => first.localeCompare(second)).map(([, url]) => url);
}

function defaultLoadAsset(url) {
    return Assets.load(url);
}

function loadFrames(urls, assetKey, loadAsset) {
    return Promise.all(urls.map((url, index) => loadAsset(url, `${assetKey}[${index}]`)));
}

function withMuzzleAnchors(frames, anchors) {
    frames.forEach((frame, index) => MUZZLE_ANCHORS.set(frame, anchors[index] ?? 0));
    return frames;
}

function pingPongFrames(frames) {
    if (!frames?.length) return [];
    return [...frames, ...frames.slice(1, -1).reverse()];
}

function sliceGrid(sheetTexture, columns, rows) {
    const cellWidth = sheetTexture.width / columns;
    const cellHeight = sheetTexture.height / rows;
    return Array.from({ length: columns * rows }, (_, index) => {
        const column = index % columns;
        const row = Math.floor(index / columns);
        return new Texture({
            source: sheetTexture.source,
            frame: new Rectangle(column * cellWidth, row * cellHeight, cellWidth, cellHeight),
        });
    });
}
