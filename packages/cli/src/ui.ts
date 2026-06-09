// ─── ANSI color / style helpers ──────────────────────────────────────────────
export const isTTY = process.stdout.isTTY ?? false;

const esc = (s: string) => (isTTY ? s : '');
export const clr = {
  reset:  esc('\x1B[0m'),
  bold:   esc('\x1B[1m'),
  dim:    esc('\x1B[2m'),
  green:  esc('\x1B[32m'),
  cyan:   esc('\x1B[36m'),
  yellow: esc('\x1B[33m'),
  red:    esc('\x1B[31m'),
  gray:   esc('\x1B[90m'),
};

export const paint = {
  green:  (s: string) => `${clr.green}${s}${clr.reset}`,
  cyan:   (s: string) => `${clr.cyan}${s}${clr.reset}`,
  yellow: (s: string) => `${clr.yellow}${s}${clr.reset}`,
  red:    (s: string) => `${clr.red}${s}${clr.reset}`,
  gray:   (s: string) => `${clr.gray}${s}${clr.reset}`,
  dim:    (s: string) => `${clr.dim}${s}${clr.reset}`,
  bold:   (s: string) => `${clr.bold}${s}${clr.reset}`,
  url:    (s: string) => `${clr.cyan}${s}${clr.reset}`,
};

// ─── Spinner ──────────────────────────────────────────────────────────────────
const FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export class Spinner {
  private i = 0;
  private timer: ReturnType<typeof setInterval> | null = null;
  private msg = '';

  start(msg: string) {
    this.msg = msg;
    if (!isTTY) { process.stdout.write(`  ${msg}\n`); return; }
    this.i = 0;
    this.timer = setInterval(() => {
      const f = FRAMES[this.i++ % FRAMES.length]!;
      process.stdout.write(`\r  ${paint.cyan(f)}  ${this.msg}\x1B[K`);
    }, 80);
  }

  update(msg: string) { this.msg = msg; }

  stop(icon = '✓', msg = '', color: keyof typeof paint = 'green') {
    if (this.timer) { clearInterval(this.timer); this.timer = null; }
    if (!isTTY) { if (msg) process.stdout.write(`  ${icon}  ${msg}\n`); return; }
    process.stdout.write(
      msg
        ? `\r  ${(paint[color] as (s: string) => string)(icon)}  ${msg}\x1B[K\n`
        : `\r\x1B[K`,
    );
  }
}

// ─── Startup banner ───────────────────────────────────────────────────────────
export function printBanner(opts: {
  port: number;
  pid: number;
  specTitle?: string;
  specVersion?: string;
  endpointCount?: number;
}) {
  const { port, pid, specTitle, specVersion, endpointCount } = opts;
  const base = `http://localhost:${port}`;

  const arrow = paint.cyan('➜');
  const dot   = paint.dim('·');

  const hint = [
    `${paint.bold('r')} reload`,
    `${paint.bold('b')} background`,
    `${paint.bold('q')} quit`,
    `${paint.bold('?')} help`,
  ].join(`  ${dot}  `);

  const lines: string[] = [
    '',
    `  ${paint.bold('openapi-agent')}  ${paint.dim('PID ' + pid)}`,
    '',
    `  ${arrow}  ${paint.dim('Studio ')}  ${paint.url(base + '/')}`,
    `  ${arrow}  ${paint.dim('MCP    ')}  ${paint.url(base + '/mcp')}`,
    `  ${arrow}  ${paint.dim('OpenAPI')}  ${paint.url(base + '/openapi.json')}`,
    '',
  ];

  if (specTitle) {
    const ep = endpointCount != null ? `  ${dot}  ${paint.green(endpointCount + ' endpoints')}` : '';
    lines.push(`  ${paint.green('✓')}  ${paint.bold(specTitle)}  ${paint.dim('v' + (specVersion ?? ''))}${ep}`);
  } else {
    lines.push(`  ${paint.yellow('○')}  ${paint.dim('No spec — start with --url <url>')}`);
  }

  lines.push('', `  ${hint}`, '');

  console.log(lines.join('\n'));
}

// ─── Status display ───────────────────────────────────────────────────────────
function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  if (h > 0) return `${h}h ${m % 60}m`;
  if (m > 0) return `${m}m ${s % 60}s`;
  return `${s}s`;
}

export function printStatus(opts: {
  running: boolean;
  pid?: number;
  port?: number;
  uptime?: number;
  specTitle?: string;
  specVersion?: string;
  endpointCount?: number;
  specUrl?: string;
}) {
  const { running, pid, port, uptime, specTitle, specVersion, endpointCount } = opts;

  if (!running) {
    console.log(`\n  ${paint.dim('○')}  ${paint.bold('OpenAPI Agent')}  ${paint.dim('·')}  ${paint.yellow('not running')}\n`);
    return;
  }

  const rows: [string, string][] = [
    ['pid     ', String(pid)],
    ['port    ', String(port)],
    ['uptime  ', uptime != null ? fmtUptime(uptime) : '—'],
    ['spec    ', specTitle ? `${specTitle} ${paint.dim('v' + (specVersion ?? ''))}` : '—'],
    ['endpoints', String(endpointCount ?? '—')],
  ];

  const maxKey = Math.max(...rows.map(([k]) => k.length));

  console.log(`\n  ${paint.green('●')}  ${paint.bold('OpenAPI Agent')}  ${paint.dim('·')}  ${paint.green('running')}`);
  console.log();
  for (const [k, v] of rows) {
    console.log(`     ${paint.dim(k.padEnd(maxKey))}  ${v}`);
  }
  if (port) {
    console.log();
    console.log(`     ${paint.url(`http://localhost:${port}/`)}  ${paint.dim('·')}  ${paint.url(`http://localhost:${port}/mcp`)}`);
  }
  console.log();
}
