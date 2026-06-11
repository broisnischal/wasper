import { join } from 'path';
import { homedir } from 'os';
import { mkdir, readFile, readdir, writeFile, unlink } from 'fs/promises';

export const WASPER_DIR = join(homedir(), '.wasper');
const DEFAULT_PORT = 3388;

export interface DaemonState {
  pid: number;
  port: number;
  specUrl: string | null;
  startedAt: number;
  host?: string;
  origin?: string | null;
  token?: string | null;
}

async function ensureDir() {
  await mkdir(WASPER_DIR, { recursive: true });
}

function stateFile(port: number): string {
  return join(WASPER_DIR, `server-${port}.json`);
}

export function logFile(port: number): string {
  return join(WASPER_DIR, `server-${port}.log`);
}

export async function writeDaemonState(s: DaemonState): Promise<void> {
  await ensureDir();
  await writeFile(stateFile(s.port), JSON.stringify(s, null, 2), 'utf-8');
}

/** Read all currently-running daemon instances, sorted by port. */
export async function readAllDaemonStates(): Promise<DaemonState[]> {
  try {
    const files = await readdir(WASPER_DIR);
    const states: DaemonState[] = [];

    for (const f of files) {
      // server-3388.json  OR  legacy server.json
      if (!f.match(/^server(-\d+)?\.json$/)) continue;
      const filePath = join(WASPER_DIR, f);
      try {
        const raw   = await readFile(filePath, 'utf-8');
        const state = JSON.parse(raw) as DaemonState;
        if (isProcessAlive(state.pid)) {
          states.push(state);
        } else {
          await unlink(filePath).catch(() => {});
        }
      } catch { /* skip malformed */ }
    }

    return states.sort((a, b) => a.port - b.port);
  } catch {
    return [];
  }
}

/**
 * Read the daemon state for a specific port.
 * If port is omitted, returns the single running instance, or the default-port
 * one when multiple are running (preserves backward-compat for single-instance users).
 */
export async function readDaemonState(port?: number): Promise<DaemonState | null> {
  if (port !== undefined) {
    try {
      const raw   = await readFile(stateFile(port), 'utf-8');
      const state = JSON.parse(raw) as DaemonState;
      return isProcessAlive(state.pid) ? state : null;
    } catch { return null; }
  }

  const all = await readAllDaemonStates();
  if (all.length === 0) return null;
  if (all.length === 1) return all[0]!;
  return all.find(s => s.port === DEFAULT_PORT) ?? all[0]!;
}

export async function clearDaemonState(port: number): Promise<void> {
  try { await unlink(stateFile(port)); } catch { /* */ }
  // Also clear legacy server.json if it matches this port
  try {
    const raw   = await readFile(join(WASPER_DIR, 'server.json'), 'utf-8');
    const state = JSON.parse(raw) as DaemonState;
    if (state.port === port) await unlink(join(WASPER_DIR, 'server.json')).catch(() => {});
  } catch { /* */ }
}

export function isProcessAlive(pid: number): boolean {
  try { process.kill(pid, 0); return true; } catch { return false; }
}

export interface DaemonOptions {
  host?: string;
  origin?: string | null;
  token?: string | null;
  features?: { mcp: boolean; proxy: boolean; ai: boolean; readonly: boolean };
}

export async function spawnDaemon(specUrl: string | null, port: number, opts: DaemonOptions = {}): Promise<number> {
  const args: string[] = [];
  if (specUrl) { args.push('--url', specUrl); }
  args.push('--port', String(port));
  if (opts.host)   args.push('--host', opts.host);
  if (opts.origin) args.push('--origin', opts.origin);
  if (opts.token)  args.push('--token', opts.token);
  if (opts.features) {
    if (!opts.features.mcp)     args.push('--no-mcp');
    if (!opts.features.proxy)   args.push('--no-proxy');
    if (!opts.features.ai)      args.push('--no-ai');
    if (opts.features.readonly) args.push('--readonly');
  }
  args.push('--_daemon');

  await ensureDir();
  const child = Bun.spawn([process.execPath, Bun.main, ...args], {
    detached: true,
    cwd:      process.cwd(),
    env:      { ...process.env },
    stdio:    ['ignore', Bun.file(logFile(port)), Bun.file(logFile(port))],
  });

  child.unref();
  return child.pid;
}
