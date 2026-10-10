import { MAX_CHAIN_STEPS } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";
import { stepMeterState } from "./chainEditing.js";

/** Toolbar identity while a chain is open: "← Brain › name". The arrow goes back to the main canvas. */
export function ChainCrumb({ name, onBack }) {
    return <div className="code-tb-bot cx-crumb" role="group" aria-label="Chain">
        <button type="button" className="cx-crumb-back" onClick={onBack} aria-label="Back to the brain" title="Back to the brain">
            <span aria-hidden="true">←</span><span className="cx-crumb-label">Brain</span>
        </button>
        <span className="cx-crumb-sep" aria-hidden="true">›</span>
        <span className="cx-crumb-name" title={name}>{name}</span>
    </div>;
}

/** "14 / 32 steps": amber close to the limit, red next to it. */
export function ChainStepMeter({ count, max = MAX_CHAIN_STEPS }) {
    return <div className={`code-tb-meter cx-step-meter ${stepMeterState(count)}`} role="group" aria-label="Chain steps" title={`${count} of ${max} steps used`}>
        <span className="code-tb-meter-text"><b>{count} / {max}</b> steps</span>
        <span className="code-tb-meter-bar" aria-hidden="true"><span style={{ width: `${Math.min(100, Math.round((count / max) * 100))}%` }} /></span>
    </div>;
}
