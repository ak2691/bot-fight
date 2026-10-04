import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useDialogFocus } from "../../../components/useDialogFocus.js";
import {
    ANGLE_FOOTNOTES,
    ANGLE_PRESETS,
    ARENA_SIZE,
    HOME_POSITIONS,
    advancePreview,
    angleCaption,
    bearingBetween,
    clampAngle,
    clampToArena,
    headingVector,
    normalizeAngle,
    previewPath,
    steeringHeading,
} from "./angleGuideMath.js";
import "./angleGuide.css";

const COMPASS = [["N", 0], ["E", 90], ["S", 180], ["W", 270]];
const GRID_LINES = Array.from({ length: 9 }, (_, index) => (index + 1) * 30);

function prefersReducedMotion() {
    return typeof window !== "undefined" && Boolean(window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

function Shell({ titleId, title, onClose, closeLabel, headerExtra = null, children }) {
    const dialogRef = useRef(null);
    useDialogFocus(dialogRef, { onClose, lockScroll: true });
    return createPortal(<div className="ag-overlay" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
        <section ref={dialogRef} className="ag" role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1}>
            <header className="ag-header">
                <h2 id={titleId}>{title}</h2>
                {headerExtra}
                <button type="button" className="ag-close" onClick={onClose} aria-label={closeLabel} title="Close"><span aria-hidden="true">×</span></button>
            </header>
            {children}
        </section>
    </div>, document.body);
}

function AngleNumberBox({ value, onCommit, label }) {
    const [draft, setDraft] = useState(String(value));
    const [seen, setSeen] = useState(value);
    if (seen !== value) {
        setSeen(value);
        setDraft(String(value));
    }
    const commit = () => {
        const next = clampAngle(draft);
        setDraft(String(next));
        onCommit(next);
    };
    return <input className="ag-number" type="text" inputMode="numeric" maxLength={5} value={draft} aria-label={label}
        onChange={(event) => setDraft(event.target.value)} onBlur={commit}
        onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } }} />;
}

/**
 * Movement direction guide: a small arena to drag the bot and target around, the angle, and a preview
 * of how a bot steering by that angle moves. Relative angles are measured from the line to the target;
 * absolute angles are arena compass headings.
 */
export default function AngleGuideDialog({ initialMode = "relative", onClose }) {
    const [mode, setMode] = useState(initialMode === "absolute" ? "absolute" : "relative");
    const [direction, setDirection] = useState(initialMode === "absolute" ? 90 : 0);
    const [bot, setBot] = useState(HOME_POSITIONS.bot);
    const [target, setTarget] = useState(HOME_POSITIONS.target);
    const [trail, setTrail] = useState([]);
    const [playing, setPlaying] = useState(false);
    const svgRef = useRef(null);
    const dragRef = useRef(null);
    const botRef = useRef(HOME_POSITIONS.bot);

    useEffect(() => {
        if (!playing) return undefined;
        let frame = 0;
        let last = performance.now();
        const started = last;
        let position = botRef.current;
        const points = [position];
        const tick = (now) => {
            const result = advancePreview({ bot: position, target, mode, direction, seconds: (now - last) / 1000, elapsedMs: now - started });
            last = now;
            position = result.bot;
            botRef.current = position;
            points.push(position);
            setBot(position);
            setTrail([...points]);
            if (result.done) setPlaying(false);
            else frame = requestAnimationFrame(tick);
        };
        frame = requestAnimationFrame(tick);
        return () => cancelAnimationFrame(frame);
    }, [playing, mode, direction, target]);

    const resetPreview = () => {
        setPlaying(false);
        setTrail([]);
    };
    const changeMode = (next) => {
        if (next === mode) return;
        resetPreview();
        setMode(next);
        setDirection(next === "relative" ? 0 : 90);
    };
    const changeDirection = (next) => {
        resetPreview();
        setDirection(clampAngle(next));
    };
    const play = () => {
        if (playing) {
            setPlaying(false);
            return;
        }
        botRef.current = bot;
        if (prefersReducedMotion()) {
            // No motion: show where the bot would go as a finished trail.
            const path = previewPath({ bot, target, mode, direction });
            setTrail(path);
            setBot(path.at(-1));
            botRef.current = path.at(-1);
            return;
        }
        setTrail([bot]);
        setPlaying(true);
    };
    const reset = () => {
        resetPreview();
        setBot(HOME_POSITIONS.bot);
        setTarget(HOME_POSITIONS.target);
        botRef.current = HOME_POSITIONS.bot;
    };
    const pointerPoint = (event) => {
        const rect = svgRef.current.getBoundingClientRect();
        return clampToArena({ x: (event.clientX - rect.left) * ARENA_SIZE / rect.width, y: (event.clientY - rect.top) * ARENA_SIZE / rect.height });
    };
    const startDrag = (which) => (event) => {
        event.preventDefault();
        dragRef.current = which;
        svgRef.current.setPointerCapture(event.pointerId);
    };
    const moveDrag = (event) => {
        if (!dragRef.current) return;
        const point = pointerPoint(event);
        resetPreview();
        if (dragRef.current === "bot") {
            setBot(point);
            botRef.current = point;
        } else {
            setTarget(point);
        }
    };

    const relative = mode === "relative";
    const bearing = bearingBetween(bot, target);
    const heading = steeringHeading(mode, direction, bot, target);
    const arrow = headingVector(heading, 58);
    const reference = relative ? bearing : 0;
    const normalized = normalizeAngle(direction);
    const arcStart = headingVector(reference, 30);
    const arcEnd = headingVector(reference + normalized, 30);
    const labelAt = headingVector(reference + normalized / 2, 46);
    const north = headingVector(0, 70);
    const caption = angleCaption(mode, direction);
    const label = relative ? "Direction" : "Angle";

    return <Shell titleId="angle-guide-title" title="Movement direction" onClose={onClose} closeLabel="Close movement direction guide"
        headerExtra={<div className="ag-segmented" role="group" aria-label="Angle type">
            <button type="button" aria-pressed={relative} className={relative ? "is-active" : ""} onClick={() => changeMode("relative")}>Relative</button>
            <button type="button" aria-pressed={!relative} className={!relative ? "is-active" : ""} onClick={() => changeMode("absolute")}>Absolute</button>
        </div>}>
        <div className="ag-body">
            <svg ref={svgRef} className="ag-arena" viewBox={`0 0 ${ARENA_SIZE} ${ARENA_SIZE}`} role="img" aria-label="Arena preview: drag Me or Opp"
                onPointerMove={moveDrag} onPointerUp={() => { dragRef.current = null; }} onPointerCancel={() => { dragRef.current = null; }}>
                <defs><marker id="ag-arrow-head" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto"><path d="M0 0L10 5L0 10z" fill="#4ade80" /></marker></defs>
                {GRID_LINES.map((line) => <g key={line}>
                    <line x1={line} y1="0" x2={line} y2={ARENA_SIZE} stroke="#151b20" />
                    <line x1="0" y1={line} x2={ARENA_SIZE} y2={line} stroke="#151b20" />
                </g>)}
                {!relative && <g>
                    <circle cx={bot.x} cy={bot.y} r="70" fill="none" stroke="#1f262d" />
                    {COMPASS.map(([name, degrees]) => {
                        const at = headingVector(degrees, 82);
                        return <text key={name} x={bot.x + at.x} y={bot.y + at.y + 4} textAnchor="middle" className="ag-compass">{name} <tspan className="ag-mono" fill="#5f6b76">{degrees}</tspan></text>;
                    })}
                </g>}
                {relative
                    ? <line x1={bot.x} y1={bot.y} x2={target.x} y2={target.y} stroke="#8b98a5" strokeWidth="1.5" strokeDasharray="4 4" />
                    : <line x1={bot.x} y1={bot.y} x2={bot.x + north.x} y2={bot.y + north.y} stroke="#8b98a5" strokeWidth="1.5" strokeDasharray="4 4" />}
                {Math.abs(normalized) >= 1 && <path d={`M${bot.x + arcStart.x} ${bot.y + arcStart.y}A30 30 0 0 ${normalized > 0 ? 1 : 0} ${bot.x + arcEnd.x} ${bot.y + arcEnd.y}`} fill="none" stroke="#facc15" strokeWidth="1.5" />}
                {Math.abs(normalized) >= 1 && <text x={bot.x + labelAt.x - 10} y={bot.y + labelAt.y + 4} fill="#facc15" className="ag-mono ag-arc-label">{direction}°</text>}
                {trail.length > 1 && <polyline points={trail.map((point) => `${point.x},${point.y}`).join(" ")} fill="none" stroke="#4ade80" strokeWidth="1.5" strokeDasharray="2 3" opacity=".8" />}
                <line x1={bot.x} y1={bot.y} x2={bot.x + arrow.x} y2={bot.y + arrow.y} stroke="#4ade80" strokeWidth="2.5" markerEnd="url(#ag-arrow-head)" />
                <g transform={`translate(${target.x},${target.y})`} opacity={relative ? 1 : 0.35} className="ag-piece" onPointerDown={startDrag("target")}>
                    <circle r="13" fill="#3a1418" stroke="#ff7166" strokeWidth="2" />
                    <text textAnchor="middle" y="4" className="ag-piece-label" fill="#ffd3cf">Opp</text>
                </g>
                <g transform={`translate(${bot.x},${bot.y})`} className="ag-piece" onPointerDown={startDrag("bot")}>
                    <circle r="13" fill="#0b2a36" stroke="#5fd4f0" strokeWidth="2" />
                    <text textAnchor="middle" y="4" className="ag-piece-label" fill="#cdf3fc">Me</text>
                </g>
                <text x="150" y="290" textAnchor="middle" className="ag-hint">Drag Me or Opp</text>
            </svg>
            <div className="ag-controls">
                <div className="ag-row">
                    <span>{label}</span>
                    <span className="ag-number-wrap"><AngleNumberBox value={direction} onCommit={changeDirection} label={`${label} in degrees`} /><span>deg</span></span>
                </div>
                <div className="ag-chips" role="group" aria-label="Preset angles">
                    {ANGLE_PRESETS[mode].map((preset) => <button key={preset} type="button" className={preset === direction ? "is-active" : ""} aria-pressed={preset === direction} onClick={() => changeDirection(preset)}>{preset}°</button>)}
                </div>
                <div className="ag-says" aria-live="polite"><b>{caption.title}</b><small>{caption.detail}</small></div>
                <div className="ag-buttons">
                    <button type="button" className="ag-button" onClick={play}>{playing ? "Pause" : "Play"}</button>
                    <button type="button" className="ag-button" onClick={reset}>Reset</button>
                </div>
                <p className="ag-footnote">{ANGLE_FOOTNOTES[mode]}</p>
            </div>
        </div>
    </Shell>;
}

function LandingPanel({ title, children, caption, label }) {
    return <figure className="ag-panel">
        <figcaption>{title}</figcaption>
        <svg viewBox="0 0 260 150" role="img" aria-label={label}>
            <defs>
                <marker id="ag-ph-travel" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#4ade80" /></marker>
                <marker id="ag-ph-facing" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5" markerHeight="5" orient="auto"><path d="M 0 0 L 10 5 L 0 10 z" fill="#5fd4f0" /></marker>
            </defs>
            {children}
        </svg>
        <p>{caption}</p>
    </figure>;
}

/** Why Phase Strike's landing rotation matters, in the same shell as the movement guide. */
export function PhaseStrikeLandingModal({ onClose }) {
    return <Shell titleId="phase-strike-landing-title" title="Landing rotation" onClose={onClose} closeLabel="Close landing rotation guide">
        <div className="ag-copy">
            <p>At 180°, Phase Strike travels forward from the activation facing, phases through the target, then lands behind it facing back toward where it came from.</p>
            <div className="ag-panels">
                <LandingPanel title="Before the hit" label="Before the hit: the bot faces the target and strikes forward" caption="Faces the target and hits forward.">
                    <line x1="24" y1="70" x2="236" y2="70" stroke="#2f3740" strokeWidth="2" strokeDasharray="4 4" />
                    <circle cx="56" cy="70" r="15" fill="#0b2a36" stroke="#5fd4f0" strokeWidth="2" />
                    <circle cx="200" cy="70" r="15" fill="#3a1418" stroke="#ff7166" strokeWidth="2" />
                    <line x1="56" y1="70" x2="90" y2="70" stroke="#5fd4f0" strokeWidth="3" markerEnd="url(#ag-ph-facing)" />
                    <line x1="76" y1="94" x2="180" y2="94" stroke="#4ade80" strokeWidth="3" markerEnd="url(#ag-ph-travel)" />
                    <text x="56" y="120" textAnchor="middle" className="ag-ph-label">Bot</text>
                    <text x="200" y="120" textAnchor="middle" className="ag-ph-label">Target</text>
                </LandingPanel>
                <LandingPanel title="After the hit at 180°" label="After the hit at 180 degrees: the bot lands behind the target facing back" caption="Lands behind, facing back.">
                    <line x1="24" y1="70" x2="236" y2="70" stroke="#2f3740" strokeWidth="2" strokeDasharray="4 4" />
                    <line x1="24" y1="94" x2="204" y2="94" stroke="#4ade80" strokeWidth="2" strokeDasharray="5 5" markerEnd="url(#ag-ph-travel)" />
                    <circle cx="120" cy="70" r="15" fill="#3a1418" stroke="#ff7166" strokeWidth="2" />
                    <circle cx="204" cy="70" r="15" fill="#0b2a36" stroke="#5fd4f0" strokeWidth="2" />
                    <line x1="204" y1="70" x2="170" y2="70" stroke="#5fd4f0" strokeWidth="3" markerEnd="url(#ag-ph-facing)" />
                    <text x="120" y="120" textAnchor="middle" className="ag-ph-label">Target</text>
                    <text x="204" y="120" textAnchor="middle" className="ag-ph-label">Bot</text>
                </LandingPanel>
            </div>
            <p className="ag-footnote">The rotation happens after the hit. The travel direction comes from the bot’s original facing. The landing rotation is applied only after the bot reaches the far side of the target. For other values, the bot rotates by this value relative to the facing it had when the ability started.</p>
        </div>
    </Shell>;
}
