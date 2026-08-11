const floatingNodePairs = [
    { id: "hp", className: "home-float-pair-1", condition: { depth: 1, label: "Conditional 1", rows: [["IF", "My HP", "<", "45"]] }, action: { label: "Walk", target: "Away From Opponent 1" } },
    { id: "distance", className: "home-float-pair-2", condition: { depth: 1, label: "Conditional 2", rows: [["IF", "Target Distance", ">", "100"]] }, action: { label: "Walk", target: "Toward Opponent 1" } },
    { id: "always", className: "home-float-pair-3", condition: { depth: 1, label: "Conditional 1", rows: [["IF", "ALWAYS"]] }, action: { label: "Face Target", target: "Opponent 1" } },
    { id: "bearing", className: "home-float-pair-4", wide: true, condition: { depth: 1, label: "Conditional 1", rows: [["IF", "Target Distance", "<=", "115"], ["AND", "Target Bearing Difference (Shortest)", "<=", "75"]] }, action: { label: "Heavy Slash", target: "Opponent 1" } },
];

function FloatingNode({ node }) {
    if (node.target) {
        return <div className="home-floating-action">
            <span className="home-floating-delete">×</span>
            <strong>{node.label}</strong>
            <span>Target: {node.target}</span>
        </div>;
    }

    return <div className="home-floating-conditional">
        <header><span className="home-floating-badge">{node.depth ?? 1}</span><strong>{node.label}</strong><span className="home-floating-delete">×</span></header>
        <div className="home-floating-rows">
            {node.rows.map((row) => <div className="home-floating-row" key={row.join("-")}>
                {row.map((value, index) => <span className={index === 1 ? "home-floating-value" : ""} key={`${value}-${index}`}>{value}</span>)}
                <span className="home-floating-row-delete">×</span>
            </div>)}
        </div>
        <footer><span>+ AND</span><span>+ OR</span><span className="home-floating-parent-add">+ IF</span><span className="home-floating-action-add">+ ACTION</span></footer>
    </div>;
}

function FloatingNodePair({ pair }) {
    return <div className={`home-floating-pair ${pair.className}${pair.wide ? " is-wide" : ""}`}>
        <div className="home-floating-pair-content">
            <FloatingNode node={pair.condition} />
            <svg className="home-floating-wire" viewBox="0 0 100 46" preserveAspectRatio="none" aria-hidden="true">
                <path d="M50 0 C50 18, 28 22, 50 46" />
            </svg>
            <FloatingNode node={pair.action} />
        </div>
    </div>;
}

export default function FloatingLogicBackground() {
    return <div className="home-floating-nodes" aria-hidden="true">
        {floatingNodePairs.map((pair) => <FloatingNodePair key={pair.id} pair={pair} />)}
    </div>;
}
