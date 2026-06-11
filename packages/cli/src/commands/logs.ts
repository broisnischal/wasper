import { logFile, readAllDaemonStates } from '../daemon';
import { paint } from '../ui';

export async function run() {
  const args    = process.argv.slice(2).filter(a => a !== 'logs');
  const follow  = args.includes('-f') || args.includes('--follow');
  const portIdx = args.findIndex(a => a === '--port' || a === '-p');
  const portArg = portIdx >= 0 ? parseInt(args[portIdx + 1] ?? '', 10) : undefined;
  const nIdx    = args.findIndex(a => a === '-n' || a === '--lines');
  const lines   = nIdx >= 0 ? (args[nIdx + 1] ?? '100') : '100';

  // Resolve which port's log to show
  let port = portArg;
  if (!port) {
    const all = await readAllDaemonStates();
    if (all.length === 0) {
      console.log(`\n  ${paint.yellow('○')}  wasper is not running  ${paint.dim('→ wasper up')}\n`);
      process.exit(1);
    }
    if (all.length > 1) {
      console.log(`\n  ${paint.yellow('○')}  Multiple instances — specify --port:\n`);
      for (const s of all) console.log(`     :${s.port}  ${paint.dim(s.specUrl ?? 'no spec')}`);
      console.log(`\n  ${paint.dim('wasper logs --port <port> [-f]')}\n`);
      process.exit(1);
    }
    port = all[0]!.port;
  }

  const path = logFile(port);
  const file = Bun.file(path);
  if (!(await file.exists())) {
    console.log(`\n  ${paint.yellow('○')}  No log file for :${port}`);
    console.log(`  ${paint.dim('Expected: ' + path)}\n`);
    process.exit(1);
  }

  const tailArgs = follow
    ? ['tail', '-f', '-n', lines, path]
    : ['tail', '-n', lines, path];

  const proc = Bun.spawn(tailArgs, { stdout: 'inherit', stderr: 'inherit' });
  await proc.exited;
}
