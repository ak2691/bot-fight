import { createHash } from 'node:crypto';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const root = fileURLToPath(new URL('../', import.meta.url));
const hash = createHash('sha256');
function visit(relative) {
    for (const entry of readdirSync(path.join(root, relative), { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, 'en'))) {
        const name = `${relative}/${entry.name}`;
        if (entry.isDirectory()) visit(name);
        else {
            const bytes = readFileSync(path.join(root, name));
            hash.update(`${Buffer.byteLength(name)}:${name}:${bytes.length}:`);
            hash.update(bytes);
        }
    }
}
for (const directory of ['shared/engine', 'shared/gameplay', 'shared/schemas', 'frontend/src', 'server/src/main']) visit(directory);
for (const file of ['frontend/package.json', 'frontend/package-lock.json', 'frontend/vite.config.js', 'server/pom.xml',
    'sim-worker/package.json', 'sim-worker/package-lock.json']) {
    const bytes = readFileSync(path.join(root, file));
    hash.update(`${Buffer.byteLength(file)}:${file}:${bytes.length}:`);
    hash.update(bytes);
}
visit('sim-worker/src');
writeFileSync(path.join(root, 'shared/build-version.txt'), `${hash.digest('hex')}\n`);
