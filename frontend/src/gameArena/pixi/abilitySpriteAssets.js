import { Assets, Rectangle, Texture } from "pixi.js";
import botDesignUrl from "../../assets/arena/abilities/bot/bot-design.png";
import droneDesignUrl from "../../assets/arena/abilities/bot/drone-design.png";
import fireGunUrl from "../../assets/arena/abilities/rays/fire-gun.png";
import muzzleFlashUrl from "../../assets/arena/abilities/rays/muzzle-flash.png";
import concussiveShotUrl from "../../assets/arena/abilities/rays/concussive-shot.png";
import railShotUrl from "../../assets/arena/abilities/rays/rail-shot.png";
import stunUrl from "../../assets/arena/abilities/stun/stun.png";
import dashSmokeUrl from "../../assets/arena/abilities/movement/dash-smoke.png";
import grenadeMineExplosionUrl from "../../assets/arena/abilities/explosions/grenade-mine-explosions.png";
import gravityGrenadeUrl from "../../assets/arena/abilities/zones/gravity-grenade.png";
import silencePulseUrl from "../../assets/arena/abilities/zones/silence-pulse.png";
import nullZoneUrl from "../../assets/arena/abilities/zones/null-zone.png";
import temporalRewindUrl from "../../assets/arena/abilities/support/temporal-rewind.png";
import basicHealUrl from "../../assets/arena/abilities/support/basic-heal.png";
import lockOnCrosshairUrl from "../../assets/arena/abilities/support/crosshair.png";
import repulsorBlastUrl from "../../assets/arena/abilities/repulsorblast/spritesheet.png";
import regularShieldUrl from "../../assets/arena/abilities/shields/regular-shield.png";
import orbitalMarkerUrl from "../../assets/arena/abilities/orbital-strike/orbital-strike-marker.png";
import orbitalExplosionUrl from "../../assets/arena/abilities/orbital-strike/orbitalstrike-explosion/spritesheet.png";
import meleeSlashesUrl from "../../assets/arena/melee-slashes-sheet.png";
import windburstSheetUrl from "../../assets/arena/abilities/wind-burst/atlas_17.png";
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
const MINE_MOVING_URLS = sortedAssetUrls(import.meta.glob("../../assets/arena/abilities/projectiles/mine/moving-*.png", { eager: true, query: "?url", import: "default" }));
const MINE_STATIC_URLS = sortedAssetUrls(import.meta.glob("../../assets/arena/abilities/projectiles/mine/static-*.png", { eager: true, query: "?url", import: "default" }));
const MINE_DETONATE_URLS = sortedAssetUrls(import.meta.glob("../../assets/arena/abilities/projectiles/mine/detonate-*.png", { eager: true, query: "?url", import: "default" }));
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
        loadAsset(concussiveShotUrl, "ray.concussive_shot"),
        loadAsset(railShotUrl, "ray.rail_shot"),
        loadAsset(stunUrl, "effect.stun"),
        loadAsset(dashSmokeUrl, "effect.dashSmoke"),
        loadAsset(grenadeMineExplosionUrl, "effect.grenadeMineExplosion"),
        loadAsset(gravityGrenadeUrl, "entity.gravityZone"),
        loadAsset(silencePulseUrl, "entity.silenceWave"),
        loadAsset(nullZoneUrl, "entity.nullZone"),
        loadAsset(temporalRewindUrl, "entity.temporalRewindZone"),
        loadAsset(basicHealUrl, "effect.basicHeal"),
        loadAsset(lockOnCrosshairUrl, "effect.lockOnCrosshair"),
        loadAsset(repulsorBlastUrl, "effect.repulsorBurst"),
        loadAsset(regularShieldUrl, "effect.shield"),
        loadAsset(orbitalMarkerUrl, "entity.orbitalMarker"),
        loadAsset(orbitalExplosionUrl, "entity.orbitalExplosion"),
        loadAsset(meleeSlashesUrl, "effect.meleeSlashes"),
        loadAsset(windburstSheetUrl, "projectile.windburstProjectile"),
        loadFrames(FIREBALL_URLS, "projectile.fireball", loadAsset),
        loadFrames(GRENADE_MOVING_URLS, "projectile.grenade.moving", loadAsset),
        loadFrames(GRENADE_STATIC_URLS, "projectile.grenade.static", loadAsset),
        loadFrames(GRENADE_DETONATE_URLS, "projectile.grenade.detonate", loadAsset),
        loadFrames(MINE_MOVING_URLS, "projectile.proximityMine.moving", loadAsset),
        loadFrames(MINE_STATIC_URLS, "projectile.proximityMine.static", loadAsset),
        loadFrames(MINE_DETONATE_URLS, "projectile.proximityMine.detonate", loadAsset),
        loadFrames(PHASE_STRIKE_URLS, "effect.phaseStrike", loadAsset),
    ]).then(([bot, drone, fireGun, muzzleFlash, concussiveShot, railShot, stun, dashSmoke, grenadeMineExplosion,
            gravityGrenade, silencePulse, nullZone, temporalRewind, basicHeal, lockOnCrosshair, repulsorBlast, regularShield, orbitalMarker, orbitalExplosion, meleeSlashes,
            windburst, fireball, grenadeMoving, grenadeStatic, grenadeDetonate, mineMoving, mineStatic, mineDetonate,
            phaseStrike]) => ({
            bot,
            drone,
            rays: Object.freeze({
                gun: [fireGun],
                pistol: [fireGun],
                fire_gun: [fireGun],
                pistol_shot: [fireGun],
                concussive_shot: sliceGrid(concussiveShot, 1, 7).slice(0, 6),
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
            mine: Object.freeze({ moving: mineMoving, static: mineStatic, detonate: mineDetonate }),
            grenadeMineExplosion: sliceGrid(grenadeMineExplosion, 8, 1),
            gravityGrenade: sliceGrid(gravityGrenade, 10, 10).slice(0, 91),
            silencePulse: sliceGrid(silencePulse, 2, 3).slice(0, 5),
            nullZone: sliceGrid(nullZone, 5, 1),
            temporalRewind: sliceGrid(temporalRewind, 5, 3),
            basicHeal: sliceGrid(basicHeal, 16, 1),
            lockOnCrosshair,
            repulsorBlast: sliceGrid(repulsorBlast, 10, 1),
            // The supplied sheet has four rows of five frames.
            shield: sliceGrid(regularShield, 5, 4),
            orbitalMarker,
            // Two six-frame color rows; Pixi tinting supplies the bot color.
            meleeSlash: sliceGrid(meleeSlashes, 6, 2).slice(0, 6),
            heavySlash: sliceGrid(meleeSlashes, 6, 2).slice(6, 12),
            orbitalExplosion: sliceGrid(orbitalExplosion, 9, 1),
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
