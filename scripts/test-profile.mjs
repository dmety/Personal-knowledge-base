import {build} from 'esbuild';
import path from 'node:path';
import {pathToFileURL} from 'node:url';
await build({entryPoints:['tests/profile.test.ts'],bundle:true,platform:'node',format:'esm',packages:'external',outfile:'.sites-runtime/profile.test.mjs',plugins:[{name:'test-worker-env',setup(b){b.onResolve({filter:/^cloudflare:workers$/},()=>({path:path.resolve('tests/worker-env.ts')}));}}]});
await import(pathToFileURL(path.resolve('.sites-runtime/profile.test.mjs')).href);
