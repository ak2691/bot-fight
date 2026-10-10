import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../../', import.meta.url));
const manifest = new URL('../engine-version.json', import.meta.url);

// Hash sorted relative paths and exact bytes, with unambiguous length prefixes.
export function hashContracts(shared = path.join(root, 'shared')) {
    const hash = createHash('sha256');
    function visit(relative) {
        for (const entry of readdirSync(path.join(shared, relative), { withFileTypes: true }).sort((a, b) => a.name < b.name ? -1 : a.name > b.name ? 1 : 0)) {
            const name = `${relative}/${entry.name}`;
            if (entry.isDirectory()) visit(name);
            else if (entry.isFile()) {
                const bytes = readFileSync(path.join(shared, name));
                hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
                hash.update(bytes);
            }
        }
    }
    visit('gameplay');
    visit('schemas');
    return hash.digest('hex');
}

export function engineVersion({ fromGit = false } = {}) {
    const contractsHash = hashContracts();
    const gitCommit = () => execFileSync('git', ['rev-parse', 'HEAD'], { cwd: root, encoding: 'utf8' }).trim();
    let commit;
    if (fromGit) {
        commit = gitCommit();
    } else {
        try {
            const saved = JSON.parse(readFileSync(manifest, 'utf8'));
            if (saved.contractsHash !== contractsHash) throw new Error('Engine version manifest is stale; run npm run version:write');
            commit = saved.commit;
        } catch (error) {
            if (error.code !== 'ENOENT') throw error;
            commit = gitCommit();
        }
    }
    if (!/^[0-9a-f]{40}$/.test(commit)) throw new Error('Engine version requires a full Git commit');
    return { commit, contractsHash, engineVersion: `${commit}:${contractsHash}` };
}

if (process.argv[1] === fileURLToPath(import.meta.url) && process.argv.includes('--write')) {
    writeFileSync(manifest, `${JSON.stringify(engineVersion({ fromGit: true }))}\n`);
    execFileSync(process.execPath, [path.join(root, "tools/write-build-version.mjs")]);
}
