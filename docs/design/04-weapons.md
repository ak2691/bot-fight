# 04 Weapons

Melee only. Four mounted weapons plus the wedge fitting, each taken from real robot combat, each using the
physics rather than fighting it, and each with a visible tell and a clear counter.

## Shared rules

### Zones

A weapon acts on a **zone**: a non-solid rectangle attached to a face, extending outward. A zone "contains"
the opponent when it overlaps the opponent's body rectangle. Zones are drawn in the garage preview and in
replays (on request).

| Weapon | Zone (beyond the face) | Width |
|---|---|---|
| Spinner | 0.30 m | face width + 0.10 m |
| Hammer | 0.60 m beyond the face it swings over | face width |
| Flipper | 0.25 m | face width − 0.10 m |
| Clamp | 0.20 m | face width − 0.10 m |

Because bodies are solid and stop on contact, an opponent touching a face is inside that face's zone.

### States, readiness and charge

Every weapon is a small state machine updated every physics step. A weapon is **ready** when it is in its
ready state and the battery has enough charge for its next action. Brain actions that can't be done right
now (not ready, not enough charge) are skipped, and the lane falls through to its next rule
([06](06-programming.md#lanes)).

### Fire, Arm, Hold

Brains decide 10 times a second, but at 9 m/s of closing speed an opponent crosses a 0.3 m zone in 33 ms.
So the trigger-style weapons have two ways to attack:

- **Fire** (or Swing, Grab): act now.
- **Arm:** act automatically, at physics rate, the instant the opponent is in the zone, for as long as this
  rule stays the lane's chosen action. This is how real autonomous robots trigger weapons (a contact switch),
  and it means timing is decided by the player's conditions, not by luck of the brain tick.
- **Hold:** don't act.

Spinners hit on contact by themselves; their actions control spin.

### Damage

All weapon damage goes through the pipeline in [03](03-physics.md#damage): face modifiers, ruleset
multiplier, minus the plate on the face hit (except clamp crush), minimum 1.

## Spinner

A heavy bar spun up to store energy, released in one hit. The iconic, dangerous, high-maintenance weapon.

| Property | Value |
|---|---|
| Weight / mount | 20 kg, occupies a face |
| Stored energy | 0 to 3500 J |
| Spin up | 0 → full in 2.5 s (1400 J/s), costs 10 charge/s; holding at full costs 1 charge/s |
| Coast | No command: loses 3% of max energy per second, no charge |
| Brake | Stops in 0.5 s, no charge |
| Active | Hits only with at least 15% energy (525 J) |
| Hit | Opponent in the zone, at most once per 0.25 s |

**On a hit:**

```
ΔE      = 0.4 × E                          energy delivered
damage  = 0.02 × ΔE                        full spinner: 0.4 × 3500 = 1400 J → 28 HP
impulse = 0.9 × sqrt(2 × μ × ΔE)           μ = reduced mass of the two bots
          direction: the face's outward normal, turned 30° toward the spin direction (spinners fling sideways)
target  +impulse; spinner bot −impulse (recoil)
E       = E − ΔE
on a wedge face: damage × 0.5 and impulse × 0.5 (the energy is still lost)
```

Two 90 kg bots, full spinner: 28 damage, and both bots are knocked back at about 3.5 m/s. A second hit right
away carries 60% energy: about 17 damage.

**Gyroscopic effect:** while above 50% energy, the bot's turn cap is × 0.6. A spun-up spinner is slow to turn.

| | |
|---|---|
| **Actions** | Spin up · Coast · Brake |
| **Own readings** | Spinner energy (%) |
| **Camera tell** | Spinner speed (%) and whether it faces you |
| **Strengths** | Biggest single hits; knockback breaks grabs and wind-ups |
| **Weaknesses** | 2.5 s spin-up after a big hit; recoil; slow turning while spun up; wedges blunt it |
| **Tuning knobs** | Max energy, spin-up time, transfer fraction, damage factor, impulse factor, gyro factor, charge costs |

## Hammer

An overhead axe on the roof, swinging over one face. Slow, visible, decisive, and it pins.

| Property | Value |
|---|---|
| Weight / mount | 15 kg, roof, swings over a face without a face weapon |
| Cycle | Ready → wind-up 0.5 s → strike → recovery 1.0 s → ready |
| Charge | 12, taken when the wind-up starts |
| Strike | The zone is checked once, on the strike step |
| Damage | 30 (plates apply; wedges don't deflect overhead hits) |
| On hit | Target **pinned** for 0.4 s: no drive, no steering |

Arming starts the wind-up the instant the opponent enters the zone; the strike still lands 0.5 s later, so a
target that's quick to leave makes it whiff. The pin is the hammer's real value: 0.4 s is enough for a ram, a
push into a hazard or a second weapon.

| | |
|---|---|
| **Actions** | Swing · Arm · Hold |
| **Own readings** | Hammer ready |
| **Camera tell** | Winding up / striking ("attacking"), and whether it's over the face toward you |
| **Strengths** | Big hits that ignore wedges; pins set up combos; pairs naturally with a wedge front |
| **Weaknesses** | 0.5 s wind-up warns cameras; whiffs against fast or knocked-back targets |
| **Tuning knobs** | Wind-up, recovery, damage, pin time, zone length, charge |

## Flipper

A pneumatic plate that throws whatever is on it. Little damage, huge consequences: walls, saws, the pit.

| Property | Value |
|---|---|
| Weight / mount | 13 kg, occupies a face |
| Cycle | Ready → fire (instant) → retract 1.2 s → ready |
| Charge | 18 per fire, even if it misses |
| Fire | If the opponent is in the zone and not airborne, launch it |
| Launch | Horizontal impulse 450 N·s along the face normal: throw speed = 450 ÷ target mass (max 8 m/s) |
| Airtime | 0.4 + 30 ÷ target mass seconds, between 0.4 and 1.0 s |
| Damage | 4 on launch; landing damage 10 × airtime (ignores plates); plus any wall impact while airborne |
| Recoil | 30% of the impulse back onto the flipper bot |
| Lip | The flipper face lifts like a weak wedge on head-on contact: grip × 0.5 for 0.3 s |

A 90 kg target flies at 5.0 m/s for 0.73 s (about 3.7 m); a 60 kg target at 7.5 m/s for 0.9 s. Into a wall, the
impact adds ram damage at that speed; over an open pit, it's a KO.

| | |
|---|---|
| **Actions** | Fire · Arm · Hold |
| **Own readings** | Flipper ready |
| **Camera tell** | Flipper facing you (it's instant, so the face is the only warning) |
| **Strengths** | Turns position into damage via walls, saws and the pit; launched bots lose 0.4–1 s |
| **Weaknesses** | Charge-hungry; weak against heavy bots; low direct damage; wedges get under it first |
| **Tuning knobs** | Impulse, airtime formula, retract time, charge, lip strength |

## Clamp

Jaws that grab, crush and carry. The control weapon.

| Property | Value |
|---|---|
| Weight / mount | 14 kg, occupies a face |
| Cycle | Open → closing 0.15 s → holding (up to 3 s) **or** miss → opening 0.3 s → cooldown 1.5 s → open |
| Charge | 10 when closing starts, then 4/s while holding |
| Grab | Succeeds if the opponent is in the zone when closing ends and isn't airborne |
| Holding | The pair moves as one body ([03](03-physics.md#grabs)); the target can't drive; its weapons still work if they can reach |
| Crush | 10 HP/s in 0.2 s ticks, **ignores plates** |
| Release | On Release, after 3 s, at 0 charge, if the holder is launched, or if the holder takes an impulse over 250 N·s (a spinner hit breaks the grip) |

| | |
|---|---|
| **Actions** | Grab · Arm · Release · Hold |
| **Own readings** | Clamp holding, clamp ready |
| **Camera tell** | Closing or holding ("attacking"), and whether the jaws face you |
| **Target reading** | Being held (built-in) |
| **Strengths** | Ignores plates; carries targets into hazards; shuts down mobility |
| **Weaknesses** | Needs front contact; slow while carrying; spinner hits break the grip |
| **Tuning knobs** | Close time, hold limit, crush rate, break-free impulse, charge |

## Wedge (fitting)

A sloped plate that gets underneath opponents. Passive: no mount, no charge, no lane.

| Property | Value |
|---|---|
| Weight | 8 kg, a face fitting |
| Plate | −4 per hit |
| Lift | On contact where the faces are roughly opposed (within 40°) and the opponent's face isn't a wedge or flipper: opponent grip × 0.25 for 0.4 s, refreshed while contact lasts |
| Spinners | Spinner hits on a wedge face do half damage and half knockback |

Wedge against wedge (or flipper): neither lifts; the push contest is decided by push force and weight.

## Matchup web

The intended relationships between weapons, each with two good and two bad matchups. Builds (plates,
drivetrain, weight, sensors) and brains shift every matchup; the balance harness checks that this web roughly
holds ([07](07-arenas-and-twists.md#vetting)).

| | vs Spinner | vs Hammer | vs Flipper | vs Wedge | vs Clamp |
|---|---|---|---|---|---|
| **Spinner** | — | **favoured** | unfavoured | unfavoured | **favoured** |
| **Hammer** | unfavoured | — | unfavoured | **favoured** | **favoured** |
| **Flipper** | **favoured** | **favoured** | — | unfavoured | unfavoured |
| **Wedge** | **favoured** | unfavoured | **favoured** | — | unfavoured |
| **Clamp** | unfavoured | unfavoured | **favoured** | **favoured** | — |

Why:

- **Spinner > Hammer:** the hammer must stand in range through a 0.5 s wind-up; one spinner hit knocks it out of
  position and the swing whiffs.
- **Spinner > Clamp:** the clamp needs front contact, and contact with a spinning weapon means a hit and
  knockback before the 0.15 s close finishes (and hits break grips).
- **Wedge > Spinner:** wedge faces halve spinner hits, and the lift lets the wedge push the spinner bot into a
  wall while it spins back up.
- **Flipper > Spinner:** a spun-up spinner turns slowly (gyro), so the flipper reaches its side and throws it.
- **Hammer > Wedge:** a wedge must drive straight in to push; the hammer swings over the wedge and pins it.
- **Hammer > Clamp:** a clamp that grabs from the front is holding itself under the hammer's strike zone.
- **Flipper > Hammer:** the hammer's wind-up gives the flipper half a second to fire; a launched hammer bot whiffs.
- **Wedge > Flipper:** both want to get underneath; the wedge's lift is stronger, so the flipper loses traction
  before it can line up.
- **Clamp > Wedge:** wedges come straight at you; the clamp grabs on contact (lift doesn't stop a grab) and carries
  the wedge to a hazard.
- **Clamp > Flipper:** grabbing from the side keeps the flipper's plate pointed away from you.

## Interactions worth knowing

- **Pin combos:** hammer pin (0.4 s) → ram with boost, or push into a saw.
- **Breaking a grab:** any hit with impulse over 250 N·s frees a held bot; spinners do this naturally.
- **Throw into geometry:** a flip toward a wall turns a 4-damage flip into 20–30 total.
- **Spinner recoil:** light spinner bots bounce far after hits; heavy ones stay in place to hit again.
- **Charge starvation:** two weapons plus boost plus a camera can drain a Small battery in seconds.
- **Turning the camera off** saves charge for swings.

## Later weapons (the vault)

Built after the MVP and rotated in by season ([07](07-arenas-and-twists.md#rotation)):

| Weapon | Idea |
|---|---|
| **Drum** | A small vertical spinner: less damage than a spinner, launches targets briefly |
| **Saw** | Continuous low damage while touching; cheap and reliable |
| **Shell spinner** | The whole body spins: every face is a weapon, but it can't push or use plates |
| **Lifter** | Lifts the opponent's front to remove their traction, then pushes |
| **Self-righter** | Needed once upside-down states exist |
