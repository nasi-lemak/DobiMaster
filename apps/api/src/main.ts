import { config } from './config.js';
import { buildApp } from './app.js';
import { createPool } from './db/index.js';
import { migrate } from './db/migrate.js';

const pool = createPool();
await migrate(pool, (m) => console.log(m));
const { app } = await buildApp({ pool, runJobs: true });
await app.listen({ port: config.port, host: config.host });

for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, async () => {
    await app.close();
    await pool.end();
    process.exit(0);
  });
}
