import { readDaemonState, isProcessAlive } from '../daemon';
import { dbQueries } from '../db/index';
import { paint } from '../ui';

export async function run() {
  const args = process.argv.slice(2).filter(a => a !== 'auth');
  const sub  = args[0] ?? 'list';
  const name = args.slice(1).join(' ');

  if (!sub || sub === 'list') {
    const profiles = dbQueries.getProfiles();
    if (!profiles.length) {
      console.log(`\n  ${paint.dim('○')}  No auth profiles saved`);
      console.log(`  ${paint.dim('Create them in the studio (Authentication tab)')}\n`);
      process.exit(0);
    }
    console.log();
    for (const p of profiles) {
      const mark = p.is_active === 1 ? paint.green('●') : paint.dim('○');
      const desc = p.description ? `  ${paint.dim(p.description)}` : '';
      console.log(`  ${mark}  ${paint.bold(p.name)}  ${paint.dim(`(${p.type})`)}${desc}`);
    }
    console.log(`\n  ${paint.dim('wasper auth use <name>  ·  wasper auth none')}\n`);
    process.exit(0);
  }

  if (sub === 'use') {
    if (!name) {
      console.log(`\n  ${paint.red('✗')}  Usage: wasper auth use <name>\n`);
      process.exit(1);
    }
    const profiles = dbQueries.getProfiles();
    const target   = profiles.find(p => p.name.toLowerCase() === name.toLowerCase())
                  ?? profiles.find(p => p.id === name);
    if (!target) {
      console.log(`\n  ${paint.red('✗')}  Profile not found: "${name}"`);
      console.log(`  ${paint.dim('wasper auth  —  list profiles')}\n`);
      process.exit(1);
    }
    dbQueries.activateProfile(target.id);
    console.log(`\n  ${paint.green('✓')}  Active auth: ${paint.bold(target.name)}  ${paint.dim(`(${target.type})`)}\n`);

    // Notify running daemon if up
    const state = await readDaemonState();
    if (state && isProcessAlive(state.pid)) {
      try {
        await fetch(
          `http://localhost:${state.port}/api/auth/profiles/${encodeURIComponent(target.id)}/activate`,
          {
            method:  'POST',
            headers: state.token ? { Authorization: `Bearer ${state.token}` } : undefined,
            signal:  AbortSignal.timeout(2000),
          },
        );
      } catch { /* daemon might not be reachable yet */ }
    }
    process.exit(0);
  }

  if (sub === 'none') {
    dbQueries.setAuthConfig('none', {});
    console.log(`\n  ${paint.green('✓')}  Auth disabled\n`);

    const state = await readDaemonState();
    if (state && isProcessAlive(state.pid)) {
      try {
        await fetch(`http://localhost:${state.port}/api/auth`, {
          method:  'PUT',
          headers: {
            'Content-Type': 'application/json',
            ...(state.token ? { Authorization: `Bearer ${state.token}` } : {}),
          },
          body:   JSON.stringify({ type: 'none' }),
          signal: AbortSignal.timeout(2000),
        });
      } catch { /* best-effort */ }
    }
    process.exit(0);
  }

  console.log(`\n  ${paint.red('✗')}  Unknown: wasper auth ${sub}`);
  console.log(`  ${paint.dim('wasper auth  ·  wasper auth use <name>  ·  wasper auth none')}\n`);
  process.exit(1);
}
