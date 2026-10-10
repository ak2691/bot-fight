# 09 Social and Progression

## Friends

- Add by username or invite link; requests must be accepted. Blocked users can't send requests, challenges or
  invites.
- **Activity feed:** friends' cup results, trophies, gauntlet medals, newly published bots, and challenges they
  sent you.
- **Friends leaderboards** for the Daily Gauntlet, Builder Rating and the current cup.

## Challenges

The everyday way to play with friends. Asynchronous: nobody needs to be online.

1. Pick a friend, then one of **your** bots (a version) and one of **their challengeable** bots (each player
   chooses which bots friends may challenge; by default, their main bot).
2. Pick the rules:
   - a **preset**: this week's cup rules, season default, Sumo, Featherweight, Ice Rink…;
   - or **custom**: any arena from the pool or a generator seed, plus up to three knob changes (weight cap, grip,
     fight length, one banned weapon, hazards on or off).
3. Pick a format: single game, best of 3 or best of 5.
4. Optional **Mirror match:** both sides use the same build (yours or theirs) with their own brains. A pure
   programming duel.
5. The server runs it; both players are notified with the replay (each sees only their own brain trace).

**Rivalry record:** your win–loss against each friend, per format, shown on both profiles. **Rematch** reruns with
each side's latest version. Limit: 30 challenge games a day per player.

## Scrim rooms (after the MVP)

For friends who want to be together at the same time:

- A live room for up to 8 players. The host sets the rules and the format (round-robin or bracket); everyone
  submits a bot; the server runs every game.
- **Watch party:** synchronized playback (the host controls it) with emoji reactions.
- **Blitz Build:** a party mode that revives the old timed format for fun. Everyone gets a surprise constraint
  ("Featherweight, hammers only") and 5, 10 or 15 minutes to build or modify a bot; then the tournament runs and
  everyone watches together.

Rooms use the realtime channel ([10](10-architecture.md#realtime)); today's custom-lobby code is a starting point.

## Clubs (later)

Groups for schools, classes and friend circles: a club leaderboard, **private cups** (their own schedule, arena and
twists, run by the same cup service), and a shared club bot library where members can study each other's code.

## Sharing

- **Replay pages** with shareable links (subject to visibility rules, [08](08-competition.md#visibility)).
- **Commentary captions** generated from engine events: "BUZZSAW lands a 28-damage hit!", "ANVIL shoves VOLTA into
  the pit!".
- **Highlights:** the top moments of a game (biggest hit, launches, pit or ring-out KOs, comebacks), picked
  automatically, as a 30-second "watch highlights" view.
- **Finals Premiere page:** bracket animation, bot intro cards (name, owner, build card, record, signature stats),
  emoji reactions. No free-text chat, so no moderation load.
- **Bot cards:** an image of a bot's build, stat bars, record and trophies, shareable anywhere.
- **Publishing:** after a cup ends, an owner can publish a bot version to the **Archive**: its build and brain become
  visible, sparrable in the sandbox, and **forkable** into anyone's garage as a copy that shows "forked from …".
  Forks are allowed in contests: the bot was public only after its cup, and next week's twist means it still needs
  work.
- **Pick'em (later):** predict the finals for fun points and a badge.

## Progression

Nothing in progression adds competitive power. Every part is available to everyone; progression gives identity,
convenience and goals.

### Builder level and XP

| Source | XP |
|---|---|
| Academy mission, first clear | 50 |
| Daily Gauntlet: first submission of the day | 20 |
| Daily Gauntlet medal | Bronze 10 · Silver 20 · Gold 40 · Platinum 60 |
| Cup entry | 100 |
| Cup match | win 20 · draw 10 |
| Cup top 8 / winner | +150 / +300 |
| Challenge game | 5 (max 10 a day) |
| Ladder game | 2 (max 20 a day) |

Level `n` → `n + 1` needs `100 + 50 × n` XP. **Unlocks:** garage slots (3 at the start, up to 10 by level 20),
paints, decals, nameplate frames and title cards.

### Bot careers

Every bot keeps its own record: games, wins, KOs by type (KO, pit, ring-out), damage dealt and taken, signature
counts (spinner hits, pins, flips, grabs, ring-outs), its biggest hit, and its cup history. Trophies appear on the
bot card: Cup Champion (with the week), Finalist, Top 8, Gauntlet Platinum count.

### Achievements

| Achievement | Condition |
|---|---|
| First Blood | Land your first weapon hit in any game |
| Pit Boss | Win by pit KO |
| Into the Saws | The opponent takes 30+ hazard damage in one game |
| Flawless | Win a cup or gauntlet game taking no damage |
| Air Mail | Flip an opponent into a wall |
| Lockdown | Hold an opponent for the full 3 s |
| Spin Doctor | Deal 28+ damage in one spinner hit |
| Hammer Pin Combo | Ram an opponent while it's pinned |
| Comeback | Win after trailing by 100+ damage |
| Featherweight | Win a cup match with a bot under 70 kg |
| Architect | Win a cup match with a brain using 5+ modes |
| Giant Slayer | Beat a player rated 300+ above you in a cup |
| Regular | Enter 4 cups in a row |
| Streak 7 / 30 | 7 / 30-day gauntlet streaks |
| Rival | Play 10 challenges against the same friend |
| Published | Have a published bot forked 10 times |

### Season badges

At the end of a season you keep a badge for the highest title you held during it, plus the number of cups you
entered and your best placement.

## Academy

The tutorial, as missions against house bots. Each takes 2–5 minutes, runs in the browser sandbox, and is
verified on the server (the worker re-simulates the submitted bot against the mission) before XP is granted.

| # | Mission | Goal | Teaches |
|---|---|---|---|
| 1 | **Test Drive** | Drive through the gates by keyboard | Drivetrains, weight, physics feel |
| 2 | **First Rule** | Touch the dummy | The Move lane, Approach |
| 3 | **Swing** | Hit the dummy 3 times | Weapon lanes, zones, Arm |
| 4 | **Where Did It Go?** | Find a dummy hiding behind pillars | Rangefinders, detection, last known position |
| 5 | **Sweep the Floor** | Push a crate into the pit | Pushing, Line up, hazards |
| 6 | **Two Minds** | Survive an aggressive bot by retreating when hurt | Modes and switches |
| 7 | **Hit and Run** | Hammer, back off, repeat | Timed switches |
| 8 | **Read the Spinner** | Attack a spinner only when it's spun down | The camera, charge |
| 9 | **Know Your Enemy** | Beat two different house bots with one brain | Start rules, build readings |
| 10 | **Graduation** | Beat the Rookie Champion house bot | Everything; then "enter your first cup" |

Every mission starts from a preset with a partly written brain, so the player always edits rather than starts from
nothing. Presets and their starter brains stay available afterwards ([02](02-building.md#presets)).

## What brings players back

| Hook | Rhythm |
|---|---|
| Daily Gauntlet and streaks | Daily |
| Cup brief, lock, twist, results, finals | Weekly beats, each with a notification |
| Ladder and challenge results | Continuous |
| Rivalries and the friends feed | Social |
| Seasons: new arenas, rotations, badges | Every 6 weeks |

## Communication and safety

- No free-text chat at launch: emoji reactions only. The community lives on Discord.
- Usernames, bot names and decal text pass a filter and can be reported; blocks apply everywhere.
- The existing chat-moderation module stays dormant until a text surface returns
  ([`../GAMEPLAY_OVERHAUL_MIGRATION.md`](../GAMEPLAY_OVERHAUL_MIGRATION.md)).
