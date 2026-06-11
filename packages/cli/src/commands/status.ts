import { readDaemonState, readAllDaemonStates, isProcessAlive } from '../daemon';
import { printStatus, paint } from '../ui';

function uptime(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60)   return `${secs}s`;
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export async function run() {
  const args    = process.argv.slice(2).filter(a => a !== 'status');
  const portIdx = args.findIndex(a => a === '--port' || a === '-p');
  const portArg = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '', 10) : undefined;

  // ── Single port ──────────────────────────────────────────────────────────────
  if (portArg) {
    const state = await readDaemonState(portArg);
    if (!state || !isProcessAlive(state.pid)) {
      console.log(`\n  ${paint.dim('○')}  No instance on :${portArg}\n`);
      process.exit(1);
    }
    await printSingleStatus(state);
    process.exit(0);
  }

  // ── All instances ────────────────────────────────────────────────────────────
  const all = await readAllDaemonStates();

  if (all.length === 0) {
    printStatus({ running: false });
    process.exit(0);
  }

  if (all.length === 1) {
    await printSingleStatus(all[0]!);
    process.exit(0);
  }

  // Multiple instances — compact table
  console.log(`\n  ${paint.green('●')}  ${paint.bold('wasper')}  ${all.length} instances running\n`);
  for (const s of all) {
    const base = s.origin ?? `http://localhost:${s.port}`;
    let specInfo = '';
    try {
      const res = await fetch(`http://localhost:${s.port}/api/server-info`, {
        headers: s.token ? { Authorization: `Bearer ${s.token}` } : undefined,
        signal:  AbortSignal.timeout(1500),
      });
      if (res.ok) {
        const info = await res.json() as { spec?: { title: string; endpointCount: number } | null };
        if (info.spec) specInfo = `  ${info.spec.title}  ${paint.dim(info.spec.endpointCount + ' ep')}`;
      }
    } catch { /* unreachable */ }

    console.log(`  ${paint.green('●')}  :${String(s.port).padEnd(5)} ${paint.cyan(base + '/')}${specInfo}`);
    console.log(`     ${paint.dim(`PID ${s.pid}  up ${uptime(s.startedAt)}`)}`);
  }
  console.log(`\n  ${paint.dim('wasper status --port <port>  —  details for one instance')}\n`);
  process.exit(0);
}

async function printSingleStatus(state: ReturnType<typeof readDaemonState> extends Promise<infer T> ? NonNullable<T> : never) {
  interface SpecInfo { title: string; version: string; endpointCount: number; specUrl: string | null }
  let spec: SpecInfo | null = null;
  try {
    const res = await fetch(`http://localhost:${state.port}/api/server-info`, {
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : undefined,
      signal:  AbortSignal.timeout(2000),
    });
    if (res.ok) {
      const info = await res.json() as { spec: SpecInfo | null };
      spec = info.spec;
    }
  } catch { /* server up but unreachable */ }

  printStatus({
    running:      true,
    pid:          state.pid,
    port:         state.port,
    uptime:       Date.now() - state.startedAt,
    specTitle:    spec?.title ?? undefined,
    specVersion:  spec?.version ?? undefined,
    endpointCount: spec?.endpointCount ?? undefined,
    specUrl:      spec?.specUrl ?? undefined,
    origin:       state.origin ?? undefined,
  });
}
