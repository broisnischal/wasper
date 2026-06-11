import { dbQueries } from '../db/index';
import { spawnDaemon, writeDaemonState, readDaemonState, isProcessAlive } from '../daemon';
import { getFeatures } from '../config';
import { paint } from '../ui';

export async function run() {
  const raw     = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const portIdx = process.argv.findIndex(a => a === '--port' || a === '-p');
  const PORT    = portIdx >= 0
    ? parseInt(process.argv[portIdx + 1] ?? '3388', 10)
    : parseInt(process.env.WASPER_PORT ?? '3388', 10);

  const target = raw[1]; // raw[0] = 'use'

  if (!target) {
    console.error(`\n  Usage: wasper use <number|url> [--port <port>]\n`);
    process.exit(1);
  }

  const history = dbQueries.getSpecHistory();
  let url: string | null = null;

  const num = parseInt(target, 10);
  if (!isNaN(num) && num >= 1 && num <= history.length) {
    url = history[num - 1]?.url ?? null;
  } else if (target.startsWith('http')) {
    url = target;
  } else {
    const match = history.find(r => r.title?.toLowerCase().includes(target.toLowerCase()));
    if (match) url = match.url;
  }

  if (!url) {
    console.error(`\n  ${paint.red('✗')}  Spec not found: ${target}`);
    console.error(`  Run ${paint.cyan('wasper ls')} to see saved specs.\n`);
    process.exit(1);
  }

  // Stop existing instance on this port, if any
  const existing = await readDaemonState(PORT);
  if (existing && isProcessAlive(existing.pid)) {
    try { process.kill(existing.pid, 'SIGTERM'); } catch { /* already gone */ }
    await Bun.sleep(400);
  }

  const pid = await spawnDaemon(url, PORT, { features: getFeatures() });
  await Bun.sleep(600);
  await writeDaemonState({ pid, port: PORT, specUrl: url, startedAt: Date.now() });

  console.log(`\n  ${paint.green('✓')}  Started on :${PORT}  ${paint.dim(`PID ${pid}`)}`);
  console.log(`  ${paint.dim('↩')}  ${url}`);
  console.log(`  ${paint.dim('➜')}  ${paint.cyan(`http://localhost:${PORT}/`)}\n`);
  process.exit(0);
}
