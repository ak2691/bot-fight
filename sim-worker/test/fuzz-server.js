// Test-only real HTTP worker used by the Java fuzz harness; never a production entry point.
import { createWorkerService } from '../src/server.js';
import { engineVersion } from '../src/version.js';
const service = createWorkerService({ secret: 'fuzz-test-only', threads: 1, logger: () => {}, version: engineVersion({ fromGit: true }) });
service.server.listen(0, '127.0.0.1', () => console.log(service.server.address().port));
process.stdin.resume();
process.stdin.on('end', async () => { await service.close(); process.exit(0); });
