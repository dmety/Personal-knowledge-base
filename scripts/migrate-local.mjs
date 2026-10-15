import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

// Create a checkout-local config so Wrangler's native migration ledger provides
// ordering, atomic migrations and idempotence. This script is always --local.
const root = process.cwd();
const config = JSON.parse(await readFile('dist/server/wrangler.json', 'utf8'));
for (const database of config.d1_databases ?? []) {
  database.migrations_dir = path.join(root, 'drizzle');
}
// Original main/assets paths are relative to dist/server; migration-only config
// does not need either entry and must not be usable for deployment.
delete config.main;
delete config.assets;
await mkdir('.sites-runtime', { recursive: true });
const file = '.sites-runtime/migrations.local.json';
await writeFile(file, JSON.stringify(config));
const result = spawnSync(process.execPath, [
  'node_modules/wrangler/bin/wrangler.js', 'd1', 'migrations', 'apply', 'DB',
  '--local', '--config', file, '--persist-to', '.wrangler/state',
], { stdio: 'inherit', env: { ...process.env, CI: 'true' } });
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
