# 11 MVP Plan

## Scope

### In the MVP

| Area | Included |
|---|---|
| Parts | 3 frames, 3 drivetrains, 4 batteries, 5 fittings (bare, light, heavy, spiked, wedge), 4 weapons, built-in sensing + 3 rangefinders + camera |
| Engine | Physics, collisions, rams, the four weapons and the wedge, sensors, hazards (pit, saw, spiked wall, pillar, block, crate, ring-out), judging, replays with traces |
| Brain | Start rules, situations, modes, lanes, switches, all readings and maneuvers in [06](06-programming.md), Arm, validation and lint |
| Garage | Builder with bars, presets, test drive, brain editor, sandbox with trace and Why panel, versions |
| Content | 5 hand-made arenas, the generator with one template, the launch twist catalogue, 15 house bots, 10 Academy missions, 42+ gauntlets for season 1, season planner, balance harness |
| Competition | Weekly Cup (stages, Swiss, finals premiere, divisions when large), Daily Gauntlet, practice ladder, Builder Rating and titles, seasons |
| Social | Friends, activity feed, challenges (with mirror matches), rivalry records, replay pages |
| Progression | XP and levels, garage slots, paints and decals, bot careers, trophies, season badges |
| Notifications | Every weekly beat; challenge and gauntlet results |

### Launch stretch (ship if ready, else first patch)

Commentary captions, highlights, bot cards, Archive publishing and forking, the full achievements list.

### After the MVP (roadmap order)

1. Scrim rooms and Blitz Build
2. Clubs and private cups; pick'em
3. Vault weapons (drum, saw, shell spinner, lifter) with season 2
4. Upside-down states and self-righters; part damage (camera knockout)
5. Brain memory variables; the drivetrain–battery link
6. New hazards (turntable, arena hammer, flame jets) and modes (king of the hill, soccer)
7. Team (2v2) mode
8. three.js renderer; a visual arena editor; optional cosmetics store

## Milestones

Each milestone ends in something playable and an exit test. The removal of the old live-match code (Phase 1 in
[`../GAMEPLAY_OVERHAUL_MIGRATION.md`](../GAMEPLAY_OVERHAUL_MIGRATION.md)) can happen any time before M3.

| # | Milestone | Builds | Playable outcome | Exit test |
|---|---|---|---|---|
| **M0** | **Find the fun** | Browser-only physics toy: 2 bots, keyboard driving, the three drivetrains, collisions and rams, a spinner and a wedge, The Box and The Pit, live tuning sliders | Two people drive bots at each other | Testers say pushing, ramming and spinner hits feel good; first physics numbers chosen |
| **M1** | Engine core | `shared/sim`: all parts, weapons, sensors, hazards, brain evaluation, `runGame`, `deriveStats`, validation, determinism lint, golden tests | House bots fight each other deterministically | Harness runs the matchup matrix; worker and browser hashes match; under 30 ms per game |
| **M2** | Garage and editor | Builder, bars, test drive, brain editor, sandbox, trace and Why panel, presets and starter brains (local saving) | A player builds and programs a bot offline | 5 new users each beat a house bot within 30 minutes, unaided (think-aloud sessions) |
| **M3** | Online core | Content service, garage persistence and versions, worker endpoints, game queue and dispatcher, replays and visibility, friends, challenges, notifications | Friends challenge each other online | First external playtest (10–20 people) for a week |
| **M4** | The Weekly Cup | Cup state machine, entries and auto-entry, Swiss, tiebreakers, finals premiere, Glicko-2 and titles, practice ladder, season planner and the first season file | Real cups | Two full cup weeks with testers, no manual intervention |
| **M5** | Daily and onboarding | Daily Gauntlet (medals, streaks), Academy with server verification, XP, levels, unlocks, careers, trophies | The full new-player journey | Funnel measured: Academy completion, first cup entry |
| **M6** | Polish and launch | Renderer effects, launch stretch items, mobile pass, balance pass from cup data, load test | Launch | Launch checklist complete |

**M0 comes first on purpose.** If shoving, ramming and spinner hits aren't satisfying with a keyboard, no amount of
programming depth will save the game. It's cheap to build and it de-risks everything else.

## Playtests

| When | Who | Question |
|---|---|---|
| M0 | Internal, friends | Does the physics feel good? |
| M2 | 5 new users, think-aloud | Can a newcomer build and program a working bot? Where do they get stuck? |
| M3 | 10–20 testers | Do people challenge each other and come back to improve? |
| M4 | 30+ testers, 2–3 weeks | Does the cup week work? Does the twist create real adaptation? |
| M6 | Soft launch | Retention and balance at scale |

## Metrics

| Metric | Target | Why |
|---|---|---|
| Academy completion | ≥ 60% of starters | The floor is low enough |
| First cup entry within 7 days | ≥ 40% of Academy finishers | The path from learning to competing works |
| **Edits after a loss** (new version saved within 24 h of a cup loss) | ≥ 50% | The core loop: losing makes people improve, not quit |
| Week-over-week cup participation | ≥ 60% | The weekly rhythm holds |
| D1 / D7 / D30 retention | 40% / 20% / 10% | Overall health |
| Gauntlet streaks | Median ≥ 3 days among weekly actives | The daily habit forms |
| Challenges per active player per week | ≥ 2 | Friends play together |
| Weapon usage share | None above 40% | No dominant weapon |
| Weapon win rates | 45–55% | Balance |

## Risks

| Risk | Mitigation |
|---|---|
| The physics isn't fun | M0 before anything else; live tuning |
| Brains are too hard, or too weak to express good ideas | M2 usability tests; maneuvers keep control abstract; presets, starter brains and the Academy; lint with suggested fixes |
| One weapon dominates | The matchup web, the harness in CI, season patches and tax twists |
| Determinism bugs | Lint rules, golden hashes in CI across Node and a headless browser, property tests |
| Too few players at launch | The Daily Gauntlet works alone; house bots fill cups and anchor ratings; challenges |
| Content production becomes a burden | The generator, the season planner and catalogue reruns; people only approve |
| Copying and AI-built bots | Private code, publishing only after a cup, weekly twists. Accepted as unstoppable |
| Stalemates (pinning, camping) | The judges score damage taken, so passivity loses; watch for it in playtests and add an aggression rule only if needed |
| Server cost | Games are cheap; quotas on challenges, gauntlet submissions and ladder games |
| Scope | Milestone exits, a strict post-MVP list, and removing the old code first |

## Remaining owner decisions

These don't block M0–M2:

1. **Art direction:** cartoony or realistic top-down sprites.
2. **Names:** titles, part names, the game's own vocabulary.
3. **Cup times:** 18:00 UTC suits Europe and the US east coast; choose by the first audience.
4. **Monetization:** none in the MVP; cosmetics later, never power.
5. **Rookie division thresholds,** once real data exists.
