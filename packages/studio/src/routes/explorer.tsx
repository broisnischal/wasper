import { createFileRoute, Link } from '@tanstack/react-router';
import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { apiClient } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { JsonViewer } from '../components/JsonViewer';
import { JsonTree } from '../components/JsonTree';
import { SuggestInput } from '../components/SuggestInput';
import { CodeModal } from '../components/CodeModal';
import { COMMON_HEADERS, HEADER_VALUE_SUGGESTIONS, RAW_BODY_TYPES, jqFilter, generateJsonSchema } from '../lib/http';
import type { CodeRequest } from '../lib/codegen';
import { cn } from '../lib/utils';
import { useApp } from '../context';
import { resolveVars, type Environment } from '../lib/env';
import {
  listWorkspaces, saveWorkspace, deleteWorkspace, defaultWorkspace,
  getActiveWorkspaceId, setActiveWorkspaceId, DEFAULT_WORKSPACE_ID,
  type Workspace,
} from '../lib/workspace';
import { dbGet, dbPut, dbGetAll, dbDel } from '../lib/storage';
import {
  Search, Plus, X, Send, Copy, Check, ChevronRight, ChevronDown,
  RotateCcw, Download, Bot, Folder, FolderOpen, Cookie, Eye, Lock,
  Code2, FileUp, Braces, AlignLeft, HelpCircle, FileJson, Layers, Trash2,
  Bookmark, BookmarkPlus, Share2, Route as RouteIcon,
  FlaskConical, SlidersHorizontal, ShieldAlert, Terminal, Globe, Info,
  CheckCircle2, XCircle, Clock, RefreshCcw, MoreHorizontal,
  Rows2, Columns2, ChevronsUpDown, PanelLeftClose, PanelLeftOpen, Sparkles,
} from 'lucide-react';

export const Route = createFileRoute('/explorer')({ component: ExplorerPage });

// ── Types ──────────────────────────────────────────────────────────────────
interface ParsedParameter { name: string; in: string; required: boolean; schema: Record<string, unknown>; description?: string; }
interface ParsedRequestBody { required: boolean; contentType: string; schema: Record<string, unknown>; description?: string; }
interface ParsedOperation {
  operationId: string; method: string; path: string;
  summary?: string; description?: string; tags: string[];
  parameters: ParsedParameter[]; requestBody?: ParsedRequestBody;
  responses: Record<string, unknown>;
}
interface FilePayload { name: string; size: number; mime: string; dataB64: string; }
interface KVRow { key: string; value: string; enabled: boolean; kind?: 'text' | 'file'; file?: FilePayload | null; }
interface RequestTiming { dns: number; connect: number; tls: number; send: number; wait: number; receive: number; total: number; }
interface NetworkInfo { scheme: string; host: string; filename: string; remoteAddr: string; httpVersion: string; referrerPolicy: string; }
interface ResponseResult {
  status: number; statusText: string; headers: Record<string, string>;
  body: string; latency: number; size: number; error?: string;
  bodyB64?: string;
  redirectedTo?: string;
  timing?: RequestTiming;
  networkInfo?: NetworkInfo;
}
interface TestResult { name: string; passed: boolean; error?: string; }
// Full auth surface — 'inherit' defers to the workspace; 'cli' uses the CLI's
// globally active auth config; everything else is applied per request.
interface AuthConfig {
  type: 'inherit' | 'cli' | 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'oidc' | 'custom' | 'profile';
  bearer: string;
  basicUser: string;
  basicPass: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query' | 'cookie';
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  oidcUrl: string;
  customRows: KVRow[];
  profileId: string;
  profileName: string;
}
/** Engine-side auth config understood by the CLI (mirror of auth/engine.ts). */
interface EngineAuth {
  type: 'bearer' | 'basic' | 'apikey_header' | 'apikey_query' | 'apikey_cookie' | 'oauth2_cc' | 'oidc' | 'custom';
  token?: string; username?: string; password?: string;
  headerName?: string; apiKey?: string; queryParam?: string; cookieName?: string;
  tokenUrl?: string; clientId?: string; clientSecret?: string; scope?: string;
  openIdConnectUrl?: string; customHeaders?: Record<string, string>;
}
interface RequestTab {
  id: string; title: string; method: string; url: string;
  workspaceId: string;
  /** '' = inherit workspace env · 'none' = no environment · otherwise an env id */
  envId: string;
  params: KVRow[];
  pathParams: KVRow[];
  headers: KVRow[];
  body: string;
  bodyType: 'none' | 'json' | 'form' | 'multipart' | 'raw' | 'binary';
  rawType: string; // mime for raw bodies
  formRows: KVRow[];
  binaryFile: FilePayload | null;
  auth: AuthConfig;
  response: ResponseResult | null;
  loading: boolean;
  interceptRuleId?: string;
  tests: string;
  testResults: TestResult[] | null;
  timeout: number;
  followRedirects: boolean;
}
interface InterceptRule { id: string; name: string; enabled: number; match_path: string; match_method: string; target_host: string; }
interface CookieEntry {
  id: string; name: string; value: string; domain: string; path: string; enabled: boolean;
}
interface AuthProfileRow { id: string; name: string; description: string; type: string; is_active: number | boolean; }
interface SavedRequest {
  id: string; name: string; folder: string;
  method: string; url: string;
  headers: string; params: string; body: string;
  body_type: string; raw_type: string; form_rows: string; auth: string;
  notes: string; created_at: number; updated_at: number;
}

// ── Constants ──────────────────────────────────────────────────────────────
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const MC: Record<string, string> = {
  GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)',
  PATCH: 'var(--method-patch)', DELETE: 'var(--method-delete)', HEAD: 'var(--method-head)',
  OPTIONS: 'var(--method-head)',
};

const DEFAULT_AUTH: AuthConfig = {
  type: 'inherit', bearer: '', basicUser: '', basicPass: '',
  apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header',
  oauthTokenUrl: '', oauthClientId: '', oauthClientSecret: '', oauthScope: '',
  oidcUrl: '', customRows: [{ key: '', value: '', enabled: true }],
  profileId: '', profileName: '',
};

let _seq = 0;
function uid() { return String(++_seq); }

// The page keeps this in sync so blankTab() (also called from hotkeys) lands
// new tabs in the right workspace.
let _currentWorkspaceId = DEFAULT_WORKSPACE_ID;

function blankTab(overrides?: Partial<RequestTab>): RequestTab {
  return {
    id: uid(), title: 'New Request', method: 'GET', url: '',
    workspaceId: _currentWorkspaceId, envId: '',
    params: [{ key: '', value: '', enabled: true }],
    pathParams: [],
    headers: [{ key: '', value: '', enabled: true }],
    body: '', bodyType: 'none', rawType: 'text/plain',
    formRows: [{ key: '', value: '', enabled: true, kind: 'text' }],
    binaryFile: null,
    auth: { ...DEFAULT_AUTH },
    response: null, loading: false,
    tests: '', testResults: null,
    timeout: 0, followRedirects: true,
    ...overrides,
  };
}

/** Old saved tabs used type 'none' to mean "let the CLI apply its auth" — that's now 'inherit'. */
function migrateAuth(a: Partial<AuthConfig> | undefined): AuthConfig {
  if (!a) return { ...DEFAULT_AUTH };
  const merged = { ...DEFAULT_AUTH, ...a };
  if ((a as { type?: string }).type === 'none' && !('customRows' in a)) merged.type = 'inherit';
  return merged;
}

// ── Helpers ────────────────────────────────────────────────────────────────
function extractPathParamKeys(url: string): string[] {
  const matches = [...url.matchAll(/\{([^}]+)\}/g)];
  return matches.map(m => m[1]!);
}

function replacePaths(url: string, pathParams: KVRow[]): string {
  let result = url;
  for (const p of pathParams) {
    if (p.key) result = result.replace(`{${p.key}}`, p.value ? encodeURIComponent(p.value) : `{${p.key}}`);
  }
  return result;
}

function syncPathParams(url: string, current: KVRow[]): KVRow[] {
  const keys = extractPathParamKeys(url);
  if (!keys.length) return [];
  return keys.map(k => current.find(p => p.key === k) ?? { key: k, value: '', enabled: true });
}

function buildUrl(base: string, params: KVRow[]): string {
  const active = params.filter(p => p.enabled && p.key);
  if (!active.length) return base;
  try {
    const url = new URL(base.startsWith('http') ? base : 'http://x/' + base.replace(/^\//, ''));
    active.forEach(p => url.searchParams.append(p.key, p.value));
    return base.startsWith('http') ? url.toString() : url.pathname + url.search;
  } catch {
    return base + '?' + active.map(p => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`).join('&');
  }
}

/** Headers the studio can materialize itself (shown in preview + codegen, sent as-is). */
function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.type === 'bearer' && auth.bearer) return { Authorization: `Bearer ${auth.bearer}` };
  if (auth.type === 'basic' && (auth.basicUser || auth.basicPass)) {
    return { Authorization: `Basic ${btoa(`${auth.basicUser}:${auth.basicPass}`)}` };
  }
  if (auth.type === 'apikey' && auth.apiKeyIn === 'header' && auth.apiKeyName) {
    return { [auth.apiKeyName]: auth.apiKeyValue };
  }
  if (auth.type === 'apikey' && auth.apiKeyIn === 'cookie' && auth.apiKeyName) {
    return { Cookie: `${auth.apiKeyName}=${auth.apiKeyValue}` };
  }
  if (auth.type === 'custom') {
    const out: Record<string, string> = {};
    for (const r of auth.customRows) if (r.enabled && r.key) out[r.key] = r.value;
    return out;
  }
  return {};
}

function buildAuthQueryParams(auth: AuthConfig): KVRow[] {
  if (auth.type === 'apikey' && auth.apiKeyIn === 'query' && auth.apiKeyName) {
    return [{ key: auth.apiKeyName, value: auth.apiKeyValue, enabled: true }];
  }
  return [];
}

/** OAuth2/OIDC can't run in the browser (CORS, secret exposure) — the CLI engine signs those. */
function buildEngineAuth(auth: AuthConfig, resolve: (s: string) => string): EngineAuth | null {
  if (auth.type === 'oauth2') {
    return {
      type: 'oauth2_cc',
      tokenUrl: resolve(auth.oauthTokenUrl), clientId: resolve(auth.oauthClientId),
      clientSecret: resolve(auth.oauthClientSecret), scope: auth.oauthScope || undefined,
    };
  }
  if (auth.type === 'oidc') {
    return {
      type: 'oidc',
      openIdConnectUrl: resolve(auth.oidcUrl), clientId: resolve(auth.oauthClientId),
      clientSecret: resolve(auth.oauthClientSecret), scope: auth.oauthScope || undefined,
    };
  }
  return null;
}

function fmtSize(n: number) {
  if (n < 1024) return `${n} B`;
  if (n < 1048576) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1048576).toFixed(1)} MB`;
}

function scClass(s: number) {
  if (s < 300) return 'status-ok';
  if (s < 400) return 'status-redir';
  if (s < 500) return 'status-err';
  return 'status-fatal';
}

function schemaToExample(s: Record<string, unknown>): unknown {
  if (!s) return {};
  const t = s.type as string;
  if (t === 'string') return (s.enum as string[])?.[0] ?? '';
  if (t === 'number' || t === 'integer') return 0;
  if (t === 'boolean') return false;
  if (t === 'array') return [schemaToExample((s.items as Record<string, unknown>) ?? {})];
  if (t === 'object' || s.properties) {
    const props = (s.properties as Record<string, unknown>) ?? {};
    const r: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(props)) r[k] = schemaToExample(v as Record<string, unknown>);
    return r;
  }
  return null;
}

function urlDomain(url: string): string {
  try { return new URL(url).hostname; } catch { return ''; }
}

function fileToPayload(file: File): Promise<FilePayload> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(reader.error);
    reader.onload = () => {
      const dataUrl = String(reader.result);
      resolve({ name: file.name, size: file.size, mime: file.type || 'application/octet-stream', dataB64: dataUrl.slice(dataUrl.indexOf(',') + 1) });
    };
    reader.readAsDataURL(file);
  });
}

/** Request auth after resolving 'inherit' against the workspace default. */
function effectiveAuth(tab: RequestTab, ws: Workspace | null): AuthConfig {
  if (tab.auth.type !== 'inherit') return tab.auth;
  if (!ws) return { ...DEFAULT_AUTH, type: 'cli' };
  return { ...DEFAULT_AUTH, ...ws.auth };
}

/** Effective environment: request override → workspace default → globally active. */
function effectiveEnv(tab: RequestTab, ws: Workspace | null, envs: Environment[], globalEnv: Environment | null): Environment | null {
  if (tab.envId === 'none') return null;
  if (tab.envId) return envs.find(e => e.id === tab.envId) ?? null;
  if (ws?.envId) return envs.find(e => e.id === ws.envId) ?? globalEnv;
  return globalEnv;
}

/** Resolved request pieces shared by send(), payload preview, and codegen. */
function resolveRequest(tab: RequestTab, activeEnv: Environment | null, ws: Workspace | null) {
  const resolve = (s: string) => resolveVars(s, activeEnv);
  const auth = effectiveAuth(tab, ws);
  const rawPathUrl = replacePaths(resolve(tab.url), tab.pathParams);
  const authQueryRows = buildAuthQueryParams(auth);
  const allQueryParams = [...tab.params, ...authQueryRows];
  const url = buildUrl(rawPathUrl, allQueryParams.filter(p => p.enabled && p.key).map(p => ({ ...p, value: resolve(p.value) })));

  // Header precedence (low → high): environment defaults → workspace defaults → request
  const merged = new Map<string, [string, string]>();
  const put = (k: string, v: string) => merged.set(k.toLowerCase(), [k, v]);
  for (const h of activeEnv?.headers ?? []) { if (h.enabled && h.key) put(h.key, resolve(h.value)); }
  for (const h of ws?.headers ?? []) { if (h.enabled && h.key) put(h.key, resolve(h.value)); }
  for (const h of tab.headers) { if (h.enabled && h.key) put(h.key, resolve(h.value)); }
  const headers: [string, string][] = [...merged.values()];

  const authHdrs = buildAuthHeaders({
    ...auth,
    bearer: resolve(auth.bearer),
    basicUser: resolve(auth.basicUser),
    basicPass: resolve(auth.basicPass),
    apiKeyValue: resolve(auth.apiKeyValue),
    customRows: auth.customRows.map(r => ({ ...r, value: resolve(r.value) })),
  });
  for (const [k, v] of Object.entries(authHdrs)) {
    if (k.toLowerCase() === 'cookie' && merged.has('cookie')) {
      const existing = merged.get('cookie')![1];
      const idx = headers.findIndex(([hk]) => hk.toLowerCase() === 'cookie');
      headers[idx] = [headers[idx]![0], `${existing}; ${v}`];
    } else if (!merged.has(k.toLowerCase())) {
      headers.push([k, v]);
    }
  }

  const hasCT = () => headers.some(([k]) => k.toLowerCase() === 'content-type');
  if (tab.bodyType === 'json' && !hasCT()) headers.push(['Content-Type', 'application/json']);
  if (tab.bodyType === 'form' && !hasCT()) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);
  if (tab.bodyType === 'raw' && !hasCT()) headers.push(['Content-Type', tab.rawType]);
  if (tab.bodyType === 'binary' && tab.binaryFile && !hasCT()) headers.push(['Content-Type', tab.binaryFile.mime]);

  let body: string | undefined;
  if (tab.bodyType === 'json') body = resolve(tab.body) || undefined;
  else if (tab.bodyType === 'raw') body = resolve(tab.body) || undefined;
  else if (tab.bodyType === 'form') {
    body = tab.formRows.filter(r => r.enabled && r.key).map(r => `${encodeURIComponent(r.key)}=${encodeURIComponent(resolve(r.value))}`).join('&') || undefined;
  }

  const multipart = tab.bodyType === 'multipart'
    ? tab.formRows.filter(r => r.enabled && r.key).map(r => r.kind === 'file'
        ? { name: r.key, kind: 'file' as const, filename: r.file?.name ?? 'file', contentType: r.file?.mime, dataB64: r.file?.dataB64 }
        : { name: r.key, kind: 'text' as const, value: resolve(r.value) })
    : undefined;

  // Server-side auth: profiles + OAuth flows + explicit "no auth"
  let authProfile: string | undefined;
  let engineAuth: EngineAuth | null = null;
  if (auth.type === 'profile' && auth.profileId) authProfile = auth.profileId;
  else if (auth.type === 'none') authProfile = 'none';
  else engineAuth = buildEngineAuth(auth, resolve);

  return { url, headers, body, multipart, authProfile, engineAuth, auth };
}

// ── KV Table ───────────────────────────────────────────────────────────────
function KVTable({ rows, onChange, ph = ['Key', 'Value'], readOnlyKey = false, keySuggestions, valueSuggestions }: {
  rows: KVRow[]; onChange: (r: KVRow[]) => void; ph?: [string, string]; readOnlyKey?: boolean;
  keySuggestions?: string[];
  valueSuggestions?: (key: string) => string[];
}) {
  const upd = (i: number, field: keyof KVRow, val: string | boolean) => {
    const next = [...rows];
    next[i] = { ...next[i]!, [field]: val };
    // Don't auto-add rows for read-only-key tables (path params) — keys are fixed from the URL
    if (!readOnlyKey && i === rows.length - 1 && field !== 'enabled' && val) {
      next.push({ key: '', value: '', enabled: true });
    }
    onChange(next);
  };
  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-1.5">
          <input
            type="checkbox" checked={row.enabled}
            onChange={e => upd(i, 'enabled', e.target.checked)}
            className="checkbox flex-shrink-0"
          />
          {readOnlyKey ? (
            <div className="flex items-center h-7 px-2.5 rounded-md bg-[var(--elevated)] border border-[var(--border)] flex-1 min-w-0">
              <span className="font-mono text-[12px] text-[var(--foreground)] truncate">{row.key}</span>
            </div>
          ) : keySuggestions ? (
            <SuggestInput
              value={row.key}
              onChange={v => upd(i, 'key', v)}
              suggestions={keySuggestions}
              placeholder={ph[0]}
            />
          ) : (
            <input
              className="input flex-1 h-7 text-[12.5px] font-mono"
              placeholder={ph[0]} value={row.key}
              onChange={e => upd(i, 'key', e.target.value)}
            />
          )}
          {valueSuggestions ? (
            <div className="flex-[2] min-w-0 flex">
              <SuggestInput
                value={row.value}
                onChange={v => upd(i, 'value', v)}
                suggestions={valueSuggestions(row.key)}
                placeholder={ph[1]}
              />
            </div>
          ) : (
            <input
              className="input flex-[2] h-7 text-[12.5px] font-mono"
              placeholder={ph[1]} value={row.value}
              onChange={e => upd(i, 'value', e.target.value)}
            />
          )}
          {!readOnlyKey && rows.length > 1 && (
            <button className="btn btn-ghost btn-icon btn-sm flex-shrink-0 text-[var(--placeholder-foreground)]" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
              <X size={11} />
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

// ── Form-data table (text + file rows) ──────────────────────────────────────
function FormDataTable({ rows, onChange, allowFiles }: {
  rows: KVRow[]; onChange: (r: KVRow[]) => void; allowFiles: boolean;
}) {
  const upd = (i: number, patch: Partial<KVRow>) => {
    const next = [...rows];
    next[i] = { ...next[i]!, ...patch };
    if (i === rows.length - 1 && (patch.key || patch.value || patch.file)) {
      next.push({ key: '', value: '', enabled: true, kind: 'text' });
    }
    onChange(next);
  };

  const pickFile = (i: number) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.onchange = async () => {
      const f = input.files?.[0];
      if (!f) return;
      if (f.size > 20 * 1048576) { alert('Files over 20 MB are not supported in the explorer.'); return; }
      upd(i, { file: await fileToPayload(f) });
    };
    input.click();
  };

  return (
    <div className="flex flex-col gap-1.5">
      {rows.map((row, i) => {
        const kind = row.kind ?? 'text';
        return (
          <div key={i} className="flex items-center gap-1.5">
            <input type="checkbox" checked={row.enabled} onChange={e => upd(i, { enabled: e.target.checked })} className="checkbox flex-shrink-0" />
            <input
              className="input flex-1 h-7 text-[12.5px] font-mono"
              placeholder="field" value={row.key}
              onChange={e => upd(i, { key: e.target.value })}
            />
            {allowFiles && (
              <select
                className="select h-7 w-[68px] flex-shrink-0 text-[11.5px]"
                value={kind}
                onChange={e => upd(i, { kind: e.target.value as 'text' | 'file', file: null })}
              >
                <option value="text">Text</option>
                <option value="file">File</option>
              </select>
            )}
            {kind === 'file' && allowFiles ? (
              <button
                className="btn btn-ghost h-7 flex-[2] min-w-0 justify-start gap-1.5 text-[12px] font-mono border border-dashed border-[var(--border)]"
                onClick={() => pickFile(i)}
              >
                <FileUp size={11} className="flex-shrink-0" />
                {row.file
                  ? <span className="truncate">{row.file.name} <span className="text-[var(--placeholder-foreground)]">({fmtSize(row.file.size)})</span></span>
                  : <span className="text-[var(--placeholder-foreground)]">Choose file…</span>}
              </button>
            ) : (
              <input
                className="input flex-[2] h-7 text-[12.5px] font-mono"
                placeholder="value" value={row.value}
                onChange={e => upd(i, { value: e.target.value })}
              />
            )}
            {rows.length > 1 && (
              <button className="btn btn-ghost btn-icon btn-sm flex-shrink-0 text-[var(--placeholder-foreground)]" onClick={() => onChange(rows.filter((_, j) => j !== i))}>
                <X size={11} />
              </button>
            )}
          </div>
        );
      })}
    </div>
  );
}

// ── JSON Editor ─────────────────────────────────────────────────────────────
// Synchronous tokenizer — no async, no debounce, no flash.
// Uses existing .json-key / .json-str / .json-num / .json-bool / .json-null
// CSS classes so colors follow the active theme automatically.
function highlightJson(src: string): string {
  if (!src.trim()) return '';
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  // Groups: string · number · keyword · punctuation · whitespace · other
  const TOKEN = /("(?:[^"\\]|\\.)*"?)|(-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false|null)|([{}\[\],:])|(\s+)|(.)/g;
  const stack: ('obj' | 'arr')[] = [];
  let expectKey = false;
  let out = '';
  let m: RegExpExecArray | null;
  while ((m = TOKEN.exec(src)) !== null) {
    const [, str, num, kw, punc, ws, other] = m;
    if (ws !== undefined) {
      out += esc(ws);
    } else if (str !== undefined) {
      out += `<span class="${expectKey ? 'json-key' : 'json-str'}">${esc(str)}</span>`;
      if (expectKey) expectKey = false;
    } else if (num !== undefined) {
      out += `<span class="json-num">${esc(num)}</span>`;
    } else if (kw !== undefined) {
      out += `<span class="${kw === 'null' ? 'json-null' : 'json-bool'}">${esc(kw)}</span>`;
    } else if (punc !== undefined) {
      out += esc(punc);
      if (punc === '{') { stack.push('obj'); expectKey = true; }
      else if (punc === '[') { stack.push('arr'); expectKey = false; }
      else if (punc === '}' || punc === ']') { stack.pop(); expectKey = false; }
      else if (punc === ':') { expectKey = false; }
      else if (punc === ',') { expectKey = stack[stack.length - 1] === 'obj'; }
    } else if (other !== undefined) {
      out += `<span style="color:var(--destructive)">${esc(other)}</span>`;
    }
  }
  return out;
}

const JSON_PRE_STYLE = "margin:0;padding:12px 16px;font-family:'JetBrains Mono',GeistMono,ui-monospace,monospace;font-size:12.5px;line-height:1.65;white-space:pre-wrap;word-break:break-all;overflow:auto;color:var(--foreground)";

const JsonEditor = React.memo(function JsonEditor({ value, onChange, placeholder }: {
  value: string; onChange: (v: string) => void; placeholder?: string;
}) {
  const [local, setLocal] = useState(value);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);
  const onChangeRef = useRef(onChange);
  onChangeRef.current = onChange;

  // sync from parent only when value changes from outside (e.g. loading an endpoint)
  const prevValue = useRef(value);
  if (value !== prevValue.current && value !== local) {
    prevValue.current = value;
    setLocal(value);
  }

  // Synchronous highlight — always current, no debounce, no flash
  const highlighted = useMemo(() => highlightJson(local), [local]);

  const syncScroll = () => {
    if (taRef.current && hlRef.current) {
      const pre = hlRef.current.querySelector('pre');
      if (pre) { pre.scrollTop = taRef.current.scrollTop; pre.scrollLeft = taRef.current.scrollLeft; }
    }
  };

  const handleChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const v = e.target.value;
    setLocal(v);
    onChangeRef.current(v);
  };

  const format = () => {
    try {
      const fmt = JSON.stringify(JSON.parse(local), null, 2);
      setLocal(fmt);
      onChangeRef.current(fmt);
    } catch { /**/ }
  };

  const escPh = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        <span className="text-[11px] text-[var(--placeholder-foreground)] font-mono">JSON</span>
        <button className="btn btn-ghost btn-sm text-[11px] ml-auto h-6 px-2" onClick={format}>Format</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div
          ref={hlRef}
          className="pointer-events-none absolute inset-0 overflow-hidden flex flex-col"
          dangerouslySetInnerHTML={{
            __html: highlighted
              ? `<pre style="${JSON_PRE_STYLE}">${highlighted}</pre>`
              : `<pre style="${JSON_PRE_STYLE};color:var(--placeholder-foreground)">${escPh(placeholder ?? '')}</pre>`,
          }}
        />
        <textarea
          ref={taRef}
          value={local}
          onChange={handleChange}
          onScroll={syncScroll}
          spellCheck={false}
          style={{
            position: 'absolute', inset: 0, width: '100%', height: '100%',
            background: 'transparent',
            color: 'transparent',
            caretColor: 'var(--foreground)',
            border: 'none', outline: 'none', resize: 'none',
            padding: '12px 16px',
            fontFamily: "'JetBrains Mono', GeistMono, ui-monospace, monospace",
            fontSize: 12.5, lineHeight: 1.65,
            whiteSpace: 'pre-wrap',
            wordBreak: 'break-all',
            zIndex: 1,
          }}
        />
      </div>
    </div>
  );
});

// ── Auth Panel ─────────────────────────────────────────────────────────────
const AUTH_TYPE_LABELS: Record<AuthConfig['type'], string> = {
  inherit: 'Inherit from workspace',
  cli: 'CLI active auth',
  none: 'No auth',
  bearer: 'Bearer token',
  basic: 'Basic auth',
  apikey: 'API key',
  oauth2: 'OAuth 2.0 (client credentials)',
  oidc: 'OpenID Connect',
  custom: 'Custom headers',
  profile: 'Saved profile (role)',
};

function AuthPanel({ auth, onChange, showInherit = true, inheritedFrom }: {
  auth: AuthConfig; onChange: (a: AuthConfig) => void;
  /** false in workspace settings — a workspace has no parent to inherit from. */
  showInherit?: boolean;
  /** Label + resolved type shown when 'inherit' is selected. */
  inheritedFrom?: { name: string; type: AuthConfig['type'] } | null;
}) {
  const upd = (patch: Partial<AuthConfig>) => onChange({ ...auth, ...patch });
  const [profiles, setProfiles] = useState<AuthProfileRow[]>([]);

  useEffect(() => {
    apiClient<AuthProfileRow[]>('/api/auth/profiles').then(setProfiles).catch(() => {});
  }, []);

  const types = (Object.keys(AUTH_TYPE_LABELS) as AuthConfig['type'][])
    .filter(t => showInherit || t !== 'inherit');

  const field = (label: string, node: React.ReactNode) => (
    <div>
      <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">{label}</label>
      {node}
    </div>
  );
  const mono = (value: string, placeholder: string, set: (v: string) => void, type = 'text') => (
    <input className="input h-8 w-full font-mono text-[12.5px]" type={type} placeholder={placeholder} value={value} onChange={e => set(e.target.value)} />
  );

  return (
    <div className="flex flex-col gap-4 max-w-[560px]">
      {field('Auth type', (
        <select className="select h-8 w-full text-[12.5px]" value={auth.type} onChange={e => upd({ type: e.target.value as AuthConfig['type'] })}>
          {types.map(t => <option key={t} value={t}>{AUTH_TYPE_LABELS[t]}</option>)}
        </select>
      ))}

      {auth.type === 'inherit' && (
        <p className="text-[12px] text-[var(--placeholder-foreground)]">
          {inheritedFrom
            ? <>Inherits from workspace <strong className="text-[var(--foreground)]">{inheritedFrom.name}</strong> → <code className="font-mono">{AUTH_TYPE_LABELS[inheritedFrom.type]}</code>. Change it in workspace settings (⚙).</>
            : 'Uses whatever auth the workspace defines.'}
        </p>
      )}

      {auth.type === 'cli' && (
        <p className="text-[12px] text-[var(--placeholder-foreground)]">
          The CLI applies its globally active auth config (Authentication page / <code className="font-mono">/auth use</code>).
        </p>
      )}

      {auth.type === 'none' && (
        <p className="text-[12px] text-[var(--placeholder-foreground)]">
          Sent with no authentication at all — the CLI's active auth is bypassed too.
        </p>
      )}

      {auth.type === 'bearer' && (
        <>
          {field('Token', mono(auth.bearer, 'eyJhbGciOi… or {{TOKEN}}', v => upd({ bearer: v })))}
          <p className="text-[11px] text-[var(--placeholder-foreground)] -mt-2">
            Sends <code className="font-mono">Authorization: Bearer {'<token>'}</code>
          </p>
        </>
      )}

      {auth.type === 'basic' && (
        <>
          {field('Username', mono(auth.basicUser, 'username', v => upd({ basicUser: v })))}
          {field('Password', mono(auth.basicPass, '••••••••', v => upd({ basicPass: v }), 'password'))}
        </>
      )}

      {auth.type === 'apikey' && (
        <>
          {field(auth.apiKeyIn === 'cookie' ? 'Cookie name' : auth.apiKeyIn === 'query' ? 'Query param' : 'Header name',
            mono(auth.apiKeyName, auth.apiKeyIn === 'header' ? 'X-API-Key' : auth.apiKeyIn === 'query' ? 'api_key' : 'session', v => upd({ apiKeyName: v })))}
          {field('Value', mono(auth.apiKeyValue, 'your-api-key or {{API_KEY}}', v => upd({ apiKeyValue: v })))}
          {field('Add to', (
            <div className="flex gap-1.5">
              {(['header', 'query', 'cookie'] as const).map(loc => (
                <button key={loc}
                  className={cn('btn btn-ghost btn-sm flex-1 text-[12px]', auth.apiKeyIn === loc && 'bg-[var(--primary-dim)] text-[var(--primary)]')}
                  onClick={() => upd({ apiKeyIn: loc })}>
                  {loc === 'header' ? 'Header' : loc === 'query' ? 'Query param' : 'Cookie'}
                </button>
              ))}
            </div>
          ))}
        </>
      )}

      {(auth.type === 'oauth2' || auth.type === 'oidc') && (
        <>
          {auth.type === 'oidc'
            ? field('Discovery URL', mono(auth.oidcUrl, 'https://issuer/.well-known/openid-configuration', v => upd({ oidcUrl: v })))
            : field('Token URL', mono(auth.oauthTokenUrl, 'https://auth.example.com/oauth/token', v => upd({ oauthTokenUrl: v })))}
          {field('Client ID', mono(auth.oauthClientId, 'client-id', v => upd({ oauthClientId: v })))}
          {field('Client secret', mono(auth.oauthClientSecret, '••••••••', v => upd({ oauthClientSecret: v }), 'password'))}
          {field('Scope (optional)', mono(auth.oauthScope, 'read:users write:users', v => upd({ oauthScope: v })))}
          <p className="text-[11px] text-[var(--placeholder-foreground)] -mt-2">
            The CLI fetches and caches the token (client-credentials grant), then sends <code className="font-mono">Authorization: Bearer</code>. Secrets stay on the server side of the request.
          </p>
        </>
      )}

      {auth.type === 'custom' && (
        <div>
          <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Headers</label>
          <KVTable
            rows={auth.customRows}
            onChange={rows => upd({ customRows: rows })}
            ph={['Header', 'Value']}
            keySuggestions={COMMON_HEADERS}
            valueSuggestions={key => HEADER_VALUE_SUGGESTIONS[key.toLowerCase()] ?? []}
          />
        </div>
      )}

      {auth.type === 'profile' && (
        <div className="flex flex-col gap-1.5">
          <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)]">Saved auth profiles</label>
          {profiles.length === 0 && (
            <p className="text-[12px] text-[var(--placeholder-foreground)]">
              No profiles saved yet — create them in <Link to="/auth" className="text-[var(--primary)]">Authentication</Link>.
            </p>
          )}
          {profiles.map(p => (
            <button
              key={p.id}
              onClick={() => upd({ profileId: p.id, profileName: p.name })}
              className={cn(
                'flex items-center gap-2.5 px-3 py-2 rounded-lg border text-left cursor-pointer transition-colors bg-transparent',
                auth.profileId === p.id
                  ? 'border-[var(--primary)] bg-[var(--primary-dim)]'
                  : 'border-[var(--border)] hover:border-[var(--border-hover)]',
              )}
            >
              <span className={cn('w-3 h-3 rounded-full border flex-shrink-0 flex items-center justify-center',
                auth.profileId === p.id ? 'border-[var(--primary)]' : 'border-[var(--muted-foreground)]')}>
                {auth.profileId === p.id && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)]" />}
              </span>
              <span className="flex flex-col min-w-0">
                <span className="text-[12.5px] font-medium text-[var(--foreground)] truncate">
                  {p.name}
                  {(p.is_active === 1 || p.is_active === true) && <span className="ml-2 text-[10px] text-[var(--accent)]">active</span>}
                </span>
                <span className="text-[11px] text-[var(--placeholder-foreground)] truncate">{p.type}{p.description ? ` — ${p.description}` : ''}</span>
              </span>
            </button>
          ))}
          <p className="text-[11px] text-[var(--placeholder-foreground)] mt-1">
            The CLI signs this request with the selected profile — secrets never reach the browser.
          </p>
        </div>
      )}
    </div>
  );
}

// ── Workspace settings modal ────────────────────────────────────────────────
function WorkspaceModal({ workspace, envs, onSave, onDelete, onClose }: {
  workspace: Workspace; envs: Environment[];
  onSave: (w: Workspace) => void; onDelete: (id: string) => void; onClose: () => void;
}) {
  const [draft, setDraft] = useState<Workspace>(() => JSON.parse(JSON.stringify(workspace)) as Workspace);
  const set = (patch: Partial<Workspace>) => setDraft(d => ({ ...d, ...patch }));

  useEffect(() => {
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onClose]);

  return (
    <div className="cmd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        onMouseDown={e => e.stopPropagation()}
        className="w-full mx-4 bg-[var(--popover)] border border-[var(--border-strong)] rounded-xl overflow-hidden flex flex-col"
        style={{ maxWidth: 640, maxHeight: '82vh', boxShadow: 'var(--shadow)', animation: 'dialog-in 0.12s ease' }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <Layers size={14} className="text-[var(--muted-foreground)]" />
          <h2 className="text-[13.5px] font-semibold text-[var(--foreground)] flex-1 m-0">Workspace settings</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={13} /></button>
        </div>

        <div className="flex-1 overflow-auto p-4 flex flex-col gap-5">
          <div className="flex gap-2">
            <input className="input h-8 flex-1 text-[13px] font-semibold" placeholder="Workspace name" value={draft.name} onChange={e => set({ name: e.target.value })} />
            <select className="select h-8 w-[200px] text-[12.5px]" value={draft.envId} onChange={e => set({ envId: e.target.value })}>
              <option value="">Env: follow global</option>
              {envs.map(e => <option key={e.id} value={e.id}>Env: {e.name}</option>)}
            </select>
          </div>

          <div>
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--placeholder-foreground)] mb-2">Default auth — requests set to "Inherit" use this</div>
            <AuthPanel
              auth={{ ...DEFAULT_AUTH, ...draft.auth }}
              onChange={a => set({ auth: { ...draft.auth, ...a, type: a.type === 'inherit' ? 'cli' : a.type } as Workspace['auth'] })}
              showInherit={false}
            />
          </div>

          <div>
            <div className="text-[11.5px] font-semibold uppercase tracking-wider text-[var(--placeholder-foreground)] mb-2">Default headers — merged under request headers</div>
            <KVTable
              rows={draft.headers.length ? draft.headers : [{ key: '', value: '', enabled: true }]}
              onChange={headers => set({ headers })}
              ph={['Header', 'Value']}
              keySuggestions={COMMON_HEADERS}
              valueSuggestions={key => HEADER_VALUE_SUGGESTIONS[key.toLowerCase()] ?? []}
            />
          </div>
        </div>

        <div className="flex items-center gap-2 px-4 py-3 border-t border-[var(--border)] flex-shrink-0">
          {draft.id !== DEFAULT_WORKSPACE_ID && (
            <button className="btn btn-ghost btn-sm gap-1.5 text-[12px] text-[var(--destructive)]" onClick={() => { if (confirm(`Delete workspace "${draft.name}"? Its tabs move to Personal.`)) onDelete(draft.id); }}>
              <Trash2 size={12} /> Delete
            </button>
          )}
          <div className="ml-auto flex gap-2">
            <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
            <button className="btn btn-primary btn-sm" onClick={() => onSave(draft)} disabled={!draft.name.trim()}>Save</button>
          </div>
        </div>
      </div>
    </div>
  );
}

// ── Payload Preview Panel ──────────────────────────────────────────────────
function PayloadPanel({ tab, activeEnv, ws }: { tab: RequestTab; activeEnv: Environment | null; ws: Workspace | null }) {
  const { url: fullUrl, headers, body, multipart, auth, engineAuth, authProfile } = resolveRequest(tab, activeEnv, ws);
  const methodColor = MC[tab.method] ?? 'var(--foreground)';

  let bodyText = body ?? '';
  if (tab.bodyType === 'json' && bodyText) { try { bodyText = JSON.stringify(JSON.parse(bodyText), null, 2); } catch { /* keep */ } }

  if (!tab.url) return (
    <div className="empty-state">
      <Eye size={22} className="opacity-30" />
      <span className="text-[12.5px]">Enter a URL to preview the request</span>
    </div>
  );

  return (
    <div className="flex-1 overflow-auto p-4 bg-[var(--background)]">
      <div className="font-mono text-[12.5px] leading-relaxed">
        <div className="mb-3 flex flex-wrap gap-1.5 items-baseline">
          <span className="font-bold text-[13px]" style={{ color: methodColor }}>{tab.method}</span>
          <span className="text-[var(--foreground)] break-all">{fullUrl || '(no URL)'}</span>
          <span className="text-[var(--placeholder-foreground)] text-[11.5px]">HTTP/1.1</span>
        </div>
        {headers.length > 0 && (
          <div className="mb-3 space-y-0.5 border-l-2 border-[var(--border)] pl-3">
            {headers.map(([k, v], i) => (
              <div key={i} className="flex gap-1.5 break-all">
                <span className="text-[var(--muted-foreground)] flex-shrink-0 min-w-[120px]">{k}:</span>
                <span className="text-[var(--foreground)]">{v}</span>
              </div>
            ))}
          </div>
        )}
        {authProfile && authProfile !== 'none' && (
          <div className="mb-3 text-[11.5px] text-[var(--placeholder-foreground)]">+ signed by the CLI with profile <span className="text-[var(--foreground)]">{auth.profileName || authProfile}</span></div>
        )}
        {engineAuth && (
          <div className="mb-3 text-[11.5px] text-[var(--placeholder-foreground)]">+ signed by the CLI via <span className="text-[var(--foreground)]">{engineAuth.type}</span> (token fetched server-side)</div>
        )}
        {auth.type === 'none' && (
          <div className="mb-3 text-[11.5px] text-[var(--placeholder-foreground)]">no authentication (CLI active auth bypassed)</div>
        )}
        {multipart && multipart.length > 0 && (
          <div className="border-t border-[var(--border)] pt-3 space-y-0.5">
            <div className="text-[11px] text-[var(--placeholder-foreground)] mb-1">multipart/form-data</div>
            {multipart.map((p, i) => (
              <div key={i} className="flex gap-1.5 break-all">
                <span className="text-[var(--muted-foreground)] flex-shrink-0 min-w-[120px]">{p.name}:</span>
                <span className="text-[var(--foreground)]">{p.kind === 'file' ? `📎 ${p.filename}` : p.value}</span>
              </div>
            ))}
          </div>
        )}
        {tab.bodyType === 'binary' && tab.binaryFile && (
          <div className="border-t border-[var(--border)] pt-3 text-[var(--foreground)]">📎 {tab.binaryFile.name} <span className="text-[var(--placeholder-foreground)]">({fmtSize(tab.binaryFile.size)})</span></div>
        )}
        {bodyText && tab.bodyType !== 'multipart' && tab.bodyType !== 'binary' && (
          <div className="border-t border-[var(--border)] pt-3">
            <pre className="text-[var(--foreground)] whitespace-pre-wrap m-0">{bodyText}</pre>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Cookies Panel ──────────────────────────────────────────────────────────
function CookiesPanel({ domain }: { domain: string }) {
  const [cookies, setCookies] = useState<CookieEntry[]>([]);
  const [loading, setLoading] = useState(true);

  const load = async () => {
    setLoading(true);
    try { setCookies((await dbGetAll<CookieEntry>('cookies')).filter(c => !domain || c.domain === domain || c.domain === '')); }
    catch { /**/ } finally { setLoading(false); }
  };

  useEffect(() => { load(); }, [domain]);

  const upd = async (idx: number, patch: Partial<CookieEntry>) => {
    const next = [...cookies];
    const c = { ...next[idx]!, ...patch };
    c.id = `${c.name}@${c.domain || 'any'}`;
    next[idx] = c;
    setCookies(next);
    if (c.name) await dbPut('cookies', c).catch(() => {});
  };

  const del = async (c: CookieEntry) => {
    await dbDel('cookies', c.id).catch(() => {});
    setCookies(cs => cs.filter(x => x.id !== c.id));
  };

  if (loading) return <div className="flex justify-center py-8"><span className="spinner" /></div>;

  return (
    <div className="p-3 flex flex-col gap-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-[11.5px] text-[var(--muted-foreground)]">{domain ? `Cookies for ${domain}` : 'All cookies'}</span>
        <button className="btn btn-ghost btn-sm gap-1 text-[11.5px]" onClick={() => setCookies(c => [...c, { id: `${Date.now()}`, name: '', value: '', domain: domain || '', path: '/', enabled: true }])}>
          <Plus size={11} /> Add
        </button>
      </div>
      {cookies.length === 0 && <div className="text-center py-6 text-[12px] text-[var(--placeholder-foreground)]">No cookies for this domain.</div>}
      {cookies.map((c, i) => (
        <div key={c.id} className="flex items-center gap-1.5">
          <input type="checkbox" checked={c.enabled} onChange={e => upd(i, { enabled: e.target.checked })} className="checkbox flex-shrink-0" />
          <input className="input h-7 text-[12px] font-mono" style={{ flex: '0 0 28%' }} placeholder="name" value={c.name} onChange={e => upd(i, { name: e.target.value })} />
          <input className="input h-7 text-[12px] font-mono flex-1" placeholder="value" value={c.value} onChange={e => upd(i, { value: e.target.value })} />
          <input className="input h-7 text-[12px] font-mono" style={{ flex: '0 0 22%' }} placeholder="domain" value={c.domain} onChange={e => upd(i, { domain: e.target.value })} />
          <button className="btn btn-ghost btn-icon btn-sm flex-shrink-0 text-[var(--placeholder-foreground)] hover:text-[var(--destructive)]" onClick={() => del(c)}>
            <X size={11} />
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Endpoint Tree ──────────────────────────────────────────────────────────
function EndpointTree({ ops, onSelect, activeId, onContextMenu }: {
  ops: ParsedOperation[]; onSelect: (op: ParsedOperation) => void; activeId?: string;
  onContextMenu?: (e: React.MouseEvent, op: ParsedOperation) => void;
}) {
  const [search, setSearch] = useState('');
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});

  const filtered = ops.filter(op =>
    !search ||
    op.path.toLowerCase().includes(search.toLowerCase()) ||
    (op.summary ?? '').toLowerCase().includes(search.toLowerCase()) ||
    op.operationId.toLowerCase().includes(search.toLowerCase())
  );

  const groups: Record<string, ParsedOperation[]> = {};
  for (const op of filtered) {
    const tag = op.tags[0] ?? 'default';
    if (!groups[tag]) groups[tag] = [];
    groups[tag]!.push(op);
  }

  const MC: Record<string, string> = {
    GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)',
    PATCH: 'var(--method-patch)', DELETE: 'var(--method-delete)',
    HEAD: 'var(--method-head)', OPTIONS: 'var(--method-head)',
  };

  return (
    <div className="flex flex-col h-full overflow-hidden">
      {/* Search bar */}
      <div className="px-2 py-2 border-b border-[var(--border)] flex-shrink-0">
        <div className="relative flex items-center">
          <Search size={11} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--placeholder-foreground)] pointer-events-none" />
          <input
            className="input w-full h-7 pl-7 pr-10 text-[12px] bg-[var(--elevated)]"
            placeholder="Filter endpoints…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          <span className="absolute right-2 text-[10px] text-[var(--placeholder-foreground)] font-mono pointer-events-none select-none">
            {filtered.length === ops.length ? ops.length : `${filtered.length}/${ops.length}`}
          </span>
        </div>
      </div>

      {/* Endpoint list */}
      <div className="flex-1 overflow-y-auto">
        {Object.entries(groups).map(([tag, tagOps]) => (
          <div key={tag} className="ep-group">
            {/* Group header */}
            <button
              onClick={() => setCollapsed(c => ({ ...c, [tag]: !c[tag] }))}
              className="ep-group-header"
            >
              {collapsed[tag]
                ? <ChevronRight size={9} className="flex-shrink-0 opacity-40" />
                : <ChevronDown size={9} className="flex-shrink-0 opacity-40" />}
              <span className="flex-1 text-left truncate">{tag.toLowerCase().replace(/_/g, ' ')}</span>
              <span className="ep-count">{tagOps.length}</span>
            </button>

            {/* Endpoint rows */}
            {!collapsed[tag] && tagOps.map(op => {
              const isActive = activeId === op.operationId;
              const color = MC[op.method.toUpperCase()] ?? 'var(--muted-foreground)';
              return (
                <button
                  key={`${op.method}_${op.path}`}
                  onClick={() => onSelect(op)}
                  onContextMenu={e => onContextMenu?.(e, op)}
                  className={cn('ep-row', isActive && 'active')}
                >
                  <span className="ep-method" style={{ color }}>{op.method.toUpperCase()}</span>
                  <span className="ep-path">{op.path}</span>
                </button>
              );
            })}
          </div>
        ))}
        {filtered.length === 0 && (
          <div className="empty-state">
            <Search size={18} className="opacity-30" />
            <span className="text-[12px]">No endpoints match</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Response Panel ─────────────────────────────────────────────────────────
// ── Timing waterfall ──────────────────────────────────────────────────────────

function TimingWaterfall({ timing }: { timing: RequestTiming }) {
  const phases = [
    { key: 'dns',     label: 'DNS Resolution',  color: 'var(--muted-foreground)', ms: timing.dns },
    { key: 'connect', label: 'Connecting',       color: 'var(--foreground-secondary)', ms: timing.connect },
    { key: 'tls',     label: 'TLS Setup',        color: 'var(--muted-foreground)', ms: timing.tls },
    { key: 'send',    label: 'Sending',          color: 'var(--foreground-secondary)', ms: timing.send },
    { key: 'wait',    label: 'Waiting (TTFB)',   color: 'var(--warning)', ms: timing.wait },
    { key: 'receive', label: 'Receiving',        color: 'var(--foreground)', ms: timing.receive },
  ];
  const total = timing.total || 1;

  return (
    <div className="max-w-xl">
      <div className="mb-4 flex items-center gap-3">
        <div className="text-[22px] font-bold text-[var(--foreground)]">{timing.total}ms</div>
        <div className="text-[12px] text-[var(--muted-foreground)]">Total response time</div>
      </div>

      <div className="space-y-2.5">
        {phases.map(p => {
          const pct = Math.max(0, Math.min(100, (p.ms / total) * 100));
          return (
            <div key={p.key} className="flex items-center gap-3">
              <div className="w-32 shrink-0 text-[11.5px] text-[var(--muted-foreground)]">{p.label}</div>
              <div className="flex-1 h-5 rounded-sm bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)] overflow-hidden">
                {pct > 0 && (
                  <div
                    className="h-full rounded-sm transition-all duration-300"
                    style={{ width: `${Math.max(pct, 2)}%`, background: p.color, opacity: 0.85 }}
                  />
                )}
              </div>
              <div className="w-14 shrink-0 text-right text-[11.5px] font-mono text-[var(--foreground)]">
                {p.ms > 0 ? `${p.ms}ms` : <span className="text-[var(--muted-foreground)]">—</span>}
              </div>
            </div>
          );
        })}
        <div className="mt-3 border-t border-[var(--border)] pt-3 flex items-center gap-3">
          <div className="w-32 shrink-0 text-[11.5px] font-semibold text-[var(--foreground)]">Total</div>
          <div className="flex-1 h-5 rounded-sm overflow-hidden bg-[color-mix(in_srgb,var(--foreground)_20%,transparent)]" />
          <div className="w-14 shrink-0 text-right text-[11.5px] font-mono font-bold text-[var(--foreground)]">{timing.total}ms</div>
        </div>
      </div>

      <div className="mt-5 grid grid-cols-3 gap-3">
        {[
          { label: 'DNS', value: timing.dns, color: 'var(--muted-foreground)' },
          { label: 'TTFB', value: timing.wait, color: 'var(--warning)' },
          { label: 'Download', value: timing.receive, color: 'var(--foreground)' },
        ].map(m => (
          <div key={m.label} className="rounded-lg border border-[var(--border)] p-3">
            <div className="text-[10.5px] text-[var(--muted-foreground)]">{m.label}</div>
            <div className="text-[18px] font-bold mt-0.5" style={{ color: m.color }}>{m.value}ms</div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Network info panel ──────────────────────────────────────────────────────────

function NetworkInfoPanel({ url, status, statusText, headers, networkInfo, size, latency }: {
  url: string; status: number; statusText: string; headers: Record<string, string>;
  networkInfo?: NetworkInfo; size: number; latency: number;
}) {
  const rows = [
    { label: 'Request URL',      value: url || '—' },
    { label: 'Request Method',   value: (headers['x-method'] ?? headers['X-Method'] ?? '—').toString() },
    { label: 'Status Code',      value: `${status} ${statusText}` },
    { label: 'Remote Address',   value: networkInfo?.remoteAddr || '—' },
    { label: 'Scheme',           value: networkInfo?.scheme?.toUpperCase() || '—' },
    { label: 'Host',             value: networkInfo?.host || '—' },
    { label: 'Path',             value: networkInfo?.filename || '—' },
    { label: 'HTTP Version',     value: networkInfo?.httpVersion || 'HTTP/1.1' },
    { label: 'Content Type',     value: headers['content-type'] ?? headers['Content-Type'] ?? '—' },
    { label: 'Content Encoding', value: headers['content-encoding'] ?? headers['Content-Encoding'] ?? '—' },
    { label: 'Referrer Policy',  value: (networkInfo?.referrerPolicy || headers['referrer-policy'] || headers['Referrer-Policy']) ?? '—' },
    { label: 'Cache Control',    value: headers['cache-control'] ?? headers['Cache-Control'] ?? '—' },
    { label: 'Response Size',    value: `${size} B` },
    { label: 'Latency',          value: `${latency}ms` },
  ].filter(r => r.value !== '—');

  const resHeaders = headers;

  return (
    <div className="space-y-5 max-w-2xl">
      <section>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">General</div>
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          {rows.map((r, i) => (
            <div key={r.label} className={cn('flex gap-4 px-3 py-1.5 text-[12px]', i % 2 === 0 ? 'bg-[var(--card)]' : '')}>
              <span className="w-36 shrink-0 text-[var(--muted-foreground)] font-medium">{r.label}</span>
              <span className="font-mono text-[var(--foreground)] break-all flex-1">{r.value}</span>
            </div>
          ))}
        </div>
      </section>

      <section>
        <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">Response Headers</div>
        <div className="rounded-lg border border-[var(--border)] overflow-hidden">
          {Object.entries(resHeaders).slice(0, 20).map(([k, v], i) => (
            <div key={k} className={cn('flex gap-4 px-3 py-1.5 text-[12px]', i % 2 === 0 ? 'bg-[var(--card)]' : '')}>
              <span className="w-36 shrink-0 font-mono text-[var(--muted-foreground)]">{k}</span>
              <span className="text-[var(--foreground)] break-all flex-1">{v}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function ResponsePanel({ response, loading }: { response: ResponseResult | null; loading: boolean }) {
  type RespView = 'body' | 'headers' | 'cookies' | 'raw' | 'preview' | 'schema' | 'timing' | 'network';
  const VALID_VIEWS: RespView[] = ['body', 'headers', 'cookies', 'raw', 'preview', 'schema', 'timing', 'network'];
  const [view, setViewRaw] = useState<RespView>(() => {
    const s = typeof window !== 'undefined' ? localStorage.getItem('resp_view') : null;
    return (s && VALID_VIEWS.includes(s as RespView) ? s : 'body') as RespView;
  });
  const [bodyMode, setBodyModeRaw] = useState<'tree' | 'pretty'>(() => {
    const s = typeof window !== 'undefined' ? localStorage.getItem('resp_body_mode') : null;
    return s === 'pretty' ? 'pretty' : 'tree';
  });
  const setView = (v: RespView) => { setViewRaw(v); localStorage.setItem('resp_view', v); };
  const setBodyMode = (m: 'tree' | 'pretty') => { setBodyModeRaw(m); localStorage.setItem('resp_body_mode', m); };
  const [filter, setFilter] = useState('');
  const [filterOpen, setFilterOpenRaw] = useState(() =>
    typeof window !== 'undefined' ? localStorage.getItem('resp_filter_open') === '1' : false
  );
  const setFilterOpen = (v: boolean | ((prev: boolean) => boolean)) => {
    setFilterOpenRaw(prev => {
      const next = typeof v === 'function' ? v(prev) : v;
      localStorage.setItem('resp_filter_open', next ? '1' : '0');
      return next;
    });
  };
  const [copied, setCopied] = useState<string | null>(null);
  const treeControls = useRef<import('../components/JsonTree').JsonTreeControls | null>(null);

  const copy = (text: string, what: string) => {
    navigator.clipboard.writeText(text);
    setCopied(what);
    setTimeout(() => setCopied(null), 1500);
  };

  const contentType = response?.headers['content-type'] ?? response?.headers['Content-Type'] ?? '';
  const isImage = !!response?.bodyB64 && contentType.startsWith('image/');
  const isBinary = !!response?.bodyB64;

  // Detect HTML by content-type OR by body content (handles servers that forget the header)
  const isHtml = contentType.includes('text/html') || (!isBinary && (() => {
    const t = response?.body?.trimStart() ?? '';
    return /^<!doctype\s+html/i.test(t) || /^<html[\s>]/i.test(t);
  })());

  // Parsed JSON (when applicable) — basis for tree view, filter and schema
  const parsed = useMemo(() => {
    if (!response?.body) return undefined;
    const t = response.body.trimStart();
    if (!t.startsWith('{') && !t.startsWith('[')) return undefined;
    try { return JSON.parse(response.body) as unknown; } catch { return undefined; }
  }, [response?.body]);
  const isJson = parsed !== undefined;


  // jq filter
  const [filtered, filterError] = useMemo((): [unknown, string | null] => {
    if (!isJson || !filter.trim() || filter.trim() === '.') return [parsed, null];
    try { return [jqFilter(parsed, filter.trim()), null]; }
    catch (e) { return [parsed, e instanceof Error ? e.message : String(e)]; }
  }, [parsed, filter, isJson]);

  const responseCookies: { name: string; value: string; attrs: string }[] = [];
  if (response) {
    for (const [k, v] of Object.entries(response.headers)) {
      if (k.toLowerCase() === 'set-cookie') {
        const parts = v.split(';');
        const [nv, ...rest] = parts;
        const [name = '', value = ''] = (nv ?? '').split('=');
        responseCookies.push({ name: name.trim(), value: value.trim(), attrs: rest.join(';').trim() });
      }
    }
  }

  if (loading) return (
    <div className="flex-1 flex items-center justify-center gap-2.5 text-[var(--placeholder-foreground)]">
      <span className="spinner" /><span className="text-[13px]">Sending request…</span>
    </div>
  );

  if (!response) return (
    <div className="empty-state">
      <Send size={26} className="opacity-40" />
      <div className="text-[13px] font-medium">Send a request to see the response</div>
      <div className="text-[12px] text-[var(--placeholder-foreground)]">Press Mod+Enter or click Send</div>
    </div>
  );

  if (response.error) return (
    <div className="flex-1 p-4">
      <div className="bg-[var(--error-dim)] border border-[rgba(239,68,68,0.2)] rounded-lg p-3">
        <div className="text-[var(--destructive)] font-semibold mb-1.5 text-[13px]">Request failed</div>
        <pre className="font-mono text-[12px] text-[var(--muted-foreground)] whitespace-pre-wrap m-0">{response.error}</pre>
      </div>
    </div>
  );

  const tabs: { id: RespView; label: string }[] = [
    { id: 'body', label: 'Body' },
    { id: 'headers', label: `Headers (${Object.keys(response.headers).length})` },
    ...(responseCookies.length ? [{ id: 'cookies' as RespView, label: `Cookies (${responseCookies.length})` }] : []),
    { id: 'raw', label: 'Raw' },
    ...(isHtml || isImage ? [{ id: 'preview' as RespView, label: 'Preview' }] : []),
    ...(isJson ? [{ id: 'schema' as RespView, label: 'Schema' }] : []),
    { id: 'timing', label: 'Timing' },
    { id: 'network', label: 'Network' },
  ];

  const filteredText = isJson ? JSON.stringify(filtered, null, 2) : response.body;
  const schemaText = isJson ? JSON.stringify(generateJsonSchema(parsed), null, 2) : '';

  return (
    <div className="flex-1 flex flex-col overflow-hidden">

      {/* ── Row 1: status meta + actions */}
      <div className="flex items-center gap-3 px-3 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0" style={{ height: 34 }}>
        {/* Status badge */}
        <span className={cn('font-bold text-[13px] font-mono flex-shrink-0', scClass(response.status))}>
          {response.status}
        </span>

        {/* Meta pills */}
        <div className="flex items-center gap-2 text-[11px] text-[var(--placeholder-foreground)] flex-shrink-0">
          <span className="flex items-center gap-1"><Clock size={10} />{response.latency}ms</span>
          <span className="text-[var(--border)]">·</span>
          <span>{fmtSize(response.size)}</span>
          {contentType && (
            <>
              <span className="text-[var(--border)]">·</span>
              <span className="font-mono truncate max-w-[140px]" title={contentType}>{contentType.split(';')[0]}</span>
            </>
          )}
          {response.redirectedTo && (
            <>
              <span className="text-[var(--border)]">·</span>
              <span className="text-[var(--warning,#f59e0b)] truncate max-w-[160px]" title={response.redirectedTo}>↪ {response.redirectedTo}</span>
            </>
          )}
        </div>

        {/* Spacer */}
        <div className="flex-1" />

        {/* Controls */}
        <div className="flex items-center gap-0.5">
          {view === 'body' && isJson && bodyMode === 'tree' && (
            <>
              <button className="btn btn-ghost btn-sm h-6 px-1.5 text-[10.5px] gap-1" onClick={() => treeControls.current?.expandAll()} title="Expand all">
                <ChevronsUpDown size={10} />all
              </button>
              <button className="btn btn-ghost btn-sm h-6 px-1.5 text-[10.5px]" onClick={() => treeControls.current?.collapseAll()} title="Collapse all">
                <ChevronsUpDown size={10} />
              </button>
            </>
          )}
          {view === 'body' && isJson && (
            <button
              className={cn(
                'btn btn-ghost btn-sm btn-icon h-6 w-6',
                filterOpen && 'bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--foreground)]',
                !filterOpen && filter ? 'text-[var(--primary)]' : '',
              )}
              onClick={() => setFilterOpen(v => !v)}
              title={filterOpen ? 'Hide filter' : 'Filter / jq'}
            >
              <Search size={11} />
            </button>
          )}
          {view === 'body' && isJson && (
            <div className="flex items-center gap-0.5 pl-1 border-l border-[var(--border)] ml-0.5">
              <button
                className={cn('btn btn-ghost btn-sm btn-icon h-6 w-6', bodyMode === 'tree' && 'bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--foreground)]')}
                onClick={() => setBodyMode('tree')} title="Tree view"
              ><Braces size={10} /></button>
              <button
                className={cn('btn btn-ghost btn-sm btn-icon h-6 w-6', bodyMode === 'pretty' && 'bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--foreground)]')}
                onClick={() => setBodyMode('pretty')} title="Pretty text"
              ><AlignLeft size={10} /></button>
            </div>
          )}
          <div className="w-px h-4 bg-[var(--border)] mx-0.5" />
          <button className="btn btn-ghost btn-sm btn-icon h-6 w-6" onClick={() => copy(filter.trim() && isJson ? filteredText : response.body, 'body')} title="Copy body">
            {copied === 'body' ? <Check size={11} className="text-[var(--primary)]" /> : <Copy size={11} />}
          </button>
          <a
            href={isBinary
              ? `data:${contentType.split(';')[0] || 'application/octet-stream'};base64,${response.bodyB64}`
              : `data:text/plain;charset=utf-8,${encodeURIComponent(response.body)}`}
            download={isBinary ? 'response' : (isJson ? 'response.json' : 'response.txt')}
            className="btn btn-ghost btn-sm btn-icon h-6 w-6" title="Download">
            <Download size={11} />
          </a>
        </div>
      </div>

      {/* ── Row 2: tabs */}
      <div className="flex items-center gap-[2px] px-1.5 border-b border-[var(--border)] bg-[var(--background)] flex-shrink-0" style={{ height: 32 }}>
        {tabs.map(t => (
          <button key={t.id} className={cn('sub-tab', view === t.id && 'active')} onClick={() => setView(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      {/* ── jq filter row — only when toggled open */}
      {view === 'body' && isJson && filterOpen && (
        <div className="flex items-center gap-2 px-3 py-1 border-b border-[var(--border)] bg-[var(--background)] flex-shrink-0">
          <Search size={10} className="text-[var(--placeholder-foreground)] flex-shrink-0" />
          <input
            autoFocus
            className="flex-1 bg-transparent border-0 outline-none font-mono text-[12px] text-[var(--foreground)] placeholder:text-[var(--placeholder-foreground)]"
            placeholder=".items[].name  ·  .data | length  ·  jq syntax"
            value={filter}
            onChange={e => setFilter(e.target.value)}
            onKeyDown={e => { if (e.key === 'Escape') { setFilterOpen(false); setFilter(''); } }}
            spellCheck={false}
          />
          {filterError && <span className="text-[11px] text-[var(--warning,#f59e0b)] truncate max-w-[200px]" title={filterError}>{filterError}</span>}
          {filter && (
            <button className="btn btn-ghost btn-sm btn-icon h-5 w-5" onClick={() => setFilter('')} title="Clear filter">
              <X size={10} />
            </button>
          )}
          <a href="https://jqlang.github.io/jq/manual/#basic-filters" target="_blank" rel="noopener noreferrer"
            className="text-[var(--placeholder-foreground)] hover:text-[var(--foreground)] flex-shrink-0" title="jq syntax">
            <HelpCircle size={11} />
          </a>
        </div>
      )}

      <div className="flex-1 overflow-auto flex flex-col">
        {view === 'body' && (
          isImage ? (
            <div className="flex-1 flex items-center justify-center p-6 bg-[var(--background)]">
              <img src={`data:${contentType.split(';')[0]};base64,${response.bodyB64}`} alt="response" className="max-w-full max-h-full object-contain rounded" />
            </div>
          ) : isBinary ? (
            <div className="empty-state">
              <FileJson size={22} className="opacity-30" />
              <span className="text-[12.5px]">Binary response ({fmtSize(response.size)}) — use Download</span>
            </div>
          ) : isJson ? (
            bodyMode === 'tree'
              ? <JsonTree data={filtered} controlsRef={treeControls} />
              : <JsonViewer text={filteredText} lang="json" />
          ) : isHtml ? (
            <div className="flex-1 flex flex-col overflow-hidden">
              <JsonViewer text={response.body} />
              <div className="flex items-center gap-2.5 px-3 py-2 border-t border-[var(--border)] bg-[var(--card)] flex-shrink-0">
                <span className="text-[11px] text-[var(--placeholder-foreground)] flex-1">HTML response — switch to Preview to render it</span>
                <button className="btn btn-primary btn-sm text-[11px] h-6 px-3 gap-1.5" onClick={() => setView('preview')}>
                  <Eye size={10} /> Render HTML
                </button>
              </div>
            </div>
          ) : (
            <JsonViewer text={response.body} />
          )
        )}

        {view === 'headers' && (
          <div className="p-3">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1.5 border-b border-[var(--border)] text-[12px] last:border-0 group">
                <span className="font-mono text-[var(--muted-foreground)] min-w-[180px] flex-shrink-0">{k}</span>
                <span className="text-[var(--foreground)] break-all flex-1">{v}</span>
                <button className="btn btn-ghost btn-icon btn-sm opacity-0 group-hover:opacity-100 flex-shrink-0" onClick={() => copy(`${k}: ${v}`, k)} title="Copy header">
                  {copied === k ? <Check size={10} className="text-[var(--primary)]" /> : <Copy size={10} />}
                </button>
              </div>
            ))}
          </div>
        )}

        {view === 'cookies' && (
          <div className="p-3">
            {responseCookies.length === 0
              ? <div className="empty-state"><span className="text-[12px]">No Set-Cookie headers</span></div>
              : responseCookies.map((c, i) => (
                <div key={i} className="flex flex-wrap gap-2 py-2 border-b border-[var(--border)] text-[12px] last:border-0">
                  <span className="font-mono text-[var(--primary)] font-semibold">{c.name}</span>
                  <span className="text-[var(--foreground)]">=</span>
                  <span className="font-mono text-[var(--foreground)] break-all">{c.value}</span>
                  {c.attrs && <span className="text-[var(--placeholder-foreground)] text-[11px]">{c.attrs}</span>}
                </div>
              ))
            }
          </div>
        )}

        {view === 'raw' && (
          <pre className="p-4 font-mono text-[12px] whitespace-pre-wrap m-0 flex-1 text-[var(--foreground)] leading-relaxed">
            <span className={scClass(response.status)}>HTTP/1.1 {response.status} {response.statusText}</span>{'\n'}
            {Object.entries(response.headers).map(([k, v]) => `${k}: ${v}`).join('\n')}
            {'\n\n'}
            {isBinary ? `<binary ${fmtSize(response.size)}>` : response.body}
          </pre>
        )}

        {view === 'preview' && isHtml && (
          <iframe
            key={response.body}
            srcDoc={response.body}
            sandbox="allow-scripts"
            className="flex-1 border-0 w-full h-full"
            title="Response preview"
          />
        )}

        {view === 'preview' && isImage && (
          <div className="flex-1 flex items-center justify-center p-6 bg-[var(--background)]">
            <img src={`data:${contentType.split(';')[0]};base64,${response.bodyB64}`} alt="response" className="max-w-full max-h-full object-contain rounded" />
          </div>
        )}

        {view === 'schema' && isJson && (
          <div className="flex-1 flex flex-col overflow-hidden">
            <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
              <span className="text-[11px] text-[var(--placeholder-foreground)]">JSON Schema inferred from this response</span>
              <button className="btn btn-ghost btn-sm gap-1.5 text-[11px] ml-auto h-6 px-2" onClick={() => copy(schemaText, 'schema')}>
                {copied === 'schema' ? <Check size={11} className="text-[var(--primary)]" /> : <Copy size={11} />}
                Copy schema
              </button>
            </div>
            <JsonViewer text={schemaText} lang="json" />
          </div>
        )}

        {view === 'timing' && (
          <div className="flex-1 overflow-auto p-4">
            {response.timing ? (
              <TimingWaterfall timing={response.timing} />
            ) : (
              <div className="flex flex-col items-center justify-center gap-2 py-10 text-[var(--placeholder-foreground)]">
                <Clock size={22} className="opacity-40" />
                <span className="text-[12.5px]">No timing data — resend request to capture timing</span>
              </div>
            )}
          </div>
        )}

        {view === 'network' && (
          <div className="flex-1 overflow-auto p-4">
            <NetworkInfoPanel
              url={response.networkInfo ? `${response.networkInfo.scheme}://${response.networkInfo.host}${response.networkInfo.filename}` : ''}
              status={response.status}
              statusText={response.statusText}
              headers={response.headers}
              networkInfo={response.networkInfo}
              size={response.size}
              latency={response.latency}
            />
          </div>
        )}
      </div>
    </div>
  );
}

// ── Saved requests panel ──────────────────────────────────────────────────
function SavedPanel({ requests, onLoad, onDelete }: {
  requests: SavedRequest[];
  onLoad: (r: SavedRequest) => void;
  onDelete: (id: string) => void;
}) {
  const [search, setSearch] = useState('');
  const filtered = requests.filter(r =>
    !search || r.name.toLowerCase().includes(search.toLowerCase()) || r.url.toLowerCase().includes(search.toLowerCase()),
  );

  // Group by folder
  const groups = filtered.reduce<Record<string, SavedRequest[]>>((acc, r) => {
    const key = r.folder || '';
    if (!acc[key]) acc[key] = [];
    acc[key]!.push(r);
    return acc;
  }, {});

  const MC: Record<string, string> = {
    GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)',
    PATCH: 'var(--method-patch)', DELETE: 'var(--method-delete)', HEAD: 'var(--method-head)',
    OPTIONS: 'var(--method-head)',
  };

  return (
    <div className="flex flex-col h-full">
      <div className="px-2 pt-2 pb-1 flex-shrink-0">
        <div className="relative">
          <Search size={11} className="absolute left-2 top-1/2 -translate-y-1/2 text-[var(--placeholder-foreground)]" />
          <input
            className="input w-full h-7 pl-6 text-[11.5px]"
            placeholder="Search saved…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
      </div>
      <div className="flex-1 overflow-y-auto">
        {Object.entries(groups).sort(([a], [b]) => a.localeCompare(b)).map(([folder, items]) => (
          <div key={folder || '__root__'}>
            {folder && (
              <div className="flex items-center gap-1.5 px-2.5 py-1 mt-1">
                <Folder size={10} className="text-[var(--placeholder-foreground)] flex-shrink-0" />
                <span className="text-[10px] font-semibold text-[var(--placeholder-foreground)] tracking-wide uppercase truncate">{folder}</span>
              </div>
            )}
            {items.map(r => (
              <div
                key={r.id}
                className="group flex items-center gap-2 px-2.5 py-1.5 cursor-pointer hover:bg-[color-mix(in_srgb,var(--foreground)_4%,transparent)] transition-colors"
                onClick={() => onLoad(r)}
                title={r.url}
              >
                <span style={{ fontSize: 9, fontWeight: 700, color: MC[r.method] ?? 'var(--muted-foreground)', fontFamily: 'var(--font-mono)', flexShrink: 0, minWidth: 30 }}>
                  {r.method}
                </span>
                <span className="flex-1 text-[12px] text-[var(--foreground)] truncate">{r.name}</span>
                <button
                  className="opacity-0 group-hover:opacity-100 flex items-center justify-center w-5 h-5 rounded hover:bg-[color-mix(in_srgb,var(--red,#ef4444)_15%,transparent)] text-[var(--placeholder-foreground)] hover:text-[var(--red,#ef4444)] transition-all flex-shrink-0"
                  onClick={e => { e.stopPropagation(); onDelete(r.id); }}
                  title="Delete"
                >
                  <Trash2 size={10} />
                </button>
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Test runner ───────────────────────────────────────────────────────────
function runTests(code: string, response: ResponseResult): TestResult[] {
  const results: TestResult[] = [];
  if (!code.trim()) return results;

  class Chain {
    private _neg = false;
    constructor(private val: unknown) {}
    get not() { this._neg = !this._neg; return this; }
    get to() { return this; }
    get be() { return this; }
    get have() { return this; }
    get been() { return this; }
    get is() { return this; }
    get that() { return this; }
    get which() { return this; }
    get and() { return this; }
    get ok() { this._assert(!!this.val, `expected ${JSON.stringify(this.val)} to be truthy`); return this; }
    get true() { this._assert(this.val === true, `expected ${JSON.stringify(this.val)} to be true`); return this; }
    get false() { this._assert(this.val === false, `expected ${JSON.stringify(this.val)} to be false`); return this; }
    get null() { this._assert(this.val === null, `expected ${JSON.stringify(this.val)} to be null`); return this; }
    get undefined() { this._assert(this.val === undefined, `expected to be undefined`); return this; }
    get empty() {
      const e = Array.isArray(this.val) || typeof this.val === 'string' ? (this.val as string | unknown[]).length === 0 : this.val == null;
      this._assert(e, `expected ${JSON.stringify(this.val)} to be empty`); return this;
    }
    equal(exp: unknown) { this._assert(this.val === exp, `expected ${JSON.stringify(this.val)} to equal ${JSON.stringify(exp)}`); return this; }
    eql(exp: unknown) { this._assert(JSON.stringify(this.val) === JSON.stringify(exp), `expected deep equality`); return this; }
    include(sub: unknown) {
      const ok = typeof this.val === 'string' ? this.val.includes(String(sub)) : Array.isArray(this.val) ? this.val.includes(sub) : false;
      this._assert(ok, `expected ${JSON.stringify(this.val)} to include ${JSON.stringify(sub)}`); return this;
    }
    contain(sub: unknown) { return this.include(sub); }
    match(re: RegExp) { this._assert(re.test(String(this.val)), `expected ${JSON.stringify(this.val)} to match ${re}`); return this; }
    property(key: string, val?: unknown) {
      const has = typeof this.val === 'object' && this.val !== null && key in (this.val as object);
      this._assert(has, `expected to have property "${key}"`);
      if (has && val !== undefined) this._assert((this.val as Record<string, unknown>)[key] === val, `expected .${key} to equal ${JSON.stringify(val)}`);
      return this;
    }
    above(n: number) { this._assert((this.val as number) > n, `expected ${this.val} to be above ${n}`); return this; }
    below(n: number) { this._assert((this.val as number) < n, `expected ${this.val} to be below ${n}`); return this; }
    least(n: number) { this._assert((this.val as number) >= n, `expected ${this.val} to be at least ${n}`); return this; }
    most(n: number) { this._assert((this.val as number) <= n, `expected ${this.val} to be at most ${n}`); return this; }
    within(lo: number, hi: number) { this._assert((this.val as number) >= lo && (this.val as number) <= hi, `expected ${this.val} to be within ${lo}–${hi}`); return this; }
    lengthOf(n: number) { const l = (this.val as string | unknown[]).length; this._assert(l === n, `expected length ${l} to equal ${n}`); return this; }
    length(n: number) { return this.lengthOf(n); }
    a(type: string) { this._assert(typeof this.val === type || (type === 'array' && Array.isArray(this.val)), `expected to be a ${type}`); return this; }
    an(type: string) { return this.a(type); }
    private _assert(cond: boolean, msg: string) {
      const pass = this._neg ? !cond : cond;
      if (!pass) throw new Error(this._neg ? msg.replace('to ', 'not to ') : msg);
      this._neg = false;
    }
  }

  const pm = {
    response: {
      code: response.status,
      status: response.status,
      statusText: response.statusText,
      responseTime: response.latency,
      headers: { get: (k: string) => response.headers[k] ?? response.headers[k.toLowerCase()] ?? null },
      body: response.body,
      text: () => response.body,
      json: () => { try { return JSON.parse(response.body) as unknown; } catch { throw new Error('Response is not valid JSON'); } },
      size: response.size,
    },
    expect: (v: unknown) => new Chain(v),
    test: (name: string, fn: () => void) => {
      try { fn(); results.push({ name, passed: true }); }
      catch (e) { results.push({ name, passed: false, error: e instanceof Error ? e.message : String(e) }); }
    },
    environment: { get: (_k: string) => '', set: (_k: string, _v: string) => {} },
    globals: { get: (_k: string) => '', set: (_k: string, _v: string) => {} },
  };

  try {
    // eslint-disable-next-line no-new-func
    new Function('pm', code)(pm);
  } catch (e) {
    results.push({ name: '(script)', passed: false, error: e instanceof Error ? e.message : String(e) });
  }
  return results;
}

// ── Tests Panel ────────────────────────────────────────────────────────────
const TESTS_PLACEHOLDER = `// Postman-compatible test API
pm.test("Status is 200", () => {
  pm.expect(pm.response.status).to.equal(200);
});

pm.test("Response has data", () => {
  const json = pm.response.json();
  pm.expect(json).to.have.property("data");
});

pm.test("Fast response", () => {
  pm.expect(pm.response.responseTime).to.be.below(500);
});`;

function TestsPanel({ code, onChange, results }: { code: string; onChange: (v: string) => void; results: TestResult[] | null }) {
  const passed = results?.filter(r => r.passed).length ?? 0;
  const failed = results?.filter(r => !r.passed).length ?? 0;

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        <FlaskConical size={11} className="text-[var(--muted-foreground)]" />
        <span className="text-[11px] text-[var(--muted-foreground)]">Test script — runs after each response</span>
        <div className="ml-auto flex items-center gap-2">
          {results !== null && (
            <span className="flex items-center gap-1.5 text-[11px]">
              {passed > 0 && <span className="flex items-center gap-0.5 text-[var(--success,#22c55e)]"><CheckCircle2 size={10} />{passed}</span>}
              {failed > 0 && <span className="flex items-center gap-0.5 text-[var(--destructive)]"><XCircle size={10} />{failed}</span>}
              {passed + failed === 0 && <span className="text-[var(--placeholder-foreground)]">no tests</span>}
            </span>
          )}
        </div>
      </div>
      <div className="flex-1 min-h-0 flex flex-col">
        <textarea
          className="flex-1 w-full font-mono text-[12px] resize-none border-0 outline-none p-3 leading-relaxed"
          style={{ background: 'var(--background)', color: 'var(--foreground)', caretColor: 'var(--foreground)' }}
          placeholder={TESTS_PLACEHOLDER}
          value={code}
          onChange={e => onChange(e.target.value)}
          spellCheck={false}
        />
        {results !== null && results.length > 0 && (
          <div className="border-t border-[var(--border)] bg-[var(--card)] flex-shrink-0 max-h-[160px] overflow-y-auto">
            {results.map((r, i) => (
              <div key={i} className={cn('flex items-start gap-2 px-3 py-1.5 border-b border-[var(--border)] last:border-0 text-[12px]', !r.passed && 'bg-[var(--destructive-dim,rgba(239,68,68,0.05))]')}>
                {r.passed
                  ? <CheckCircle2 size={12} className="mt-0.5 flex-shrink-0 text-[var(--success,#22c55e)]" />
                  : <XCircle size={12} className="mt-0.5 flex-shrink-0 text-[var(--destructive)]" />}
                <span className={cn('flex-1', r.passed ? 'text-[var(--foreground)]' : 'text-[var(--destructive)]')}>{r.name}</span>
                {r.error && <span className="text-[11px] text-[var(--placeholder-foreground)] truncate max-w-[260px]" title={r.error}>{r.error}</span>}
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ── Proxy Guide Modal ──────────────────────────────────────────────────────
function ProxyGuideModal({ onClose }: { onClose: () => void }) {
  const origin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:3388';

  useEffect(() => {
    const h = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', h);
    return () => document.removeEventListener('keydown', h);
  }, [onClose]);

  const code = (s: string) => (
    <code className="block font-mono text-[11.5px] bg-[var(--elevated)] border border-[var(--border)] rounded px-2.5 py-2 text-[var(--foreground)] whitespace-pre-wrap break-all leading-relaxed">{s}</code>
  );

  return (
    <div className="cmd-overlay" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div
        onMouseDown={e => e.stopPropagation()}
        className="w-full mx-4 bg-[var(--popover)] border border-[var(--border-strong)] rounded-xl flex flex-col overflow-hidden"
        style={{ maxWidth: 660, maxHeight: '86vh', boxShadow: 'var(--shadow)', animation: 'dialog-in 0.12s ease' }}
      >
        <div className="flex items-center gap-2.5 px-4 py-3 border-b border-[var(--border)] flex-shrink-0">
          <ShieldAlert size={14} className="text-[var(--muted-foreground)]" />
          <h2 className="text-[13.5px] font-semibold flex-1 m-0">Using the Built-in Proxy</h2>
          <button className="btn btn-ghost btn-icon btn-sm" onClick={onClose}><X size={13} /></button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 flex flex-col gap-6 text-[13px]">

          {/* What it is */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <Globe size={11} /> What is it
            </div>
            <p className="text-[var(--muted-foreground)] leading-relaxed text-[12.5px]">
              The CLI acts as an HTTP pass-through proxy on <code className="font-mono text-[var(--foreground)] bg-[var(--elevated)] px-1 py-0.5 rounded">{origin}</code>.
              Any request you send through it gets your active auth injected automatically, gets logged in the Logs tab, and can be intercepted or redirected using Intercept Rules.
            </p>
          </section>

          {/* Direct proxying */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <Terminal size={11} /> Direct URL proxying
            </div>
            <p className="text-[12px] text-[var(--muted-foreground)]">Prefix any URL with <code className="font-mono text-[var(--foreground)]">{origin}/proxy/</code> to route it through the CLI:</p>
            {code(`curl "${origin}/proxy/https://api.example.com/users"`)}
            <p className="text-[12px] text-[var(--muted-foreground)]">With a POST body:</p>
            {code(`curl -X POST "${origin}/proxy/https://api.example.com/users" \\\n  -H "Content-Type: application/json" \\\n  -d '{"name":"Alice"}'`)}
            <p className="text-[11.5px] text-[var(--placeholder-foreground)]">Auth headers are added automatically by the CLI — you don't need to supply them in the curl command.</p>
          </section>

          {/* Dev scenario */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <RefreshCcw size={11} /> Real dev scenario
            </div>
            <p className="text-[12px] text-[var(--muted-foreground)]">Point your frontend at the proxy during development so all API calls get logged and authed. In your <code className="font-mono text-[var(--foreground)]">.env.development</code>:</p>
            {code(`VITE_API_BASE_URL=${origin}/proxy/https://staging-api.yourcompany.com`)}
            <p className="text-[12px] text-[var(--muted-foreground)]">Then in your app, every fetch to <code className="font-mono text-[var(--foreground)]">/users</code> becomes a proxied call with auth — and appears in the Logs tab in real time.</p>
          </section>

          {/* Intercept rules */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <RouteIcon size={11} /> Intercept rules
            </div>
            <p className="text-[12px] text-[var(--muted-foreground)]">Create a rule in <strong className="text-[var(--foreground)]">Intercept → New Rule</strong> to:</p>
            <ul className="text-[12px] text-[var(--muted-foreground)] flex flex-col gap-1 pl-4 list-disc">
              <li>Redirect requests matching a path to a different host (e.g. point <code className="font-mono text-[var(--foreground)]">/api/v2/*</code> at your local dev server)</li>
              <li>Inject extra headers automatically (e.g. <code className="font-mono text-[var(--foreground)]">X-Debug: true</code>)</li>
              <li>Strip or add URL path prefixes</li>
            </ul>
            <p className="text-[12px] text-[var(--muted-foreground)]">In the Explorer, select a rule from the <strong className="text-[var(--foreground)]">Via</strong> dropdown next to the URL bar — that request will be routed through the rule when you hit Send.</p>
          </section>

          {/* Dynamic variables */}
          <section className="flex flex-col gap-2">
            <div className="flex items-center gap-2 text-[11.5px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">
              <FlaskConical size={11} /> Dynamic variables
            </div>
            <p className="text-[12px] text-[var(--muted-foreground)]">Use these anywhere in URLs, headers, or body — resolved fresh on each Send:</p>
            <div className="grid grid-cols-2 gap-1.5">
              {[
                ['{{$guid}}', 'Random UUID v4'],
                ['{{$timestamp}}', 'Unix timestamp (seconds)'],
                ['{{$isoTimestamp}}', 'ISO 8601 datetime'],
                ['{{$randomInt}}', 'Random integer 0–999'],
                ['{{$randomString}}', 'Random alphanumeric'],
                ['{{$randomEmail}}', 'Random example email'],
              ].map(([v, d]) => (
                <div key={v} className="flex items-baseline gap-1.5">
                  <code className="font-mono text-[11px] text-[var(--foreground)] bg-[var(--elevated)] border border-[var(--border)] rounded px-1.5 py-0.5 flex-shrink-0">{v}</code>
                  <span className="text-[11.5px] text-[var(--muted-foreground)]">{d}</span>
                </div>
              ))}
            </div>
          </section>

        </div>

        <div className="flex justify-end px-4 py-3 border-t border-[var(--border)] flex-shrink-0">
          <button className="btn btn-primary btn-sm" onClick={onClose}>Got it</button>
        </div>
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
function ExplorerPage() {
  const { envs, activeEnvId } = useApp();
  const globalEnv = envs.find(e => e.id === activeEnvId) ?? null;

  const [tabs, setTabs] = useState<RequestTab[]>(() => [blankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]!.id);
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [activeWsId, setActiveWsId] = useState<string>(() => getActiveWorkspaceId());
  const [wsModalOpen, setWsModalOpen] = useState(false);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [operations, setOperations] = useState<ParsedOperation[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [endpointPanelOpen, setEndpointPanelOpen] = useState(() => {
    try { return localStorage.getItem('endpoint_panel_open') !== '0'; } catch { return true; }
  });
  const toggleEndpointPanel = () => setEndpointPanelOpen(v => {
    const next = !v;
    try { localStorage.setItem('endpoint_panel_open', next ? '1' : '0'); } catch {}
    return next;
  });

  interface CtxMenu { x: number; y: number; tabId: string }
  interface EpCtxMenu { x: number; y: number; op: ParsedOperation }
  const [ctxMenu, setCtxMenu] = useState<CtxMenu | null>(null);
  const [epCtxMenu, setEpCtxMenu] = useState<EpCtxMenu | null>(null);

  const [activeOpId, setActiveOpId] = useState<string | undefined>();
  const [codeOpen, setCodeOpen] = useState(false);
  type ReqTab = 'params' | 'headers' | 'body' | 'auth' | 'cookies' | 'payload' | 'tests';
  const [reqTab, setReqTab] = useState<ReqTab>('params');
  const [splitPct, setSplitPct] = useState(0.45);
  const [dragging, setDragging] = useState(false);
  const [splitDir, setSplitDir] = useState<'v' | 'h'>(() =>
    (typeof window !== 'undefined' ? (localStorage.getItem('splitDir') as 'v' | 'h') : null) ?? 'v'
  );
  const changeSplitDir = (d: 'v' | 'h') => { setSplitDir(d); localStorage.setItem('splitDir', d); };
  const [ExplorerHotkeys, setExplorerHotkeys] = useState<typeof import('../components/ExplorerHotkeys').ExplorerHotkeys | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

  const [savedRequests, setSavedRequests] = useState<SavedRequest[]>([]);
  const [showSaved, setShowSaved] = useState(false);
  const [savePopup, setSavePopup] = useState<{ open: boolean; name: string; folder: string }>({ open: false, name: '', folder: '' });
  const [shareCopied, setShareCopied] = useState(false);
  const [interceptRules, setInterceptRules] = useState<InterceptRule[]>([]);
  const [proxyGuideOpen, setProxyGuideOpen] = useState(false);
  const [reqSettingsOpen, setReqSettingsOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);

  // ── Stable refs so hotkey callbacks never go stale ──────────────────────
  const sendRef      = useRef<null | (() => Promise<void>)>(null);
  const addTabRef    = useRef<null | (() => void)>(null);
  const updRef       = useRef<null | ((id: string, patch: Partial<RequestTab>) => void)>(null);
  const tabsRef      = useRef(tabs);
  const activeTabRef = useRef(activeTabId);
  useEffect(() => { tabsRef.current = tabs; });
  useEffect(() => { activeTabRef.current = activeTabId; });

  useEffect(() => {
    import('../components/ExplorerHotkeys').then(m => setExplorerHotkeys(() => m.ExplorerHotkeys));
  }, []);

  // ── Workspaces ────────────────────────────────────────────────────────────
  useEffect(() => {
    listWorkspaces().then(ws => {
      setWorkspaces(ws);
      if (!ws.some(w => w.id === getActiveWorkspaceId())) setActiveWsId(ws[0]!.id);
    }).catch(() => setWorkspaces([defaultWorkspace()]));
  }, []);
  useEffect(() => {
    _currentWorkspaceId = activeWsId;
    setActiveWorkspaceId(activeWsId);
  }, [activeWsId]);

  const activeWs = workspaces.find(w => w.id === activeWsId) ?? null;

  const saveWs = async (w: Workspace) => {
    await saveWorkspace(w).catch(() => {});
    setWorkspaces(prev => prev.some(p => p.id === w.id) ? prev.map(p => p.id === w.id ? w : p) : [...prev, w]);
    setWsModalOpen(false);
  };
  const removeWs = async (id: string) => {
    await deleteWorkspace(id).catch(() => {});
    // Orphaned tabs fall back to the default workspace
    setTabs(prev => prev.map(t => t.workspaceId === id ? { ...t, workspaceId: DEFAULT_WORKSPACE_ID } : t));
    setWorkspaces(prev => prev.filter(p => p.id !== id));
    setActiveWsId(DEFAULT_WORKSPACE_ID);
    setWsModalOpen(false);
  };
  // ── Load from IndexedDB on mount ──────────────────────────────────────────
  useEffect(() => {
    dbGet<{ id: string; tabs: RequestTab[]; activeTabId: string }>('explorer', 'state')
      .then(saved => {
        if (saved?.tabs?.length) {
          // Merge with blankTab defaults so old saved tabs get new fields (pathParams, auth, rawType…)
          const loaded = saved.tabs.map(t => ({
            ...blankTab(),
            ...t,
            loading: false,
            pathParams: Array.isArray(t.pathParams) ? t.pathParams : syncPathParams(t.url ?? '', []),
            auth: migrateAuth(t.auth),
            rawType: t.rawType ?? 'text/plain',
            binaryFile: t.binaryFile ?? null,
            workspaceId: t.workspaceId ?? DEFAULT_WORKSPACE_ID,
            envId: t.envId ?? '',
          }));
          setTabs(loaded);
          setActiveTabId(saved.activeTabId && loaded.some(t => t.id === saved.activeTabId) ? saved.activeTabId : loaded[0]!.id);
        }
      })
      .catch(() => {})
      .finally(() => setDbLoaded(true));
  }, []);

  // ── Persist to IndexedDB on every change (debounced) ──────────────────────
  useEffect(() => {
    if (!dbLoaded) return;
    const t = setTimeout(() => {
      dbPut('explorer', { id: 'state', tabs, activeTabId }).catch(() => {});
    }, 400);
    return () => clearTimeout(t);
  }, [tabs, activeTabId, dbLoaded]);

  // ── Saved requests ────────────────────────────────────────────────────────
  useEffect(() => {
    apiClient<SavedRequest[]>('/api/saved').then(setSavedRequests).catch(() => {});
  }, []);

  // Pick up a request forwarded from the Logs page via sessionStorage
  useEffect(() => {
    if (!dbLoaded) return;
    try {
      const raw = sessionStorage.getItem('explorer_pending_log');
      if (!raw) return;
      sessionStorage.removeItem('explorer_pending_log');
      const data = JSON.parse(raw) as { method?: string; url?: string; headers?: KVRow[]; body?: string; body_type?: string; title?: string };
      const hdrs: KVRow[] = [...(data.headers ?? []), { key: '', value: '', enabled: true }];
      const t = blankTab({
        title: data.title || data.url || 'New Request',
        method: (data.method ?? 'GET').toUpperCase(),
        url: data.url ?? '',
        headers: hdrs,
        body: data.body ?? '',
        bodyType: (data.body_type as RequestTab['bodyType']) ?? 'none',
      });
      setTabs(prev => [...prev, t]);
      setActiveTabId(t.id);
    } catch { /* ignore */ }
  }, [dbLoaded]);

  // ── Load operations ───────────────────────────────────────────────────────
  useEffect(() => {
    apiClient<{ spec: { baseUrl: string } }>('/api/status')
      .then(s => setBaseUrl(s.spec.baseUrl))
      .catch(() => {});
    cacheGet<ParsedOperation[]>('spec_endpoints').then(cached => {
      if (cached && operations.length === 0) setOperations(cached);
    });
    apiClient<ParsedOperation[]>('/api/spec/endpoints')
      .then(ops => { setOperations(ops); if (ops.length > 0) cacheSet('spec_endpoints', ops, 600_000); })
      .catch(() => {});
    apiClient<InterceptRule[]>('/api/intercept')
      .then(rs => setInterceptRules(rs.filter(r => r.enabled === 1)))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const handler = (e: Event) => {
      const op = (e as CustomEvent<ParsedOperation>).detail;
      if (op) openEndpoint(op);
    };
    window.addEventListener('cmd-open-endpoint', handler);
    return () => window.removeEventListener('cmd-open-endpoint', handler);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [baseUrl, operations]);

  // Context menus are closed via a transparent backdrop overlay rendered behind them.

  const upd = useCallback((id: string, patch: Partial<RequestTab>) => {
    setTabs(prev => prev.map(t => t.id === id ? { ...t, ...patch } : t));
  }, []);
  updRef.current = upd;

  const addTab = () => {
    const t = blankTab();
    setTabs(p => [...p, t]);
    setActiveTabId(t.id);
  };
  addTabRef.current = addTab;

  const closeTab = (id: string, e: React.MouseEvent) => {
    e.stopPropagation();
    const visible = tabs.filter(t => (t.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWsId && t.id !== id);
    setTabs(prev => {
      const next = prev.filter(t => t.id !== id);
      return next.length ? next : [blankTab()];
    });
    if (activeTabId === id) {
      if (visible.length) {
        const idx = tabs.findIndex(t => t.id === id);
        setActiveTabId((visible[Math.max(0, Math.min(idx - 1, visible.length - 1))] ?? visible[0]!).id);
      } else {
        const fresh = blankTab();
        setTabs(p => [...p.filter(t => t.id !== id), fresh]);
        setActiveTabId(fresh.id);
      }
    }
  };

  const closeTabById = (id: string) => {
    const visible = tabs.filter(t => (t.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWsId && t.id !== id);
    setTabs(prev => { const next = prev.filter(t => t.id !== id); return next.length ? next : [blankTab()]; });
    if (activeTabId === id) {
      if (visible.length) { const idx = tabs.findIndex(t => t.id === id); setActiveTabId((visible[Math.max(0, Math.min(idx - 1, visible.length - 1))] ?? visible[0]!).id); }
      else { const fresh = blankTab(); setTabs(p => [...p.filter(t => t.id !== id), fresh]); setActiveTabId(fresh.id); }
    }
  };
  const closeOtherTabs = (keepId: string) => {
    setTabs(prev => {
      const keep = prev.filter(t => t.id === keepId || (t.workspaceId ?? DEFAULT_WORKSPACE_ID) !== activeWsId);
      return keep.length ? keep : [blankTab()];
    });
    setActiveTabId(keepId);
  };
  const closeAllTabs = () => {
    const fresh = blankTab();
    // preserve tabs belonging to other workspaces
    setTabs(prev => {
      const others = prev.filter(t => (t.workspaceId ?? DEFAULT_WORKSPACE_ID) !== activeWsId);
      return [...others, fresh];
    });
    setActiveTabId(fresh.id);
  };
  const duplicateTab = (id: string) => {
    const src = tabs.find(t => t.id === id);
    if (!src) return;
    const dup = { ...src, id: uid(), response: null, loading: false };
    setTabs(p => { const idx = p.findIndex(t => t.id === id); return [...p.slice(0, idx + 1), dup, ...p.slice(idx + 1)]; });
    setActiveTabId(dup.id);
  };

  const openEndpoint = (op: ParsedOperation) => {
    setActiveOpId(op.operationId);
    const url = (baseUrl + op.path).replace(/([^:])\/\//g, '$1/');
    const pathParams = syncPathParams(url, []);
    const qp: KVRow[] = op.parameters.filter(p => p.in === 'query').map(p => ({ key: p.name, value: '', enabled: true }));
    const hdrs: KVRow[] = [{ key: '', value: '', enabled: true }];
    if (op.requestBody) hdrs.unshift({ key: 'Content-Type', value: op.requestBody.contentType, enabled: true });
    let body = '';
    let bodyType: RequestTab['bodyType'] = 'none';
    if (op.requestBody) {
      const ct = op.requestBody.contentType;
      if (ct.includes('json')) bodyType = 'json';
      else if (ct.includes('x-www-form-urlencoded')) bodyType = 'form';
      else if (ct.includes('multipart')) bodyType = 'multipart';
      else bodyType = 'raw';
      body = bodyType === 'json' ? JSON.stringify(schemaToExample(op.requestBody.schema), null, 2) : '';
    }
    const t = blankTab({ title: op.summary ?? op.path, method: op.method.toUpperCase(), url, pathParams, params: [...qp, { key: '', value: '', enabled: true }], headers: hdrs, body, bodyType });
    setTabs(p => [...p, t]);
    setActiveTabId(t.id);
    if (op.requestBody || qp.length) setReqTab(op.requestBody ? 'body' : 'params');
  };

  const saveCurrentRequest = async () => {
    const name = savePopup.name.trim() || tab.title || 'Untitled';
    try {
      const saved = await apiClient<SavedRequest>('/api/saved', {
        method: 'POST',
        body: JSON.stringify({
          name,
          folder: savePopup.folder.trim(),
          method: tab.method,
          url: tab.url,
          headers: JSON.stringify(tab.headers),
          params: JSON.stringify(tab.params),
          body: tab.body,
          body_type: tab.bodyType,
          raw_type: tab.rawType,
          form_rows: JSON.stringify(tab.formRows),
          auth: JSON.stringify(tab.auth),
          notes: '',
        }),
      });
      setSavedRequests(prev => [...prev, saved]);
      setSavePopup({ open: false, name: '', folder: '' });
    } catch { /* ignore */ }
  };

  const loadSavedRequest = (sr: SavedRequest) => {
    let hdrs: KVRow[] = [];
    let params: KVRow[] = [];
    let formRows: KVRow[] = [];
    let auth: AuthConfig = { ...DEFAULT_AUTH };
    try { hdrs = JSON.parse(sr.headers) as KVRow[]; } catch { /* ignore */ }
    try { params = JSON.parse(sr.params) as KVRow[]; } catch { /* ignore */ }
    try { formRows = JSON.parse(sr.form_rows) as KVRow[]; } catch { /* ignore */ }
    try { auth = { ...DEFAULT_AUTH, ...(JSON.parse(sr.auth) as Partial<AuthConfig>) }; } catch { /* ignore */ }
    if (!hdrs.length || hdrs[hdrs.length - 1]?.key) hdrs.push({ key: '', value: '', enabled: true });
    const t = blankTab({
      title: sr.name,
      method: sr.method,
      url: sr.url,
      headers: hdrs,
      params: params.length ? params : [{ key: '', value: '', enabled: true }],
      body: sr.body,
      bodyType: sr.body_type as RequestTab['bodyType'],
      rawType: sr.raw_type,
      formRows: formRows.length ? formRows : [{ key: '', value: '', enabled: true, kind: 'text' }],
      auth,
    });
    setTabs(prev => [...prev, t]);
    setActiveTabId(t.id);
  };

  const deleteSavedRequest = async (id: string) => {
    await apiClient(`/api/saved/${id}`, { method: 'DELETE' }).catch(() => {});
    setSavedRequests(prev => prev.filter(r => r.id !== id));
  };

  const shareRequest = () => {
    const env = effectiveEnv(tab, activeWs, envs, globalEnv);
    const { url, headers, body } = resolveRequest(tab, env, activeWs);
    const snippet = JSON.stringify({ method: tab.method, url, headers: Object.fromEntries(headers), body: body ?? '' }, null, 2);
    navigator.clipboard.writeText(snippet).catch(() => {});
    setShareCopied(true);
    setTimeout(() => setShareCopied(false), 2000);
  };

  const send = async () => {
    if (!tab.url) return;
    upd(tab.id, { loading: true, response: null });

    const env = effectiveEnv(tab, activeWs, envs, globalEnv);
    const { url, headers, body, multipart, authProfile, engineAuth } = resolveRequest(tab, env, activeWs);
    const hdrs: Record<string, string> = {};
    for (const [k, v] of headers) { if (!hdrs[k]) hdrs[k] = v; }

    // Cookie jar
    const dom = urlDomain(replacePaths(resolveVars(tab.url, env), tab.pathParams));
    const allCookies = await dbGetAll<CookieEntry>('cookies').catch(() => [] as CookieEntry[]);
    const matching = allCookies.filter(c => c.enabled && (c.domain === dom || c.domain === ''));
    if (matching.length) {
      const cs = matching.map(c => `${c.name}=${c.value}`).join('; ');
      hdrs['Cookie'] = hdrs['Cookie'] ? `${hdrs['Cookie']}; ${cs}` : cs;
    }

    const payload: Record<string, unknown> = { method: tab.method, url, headers: hdrs };
    if (multipart?.length) payload.multipart = multipart;
    else if (tab.bodyType === 'binary' && tab.binaryFile) payload.bodyB64 = tab.binaryFile.dataB64;
    else if (body) payload.body = body;
    if (authProfile) payload.authProfile = authProfile;
    if (engineAuth) payload.auth = engineAuth;
    if (tab.interceptRuleId) payload.interceptRuleId = tab.interceptRuleId;
    if (tab.timeout > 0) payload.timeout = tab.timeout;
    if (!tab.followRedirects) payload.followRedirects = false;

    try {
      const r = await apiClient<{ status: number; statusText?: string; headers: Record<string, string>; body?: string; bodyB64?: string; size?: number; latency: number; error?: string; redirectedTo?: string; timing?: RequestTiming; networkInfo?: NetworkInfo; }>('/api/explorer/request', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      const response: ResponseResult = r.error
        ? { status: 0, statusText: '', headers: {}, body: '', latency: r.latency ?? 0, size: 0, error: r.error }
        : {
            status: r.status, statusText: r.statusText ?? '', headers: r.headers,
            body: r.body ?? '', bodyB64: r.bodyB64,
            latency: r.latency,
            size: r.size ?? new Blob([r.body ?? '']).size,
            redirectedTo: r.redirectedTo,
            timing: r.timing,
            networkInfo: r.networkInfo,
          };
      const testResults = tab.tests.trim() && !response.error ? runTests(tab.tests, response) : null;
      upd(tab.id, { loading: false, response, testResults });
    } catch (e) {
      upd(tab.id, { loading: false, response: { status: 0, statusText: '', headers: {}, body: '', latency: 0, size: 0, error: String(e) }, testResults: null });
    }
  };
  sendRef.current = send;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const dir = splitDir; // capture at mousedown time
    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      if (dir === 'v') {
        setSplitPct(Math.max(0.2, Math.min(0.8, (ev.clientY - rect.top) / rect.height)));
      } else {
        setSplitPct(Math.max(0.2, Math.min(0.8, (ev.clientX - rect.left) / rect.width)));
      }
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  // Tabs shown belong to the active workspace
  const wsTabs = tabs.filter(t => (t.workspaceId ?? DEFAULT_WORKSPACE_ID) === activeWsId);
  const tab = wsTabs.find(t => t.id === activeTabId) ?? wsTabs[0] ?? tabs[0]!;

  // Keep the active tab inside the visible workspace
  useEffect(() => {
    if (!wsTabs.length) {
      const fresh = blankTab();
      setTabs(p => [...p, fresh]);
      setActiveTabId(fresh.id);
    } else if (!wsTabs.some(t => t.id === activeTabId)) {
      setActiveTabId(wsTabs[0]!.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeWsId, workspaces.length, tabs.length]);

  const activeEnv = effectiveEnv(tab, activeWs, envs, globalEnv);
  const domain = urlDomain(resolveVars(replacePaths(tab.url, tab.pathParams), activeEnv));
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(tab.method);
  const hasPathParams = tab.pathParams.length > 0;
  const resolvedAuthType = effectiveAuth(tab, activeWs).type;
  const hasAuth = resolvedAuthType !== 'cli' && resolvedAuthType !== 'none';

  const paramCount = tab.params.filter(p => p.key).length + tab.pathParams.filter(p => p.key && p.value).length;
  const headerCount = tab.headers.filter(h => h.key).length
    + (activeWs?.headers.filter(h => h.enabled && h.key).length ?? 0)
    + (activeEnv?.headers?.filter(h => h.enabled && h.key).length ?? 0);

  const codeRequest: CodeRequest = useMemo(() => {
    const { url, headers, body, multipart } = resolveRequest(tab, activeEnv, activeWs);
    return {
      method: tab.method, url, headers, body,
      multipart: multipart?.map(p => ({ name: p.name, kind: p.kind, value: p.kind === 'text' ? p.value : undefined, filename: p.kind === 'file' ? p.filename : undefined })),
      binaryFilename: tab.bodyType === 'binary' ? tab.binaryFile?.name : undefined,
    };
  }, [tab, activeEnv, activeWs]);

  // Apply JSON body suggested by AI panel
  useEffect(() => {
    const handler = (e: Event) => {
      const json = (e as CustomEvent<string>).detail;
      if (json && tab) upd(tab.id, { body: json, bodyType: 'json' });
    };
    window.addEventListener('ai-apply-body', handler);
    return () => window.removeEventListener('ai-apply-body', handler);
  }, [tab]);

  // Keep AI panel context in sync with active tab + response
  useEffect(() => {
    if (!tab) return;
    const ctx = {
      page: 'explorer',
      method: tab.method,
      url: tab.url || undefined,
      path: tab.url ? (() => { try { return new URL(tab.url).pathname; } catch { return tab.url; } })() : undefined,
      requestBody: tab.body || undefined,
      requestHeaders: Object.fromEntries(tab.headers.filter(h => h.key && h.enabled).map(h => [h.key, h.value])),
      responseStatus: tab.response?.status,
      responseBody: tab.response?.body,
      responseContentType: tab.response?.headers?.['content-type'] ?? tab.response?.headers?.['Content-Type'],
    };
    window.dispatchEvent(new CustomEvent('set-ai-context', { detail: ctx }));
  }, [tab?.id, tab?.method, tab?.url, tab?.body, tab?.response]);

  return (
    <div className="flex flex-col flex-1 min-h-0 overflow-hidden">
      {ExplorerHotkeys && (
        <ExplorerHotkeys
          sendRef={sendRef} addTabRef={addTabRef} updRef={updRef}
          tabsRef={tabsRef} activeTabRef={activeTabRef} urlInputRef={urlInputRef}
          setTabs={setTabs} setActiveTabId={setActiveTabId}
          blankTab={blankTab} defaultAuth={DEFAULT_AUTH}
        />
      )}
      {codeOpen && <CodeModal request={codeRequest} onClose={() => setCodeOpen(false)} />}
      {proxyGuideOpen && <ProxyGuideModal onClose={() => setProxyGuideOpen(false)} />}
      {wsModalOpen && activeWs && (
        <WorkspaceModal workspace={activeWs} envs={envs} onSave={saveWs} onDelete={removeWs} onClose={() => setWsModalOpen(false)} />
      )}

      {/* Tab context menu */}
      {ctxMenu && (
        <>
          <div className="fixed inset-0 z-[1999]" onClick={() => setCtxMenu(null)} />
          <div className="ctx-menu" style={{ left: ctxMenu.x, top: ctxMenu.y }}>
            <button className="ctx-item" onClick={() => { duplicateTab(ctxMenu.tabId); setCtxMenu(null); }}>
              <Copy size={12} /> Duplicate
            </button>
            <div className="ctx-sep" />
            <button className="ctx-item" onClick={() => { closeTabById(ctxMenu.tabId); setCtxMenu(null); }}>
              <X size={12} /> Close
            </button>
            <button className="ctx-item" onClick={() => { closeOtherTabs(ctxMenu.tabId); setCtxMenu(null); }}>
              <X size={12} /> Close Others
            </button>
            <button className="ctx-item ctx-danger" onClick={() => { closeAllTabs(); setCtxMenu(null); }}>
              <Trash2 size={12} /> Close All
            </button>
          </div>
        </>
      )}

      {/* Endpoint context menu */}
      {epCtxMenu && (
        <>
          <div className="fixed inset-0 z-[1999]" onClick={() => setEpCtxMenu(null)} />
          <div className="ctx-menu" style={{ left: epCtxMenu.x, top: epCtxMenu.y }}>
            <button className="ctx-item" onClick={() => { openEndpoint(epCtxMenu.op); setEpCtxMenu(null); }}>
              <Plus size={12} /> Open in New Tab
            </button>
            <button className="ctx-item" onClick={() => { navigator.clipboard.writeText(epCtxMenu.op.path).catch(() => {}); setEpCtxMenu(null); }}>
              <Copy size={12} /> Copy Path
            </button>
            <button className="ctx-item" onClick={() => { navigator.clipboard.writeText((baseUrl + epCtxMenu.op.path).replace(/([^:])\/\//g, '$1/')).catch(() => {}); setEpCtxMenu(null); }}>
              <Copy size={12} /> Copy Full URL
            </button>
          </div>
        </>
      )}

      {/* ── Content rows */}
      <div className="flex flex-1 overflow-hidden min-h-0">

        {/* ── Left panel: endpoint tree */}
        {endpointPanelOpen && (
          <div className="w-[240px] min-w-[180px] border-r border-[var(--border)] flex flex-col overflow-hidden bg-[var(--sidebar)] flex-shrink-0">
            {/* Panel header with tab toggle */}
            <div className="flex items-center h-[36px] px-2 border-b border-[var(--border)] flex-shrink-0 gap-0.5">
              <button
                onClick={() => setShowSaved(false)}
                className={cn(
                  'flex items-center gap-1 px-2 h-6 rounded text-[11px] font-medium transition-colors',
                  !showSaved
                    ? 'bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--foreground)]'
                    : 'text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]',
                )}
              >
                Endpoints
                {!showSaved && operations.length > 0 && (
                  <span className="text-[9px] font-mono opacity-60">{operations.length}</span>
                )}
              </button>
              <button
                onClick={() => setShowSaved(true)}
                className={cn(
                  'flex items-center gap-1 px-2 h-6 rounded text-[11px] font-medium transition-colors',
                  showSaved
                    ? 'bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--foreground)]'
                    : 'text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]',
                )}
              >
                <Bookmark size={10} />
                Saved
                {showSaved && savedRequests.length > 0 && (
                  <span className="text-[9px] font-mono opacity-60">{savedRequests.length}</span>
                )}
              </button>
              <div className="flex-1" />
              <button
                onClick={toggleEndpointPanel}
                className="flex items-center justify-center w-6 h-6 rounded text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] transition-colors flex-shrink-0"
                title="Hide panel"
              >
                <PanelLeftClose size={13} />
              </button>
            </div>

            {/* Panel body */}
            {!showSaved ? (
              operations.length > 0
                ? <EndpointTree
                    ops={operations}
                    onSelect={openEndpoint}
                    activeId={activeOpId}
                    onContextMenu={(e, op) => { e.preventDefault(); setEpCtxMenu({ x: e.clientX, y: e.clientY, op }); }}
                  />
                : <div className="empty-state"><span className="text-[12px]">No spec loaded</span></div>
            ) : (
              <div className="flex-1 overflow-y-auto">
                {savedRequests.length === 0 ? (
                  <div className="empty-state">
                    <Bookmark size={20} style={{ opacity: 0.3 }} />
                    <span className="text-[12px]">No saved requests</span>
                    <span className="text-[11px] text-[var(--placeholder-foreground)] text-center px-4">
                      Click <BookmarkPlus size={10} style={{ display: 'inline', verticalAlign: 'middle' }} /> in the URL bar to save
                    </span>
                  </div>
                ) : (
                  <SavedPanel
                    requests={savedRequests}
                    onLoad={loadSavedRequest}
                    onDelete={deleteSavedRequest}
                  />
                )}
              </div>
            )}
          </div>
        )}

        {/* ── Main panel */}
        <div className="flex-1 flex flex-col overflow-hidden min-w-0">

          {/* ── Tab strip */}
          <div className="tab-strip">
            {/* Tabs list */}
            <div className="flex items-stretch flex-1 overflow-x-auto min-w-0">
              {wsTabs.map(t => (
                <div
                  key={t.id}
                  onClick={() => setActiveTabId(t.id)}
                  onContextMenu={e => { e.preventDefault(); setCtxMenu({ x: e.clientX, y: e.clientY, tabId: t.id }); }}
                  className={cn('tab-item group', t.id === activeTabId && 'active')}
                >
                  <span
                    style={{
                      fontSize: 9,
                      fontWeight: 700,
                      letterSpacing: '0.05em',
                      color: MC[t.method] ?? 'var(--muted-foreground)',
                      fontFamily: 'var(--font-mono)',
                      flexShrink: 0,
                    }}
                  >
                    {t.method}
                  </span>
                  <span className="truncate max-w-[100px] text-[12px] leading-none">{t.title}</span>
                  <button
                    onClick={e => closeTab(t.id, e)}
                    className={cn(
                      'ml-0.5 flex items-center justify-center w-3.5 h-3.5 rounded transition-all flex-shrink-0 bg-transparent border-0 cursor-pointer text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                      t.id === activeTabId ? 'opacity-40 hover:opacity-100' : 'opacity-0 group-hover:opacity-60 hover:!opacity-100',
                    )}
                  >
                    <X size={10} />
                  </button>
                </div>
              ))}
              <button
                className="flex items-center justify-center px-2.5 h-full flex-shrink-0 text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] bg-transparent border-0 cursor-pointer transition-colors"
                onClick={addTab}
                title="New tab (Mod+T)"
              >
                <Plus size={13} />
              </button>
            </div>

          </div>

          {/* ── URL bar */}
          <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--background)] flex-shrink-0">
            {/* Unified method + URL container */}
            <div
              className="flex items-center flex-1 min-w-0 rounded-lg overflow-hidden transition-all"
              style={{
                border: '1px solid var(--border)',
                background: 'var(--input-bg)',
                height: 34,
              }}
              onFocusCapture={e => (e.currentTarget.style.borderColor = 'var(--border-focus)')}
              onBlurCapture={e => (e.currentTarget.style.borderColor = 'var(--border)')}
            >
              {/* Method select */}
              <select
                value={tab.method}
                onChange={e => upd(tab.id, { method: e.target.value })}
                style={{
                  color: MC[tab.method] ?? 'var(--foreground)',
                  background: 'transparent',
                  border: 'none',
                  borderRight: '1px solid var(--border)',
                  padding: '0 6px 0 10px',
                  fontFamily: 'GeistMono, ui-monospace, monospace',
                  fontSize: 11,
                  fontWeight: 700,
                  letterSpacing: '0.04em',
                  outline: 'none',
                  cursor: 'pointer',
                  flexShrink: 0,
                  height: '100%',
                  appearance: 'none',
                  minWidth: 58,
                  maxWidth: 74,
                }}
              >
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              {/* URL input */}
              <input
                ref={urlInputRef}
                style={{
                  flex: 1,
                  height: '100%',
                  background: 'transparent',
                  border: 'none',
                  padding: '0 10px',
                  fontSize: 12.5,
                  fontFamily: 'GeistMono, ui-monospace, monospace',
                  color: 'var(--foreground)',
                  outline: 'none',
                  minWidth: 0,
                }}
                placeholder="https://api.example.com/users/{id}"
                value={tab.url}
                onChange={e => {
                  const url = e.target.value;
                  const pathParams = syncPathParams(url, tab.pathParams);
                  upd(tab.id, { url, title: url || 'New Request', pathParams });
                }}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
              />
            </div>
            {/* Intercept rule selector */}
            {interceptRules.length > 0 && (
              <div
                className="flex items-center gap-1 flex-shrink-0 px-2 rounded-lg border transition-colors"
                style={{
                  height: 34,
                  maxWidth: tab.interceptRuleId ? 140 : 90,
                  borderColor: tab.interceptRuleId ? 'var(--accent, #6366f1)' : 'var(--border)',
                  background: tab.interceptRuleId ? 'color-mix(in srgb,var(--accent,#6366f1) 8%,transparent)' : 'var(--input-bg)',
                }}
              >
                <RouteIcon size={10} style={{ color: tab.interceptRuleId ? 'var(--accent, #6366f1)' : 'var(--placeholder-foreground)', flexShrink: 0 }} />
                <select
                  className="bg-transparent border-0 outline-none cursor-pointer font-sans text-[11px] min-w-0 truncate"
                  style={{ color: tab.interceptRuleId ? 'var(--accent, #6366f1)' : 'var(--placeholder-foreground)', maxWidth: '100%' }}
                  value={tab.interceptRuleId ?? ''}
                  onChange={e => upd(tab.id, { interceptRuleId: e.target.value || undefined })}
                  title="Route request via an intercept rule"
                >
                  <option value="">Direct</option>
                  {interceptRules.map(r => (
                    <option key={r.id} value={r.id}>{r.name}{r.target_host ? ` → ${r.target_host}` : ''}</option>
                  ))}
                </select>
              </div>
            )}
            {/* Send button */}
            <button
              onClick={send}
              disabled={tab.loading || !tab.url}
              style={{
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
                gap: 6, height: 34, padding: '0 16px', borderRadius: 8,
                fontSize: 12.5, fontWeight: 600, letterSpacing: '-0.01em',
                background: tab.loading ? 'var(--primary)' : 'var(--primary)',
                color: 'var(--primary-foreground)',
                border: '1px solid var(--primary)',
                cursor: 'pointer', flexShrink: 0, whiteSpace: 'nowrap',
                fontFamily: 'inherit', userSelect: 'none',
                transition: 'all 0.12s', opacity: !tab.url ? 0.4 : 1,
                pointerEvents: !tab.url ? 'none' : 'auto',
              }}
            >
              {tab.loading
                ? <><span className="spinner" style={{ width: 11, height: 11 }} /> Sending…</>
                : <><Send size={12} /> Send</>}
            </button>
            {/* Ask AI */}
            <button
              title="Ask AI (contextual)"
              onClick={() => window.dispatchEvent(new CustomEvent('open-ai-panel'))}
              className="flex items-center justify-center w-[30px] h-[30px] rounded-md border border-[var(--border)] bg-transparent text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_8%,transparent)] hover:border-[color-mix(in_srgb,var(--accent)_40%,transparent)] flex-shrink-0 transition-colors cursor-pointer"
            >
              <Sparkles size={13} />
            </button>
            {/* ⋯ More actions */}
            <div className="relative flex-shrink-0">
              <button
                className={cn(
                  'flex items-center justify-center w-[30px] h-[30px] rounded-md border transition-colors flex-shrink-0',
                  moreOpen
                    ? 'border-[var(--border-hover)] bg-[var(--elevated)] text-[var(--foreground)]'
                    : 'border-[var(--border)] bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border-hover)]'
                )}
                onClick={() => setMoreOpen(v => !v)}
                title="More actions"
              >
                <MoreHorizontal size={14} />
              </button>

              {moreOpen && (
                <>
                  <div className="fixed inset-0 z-[1999]" onClick={() => setMoreOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-[2000] rounded-lg border border-[var(--border)] bg-[var(--popover)] shadow-lg py-1 min-w-[200px]">
                    {/* Code */}
                    <button
                      className="ctx-item"
                      onClick={() => { setCodeOpen(true); setMoreOpen(false); }}
                      disabled={!tab.url}
                    >
                      <Code2 size={13} />
                      <span>Copy as code</span>
                      <span className="ml-auto text-[10px] font-mono text-[var(--placeholder-foreground)]">cURL · fetch</span>
                    </button>
                    {/* Save */}
                    <button
                      className="ctx-item"
                      onClick={() => { setSavePopup(p => ({ ...p, open: true, name: p.name || tab.title })); setMoreOpen(false); }}
                      disabled={!tab.url}
                    >
                      <BookmarkPlus size={13} />
                      <span>Save request</span>
                    </button>
                    {/* Share */}
                    <button
                      className="ctx-item"
                      onClick={() => { shareRequest(); setMoreOpen(false); }}
                      disabled={!tab.url}
                      style={{ color: shareCopied ? 'var(--success,#22c55e)' : undefined }}
                    >
                      {shareCopied ? <Check size={13} /> : <Share2 size={13} />}
                      <span>{shareCopied ? 'Copied!' : 'Share request'}</span>
                    </button>
                    <div className="ctx-sep" />
                    {/* Settings */}
                    <button
                      className={cn('ctx-item', (tab.timeout > 0 || !tab.followRedirects) && 'text-[var(--accent)]')}
                      onClick={() => { setReqSettingsOpen(v => !v); setMoreOpen(false); }}
                    >
                      <SlidersHorizontal size={13} />
                      <span>Request settings</span>
                      {(tab.timeout > 0 || !tab.followRedirects) && (
                        <span className="ml-auto text-[9px] bg-[var(--accent-dim)] text-[var(--accent)] rounded px-1">custom</span>
                      )}
                    </button>
                    {/* Reset */}
                    <button
                      className="ctx-item"
                      onClick={() => { upd(tab.id, { response: null, url: '', title: 'New Request', params: [{ key: '', value: '', enabled: true }], pathParams: [], headers: [{ key: '', value: '', enabled: true }], body: '', bodyType: 'none', rawType: 'text/plain', binaryFile: null, formRows: [{ key: '', value: '', enabled: true, kind: 'text' }], auth: { ...DEFAULT_AUTH }, testResults: null }); setMoreOpen(false); }}
                    >
                      <RotateCcw size={13} />
                      <span>Reset request</span>
                    </button>
                    <div className="ctx-sep" />
                    {/* Proxy guide */}
                    <button
                      className="ctx-item"
                      onClick={() => { setProxyGuideOpen(true); setMoreOpen(false); }}
                    >
                      <Info size={13} />
                      <span>Proxy &amp; intercept guide</span>
                    </button>
                  </div>
                </>
              )}

              {/* Save popup (triggered from More menu) */}
              {savePopup.open && (
                <>
                  <div className="fixed inset-0 z-[1999]" onClick={() => setSavePopup(p => ({ ...p, open: false }))} />
                  <div
                    className="absolute right-0 top-full mt-1 z-[2000] rounded-lg border border-[var(--border)] bg-[var(--background)] shadow-lg"
                    style={{ width: 260, padding: '12px 14px' }}
                  >
                    <div className="text-[11px] font-semibold text-[var(--foreground)] mb-2">Save Request</div>
                    <input
                      className="input w-full h-7 text-[12px] mb-2"
                      placeholder="Name"
                      value={savePopup.name}
                      onChange={e => setSavePopup(p => ({ ...p, name: e.target.value }))}
                      autoFocus
                      onKeyDown={e => { if (e.key === 'Enter') saveCurrentRequest(); if (e.key === 'Escape') setSavePopup(p => ({ ...p, open: false })); }}
                    />
                    <input
                      className="input w-full h-7 text-[12px] mb-3"
                      placeholder="Folder (optional)"
                      value={savePopup.folder}
                      onChange={e => setSavePopup(p => ({ ...p, folder: e.target.value }))}
                      onKeyDown={e => { if (e.key === 'Enter') saveCurrentRequest(); if (e.key === 'Escape') setSavePopup(p => ({ ...p, open: false })); }}
                    />
                    <div className="flex gap-2 justify-end">
                      <button className="btn btn-ghost btn-sm" onClick={() => setSavePopup(p => ({ ...p, open: false }))}>Cancel</button>
                      <button className="btn btn-primary btn-sm" onClick={saveCurrentRequest}>Save</button>
                    </div>
                  </div>
                </>
              )}

              {/* Request settings popup (triggered from More menu) */}
              {reqSettingsOpen && (
                <>
                  <div className="fixed inset-0 z-[1999]" onClick={() => setReqSettingsOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 z-[2000] rounded-lg border border-[var(--border)] bg-[var(--popover)] shadow-lg" style={{ width: 240, padding: '12px 14px' }}>
                    <div className="text-[11px] font-semibold text-[var(--foreground)] mb-3">Request Settings</div>
                    <div className="flex flex-col gap-3">
                      <label className="flex flex-col gap-1">
                        <span className="text-[11px] text-[var(--muted-foreground)]">Timeout (ms, 0 = global default)</span>
                        <input
                          className="input h-7 text-[12px] font-mono w-full"
                          type="number" min="0" step="1000"
                          value={tab.timeout}
                          onChange={e => upd(tab.id, { timeout: Math.max(0, Number(e.target.value)) })}
                          placeholder="0"
                        />
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer select-none">
                        <input type="checkbox" checked={tab.followRedirects} onChange={e => upd(tab.id, { followRedirects: e.target.checked })} className="checkbox" />
                        <span className="text-[12px] text-[var(--foreground)]">Follow redirects</span>
                      </label>
                    </div>
                  </div>
                </>
              )}
            </div>
          </div>

          {/* ── Sub-tabs + destination info (inline right side) */}
          <div className="sub-tab-bar">
            {(['params', 'headers', ...(hasBody ? ['body'] : []), 'auth', 'cookies', 'payload', 'tests'] as ReqTab[]).map(v => {
              const badge = v === 'params' ? paramCount : v === 'headers' ? headerCount : 0;
              const dot = v === 'auth' && hasAuth;
              return (
                <button key={v} className={cn('sub-tab', reqTab === v && 'active')} onClick={() => setReqTab(v)}>
                  {v === 'cookies' && <Cookie size={10} />}
                  {v === 'auth' && <Lock size={10} />}
                  {v === 'payload' && <Eye size={10} />}
                  {v === 'tests' && <FlaskConical size={10} />}
                  {v.charAt(0).toUpperCase() + v.slice(1)}
                  {badge > 0 && <span className="inline-flex items-center justify-center min-w-[14px] h-[14px] px-0.5 rounded bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-[var(--muted-foreground)] text-[9px] font-mono leading-none">{badge}</span>}
                  {dot && <span className="w-1 h-1 rounded-full bg-[var(--foreground)] opacity-50 flex-shrink-0" />}
                  {v === 'tests' && tab.testResults !== null && (() => {
                    const p = tab.testResults.filter(r => r.passed).length;
                    const f = tab.testResults.filter(r => !r.passed).length;
                    return f > 0
                      ? <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-[var(--destructive)]"><XCircle size={9} />{f}</span>
                      : p > 0 ? <span className="inline-flex items-center gap-0.5 text-[9px] font-mono text-[var(--success,#22c55e)]"><CheckCircle2 size={9} />{p}</span>
                      : null;
                  })()}
                </button>
              );
            })}

            {/* Request destination info */}
            {domain && (
              <div className="ml-auto flex items-center self-stretch border-l border-[var(--border)] pl-2.5 pr-3 gap-1.5 flex-shrink-0">
                <span className="text-[10px] text-[var(--placeholder-foreground)]">→</span>
                <span className="text-[11px] font-mono text-[var(--muted-foreground)] truncate max-w-[200px]" title={domain}>{domain}</span>
                {tab.interceptRuleId && interceptRules.find(r => r.id === tab.interceptRuleId) && (
                  <>
                    <span className="text-[10px] text-[var(--placeholder-foreground)]">via</span>
                    <span className="text-[10.5px] font-medium truncate max-w-[100px]" style={{ color: 'var(--accent, #6366f1)' }}>
                      {interceptRules.find(r => r.id === tab.interceptRuleId)!.name}
                    </span>
                  </>
                )}
              </div>
            )}
          </div>

          {/* ── Resizable split */}
          <div ref={containerRef} className={cn('flex-1 overflow-hidden', splitDir === 'v' ? 'flex flex-col' : 'flex flex-row')}>

            {/* Request panel */}
            <div
              className="flex flex-col overflow-hidden"
              style={splitDir === 'v' ? { height: `${splitPct * 100}%` } : { width: `${splitPct * 100}%` }}
            >
              <div className={cn('flex-1 overflow-auto', reqTab !== 'body' && reqTab !== 'payload' && reqTab !== 'tests' && 'p-3')}>

                {reqTab === 'params' && (
                  <div className="flex flex-col gap-0">
                    {hasPathParams && (
                      <>
                        <div className="flex items-center gap-2 mb-2">
                          <span className="text-[11px] font-semibold text-[var(--foreground)] opacity-60 tracking-wide">PATH</span>
                          <div className="flex-1 h-px bg-[var(--border)]" />
                          <span className="text-[10.5px] text-[var(--muted-foreground)] opacity-60">from URL template</span>
                        </div>
                        <KVTable rows={tab.pathParams} onChange={p => upd(tab.id, { pathParams: p })} ph={['param', 'value']} readOnlyKey />
                        <div className="flex items-center gap-2 mt-4 mb-2">
                          <span className="text-[11px] font-semibold text-[var(--foreground)] opacity-60 tracking-wide">QUERY</span>
                          <div className="flex-1 h-px bg-[var(--border)]" />
                        </div>
                      </>
                    )}
                    <KVTable rows={tab.params} onChange={p => upd(tab.id, { params: p })} ph={['parameter', 'value']} />
                  </div>
                )}

                {reqTab === 'headers' && (
                  <KVTable
                    rows={tab.headers} onChange={h => upd(tab.id, { headers: h })} ph={['Header', 'Value']}
                    keySuggestions={COMMON_HEADERS}
                    valueSuggestions={key => HEADER_VALUE_SUGGESTIONS[key.toLowerCase()] ?? []}
                  />
                )}

                {reqTab === 'body' && hasBody && (
                  <div className="flex flex-col h-full">
                    <div className="flex items-center gap-1 px-2 h-[36px] border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
                      {(['none', 'json', 'form', 'multipart', 'raw', 'binary'] as const).map(bt => (
                        <button key={bt}
                          className={cn('btn btn-ghost btn-sm text-[11.5px]', tab.bodyType === bt && 'bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] text-[var(--foreground)] border-[var(--border-strong)]')}
                          onClick={() => upd(tab.id, { bodyType: bt })}>
                          {bt === 'none' ? 'None' : bt === 'json' ? 'JSON' : bt === 'form' ? 'Form URL' : bt === 'multipart' ? 'Multipart' : bt === 'raw' ? 'Raw' : 'Binary'}
                        </button>
                      ))}
                      {tab.bodyType === 'raw' && (
                        <select className="select h-6 w-[130px] ml-auto text-[11px]" value={tab.rawType} onChange={e => upd(tab.id, { rawType: e.target.value })}>
                          {RAW_BODY_TYPES.map(rt => <option key={rt.mime} value={rt.mime}>{rt.label}</option>)}
                        </select>
                      )}
                    </div>
                    {tab.bodyType === 'none' && <div className="empty-state text-[12px]">No body</div>}
                    {tab.bodyType === 'json' && <JsonEditor value={tab.body} onChange={v => upd(tab.id, { body: v })} placeholder={'{\n  "key": "value"\n}'} />}
                    {tab.bodyType === 'form' && (
                      <div className="p-3 flex flex-col gap-3">
                        <FormDataTable rows={tab.formRows} onChange={rows => upd(tab.id, { formRows: rows })} allowFiles={false} />
                        <p className="text-[11px] text-[var(--placeholder-foreground)]">Sent as <code className="font-mono">application/x-www-form-urlencoded</code></p>
                      </div>
                    )}
                    {tab.bodyType === 'multipart' && (
                      <div className="p-3 flex flex-col gap-3">
                        <FormDataTable rows={tab.formRows} onChange={rows => upd(tab.id, { formRows: rows })} allowFiles />
                        <p className="text-[11px] text-[var(--placeholder-foreground)]">Sent as <code className="font-mono">multipart/form-data</code> — switch a row to <strong>File</strong> to upload files (max 20 MB each)</p>
                      </div>
                    )}
                    {tab.bodyType === 'raw' && (
                      <textarea className="textarea flex-1 rounded-none border-0 resize-none text-[12px] font-mono" placeholder={`Request body… (${tab.rawType})`} value={tab.body} onChange={e => upd(tab.id, { body: e.target.value })} />
                    )}
                    {tab.bodyType === 'binary' && (
                      <div className="p-4 flex flex-col gap-3 items-start">
                        <button className="btn btn-ghost gap-2 border border-dashed border-[var(--border)] px-4 py-3 text-[12.5px]"
                          onClick={() => { const input = document.createElement('input'); input.type = 'file'; input.onchange = async () => { const f = input.files?.[0]; if (!f) return; if (f.size > 20 * 1048576) { alert('Files over 20 MB are not supported.'); return; } upd(tab.id, { binaryFile: await fileToPayload(f) }); }; input.click(); }}>
                          <FileUp size={14} />
                          {tab.binaryFile ? `${tab.binaryFile.name} (${fmtSize(tab.binaryFile.size)})` : 'Choose file…'}
                        </button>
                        {tab.binaryFile && (
                          <div className="flex items-center gap-2 text-[11.5px] text-[var(--placeholder-foreground)]">
                            <span>Content-Type: <code className="font-mono">{tab.binaryFile.mime}</code> (override in Headers)</span>
                            <button className="btn btn-ghost btn-sm text-[11px]" onClick={() => upd(tab.id, { binaryFile: null })}>Remove</button>
                          </div>
                        )}
                      </div>
                    )}
                  </div>
                )}

                {reqTab === 'auth' && (
                  <AuthPanel auth={tab.auth} onChange={a => upd(tab.id, { auth: a })} inheritedFrom={activeWs ? { name: activeWs.name, type: activeWs.auth.type } : null} />
                )}
                {reqTab === 'cookies' && <CookiesPanel domain={domain} />}
                {reqTab === 'payload' && <PayloadPanel tab={tab} activeEnv={activeEnv} ws={activeWs} />}
                {reqTab === 'tests' && (
                  <TestsPanel
                    code={tab.tests}
                    onChange={v => upd(tab.id, { tests: v })}
                    results={tab.testResults}
                  />
                )}
              </div>
            </div>

            {/* Resize handle */}
            <div
              className={cn(splitDir === 'v' ? 'resize-handle-y' : 'resize-handle-x', dragging && 'dragging')}
              onMouseDown={startResize}
            />

            {/* ── Response panel */}
            <div className={cn('flex-1 flex flex-col overflow-hidden', splitDir === 'v' ? 'border-t border-[var(--border)]' : 'border-l border-[var(--border)]')}>
              <ResponsePanel response={tab.response} loading={tab.loading} />
            </div>
          </div>
        </div>

      </div>

      {/* ── Status bar */}
      <div className="status-bar">
        <button
          className={cn('status-bar-item', !endpointPanelOpen && 'text-[var(--accent)]')}
          onClick={toggleEndpointPanel}
          title={(endpointPanelOpen ? 'Hide' : 'Show') + ' endpoint panel'}
        >
          {endpointPanelOpen ? <PanelLeftClose size={11} /> : <PanelLeftOpen size={11} />}
        </button>
        <div className="status-bar-sep" />
        <button className="status-bar-item" onClick={() => setWsModalOpen(true)} title="Workspace settings">
          {activeWs?.color && <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: activeWs.color }} />}
          <span>{activeWs?.name ?? 'Personal'}</span>
        </button>
        <div className="status-bar-sep" />
        {activeEnv ? (
          <button className="status-bar-item">
            <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: activeEnv.color }} />
            <span>{activeEnv.name}</span>
          </button>
        ) : (
          <span className="status-bar-item" style={{ opacity: 0.5, cursor: 'default' }}>No env</span>
        )}
        <div className="status-bar-sep" />
        {tab.response && !tab.loading && (
          <>
            <span className={cn('status-bar-item', scClass(tab.response.status))} style={{ cursor: 'default', fontWeight: 600 }}>
              {tab.response.status}
            </span>
            <span className="status-bar-item" style={{ cursor: 'default' }}>{tab.response.latency}ms</span>
            <span className="status-bar-item" style={{ cursor: 'default' }}>{fmtSize(tab.response.size)}</span>
          </>
        )}
        <div className="flex-1 min-w-0" />
        {/* Split layout toggle */}
        <div className="flex items-center gap-px">
          <button
            className={cn('status-bar-item', splitDir === 'v' && 'text-[var(--accent)]')}
            onClick={() => changeSplitDir('v')}
            title="Vertical split (stacked)"
          >
            <Rows2 size={11} />
          </button>
          <button
            className={cn('status-bar-item', splitDir === 'h' && 'text-[var(--accent)]')}
            onClick={() => changeSplitDir('h')}
            title="Horizontal split (side by side)"
          >
            <Columns2 size={11} />
          </button>
        </div>
        <div className="status-bar-sep" />
        {operations.length > 0 && (
          <span className="status-bar-item" style={{ cursor: 'default' }}>{operations.length} endpoints</span>
        )}
        <div className="status-bar-sep" />
        <Link to="/ai" className="status-bar-item no-underline">
          <Bot size={11} /> AI
        </Link>
      </div>
    </div>
  );
}
