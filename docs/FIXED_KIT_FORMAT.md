# Fixed Kit Format

Status: server and shared engine sections 3, 4 and 6 built 2026-10-10. Client UI, saved brains/snippets and sparring remain unbuilt. It amends
[`TIMED_ROUNDS_MATCH_FORMAT.md`](TIMED_ROUNDS_MATCH_FORMAT.md) (the "timed-rounds doc"): where they disagree,
this document describes the intended change, and the timed-rounds doc describes what exists today. Sections of
the timed-rounds doc that this one doesn't mention (movement and stamina, chains, carry-over, the zone, the HP
decision) are unchanged.

## 1. Problem

Two problems with today's format:

- **The skill floor is too high.** Round 1 asks for a whole brain, from a blank page, under the clock. A new
  player needs a long tutorial before they understand what to do.
- **There is little real interaction ("semi-hope chess").** Each round adds a random ability. That changes the
  opponent's bot, so what you learned from the last segment is mostly out of date. Most of the thinking becomes
  comparing loadouts and guessing, not reading what the opponent actually built.

Goal: **you respond to what the opponent's bot actually did**, like answering a move in chess, and a new player
can do something useful in their first match.

## 2. Summary

| | Today (timed-rounds doc) | This proposal |
|---|---|---|
| Loadout | Weapon in round 1, then one random-offer ability per round (6 abilities) | **Fixed kit chosen before the match:** a weapon + one ability from each tier (3 abilities) |
| Opponent's loadout | Revealed one pick at a time | **Revealed in full before round 1** |
| Rounds | 6, each with a pick | 6, alternating **unlock** and **gap** rounds |
| Pick phase | Every round | None. Unlocks are automatic and known in advance |
| Round 1 brain | Built under the clock | **Loaded from your saved brains**, then adjusted under the clock |
| Saved brains and snippets | Not adopted (section 7 of the timed-rounds doc) | **Adopted** (section 5) |
| Edits per round | Open question | **Unlimited** within the brain budget. The clock is the only limit |
| Clock increment | +30 s every round | **+45 s on unlock rounds, +30 s on gap rounds** |

## 3. The kit (server and shared engine built)

| Slot | Choice | Pool today | Character |
|---|---|---|---|
| Dash, sprint, fast turn | Always present | — | Base movement, paid for with stamina |
| Weapon | 1 | 4 | Baseline pressure |
| Tier 1 | 1 | ~11 | Bread-and-butter tools |
| Tier 2 | 1 | ~10 | Control and swing tools |
| Tier 3 ("ultimate") | 1 | ~5 | Fight-changing tools |

- The catalog's existing `round` field is the tier. No catalog reorganization is needed.
- **The kit is the player's identity for the match.** Both players lock it blind before the match, and both kits
  are revealed together.
- **Tier 3 is framed as an ultimate**, unlocked later, as in a MOBA. Players already know this idea, which lowers
  the floor.
- A kit is at most a weapon + 3 abilities per bot (8 tools on the board), and all of them are visible from the
  start. Nothing arrives that couldn't be seen coming.

### Implemented server protocol

- `/app/matchmaking.join` includes `kit: { weapon: 1, abilities: [3, 6, 21] }` (numeric IDs ordered by tier).
  Wrong tiers, duplicates, unknown IDs, missing weapon, coercible strings/floats and extra fields are rejected.
- For parties, each member prepares their own kit via `/app/matchmaking.kit` on their live socket; the leader's
  queue request includes their own kit. The server requires a prepared kit for every teammate's current socket.
- `POST /api/custom-lobbies/{lobbyId}/ready` takes the same kit and updates only the authenticated member.
  Every member must be ready before the owner starts. Pre-match snapshots expose readiness, not kits.
- Match participant `selectedLoadout` stores the full locked kit, persisted at creation and revealed in
  `players[]` to all authorized players and spectators. `timedRounds.unlockedTier` announces each round's unlock
  (null on gap rounds); `incrementSeconds` is that round's actual increment. `KIT_REVEAL` is the initial hold;
  the existing `loadoutSelectionEndsAt` field now carries only its 10-second deadline. No pick endpoint remains.
- Submission rules use the authoritative full kit. Segment requests carry only the unlocked combat subset.

### Not adopted

- **Larger pools (choosing a subset during the match):** with more options than slots, a player always adapts and
  never commits, which removes identity. A single flex slot (a pool of 4, use 3) is a fallback if matches between
  the same two kits play out identically. Don't add it at launch.
- **Choosing the unlock order:** with one ability per tier, the order is fixed by tier. That makes every unlock
  predictable, which is the point: the question is how the opponent's brain uses it, not whether it arrives.

## 4. Rounds (server and shared engine built)

Six 15-second segments (90 seconds total) of one continuous fight, as today. Odd rounds unlock the next slot of the kit; even rounds
add nothing.

| Round | Unlock | Clock increment | Purpose |
|---|---|---|---|
| 1 | Weapon + Tier 1 | +45 s | Opening: load a saved brain, adjust it for the opponent's kit |
| 2 | — (gap) | +30 s | Fix what the round 1 segment showed |
| 3 | Tier 2 | +45 s | Bring in the second ability |
| 4 | — (gap) | +30 s | Fix how it was used, and answer theirs |
| 5 | Tier 3 | +45 s | The ultimate; the zone starts closing |
| 6 | — (gap) | +30 s | Finale: pure adaptation |

### Why gap rounds

- **The read stays valid.** In a gap round, the kit you just watched is the kit you'll face.
- **Changes have visible reasons.** The only reason to change a brain in a gap round is what happened in the last
  segment, which both players watched. So the opponent's likely fix can be guessed ("their Sniper kept missing
  because I dashed on the wind-up, so they'll wait out my Dash"). That is reading, not hoping.
- **Rhythm:** introduce an ability, then sharpen it. Easy to explain to a beginner.

### Why no edit budget

A per-round edit budget would guarantee continuity, but it feels artificial and punishes beginners who need a
bigger fix. Gap rounds remove the *reason* to rewrite everything, and the clock acts as a soft budget: a full
rewrite in round 4 spends time needed for the ultimate in round 5. A player who does rewrite everything has made a
real decision with a real cost, and the replay shows it.

**Fallback if playtests show constant full rewrites in gap rounds:** an edit budget on gap rounds only.

### Unlock behavior

- Abilities unlock automatically at the start of the build for their round. There is no pick phase, so each
  round's fixed overhead shrinks by the pick time (30 s in round 1, 20 s after, today).
- Round 1 holds both revealed kits for exactly 10 seconds, outside the clock. Later rounds enter build immediately.
- A short reveal banner ("Round 3: Red unlocks Silence Pulse, Blue unlocks Reflect") replaces the pick.
- The newly unlocked ability starts ready, as a newly picked one does today.

## 5. Saved brains and snippets

This reverses the timed-rounds doc's "prepared module libraries were not adopted" (section 7) and "Templates: not
now" (section 5b).

### Why

In chess, playing a memorized opening costs about a second per move: the clock punishes thinking in unfamiliar
positions, not recall. Rebuilding a spacing routine by hand costs minutes of dragging nodes. That measures UI
speed, not knowledge, and it's the same routine in every match. The fair translation of chess is: **cheap to
reproduce what you know, expensive to deal with what you don't.**

The "opening theory" of this game is **matchup knowledge**: which small change matters against which opposing
ability ("against Reflect, don't fire the Sniper while it's up"). A beginner knows one or two such adjustments; an
expert knows many and knows the tricks. Templates move the skill gap from "who rebuilds faster" to "who knows more
about this matchup", which is the gap we want.

The game goes "out of book" when the opponent's bot does something the prepared brain didn't anticipate, usually
visible in the round 1 replay. From then on it's reading and adapting.

### What can be saved

- **Saved brains:** a whole brain, usually written for one kit. Loaded at the start of round 1.
- **Snippets:** saved brain fragments (for example "Sniper dodge", "anti-Reflect hold", "kite at 250"), inserted
  during any build. Snippets carry matchup theory best: experts have more of them and know which to combine
  against a given kit.
- References to abilities outside the current kit behave as today ("Ability not equipped").

### Starters (the skill floor)

With about 4 × 11 × 10 × 5 ≈ 2,200 possible kits, there can't be a starter brain per kit. Instead:

- **One public starter brain per weapon**, written generically ("if any ability slot is ready and the target is
  in its range, use it"), so it works with any abilities.
- **Public snippets per ability**, for using it and for answering it ("if they have a Sniper, try this").
- A new player's first match: pick a kit, load the starter, watch round 1, make one change. The tutorial becomes
  "this bot loses to that one; fix it with one change".

### Server rules

- Saved brains and snippets are stored user content. Validate them against the brain schema when saved **and**
  when a brain containing them is submitted. Nothing is trusted because it was saved.
- Enforce row ownership on every read and write of the library. Players can only load their own items and the
  public starters.
- Bound library size per user and snippet size (snippets count toward the normal brain budget once inserted).
- The match still stores the actual brain submitted each round, so re-simulation and audits never depend on the
  library.

## 6. Clock (built)

| | Value |
|---|---|
| Base | **3:00 in 1v1, 4:00 in 2v2**; custom base remains 30 seconds to 10 minutes (default 5:00) |
| Increment | +45 s on unlock rounds (1, 3, 5), +30 s on gap rounds (2, 4, 6), at the start of each build |
| Maximum build time | Base + 3:45 (6:45 in 1v1, 7:45 in 2v2) |

- Custom increment is the gap-round value (0�60 s); unlock rounds add another 15 s.
- **Why 30 s on gap rounds, not less:** a player who has used up their base clock must still be able to make one
  real change in every round. 20 s is barely enough to open the editor. 30 s is a penalty for spending too long
  earlier, but never leaves a player unable to act.
- **Why 45 s on unlock rounds:** wiring in a new ability (or checking that the saved brain already handles it)
  needs a little more time.
- Everything else about the clock (server-owned deadlines, submit is final, fallback on timeout, AFK protection)
  is unchanged. With a saved brain written for the whole kit, a timeout fallback still plays the unlocked ability
  sensibly.
- Log clock use per round from the first playtests, as the timed-rounds doc already says.

## 7. Sparring (later, only if playtests ask for it)

During a build in a rated match, a player can run their draft brain against **the opponent's last-submitted brain**
and watch the result. Ship the format without it; add it only if players say they can't tell whether a fix works.

- **Why:** it turns each build into the fixed-opponent puzzle (beat this deterministic bot). The opponent knows
  sparring exists, so they have to change something, and gap rounds make their likely fix guessable.
- **Nothing to configure.** It always starts from the frozen position (where the real next segment starts) and runs
  the full segment or until a KO. Custom situations belong in the practice arena.
- **The server runs it and returns an ordinary replay.** The opponent's brain never reaches the client. Spar
  replays must never include a logic trace or decision callouts for the opponent's bot.
- **Cost:** the same brain-schedule re-run as a real segment, with the draft as the last brain (at most 900
  ticks, roughly 300–400 ms on the Node worker). It runs on the player's own clock.
- **Limits:** a per-round counter on the server (e.g. 5), one spar in flight per player, build phase only. The
  clock is the real limit: watching a spar costs 10–15 s, a real choice on a +30 s gap round.
- **Server checks:** validate the draft like a submission, match membership, phase, counter. Nothing is stored but
  the counter, and spars never affect the match.
- Until then, today's build-phase preview (the opponent as a stationary dummy) stays.

## 8. Balance

- **Tiers keep balance cheap.** Each tier is a pick-one slot, so an ability only has to compete with the other
  abilities in its tier.
- **Every tier should cover every role** (damage, control, mobility/defense, zone/trap), so identities form across
  tiers (trapper, duelist, kiter). Today tier 1 is mostly damage, with little mobility or defense, and tier 3 has
  only about 5 abilities, so new content should go there first. Aim for 6–8 per tier.
- **Simulation harness:** all ~2,200 kits against each other is about 4.8 million pairs (around 400 CPU-hours at
  ~300 ms per match). Instead:
  - per-slot tests: swap one ability at a time against a fixed baseline kit and reference brains;
  - sampled kit pairs, to catch combinations that break things together.
- A meta will form. That's healthy as long as it isn't solved; hidden brains keep it from being solved.

## 9. Spectating

- Both kits shown from the start, with locked slots greyed out until their round.
- After each build, a summary of what changed (as today).
- The unlock banner at the start of rounds 1, 3 and 5.

## 10. What would change in code

Verify current code before acting on any of this.

- **Round draft table:** `ROUND_ABILITY_UNLOCK` in `shared/engine/loadout/BotLoadout.js` and
  `MatchLoadoutService` on the server: offers and picks are replaced by "unlock your kit's slot for this tier" on
  odd rounds, and nothing on even rounds. Keep both runtimes in parity.
- **Validation:** the offered-ability allowlist becomes a kit allowlist (weapon + one ability per tier, each from
  the right tier, locked before the match). Decide whether a brain may reference kit abilities that aren't unlocked
  yet; this is a validation-contract change, needs parity, and the sim must treat them as unavailable.
- **Match flow:** a kit-lock step before the match, a kit reveal, no pick phases, and per-round increments.
- **Library:** new persistence for saved brains and snippets with ownership, validation and size limits; load and
  insert in the editor.
- **Persistence and determinism:** unchanged. Store each round's submitted brain, the kits and the seed.
- **Rules:** six segments, KO or HP decision after round 6. `AGENTS.md` stays valid.

## 11. Open decisions

- Base clocks and increments are implemented as specified in section 6.
- Sparring (section 7): whether playtests show it's needed, and the run cap.
- Brains may reference any kit ability; locked actions remain unavailable until unlocked.
- Kits lock with the queue request or custom-lobby readiness.
- Whether brains are revealed after the match (helps learning, costs some prep advantage).
- Flex slot later, if matchups feel repetitive.
- A casual mode with today's random offers (like League's ARAM): variety, no prep advantage.
- 2v2 uses an independent kit per player and a 4:00 base clock.
