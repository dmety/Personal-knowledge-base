import { build } from 'esbuild';
import { mkdir } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';
import path from 'node:path';
await mkdir('.sites-runtime',{recursive:true});
await build({entryPoints:['tests/core.test.ts'],bundle:true,platform:'node',format:'esm',outfile:'.sites-runtime/core.test.mjs'});
await import(pathToFileURL(path.resolve('.sites-runtime/core.test.mjs')).href);
