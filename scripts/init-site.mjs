import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--project-id' || !/^appgprj_[a-zA-Z0-9_-]+$/.test(args[1])) {
  throw new Error('Usage: npm run site:init -- --project-id <ID returned by your own Sites instance>');
}
const file = path.join(root, '.openai/hosting.json');
const config = JSON.parse(await readFile(file, 'utf8'));
if (config.project_id && config.project_id !== args[1]) {
  throw new Error('This clone is already bound to a different Site. Use a separate clean clone.');
}
config.project_id = args[1];
await writeFile(file, JSON.stringify(config, null, 2) + '\n');
console.log('Saved your Site identity. No resources were created or deployed.');
