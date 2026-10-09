/**
 * Diffs the browser and server combat logs and per-tick state hashes of the shared golden scenarios. The
 * goldens are what each runtime produces today, so diffing the two golden files is diffing the runtimes.
 *
 * Entries are grouped by tick and stage and compared as sets: the two runtimes may order independent
 * entries inside a stage differently, which is not a gameplay difference. Amounts match to 0.001.
 */
const key = (entry) => JSON.stringify([
    entry.kind, entry.source, entry.target, entry.abilityId, entry.effect,
    entry.amount == null ? null : Math.round(entry.amount * 1000) / 1000,
]);

const groupKey = (entry) => `${String(entry.tick).padStart(4, "0")} ${entry.stage}`;

function group(log) {
    const groups = new Map();
    for (const entry of log) {
        const name = groupKey(entry);
        if (!groups.has(name)) groups.set(name, []);
        groups.get(name).push(key(entry));
    }
    return groups;
}

function subtract(from, remove) {
    const remaining = [...from];
    for (const item of remove) {
        const index = remaining.indexOf(item);
        if (index >= 0) remaining.splice(index, 1);
    }
    return remaining;
}

/** Mismatches for one scenario: { group, side, entry } with side "browser" or "server" (only on that side). */
export function diffLogs(browserLog, serverLog) {
    const browser = group(browserLog);
    const server = group(serverLog);
    const mismatches = [];
    for (const name of [...new Set([...browser.keys(), ...server.keys()])].sort()) {
        const left = browser.get(name) ?? [];
        const right = server.get(name) ?? [];
        for (const entry of subtract(left, right)) mismatches.push({ group: name, side: "browser", entry });
        for (const entry of subtract(right, left)) mismatches.push({ group: name, side: "server", entry });
    }
    return mismatches;
}

/**
 * The first tick (1-based) whose state hash differs, as { tick, browser, server }, or null when the hash lists
 * are identical. A list that ends early differs at the first tick it lacks. To read the difference, dump the
 * unhashed state lines of both runtimes (npm run golden:dump / -Dgolden.debug) and diff them.
 */
export function firstHashMismatch(browserHashes, serverHashes) {
    const ticks = Math.max(browserHashes.length, serverHashes.length);
    for (let index = 0; index < ticks; index += 1) {
        if (browserHashes[index] !== serverHashes[index]) {
            return { tick: index + 1, browser: browserHashes[index] ?? null, server: serverHashes[index] ?? null };
        }
    }
    return null;
}

export function buildReport(browserGolden, serverGolden) {
    const ids = [...new Set([...Object.keys(browserGolden.scenarios), ...Object.keys(serverGolden.scenarios)])];
    return ids.map((id) => {
        const browser = browserGolden.scenarios[id];
        const server = serverGolden.scenarios[id];
        if (!browser || !server) {
            return {
                id, missing: browser ? "server" : "browser", mismatches: [], hashMismatch: null, browserEntries: 0, serverEntries: 0,
            };
        }
        return {
            id,
            missing: null,
            mismatches: diffLogs(browser.log, server.log),
            hashMismatch: firstHashMismatch(browser.hashes ?? [], server.hashes ?? []),
            browserEntries: browser.log.length,
            serverEntries: server.log.length,
        };
    });
}

export function formatReport(report, { perScenario = 8 } = {}) {
    const lines = [];
    const total = report.reduce((sum, scenario) => sum + scenario.mismatches.length, 0);
    const hashDiffs = report.filter((scenario) => scenario.hashMismatch).length;
    const identical = report.filter((scenario) => !scenario.missing && scenario.mismatches.length === 0 && !scenario.hashMismatch).length;
    lines.push(`[parity] browser vs server: ${identical}/${report.length} scenarios identical, ${total} mismatched log entries, ${hashDiffs} scenarios with state-hash mismatches`);
    for (const scenario of report) {
        if (scenario.missing) {
            lines.push(`[parity] ${scenario.id}: no ${scenario.missing} golden`);
            continue;
        }
        if (scenario.hashMismatch) {
            const { tick, browser, server } = scenario.hashMismatch;
            lines.push(`[parity] ${scenario.id}: state hashes first differ at tick ${tick} (browser ${browser}, server ${server})`);
        }
        if (scenario.mismatches.length === 0) continue;
        lines.push(`[parity] ${scenario.id}: ${scenario.mismatches.length} mismatched (${scenario.browserEntries} browser / ${scenario.serverEntries} server entries)`);
        for (const mismatch of scenario.mismatches.slice(0, perScenario)) {
            lines.push(`[parity]   ${mismatch.group} only in ${mismatch.side}: ${mismatch.entry}`);
        }
        if (scenario.mismatches.length > perScenario) {
            lines.push(`[parity]   ... ${scenario.mismatches.length - perScenario} more (PARITY_VERBOSE=1 lists all)`);
        }
    }
    return lines.join("\n");
}
