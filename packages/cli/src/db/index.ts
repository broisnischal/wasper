import { Database } from 'bun:sqlite';
import { SCHEMA } from './schema';
import { join } from 'path';
import { mkdirSync, existsSync } from 'fs';
import { homedir } from 'os';
import { randomUUID } from 'crypto';

// Data dir resolution: explicit env override → legacy in-repo dir (dev installs
// that already have data) → ~/.wasper/data (global installs + compiled binaries).
function resolveDataDir(): string {
  if (process.env.WASPER_DATA_DIR ?? process.env.OPENAPI_AGENT_DATA_DIR) {
    return (process.env.WASPER_DATA_DIR ?? process.env.OPENAPI_AGENT_DATA_DIR)!;
  }
  try {
    const legacy = join(import.meta.dir, '../../data');
    if (!Bun.main.includes('$bunfs') && (existsSync(join(legacy, 'wasper.db')) || existsSync(join(legacy, 'openapi-agent.db')))) return legacy;
  } catch { /* compiled binary — import.meta.dir is virtual */ }
  // Migrate from old ~/.openapi-agent/data if it exists
  const oldDir = join(homedir(), '.openapi-agent', 'data');
  if (existsSync(oldDir)) return oldDir;
  return join(homedir(), '.wasper', 'data');
}

const DATA_DIR = resolveDataDir();
mkdirSync(DATA_DIR, { recursive: true });
const DB_PATH = join(DATA_DIR, existsSync(join(DATA_DIR, 'openapi-agent.db')) && !existsSync(join(DATA_DIR, 'wasper.db')) ? 'openapi-agent.db' : 'wasper.db');

export const db = new Database(DB_PATH, { create: true });
db.exec('PRAGMA journal_mode = WAL;');
db.exec('PRAGMA foreign_keys = OFF;');

// Migrate away from old multi-spec schema if present
const hasOldSchema = db
  .query("SELECT name FROM sqlite_master WHERE type='table' AND name='specs'")
  .get() !== null;
if (hasOldSchema) {
  db.exec('DROP TABLE IF EXISTS tools; DROP TABLE IF EXISTS specs; DROP TABLE IF EXISTS auth_configs; DROP TABLE IF EXISTS request_logs;');
}

db.exec(SCHEMA);

export interface InterceptRuleRow {
  id: string;
  enabled: number; // 0 or 1
  name: string;
  sort_order: number;
  match_path: string;
  match_method: string;
  target_host: string;
  strip_prefix: string;
  add_prefix: string;
  add_headers: string; // JSON
  created_at: number;
}

export interface AuthConfigRow {
  id: string;
  type: string;
  config: string;
  token_cache: string | null;
  updated_at: number;
}

export interface AuthProfileRow {
  id: string;
  name: string;
  description: string;
  type: string;
  config: string;       // JSON
  token_cache: string | null;
  is_active: number;    // 0 or 1
  created_at: number;
}

export interface SavedRequestRow {
  id: string;
  name: string;
  folder: string;
  method: string;
  url: string;
  headers: string;   // JSON KVRow[]
  params: string;    // JSON KVRow[]
  body: string;
  body_type: string;
  raw_type: string;
  form_rows: string; // JSON KVRow[]
  auth: string;      // JSON AuthConfig
  notes: string;
  created_at: number;
  updated_at: number;
}

export interface CaptureBinRow {
  id: string;
  name: string;
  created_at: number;
}

export interface WorkflowRow {
  id: string;
  name: string;
  description: string;
  steps: string; // JSON WorkflowStep[]
  created_at: number;
  updated_at: number;
}

export interface SpecHistoryRow {
  id: string;
  url: string;
  title: string | null;
  version: string | null;
  endpoint_count: number | null;
  last_used: number;
  created_at: number;
}

export interface LogRow {
  id: string;
  source: string;
  tool_name: string | null;
  method: string;
  url: string;
  request_headers: string | null;
  request_body: string | null;
  status_code: number | null;
  response_headers: string | null;
  response_body: string | null;
  latency_ms: number | null;
  error: string | null;
  created_at: number;
}

// The active profile is the single source of truth for auth, but the request
// executors (MCP, AI agent, proxy, workflows) read the `auth_config` 'default'
// row. This mirrors a profile's config (and its token cache) into that row so
// the two never drift — call it on every mutation of the active profile.
function mirrorProfileToAuthConfig(profile: AuthProfileRow): void {
  db.query(`INSERT INTO auth_config (id, type, config, token_cache, updated_at)
            VALUES ('default', $type, $config, $token_cache, unixepoch())
            ON CONFLICT(id) DO UPDATE SET
              type = excluded.type,
              config = excluded.config,
              token_cache = excluded.token_cache,
              updated_at = unixepoch()`)
    .run({ $type: profile.type, $config: profile.config, $token_cache: profile.token_cache });
}

export const dbQueries = {
  getAuthConfig: () =>
    db.query("SELECT * FROM auth_config WHERE id = 'default'").get() as AuthConfigRow | null,

  setAuthConfig: (type: string, config: object) =>
    db.query(`INSERT INTO auth_config (id, type, config, updated_at)
              VALUES ('default', ?, ?, unixepoch())
              ON CONFLICT(id) DO UPDATE SET type = excluded.type, config = excluded.config, updated_at = unixepoch()`)
      .run(type, JSON.stringify(config)),

  updateTokenCache: (tokenCache: object | null) =>
    db.query("UPDATE auth_config SET token_cache = ? WHERE id = 'default'")
      .run(tokenCache ? JSON.stringify(tokenCache) : null),

  getRecentLogs: (limit = 500) =>
    db.query('SELECT * FROM request_logs ORDER BY created_at DESC LIMIT ?').all(limit) as LogRow[],

  insertLog: (data: Omit<LogRow, 'created_at'>) =>
    db.query(`INSERT INTO request_logs
              (id, source, tool_name, method, url, request_headers, request_body,
               status_code, response_headers, response_body, latency_ms, error)
              VALUES ($id, $source, $tool_name, $method, $url, $request_headers, $request_body,
               $status_code, $response_headers, $response_body, $latency_ms, $error)`)
      .run({
        $id: data.id,
        $source: data.source,
        $tool_name: data.tool_name,
        $method: data.method,
        $url: data.url,
        $request_headers: data.request_headers,
        $request_body: data.request_body,
        $status_code: data.status_code,
        $response_headers: data.response_headers,
        $response_body: data.response_body,
        $latency_ms: data.latency_ms,
        $error: data.error,
      }),

  clearLogs: () => db.query('DELETE FROM request_logs').run(),

  getRules: (): InterceptRuleRow[] =>
    db.query('SELECT * FROM intercept_rules ORDER BY sort_order, created_at').all() as InterceptRuleRow[],

  insertRule: (rule: Omit<InterceptRuleRow, 'created_at'>) =>
    db.query(`INSERT INTO intercept_rules (id,enabled,name,sort_order,match_path,match_method,target_host,strip_prefix,add_prefix,add_headers)
      VALUES ($id,$enabled,$name,$sort_order,$match_path,$match_method,$target_host,$strip_prefix,$add_prefix,$add_headers)`)
      .run({ $id: rule.id, $enabled: rule.enabled, $name: rule.name, $sort_order: rule.sort_order,
        $match_path: rule.match_path, $match_method: rule.match_method, $target_host: rule.target_host,
        $strip_prefix: rule.strip_prefix, $add_prefix: rule.add_prefix, $add_headers: rule.add_headers }),

  updateRule: (id: string, patch: Partial<Omit<InterceptRuleRow, 'id' | 'created_at'>>) => {
    const cols = Object.keys(patch).map(k => `${k} = $${k}`).join(', ');
    const params: Record<string, string | number> = { $id: id };
    for (const [k, v] of Object.entries(patch)) params[`$${k}`] = v as string | number;
    db.query(`UPDATE intercept_rules SET ${cols} WHERE id = $id`).run(params);
  },

  deleteRule: (id: string) =>
    db.query('DELETE FROM intercept_rules WHERE id = ?').run(id),

  getSettings: (): { value: string } | null =>
    db.query<{ value: string }, []>("SELECT value FROM settings WHERE key='app' LIMIT 1").get() ?? null,

  setSettings: (value: Record<string, unknown>): void => {
    db.run(
      "INSERT INTO settings(key,value) VALUES('app',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      [JSON.stringify(value)],
    );
  },

  getProfiles: (): AuthProfileRow[] =>
    db.query('SELECT * FROM auth_profiles ORDER BY name COLLATE NOCASE').all() as AuthProfileRow[],

  getActiveProfile: (): AuthProfileRow | null =>
    db.query('SELECT * FROM auth_profiles WHERE is_active = 1 LIMIT 1').get() as AuthProfileRow | null,

  insertProfile: (p: Omit<AuthProfileRow, 'created_at'>) =>
    db.query(`INSERT INTO auth_profiles (id,name,description,type,config,token_cache,is_active)
      VALUES ($id,$name,$description,$type,$config,$token_cache,$is_active)`)
      .run({ $id: p.id, $name: p.name, $description: p.description, $type: p.type,
        $config: p.config, $token_cache: p.token_cache, $is_active: p.is_active }),

  updateProfile: (id: string, patch: Partial<Omit<AuthProfileRow, 'id' | 'created_at'>>) => {
    const cols = Object.keys(patch).map(k => `${k} = $${k}`).join(', ');
    const params: Record<string, string | number | null> = { $id: id };
    for (const [k, v] of Object.entries(patch)) params[`$${k}`] = v as string | number | null;
    db.query(`UPDATE auth_profiles SET ${cols} WHERE id = $id`).run(params);
    // If the edited profile is the active one, push its new config to auth_config
    // so executors don't keep using the stale (e.g. expired) token.
    const updated = db.query('SELECT * FROM auth_profiles WHERE id = ?').get(id) as AuthProfileRow | null;
    if (updated && updated.is_active === 1) mirrorProfileToAuthConfig(updated);
  },

  deleteProfile: (id: string) =>
    db.query('DELETE FROM auth_profiles WHERE id = ?').run(id),

  activateProfile: (id: string) => {
    const profile = db.query('SELECT * FROM auth_profiles WHERE id = ?').get(id) as AuthProfileRow | null;
    if (!profile) return;
    db.query('UPDATE auth_profiles SET is_active = 0').run();
    db.query('UPDATE auth_profiles SET is_active = 1 WHERE id = ?').run(id);
    // Mirror profile config (and its token cache) to auth_config so the request
    // executors use it. Resetting token_cache avoids reusing a prior profile's
    // cached OAuth token.
    mirrorProfileToAuthConfig(profile);
  },

  // Re-sync auth_config from the active profile. Heals DBs that drifted under
  // older builds (which didn't mirror on profile edits); safe to call on boot.
  reconcileActiveAuthConfig: () => {
    const active = db.query('SELECT * FROM auth_profiles WHERE is_active = 1 LIMIT 1').get() as AuthProfileRow | null;
    if (active) mirrorProfileToAuthConfig(active);
  },

  // ── Saved requests ──────────────────────────────────────────────────────────
  getSavedRequests: (): SavedRequestRow[] =>
    db.query('SELECT * FROM saved_requests ORDER BY folder, name COLLATE NOCASE').all() as SavedRequestRow[],

  getSavedRequest: (id: string): SavedRequestRow | null =>
    db.query('SELECT * FROM saved_requests WHERE id = ?').get(id) as SavedRequestRow | null,

  insertSavedRequest: (r: Omit<SavedRequestRow, 'created_at' | 'updated_at'>) =>
    db.query(`INSERT INTO saved_requests
      (id, name, folder, method, url, headers, params, body, body_type, raw_type, form_rows, auth, notes)
      VALUES ($id,$name,$folder,$method,$url,$headers,$params,$body,$body_type,$raw_type,$form_rows,$auth,$notes)`)
      .run({ $id: r.id, $name: r.name, $folder: r.folder, $method: r.method, $url: r.url,
        $headers: r.headers, $params: r.params, $body: r.body, $body_type: r.body_type,
        $raw_type: r.raw_type, $form_rows: r.form_rows, $auth: r.auth, $notes: r.notes }),

  updateSavedRequest: (id: string, patch: Partial<Omit<SavedRequestRow, 'id' | 'created_at' | 'updated_at'>>) => {
    const cols = Object.keys(patch).map(k => `${k} = $${k}`).join(', ');
    const params: Record<string, string | number> = { $id: id };
    for (const [k, v] of Object.entries(patch)) params[`$${k}`] = v as string | number;
    db.query(`UPDATE saved_requests SET ${cols}, updated_at = unixepoch() WHERE id = $id`).run(params);
  },

  deleteSavedRequest: (id: string) =>
    db.query('DELETE FROM saved_requests WHERE id = ?').run(id),

  // ── Spec history ───────────────────────────────────────────────────────────
  getSpecHistory: (): SpecHistoryRow[] =>
    db.query('SELECT * FROM spec_history ORDER BY last_used DESC').all() as SpecHistoryRow[],

  getLastSpec: (): SpecHistoryRow | null =>
    db.query('SELECT * FROM spec_history ORDER BY last_used DESC LIMIT 1').get() as SpecHistoryRow | null,

  upsertSpec: (url: string, title: string | null, version: string | null, endpointCount: number | null): void => {
    const existing = db.query<{ id: string }, [string]>('SELECT id FROM spec_history WHERE url = ?').get(url);
    if (existing) {
      db.query('UPDATE spec_history SET title=?, version=?, endpoint_count=?, last_used=unixepoch() WHERE url=?')
        .run(title, version, endpointCount, url);
    } else {
      db.query(`INSERT INTO spec_history (id, url, title, version, endpoint_count)
        VALUES (?, ?, ?, ?, ?)`)
        .run(randomUUID(), url, title, version, endpointCount);
    }
  },

  deleteSpec: (id: string): void => {
    db.query('DELETE FROM spec_history WHERE id = ?').run(id);
  },

  // ── Workflows ──────────────────────────────────────────────────────────────
  getWorkflows: (): WorkflowRow[] =>
    db.query('SELECT * FROM workflows ORDER BY updated_at DESC').all() as WorkflowRow[],

  getWorkflow: (id: string): WorkflowRow | null =>
    db.query('SELECT * FROM workflows WHERE id = ?').get(id) as WorkflowRow | null,

  insertWorkflow: (w: Omit<WorkflowRow, 'created_at' | 'updated_at'>) =>
    db.query('INSERT INTO workflows (id, name, description, steps) VALUES ($id, $name, $description, $steps)')
      .run({ $id: w.id, $name: w.name, $description: w.description, $steps: w.steps }),

  updateWorkflow: (id: string, patch: Partial<Pick<WorkflowRow, 'name' | 'description' | 'steps'>>) => {
    const cols = Object.keys(patch).map(k => `${k} = $${k}`).join(', ');
    const params: Record<string, string> = { $id: id };
    for (const [k, v] of Object.entries(patch)) params[`$${k}`] = v as string;
    db.query(`UPDATE workflows SET ${cols}, updated_at = unixepoch() WHERE id = $id`).run(params);
  },

  deleteWorkflow: (id: string) =>
    db.query('DELETE FROM workflows WHERE id = ?').run(id),

  // ── Capture bins ───────────────────────────────────────────────────────────
  getCaptureBins: (): CaptureBinRow[] =>
    db.query('SELECT * FROM capture_bins ORDER BY created_at DESC').all() as CaptureBinRow[],

  getCaptureBin: (id: string): CaptureBinRow | null =>
    db.query('SELECT * FROM capture_bins WHERE id = ?').get(id) as CaptureBinRow | null,

  insertCaptureBin: (id: string, name: string): void => {
    db.query('INSERT INTO capture_bins (id, name) VALUES (?, ?)').run(id, name);
  },

  deleteCaptureBin: (id: string): void => {
    db.query('DELETE FROM capture_bins WHERE id = ?').run(id);
  },

  // ── Generic key-value settings ──────────────────────────────────────────────
  getSetting: (key: string): string | null =>
    (db.query<{ value: string }, [string]>('SELECT value FROM settings WHERE key = ?').get(key) ?? null)?.value ?? null,

  setSetting: (key: string, value: string): void => {
    db.run('INSERT INTO settings(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value', [key, value]);
  },

  // ── Chat memory ────────────────────────────────────────────────────────────
  saveMemory: (role: string, content: string): void => {
    db.query('INSERT INTO chat_memory (role, content) VALUES (?, ?)').run(role, content);
  },

  getMemory: (limit = 20): { role: string; content: string }[] => {
    const rows = db.query<{ role: string; content: string }, [number]>(
      'SELECT role, content FROM chat_memory ORDER BY created_at DESC LIMIT ?'
    ).all(limit) as { role: string; content: string }[];
    return rows.reverse(); // oldest first for context
  },

  clearMemory: (): void => {
    db.query('DELETE FROM chat_memory').run();
  },

  trimMemory: (keepLast = 40): void => {
    db.query(
      'DELETE FROM chat_memory WHERE id NOT IN (SELECT id FROM chat_memory ORDER BY created_at DESC LIMIT ?)'
    ).run(keepLast);
  },
};

export { randomUUID };
