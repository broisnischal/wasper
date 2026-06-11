#!/usr/bin/env bun
/**
 * wasper CLI
 *
 *   wasper up [--url <spec>]        start daemon in background (default)
 *   wasper down                     stop daemon
 *   wasper status                   show daemon status
 *   wasper logs [-f]                tail server logs
 *
 *   wasper spec <url>               load a new spec on the running daemon
 *   wasper reload                   hot-reload current spec
 *   wasper ls                       list saved spec history
 *   wasper use <n|url>              restart with a saved spec
 *   wasper rm  <n|url>              remove spec from history
 *
 *   wasper mcp [on|off]             toggle MCP endpoint
 *   wasper proxy [on|off]           toggle HTTP proxy
 *   wasper ai [on|off]              toggle AI chat
 *   wasper readonly [on|off]        toggle read-only mode
 *
 *   wasper auth                     list auth profiles
 *   wasper auth use <name>          switch active profile
 *   wasper auth none                disable auth
 *
 *   wasper service install          install as system service
 *   wasper service uninstall        remove system service
 *
 *   wasper start [--foreground]     foreground mode with interactive REPL
 *   wasper update                   update to latest version
 *   wasper help                     show this help
 */

const rawArgs = process.argv.slice(2);

if (rawArgs.includes('--version') || rawArgs.includes('-v')) {
  const { VERSION } = await import('./src/version.ts');
  console.log(VERSION);
  process.exit(0);
}

// Internal flag: this process IS the spawned daemon child — always route to start
const IS_DAEMON_CHILD = rawArgs.includes('--_daemon');

const SUBCOMMANDS = new Set([
  'up', 'down', 'stop', 'status', 'ps', 'reload', 'logs',
  'ls', 'list', 'use', 'rm', 'remove',
  'mcp', 'proxy', 'ai', 'readonly',
  'auth', 'spec', 'service', 'update', 'start', 'help',
]);

// Only treat the first positional as a subcommand when it's a known keyword.
// Without this guard, --url https://... would make "https://..." the subcommand.
const firstPositional = rawArgs.find(a => !a.startsWith('-'));
const subcommand = (firstPositional && SUBCOMMANDS.has(firstPositional))
  ? firstPositional
  : (IS_DAEMON_CHILD ? 'start' : 'up');

switch (subcommand) {
  case 'up':
    await import('./src/commands/up.ts').then(m => m.run());
    break;

  case 'ps':
    await import('./src/commands/ps.ts').then(m => m.run());
    break;

  case 'down':
  case 'stop':
    await import('./src/commands/stop.ts').then(m => m.run());
    break;

  case 'status':
    await import('./src/commands/status.ts').then(m => m.run());
    break;

  case 'reload':
    await import('./src/commands/reload.ts').then(m => m.run());
    break;

  case 'logs':
    await import('./src/commands/logs.ts').then(m => m.run());
    break;

  case 'ls':
  case 'list':
    await import('./src/commands/ls.ts').then(m => m.run());
    break;

  case 'use':
    await import('./src/commands/use.ts').then(m => m.run());
    break;

  case 'rm':
  case 'remove':
    await import('./src/commands/rm.ts').then(m => m.run());
    break;

  case 'mcp':
  case 'proxy':
  case 'ai':
  case 'readonly':
    await import('./src/commands/feature.ts').then(m => m.run());
    break;

  case 'auth':
    await import('./src/commands/auth-cmd.ts').then(m => m.run());
    break;

  case 'spec':
    await import('./src/commands/spec-cmd.ts').then(m => m.run());
    break;

  case 'service':
    await import('./src/commands/service.ts').then(m => m.run());
    break;

  case 'update':
    await import('./src/commands/update.ts').then(m => m.run());
    break;

  case 'help':
    await import('./src/commands/help.ts').then(m => m.run());
    break;

  case 'start':
  default:
    await import('./src/commands/start.ts').then(m => m.run());
    break;
}
