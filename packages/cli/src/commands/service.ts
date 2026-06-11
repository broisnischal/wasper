import { join } from 'path';
import { homedir } from 'os';
import { mkdir, writeFile, unlink } from 'fs/promises';
import { paint } from '../ui';

const IS_LINUX = process.platform === 'linux';
const IS_MAC   = process.platform === 'darwin';

// ─── Resolve the wasper executable path ─────────────────────────────────────

async function resolveWasperBin(): Promise<string> {
  // Compiled standalone binary: process.execPath is wasper itself
  const exec = process.execPath;
  if (!exec.endsWith('/bun') && !exec.endsWith('/bun-debug') && !exec.endsWith('/bun-profile')) {
    return exec;
  }
  // Bun interpreter mode: try `which wasper` for the installed global bin
  try {
    const r = await Bun.$`which wasper`.quiet();
    const p = r.stdout.toString().trim();
    if (p) return p;
  } catch { /* not in PATH */ }
  // Fallback: invoke via bun directly
  return `${exec} ${Bun.main}`;
}

// ─── Linux systemd user service ──────────────────────────────────────────────

const SYSTEMD_SERVICE = 'wasper';
const SYSTEMD_UNIT_DIR = join(homedir(), '.config', 'systemd', 'user');
const SYSTEMD_UNIT_FILE = join(SYSTEMD_UNIT_DIR, `${SYSTEMD_SERVICE}.service`);

async function buildSystemdUnit(wasperBin: string, port: number, specUrl?: string): Promise<string> {
  const wasperDir = join(homedir(), '.wasper');
  const logPath   = join(wasperDir, `server-${port}.log`);
  const envBlock  = [`PORT=${port}`, ...(specUrl ? [`WASPER_SPEC_URL=${specUrl}`] : [])];

  const execArgs = ['start', '--_daemon', '--port', String(port), ...(specUrl ? ['--url', specUrl] : [])];

  return `[Unit]
Description=Wasper OpenAPI Agent
After=network.target

[Service]
Type=simple
ExecStart=${wasperBin} ${execArgs.join(' ')}
Restart=on-failure
RestartSec=5
Environment=${envBlock.join(' ')}
StandardOutput=append:${logPath}
StandardError=append:${logPath}

[Install]
WantedBy=default.target
`;
}

async function systemctl(...args: string[]): Promise<number> {
  const proc = Bun.spawn(['systemctl', '--user', ...args], {
    stdout: 'inherit',
    stderr: 'inherit',
  });
  return proc.exited;
}

async function installLinux(port: number, specUrl?: string): Promise<void> {
  const wasperBin = await resolveWasperBin();
  await mkdir(SYSTEMD_UNIT_DIR, { recursive: true });
  await mkdir(join(homedir(), '.wasper'), { recursive: true });

  const unit = await buildSystemdUnit(wasperBin, port, specUrl);
  await writeFile(SYSTEMD_UNIT_FILE, unit);

  await systemctl('daemon-reload');
  await systemctl('enable', SYSTEMD_SERVICE);

  console.log(`\n  ${paint.green('✓')}  Service installed`);
  console.log(`     ${paint.dim(SYSTEMD_UNIT_FILE)}`);
  console.log(`\n  ${paint.dim('Start now:    wasper service start')}`);
  console.log(`  ${paint.dim('Auto-starts on login (systemd user session)')}\n`);
}

async function uninstallLinux(): Promise<void> {
  await systemctl('stop',    SYSTEMD_SERVICE).catch(() => {});
  await systemctl('disable', SYSTEMD_SERVICE).catch(() => {});
  try { await unlink(SYSTEMD_UNIT_FILE); } catch { /* already gone */ }
  await systemctl('daemon-reload');
  console.log(`\n  ${paint.green('✓')}  Service uninstalled\n`);
}

// ─── macOS LaunchAgent ────────────────────────────────────────────────────────

const LAUNCH_LABEL   = 'com.wasper.agent';
const LAUNCH_DIR     = join(homedir(), 'Library', 'LaunchAgents');
const LAUNCH_PLIST   = join(LAUNCH_DIR, `${LAUNCH_LABEL}.plist`);

function buildPlist(wasperBin: string, port: number, specUrl?: string): string {
  const logFile = join(homedir(), '.wasper', `server-${port}.log`);
  const args    = [wasperBin, 'start', '--_daemon', '--port', String(port), ...(specUrl ? ['--url', specUrl] : [])];
  const argsXml = args.map(a => `\t\t<string>${a}</string>`).join('\n');

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
\t<key>Label</key>
\t<string>${LAUNCH_LABEL}</string>
\t<key>ProgramArguments</key>
\t<array>
${argsXml}
\t</array>
\t<key>RunAtLoad</key>
\t<true/>
\t<key>KeepAlive</key>
\t<true/>
\t<key>StandardOutPath</key>
\t<string>${logFile}</string>
\t<key>StandardErrorPath</key>
\t<string>${logFile}</string>
</dict>
</plist>
`;
}

async function launchctl(...args: string[]): Promise<number> {
  const proc = Bun.spawn(['launchctl', ...args], { stdout: 'inherit', stderr: 'inherit' });
  return proc.exited;
}

async function installMac(port: number, specUrl?: string): Promise<void> {
  const wasperBin = await resolveWasperBin();
  await mkdir(LAUNCH_DIR, { recursive: true });
  await mkdir(join(homedir(), '.wasper'), { recursive: true });

  const plist = buildPlist(wasperBin, port, specUrl);

  await writeFile(LAUNCH_PLIST, plist);
  await launchctl('load', '-w', LAUNCH_PLIST);

  console.log(`\n  ${paint.green('✓')}  Launch Agent installed`);
  console.log(`     ${paint.dim(LAUNCH_PLIST)}`);
  console.log(`\n  ${paint.dim('Auto-starts on login (macOS LaunchAgent)')}\n`);
}

async function uninstallMac(): Promise<void> {
  await launchctl('unload', '-w', LAUNCH_PLIST).catch(() => {});
  try { await unlink(LAUNCH_PLIST); } catch { /* already gone */ }
  console.log(`\n  ${paint.green('✓')}  Launch Agent uninstalled\n`);
}

// ─── Main ─────────────────────────────────────────────────────────────────────

export async function run() {
  const rawArgs = process.argv.slice(2).filter(a => a !== 'service');
  const sub     = rawArgs.find(a => !a.startsWith('-')) ?? 'help';

  // Parse --port and --url from remaining args
  const portIdx = rawArgs.findIndex(a => a === '--port' || a === '-p');
  const port    = portIdx >= 0 ? parseInt(rawArgs[portIdx + 1] ?? '3388', 10) : (parseInt(process.env.WASPER_PORT ?? '', 10) || 3388);

  const urlIdx  = rawArgs.findIndex(a => a === '--url' || a === '-u');
  const specUrl = urlIdx >= 0 ? rawArgs[urlIdx + 1] : process.env.WASPER_SPEC_URL;

  if (!IS_LINUX && !IS_MAC) {
    console.log(`\n  ${paint.yellow('○')}  Service management is only supported on Linux (systemd) and macOS (launchd)\n`);
    process.exit(1);
  }

  const platform = IS_LINUX ? 'Linux (systemd --user)' : 'macOS (LaunchAgent)';

  switch (sub) {
    case 'install': {
      if (IS_LINUX) await installLinux(port, specUrl);
      else          await installMac(port, specUrl);
      break;
    }

    case 'uninstall': {
      if (IS_LINUX) await uninstallLinux();
      else          await uninstallMac();
      break;
    }

    case 'start': {
      if (IS_LINUX) {
        await systemctl('start', SYSTEMD_SERVICE);
      } else {
        await launchctl('load', '-w', LAUNCH_PLIST);
      }
      break;
    }

    case 'stop': {
      if (IS_LINUX) {
        await systemctl('stop', SYSTEMD_SERVICE);
      } else {
        await launchctl('unload', LAUNCH_PLIST);
      }
      break;
    }

    case 'restart': {
      if (IS_LINUX) {
        await systemctl('restart', SYSTEMD_SERVICE);
      } else {
        await launchctl('unload', LAUNCH_PLIST).catch(() => {});
        await Bun.sleep(500);
        await launchctl('load', '-w', LAUNCH_PLIST);
      }
      break;
    }

    case 'status': {
      if (IS_LINUX) {
        await systemctl('status', SYSTEMD_SERVICE);
      } else {
        await launchctl('list', LAUNCH_LABEL);
      }
      break;
    }

    case 'enable': {
      if (IS_LINUX) {
        await systemctl('enable', SYSTEMD_SERVICE);
      } else {
        console.log(`\n  ${paint.dim('On macOS, RunAtLoad=true in the plist controls auto-start.')}`);
        console.log(`  ${paint.dim('Use: wasper service install to re-install with auto-start enabled.')}\n`);
      }
      break;
    }

    case 'disable': {
      if (IS_LINUX) {
        await systemctl('disable', SYSTEMD_SERVICE);
      } else {
        console.log(`\n  ${paint.dim('On macOS, use: wasper service uninstall to remove auto-start.')}\n`);
      }
      break;
    }

    case 'logs': {
      if (IS_LINUX) {
        const proc = Bun.spawn(['journalctl', '--user', '-u', SYSTEMD_SERVICE, '-f', '--no-pager'], {
          stdout: 'inherit', stderr: 'inherit',
        });
        await proc.exited;
      } else {
        const logPath = join(homedir(), '.wasper', 'server.log');
        const proc = Bun.spawn(['tail', '-f', logPath], { stdout: 'inherit', stderr: 'inherit' });
        await proc.exited;
      }
      break;
    }

    case 'cat': {
      // Print the generated unit/plist for inspection
      if (IS_LINUX) {
        const wasperBin = await resolveWasperBin();
        process.stdout.write(await buildSystemdUnit(wasperBin, port, specUrl));
      } else {
        const wasperBin = await resolveWasperBin();
        process.stdout.write(buildPlist(wasperBin, port, specUrl));
      }
      break;
    }

    default: {
      console.log(`
  ${paint.bold('wasper service')}  —  Manage wasper as a system service  ${paint.dim(`(${platform})`)}

  ${paint.bold('Commands')}
    wasper service install    Install and enable (auto-start on login)
    wasper service uninstall  Remove the service
    wasper service start      Start the service now
    wasper service stop       Stop the service
    wasper service restart    Restart the service
    wasper service status     Show service status
    wasper service enable     Enable auto-start on login  ${paint.dim('(Linux)')}
    wasper service disable    Disable auto-start          ${paint.dim('(Linux)')}
    wasper service logs       Follow service logs
    wasper service cat        Print the generated unit/plist

  ${paint.bold('Options')}
    --url <spec>    OpenAPI spec URL to embed in the service definition
    --port <port>   Port  ${paint.dim('(default: 3388)')}
`);
    }
  }
}
