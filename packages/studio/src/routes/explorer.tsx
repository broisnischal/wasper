import { createFileRoute, Link } from '@tanstack/react-router';
import { useState, useEffect, useCallback, useRef } from 'react';
import { apiClient } from '../lib/api';
import { cacheGet, cacheSet } from '../lib/cache';
import { JsonViewer } from '../components/JsonViewer';
import { cn } from '../lib/utils';
import { useApp } from '../context';
import { resolveVars, type Environment } from '../lib/env';
import { dbGet, dbPut, dbGetAll, dbDel } from '../lib/storage';
import {
  Search, Plus, X, Send, Copy, Check, ChevronRight, ChevronDown,
  RotateCcw, Download, Bot, Folder, FolderOpen, Cookie, Eye, Lock,
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
interface KVRow { key: string; value: string; enabled: boolean; }
interface ResponseResult {
  status: number; statusText: string; headers: Record<string, string>;
  body: string; latency: number; size: number; error?: string;
}
interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'apikey';
  bearer: string;
  basicUser: string;
  basicPass: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query';
}
interface RequestTab {
  id: string; title: string; method: string; url: string;
  params: KVRow[];
  pathParams: KVRow[];
  headers: KVRow[];
  body: string;
  bodyType: 'none' | 'json' | 'form' | 'multipart' | 'raw';
  formRows: KVRow[];
  auth: AuthConfig;
  response: ResponseResult | null;
  loading: boolean;
}
interface CookieEntry {
  id: string; name: string; value: string; domain: string; path: string; enabled: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────
const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;
const MC: Record<string, string> = {
  GET: 'var(--method-get)', POST: 'var(--method-post)', PUT: 'var(--method-put)',
  PATCH: '#a855f7', DELETE: 'var(--method-delete)', HEAD: 'var(--method-head)',
  OPTIONS: 'var(--method-head)',
};

const DEFAULT_AUTH: AuthConfig = {
  type: 'none', bearer: '', basicUser: '', basicPass: '',
  apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header',
};

let _seq = 0;
function uid() { return String(++_seq); }

function blankTab(overrides?: Partial<RequestTab>): RequestTab {
  return {
    id: uid(), title: 'New Request', method: 'GET', url: '',
    params: [{ key: '', value: '', enabled: true }],
    pathParams: [],
    headers: [{ key: '', value: '', enabled: true }],
    body: '', bodyType: 'none',
    formRows: [{ key: '', value: '', enabled: true }],
    auth: { ...DEFAULT_AUTH },
    response: null, loading: false,
    ...overrides,
  };
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

function buildAuthHeaders(auth: AuthConfig): Record<string, string> {
  if (auth.type === 'bearer' && auth.bearer) return { Authorization: `Bearer ${auth.bearer}` };
  if (auth.type === 'basic' && (auth.basicUser || auth.basicPass)) {
    return { Authorization: `Basic ${btoa(`${auth.basicUser}:${auth.basicPass}`)}` };
  }
  if (auth.type === 'apikey' && auth.apiKeyIn === 'header' && auth.apiKeyName) {
    return { [auth.apiKeyName]: auth.apiKeyValue };
  }
  return {};
}

function buildAuthQueryParams(auth: AuthConfig): KVRow[] {
  if (auth.type === 'apikey' && auth.apiKeyIn === 'query' && auth.apiKeyName) {
    return [{ key: auth.apiKeyName, value: auth.apiKeyValue, enabled: true }];
  }
  return [];
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

// ── KV Table ───────────────────────────────────────────────────────────────
function KVTable({ rows, onChange, ph = ['Key', 'Value'], readOnlyKey = false }: {
  rows: KVRow[]; onChange: (r: KVRow[]) => void; ph?: [string, string]; readOnlyKey?: boolean;
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
            className="flex-shrink-0 w-3.5 h-3.5 accent-[var(--accent)]"
          />
          {readOnlyKey ? (
            <div className="flex items-center h-7 px-2.5 rounded-md bg-[var(--elevated)] border border-[var(--border)] flex-1 min-w-0">
              <span className="font-mono text-[12px] text-[var(--foreground)] truncate">{row.key}</span>
            </div>
          ) : (
            <input
              className="input flex-1 h-7 text-[12.5px] font-mono"
              placeholder={ph[0]} value={row.key}
              onChange={e => upd(i, 'key', e.target.value)}
            />
          )}
          <input
            className="input flex-[2] h-7 text-[12.5px] font-mono"
            placeholder={ph[1]} value={row.value}
            onChange={e => upd(i, 'value', e.target.value)}
          />
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

// ── JSON Editor ─────────────────────────────────────────────────────────────
function JsonEditor({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const { theme } = useApp();
  const [html, setHtml] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const hlRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let text = value;
    if (!text.trim()) { setHtml(''); return; }
    import('shiki').then(({ createHighlighter }) =>
      createHighlighter({ themes: ['github-dark-dimmed', 'github-light'], langs: ['json'] })
    ).then(hl => {
      try { text = JSON.stringify(JSON.parse(text), null, 2); } catch { /* keep raw */ }
      setHtml(hl.codeToHtml(text, { lang: 'json', theme: theme === 'light' ? 'github-light' : 'github-dark-dimmed' }));
    }).catch(() => setHtml(''));
  }, [value, theme]);

  const syncScroll = () => {
    if (taRef.current && hlRef.current) {
      const pre = hlRef.current.querySelector('pre');
      if (pre) { pre.scrollTop = taRef.current.scrollTop; pre.scrollLeft = taRef.current.scrollLeft; }
    }
  };

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-3 py-1.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        <span className="text-[11px] text-[var(--placeholder-foreground)] font-mono">JSON</span>
        <button className="btn btn-ghost btn-sm text-[11px] ml-auto h-6 px-2" onClick={() => { try { onChange(JSON.stringify(JSON.parse(value), null, 2)); } catch { /**/ } }}>Format</button>
      </div>
      <div className="relative flex-1 overflow-hidden">
        <div ref={hlRef} className="shiki-wrap pointer-events-none absolute inset-0 overflow-hidden"
          dangerouslySetInnerHTML={{ __html: html || `<pre style="margin:0;padding:12px 16px;font-family:GeistMono,monospace;font-size:12.5px;line-height:1.65;color:var(--placeholder-foreground)">${placeholder ?? ''}</pre>` }} />
        <textarea
          ref={taRef} value={value} onChange={e => onChange(e.target.value)} onScroll={syncScroll} spellCheck={false}
          style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', background: 'transparent', color: html ? 'transparent' : 'var(--foreground)', caretColor: 'var(--foreground)', border: 'none', outline: 'none', resize: 'none', padding: '12px 16px', fontFamily: 'GeistMono, ui-monospace, monospace', fontSize: 12.5, lineHeight: 1.65, zIndex: 1 }}
          placeholder={placeholder}
        />
      </div>
    </div>
  );
}

// ── Auth Panel ─────────────────────────────────────────────────────────────
function AuthPanel({ auth, onChange }: { auth: AuthConfig; onChange: (a: AuthConfig) => void }) {
  const upd = (patch: Partial<AuthConfig>) => onChange({ ...auth, ...patch });
  return (
    <div className="flex flex-col gap-4">
      <div>
        <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Auth type</label>
        <select className="select h-8 w-full text-[12.5px]" value={auth.type} onChange={e => upd({ type: e.target.value as AuthConfig['type'] })}>
          <option value="none">No auth</option>
          <option value="bearer">Bearer token</option>
          <option value="basic">Basic auth</option>
          <option value="apikey">API key</option>
        </select>
      </div>

      {auth.type === 'bearer' && (
        <div>
          <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Token</label>
          <input className="input h-8 w-full font-mono text-[12.5px]" placeholder="eyJhbGciOi…" value={auth.bearer} onChange={e => upd({ bearer: e.target.value })} />
          <p className="mt-1.5 text-[11px] text-[var(--placeholder-foreground)]">
            Sends <code className="font-mono">Authorization: Bearer {'<token>'}</code>
          </p>
        </div>
      )}

      {auth.type === 'basic' && (
        <div className="flex flex-col gap-2.5">
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Username</label>
            <input className="input h-8 w-full text-[12.5px]" placeholder="username" value={auth.basicUser} onChange={e => upd({ basicUser: e.target.value })} />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Password</label>
            <input className="input h-8 w-full text-[12.5px]" type="password" placeholder="••••••••" value={auth.basicPass} onChange={e => upd({ basicPass: e.target.value })} />
          </div>
          <p className="text-[11px] text-[var(--placeholder-foreground)]">
            Sends <code className="font-mono">Authorization: Basic {'<base64>'}</code>
          </p>
        </div>
      )}

      {auth.type === 'apikey' && (
        <div className="flex flex-col gap-2.5">
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Key name</label>
            <input className="input h-8 w-full font-mono text-[12.5px]" placeholder="X-API-Key" value={auth.apiKeyName} onChange={e => upd({ apiKeyName: e.target.value })} />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-1.5">Value</label>
            <input className="input h-8 w-full font-mono text-[12.5px]" placeholder="your-api-key" value={auth.apiKeyValue} onChange={e => upd({ apiKeyValue: e.target.value })} />
          </div>
          <div>
            <label className="block text-[11.5px] font-medium text-[var(--muted-foreground)] mb-2">Add to</label>
            <div className="flex gap-1.5">
              {(['header', 'query'] as const).map(loc => (
                <button key={loc}
                  className={cn('btn btn-ghost btn-sm flex-1 text-[12px]', auth.apiKeyIn === loc && 'bg-[var(--primary-dim)] text-[var(--primary)]')}
                  onClick={() => upd({ apiKeyIn: loc })}>
                  {loc === 'header' ? 'Header' : 'Query param'}
                </button>
              ))}
            </div>
          </div>
        </div>
      )}

      {auth.type === 'none' && (
        <p className="text-[12px] text-[var(--placeholder-foreground)]">
          No authentication will be added to this request.
        </p>
      )}
    </div>
  );
}

// ── Payload Preview Panel ──────────────────────────────────────────────────
function PayloadPanel({ tab, activeEnv }: { tab: RequestTab; activeEnv: Environment | null }) {
  const resolve = (s: string) => resolveVars(s, activeEnv);
  const resolvedPathUrl = replacePaths(resolve(tab.url), tab.pathParams);
  const authQueryRows = buildAuthQueryParams(tab.auth);
  const allQueryParams = [...tab.params, ...authQueryRows];
  const fullUrl = buildUrl(resolvedPathUrl, allQueryParams.filter(p => p.enabled && p.key).map(p => ({ ...p, value: resolve(p.value) })));
  const methodColor = MC[tab.method] ?? 'var(--foreground)';

  const headers: [string, string][] = [];
  for (const h of tab.headers) { if (h.enabled && h.key) headers.push([h.key, resolve(h.value)]); }
  const authHdrs = buildAuthHeaders({
    ...tab.auth,
    bearer: resolve(tab.auth.bearer),
    basicUser: resolve(tab.auth.basicUser),
    basicPass: resolve(tab.auth.basicPass),
    apiKeyValue: resolve(tab.auth.apiKeyValue),
  });
  for (const [k, v] of Object.entries(authHdrs)) {
    if (!headers.some(([hk]) => hk.toLowerCase() === k.toLowerCase())) headers.push([k, v]);
  }
  if (tab.bodyType === 'json' && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/json']);
  if (tab.bodyType === 'form' && !headers.some(([k]) => k.toLowerCase() === 'content-type')) headers.push(['Content-Type', 'application/x-www-form-urlencoded']);

  let bodyText = '';
  if (tab.bodyType === 'json') { try { bodyText = JSON.stringify(JSON.parse(resolve(tab.body)), null, 2); } catch { bodyText = resolve(tab.body); } }
  else if (tab.bodyType === 'form') bodyText = tab.formRows.filter(r => r.enabled && r.key).map(r => `${encodeURIComponent(r.key)}=${encodeURIComponent(resolve(r.value))}`).join('&');
  else if (tab.bodyType === 'raw') bodyText = resolve(tab.body);

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
        {bodyText && (
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
          <input type="checkbox" checked={c.enabled} onChange={e => upd(i, { enabled: e.target.checked })} className="flex-shrink-0 w-3.5 h-3.5 accent-[var(--accent)]" />
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
function EndpointTree({ ops, onSelect, activeId }: {
  ops: ParsedOperation[]; onSelect: (op: ParsedOperation) => void; activeId?: string;
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

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="px-2.5 py-2 border-b border-[var(--border)] flex-shrink-0">
        <div className="relative">
          <Search size={12} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--placeholder-foreground)] pointer-events-none" />
          <input className="input w-full h-7 pl-7 text-[12px]" placeholder="Search…" value={search} onChange={e => setSearch(e.target.value)} />
        </div>
        <div className="text-[10.5px] text-[var(--placeholder-foreground)] mt-1.5 px-0.5">{filtered.length} of {ops.length}</div>
      </div>
      <div className="flex-1 overflow-y-auto py-1">
        {Object.entries(groups).map(([tag, tagOps]) => (
          <div key={tag}>
            <button onClick={() => setCollapsed(c => ({ ...c, [tag]: !c[tag] }))}
              className="flex items-center gap-1.5 w-full px-2.5 py-1.5 bg-transparent border-0 cursor-pointer text-[var(--muted-foreground)] text-[10.5px] font-semibold tracking-widest uppercase font-sans hover:text-[var(--foreground)] transition-colors">
              {collapsed[tag] ? <ChevronRight size={10} className="flex-shrink-0 opacity-50" /> : <ChevronDown size={10} className="flex-shrink-0 opacity-50" />}
              {collapsed[tag] ? <Folder size={11} className="flex-shrink-0 text-[var(--placeholder-foreground)]" /> : <FolderOpen size={11} className="flex-shrink-0 opacity-60" style={{ color: 'var(--primary)' }} />}
              <span className="flex-1 text-left truncate">{tag}</span>
              <span className="bg-[var(--elevated)] text-[var(--placeholder-foreground)] rounded px-1 text-[9.5px]">{tagOps.length}</span>
            </button>
            {!collapsed[tag] && tagOps.map(op => (
              <button key={op.operationId} onClick={() => onSelect(op)} className={cn('endpoint-item', activeId === op.operationId && 'active')}>
                <span className={`method-badge method-${op.method.toUpperCase()}`}>{op.method.toUpperCase()}</span>
                <span className={cn('text-[12px] overflow-hidden text-ellipsis whitespace-nowrap flex-1', activeId === op.operationId ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)]')}>
                  {op.path}
                </span>
              </button>
            ))}
          </div>
        ))}
        {filtered.length === 0 && <div className="empty-state"><Search size={20} /><span className="text-[12px]">No endpoints found</span></div>}
      </div>
    </div>
  );
}

// ── Response Panel ─────────────────────────────────────────────────────────
function ResponsePanel({ response, loading }: { response: ResponseResult | null; loading: boolean }) {
  type RespView = 'body' | 'headers' | 'cookies' | 'raw' | 'preview';
  const [view, setView] = useState<RespView>('body');
  const [copied, setCopied] = useState(false);

  const copy = () => {
    if (!response) return;
    navigator.clipboard.writeText(response.body);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  const contentType = response?.headers['content-type'] ?? response?.headers['Content-Type'] ?? '';
  const isHtml = contentType.includes('text/html');

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
    ...(isHtml ? [{ id: 'preview' as RespView, label: 'Preview' }] : []),
  ];

  return (
    <div className="flex-1 flex flex-col overflow-hidden">
      <div className="flex items-center gap-3 px-3 h-9 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
        <span className={cn('font-bold text-[12.5px] font-mono', scClass(response.status))}>
          {response.status} {response.statusText}
        </span>
        <span className="text-[11.5px] text-[var(--placeholder-foreground)]">{response.latency}ms</span>
        <span className="text-[11.5px] text-[var(--placeholder-foreground)]">{fmtSize(response.size)}</span>
        <div className="ml-auto flex gap-1">
          <button className="btn btn-ghost btn-sm btn-icon" onClick={copy} title="Copy response">
            {copied ? <Check size={12} className="text-[var(--primary)]" /> : <Copy size={12} />}
          </button>
          <a href={`data:text/plain;charset=utf-8,${encodeURIComponent(response.body)}`} download="response.txt"
            className="btn btn-ghost btn-sm btn-icon" title="Download">
            <Download size={12} />
          </a>
        </div>
      </div>

      <div className="sub-tab-bar flex-shrink-0 pl-2">
        {tabs.map(t => (
          <button key={t.id} className={cn('sub-tab', view === t.id && 'active')} onClick={() => setView(t.id)}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto flex flex-col">
        {view === 'body' && <JsonViewer text={response.body} />}

        {view === 'headers' && (
          <div className="p-3">
            {Object.entries(response.headers).map(([k, v]) => (
              <div key={k} className="flex gap-3 py-1.5 border-b border-[var(--border)] text-[12px] last:border-0">
                <span className="font-mono text-[var(--muted-foreground)] min-w-[180px] flex-shrink-0">{k}</span>
                <span className="text-[var(--foreground)] break-all">{v}</span>
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
            {response.body}
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
      </div>
    </div>
  );
}

// ── Main Page ──────────────────────────────────────────────────────────────
function ExplorerPage() {
  const { envs, activeEnvId } = useApp();
  const activeEnv = envs.find(e => e.id === activeEnvId) ?? null;

  const [tabs, setTabs] = useState<RequestTab[]>(() => [blankTab()]);
  const [activeTabId, setActiveTabId] = useState<string>(() => tabs[0]!.id);
  const [dbLoaded, setDbLoaded] = useState(false);
  const [operations, setOperations] = useState<ParsedOperation[]>([]);
  const [baseUrl, setBaseUrl] = useState('');
  const [activeOpId, setActiveOpId] = useState<string | undefined>();
  type ReqTab = 'params' | 'headers' | 'body' | 'auth' | 'cookies' | 'payload';
  const [reqTab, setReqTab] = useState<ReqTab>('params');
  const [splitPct, setSplitPct] = useState(0.45);
  const [dragging, setDragging] = useState(false);
  const [ExplorerHotkeys, setExplorerHotkeys] = useState<typeof import('../components/ExplorerHotkeys').ExplorerHotkeys | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);

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

  // ── Load from IndexedDB on mount ──────────────────────────────────────────
  useEffect(() => {
    dbGet<{ id: string; tabs: RequestTab[]; activeTabId: string }>('explorer', 'state')
      .then(saved => {
        if (saved?.tabs?.length) {
          // Merge with blankTab defaults so old saved tabs get new fields (pathParams, auth)
          const loaded = saved.tabs.map(t => ({
            ...blankTab(),
            ...t,
            loading: false,
            pathParams: Array.isArray(t.pathParams) ? t.pathParams : syncPathParams(t.url ?? '', []),
            auth: t.auth ? { ...DEFAULT_AUTH, ...t.auth } : { ...DEFAULT_AUTH },
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
    const next = tabs.filter(t => t.id !== id);
    if (!next.length) { const fresh = blankTab(); setTabs([fresh]); setActiveTabId(fresh.id); return; }
    setTabs(next);
    if (activeTabId === id) {
      const idx = tabs.findIndex(t => t.id === id);
      setActiveTabId((next[Math.max(0, idx - 1)] ?? next[0]!).id);
    }
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
      bodyType = op.requestBody.contentType.includes('json') ? 'json' : 'raw';
      body = bodyType === 'json' ? JSON.stringify(schemaToExample(op.requestBody.schema), null, 2) : '';
    }
    const t = blankTab({ title: op.summary ?? op.path, method: op.method.toUpperCase(), url, pathParams, params: [...qp, { key: '', value: '', enabled: true }], headers: hdrs, body, bodyType });
    setTabs(p => [...p, t]);
    setActiveTabId(t.id);
    if (op.requestBody || qp.length) setReqTab(op.requestBody ? 'body' : 'params');
  };

  const send = async () => {
    if (!tab.url) return;
    upd(tab.id, { loading: true, response: null });

    const resolve = (s: string) => resolveVars(s, activeEnv);
    const rawPathUrl = replacePaths(resolve(tab.url), tab.pathParams);
    const authQueryRows = buildAuthQueryParams(tab.auth);
    const allQueryParams = [...tab.params, ...authQueryRows];
    const url = buildUrl(rawPathUrl, allQueryParams.filter(p => p.enabled && p.key).map(p => ({ ...p, value: resolve(p.value) })));

    const hdrs: Record<string, string> = {};
    for (const h of tab.headers) { if (h.enabled && h.key) hdrs[h.key] = resolve(h.value); }

    // Auth headers
    const authHdrs = buildAuthHeaders({
      ...tab.auth,
      bearer: resolve(tab.auth.bearer),
      basicUser: resolve(tab.auth.basicUser),
      basicPass: resolve(tab.auth.basicPass),
      apiKeyValue: resolve(tab.auth.apiKeyValue),
    });
    for (const [k, v] of Object.entries(authHdrs)) { if (!hdrs[k]) hdrs[k] = v; }

    if (tab.bodyType === 'json'  && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/json';
    if (tab.bodyType === 'form'  && !hdrs['Content-Type']) hdrs['Content-Type'] = 'application/x-www-form-urlencoded';
    // multipart Content-Type (with boundary) is set inside the body-build block below

    // Cookie jar
    const dom = urlDomain(rawPathUrl);
    const allCookies = await dbGetAll<CookieEntry>('cookies').catch(() => [] as CookieEntry[]);
    const matching = allCookies.filter(c => c.enabled && (c.domain === dom || c.domain === ''));
    if (matching.length) {
      const cs = matching.map(c => `${c.name}=${c.value}`).join('; ');
      hdrs['Cookie'] = hdrs['Cookie'] ? `${hdrs['Cookie']}; ${cs}` : cs;
    }

    let body: string | undefined;
    if (tab.bodyType === 'json') {
      body = resolve(tab.body) || undefined;
    } else if (tab.bodyType === 'form') {
      body = tab.formRows.filter(r => r.enabled && r.key).map(r => `${encodeURIComponent(r.key)}=${encodeURIComponent(resolve(r.value))}`).join('&') || undefined;
    } else if (tab.bodyType === 'multipart') {
      const boundary = '----StudioBoundary' + Date.now().toString(36);
      const parts = tab.formRows.filter(r => r.enabled && r.key).map(r =>
        `--${boundary}\r\nContent-Disposition: form-data; name="${r.key}"\r\n\r\n${resolve(r.value)}`
      );
      if (parts.length) {
        body = parts.join('\r\n') + `\r\n--${boundary}--\r\n`;
        if (!hdrs['Content-Type']) hdrs['Content-Type'] = `multipart/form-data; boundary=${boundary}`;
      }
    } else if (tab.bodyType === 'raw') {
      body = resolve(tab.body) || undefined;
    }

    try {
      const r = await apiClient<{ status: number; statusText?: string; headers: Record<string, string>; body: string; latency: number; error?: string; }>('/api/explorer/request', {
        method: 'POST',
        body: JSON.stringify({ method: tab.method, url, headers: hdrs, body }),
      });
      upd(tab.id, {
        loading: false,
        response: r.error
          ? { status: 0, statusText: '', headers: {}, body: '', latency: r.latency ?? 0, size: 0, error: r.error }
          : { status: r.status, statusText: r.statusText ?? '', headers: r.headers, body: r.body, latency: r.latency, size: new Blob([r.body]).size },
      });
    } catch (e) {
      upd(tab.id, { loading: false, response: { status: 0, statusText: '', headers: {}, body: '', latency: 0, size: 0, error: String(e) } });
    }
  };
  sendRef.current = send;

  const startResize = (e: React.MouseEvent) => {
    e.preventDefault();
    setDragging(true);
    const onMove = (ev: MouseEvent) => {
      if (!containerRef.current) return;
      const rect = containerRef.current.getBoundingClientRect();
      setSplitPct(Math.max(0.2, Math.min(0.8, (ev.clientY - rect.top) / rect.height)));
    };
    const onUp = () => {
      setDragging(false);
      document.removeEventListener('mousemove', onMove);
      document.removeEventListener('mouseup', onUp);
    };
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
  };

  const tab = tabs.find(t => t.id === activeTabId) ?? tabs[0]!;
  const domain = urlDomain(resolveVars(replacePaths(tab.url, tab.pathParams), activeEnv));
  const hasBody = !['GET', 'HEAD', 'OPTIONS'].includes(tab.method);
  const hasPathParams = tab.pathParams.length > 0;
  const hasAuth = tab.auth.type !== 'none';

  const paramCount = tab.params.filter(p => p.key).length + tab.pathParams.filter(p => p.key && p.value).length;
  const headerCount = tab.headers.filter(h => h.key).length;

  return (
    <div className="flex h-full overflow-hidden">
      {ExplorerHotkeys && (
        <ExplorerHotkeys
          sendRef={sendRef}
          addTabRef={addTabRef}
          updRef={updRef}
          tabsRef={tabsRef}
          activeTabRef={activeTabRef}
          urlInputRef={urlInputRef}
          setTabs={setTabs}
          setActiveTabId={setActiveTabId}
          blankTab={blankTab}
          defaultAuth={DEFAULT_AUTH}
        />
      )}

      {/* ── Endpoint tree */}
      <div className="w-[256px] min-w-[256px] bg-[var(--sidebar)] border-r border-[var(--border)] flex flex-col overflow-hidden">
        <div className="flex items-center px-3 h-[42px] border-b border-[var(--border)] flex-shrink-0">
          <span className="text-[10.5px] font-semibold tracking-widest uppercase text-[var(--placeholder-foreground)]">Endpoints</span>
        </div>
        {operations.length > 0
          ? <EndpointTree ops={operations} onSelect={openEndpoint} activeId={activeOpId} />
          : <div className="empty-state"><span className="text-[12px]">No spec loaded</span></div>}
      </div>

      {/* ── Main panel */}
      <div className="flex-1 flex flex-col overflow-hidden">

        {/* Tab bar */}
        <div className="flex items-end bg-[var(--sidebar)] border-b border-[var(--border)] min-h-[40px] overflow-x-auto flex-shrink-0 px-1.5 gap-0.5">
          {tabs.map(t => (
            <div key={t.id} onClick={() => setActiveTabId(t.id)} className={cn('tab-item h-[34px]', t.id === activeTabId && 'active')}>
              <span className={cn('method-badge', `method-${t.method}`)} style={{ fontSize: 8.5, padding: '1.5px 5px', minWidth: 34 }}>{t.method}</span>
              <span className="max-w-[130px] overflow-hidden text-ellipsis whitespace-nowrap text-[12.5px]">{t.title}</span>
              <button onClick={e => closeTab(t.id, e)} className="bg-transparent border-0 cursor-pointer text-[var(--placeholder-foreground)] p-0 flex rounded-sm hover:text-[var(--foreground)] transition-colors">
                <X size={11} />
              </button>
            </div>
          ))}
          <button className="tab-item h-8 px-2.5 text-[var(--placeholder-foreground)]" onClick={addTab}>
            <Plus size={14} />
          </button>
          <div className="ml-auto flex items-center pr-2 gap-2 flex-shrink-0">
            {activeEnv && (
              <span className="flex items-center gap-1 text-[11px] text-[var(--muted-foreground)]">
                <span className="w-2 h-2 rounded-full" style={{ background: activeEnv.color }} />
                {activeEnv.name}
              </span>
            )}
            <Link to="/ai">
              <button className="btn btn-ghost btn-sm gap-1.5 text-[11px]"><Bot size={12} />AI</button>
            </Link>
          </div>
        </div>

        {/* Resizable split */}
        <div ref={containerRef} className="flex-1 flex flex-col overflow-hidden">

          {/* ── Request builder */}
          <div className="flex flex-col overflow-hidden" style={{ height: `${splitPct * 100}%` }}>

            {/* URL bar */}
            <div className="flex items-center gap-2 px-3 py-2 border-b border-[var(--border)] bg-[var(--background)] flex-shrink-0">
              <select
                className="select h-9 w-[100px] flex-shrink-0 font-mono font-bold text-[12.5px]"
                value={tab.method}
                onChange={e => upd(tab.id, { method: e.target.value })}
                style={{ color: MC[tab.method] ?? 'var(--foreground)' }}
              >
                {METHODS.map(m => <option key={m} value={m}>{m}</option>)}
              </select>
              <input
                ref={urlInputRef}
                className="input flex-1 h-9 font-mono text-[13px]"
                placeholder="https://api.example.com/users/{id}  — use {{VAR}} for env variables"
                value={tab.url}
                onChange={e => {
                  const url = e.target.value;
                  const pathParams = syncPathParams(url, tab.pathParams);
                  upd(tab.id, { url, title: url || 'New Request', pathParams });
                }}
                onKeyDown={e => { if (e.key === 'Enter') send(); }}
              />
              <button
                className="btn btn-primary h-9 flex-shrink-0 gap-1.5"
                onClick={send}
                disabled={tab.loading || !tab.url}
              >
                {tab.loading ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Send size={13} />}
                Send
              </button>
              <button
                className="btn btn-ghost btn-icon h-9 flex-shrink-0"
                onClick={() => upd(tab.id, { response: null, url: '', title: 'New Request', params: [{ key: '', value: '', enabled: true }], pathParams: [], headers: [{ key: '', value: '', enabled: true }], body: '', bodyType: 'none', formRows: [{ key: '', value: '', enabled: true }], auth: { ...DEFAULT_AUTH } })}
                title="Clear (Alt+R)"
              >
                <RotateCcw size={13} />
              </button>
            </div>

            {/* Sub-tabs */}
            <div className="sub-tab-bar flex-shrink-0 pl-2">
              {(['params', 'headers', ...(hasBody ? ['body'] : []), 'auth', 'cookies', 'payload'] as ReqTab[]).map(v => {
                const badge =
                  v === 'params' ? (paramCount > 0 ? paramCount : 0)
                  : v === 'headers' ? (headerCount > 0 ? headerCount : 0)
                  : 0;
                const dot = v === 'auth' && hasAuth;
                return (
                  <button key={v} className={cn('sub-tab', reqTab === v && 'active')} onClick={() => setReqTab(v)}>
                    {v === 'cookies' && <Cookie size={10} />}
                    {v === 'auth' && <Lock size={10} />}
                    {v === 'payload' && <Eye size={10} />}
                    {v.charAt(0).toUpperCase() + v.slice(1)}
                    {badge > 0 && <span className="inline-flex items-center justify-center min-w-[16px] h-[16px] px-1 rounded-sm bg-[var(--elevated)] border border-[var(--border)] text-[var(--muted-foreground)] text-[10px] font-medium font-mono leading-none">{badge}</span>}
                    {dot && <span className="w-1.5 h-1.5 rounded-full bg-[var(--primary)] flex-shrink-0" />}
                  </button>
                );
              })}
            </div>

            {/* Sub-tab content */}
            <div className={cn('flex-1 overflow-auto', reqTab !== 'body' && reqTab !== 'payload' && 'p-3')}>

              {reqTab === 'params' && (
                <div className="flex flex-col gap-0">
                  {hasPathParams && (
                    <>
                      <div className="flex items-center gap-2 mb-2">
                        <span className="text-[11px] font-semibold text-[var(--foreground)] opacity-60 tracking-wide">PATH</span>
                        <div className="flex-1 h-px bg-[var(--border)]" />
                        <span className="text-[10.5px] text-[var(--muted-foreground)] opacity-60">from URL template</span>
                      </div>
                      <KVTable
                        rows={tab.pathParams}
                        onChange={p => upd(tab.id, { pathParams: p })}
                        ph={['param', 'value']}
                        readOnlyKey
                      />
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
                <KVTable rows={tab.headers} onChange={h => upd(tab.id, { headers: h })} ph={['Header', 'Value']} />
              )}

              {reqTab === 'body' && hasBody && (
                <div className="flex flex-col h-full">
                  <div className="flex gap-1 px-2 py-1.5 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
                    {(['none', 'json', 'form', 'multipart', 'raw'] as const).map(bt => (
                      <button key={bt}
                        className={cn('btn btn-ghost btn-sm text-[11.5px]', tab.bodyType === bt && 'bg-[rgba(99,102,241,0.12)] text-[#a5b4fc] border-[rgba(99,102,241,0.3)]')}
                        onClick={() => upd(tab.id, { bodyType: bt })}>
                        {bt === 'none' ? 'None' : bt === 'json' ? 'JSON' : bt === 'form' ? 'Form URL' : bt === 'multipart' ? 'Multipart' : 'Raw'}
                      </button>
                    ))}
                  </div>
                  {tab.bodyType === 'none' && <div className="empty-state text-[12px]">No body</div>}
                  {tab.bodyType === 'json' && (
                    <JsonEditor value={tab.body} onChange={v => upd(tab.id, { body: v })} placeholder={'{\n  "key": "value"\n}'} />
                  )}
                  {(tab.bodyType === 'form' || tab.bodyType === 'multipart') && (
                    <div className="p-3 flex flex-col gap-3">
                      <KVTable rows={tab.formRows} onChange={rows => upd(tab.id, { formRows: rows })} ph={['Field', 'Value']} />
                      <p className="text-[11px] text-[var(--placeholder-foreground)]">
                        Sent as <code className="font-mono">{tab.bodyType === 'form' ? 'application/x-www-form-urlencoded' : 'multipart/form-data'}</code>
                      </p>
                    </div>
                  )}
                  {tab.bodyType === 'raw' && (
                    <textarea
                      className="textarea flex-1 rounded-none border-0 resize-none text-[12px] font-mono"
                      placeholder="Request body…"
                      value={tab.body}
                      onChange={e => upd(tab.id, { body: e.target.value })}
                    />
                  )}
                </div>
              )}

              {reqTab === 'auth' && (
                <AuthPanel auth={tab.auth} onChange={a => upd(tab.id, { auth: a })} />
              )}

              {reqTab === 'cookies' && <CookiesPanel domain={domain} />}

              {reqTab === 'payload' && (
                <PayloadPanel tab={tab} activeEnv={activeEnv} />
              )}
            </div>
          </div>

          {/* Resize handle */}
          <div className={cn('resize-handle-y', dragging && 'dragging')} onMouseDown={startResize} />

          {/* ── Response panel */}
          <div className="flex-1 flex flex-col overflow-hidden border-t border-[var(--border)]">
            <div className="flex items-center px-3 h-9 border-b border-[var(--border)] bg-[var(--card)] flex-shrink-0">
              <span className="text-[10.5px] font-semibold tracking-widest uppercase text-[var(--placeholder-foreground)]">Response</span>
            </div>
            <ResponsePanel response={tab.response} loading={tab.loading} />
          </div>
        </div>
      </div>
    </div>
  );
}
