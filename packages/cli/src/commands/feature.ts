import { readAllDaemonStates, readDaemonState, isProcessAlive } from '../daemon';
import { paint } from '../ui';

const FEATURE_NAMES = ['mcp', 'proxy', 'ai', 'readonly'] as const;
type FeatureName = typeof FEATURE_NAMES[number];

const LABELS: Record<FeatureName, string> = {
  mcp:      'MCP endpoint',
  proxy:    'HTTP proxy',
  ai:       'AI chat',
  readonly: 'Read-only mode',
};

export async function run() {
  const args    = process.argv.slice(2);
  const name    = args.find(a => FEATURE_NAMES.includes(a as FeatureName)) as FeatureName;
  const value   = args.find(a => a === 'on' || a === 'off');
  const portIdx = args.findIndex(a => a === '--port' || a === '-p');
  const portArg = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '', 10) : undefined;

  const state = portArg
    ? await readDaemonState(portArg)
    : await resolveSingleDaemon();

  if (!state || !isProcessAlive(state.pid)) {
    const hint = portArg ? `:${portArg}` : '';
    console.log(`\n  ${paint.yellow('○')}  wasper${hint} is not running  ${paint.dim('→ wasper up')}\n`);
    process.exit(1);
  }

  const authHdr: Record<string, string> = state.token
    ? { Authorization: `Bearer ${state.token}` } : {};
  const base = `http://localhost:${state.port}`;

  const cur = await fetch(`${base}/api/features`, {
    headers: authHdr, signal: AbortSignal.timeout(3000),
  }).then(r => r.json()) as Record<string, boolean>;

  const next = value === 'on' ? true : value === 'off' ? false : !cur[name];

  await fetch(`${base}/api/features`, {
    method:  'PUT',
    headers: { 'Content-Type': 'application/json', ...authHdr },
    body:    JSON.stringify({ [name]: next }),
    signal:  AbortSignal.timeout(3000),
  });

  const port   = state.port !== 3388 ? `  ${paint.dim(':' + state.port)}` : '';
  const icon   = next ? paint.green('✓') : paint.yellow('○');
  const status = next ? paint.green('on') : paint.yellow('off');
  console.log(`\n  ${icon}  ${LABELS[name]}  ${status}${port}\n`);
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
