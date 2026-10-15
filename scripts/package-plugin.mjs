import './check-release.mjs';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { zipSync, unzipSync } from 'fflate';
import { createHash } from 'node:crypto';
import path from 'node:path';

const manifest = JSON.parse(await readFile('plugins/zhixu/plugin.json', 'utf8'));
const files = {};
async function collect(directory, prefix) {
  for (const item of (await readdir(directory, { withFileTypes: true })).sort((a, b) => a.name.localeCompare(b.name))) {
    const file = path.join(directory, item.name);
    const entry = `${prefix}/${item.name}`;
    if (item.isDirectory()) await collect(file, entry);
    else files[entry] = [new Uint8Array(await readFile(file)), { mtime: new Date('2026-10-15T00:00:00Z') }];
  }
}
await collect('plugins/zhixu', 'zhixu');
const bytes = zipSync(files, { level: 9 });
const unpacked = unzipSync(bytes);
if (!unpacked['zhixu/plugin.json'] || Object.keys(unpacked).some(name => !name.startsWith('zhixu/') || name.includes('..'))) throw new Error('Invalid package layout');
await mkdir('releases', { recursive: true });
const name = `zhixu-plugin-${manifest.version}.zip`;
await writeFile(`releases/${name}`, bytes);
await writeFile('releases/SHA256SUMS', `${createHash('sha256').update(bytes).digest('hex')}  ${name}\n`);
console.log(`Created releases/${name} (${bytes.length} bytes; ${Object.keys(unpacked).length} files).`);
