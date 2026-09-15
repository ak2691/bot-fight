const COMPASS_DIRECTIONS = Object.freeze([
    { label: "N", positive: "0° / 360°", negative: "0° / -360°", x: 50, y: 7, anchor: "middle" },
    { label: "NE", positive: "45°", negative: "-315°", x: 77, y: 19, anchor: "start" },
    { label: "E", positive: "90°", negative: "-270°", x: 93, y: 50, anchor: "start" },
    { label: "SE", positive: "135°", negative: "-225°", x: 77, y: 81, anchor: "start" },
    { label: "S", positive: "180°", negative: "-180°", x: 50, y: 93, anchor: "middle" },
    { label: "SW", positive: "225°", negative: "-135°", x: 23, y: 81, anchor: "end" },
    { label: "W", positive: "270°", negative: "-90°", x: 7, y: 50, anchor: "end" },
    { label: "NW", positive: "315°", negative: "-45°", x: 23, y: 19, anchor: "end" },
]);

export default function ArenaDegreesCompass({ className = "" }) {
    return (
        <aside className={`self-start ${className}`.trim()}>
            <div className="mx-auto aspect-square w-full max-w-[22rem]" role="img" aria-label="Arena compass degrees. North is 0 or 360 degrees, east is 90, south is 180, and west is 270. Equivalent negative angles run counterclockwise.">
                <svg viewBox="0 0 100 100" className="h-full w-full overflow-visible">
                    <circle cx="50" cy="50" r="31" fill="#081b2a" stroke="#155e75" strokeWidth="0.8" />
                    <circle cx="50" cy="50" r="24" fill="none" stroke="#1e3a4c" strokeWidth="0.5" />
                    {COMPASS_DIRECTIONS.map((direction, index) => {
                        const angle = index * 45 * Math.PI / 180;
                        const innerX = 50 + Math.sin(angle) * 24;
                        const innerY = 50 - Math.cos(angle) * 24;
                        const outerX = 50 + Math.sin(angle) * 31;
                        const outerY = 50 - Math.cos(angle) * 31;
                        return <line key={direction.label} x1={innerX} y1={innerY} x2={outerX} y2={outerY} stroke="#38bdf8" strokeWidth={index % 2 === 0 ? 1.1 : 0.6} />;
                    })}
                    <path d="M50 22 L46.5 50 L50 47 L53.5 50 Z" fill="#38bdf8" />
                    <path d="M50 78 L46.5 50 L50 53 L53.5 50 Z" fill="#334155" />
                    <circle cx="50" cy="50" r="2" fill="#e2e8f0" />
                    {COMPASS_DIRECTIONS.map((direction) => (
                        <g key={direction.label} textAnchor={direction.anchor}>
                            <text x={direction.x} y={direction.y - 2.5} fill="#e2e8f0" fontSize="4.5" fontWeight="700">{direction.label}</text>
                            <text x={direction.x} y={direction.y + 2.5} fill="#7dd3fc" fontSize="3.4">{direction.positive}</text>
                            <text x={direction.x} y={direction.y + 6.5} fill="#a78bfa" fontSize="3.2">{direction.negative}</text>
                        </g>
                    ))}
                </svg>
            </div>
        </aside>
    );
}
