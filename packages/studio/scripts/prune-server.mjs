// Post-build worker pruner.
//
// The Cloudflare worker build (dist/server) is deployed with `no_bundle: true`
// and a rule that uploads EVERY *.js / *.mjs file in the directory as a worker
// module — and a Worker's size limit counts every uploaded module, even lazy
// chunks the worker never executes.
//
// Two things leak heavy client-only code into dist/server:
//   1. Vite's `config.worker` build is global, so Monaco's web-worker bundles
//      (ts/css/html/json/editor.worker — ~9 MB) are emitted into *every*
//      environment's outDir, including the worker's, even though the SSR graph
//      (with monaco.ts stubbed in vite.config.ts) never imports them.
//   2. Any other code-split chunk that ends up unreferenced.
//
// So we walk the real import graph from the worker entry (index.js) and delete
// any *.js / *.mjs under dist/server that isn't reachable from it. This is safe
// by construction: if the entry can't reach a module, the worker can never load
// it at runtime. The client build (dist/client) is untouched and still ships
// every chunk it needs.
import { fileURLToPath } from 'node:url';
import { dirname, resolve, relative, join } from 'node:path';
import { readFileSync, readdirSync, rmSync, statSync } from 'node:fs';

const here = dirname(fileURLToPath(import.meta.url));
const serverDir = resolve(here, '../dist/server');
const entry = resolve(serverDir, 'index.js');

// Match relative module specifiers in `import ... from"./x.js"`, `import("./x.js")`,
// `export ... from"./x.js"`, etc. Only .js/.mjs — those are the worker modules.
const SPEC_RE = /(?:from\s*|import\s*\(\s*)["'](\.{1,2}\/[^"']+?\.m?js)["']/g;

function readSpecs(file) {
  let code;
  try { code = readFileSync(file, 'utf8'); } catch { return []; }
  const out = new Set();
  for (const m of code.matchAll(SPEC_RE)) out.add(m[1]);
  return [...out];
}

// BFS the reachable set starting from the entry.
const reachable = new Set([entry]);
const queue = [entry];
while (queue.length) {
  const file = queue.shift();
  const base = dirname(file);
  for (const spec of readSpecs(file)) {
    const dep = resolve(base, spec);
    if (!dep.startsWith(serverDir)) continue; // never escape dist/server
    if (!reachable.has(dep)) { reachable.add(dep); queue.push(dep); }
  }
}

// Collect every *.js / *.mjs under dist/server, then delete the unreachable ones.
function allJs(dir) {
  const out = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...allJs(p));
    else if (/\.m?js$/.test(name)) out.push(p);
  }
  return out;
}

let removed = 0;
let freed = 0;
for (const file of allJs(serverDir)) {
  if (reachable.has(file)) continue;
  freed += statSync(file).size;
  rmSync(file);
  removed++;
}

console.log(
  `[prune-server] kept ${reachable.size} reachable module(s), removed ${removed} orphan(s), freed ${(freed / 1024 / 1024).toFixed(2)} MB`,
);
