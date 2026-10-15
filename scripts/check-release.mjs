import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const readJson = async file => JSON.parse(await readFile(path.join(root, file), 'utf8'));
const manifest = await readJson('plugins/zhixu/plugin.json');
const compatibility = await readJson('plugins/zhixu/.codex-plugin/plugin.json');
const marketplace = await readJson('.agents/plugins/marketplace.json');
const config = await readJson('.openai/hosting.json');
assert.deepEqual(config, { d1: 'DB', r2: 'BUCKET', capabilities: ['mcp'] }, 'Public source must not bind an existing Site');
assert.equal(manifest.name, 'zhixu');
assert.equal(manifest.version, '0.1.0');
assert.equal(compatibility.version, manifest.version);
assert.equal(manifest.license, 'MIT');
assert.equal(marketplace.plugins.length, 1);
assert.equal(marketplace.plugins[0].source.path, './plugins/zhixu');
assert.ok(['ON_USE', 'ON_INSTALL'].includes(marketplace.plugins[0].policy.authentication));
assert.equal(marketplace.plugins[0].policy.installation, 'AVAILABLE');
const extension = manifest.extensions['com.openai'];
assert.deepEqual(extension.interface, compatibility.interface);
assert.equal(extension.interface.displayName.length <= 30, true);
assert.equal(extension.interface.shortDescription.length <= 30, true);
for (const field of ['logo', 'composerIcon']) {
  const value = extension.interface[field];
  assert.ok(value.startsWith('./') && !value.includes('..'));
  const svg = await readFile(path.join(root, 'plugins/zhixu', value), 'utf8');
  assert.match(svg, /viewBox="0 0 256 256"/);
}
assert.ok(extension.onboardingSkill.startsWith('./skills/'));
await readFile(path.join(root, 'plugins/zhixu', extension.onboardingSkill));
for (const field of ['apps', 'mcpServers', 'hooks']) {
  assert.equal(field in extension, false, 'Skills package must not wire a service');
}
const skip = new Set(['.git', 'node_modules', '.next', '.vinext', '.wrangler', '.sites-runtime', 'dist', 'outputs', 'releases', 'test-results']);
let scanned = 0;
async function scan(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    if (skip.has(item.name)) continue;
    const file = path.join(directory, item.name);
    if (item.isDirectory()) { await scan(file); continue; }
    const relative = path.relative(root, file);
    assert.ok(!/\.(?:sqlite|db|pem|tar|gz|zip)$/i.test(item.name), `Private/build artifact: ${relative}`);
    assert.ok(!item.name.startsWith('.env') || item.name === '.env.example', `Environment file: ${relative}`);
    if (/\.(?:png|jpg|woff2?|ico)$/i.test(item.name)) continue;
    const text = await readFile(file, 'utf8');
    assert.ok(!/appgprj_[a-f0-9]{20,}|plugin_asdk_app_sites_[a-f0-9]{20,}|oaiapp_[a-f0-9]{20,}/i.test(text), `Instance identity: ${relative}`);
    assert.ok(!/https?:\/\/[^\s"')]*\.chatgpt\.site\b/i.test(text), `Bound Site URL: ${relative}`);
    assert.ok(!/https?:\/\/(?:www\.)?zhixu\.click\b/i.test(text), `Publisher Site URL: ${relative}`);
    assert.ok(!/[A-Z]:[\\/]Users[\\/]|[A-Z]:[\\/]Program Files/i.test(text), `Machine path: ${relative}`);
    assert.ok(!/(?:ghp_|github_pat_)[a-zA-Z0-9_]{20,}|-----BEGIN (?:RSA |OPENSSH )?PRIVATE KEY-----/.test(text), `Credential: ${relative}`);
    if (file.includes(`${path.sep}plugins${path.sep}`)) {
      assert.ok(!['mcp.json', '.mcp.json', '.app.json'].includes(item.name), 'No service wiring in skills package');
      if (item.name === 'SKILL.md') {
        assert.match(text, /^---\r?\nname: [a-z0-9-]+\r?\ndescription: .+\r?\n---/);
      }
    }
    scanned++;
  }
}
await scan(root);
assert.equal(await readFile(path.join(root, 'skills/knowledge-workflow/SKILL.md'), 'utf8'), await readFile(path.join(root, 'plugins/zhixu/skills/knowledge-workflow/SKILL.md'), 'utf8'));
console.log(`PASS: marketplace, plugin assets, skills and ${scanned} public files contain no bound instance or private artifacts.`);
