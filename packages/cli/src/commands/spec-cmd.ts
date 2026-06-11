import { readAllDaemonStates, readDaemonState, isProcessAlive } from '../daemon';
import { paint } from '../ui';

export async function run() {
  const args    = process.argv.slice(2).filter(a => a !== 'spec');
  const portIdx = args.findIndex(a => a === '--port' || a === '-p');
  const portArg = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '', 10) : undefined;
  const url     = args.find(a => !a.startsWith('-') && a !== args[portIdx + 1]);

  if (!url) {
    console.log(`\n  ${paint.red('✗')}  Usage: wasper spec <url> [--port <port>]`);
    console.log(`  ${paint.dim('Load a new OpenAPI spec on the running daemon')}\n`);
    process.exit(1);
  }

  const state = portArg
    ? await readDaemonState(portArg)
    : await resolveSingleDaemon();

  if (!state || !isProcessAlive(state.pid)) {
    console.log(`\n  ${paint.yellow('○')}  wasper is not running  ${paint.dim('→ wasper up --url ' + url)}\n`);
    process.exit(1);
  }

  const port = state.port !== 3388 ? `  ${paint.dim(':' + state.port)}` : '';
  process.stdout.write(`\n  ${paint.dim('→')}  Loading ${paint.cyan(url)}...${port}\n`);

  try {
    const res = await fetch(`http://localhost:${state.port}/api/spec/reload-url`, {
      method:  'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
      },
      body:   JSON.stringify({ url }),
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json() as {
      ok?: boolean; error?: string;
      spec?: { title: string; version: string }; endpointCount?: number;
    };

    if (!res.ok || data.error) {
      console.log(`  ${paint.red('✗')}  ${data.error ?? 'Failed to load spec'}\n`);
      process.exit(1);
    }

    const title = data.spec?.title ?? url;
    const ver   = data.spec?.version ? `  ${paint.dim('v' + data.spec.version)}` : '';
    const eps   = data.endpointCount != null ? `  ${paint.dim('·')}  ${paint.green(data.endpointCount + ' endpoints')}` : '';
    console.log(`  ${paint.green('✓')}  ${paint.bold(title)}${ver}${eps}\n`);
  } catch (e) {
    console.log(`  ${paint.red('✗')}  ${e instanceof Error ? e.message : String(e)}\n`);
    process.exit(1);
  }
  process.exit(0);
}

async function resolveSingleDaemon() {
  const all = await readAllDaemonStates();
  if (all.length <= 1) return all[0] ?? null;
  console.log(`\n  ${paint.yellow('○')}  Multiple instances running — specify --port:\n`);
  for (const s of all) console.log(`     :${s.port}  ${paint.dim(s.specUrl ?? 'no spec')}`);
  console.log();
  process.exit(1);
}
