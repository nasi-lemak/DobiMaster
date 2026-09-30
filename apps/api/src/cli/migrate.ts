import { createPool } from '../db/index.js';
import { migrate } from '../db/migrate.js';

const pool = createPool();
migrate(pool)
  .then(() => console.log('migrations up to date'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
