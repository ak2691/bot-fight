// The card menu's items. Pure: for "+ Card" it lists one lane's actions (ability cards as tiles, the rest as rows) and
// the ready-made cards for that lane; for "Add follow-up" and a swap it can list every lane; a swap lists only the
// actions that fit the card (laneEdits.actionFitsCard). Search is menuModel.js.
import { BOT_CODE_ACTIONS } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { LANE_SPECS } from "./laneView.js";
import { sectionOfHead } from "./laneEdits.js";
import { filterItems } from "./menuModel.js";

const PLAIN_NAMES = Object.freeze({
    [BOT_CODE_ACTIONS.MOVE_WALK]: "Walk",
    [BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET]: "Face",
    [BOT_CODE_ACTIONS.CANCEL_WINDUP]: "Cancel wind-up",
    [BOT_CODE_ACTIONS.VARIABLE]: "Set variable",
});

const PLAIN_DESCRIPTIONS = Object.freeze({
    [BOT_CODE_ACTIONS.MOVE_WALK]: "Walk toward a target, to a point, or in a direction",
    [BOT_CODE_ACTIONS.ROTATE_TOWARD_TARGET]: "Turn to face the enemy, a point or an angle",
    [BOT_CODE_ACTIONS.CANCEL_WINDUP]: "Stop an ability that is winding up",
    [BOT_CODE_ACTIONS.VARIABLE]: "Set one of your custom variables",
});

/** The actions of one section (Movement, Actions, Variables), as menu items. `actionTypes` is the loadout's (actionTypesForLoadout). */
export function laneActionItems(actionTypes, lane) {
    return actionTypes
        .filter((action) => action.id !== BOT_CODE_ACTIONS.NONE && sectionOfHead(action.head) === lane)
        .map((action) => {
            const ability = action.abilityId != null ? abilityDefinition(action.abilityId) : null;
            return {
                kind: "action",
                id: `action:${action.id}`,
                actionId: action.id,
                lane: sectionOfHead(action.head),
                head: action.head,
                abilityId: action.abilityId ?? null,
                name: ability?.label ?? PLAIN_NAMES[action.id] ?? action.label,
                description: ability?.summary ?? PLAIN_DESCRIPTIONS[action.id] ?? "",
                keywords: [],
            };
        });
}

/**
 * The ready-made cards of the given lanes, as menu items. A template's name is its action; its description is its
 * conditions ("distance to Opponent 1 ≤ Slash range"), or "Always".
 */
export function readyMadeItems(templates, actionTypes, lanes) {
    const names = new Map(actionTypes.map((action) => [action.id, action]));
    return templates
        .filter((template) => lanes.includes(template.lane))
        .map((template) => {
            const action = names.get(template.actionId);
            const ability = action?.abilityId != null ? abilityDefinition(action.abilityId) : null;
            const conditions = template.sentence.replace(/^When /, "").replace(/ → .*$/, "");
            const description = template.sentence.startsWith("Always") ? "Always" : conditions.charAt(0).toUpperCase() + conditions.slice(1);
            return {
                kind: "template",
                id: `template:${template.id}`,
                template,
                actionId: template.actionId,
                lane: template.lane,
                head: action?.head ?? null,
                abilityId: action?.abilityId ?? null,
                name: ability?.label ?? PLAIN_NAMES[template.actionId] ?? action?.label ?? "Card",
                description,
                keywords: template.words ?? [],
            };
        });
}

/** The lane rail: each lane with the count of its actions that match the query and fit. */
export function laneRail(actionTypes, query, fits = () => true) {
    return LANE_SPECS.map((spec) => ({
        lane: spec.lane,
        title: spec.title,
        tone: spec.tone,
        count: filterItems(laneActionItems(actionTypes, spec.lane).filter((item) => fits(item.actionId)), query).length,
    }));
}

/**
 * The menu's content for the lanes it shows (one lane, or all of them while a follow-up or swap searches): the matching
 * actions and, when `withTemplates`, the matching ready-made cards. `fits(actionId)` drops actions a swap cannot take.
 */
export function cardMenuContent({ actionTypes, templates = [], lanes, query = "", fits = () => true, withTemplates = true }) {
    const actions = lanes.flatMap((lane) => laneActionItems(actionTypes, lane)).filter((item) => fits(item.actionId));
    const ready = withTemplates ? readyMadeItems(templates, actionTypes, lanes).filter((item) => fits(item.actionId)) : [];
    return {
        actions: filterItems(actions, query),
        ready: filterItems(ready, query),
    };
}

/** The section an opening menu starts on: the given one, else the section of the card's action (or Movement). */
export function defaultLane(lane, actionHead = null) {
    if (lane) return lane;
    const section = sectionOfHead(actionHead);
    return LANE_SPECS.some((spec) => spec.lane === section) ? section : LANE_SPECS[0].lane;
}
