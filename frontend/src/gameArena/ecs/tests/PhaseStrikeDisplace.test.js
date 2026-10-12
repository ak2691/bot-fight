import assert from "node:assert/strict";
import test from "node:test";
import { resolveActivationVerbsForRoster } from "../../testing/pureTicks.js";

// Phase Strike (25) hits once on the activation tick: the nearest bot in its box is blinked through (a mirror displace)
// and damaged. The follow-up that strikes from behind is an attached entity 200 ms later (see the golden scenarios
// phase-strike-backstab and phase-strike-facing-counter), so the rest of the box is not touched on the tick.

// The bot faces +x (rotation 90). The act stage captures its pose before the hits run, so the capture is set here.
const attacker = {
    id: "owner", slot: 1, x: 100, y: 100, size: 60, rotation: 90, hp: 150, maxHp: 150,
    moveSpeed: 8, attackSpeedMultiplier: 1, attackDamageMultiplier: 1,
    abilities: [25], abilityState: {}, triggeredAbility: 25,
    hitboxOriginX: 100, hitboxOriginY: 100, hitboxRotation: 90,
};
const bot = (slot, x, y) => ({ id: `bot${slot}`, slot, x, y, size: 60, rotation: 270, hp: 150, maxHp: 150 });

test("Phase Strike blinks through the nearest bot and damages it once; the rest of the box is not hit on the tick", () => {
    const [owner, nearest, behind, outside] = resolveActivationVerbsForRoster([
        attacker,
        bot(2, 150, 100),
        bot(3, 160, 100),
        bot(4, 320, 100),
    ]);

    // The bot at 160 is inside the box, but only the nearest bot takes the activation hit.
    assert.equal(nearest.hp, 135, "the nearest bot takes one hit of 15");
    assert.equal(behind.hp, 150, "the bot behind it is left for the 200 ms follow-up");
    assert.equal(outside.hp, 150, "a bot outside the box is not touched");

    // The owner lands as far past the nearest bot as it stood from it: 50 units away, so 50 more along the line.
    assert.ok(Math.abs(owner.x - 200) < 1e-6, `owner lands at x 200, got ${owner.x}`);
    assert.ok(Math.abs(owner.y - 100) < 1e-6, `owner stays on the line, got y ${owner.y}`);
    assert.equal(owner.hp, 150, "the owner takes no damage from its own blink");
});
