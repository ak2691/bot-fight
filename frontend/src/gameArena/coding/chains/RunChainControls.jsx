import { MAX_CHAINS } from "../../../../../shared/engine/botlogic/code/configuration/constants.js";

const NEW_CHAIN = "__new__";

/** Settings of a Run chain action: which chain to start. A running chain is never replaced; end it from inside the chain. */
export function RunChainControls({ entry, chains, disabled, onChange, onNewChain, onOpenChain = null }) {
    const known = chains.some((chain) => chain.id === entry.chainId);
    const atLimit = chains.length >= MAX_CHAINS;
    return <>
        <label className="code-inspector-field"><span>Chain</span>
            <select disabled={disabled} aria-label="Chain to run" value={known ? entry.chainId : ""} onChange={(event) => {
                if (event.target.value === NEW_CHAIN) onNewChain();
                else onChange({ ...entry, chainId: event.target.value });
            }}>
                {!known && <option value="" disabled>Choose a chain</option>}
                {chains.map((chain) => <option key={chain.id} value={chain.id}>{chain.name}</option>)}
                <option value={NEW_CHAIN} disabled={atLimit}>{atLimit ? `New chain… (limit ${MAX_CHAINS})` : "New chain…"}</option>
            </select>
        </label>
        {known && onOpenChain && <button type="button" className="cx-open-chain" onClick={() => onOpenChain(entry.chainId)}>Open chain</button>}
    </>;
}
