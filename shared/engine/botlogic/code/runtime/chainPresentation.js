/** Presentation snapshot only; it cannot resume or control the chain runtime. */
export function runningChainSnapshot(stack, chains = []) {
    const frame = Array.isArray(stack) ? stack.at(-1) : null;
    if (!frame) return null;
    const chain = chains instanceof Map ? chains.get(frame.chainId) : chains.find((entry) => entry.id === frame.chainId);
    return {
        chainId: frame.chainId,
        path: [...frame.path],
        callDepth: stack.length,
        name: chain?.name ?? frame.chainId,
    };
}
