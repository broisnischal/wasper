import { readDaemonState, isProcessAlive } from '../daemon';
import { paint, Spinner } from '../ui';

export async function run() {
  const state = await readDaemonState();

  if (!state || !isProcessAlive(state.pid)) {
    console.log(`\n  ${paint.dim('○')}  ${paint.bold('OpenAPI Agent')}  ·  ${paint.yellow('Not running')}\n`);
    process.exit(1);
  }

  const spinner = new Spinner();
  spinner.start('Reloading spec…');

  try {
    const res = await fetch(`http://localhost:${state.port}/api/reload`, {
      method: 'POST',
      headers: state.token ? { Authorization: `Bearer ${state.token}` } : undefined,
      signal: AbortSignal.timeout(30_000),
    });
    const data = await res.json() as { ok?: boolean; error?: string; spec?: string; endpoints?: number };

    if (!res.ok || data.error) {
      spinner.stop('✗', data.error ?? 'Reload failed', 'red');
      process.exit(1);
    }

    spinner.stop('✓', `Reloaded "${data.spec}" · ${paint.green(String(data.endpoints ?? 0) + ' endpoints')}`, 'green');
    console.log();
    process.exit(0);
  } catch (e) {
    spinner.stop('✗', `Failed: ${e instanceof Error ? e.message : String(e)}`, 'red');
    process.exit(1);
  }
}
