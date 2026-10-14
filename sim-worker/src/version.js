import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = new URL('../engine-version.json', import.meta.url);

// Hash sorted relative paths and exact bytes, with unambiguous length prefixes. Folders named tests/ are skipped.
export function hashContracts(engine = path.join(root, 'shared', 'engine')) {
    const hash = createHash('sha256');
    function visit(relative) {
        const dir = path.join(engine, relative);
        for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const name = relative ? `${relative}/${entry.name}` : entry.name;
            if (entry.isDirectory()) {
                if (entry.name !== 'tests') visit(name);
            } else if (entry.isFile()) {
                const bytes = readFileSync(path.join(engine, name));
                hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
                hash.update(bytes);
            }
        }
    }
    visit('');
    return hash.digest('hex');
}

function gitCommit() {
    try {
        const commit = execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
        return /^[0-9a-f]{40}$/.test(commit) ? commit : 'unknown';
    } catch {
        return 'unknown';
    }
}

// Never throws: no manifest, a stale manifest, or no git all fall back to git, then to "unknown".
export function engineVersion({ fromGit = false } = {}) {
    const contractsHash = hashContracts();
    let commit = null;
    if (!fromGit) {
        try {
            const saved = JSON.parse(readFileSync(manifest, 'utf8'));
            if (saved.contractsHash === contractsHash && typeof saved.commit === 'string') commit = saved.commit;
        } catch {
            // Missing or unreadable manifest: fall back to git below.
        }
    }
    commit ??= gitCommit();
    return { commit, contractsHash, engineVersion: `${commit}:${contractsHash}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
    writeFileSync(manifest, `${JSON.stringify(engineVersion({ fromGit: true }))}\n`);
}
