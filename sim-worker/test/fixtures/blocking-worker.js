import { parentPort } from 'node:worker_threads';
import run from '../../src/worker.js';

// Only selectable by the test harness, never through an HTTP field or production config.
export default function blocking(task) {
    if (task.request.seed === 42) {
        parentPort.postMessage('running');
        while (true) { /* prove cancellation kills synchronous CPU work */ }
    }
    return run(task);
}
