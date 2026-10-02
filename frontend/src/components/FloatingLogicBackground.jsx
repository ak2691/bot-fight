import { getAbilityCatalogueIcon } from "../abilityCatalogueIcons.js";
import "./floatingTrees.css";

// Small real programs drawn with the workspace's own node classes (code-bt-*), so they track the editor's look.
const TREES = [
    {
        id: "attack",
        className: "home-float-pair-1",
        delay: "0s",
        name: "Attack",
        condition: { subject: "Distance", chip: "Me→Opp 1", comparator: "<", value: "120" },
        actions: [
            { channel: "ability", label: "Heavy Slash", abilityId: 7 },
            { channel: "ability", label: "Dash in", abilityId: 19 },
        ],
    },
    {
        id: "zone",
        className: "home-float-pair-2",
        delay: "-1.6s",
        name: "Zone",
        condition: { subject: "Cooldown Left", chip: "Fireball", comparator: "=", value: "0" },
        actions: [{ channel: "ability", label: "Fireball", abilityId: 5 }],
    },
    {
        id: "aim",
        className: "home-float-pair-3",
        delay: "-3.1s",
        name: "Aim",
        condition: { subject: "Always" },
        actions: [{ channel: "rotation", label: "Face target" }],
    },
    {
        id: "defend",
        className: "home-float-pair-4",
        delay: "-4.4s",
        name: "Defend",
        condition: { subject: "HP", chip: "My Bot", comparator: "<", value: "40" },
        actions: [
            { channel: "ability", label: "Dash away", abilityId: 19 },
            { channel: "ability", label: "Stun", abilityId: 6 },
        ],
    },
];

const CHANNEL_LABELS = { ability: "ABILITY", movement: "MOVE", rotation: "ROTATE" };

const TREE_WIDTH = 300;
const ROOT = { width: 100, height: 44 };
const COND = { width: 190, height: 30, tabHeight: 17 };
const ACTION = { width: 124, height: 54 };
const GAP_ROOT_COND = 34;
const GAP_COND_ACTION = 34;
const ACTION_SPACING = 14;
const CYCLE_SECONDS = 5.2;

// Node rectangles and wire paths for one tree, in the tree's own 300px-wide coordinate space.
function layoutTree(tree) {
    const centerX = TREE_WIDTH / 2;
    const condTop = ROOT.height + GAP_ROOT_COND;
    const actionTop = condTop + COND.height + GAP_COND_ACTION;
    const totalActionsWidth = tree.actions.length * ACTION.width + (tree.actions.length - 1) * ACTION_SPACING;
    const firstActionLeft = (TREE_WIDTH - totalActionsWidth) / 2;
    const actions = tree.actions.map((action, index) => ({
        ...action,
        left: firstActionLeft + index * (ACTION.width + ACTION_SPACING),
        top: actionTop,
    }));
    const rootToCond = `M ${centerX} ${ROOT.height} L ${centerX} ${condTop - COND.tabHeight}`;
    const condToAction = (action) => {
        const x = action.left + ACTION.width / 2;
        return `M ${centerX} ${condTop + COND.height} C ${centerX} ${condTop + COND.height + 18}, ${x} ${actionTop - 18}, ${x} ${actionTop}`;
    };
    return {
        height: actionTop + ACTION.height + 2,
        root: { left: (TREE_WIDTH - ROOT.width) / 2, top: 0 },
        cond: { left: (TREE_WIDTH - COND.width) / 2, top: condTop },
        actions,
        wires: [rootToCond, ...actions.map(condToAction)],
        // The pulse runs root -> conditional -> first action; it is hidden behind the nodes it passes through.
        pulsePath: `M ${centerX} ${ROOT.height} L ${centerX} ${condTop + COND.height} ${condToAction(actions[0]).replace(/^M [\d.]+ [\d.]+ /, "")}`,
    };
}

function ConditionStrip({ condition }) {
    return (
        <span className="code-bt-strip-text">
            <span className="code-bt-subject">{condition.subject}</span>
            {condition.chip && <span className="code-bt-entity">{condition.chip}</span>}
            {condition.comparator && <span className="code-bt-comparator">{condition.comparator}</span>}
            {condition.value && <span className="code-bt-value">{condition.value}</span>}
        </span>
    );
}

function ActionNode({ action, lit }) {
    const iconPath = action.abilityId == null ? null : getAbilityCatalogueIcon(action.abilityId);
    return (
        <div
            className={`code-bt-node code-bt-task fl-node ${lit ? "fl-action--lit" : ""}`}
            style={{ left: action.left, top: action.top, width: ACTION.width, height: ACTION.height }}
        >
            <div className="code-bt-task-body">
                <span className={`code-bt-channel code-bt-channel--${action.channel}`}>{CHANNEL_LABELS[action.channel]}</span>
                <span className="code-bt-task-line">
                    {iconPath && <span className="code-config-ability"><img src={iconPath} alt="" /></span>}
                    <span className="code-action-label">{action.label}</span>
                </span>
            </div>
        </div>
    );
}

function FloatingTree({ tree }) {
    const layout = layoutTree(tree);
    return (
        <div className={`fl-pair home-floating-pair ${tree.className}`} style={{ "--fl-cycle": `${CYCLE_SECONDS}s`, "--fl-delay": tree.delay, height: layout.height }}>
            <div className="fl-tree home-floating-tree" style={{ height: layout.height }}>
                <svg className="fl-wires" width={TREE_WIDTH} height={layout.height} viewBox={`0 0 ${TREE_WIDTH} ${layout.height}`}>
                    {layout.wires.map((path, index) => <path key={`${tree.id}-wire-${index}`} d={path} />)}
                </svg>
                <span className="fl-dot" style={{ offsetPath: `path('${layout.pulsePath}')` }} />
                <div className="code-bt-node code-bt-root fl-node" style={{ left: layout.root.left, top: layout.root.top, width: ROOT.width, height: ROOT.height }}>
                    <span className="code-bt-root-label">ROOT</span>
                    <span className="fl-root-name">{tree.name}</span>
                </div>
                <div className="code-bt-node code-bt-cond fl-node" style={{ left: layout.cond.left, top: layout.cond.top, width: COND.width }}>
                    <span className="code-bt-kind-tab">IF</span>
                    <div className="code-bt-strip"><ConditionStrip condition={tree.condition} /></div>
                </div>
                {layout.actions.map((action, index) => <ActionNode key={`${tree.id}-action-${index}`} action={action} lit={index === 0} />)}
            </div>
        </div>
    );
}

// variant: "home" or "auth" picks the width at which the side margins are wide enough for the trees.
export default function FloatingLogicBackground({ variant = "home" }) {
    return (
        <div className={`home-floating-nodes fl-nodes fl-nodes--${variant}`} aria-hidden="true">
            {TREES.map((tree) => <FloatingTree key={tree.id} tree={tree} />)}
        </div>
    );
}
