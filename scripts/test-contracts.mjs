import { spawnSync } from 'node:child_process';
const run = spawnSync(process.execPath, ['--test', 'tests/contracts.test.mjs'], { stdio: 'inherit' });
process.exit(run.status ?? 1);
