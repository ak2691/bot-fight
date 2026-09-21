import { getAbilityCatalogueIcon } from "../abilityCatalogueIcons.js";

const TREE_LAYOUTS = {
    branching: {
        paths: [
            "M 170 40 C 154 55, 113 58, 109 74",
            "M 170 40 C 194 55, 227 58, 231 74",
            "M 109 106 C 102 123, 69 126, 62 140",
            "M 109 106 C 114 123, 151 126, 170 140",
            "M 231 106 C 236 123, 266 126, 278 140",
        ],
        conditions: ["Conditional 1", "Conditional 2"],
    },
    single: {
        paths: [
            "M 170 40 C 151 53, 190 61, 170 74",
            "M 170 106 C 190 119, 150 127, 170 140",
        ],
        conditions: ["Conditional 1"],
    },
};

const floatingTrees = [
    {
        id: "top-left",
        className: "home-float-pair-1",
        layout: "branching",
        actions: [
            { label: "Heavy Slash", abilityId: 7 },
            { label: "Dash In", abilityId: 19 },
            { label: "Walk Away" },
        ],
    },
    {
        id: "bottom-left",
        className: "home-float-pair-2",
        layout: "single",
        actions: [{ label: "Fireball", abilityId: 5 }],
    },
    {
        id: "top-right",
        className: "home-float-pair-3",
        layout: "single",
        actions: [{ label: "Face Target", abilityId: 20 }],
    },
    {
        id: "bottom-right",
        className: "home-float-pair-4",
        layout: "branching",
        actions: [
            { label: "Stun", abilityId: 6 },
            { label: "Dash Away", abilityId: 19 },
            { label: "Slash", abilityId: 1 },
        ],
    },
];

function TreeNode({ type, label, abilityId = null }) {
    const iconPath = abilityId == null ? null : getAbilityCatalogueIcon(abilityId);
    return <div className={`tutorial-node-abstract__node tutorial-node-abstract__node--${type}`}>
        {iconPath && <span className="code-config-ability home-floating-action-icon"><img src={iconPath} alt="" /></span>}
        <span>{label}</span>
    </div>;
}

function FloatingTree({ tree }) {
    const layout = TREE_LAYOUTS[tree.layout];

    return <div className={`home-floating-pair ${tree.className}`}>
        <div className="home-floating-tree" aria-hidden="true">
            <svg className="home-floating-tree__wires" viewBox="0 0 340 180" preserveAspectRatio="none">
                {layout.paths.map((path, index) => <path key={`${tree.id}-wire-${index}`} d={path} />)}
            </svg>
            <div className="home-floating-tree__stages">
                <div className="home-floating-tree__stage">
                    <div className="home-floating-tree__group">
                        <TreeNode type="root" label="Root" />
                    </div>
                </div>
                <div className="home-floating-tree__stage">
                    <div className="home-floating-tree__group">
                        {layout.conditions.map((label, index) => <TreeNode key={`${tree.id}-condition-${index}`} type="conditional" label={label} />)}
                    </div>
                </div>
                <div className="home-floating-tree__stage">
                    <div className="home-floating-tree__group">
                        {tree.actions.map((action, index) => <TreeNode key={`${tree.id}-action-${index}`} type="action" label={action.label} abilityId={action.abilityId} />)}
                    </div>
                </div>
            </div>
        </div>
    </div>;
}

export default function FloatingLogicBackground() {
    return <div className="home-floating-nodes" aria-hidden="true">
        {floatingTrees.map((tree) => <FloatingTree key={tree.id} tree={tree} />)}
    </div>;
}
