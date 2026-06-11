import { readDaemonState, readAllDaemonStates, clearDaemonState, isProcessAlive } from '../daemon';
import { paint } from '../ui';

export async function run() {
  const args   = process.argv.slice(2).filter(a => a !== 'down' && a !== 'stop');
  const stopAll = args.includes('--all') || args.includes('-a');

  const portIdx = args.findIndex(a => a === '--port' || a === '-p');
  const portArg = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '', 10) : undefined;

  // ── Stop all ────────────────────────────────────────────────────────────────
  if (stopAll) {
    const all = await readAllDaemonStates();
    if (!all.length) {
      console.log(`\n  ${paint.dim('○')}  No running instances\n`);
      process.exit(0);
    }
    for (const state of all) {
      try { process.kill(state.pid, 'SIGTERM'); } catch { /* */ }
      await Bun.sleep(300);
      await clearDaemonState(state.port);
      const label = state.specUrl ? paint.dim(state.specUrl) : paint.dim('no spec');
      console.log(`  ${paint.green('✓')}  Stopped :${state.port}  ${label}`);
    }
    console.log();
    process.exit(0);
  }

  // ── Stop specific or auto-resolve ────────────────────────────────────────────
  const state = await readDaemonState(portArg);

  if (!state) {
    if (portArg) {
      console.log(`\n  ${paint.dim('○')}  No instance running on :${portArg}\n`);
    } else {
      const all = await readAllDaemonStates();
      if (all.length > 1) {
        console.log(`\n  ${paint.yellow('○')}  Multiple instances running — specify a port or use --all:\n`);
        for (const s of all) {
          console.log(`     :${s.port}  ${paint.dim(s.specUrl ?? 'no spec')}`);
        }
        console.log(`\n  ${paint.dim('wasper down --port <port>  ·  wasper down --all')}\n`);
        process.exit(1);
      }
      console.log(`\n  ${paint.dim('○')}  No running instance found\n`);
    }
    process.exit(1);
  }

  if (!isProcessAlive(state.pid)) {
    await clearDaemonState(state.port);
    console.log(`\n  ${paint.dim('○')}  Process ${state.pid} already gone. Cleaned up state.\n`);
    process.exit(0);
  }

  try {
    process.kill(state.pid, 'SIGTERM');
  } catch {
    console.log(`\n  ${paint.red('✗')}  Failed to stop PID ${state.pid}\n`);
    process.exit(1);
  }

  // Wait up to 3 s for process to die
  for (let i = 0; i < 30; i++) {
    await Bun.sleep(100);
    if (!isProcessAlive(state.pid)) break;
  }

  await clearDaemonState(state.port);
  console.log(`\n  ${paint.green('✓')}  Stopped :${state.port}  ${paint.dim(`PID ${state.pid}`)}\n`);
  process.exit(0);
}
