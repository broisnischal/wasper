import { parseArgs } from 'util';
import { mcpHandler } from '../mcp/server';
import { proxyHandler } from '../proxy/handler';
import { apiRouter } from '../api/routes';
import { logsUpgradeHandler, logsWebSocketHandlers } from '../logs/bus';
import { db } from '../db/index';
import { loadSpec, getState, hasState } from '../state';
import { writeDaemonState, clearDaemonState, spawnDaemon } from '../daemon';
import { Spinner, printBanner, paint, isTTY } from '../ui';

export interface StartOptions {
  url?: string;
  port?: number;
  daemon?: boolean; // run detached immediately
  isDaemon?: boolean; // we ARE the daemon child (internal)
}

export async function run(overrideOpts?: StartOptions) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter(a => a !== 'start'),
    options: {
      url:      { type: 'string' },
      port:     { type: 'string', default: '3388' },
      background: { type: 'boolean', short: 'b' },
      daemon:   { type: 'boolean', short: 'd' },
      _daemon:  { type: 'boolean' }, // internal: already detached
      help:     { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  const specUrl  = overrideOpts?.url   ?? (values.url   ? String(values.url)  : null);
  const PORT     = overrideOpts?.port  ?? parseInt(String(values.port ?? '3388'), 10);
  const bgNow    = overrideOpts?.daemon ?? !!(values.background || values.daemon);
  const isDaemon = overrideOpts?.isDaemon ?? !!values['_daemon'];

  // ── If --background: spawn detached child and exit ────────────────────────
  if (bgNow) {
    const pid = await spawnDaemon(specUrl, PORT);
    // Give the child a moment to start, then check it's alive
    await Bun.sleep(600);
    await writeDaemonState({ pid, port: PORT, specUrl, startedAt: Date.now() });
    console.log(`\n  ${paint.green('✓')}  Started in background  ${paint.dim('PID ' + pid)}`);
    console.log(`  ${paint.dim('➜')}  ${paint.cyan(`http://localhost:${PORT}/`)}`);
    console.log(`\n  ${paint.dim('openapi-agent status')}  ${paint.dim('·')}  ${paint.dim('openapi-agent stop')}\n`);
    process.exit(0);
  }

  // ── Load spec ─────────────────────────────────────────────────────────────
  const spinner = new Spinner();
  let specTitle: string | undefined;
  let specVersion: string | undefined;
  let endpointCount: number | undefined;

  if (specUrl) {
    spinner.start(`Loading ${paint.cyan(specUrl)}`);
    try {
      const state = await loadSpec(specUrl);
      specTitle     = state.spec.title;
      specVersion   = state.spec.version;
      endpointCount = state.operations.length;
      spinner.stop(); // banner will display spec info
    } catch (e) {
      spinner.stop('✗', `Failed to load spec: ${e instanceof Error ? e.message : String(e)}`, 'red');
      // continue without spec
    }
  } else if (!isDaemon) {
    // no-op — banner handles the "no spec" message
  }

  // ── Inject runtime env (for /api/server-info) ─────────────────────────────
  process.env._OA_PORT    = String(PORT);
  process.env._OA_STARTED = String(Date.now());

  // ── Write PID file ────────────────────────────────────────────────────────
  await writeDaemonState({ pid: process.pid, port: PORT, specUrl, startedAt: Date.now() });

  // ── Start Bun server ──────────────────────────────────────────────────────
  const server = Bun.serve({
    port: PORT,
    idleTimeout: 0, // never timeout — required for long SSE (AI agentic loops)

    async fetch(req, srv) {
      const { pathname } = new URL(req.url);
      if (pathname === '/logs') return logsUpgradeHandler(req, srv);
      if (pathname === '/mcp') return mcpHandler(req);
      if (pathname === '/openapi.json') {
        if (!hasState()) return new Response('No spec loaded', { status: 404 });
        return new Response(getState().spec.raw, {
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
      if (pathname.startsWith('/proxy')) return proxyHandler(req);
      if (pathname.startsWith('/api/')) return apiRouter(req);
      if (pathname === '/' || pathname === '') {
        const title = hasState() ? getState().spec.title : 'OpenAPI Agent';
        return new Response(buildScalarHtml(title, PORT), { headers: { 'Content-Type': 'text/html' } });
      }
      return new Response('Not found', { status: 404 });
    },

    websocket: logsWebSocketHandlers,
    error(err) {
      console.error('[Server Error]', err.message);
      return new Response('Internal server error', { status: 500 });
    },
  });

  // ── Banner ────────────────────────────────────────────────────────────────
  if (!isDaemon) {
    printBanner({ port: PORT, pid: process.pid, specTitle, specVersion, endpointCount, specUrl: specUrl ?? undefined });
  } else {
    // Minimal daemon startup log (goes to ~/.openapi-agent/server.log)
    console.log(`[openapi-agent] started — PID ${process.pid}  port ${PORT}  ${specUrl ?? 'no spec'}`);
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function shutdown(sig?: string) {
    if (sig && !isDaemon) process.stdout.write(`\n  ${paint.dim('shutting down')}\n\n`);
    clearDaemonState().finally(() => {
      db.close();
      server.stop();
      process.exit(0);
    });
  }

  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('SIGINT',  () => shutdown('SIGINT'));
  if (isDaemon) process.on('SIGHUP', () => {}); // ignore terminal close

  // ── Interactive keyboard (foreground + TTY only) ───────────────────────────
  if (!isDaemon && isTTY && process.stdin.isTTY) {
    attachKeyboard({ specUrl, PORT, server });
  }
}

// ─── Interactive keyboard handler ─────────────────────────────────────────────
function attachKeyboard(opts: { specUrl: string | null; PORT: number; server: ReturnType<typeof Bun.serve> }) {
  const { specUrl, PORT } = opts;
  let isReloading = false;

  process.stdin.setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  const spinner = new Spinner();

  process.stdin.on('data', async (key: string) => {
    if (key === '\x03') { // Ctrl+C
      process.emit('SIGINT');
      return;
    }

    switch (key.toLowerCase()) {
      case 'r': {
        if (isReloading) return;
        process.stdout.write('\n');
        if (!specUrl) {
          console.log(`  ${paint.yellow('○')}  No spec URL — start with --url <url> to enable hot-reload`);
          console.log();
          return;
        }
        isReloading = true;
        spinner.start(`Reloading spec…`);
        try {
          const state = await loadSpec(specUrl);
          spinner.stop('✓', `${paint.bold(state.spec.title)}  ${paint.dim('v' + state.spec.version)}  ${paint.dim('·')}  ${paint.green(state.operations.length + ' endpoints')}`, 'green');
        } catch (e) {
          spinner.stop('✗', `Reload failed: ${e instanceof Error ? e.message : String(e)}`, 'red');
        } finally {
          isReloading = false;
        }
        console.log();
        break;
      }

      case 'b': {
        process.stdin.setRawMode(false);
        process.stdin.pause();
        process.on('SIGHUP', () => {}); // survive terminal close
        console.log(`\n  ${paint.green('✓')}  Detached  ${paint.dim(`PID ${process.pid}`)}`);
        console.log(`  ${paint.dim('➜')}  ${paint.dim('openapi-agent status')}  ${paint.dim('·')}  ${paint.dim('openapi-agent stop')}\n`);
        break;
      }

      case 's': {
        // print compact status inline
        const state = hasState() ? getState() : null;
        console.log(`\n  ${paint.dim('●')}  ${paint.bold('OpenAPI Agent')}  PID ${process.pid}  port ${PORT}`);
        if (state) {
          console.log(`     ${paint.bold(state.spec.title)} v${state.spec.version} · ${state.operations.length} endpoints`);
        }
        console.log();
        break;
      }

      case '?':
      case 'h':
        printInteractiveHelp();
        break;

      case 'q':
        process.emit('SIGINT');
        break;
    }
  });
}

function printInteractiveHelp() {
  console.log(`
  ${paint.bold('Keyboard shortcuts')}
  ${paint.dim('─'.repeat(34))}
  ${paint.bold('r')}   Hot-reload OpenAPI spec from URL
  ${paint.bold('s')}   Print current status
  ${paint.bold('b')}   Detach to background (survive terminal close)
  ${paint.bold('q')}   Quit gracefully
  ${paint.bold('?')}   Show this help
`);
}

function printHelp() {
  console.log(`
Usage: openapi-agent [start] [options]

  openapi-agent [--url <spec-url>] [--port <port>]   Start in foreground
  openapi-agent start --background                   Start in background
  openapi-agent stop                                 Stop background server
  openapi-agent status                               Show server status
  openapi-agent reload                               Hot-reload the spec

Options:
  --url, -u        OpenAPI spec URL or local path
  --port           Port (default: 3388)
  --background, -b Start detached in background
  --daemon, -d     Same as --background
  -h, --help       Show this help
`);
}

function buildScalarHtml(title: string, port: number): string {
  return `<!doctype html><html><head>
  <title>${title} — API Reference</title>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>body{margin:0}</style></head><body>
  <script id="api-reference" data-url="/openapi.json" data-proxy-url="http://localhost:${port}/proxy"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`;
}
