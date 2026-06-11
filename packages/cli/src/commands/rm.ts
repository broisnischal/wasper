import { dbQueries } from '../db/index';
import { paint } from '../ui';

export async function run() {
  const args = process.argv.slice(2).filter(a => !a.startsWith('-'));
  const target = args[1];

  if (!target) {
    console.error(`\n  Usage: wasper rm <number|url>\n`);
    process.exit(1);
  }

  const history = dbQueries.getSpecHistory();

  let id: string | null = null;
  let label: string | null = null;

  const num = parseInt(target, 10);
  if (!isNaN(num) && num >= 1 && num <= history.length) {
    const row = history[num - 1];
    if (row) { id = row.id; label = row.title ?? row.url; }
  } else {
    const match = history.find(r => r.url === target || r.title?.toLowerCase().includes(target.toLowerCase()));
    if (match) { id = match.id; label = match.title ?? match.url; }
  }

  if (!id) {
    console.error(`\n  ${paint.red('✗')}  Spec not found: ${target}\n`);
    process.exit(1);
  }

  dbQueries.deleteSpec(id);
  console.log(`\n  ${paint.green('✓')}  Removed ${paint.dim(label ?? id)}\n`);
  process.exit(0);
}
