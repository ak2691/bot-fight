import assert from "node:assert/strict";
import test from "node:test";
import { ACTION_BY_ID, ACTION_HEADS, BOT_CODE_ACTIONS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { attachedFaceAimFields, defaultAimFields, defaultLeadAbilityId, leadAbilityChoices } from "./aimDefaults.js";
import { setAttachedAction } from "./laneEdits.js";
import { createLanesStarter } from "./laneStarter.js";
import { actionTileLabel, applyEditorField, editorFields } from "./actionEditorModel.js";

// Catalogue facts these tests rely on: 22 Orbital Strike is an ability aimed at an entity (targetMode "target") with no
// projectile; 5 Fireball is a projectile that fires along facing (no targetMode); 1 Slash is melee (no targetMode).
const AIMED = 22;
const FIREBALL = 5;
const SLASH = 1;
const SNIPER = 3;

/** A definition as the action contract gives it, with the aim flag a projectile that aims at an entity would carry. */
const aimedAbility = (abilityId) => ({ ...ACTION_BY_ID.get(abilityId), abilityId, targetMode: "target", head: ACTION_HEADS.ABILITY });

test("an entity-aimed projectile ability defaults to Auto, leading by itself; melee and hitscan keep Current", () => {
    assert.deepEqual(defaultAimFields(aimedAbility(FIREBALL)), { aim: "auto", leadAbilityId: FIREBALL });
    assert.deepEqual(defaultAimFields(aimedAbility(SLASH)), {}, "Slash has no projectile, so it keeps Current");
    assert.deepEqual(defaultAimFields(aimedAbility(AIMED)), {}, "an aimed ability with no projectile keeps Current");
    assert.deepEqual(defaultAimFields(ACTION_BY_ID.get(FIREBALL)), {}, "a projectile that fires along facing has no aim");
    assert.deepEqual(defaultAimFields(ACTION_BY_ID.get("move-walk")), {}, "a movement action has no aim");
    assert.deepEqual(defaultAimFields(undefined), {});
});

test("the Aim field offers Current, Lead and Auto for an entity-aimed ability; Auto stores the ability id", () => {
    const definition = ACTION_BY_ID.get(AIMED);
    const fields = editorFields({ action: AIMED }, definition);
    const aim = fields.find((field) => field.key === "aim");
    assert.deepEqual(aim.options.map((option) => option.id), ["current", "lead", "auto"]);
    assert.equal(aim.value, "current");

    const auto = applyEditorField({ action: AIMED }, definition, "aim", "auto");
    assert.deepEqual([auto.aim, auto.leadAbilityId], ["auto", AIMED]);
    assert.equal(editorFields(auto, definition).find((field) => field.key === "aim").value, "auto");

    const lead = applyEditorField(auto, definition, "aim", "lead");
    assert.equal(lead.aim, "lead");
    assert.equal("leadAbilityId" in lead, false);
    assert.equal(lead.leadSeconds, 0.5);
    assert.equal(editorFields(lead, definition).some((field) => field.key === "leadSeconds"), true, "Lead reveals its seconds box");

    const current = applyEditorField(auto, definition, "aim", "current");
    assert.equal("aim" in current, false);
    assert.equal("leadAbilityId" in current, false);
});

test("an ability that does not aim at an entity shows no Aim field, and the tile label stays the ability name", () => {
    assert.equal(editorFields({ action: FIREBALL }, ACTION_BY_ID.get(FIREBALL)).some((field) => field.key === "aim"), false);
    assert.equal(actionTileLabel({ action: FIREBALL }, ACTION_BY_ID.get(FIREBALL)), "Fireball");
});

const FACE = BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET;
const WALK = BOT_CODE_ACTIONS.MOVE_WALK;

test("the lead choices are the loadout's projectile abilities only, in loadout order, named", () => {
    assert.deepEqual(leadAbilityChoices([SLASH, SNIPER, FIREBALL]), [{ id: FIREBALL, label: "Fireball" }]);
    assert.deepEqual(leadAbilityChoices([SLASH]), []);
    assert.deepEqual(leadAbilityChoices(), []);
});

test("Auto leads with the card's own projectile, else the first choice, else nothing", () => {
    const choices = [{ id: FIREBALL, label: "Fireball" }];
    assert.equal(defaultLeadAbilityId(FIREBALL, choices), FIREBALL);
    assert.equal(defaultLeadAbilityId(SLASH, choices), FIREBALL);
    assert.equal(defaultLeadAbilityId(SLASH, []), null);
});

test("an attached Face on a projectile card starts on Auto leading with that ability; other cards keep Current", () => {
    assert.deepEqual(attachedFaceAimFields(FIREBALL), { aim: "auto", leadAbilityId: FIREBALL });
    assert.deepEqual(attachedFaceAimFields(SLASH), {});
    const starter = createLanesStarter([SLASH, FIREBALL]);
    const withFace = setAttachedAction(starter, "mode-main", "card-ability-5", "face", FACE);
    const fireball = withFace.modes[0].actions.find((card) => card.id === "card-ability-5");
    assert.deepEqual([fireball.face.aim, fireball.face.leadAbilityId], ["auto", FIREBALL], "Fireball + Face enemy aims ahead");
    const slash = setAttachedAction(starter, "mode-main", "card-ability-1", "face", FACE).modes[0].actions.find((card) => card.id === "card-ability-1");
    assert.equal(slash.face.aim, undefined, "Slash + Face keeps Current");
    const movement = setAttachedAction(starter, "mode-main", "card-ability-5", "move", WALK).modes[0].actions.find((card) => card.id === "card-ability-5");
    assert.equal(movement.move.aim, undefined, "an attached move has no aim");
});

test("a Face action's Aim offers Auto with a projectile picker only when the loadout has a projectile", () => {
    const definition = ACTION_BY_ID.get(FACE);
    const choices = [{ id: FIREBALL, label: "Fireball" }];
    const auto = { action: FACE, selectable: "opponent_1", aim: "auto", leadAbilityId: FIREBALL };
    const fields = editorFields(auto, definition, { leadAbilityChoices: choices });
    assert.deepEqual(fields.find((field) => field.key === "aim").options.map((option) => option.id), ["current", "lead", "auto"]);
    const picker = fields.find((field) => field.key === "leadAbilityId");
    assert.equal(picker.kind, "select");
    assert.equal(picker.value, FIREBALL);
    assert.deepEqual(picker.options, choices);

    const plain = editorFields({ action: FACE, selectable: "opponent_1" }, definition, { leadAbilityChoices: [] });
    assert.deepEqual(plain.find((field) => field.key === "aim").options.map((option) => option.id), ["current", "lead"], "no projectile, no Auto");
});

test("choosing Auto on a Face stores the default projectile; the picker stores its own choice", () => {
    const definition = ACTION_BY_ID.get(FACE);
    const current = { action: FACE, selectable: "opponent_1" };
    const auto = applyEditorField(current, definition, "aim", "auto", { defaultLeadAbilityId: FIREBALL });
    assert.deepEqual([auto.aim, auto.leadAbilityId], ["auto", FIREBALL]);
    assert.equal(applyEditorField(current, definition, "aim", "auto").aim, undefined, "no projectile to lead with, no change");
    assert.equal(applyEditorField(auto, definition, "leadAbilityId", FIREBALL).leadAbilityId, FIREBALL);
    assert.equal(applyEditorField(auto, definition, "leadAbilityId", "x").leadAbilityId, FIREBALL, "a bad id is refused");
});
