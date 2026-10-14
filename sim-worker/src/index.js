import { createWorkerService } from './server.js';

const service = createWorkerService();
const port = Number(process.env.PORT ?? 8090);
if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('PORT must be between 1 and 65535');
service.server.listen(port, '0.0.0.0', () => console.log(JSON.stringify({ event: 'listening', port, ...service.version })));
let stopping = false;
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, async () => {
    if (stopping) return;
    stopping = true;
    await service.close();
});
