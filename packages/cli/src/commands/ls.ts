import { dbQueries } from '../db/index';
import { paint, isTTY } from '../ui';

function ago(ts: number): string {
  const secs = Math.floor(Date.now() / 1000) - ts;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < 86400 * 30) return `${Math.floor(secs / 86400)}d ago`;
  return new Date(ts * 1000).toLocaleDateString();
}

export async function run() {
  const history = dbQueries.getSpecHistory();

  if (history.length === 0) {
    console.log(`\n  No saved specs yet.\n`);
    console.log(`  ${paint.dim('Run:')}  wasper --url <spec-url>\n`);
    process.exit(0);
  }

  const COL_URL  = isTTY ? 50 : 60;
  const COL_TITLE = 28;

  console.log();
  if (isTTY) {
    const header = `  ${'#'.padEnd(3)}  ${'URL'.padEnd(COL_URL)}  ${'Title'.padEnd(COL_TITLE)}  ${'Endpoints'.padEnd(10)}  Last used`;
    console.log(paint.dim(header));
    console.log(paint.dim('  ' + '─'.repeat(header.length - 2)));
  }

  history.forEach((row, i) => {
    const num    = String(i + 1).padEnd(3);
    const url    = row.url.length > COL_URL ? row.url.slice(0, COL_URL - 1) + '…' : row.url.padEnd(COL_URL);
    const title  = (row.title ?? '—').slice(0, COL_TITLE).padEnd(COL_TITLE);
    const eps    = (row.endpoint_count != null ? String(row.endpoint_count) : '—').padEnd(10);
    const time   = ago(row.last_used);
    console.log(`  ${paint.cyan(num)}  ${url}  ${paint.dim(title)}  ${eps}  ${paint.dim(time)}`);
  });

  console.log();
  console.log(paint.dim(`  wasper use <number>  — start server with that spec`));
  console.log(paint.dim(`  wasper rm  <number>  — remove a spec from history`));
  console.log();
  process.exit(0);
}
