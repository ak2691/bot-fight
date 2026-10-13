import { forwardRef, useCallback, useEffect, useImperativeHandle, useMemo, useRef, useState } from "react";
import "./lanes.css";
import { ACTION_BY_ID, ACTION_HEADS, ACTION_TYPES } from "../../../../../shared/engine/botlogic/code/contracts/BotLogicContracts.js";
import { MAX_LANE_MODES, MAX_LANE_CONDITIONS_PER_ENTRY } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { abilityDefinition } from "../../../../../shared/engine/loadout/BotLoadout.js";
import { actionTypesForLoadout } from "../../gameconfig/CombatLoadouts.js";
import { conditionSummaryLookups } from "../nodes/GraphNodes.jsx";
import {
    actionFitsCard,
    addCard,
    addCondition,
    addFollowUp,
    addMode,
    addSwitch,
    cardLocator,
    changeCardAction,
    deleteCard,
    deleteMode,
    deleteSwitch,
    duplicateCard,
    LaneEditError,
    locateCard,
    moveCard,
    moveCardToScope,
    moveMode,
    removeAttachedAction,
    removeCondition,
    renameMode,
    SHARED_SCOPE,
    setAttachedAction,
    setAttachedEntry,
    setCardAction,
    setSwitchAfterSeconds,
    setSwitchTarget,
    switchLocator,
    toggleCard,
    updateCondition,
} from "./laneEdits.js";
import AbilityDetailsPopover from "./AbilityDetailsPopover.jsx";
import { isSameMenuTarget } from "./menuModel.js";
import { defaultLeadAbilityId, leadAbilityChoices as leadAbilityChoicesOf } from "./aimDefaults.js";
import LaneCardRow, { ConditionTiles } from "./LaneCardRow.jsx";
import LaneConditionEditor from "./LaneConditionEditor.jsx";
import LaneConditionMenu from "./LaneConditionMenu.jsx";
import LaneCardMenu from "./LaneCardMenu.jsx";
import LaneMenu from "./LaneMenu.jsx";
import { buildQuickAddTemplates } from "./quickAdd.js";
import { actionTileLabel, applyEditorField } from "./actionEditorModel.js";
import { conditionMenuGroups } from "./conditionMenu.js";
import { defaultLane } from "./cardMenu.js";
import { conditionTile } from "./conditionCatalog.js";
import { LaneIcon } from "./laneIcons.jsx";
import { conditionTexts, findCard, findSwitch, kindToneOf, LANE_SPECS, locateEntry, scopeSetOf } from "./laneView.js";
import { liveHighlightSets } from "./liveHighlight.js";

/**
 * The lanes brain editor: one vertical list, no canvas. Mode tabs appear with a second mode (the "+ Mode" button
 * sits top right), then the current mode's switches, then the three sections (Movement, Actions, Variables). Each card
 * is one row (LaneCardRow): the action tile opens the action editor under the row, an attached movement tile opens its
 * own, a condition tile opens its inline editor, and "+ Condition" opens the condition menu. "+ Card" opens the card
 * menu; "Add follow-up" and "Add movement while casting" open it on the card. Shared cards sit under each section, under
 * an "All modes" divider. Every change goes through `onChange` (the workspace's undoable edit), with the pure ops in
 * laneEdits.js.
 *
 * `customVariableValues` (id -> current value) and `onOpenVariables` feed the condition menu's Variables group.
 * `live` (practice room only, from the preview of the bot being edited): `{ modeId, timeInModeMs, winners, comboStepId }`,
 * where winners holds the winning card ids (see liveHighlight.js). It only paints highlights.
 */
const LanesBoard = forwardRef(function LanesBoard({
    configuration,
    onChange,
    disabled = false,
    stateVariables,
    selectableTypes,
    selectedLoadout,
    customVariableValues = {},
    onOpenVariables = null,
    focusId = null,
    onFocusHandled = null,
    live = null,
}, ref) {
    const modes = useMemo(() => configuration.modes ?? [], [configuration]);
    const customVariables = useMemo(() => configuration.customVariables ?? [], [configuration]);
    const sharedSet = configuration.shared ?? {};
    const [chosenScope, setChosenScope] = useState(null);
    const scope = chosenScope === SHARED_SCOPE || modes.some((mode) => mode.id === chosenScope)
        ? chosenScope
        : (modes[0]?.id ?? SHARED_SCOPE);
    const multi = modes.length > 1;
    const inMode = scope !== SHARED_SCOPE;
    const activeSet = scopeSetOf(configuration, scope) ?? sharedSet;
    const [editing, setEditing] = useState(null);
    const [menu, setMenu] = useState(null);
    const [editingMode, setEditingMode] = useState(null);
    const [notice, setNotice] = useState("");
    const dragRef = useRef(null);
    const menuSeq = useRef(0);
    const renameCancelled = useRef(false);
    const frameRef = useRef(null);

    const lookups = useMemo(() => conditionSummaryLookups(stateVariables, selectableTypes), [stateVariables, selectableTypes]);
    const actionTypes = useMemo(() => actionTypesForLoadout(ACTION_TYPES, selectedLoadout), [selectedLoadout]);
    const quickTemplates = useMemo(
        () => buildQuickAddTemplates(actionTypes, { customVariables, selectableTypes }),
        [actionTypes, customVariables, selectableTypes],
    );
    const loadoutAbilityIds = useMemo(
        () => [...new Set(actionTypes.map((action) => action.abilityId).filter((id) => id != null))],
        [actionTypes],
    );
    // Auto on a Face action leads with one of the loadout's projectile abilities.
    const leadChoices = useMemo(() => leadAbilityChoicesOf(loadoutAbilityIds), [loadoutAbilityIds]);
    const leadChoicesRef = useRef(leadChoices);
    leadChoicesRef.current = leadChoices;
    const liveModeId = live?.modeId ?? null;
    // The bar sets for this tick. Rows compare only their own subtree (sameRowProps), so a tick re-renders the rows whose
    // bar changed.
    const highlight = useMemo(() => liveHighlightSets(live, configuration), [live, configuration]);
    const [details, setDetails] = useState(null);
    const closeDetails = useCallback(() => setDetails(null), []);

    // Who may move a top-level card, as the ⋯ menu offers it. Stable per scope, so memoised rows keep their props.
    const moveTargets = useMemo(() => ({
        toAll: modes.length > 1 && inMode ? [{ label: "Move to All modes", toScope: SHARED_SCOPE }] : null,
        toThisMode: modes.length > 1 && inMode ? [{ label: "Move to this mode", toScope: scope }] : null,
        toEachMode: modes.length > 1 && !inMode ? modes.map((mode) => ({ label: `Move to ${mode.name}`, toScope: mode.id })) : null,
    }), [modes, inMode, scope]);

    // Each card's view (its action label, tone, ability, and condition tiles), built once per configuration. A live
    // tick re-renders rows without rebuilding text. Follow-ups are included, at every depth.
    const cardViews = useMemo(() => {
        const views = new Map();
        const viewFor = (card) => {
            const definition = ACTION_BY_ID.get(card.action?.action) ?? null;
            const abilityId = definition?.abilityId ?? null;
            const abilityName = abilityId == null ? null : (abilityDefinition(abilityId)?.label ?? null);
            const head = definition?.head ?? null;
            return {
                definition,
                label: actionTileLabel(card.action, definition, { customVariables }),
                head,
                abilityId,
                abilityName,
                tone: kindToneOf(head),
                attached: ["move", "face"].filter((kind) => card[kind]).map((kind) => {
                    const attachedDefinition = ACTION_BY_ID.get(card[kind].action) ?? null;
                    return {
                        kind,
                        definition: attachedDefinition,
                        head: attachedDefinition?.head ?? null,
                        label: actionTileLabel(card[kind], attachedDefinition, { customVariables }),
                        tone: kindToneOf(attachedDefinition?.head ?? null),
                    };
                }),
                canHaveFollowUps: head === ACTION_HEADS.ABILITY || head === ACTION_HEADS.DASH,
                tiles: card.conditions.map((condition) => conditionTile(condition, {
                    fallback: conditionTexts([condition], lookups)[0],
                    abilityName,
                    cardAbilityId: abilityId,
                    customVariables,
                })),
            };
        };
        const add = (card) => {
            views.set(card, viewFor(card));
            (card.followUps ?? []).forEach(add);
        };
        for (const set of [configuration.shared, ...(configuration.modes ?? [])]) {
            for (const spec of LANE_SPECS) (set?.[spec.lane] ?? []).forEach(add);
        }
        return views;
    }, [configuration, lookups, customVariables]);

    /** Runs one pure edit and hands the result to the workspace. A refused edit shows its reason and changes nothing. */
    const apply = (edit) => {
        try {
            const result = edit(configuration);
            const next = result?.configuration ?? result;
            setNotice("");
            onChange(next);
            return result;
        } catch (error) {
            if (error instanceof LaneEditError) {
                setNotice(error.message);
                return null;
            }
            throw error;
        }
    };
    // Rows call onAct through a stable callback; it reads the latest brain and edit through these refs.
    const applyRef = useRef(apply);
    applyRef.current = apply;
    const configurationRef = useRef(configuration);
    configurationRef.current = configuration;

    /** Opens a menu, or closes it when the same button opens it again. */
    const openMenu = useCallback((next) => {
        // Each opening gets a new sequence number, so the menu remounts for a new mode and does not keep the last one's section.
        setMenu((current) => (isSameMenuTarget(current, next) ? null : { ...next, seq: ++menuSeq.current }));
    }, []);

    /** The card menu for "+ Card" in a lane. */
    const openAddCard = (lane, anchor) => openMenu({ type: "card", mode: "add", lane, scope, anchor, railShown: false, cardId: null, constraints: null });

    useImperativeHandle(ref, () => ({
        addCard: (lane) => setMenu({ type: "card", mode: "add", lane, scope, anchor: laneHeaderOf(frameRef.current, lane), railShown: false, cardId: null, constraints: null }),
    }), [scope]);

    // "/" opens the card menu for the selected card's lane, or the Ability lane, unless the user is typing.
    useEffect(() => {
        if (disabled) return undefined;
        const onKeyDown = (event) => {
            if (event.key !== "/" || event.ctrlKey || event.metaKey || event.altKey || event.defaultPrevented) return;
            if (isTypingTarget(event.target)) return;
            event.preventDefault();
            const selected = document.activeElement?.closest?.("[data-lane]")?.dataset?.lane;
            const lane = LANE_SPECS.some((spec) => spec.lane === selected) ? selected : "actions";
            setMenu((current) => current ?? { type: "card", mode: "add", lane, scope, anchor: laneHeaderOf(frameRef.current, lane), railShown: false, cardId: null, constraints: null });
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [disabled, scope]);

    // Escape closes an open inline editor (the menus close themselves on Escape).
    useEffect(() => {
        if (!editing) return undefined;
        const onKeyDown = (event) => {
            if (event.key === "Escape" && !event.defaultPrevented) setEditing(null);
        };
        window.addEventListener("keydown", onKeyDown);
        return () => window.removeEventListener("keydown", onKeyDown);
    }, [editing]);

    // A "Used in" jump from the Variables dialog: show the entry's mode, then its card or switch.
    useEffect(() => {
        if (!focusId) return;
        const located = locateEntry(configuration, focusId);
        if (located) {
            setChosenScope(located.scope);
            window.setTimeout(() => document.querySelector(`[data-entry-id="${focusId}"]`)?.scrollIntoView?.({ block: "center" }), 0);
        }
        onFocusHandled?.();
        // Only a new jump target moves the view; later edits must not re-run it.
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [focusId]);

    // Card, follow-up, condition and action actions. Stable across renders (the rows are memoised).
    const onAct = useCallback((kind, payload) => {
        const edit = (run) => applyRef.current(run);
        const locatorOf = (target) => (target.kind === "switch" ? switchLocator(target.cardId) : cardLocator(target.cardId));
        switch (kind) {
            case "duplicate": {
                const result = edit((brain) => duplicateCard(brain, payload.scope, payload.cardId));
                if (result) setEditing(null);
                return;
            }
            case "move":
                edit((brain) => moveCard(brain, payload.scope, payload.cardId, payload.toIndex));
                return;
            case "move-scope":
                if (edit((brain) => moveCardToScope(brain, payload.scope, payload.cardId, payload.toScope))) setEditing(null);
                return;
            case "delete": {
                // Only a top-level card takes its follow-ups with it; a follow-up's own follow-ups move up, with no question.
                const located = locateCard(scopeSetOf(configurationRef.current, payload.scope), payload.cardId);
                const followUps = located?.top ? (located.card.followUps?.length ?? 0) : 0;
                if (followUps && !window.confirm(`Delete this card? Also deletes its ${followUps} follow-up${followUps === 1 ? "" : "s"}.`)) return;
                edit((brain) => deleteCard(brain, payload.scope, payload.cardId));
                setEditing(null);
                return;
            }
            case "toggle":
                edit((brain) => toggleCard(brain, payload.scope, payload.cardId));
                return;
            case "open-card-menu": {
                const located = locateCard(scopeSetOf(configurationRef.current, payload.scope), payload.cardId);
                if (payload.mode === "follow") {
                    openMenu({ type: "card", mode: "follow", lane: defaultLane(null, "ability"), scope: payload.scope, anchor: payload.anchor, railShown: false, cardId: payload.cardId, constraints: null });
                    return;
                }
                if (payload.mode === "attach") {
                    openMenu({ type: "card", mode: "attach", lane: "movement", scope: payload.scope, anchor: payload.anchor, railShown: false, cardId: payload.cardId, constraints: null });
                    return;
                }
                // Change: a top-level card keeps its lane (no rail); a follow-up may take any lane's action that fits it.
                const head = ACTION_BY_ID.get(located?.card.action?.action)?.head ?? null;
                const constraints = located
                    ? { topLevel: located.top, lane: located.lane, hasFollowUps: (located.card.followUps ?? []).length > 0 }
                    : null;
                openMenu({ type: "card", mode: "swap", lane: located?.top ? located.lane : defaultLane(null, head), scope: payload.scope, anchor: payload.anchor, railShown: Boolean(located && !located.top), cardId: payload.cardId, constraints });
                return;
            }
            case "open-action":
                setEditing((current) => (current?.kind === "action" && current.id === payload.cardId ? null : { kind: "action", id: payload.cardId }));
                return;
            case "set-action-field": {
                const card = findCard(configurationRef.current, payload.scope, payload.cardId);
                if (!card) return;
                const definition = ACTION_BY_ID.get(card.action?.action);
                const next = applyEditorField(card.action, definition, payload.key, payload.value, {
                    customVariables,
                    defaultLeadAbilityId: defaultLeadAbilityId(null, leadChoicesRef.current),
                });
                edit((brain) => setCardAction(brain, payload.scope, payload.cardId, next));
                return;
            }
            case "open-details":
                setDetails((current) => (current && current.anchor === payload.anchor ? null : { anchor: payload.anchor, abilityId: payload.abilityId }));
                return;
            case "open-attached":
                setEditing((current) => (current?.kind === "attached" && current.id === payload.cardId && current.attached === payload.kind
                    ? null
                    : { kind: "attached", id: payload.cardId, attached: payload.kind }));
                return;
            case "set-attached-field": {
                const owner = findCard(configurationRef.current, payload.scope, payload.cardId);
                const entry = owner?.[payload.kind];
                if (!entry) return;
                // An attached Face's Auto leads with its ability card's projectile, when that is one.
                const cardAbility = ACTION_BY_ID.get(owner.action?.action)?.abilityId ?? null;
                const next = applyEditorField(entry, ACTION_BY_ID.get(entry.action), payload.key, payload.value, {
                    customVariables,
                    defaultLeadAbilityId: defaultLeadAbilityId(cardAbility, leadChoicesRef.current),
                });
                edit((brain) => setAttachedEntry(brain, payload.scope, payload.cardId, payload.kind, next));
                return;
            }
            case "remove-attached":
                edit((brain) => removeAttachedAction(brain, payload.scope, payload.cardId, payload.kind));
                setEditing(null);
                return;
            case "open-condition-menu":
                openMenu({ type: "condition", anchor: payload.anchor, scope: payload.scope, kind: payload.kind ?? "card", id: payload.cardId, index: payload.index });
                return;
            case "open-condition": {
                const next = { kind: payload.kind ?? "card", id: payload.cardId, index: payload.index };
                setEditing((current) => (current && current.kind === next.kind && current.id === next.id && current.index === next.index ? null : next));
                return;
            }
            case "set-condition":
                edit((brain) => updateCondition(brain, payload.scope, locatorOf(payload), payload.index, payload.update));
                return;
            case "remove-condition":
                edit((brain) => removeCondition(brain, payload.scope, locatorOf(payload), payload.index));
                setEditing(null);
                return;
            case "drag-start":
                dragRef.current = { scope: payload.scope, cardId: payload.cardId };
                return;
            case "drag-end":
                dragRef.current = null;
                return;
            case "drop": {
                const drag = dragRef.current;
                dragRef.current = null;
                if (!drag || drag.scope !== payload.scope || drag.cardId === payload.cardId) return;
                const set = scopeSetOf(configurationRef.current, payload.scope);
                const from = locateCard(set, drag.cardId);
                const to = locateCard(set, payload.cardId);
                // Drag reorders only among siblings: the same lane and the same parent.
                if (!from || !to || from.parentId !== to.parentId || from.lane !== to.lane) return;
                edit((brain) => moveCard(brain, payload.scope, drag.cardId, to.index));
                return;
            }
            default:
                return;
        }
    }, [customVariables, openMenu]);

    // ---- Menu picks ---------------------------------------------------------------------------------

    /** A condition from the condition menu: added with its catalog build, then its inline editor opens. */
    const pickCondition = (item) => {
        const target = menu;
        setMenu(null);
        if (target?.type !== "condition") return;
        const entry = target.kind === "switch"
            ? findSwitch(configurationRef.current, target.scope, target.id)
            : findCard(configurationRef.current, target.scope, target.id);
        if (!entry) return;
        const locator = target.kind === "switch" ? switchLocator(target.id) : cardLocator(target.id);
        const index = entry.conditions.length;
        const added = applyRef.current((brain) => addCondition(brain, target.scope, locator, item.build()));
        if (added) setEditing({ kind: target.kind, id: target.id, index });
    };

    /** An action or a ready-made card from the card menu. A swap changes the card's action and keeps the rest. */
    const pickCard = (item) => {
        const target = menu;
        setMenu(null);
        if (target?.type !== "card") return;
        if (target.mode === "swap") {
            if (item.kind !== "action") return;
            const result = applyRef.current((brain) => changeCardAction(brain, target.scope, target.cardId, item.actionId, customVariables));
            if (result?.droppedConditions) {
                setNotice(`Removed ${result.droppedConditions} ${result.droppedConditions === 1 ? "condition" : "conditions"} that read the old ability.`);
            }
            return;
        }
        if (target.mode === "attach") {
            // Movement while casting: a move action sets the card's move, a face action its face.
            const kind = item.head === ACTION_HEADS.ROTATION ? "face" : "move";
            applyRef.current((brain) => setAttachedAction(brain, target.scope, target.cardId, kind, item.actionId));
            return;
        }
        const actionId = item.kind === "template" ? item.template.actionId : item.actionId;
        const conditions = item.kind === "template" ? structuredClone(item.template.conditions) : [];
        if (target.mode === "follow") {
            applyRef.current((brain) => addFollowUp(brain, target.scope, target.cardId, actionId, customVariables, conditions));
            return;
        }
        applyRef.current((brain) => addCard(brain, target.scope, actionId, customVariables, conditions));
    };

    // ---- Mode actions ---------------------------------------------------------------------------

    const addNewMode = () => {
        const used = new Set(modes.map((mode) => mode.name.toLowerCase()));
        let number = modes.length + 1;
        while (used.has(`mode ${number}`.toLowerCase())) number += 1;
        const result = apply((brain) => addMode(brain, `Mode ${number}`));
        if (result) setChosenScope(result.modeId);
    };

    const startRename = (mode) => {
        renameCancelled.current = false;
        setEditingMode({ id: mode.id });
    };

    const finishRename = (mode, text) => {
        setEditingMode(null);
        if (renameCancelled.current) return;
        const next = text.trim();
        if (next && next !== mode.name) apply((brain) => renameMode(brain, mode.id, next));
    };

    const moveModeBy = (mode, delta) => {
        const index = modes.indexOf(mode);
        apply((brain) => moveMode(brain, mode.id, index + delta));
    };

    const removeMode = (mode) => {
        if (modes.length <= 1) return;
        const own = (mode.switches?.length ?? 0) + LANE_SPECS.flatMap((spec) => mode[spec.lane] ?? []).length;
        const incoming = [...modes.flatMap((candidate) => candidate.switches ?? []), ...(sharedSet.switches ?? [])]
            .filter((entry) => entry.to === mode.id).length;
        if (own || incoming) {
            const parts = [];
            if (own) parts.push(`its ${own} ${own === 1 ? "card or switch" : "cards and switches"} go too`);
            if (incoming) parts.push(`${incoming} ${incoming === 1 ? "switch that leads" : "switches that lead"} to it ${incoming === 1 ? "is" : "are"} removed`);
            if (!window.confirm(`Delete the mode "${mode.name}"? ${parts.join("; ")}.`)) return;
        }
        if (apply((brain) => deleteMode(brain, mode.id)) && chosenScope === mode.id) setChosenScope(null);
    };

    const addSwitchHere = () => {
        const target = modes.find((mode) => mode.id !== scope)?.id ?? modes[0]?.id;
        if (!target) return;
        // A new switch starts as "after 5 s" so it does something visible; the player edits its tiles from there.
        apply((brain) => {
            const added = addSwitch(brain, scope, target, []);
            return { configuration: setSwitchAfterSeconds(added.configuration, scope, added.switchId, 5) };
        });
    };

    // ---- Menus ------------------------------------------------------------------------------------

    // The condition menu's groups for the card or switch it was opened on (memoised while it stays open).
    const conditionOwner = menu?.type === "condition" && menu.kind === "card" ? findCard(configuration, menu.scope, menu.id) : null;
    const conditionOwnerView = conditionOwner ? cardViews.get(conditionOwner) : null;
    const conditionGroups = useMemo(() => (menu?.type === "condition" ? conditionMenuGroups({
        abilityId: conditionOwnerView?.abilityId ?? null,
        abilityName: conditionOwnerView?.abilityName ?? null,
        loadout: loadoutAbilityIds,
        customVariables,
        customVariableValues,
        selectableTypes,
    }) : null), [menu?.type, conditionOwnerView, loadoutAbilityIds, customVariables, customVariableValues, selectableTypes]);

    // The card menu's constraints for a swap: a top-level card keeps its lane; a card with follow-ups keeps them only
    // for an ability or dash action.
    const cardMenuFits = menu?.constraints
        ? (actionId) => actionFitsCard(actionId, menu.constraints)
        : () => true;

    // ---- Rendering --------------------------------------------------------------------------------

    const renderCards = (cards, cardScope) => {
        const targets = cardScope === SHARED_SCOPE
            ? (inMode ? moveTargets.toThisMode : moveTargets.toEachMode)
            : moveTargets.toAll;
        return cards.map((card, index) => (
            <LaneCardRow
                key={card.id}
                card={card}
                views={cardViews}
                scope={cardScope}
                depth={0}
                index={index}
                count={cards.length}
                highlight={highlight}
                editing={editing}
                moveTargets={targets}
                customVariables={customVariables}
                leadAbilityChoices={leadChoices}
                disabled={disabled}
                onAct={onAct}
            />
        ));
    };

    const renderLane = (spec) => {
        const own = activeSet[spec.lane] ?? [];
        const shared = inMode ? sharedSet[spec.lane] ?? [] : [];
        const empty = own.length === 0 && shared.length === 0;
        return (
            <section key={spec.lane} className="lane-group" data-lane={spec.lane} style={{ "--lane-tone": spec.tone }} aria-label={spec.title}>
                <header className="lane-group__head">
                    <span className="lane-group__tag">{spec.title}</span>
                    {!(empty && spec.lane === "variables") && <span className="lane-group__rule">{spec.rule}</span>}
                    {empty && !disabled && (
                        <button
                            type="button"
                            className="lane-plus"
                            aria-label={`Add a ${spec.title} card`}
                            title={`Add a ${spec.title} card`}
                            onClick={(event) => openAddCard(spec.lane, event.currentTarget)}
                        >
                            <LaneIcon name="plus" size={13} />
                        </button>
                    )}
                </header>
                {!empty && (
                    <ol className="lane-group__cards">
                        {renderCards(own, scope)}
                        {shared.length > 0 && <li className="lane-divider" aria-hidden="true"><span>All modes</span></li>}
                        {renderCards(shared, SHARED_SCOPE)}
                    </ol>
                )}
                {!empty && !disabled && (
                    <button type="button" className="lane-add-card" onClick={(event) => openAddCard(spec.lane, event.currentTarget)}>
                        <LaneIcon name="plus" size={13} />
                        <span>Card</span>
                    </button>
                )}
            </section>
        );
    };

    const tabRow = (
        <div className="lanes-tabs-row">
            {multi && (
                <div className="lanes-tabs" role="tablist" aria-label="Modes">
                    {modes.map((mode, index) => {
                        const isLive = liveModeId === mode.id;
                        const isEditing = editingMode?.id === mode.id;
                        const isActive = scope === mode.id;
                        return (
                            <div key={mode.id} className="lanes-tab-wrap">
                                {isEditing ? (
                                    <input
                                        className="lanes-tab-input"
                                        type="text"
                                        autoFocus
                                        maxLength={25}
                                        aria-label={`Rename mode ${mode.name}`}
                                        defaultValue={mode.name}
                                        onBlur={(event) => finishRename(mode, event.target.value)}
                                        onKeyDown={(event) => {
                                            if (event.key === "Enter") event.currentTarget.blur();
                                            if (event.key === "Escape") {
                                                renameCancelled.current = true;
                                                event.currentTarget.blur();
                                            }
                                        }}
                                    />
                                ) : (
                                    <button
                                        type="button"
                                        role="tab"
                                        aria-selected={isActive}
                                        className={`lanes-tab${isActive ? " is-active" : ""}${isLive ? " is-live" : ""}`}
                                        title={disabled ? undefined : "Double-click to rename"}
                                        onClick={() => setChosenScope(mode.id)}
                                        onDoubleClick={() => { if (!disabled) startRename(mode); }}
                                    >
                                        {mode.name}
                                        {index === 0 && <span className="lanes-tag">Start</span>}
                                        {isLive && <span className="lanes-live-time">{formatSeconds(live.timeInModeMs)}</span>}
                                    </button>
                                )}
                                {!disabled && !isEditing && (
                                    <LaneMenu
                                        label={`Options for ${mode.name}`}
                                        triggerClassName="lanes-icon lanes-tab-menu"
                                        items={[
                                            { label: "Rename", onSelect: () => startRename(mode) },
                                            { label: "Move left", disabled: index === 0, onSelect: () => moveModeBy(mode, -1) },
                                            { label: "Move right", disabled: index === modes.length - 1, onSelect: () => moveModeBy(mode, 1) },
                                            { divider: true },
                                            { label: "Delete", danger: true, onSelect: () => removeMode(mode) },
                                        ]}
                                    />
                                )}
                            </div>
                        );
                    })}
                    <button
                        type="button"
                        role="tab"
                        aria-selected={scope === SHARED_SCOPE}
                        className={`lanes-tab${scope === SHARED_SCOPE ? " is-active" : ""}`}
                        onClick={() => setChosenScope(SHARED_SCOPE)}
                    >
                        All modes
                    </button>
                </div>
            )}
            {!disabled && modes.length < MAX_LANE_MODES && (
                <button type="button" className="lanes-ghost lanes-add-mode" onClick={addNewMode}>+ Mode</button>
            )}
        </div>
    );

    const switchRow = (entry) => {
        const tiles = entry.conditions.map((condition) => conditionTile(condition, {
            fallback: conditionTexts([condition], lookups)[0],
            customVariables,
        }));
        const open = editing?.kind === "switch" && editing.id === entry.id ? editing.index : null;
        const openCondition = open !== null ? entry.conditions[open] : null;
        return (
            <li key={entry.id} className="lanes-switch" data-entry-id={entry.id}>
                <div className="lanes-switch__line">
                    <span className="lanes-switch__go">Go to</span>
                    <select
                        aria-label="Mode to go to"
                        value={entry.to}
                        disabled={disabled}
                        onChange={(event) => apply((brain) => setSwitchTarget(brain, scope, entry.id, event.target.value))}
                    >
                        {modes.map((mode) => <option key={mode.id} value={mode.id}>{mode.name}</option>)}
                    </select>
                    <span className="lanes-switch__when">when</span>
                    <ConditionTiles
                        tiles={tiles}
                        editingIndex={open}
                        disabled={disabled}
                        onOpen={(index) => onAct("open-condition", { kind: "switch", scope, cardId: entry.id, index })}
                        onAdd={!disabled && entry.conditions.length < MAX_LANE_CONDITIONS_PER_ENTRY
                            ? (anchor) => onAct("open-condition-menu", { kind: "switch", scope, cardId: entry.id, index: entry.conditions.length, anchor })
                            : null}
                    />
                    <button type="button" className="lanes-icon" aria-label="Delete switch" title="Delete switch" disabled={disabled} onClick={() => apply((brain) => deleteSwitch(brain, scope, entry.id))}>
                        <LaneIcon name="x" size={14} />
                    </button>
                </div>
                {openCondition && (
                    <LaneConditionEditor
                        condition={openCondition}
                        title={tiles[open]?.entry?.name ?? tiles[open]?.name ?? ""}
                        entryOverride={tiles[open]?.entry ?? null}
                        disabled={disabled}
                        onChange={(update) => onAct("set-condition", { kind: "switch", scope, cardId: entry.id, index: open, update })}
                        onRemove={() => onAct("remove-condition", { kind: "switch", scope, cardId: entry.id, index: open })}
                    />
                )}
            </li>
        );
    };

    return (
        <div className="lanes-frame" ref={frameRef}>
            <div className="lanes-scroll">
                {tabRow}

                {notice && <p className="lanes-notice" role="status">{notice}</p>}

                {inMode && (multi || activeSet.switches?.length > 0) && (
                    <section className="lanes-switches" aria-label="Switches">
                        <h3 className="lanes-heading">Leave this mode when…</h3>
                        {(activeSet.switches ?? []).length === 0 && <p className="lanes-empty">No switches. The bot stays in this mode.</p>}
                        <ol className="lanes-switch-list">
                            {(activeSet.switches ?? []).map(switchRow)}
                        </ol>
                        {!disabled && <button type="button" className="lanes-ghost" onClick={addSwitchHere}>+ Switch</button>}
                    </section>
                )}

                {LANE_SPECS.map(renderLane)}
            </div>

            {menu?.type === "condition" && !disabled && conditionGroups && (
                <LaneConditionMenu
                    anchor={menu.anchor}
                    groups={conditionGroups}
                    onPick={pickCondition}
                    onOpenVariables={() => {
                        setMenu(null);
                        onOpenVariables?.();
                    }}
                    onClose={() => setMenu(null)}
                />
            )}
            {menu?.type === "card" && !disabled && (
                <LaneCardMenu
                    key={menu.seq}
                    anchor={menu.anchor}
                    mode={menu.mode}
                    lane={menu.lane}
                    railShown={menu.railShown}
                    actionTypes={actionTypes}
                    templates={menu.mode === "add" ? quickTemplates : []}
                    fits={cardMenuFits}
                    emptyHint={menu.mode === "swap" && !menu.railShown ? `Only ${laneNameOf(menu.lane)} actions fit this card.` : null}
                    onPick={pickCard}
                    onClose={() => setMenu(null)}
                    onDetails={(anchor, abilityId) => onAct("open-details", { anchor, abilityId })}
                />
            )}
            {details && (
                <AbilityDetailsPopover abilityId={details.abilityId} anchor={details.anchor} onClose={closeDetails} />
            )}
        </div>
    );
});

/** The header of a lane's group, where its menus open; the frame when the lane is not drawn. */
function laneHeaderOf(frame, lane) {
    return frame?.querySelector(`[data-lane="${lane}"] .lane-group__head`) ?? frame ?? null;
}

/** The lane's title, for a hint. */
function laneNameOf(lane) {
    return LANE_SPECS.find((spec) => spec.lane === lane)?.title ?? lane;
}

const formatSeconds = (ms) => `${(Math.max(0, Number(ms) || 0) / 1000).toFixed(1)} s`;

function isTypingTarget(target) {
    if (!(target instanceof HTMLElement)) return false;
    return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export default LanesBoard;

/** Shown in place of the board for a tree brain (old saves and puzzles): it still runs, but it cannot be edited. */
export function LegacyTreeNotice({ onStartNew = null, disabled = false }) {
    return (
        <section className="lanes-legacy" aria-label="Old brain format">
            <p>This brain uses the old format. It still runs, but can't be edited.</p>
            {onStartNew && <button type="button" className="lanes-primary" disabled={disabled} onClick={onStartNew}>Start a new brain</button>}
        </section>
    );
}
