# 07 Why this, fun and risks

## The new kind of strategy

In a normal RTS you decide what to do *now*. In Hotfix you decide **what your bots do whenever something
happens**, and you play against what your opponent decided their bots do whenever something happens.

1. **Thinking in policies.** A rule has to be right in every future situation it matches, not just the one in
   front of you. Mistakes are systematic rather than one-off, and an opponent can farm them.
2. **Playing against a policy, not a pair of hands.** The opponent's bots react the same way every time until
   their owner patches them. You can learn, predict and exploit them with a certainty you never have against a
   human clicking in StarCraft.
3. **The exploit window.** The time between finding a hole and its owner closing it is a new kind of tempo:
   exploit quietly or loudly, patch now or later, move first or second.
4. **Scouting minds.** Scouting in an RTS shows units. Here it shows rules: what the other player *thinks*
   should happen.
5. **No hands.** All the skill is understanding. It suits people who like strategy and puzzles but not reflex
   games.
6. **Automation frees attention.** The better your rules, the less you need to watch your own bots, and the more
   you can watch theirs. Good engineering pays twice.

## Compared with other games

| Game | How you control | When you can change it | Interaction between players |
|---|---|---|---|
| StarCraft II | Clicks | Constantly | Very high, but needs fast hands |
| Screeps (World) | JavaScript in a persistent world | Any time | Real, but over days |
| Screeps Arena | JavaScript, 1v1 matches | Before the match (asynchronous) | Between matches |
| Battlecode | Java, robot armies | Between matches, over a month | None within a match |
| Gladiabots | Visual AI tree for a squad; elimination, domination and collection modes | Between matches, as far as I can tell | Asynchronous |
| CodeGames (Manas.Tech) | A custom language for one spaceship | During the match | High, but typed code and niche |
| Autobattlers (TFT) | Drafting and placement | Between rounds | Medium |
| Final Fantasy XII gambits | Ordered "condition → action" rules | Any time | Single-player only |
| Botfight today | Behavior tree for one bot | Between segments, blind | Low |
| **Hotfix** | Rule cards for a crew of three | During the match, with limited deploys | High: read, exploit, patch |

Gladiabots is the closest well-known game: squads, a visual AI editor, a domination mode. Hotfix differs in
patching *inside* the match and in a reveal system that makes the opponent's rules readable. The one precedent I
found for live coding against another player during a match is CodeGames, which used a typed language. As far as
I can tell, no popular game makes "change your bots' minds during the match while your opponent does the same"
its core loop.

## Where the fun comes from

- **"Gotcha":** your trap closes on a rule you read. You outsmarted a person, not a puzzle.
- **"Saw it coming":** your patch answers theirs before it pays off.
- **Comebacks by thinking:** one good read can turn a match.
- **A story per match:** the patch history reads like a chess game's move list. "They rushed, I baited, they
  split, I took the Surge."
- **Expression:** your crew plays the way you think.
- **Learning from opponents:** every match ends with their revealed brain.

## Spectating

Deploys are natural moments for commentary: "Red just patched the Runner, two Move cards. Watch node C."
Spectators (with a delay) see both brains fill in live, like a chess broadcast showing the engine's line, plus
both scores, charges and patch histories.

## Risks

| Risk | Mitigation |
|---|---|
| Coding under live pressure feels like an exam | Starters, small patches, a calm opening, respawns, bots that keep working while you think. Measure stress first ([08](08-prototype-plan.md)) |
| Too much to watch | Small kits, three bots, role colors, the event feed, the replay buffer |
| Deploys used as a joystick | Charges, the upload delay, the 3-change cap, events faster than a deploy cycle |
| The game becomes "solve the opening" | Starters rotate by season; reveals make a brain that never changes exploitable within a match |
| Early leads decide matches | Short respawns, cheap kills, doubled late points ([03](03-crew-and-objectives.md)) |
| Turtling | Points need held nodes; Surges pull bots out |
| Reveals show too much or too little | Tune the stage thresholds; hide mode dots first |
| Players copy each other's revealed rules | Fine: that's learning, and rules only work in context |
| AI assistants write patches | Can't be stopped. The live pace limits how much they help; accept it, as the BattleBots design did |
| Live servers cost more than batch simulation | On 2026-10-08 a whole 120 s duel took 300–400 ms in Node: about 3 ms of CPU per second of play. Six bots might take 10 ms, so one core could host on the order of 100 live matches. Measure it |
| Phones | Live editing on a small screen is hard; start on desktop |
| Another rewrite after two changes of direction | Prove the fun with a prototype of a few days on the current engine, and stop if it isn't fun ([08](08-prototype-plan.md)) |

## When to stop

Drop or rethink the idea if early playtests show any of these:

- fewer than about 3 deploys per match, or most deploys don't answer anything the opponent did;
- most players call the match stressful rather than fun;
- the score at 2:00 usually decides the result;
- players spend most of the match in the editor and rarely look at the arena.

## References

| Source | What it informed |
|---|---|
| [Gladiabots](https://gfx47.itch.io/gladiabots) ([overview](https://www.gamingonlinux.com/articles/13958/), [mobile launch](https://pocketgamer.co.uk/gladiabots/gladiabots-is-an-ai-programming-and-robotic-combat-game-thats-heading-for-ios-la/)) | The closest well-known game: squads, visual AI, elimination / domination / collection, asynchronous multiplayer |
| [Screeps: Arena](https://www.gamingonlinux.com/2019/08/screeps-arena-an-upcoming-strategy-game-where-you-program-your-units-with-javascript/page=1/) | JavaScript 1v1 matches, played asynchronously |
| [CodeGames (Manas.Tech)](https://manas.tech/labs/code-games/), [talk](https://www.erlang-factory.com/eflba2017/gustavo-giraldez) | A niche precedent: two players live-code a spaceship's behavior during a match |
| [Integrating a Live Programming Role into Games (Tanimoto)](https://homes.cs.washington.edu/~tanimoto/site/wp-content/uploads/2024/10/Integrating-a-Live-Programming-Role-into-Games.pdf) | Research on giving a player a live-programming role. Found while researching, not read in full; worth reading before stage 2 |
| Final Fantasy XII gambits | The ordered rule-card model |
| Colonel Blotto | Splitting forces across nodes |
| Quake duel item timing | Timed power-ups as the map's rhythm |
| Kung Fu Chess | Real-time chess kept playable by per-piece cooldowns |
| Shelved BattleBots design (`git show newgameplayoverhaul:docs/design/06-programming.md`) | Modes, lanes, rules and maneuvers |
