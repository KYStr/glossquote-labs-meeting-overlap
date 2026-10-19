import { verifyProductionBuild } from './lib/production.mjs';
import { createProductionServer } from './lib/production-server.mjs';
const server = createProductionServer(await verifyProductionBuild());
server.on('error', () => { console.error('Production model could not bind 127.0.0.1:5214; existing processes preserved.'); process.exitCode = 1; });
server.listen(5214, '127.0.0.1', () => console.log(`Production HTTP model PID ${process.pid}: http://127.0.0.1:5214/index.html`));
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => server.close());
