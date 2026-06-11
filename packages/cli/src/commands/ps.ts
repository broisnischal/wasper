import { readAllDaemonStates } from '../daemon';
import { paint } from '../ui';

function uptime(startedAt: number): string {
  const secs = Math.floor((Date.now() - startedAt) / 1000);
  if (secs < 60)    return `${secs}s`;
  if (secs < 3600)  return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}

export async function run() {
  const all = await readAllDaemonStates();

  if (all.length === 0) {
    console.log(`\n  ${paint.dim('○')}  No running instances\n  ${paint.dim('wasper up --url <spec> [--port <port>]')}\n`);
    process.exit(0);
  }

  console.log();
  const header = `  ${'PORT'.padEnd(7)}  ${'PID'.padEnd(8)}  ${'UP'.padEnd(6)}  ${'SPEC / URL'}`;
  console.log(paint.dim(header));
  console.log(paint.dim('  ' + '─'.repeat(header.length - 2)));

  for (const s of all) {
    const port   = paint.green(String(s.port).padEnd(7));
    const pid    = paint.dim(String(s.pid).padEnd(8));
    const up     = paint.dim(uptime(s.startedAt).padEnd(6));
    const spec   = s.specUrl ? s.specUrl : paint.dim('no spec');
    console.log(`  ${port}  ${pid}  ${up}  ${spec}`);
  }

  console.log();
  console.log(paint.dim(`  wasper status --port <port>  —  details`));
  console.log(paint.dim(`  wasper down --port <port>    —  stop one`));
  console.log(paint.dim(`  wasper down --all            —  stop all`));
  console.log();
  process.exit(0);
}
