# Arena sprite sheets

These PNG assets are the shared visual source for the browser test arena and
authoritative replay presentation. The supplied files are kept in ability-
named folders; `arenaSpriteAssets.js` and `abilitySpriteAssets.js` slice sheets
into Pixi textures at load time without changing their source pixels.

## Frame layout

There is no generic bot, effects, or entities sheet. The renderer loads the
ability-named art under `abilities/` and uses `bot/bot-design.png` for bots.
Multi-file animations are sorted by their numbered filenames unless the loader
declares an explicit ordered subset. Fireball intentionally loads only
`001.png` through `005.png`; later numbered files are not animation frames.

The packed sheets retain their supplied layouts: `melee-slashes-sheet.png` is
6 x 2, `shields/regular-shield.png` is 5 x 4, and the other layouts are declared
beside their imports in `abilitySpriteAssets.js`. Preserve transparent padding
and right-facing/centered anchors, and update that loader when replacing or
reordering a sheet. Arena geometry, movement, hitboxes, timing, and match
authority remain code-owned; these files are presentation only.

## Supplied ability art

The exact files supplied in `assetsIwant/` are copied into `abilities/` and
grouped by use. Three derived files intentionally contain only presentation
cleanup: `bot/bot-design.png` crops the transparent bot from its white source,
`bot/drone-design.png` adds red drone eyes, and `rays/fire-gun.png` keys the
gray backdrop away so only the beam remains. Their `*-source.png` or source
copies remain alongside them when needed; the originals in `assetsIwant/` are
never modified.

The renderer scales these textures relative to each move's range and bot
size; it does not use source image dimensions as gameplay hitboxes. Grenades
and mines share `explosions/grenade-mine-explosions.png`, while Wind Burst,
 Fireball, Phase Strike, and the zone/support abilities each use their named
folders. Retired ability names are not part of the asset or ability catalog.
