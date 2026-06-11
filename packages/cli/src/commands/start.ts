import { parseArgs } from 'util';
import { createInterface } from 'readline';
import { homedir } from 'os';
import { join, dirname } from 'path';
import { mkdirSync } from 'fs';
import { mcpHandler } from '../mcp/server';
import { proxyHandler } from '../proxy/handler';
import { captureHandler } from '../proxy/capture';
import { apiRouter } from '../api/routes';
import { logsUpgradeHandler, logsWebSocketHandlers, logBus } from '../logs/bus';
import { db, dbQueries } from '../db/index';
import { loadSpec, getState, hasState } from '../state';
import { writeDaemonState, clearDaemonState, spawnDaemon } from '../daemon';
import { setServerConfig, getServerConfig, updateServerConfig, isAuthorized, getFeatures, setFeatures, type Features } from '../config';
import { checkForUpdate, printUpdateNotice, performUpdate } from './update';
import { Spinner, printBanner, paint, isTTY } from '../ui';
import { Repl } from '../repl';
import { persistAndBroadcastFeatures } from '../api/routes';

export interface StartOptions {
  url?: string;
  port?: number;
  host?: string;
  origin?: string;
  token?: string;
  daemon?: boolean; // run detached immediately
  isDaemon?: boolean; // we ARE the daemon child (internal)
}

export async function run(overrideOpts?: StartOptions) {
  const { values } = parseArgs({
    args: process.argv.slice(2).filter(a => a !== 'start'),
    options: {
      url:      { type: 'string' },
      port:     { type: 'string', default: process.env.WASPER_PORT ?? '3388' },
      host:     { type: 'string' },
      origin:   { type: 'string' },
      token:    { type: 'string' },
      background: { type: 'boolean', short: 'b' },
      daemon:   { type: 'boolean', short: 'd' },
      'no-mcp':   { type: 'boolean' },
      'no-proxy': { type: 'boolean' },
      'no-ai':    { type: 'boolean' },
      readonly:   { type: 'boolean' },
      _daemon:  { type: 'boolean' }, // internal: already detached
      help:     { type: 'boolean', short: 'h' },
    },
    strict: false,
  });

  if (values.help) {
    printHelp();
    process.exit(0);
  }

  let specUrl  = overrideOpts?.url   ?? (values.url   ? String(values.url)  : null)
    ?? process.env.WASPER_SPEC_URL ?? null;
  const PORT     = overrideOpts?.port  ?? parseInt(String(values.port ?? '3388'), 10);
  const HOST     = overrideOpts?.host  ?? (values.host ? String(values.host) : null)
    ?? process.env.WASPER_HOST ?? '0.0.0.0';
  const ORIGIN   = (overrideOpts?.origin ?? (values.origin ? String(values.origin) : null)
    ?? process.env.WASPER_ORIGIN ?? null)?.replace(/\/$/, '') ?? null;
  const TOKEN    = overrideOpts?.token ?? (values.token ? String(values.token) : null)
    ?? process.env.WASPER_TOKEN ?? null;
  const bgNow    = overrideOpts?.daemon ?? !!(values.background || values.daemon);
  const isDaemon = overrideOpts?.isDaemon ?? !!values['_daemon'];

  // Auto-resume: if no --url given, fall back to the last used spec
  if (!specUrl && !isDaemon) {
    const last = dbQueries.getLastSpec();
    if (last) {
      specUrl = last.url;
      if (isTTY) console.log(`  ${paint.dim('↩')}  Resuming ${paint.cyan(last.title ?? last.url)}  ${paint.dim('(last used)')}\n`);
    }
  }

  setServerConfig({ port: PORT, host: HOST, origin: ORIGIN, token: TOKEN });

  // Restore persisted mcp/proxy/ai flags from DB; CLI flags override when explicitly passed.
  {
    const saved = dbQueries.getSetting('features');
    if (saved) {
      try {
        const obj = JSON.parse(saved) as Partial<Features>;
        const patch: Partial<Features> = {};
        if (obj.mcp   === false) patch.mcp   = false;
        if (obj.proxy === false) patch.proxy = false;
        if (obj.ai    === false) patch.ai    = false;
        if (Object.keys(patch).length) setFeatures(patch);
      } catch { /**/ }
    }
  }
  setFeatures({
    ...(values['no-mcp']   ? { mcp:   false } : {}),
    ...(values['no-proxy'] ? { proxy: false } : {}),
    ...(values['no-ai']    ? { ai:    false } : {}),
    readonly: !!values.readonly,
  });

  // ── If --background: spawn detached child and exit ────────────────────────
  if (bgNow) {
    const pid = await spawnDaemon(specUrl, PORT, { host: HOST, origin: ORIGIN, token: TOKEN, features: getFeatures() });
    // Give the child a moment to start, then check it's alive
    await Bun.sleep(600);
    await writeDaemonState({ pid, port: PORT, specUrl, startedAt: Date.now(), host: HOST, origin: ORIGIN, token: TOKEN });
    console.log(`\n  ${paint.green('✓')}  Started in background  ${paint.dim('PID ' + pid)}`);
    console.log(`  ${paint.dim('➜')}  ${paint.cyan(`${ORIGIN ?? `http://localhost:${PORT}`}/`)}`);
    console.log(`\n  ${paint.dim('wasper status')}  ${paint.dim('·')}  ${paint.dim('wasper stop')}\n`);
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
      dbQueries.upsertSpec(specUrl, specTitle ?? null, specVersion ?? null, endpointCount);
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
  await writeDaemonState({ pid: process.pid, port: PORT, specUrl, startedAt: Date.now(), host: HOST, origin: ORIGIN, token: TOKEN });

  // ── Start Bun server ──────────────────────────────────────────────────────
  const server = Bun.serve({
    port: PORT,
    hostname: HOST,
    idleTimeout: 0, // never timeout — required for long SSE (AI agentic loops)

    async fetch(req, srv) {
      const CORS_HEADERS = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      };

      try {
        const { pathname } = new URL(req.url);

        // CORS preflight never carries credentials — answer before the auth gate
        if (req.method === 'OPTIONS') {
          return new Response(null, { status: 204, headers: CORS_HEADERS });
        }

        // Capture bins are public — external clients have no token, the bin ID is the auth
        if (pathname.startsWith('/c/')) return captureHandler(req);

        // Access-token gate (only when --token / WASPER_TOKEN is set)
        if (!isAuthorized(req)) {
          return new Response(JSON.stringify({ error: 'Unauthorized: pass Authorization: Bearer <token> or ?token=' }), {
            status: 401,
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }

        // Runtime feature gates (toggled via slash commands or PUT /api/features)
        const features = getFeatures();
        const disabled = (what: string) => new Response(
          JSON.stringify({ error: `${what} is disabled on this server` }),
          { status: 403, headers: { 'Content-Type': 'application/json', ...CORS_HEADERS } },
        );
        if (pathname === '/mcp' && !features.mcp) return disabled('MCP');
        if (pathname.startsWith('/proxy') && !features.proxy) return disabled('The HTTP proxy');
        if (pathname === '/api/ai/chat' && !features.ai) return disabled('The AI chat endpoint');

        if (pathname === '/logs') return logsUpgradeHandler(req, srv);
        if (pathname === '/mcp') return mcpHandler(req);
        if (pathname === '/openapi.json') {
          if (!hasState()) return new Response('No spec loaded', { status: 404 });
          return new Response(getState().spec.raw, {
            headers: { 'Content-Type': 'application/json', ...CORS_HEADERS },
          });
        }
        if (pathname.startsWith('/proxy')) return proxyHandler(req);
        if (pathname.startsWith('/api/')) return apiRouter(req);
        if (pathname === '/' || pathname === '') {
          const title = hasState() ? getState().spec.title : 'OpenAPI Agent';
          return new Response(buildScalarHtml(title, req), { headers: { 'Content-Type': 'text/html' } });
        }
        return new Response('Not found', { status: 404 });
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        console.error('[Server Error]', msg);
        return new Response(JSON.stringify({ error: msg }), {
          status: 500,
          headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
        });
      }
    },

    websocket: logsWebSocketHandlers,
    error(err) {
      console.error('[Server Error]', err.message);
      return new Response(JSON.stringify({ error: err.message }), {
        status: 500,
        headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' },
      });
    },
  });

  // ── Banner ────────────────────────────────────────────────────────────────
  if (!isDaemon) {
    printBanner({ port: PORT, pid: process.pid, specTitle, specVersion, endpointCount, specUrl: specUrl ?? undefined, origin: ORIGIN ?? undefined, host: HOST, tokenSet: !!TOKEN });
    // Non-blocking daily update check (opt out: WASPER_NO_UPDATE_CHECK=1)
    checkForUpdate().then(latest => {
      if (!latest) return;
      printUpdateNotice(latest);
      if (process.env.WASPER_AUTO_UPDATE) void performUpdate({ quiet: true });
    }).catch(() => {});

    // First-run: offer to configure Claude Desktop + Claude Code MCP connections
    if (isTTY && !dbQueries.getSetting('first_run_done') && !process.env.WASPER_NO_FIRST_RUN) {
      await runFirstTimeSetup(PORT, ORIGIN);
    }
  } else {
    // Minimal daemon startup log (goes to ~/.openapi-agent/server.log)
    console.log(`[wasper] started — PID ${process.pid}  ${HOST}:${PORT}  ${ORIGIN ?? ''}  ${specUrl ?? 'no spec'}`);
  }

  // ── Graceful shutdown ─────────────────────────────────────────────────────
  function shutdown(sig?: string) {
    if (sig && !isDaemon) process.stdout.write(`\n  ${paint.dim('shutting down')}\n\n`);
    clearDaemonState(PORT).finally(() => {
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

// ─── Interactive keyboard + slash-command REPL ────────────────────────────────

interface ReplCtx {
  specUrl: string | null; // mutable — /spec <url> switches it
  PORT: number;
  tailOff: (() => void) | null;
}

const SPIN_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

function attachKeyboard(opts: { specUrl: string | null; PORT: number; server: ReturnType<typeof Bun.serve> }) {
  const ctx: ReplCtx = { specUrl: opts.specUrl, PORT: opts.PORT, tailOff: null };
  let isReloading = false;
  const repl = new Repl();

  // ── Status bar helpers ──────────────────────────────────────────────────────
  const buildStatus = (): string => {
    const state = hasState() ? getState() : null;
    const f = getFeatures();
    const cfg = getServerConfig();
    const active = dbQueries.getActiveProfile();
    const parts: string[] = [];

    if (state) {
      parts.push(`${state.spec.title} v${state.spec.version} · ${state.operations.length} ep`);
    } else {
      parts.push('no spec');
    }

    parts.push(`:${ctx.PORT}`);

    const flags: string[] = [];
    if (!f.mcp)      flags.push('mcp:off');
    if (!f.proxy)    flags.push('proxy:off');
    if (!f.ai)       flags.push('ai:off');
    if (f.readonly)  flags.push('readonly:on');
    if (flags.length) parts.push(flags.join(' '));

    parts.push(`auth:${active ? active.name : 'none'}`);
    if (cfg.token) parts.push('token:set');
    if (ctx.tailOff) parts.push('tail:on');

    return parts.join('  ·  ');
  };

  const refreshStatus = () => repl.setStatus(buildStatus());

  const refreshAuthSuggestions = () => {
    const profiles = dbQueries.getProfiles();
    repl.setDynamicSuggestions(profiles.map(p => ({
      value: `auth use ${p.name}`,
      label: p.name,
      desc: p.type,
    })));
  };

  // ── Spec reload (animated via status bar, no old Spinner) ──────────────────
  const reload = async () => {
    if (isReloading) return;
    if (!ctx.specUrl) {
      console.log(`\n  ${paint.yellow('○')}  No spec URL — use /spec <url>\n`);
      return;
    }
    isReloading = true;
    let fi = 0;
    const base = buildStatus();
    const spinTimer = setInterval(() => {
      repl.setStatus(`${SPIN_FRAMES[fi++ % SPIN_FRAMES.length]}  Reloading…  ·  ${base}`);
    }, 80);
    try {
      const state = await loadSpec(ctx.specUrl);
      clearInterval(spinTimer);
      dbQueries.upsertSpec(ctx.specUrl, state.spec.title, state.spec.version, state.operations.length);
      console.log(`  ${paint.green('✓')}  ${paint.bold(state.spec.title)}  ${paint.dim('v' + state.spec.version)}  ·  ${paint.green(state.operations.length + ' endpoints')}\n`);
    } catch (e) {
      clearInterval(spinTimer);
      console.log(`  ${paint.red('✗')}  Reload failed: ${e instanceof Error ? e.message : String(e)}\n`);
    } finally {
      isReloading = false;
      refreshStatus();
    }
  };

  // ── Command handler ─────────────────────────────────────────────────────────
  const handler = async (input: string) => {
    const cmd = input.trim();

    // Single-key shortcuts (dispatched when buffer was empty)
    if (cmd.length === 1) {
      switch (cmd.toLowerCase()) {
        case 'r': await reload(); return;
        case 's': printInlineStatus(ctx); return;
        case 'q': process.emit('SIGINT'); return;
        case 'h': case '?': printInteractiveHelp(); return;
        case 'b': {
          repl.stop();
          process.on('SIGHUP', () => {}); // survive terminal close
          console.log(`\n  ${paint.green('✓')}  Detached  ${paint.dim('PID ' + process.pid)}`);
          console.log(`  ${paint.dim('➜')}  ${paint.dim('wasper status')}  ${paint.dim('·')}  ${paint.dim('wasper stop')}\n`);
          return;
        }
      }
    }

    // Slash commands (with or without leading /)
    const slashCmd = cmd.startsWith('/') ? cmd : `/${cmd}`;
    await runSlashCommand(slashCmd, ctx, reload);

    // Refresh status + suggestions after any command
    refreshStatus();
    refreshAuthSuggestions();
  };

  // ── Initialise ──────────────────────────────────────────────────────────────
  refreshAuthSuggestions();
  repl.setStatus(buildStatus());
  repl.start(handler);
}

function printInlineStatus(ctx: ReplCtx) {
  const state = hasState() ? getState() : null;
  const f = getFeatures();
  const cfg = getServerConfig();
  const on  = (v: boolean) => v ? paint.green('on')  : paint.dim('off');
  const dot = paint.dim('·');

  console.log(`\n  ${paint.green('●')}  ${paint.bold('wasper')}  ${paint.dim('PID ' + process.pid)}  ${dot}  ${paint.dim(':' + ctx.PORT)}`);
  if (state) {
    console.log(`     ${paint.bold(state.spec.title)}  ${paint.dim('v' + state.spec.version)}  ${dot}  ${paint.green(state.operations.length + ' endpoints')}`);
  } else {
    console.log(`     ${paint.dim('no spec loaded')}`);
  }
  console.log(`     mcp ${on(f.mcp)}  ${dot}  proxy ${on(f.proxy)}  ${dot}  ai ${on(f.ai)}  ${dot}  readonly ${on(f.readonly)}  ${dot}  token ${cfg.token ? paint.green('set') : paint.dim('none')}`);
  const active = dbQueries.getActiveProfile();
  console.log(`     auth ${active ? paint.bold(active.name) + '  ' + paint.dim('(' + active.type + ')') : paint.dim('none')}`);
  console.log();
}

async function runSlashCommand(input: string, ctx: ReplCtx, reload: () => Promise<void>) {
  const [cmd = '', ...rest] = input.trim().slice(1).split(/\s+/);
  const arg = rest.join(' ');
  console.log(`\n  ${paint.dim('❯ /' + cmd + (arg ? ' ' + arg : ''))}`);

  const toggle = (name: keyof Features, label: string) => {
    const cur = getFeatures()[name];
    const next = arg === 'on' ? true : arg === 'off' ? false : !cur;
    setFeatures({ [name]: next });
    persistAndBroadcastFeatures();
    console.log(`  ${next ? paint.green('✓') : paint.yellow('○')}  ${label} ${next ? paint.green('enabled') : paint.yellow('disabled')}\n`);
  };

  switch (cmd.toLowerCase()) {
    case 'help':
      printInteractiveHelp();
      break;

    case 'status':
      printInlineStatus(ctx);
      break;

    case 'reload':
      await reload();
      break;

    case 'spec': {
      if (!arg) { console.log(`  ${paint.yellow('○')}  Usage: /spec <url-or-path>\n`); break; }
      ctx.specUrl = arg;
      await reload();
      break;
    }

    case 'mcp':      toggle('mcp', 'MCP endpoint'); break;
    case 'proxy':    toggle('proxy', 'HTTP proxy'); break;
    case 'ai':       toggle('ai', 'AI chat endpoint'); break;
    case 'readonly': toggle('readonly', 'Read-only mode (non-GET upstream requests blocked)'); break;

    case 'auth': {
      const [sub, ...nameParts] = rest;
      const name = nameParts.join(' ');
      if (!sub || sub === 'list') {
        const profiles = dbQueries.getProfiles();
        if (!profiles.length) { console.log(`  ${paint.yellow('○')}  No auth roles saved — create them in the studio (Authentication)\n`); break; }
        for (const p of profiles) {
          const mark = p.is_active === 1 ? paint.green('●') : paint.dim('○');
          console.log(`  ${mark}  ${paint.bold(p.name)}  ${paint.dim(`(${p.type})`)}${p.description ? `  ${paint.dim(p.description)}` : ''}`);
        }
        console.log(`\n  ${paint.dim('/auth use <name> to switch · /auth none to disable auth')}\n`);
        break;
      }
      if (sub === 'use') {
        const profiles = dbQueries.getProfiles();
        const target = profiles.find(p => p.name.toLowerCase() === name.toLowerCase()) ?? profiles.find(p => p.id === name);
        if (!target) { console.log(`  ${paint.red('✗')}  Role not found: "${name}"  ${paint.dim('(/auth to list)')}\n`); break; }
        dbQueries.activateProfile(target.id);
        console.log(`  ${paint.green('✓')}  Active auth role: ${paint.bold(target.name)} ${paint.dim(`(${target.type})`)}\n`);
        break;
      }
      if (sub === 'none') {
        dbQueries.setAuthConfig('none', {});
        console.log(`  ${paint.green('✓')}  Auth disabled (type: none)\n`);
        break;
      }
      console.log(`  ${paint.yellow('○')}  Usage: /auth [list] · /auth use <name> · /auth none\n`);
      break;
    }

    case 'token': {
      if (!arg) {
        const t = getServerConfig().token;
        console.log(t
          ? `  ${paint.green('✓')}  Access token is set  ${paint.dim('(/token new to rotate · /token off to remove)')}\n`
          : `  ${paint.yellow('○')}  No access token — server is open  ${paint.dim('(/token new to generate one)')}\n`);
        break;
      }
      if (arg === 'off') {
        updateServerConfig({ token: null });
        console.log(`  ${paint.yellow('○')}  Access token removed — server no longer requires auth\n`);
        break;
      }
      const newToken = arg === 'new'
        ? Array.from(crypto.getRandomValues(new Uint8Array(24)), b => b.toString(16).padStart(2, '0')).join('')
        : arg;
      updateServerConfig({ token: newToken });
      console.log(`  ${paint.green('✓')}  Access token ${arg === 'new' ? 'generated' : 'set'}:`);
      console.log(`     ${paint.bold(newToken)}`);
      console.log(`  ${paint.dim('Existing studio/MCP sessions must reconnect with the new token.')}\n`);
      break;
    }

    case 'tail': {
      const turnOff = arg === 'off' || (ctx.tailOff !== null && arg !== 'on');
      if (turnOff) {
        ctx.tailOff?.();
        ctx.tailOff = null;
        console.log(`  ${paint.yellow('○')}  Request tail off\n`);
        break;
      }
      if (!ctx.tailOff) {
        ctx.tailOff = logBus.onEvent(e => {
          const status = e.error
            ? paint.red('ERR')
            : e.status_code && e.status_code >= 400 ? paint.red(String(e.status_code))
            : paint.green(String(e.status_code ?? '—'));
          console.log(`  ${paint.dim(new Date(e.created_at).toLocaleTimeString())}  ${paint.bold(e.method.padEnd(6))} ${status}  ${paint.dim(`${e.latency_ms ?? '—'}ms`)}  ${e.url}${e.source ? `  ${paint.dim('[' + e.source + ']')}` : ''}`);
        });
      }
      console.log(`  ${paint.green('✓')}  Tailing requests — /tail off to stop\n`);
      break;
    }

    case 'open': {
      const url = `http://localhost:${ctx.PORT}/`;
      const opener = process.platform === 'darwin' ? 'open' : process.platform === 'win32' ? 'start' : 'xdg-open';
      try { Bun.spawn([opener, url], { stdout: 'ignore', stderr: 'ignore' }).unref(); } catch { /* */ }
      console.log(`  ${paint.green('✓')}  Opening ${paint.cyan(url)}\n`);
      break;
    }

    case 'update':
      await performUpdate();
      console.log();
      break;

    case 'quit':
    case 'q':
      process.emit('SIGINT');
      break;

    case '':
      break;

    default:
      console.log(`  ${paint.red('✗')}  Unknown command: /${cmd}  ${paint.dim('(/help for the list)')}\n`);
  }
}

function printInteractiveHelp() {
  const k  = (s: string) => paint.bold(s);
  const d  = (s: string) => paint.dim(s);
  const hr = d('─'.repeat(50));
  console.log(`
  ${paint.bold('Keys')}  ${d('(when input is empty)')}
  ${hr}
  ${k('r')}   Hot-reload spec          ${k('b')}   Detach to background
  ${k('s')}   Print status             ${k('q')}   Quit
  ${k('/')}   Start a command          ${k('?')}   This help

  ${d('↑ / ↓')} cycle command history  ·  ${d('→ or Tab')} accept autocomplete
  ${d('Ctrl+L')} clear screen  ·  ${d('Ctrl+U')} clear input  ·  ${d('Esc')} cancel

  ${paint.bold('Slash commands')}
  ${hr}
  ${k('/spec')} ${d('<url>')}          Load a different OpenAPI spec
  ${k('/mcp')} ${d('[on|off]')}        Toggle the MCP endpoint
  ${k('/proxy')} ${d('[on|off]')}      Toggle the HTTP proxy
  ${k('/ai')} ${d('[on|off]')}         Toggle the AI chat endpoint
  ${k('/readonly')} ${d('[on|off]')}   Block non-GET upstream requests
  ${k('/auth')}                List saved auth profiles
  ${k('/auth use')} ${d('<name>')}     Switch active auth profile
  ${k('/auth none')}           Disable auth
  ${k('/token')} ${d('[new|off|<v>]')} Show / rotate / set the access token
  ${k('/tail')} ${d('[on|off]')}       Live request log in this terminal
  ${k('/open')}                Open the studio in a browser
  ${k('/update')}              Update wasper to the latest version
  ${k('/status')}  ${k('/reload')}  ${k('/help')}  ${k('/quit')}
`);
}

function printHelp() {
  console.log(`
Usage: wasper start [options]

  Starts wasper in the foreground with an interactive REPL.
  For background (daemon) mode — the default — use: wasper up

  wasper up [--url <spec>]                    Start daemon in background (default)
  wasper start [--url <spec>]                 Start in foreground with REPL
  wasper down                                 Stop the daemon
  wasper status                               Show daemon status
  wasper logs [-f]                            Tail server logs
  wasper service install                      Install as system service (auto-start)
  wasper reload                               Hot-reload the spec
  wasper ls                                   List saved specs (history)

Options:
  --url, -u        OpenAPI spec URL or local path
  --port           Port (default: 3388, env WASPER_PORT)
  --host           Bind address (default: 0.0.0.0, env WASPER_HOST)
                   Use 127.0.0.1 to keep the server local-only
  --origin         Public URL the server is reachable at, e.g.
                   https://api.example.com (env WASPER_ORIGIN)
  --token          Require this bearer token on every request
                   (env WASPER_TOKEN) — recommended when self-hosting
  --no-mcp         Start with the MCP endpoint disabled
  --no-proxy       Start with the HTTP proxy disabled
  --no-ai          Start with the AI chat endpoint disabled
  --readonly       Block all non-GET upstream requests (agent guardrail)
  --background, -b Start detached in background (same as wasper up)
  --daemon, -d     Same as --background
  -h, --help       Show this help

Interactive REPL slash commands (foreground mode):
  /mcp on|off · /proxy on|off · /ai on|off · /readonly on|off
  /auth use <role> · /token new · /spec <url> · /tail · /help

Self-hosting:
  wasper up --url <spec> --origin https://api.example.com --token <secret>
  wasper service install --url <spec> --port 3388
`);
}

function buildScalarHtml(title: string, req: Request): string {
  // Public origin if configured, else whatever host the browser used to reach us
  // (so the page works behind any domain / reverse proxy without configuration).
  const cfg = getServerConfig();
  let base = cfg.origin;
  if (!base) {
    try { base = new URL(req.url).origin; } catch { base = `http://localhost:${cfg.port}`; }
  }
  // The Scalar page fetches the spec and proxies requests itself — when a token
  // is required, carry it via query so those sub-requests stay authorized.
  const qs = cfg.token ? `?token=${encodeURIComponent(cfg.token)}` : '';
  return `<!doctype html><html><head>
  <title>${title} — API Reference</title>
  <meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/>
  <style>body{margin:0}</style></head><body>
  <script id="api-reference" data-url="/openapi.json${qs}" data-proxy-url="${base}/proxy${qs}"></script>
  <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
</body></html>`;
}

// ─── First-run MCP setup ──────────────────────────────────────────────────────

function promptYN(question: string, defaultYes = true): Promise<boolean> {
  return new Promise(resolve => {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    rl.question(`${question} ${defaultYes ? '[Y/n]' : '[y/N]'} `, (answer: string) => {
      rl.close();
      const a = answer.trim().toLowerCase();
      resolve(a ? (a === 'y' || a === 'yes') : defaultYes);
    });
  });
}

function claudeDesktopConfigPath(): string {
  const p = process.platform;
  if (p === 'darwin') return join(homedir(), 'Library', 'Application Support', 'Claude', 'claude_desktop_config.json');
  if (p === 'win32')  return join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming'), 'Claude', 'claude_desktop_config.json');
  return join(homedir(), '.config', 'Claude', 'claude_desktop_config.json');
}

async function configureClaudeDesktop(mcpUrl: string): Promise<void> {
  const cfgPath = claudeDesktopConfigPath();
  try {
    let cfg: Record<string, unknown> = {};
    try { cfg = JSON.parse(await Bun.file(cfgPath).text()); } catch { /* file absent — start fresh */ }
    cfg.mcpServers = {
      ...(cfg.mcpServers as Record<string, unknown> ?? {}),
      'wasper': { type: 'streamable-http', url: mcpUrl },
    };
    mkdirSync(dirname(cfgPath), { recursive: true });
    await Bun.write(cfgPath, JSON.stringify(cfg, null, 2) + '\n');
    console.log(`  ${paint.green('✓')}  Claude Desktop configured — restart Claude Desktop to apply`);
    console.log(`     ${paint.dim(cfgPath)}`);
  } catch (e) {
    console.log(`  ${paint.red('✗')}  Claude Desktop config failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`     Add manually: ${paint.dim(JSON.stringify({ mcpServers: { 'wasper': { type: 'streamable-http', url: mcpUrl } } }))}`);
  }
}

async function configureClaudeCode(mcpUrl: string): Promise<void> {
  try {
    const result = await Bun.$`claude mcp add wasper ${mcpUrl} --transport http`.quiet();
    if (result.exitCode === 0) {
      console.log(`  ${paint.green('✓')}  Claude Code CLI configured`);
    } else {
      throw new Error(result.stderr.toString().trim() || 'non-zero exit');
    }
  } catch (e) {
    console.log(`  ${paint.red('✗')}  Claude Code CLI config failed: ${e instanceof Error ? e.message : String(e)}`);
    console.log(`     Run manually: ${paint.dim(`claude mcp add wasper ${mcpUrl} --transport http`)}`);
  }
}

async function runFirstTimeSetup(port: number, origin: string | null): Promise<void> {
  const mcpUrl = `${origin ?? `http://localhost:${port}`}/mcp`;

  console.log(`\n  ${paint.cyan('●')}  ${paint.bold('First-time setup')}  ${paint.dim('— connect AI tools to this MCP server')}`);
  console.log(`     ${paint.dim('MCP endpoint: ' + mcpUrl)}\n`);

  try {
    const addDesktop = await promptYN(`  ${paint.dim('1.')} Add to Claude Desktop?`, true);
    if (addDesktop) await configureClaudeDesktop(mcpUrl);

    const addCode = await promptYN(`\n  ${paint.dim('2.')} Add to Claude Code CLI?`, true);
    if (addCode) await configureClaudeCode(mcpUrl);
  } catch { /* stdin not available in some environments */ }

  dbQueries.setSetting('first_run_done', '1');
  console.log(`\n  ${paint.dim('Skip future prompts: set WASPER_NO_FIRST_RUN=1')}\n`);
}
