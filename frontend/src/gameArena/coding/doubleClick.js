// The browser fires "dblclick" for two quick clicks even when they land on different things. A real double-click
// needs both clicks on the same target, so every click is logged with a key for what was clicked.
export function createClickLog() {
    const entries = [];
    return {
        record(key) {
            entries.push({ key, time: performance.now() });
            if (entries.length > 2) entries.shift();
        },
        isDoubleClick(maxMs = 500) {
            return entries.length === 2 && entries[0].key === entries[1].key && entries[1].time - entries[0].time <= maxMs;
        },
    };
}
