import { parseArgs } from 'util';
import { spawnDaemon, writeDaemonState, readDaemonState, isProcessAlive } from '../daemon';
import { dbQueries } from '../db/index';
import { setServerConfig, getFeatures, setFeatures } from '../config';
import { paint } from '../ui';

export async function run() {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter(a => a !== 'up'),
    options: {
      url:        { type: 'string' },
      port:       { type: 'string', default: process.env.WASPER_PORT ?? '3388' },
      host:       { type: 'string' },
      origin:     { type: 'string' },
      token:      { type: 'string' },
      'no-mcp':   { type: 'boolean' },
      'no-proxy': { type: 'boolean' },
      'no-ai':    { type: 'boolean' },
      readonly:   { type: 'boolean' },
      force:      { type: 'boolean', short: 'f' },
      help:       { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  let specUrl = values.url ? String(values.url) : null;
  specUrl ??= process.env.WASPER_SPEC_URL ?? null;

  const PORT   = parseInt(String(values.port ?? '3388'), 10);
  const HOST   = (values.host   ? String(values.host)   : null) ?? process.env.WASPER_HOST   ?? '0.0.0.0';
  const ORIGIN = ((values.origin ? String(values.origin) : null) ?? process.env.WASPER_ORIGIN ?? null)?.replace(/\/$/, '') ?? null;
  const TOKEN  = (values.token  ? String(values.token)  : null) ?? process.env.WASPER_TOKEN  ?? null;

  // Auto-resume last spec if no --url given
  if (!specUrl) {
    const last = dbQueries.getLastSpec();
    if (last) specUrl = last.url;
  }

  // Check if THIS port is already in use (not any other instance)
  const existing = await readDaemonState(PORT);
  if (existing && isProcessAlive(existing.pid) && !values.force) {
    const base = existing.origin ?? `http://localhost:${existing.port}`;
    console.log(`\n  ${paint.yellow('●')}  Already running on :${PORT}  ${paint.dim(`PID ${existing.pid}`)}`);
    console.log(`  ${paint.dim('➜')}  ${paint.cyan(base + '/')}`);
    console.log(`\n  ${paint.dim('wasper ps  ·  wasper down --port ' + PORT + '  ·  wasper up --port ' + PORT + ' --force')}\n`);
    process.exit(0);
  }

  setServerConfig({ port: PORT, host: HOST, origin: ORIGIN, token: TOKEN });
  setFeatures({
    ...(values['no-mcp']   ? { mcp:   false } : {}),
    ...(values['no-proxy'] ? { proxy: false } : {}),
    ...(values['no-ai']    ? { ai:    false } : {}),
    readonly: !!values.readonly,
  });

  // Kill old instance on this port if --force
  if (existing && isProcessAlive(existing.pid)) {
    try { process.kill(existing.pid, 'SIGTERM'); } catch { /* already gone */ }
    await Bun.sleep(400);
  }

  const pid = await spawnDaemon(specUrl, PORT, {
    host: HOST, origin: ORIGIN, token: TOKEN, features: getFeatures(),
  });
  await Bun.sleep(600);
  await writeDaemonState({ pid, port: PORT, specUrl, startedAt: Date.now(), host: HOST, origin: ORIGIN, token: TOKEN });

  const base = ORIGIN ?? `http://localhost:${PORT}`;
  console.log(`\n  ${paint.green('✓')}  Started on :${PORT}  ${paint.dim(`PID ${pid}`)}`);
  if (specUrl) console.log(`  ${paint.dim('↩')}  ${specUrl}`);
  console.log(`  ${paint.dim('➜')}  ${paint.cyan(base + '/')}`);
  console.log(`     MCP ${paint.dim(base + '/mcp')}`);
  console.log(`\n  ${paint.dim('wasper ps  ·  wasper down  ·  wasper logs -f' + (PORT !== 3388 ? ' --port ' + PORT : ''))}\n`);

  process.exit(0);
}

function printHelp() {
  console.log(`
Usage: wasper up [options]

  Start the wasper daemon in the background.
  Run multiple instances with different --port values.

Options:
  --url, -u        OpenAPI spec URL or local path
  --port           Port (default: 3388, env WASPER_PORT)
  --host           Bind address (default: 0.0.0.0)
  --origin         Public URL (env WASPER_ORIGIN)
  --token          Access token (env WASPER_TOKEN)
  --no-mcp         Disable the MCP endpoint
  --no-proxy       Disable the HTTP proxy
  --no-ai          Disable the AI chat endpoint
  --readonly       Block non-GET upstream requests
  --force, -f      Restart if already running on that port

Examples:
  wasper up --url https://api.example.com/openapi.json
  wasper up --url https://api2.example.com/openapi.json --port 3389
  wasper ps                  # list all running instances
`);
}
