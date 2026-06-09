import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { apiClient, CLI_BASE_URL } from '../lib/api';
import { cacheInvalidateSpec } from '../lib/cache';
import { cn } from '../lib/utils';
import {
  RefreshCw, Copy, Check, ExternalLink,
  Zap, GitBranch, Server, Globe, ArrowUpRight,
  CheckCircle, Clock, AlertCircle, ChevronDown,
  Upload, Link2, FileJson, FileCode2, X,
} from 'lucide-react';

export const Route = createFileRoute('/')({ component: OverviewPage });

interface Status {
  ok: boolean;
  spec: { title: string; version: string; baseUrl: string; url: string };
  endpointCount: number;
  wsClients: number;
}
interface LogEntry {
  id: string; method: string; url: string;
  status_code: number | null; latency_ms: number | null;
  source: string; error: string | null; created_at: number;
}

function timeAgo(ts: number) {
  const ms = ts > 1e12 ? ts : ts * 1000;
  const diff = Date.now() - ms;
  if (diff < 60000) return 'just now';
  if (diff < 3600000) return `${Math.floor(diff / 60000)}m ago`;
  if (diff < 86400000) return `${Math.floor(diff / 3600000)}h ago`;
  return `${Math.floor(diff / 86400000)}d ago`;
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 18) return 'Good afternoon';
  return 'Good evening';
}

function trunc(url: string, n = 50) {
  try { const u = new URL(url); url = u.pathname + u.search; } catch { /* */ }
  return url.length > n ? url.slice(0, n) + '…' : url;
}

function StatusBadge({ code, error }: { code: number | null; error: string | null }) {
  if (error) return (
    <span className="status-badge status-badge-error gap-1">
      <AlertCircle size={11} />Error
    </span>
  );
  if (!code) return null;
  if (code < 300) return (
    <span className="status-badge status-badge-success gap-1">
      <CheckCircle size={11} />{code}
    </span>
  );
  if (code < 500) return (
    <span className="status-badge status-badge-pending gap-1">
      <Clock size={11} />{code}
    </span>
  );
  return (
    <span className="status-badge status-badge-error gap-1">
      <AlertCircle size={11} />{code}
    </span>
  );
}

// ─── Spec Loader ──────────────────────────────────────────────────────────────
type LoadState = 'idle' | 'loading' | 'success' | 'error';
interface LoadResult { spec?: { title: string; version: string; baseUrl: string }; endpointCount?: number; error?: string; }

function SpecLoader({ onLoaded }: { onLoaded: () => void }) {
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<LoadState>('idle');
  const [result, setResult] = useState<LoadResult | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const doUpload = async (f: File) => {
    setState('loading'); setResult(null);
    try {
      const content = await f.text();
      const r = await apiClient<LoadResult>('/api/spec/upload', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ content, filename: f.name }),
      });
      setResult(r); setState('success');
      await cacheInvalidateSpec();
      setTimeout(() => onLoaded(), 600);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
      setState('error');
    }
  };

  const doLoadUrl = async () => {
    if (!url.trim()) return;
    setState('loading'); setResult(null);
    try {
      const r = await apiClient<LoadResult>('/api/spec/reload-url', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: url.trim() }),
      });
      setResult(r); setState('success');
      await cacheInvalidateSpec();
      setTimeout(() => onLoaded(), 600);
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
      setState('error');
    }
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); doUpload(f); }
  };

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <div className="text-[14px] font-semibold text-[var(--foreground)]">Load Spec</div>
        <div className="text-[12.5px] text-[var(--muted-foreground)] mt-0.5">
          Upload a YAML or JSON OpenAPI spec, or load from a URL
        </div>
      </div>

      <div className="p-5">
        {/* Tab switcher */}
        <div className="flex bg-[var(--elevated)] rounded-lg p-1 mb-4 gap-0.5">
          {(['file', 'url'] as const).map(t => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={cn(
                'flex-1 flex items-center justify-center gap-1.5 py-1.5 text-[13px] font-medium rounded-md transition-all duration-100 border-0 cursor-pointer font-sans',
                tab === t
                  ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                  : 'bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)]',
              )}
            >
              {t === 'file' ? <FileCode2 size={12} /> : <Link2 size={12} />}
              {t === 'file' ? 'Upload File' : 'From URL'}
            </button>
          ))}
        </div>

        {tab === 'file' && (
          <>
            <input
              ref={fileRef} type="file" accept=".yaml,.yml,.json"
              className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); doUpload(f); } }}
            />
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'border-2 border-dashed rounded-lg px-5 py-8 text-center cursor-pointer transition-all duration-150',
                drag
                  ? 'border-[var(--accent)] bg-[var(--accent-dim)]'
                  : 'border-[var(--border)] hover:border-[var(--border-hover)]',
              )}
            >
              {state === 'loading' ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                  <span className="text-[13px] text-[var(--muted-foreground)]">Parsing spec…</span>
                </div>
              ) : (
                <>
                  <div className="w-9 h-9 rounded-lg bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] flex items-center justify-center mx-auto mb-3">
                    <Upload size={16} className="text-[var(--muted-foreground)]" />
                  </div>
                  {file && state !== 'error' ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileJson size={14} className="text-[var(--accent)]" />
                      <span className="text-[13px] font-medium text-[var(--foreground)]">{file.name}</span>
                    </div>
                  ) : (
                    <>
                      <div className="text-[13.5px] font-medium text-[var(--foreground)] mb-1">Drop your spec file here</div>
                      <div className="text-[12px] text-[var(--muted-foreground)]">or click to browse · .yaml, .yml, .json</div>
                    </>
                  )}
                </>
              )}
            </div>
          </>
        )}

        {tab === 'url' && (
          <div className="flex gap-2">
            <input
              className="input flex-1 h-9 font-mono text-[12.5px]"
              placeholder="https://api.example.com/openapi.yaml"
              value={url}
              onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLoadUrl()}
            />
            <button
              className="btn btn-primary h-9 flex-shrink-0 gap-1.5"
              onClick={doLoadUrl}
              disabled={!url.trim() || state === 'loading'}
            >
              {state === 'loading'
                ? <span className="spinner" style={{ width: 12, height: 12 }} />
                : <Globe size={13} />}
              Load
            </button>
          </div>
        )}

        {state === 'success' && result?.spec && (
          <div className="mt-3 px-3 py-2.5 rounded-lg bg-[var(--accent-dim)] border border-[rgba(34,197,94,0.25)] flex items-center gap-2.5">
            <CheckCircle size={14} className="text-[var(--accent)] flex-shrink-0" />
            <div className="flex-1 min-w-0">
              <span className="text-[13px] font-medium text-[var(--foreground)]">{result.spec.title}</span>
              <span className="text-[12px] text-[var(--muted-foreground)] ml-2">
                v{result.spec.version} · {result.endpointCount} endpoints
              </span>
            </div>
          </div>
        )}

        {state === 'error' && result?.error && (
          <div className="mt-3 px-3 py-2.5 rounded-lg bg-[var(--error-dim)] border border-[rgba(239,68,68,0.25)] flex items-start gap-2.5">
            <X size={14} className="text-[var(--destructive)] flex-shrink-0 mt-0.5" />
            <span className="text-[12px] text-[var(--destructive)] break-words">{result.error}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Overview page ─────────────────────────────────────────────────────────────
export function OverviewPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [copied, setCopied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  const load = async () => {
    setRefreshing(true);
    try {
      const [s, l] = await Promise.all([
        apiClient<Status>('/api/status'),
        apiClient<LogEntry[]>('/api/logs?limit=8'),
      ]);
      setStatus(s);
      setLogs(l);
    } catch { /* ignore */ } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);
  const specLoaded = !!status?.spec;

  const mcpUrl = `${CLI_BASE_URL}/mcp`;
  const mcpConfig = JSON.stringify(
    { mcpServers: { 'openapi-agent': { type: 'streamable-http', url: mcpUrl } } },
    null, 2,
  );

  const copy = () => {
    navigator.clipboard.writeText(mcpConfig);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="flex-1 overflow-auto bg-[var(--background)]">

      {/* ── Page header */}
      <div className="flex items-start justify-between px-8 pt-7 pb-6">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[var(--foreground)]">
            {greeting()}{status?.spec ? `, ${status.spec.title}` : ''}
          </h1>
          <p className="text-[13px] text-[var(--muted-foreground)] mt-1">
            {status?.spec ? 'API development studio' : 'Welcome — load a spec to get started'}
          </p>
        </div>
        <div className="flex items-center gap-2 mt-0.5">
          <button
            onClick={load}
            disabled={refreshing}
            className="btn btn-ghost gap-1.5 text-[13px]"
          >
            <RefreshCw size={13} className={cn(refreshing && 'animate-spin')} />
            Refresh
          </button>
          <a
            href={`${CLI_BASE_URL}/openapi.json`}
            target="_blank"
            rel="noopener noreferrer"
            className="btn btn-primary gap-1.5 text-[13px] no-underline"
          >
            <Globe size={13} />
            View Spec
            <ArrowUpRight size={11} />
          </a>
        </div>
      </div>

      {/* ── Main grid */}
      <div className="px-8 grid grid-cols-[1fr_320px] gap-5 mb-8">

        {/* Left: MCP card or SpecLoader */}
        {specLoaded ? (
          <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden flex flex-col min-h-[240px]">
            {/* Card header */}
            <div className="flex items-center gap-2.5 px-5 py-4 border-b border-[var(--border)] bg-[var(--sidebar)]">
              <div className="w-6 h-6 rounded-md flex-shrink-0 bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center">
                <Zap size={12} className="text-[var(--muted-foreground)]" strokeWidth={2} />
              </div>
              <span className="text-[14px] font-semibold text-[var(--foreground)] tracking-tight">
                {status?.spec.title ?? 'No API loaded'}
              </span>
              <span className="ml-1 flex items-center gap-1 text-[11px] font-medium bg-[var(--accent-dim)] text-[var(--accent)] border border-[rgba(34,197,94,0.2)] rounded-full px-2.5 py-0.5">
                <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] inline-block" />
                Live
              </span>
            </div>

            {/* MCP config */}
            <div className="p-5 flex-1">
              <div className="text-[11px] font-semibold text-[var(--muted-foreground)] tracking-widest uppercase mb-2.5">
                MCP Configuration
              </div>
              <div className="relative bg-[var(--elevated)] border border-[var(--border)] rounded-lg overflow-hidden">
                <pre className="m-0 px-3 pt-3 pb-3 pr-14 text-[11.5px] font-mono text-[var(--muted-foreground)] overflow-auto leading-relaxed">
                  {mcpConfig}
                </pre>
                <button
                  onClick={copy}
                  className={cn(
                    'absolute top-2 right-2 flex items-center gap-1 px-2 py-1 rounded text-[11px] bg-[var(--card)] border border-[var(--border)] cursor-pointer font-sans transition-colors',
                    copied ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                  )}
                >
                  {copied ? <Check size={11} /> : <Copy size={11} />}
                  {copied ? 'Copied' : 'Copy'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <SpecLoader onLoaded={load} />
        )}

        {/* Right: status or getting started */}
        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl p-5">
          {specLoaded ? (
            <>
              <div className="text-[11px] font-semibold text-[var(--muted-foreground)] tracking-widest uppercase mb-4">
                Status
              </div>

              <div className="flex flex-col gap-4">
                <div className="flex items-start gap-3 text-[var(--muted-foreground)]">
                  <Server size={14} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[11px] text-[var(--muted-foreground)] mb-1">Server</div>
                    <div className="text-[13px] text-[var(--foreground)] font-mono break-all">
                      {status?.spec.baseUrl || status?.spec.url || (
                        <span className="text-[var(--placeholder-foreground)]">Not loaded</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-[var(--muted-foreground)]">
                  <Zap size={14} className="flex-shrink-0 mt-1" />
                  <div>
                    <div className="text-[11px] text-[var(--muted-foreground)] mb-1">Endpoints</div>
                    <div className="text-[26px] font-bold tracking-tight text-[var(--foreground)] leading-none">
                      {status?.endpointCount ?? '—'}
                    </div>
                  </div>
                </div>

                <div className="flex items-start gap-3 text-[var(--muted-foreground)]">
                  <GitBranch size={14} className="flex-shrink-0 mt-0.5" />
                  <div>
                    <div className="text-[11px] text-[var(--muted-foreground)] mb-1">Version</div>
                    <div className="text-[13px] text-[var(--foreground)]">
                      {status ? `v${status.spec.version}` : '—'}
                    </div>
                  </div>
                </div>
              </div>

              <div className="mt-5 pt-4 border-t border-[var(--border)] flex flex-col gap-2">
                <Link
                  to="/explorer"
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium bg-[var(--accent)] text-black no-underline hover:opacity-90 transition-opacity"
                >
                  Open Explorer
                  <ArrowUpRight size={14} />
                </Link>
                <a
                  href={mcpUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center justify-between px-3 py-2 rounded-lg text-[13px] font-medium bg-transparent border border-[var(--border)] text-[var(--muted-foreground)] no-underline hover:border-[var(--border-hover)] hover:text-[var(--foreground)] transition-colors"
                >
                  MCP Server
                  <ExternalLink size={12} />
                </a>
              </div>
            </>
          ) : (
            <div>
              <div className="text-[11px] font-semibold text-[var(--muted-foreground)] tracking-widest uppercase mb-4">
                Getting started
              </div>
              {[
                { icon: <FileCode2 size={13} />, text: 'Upload an OpenAPI 3.x YAML or JSON file' },
                { icon: <Link2 size={13} />, text: 'Or paste a spec URL (Swagger Hub, GitHub, etc.)' },
                { icon: <Zap size={13} />, text: 'Explore endpoints, test requests, chat with AI' },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3 mb-3">
                  <span className="w-7 h-7 rounded-lg flex-shrink-0 bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] flex items-center justify-center text-[var(--muted-foreground)]">
                    {item.icon}
                  </span>
                  <span className="text-[12.5px] text-[var(--muted-foreground)] leading-relaxed pt-1">
                    {item.text}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ── Activity history */}
      <div className="px-8 pb-8">
        <div className="flex items-baseline justify-between mb-4">
          <div>
            <h2 className="text-[16px] font-bold text-[var(--foreground)] tracking-tight">Activity history</h2>
            <p className="text-[12.5px] text-[var(--muted-foreground)] mt-0.5">
              Showing recent requests through the studio
            </p>
          </div>
          <div className="flex gap-1.5">
            <Link
              to="/logs"
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-[var(--accent-dim)] text-[var(--accent)] border border-[rgba(34,197,94,0.2)] no-underline"
            >
              <span className="w-1.5 h-1.5 rounded-full bg-[var(--accent)] inline-block" />
              Live
            </Link>
            <a
              href={`${CLI_BASE_URL}/openapi.json`}
              target="_blank"
              rel="noopener noreferrer"
              className="flex items-center gap-1.5 px-3 py-1 rounded-full text-[12px] font-medium bg-transparent border border-[var(--border)] text-[var(--muted-foreground)] no-underline hover:border-[var(--border-hover)] hover:text-[var(--foreground)] transition-colors"
            >
              Spec
            </a>
          </div>
        </div>

        <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
          <table className="activity-table">
            <thead>
              <tr>
                <th className="w-[45%]">Activity</th>
                <th className="w-[20%]">Status</th>
                <th className="w-[25%]">Endpoint</th>
                <th className="w-[10%] text-right"><ChevronDown size={13} /></th>
              </tr>
            </thead>
            <tbody>
              {logs.length === 0 ? (
                <tr>
                  <td colSpan={4} className="text-center py-8 text-[var(--muted-foreground)] text-[13px]">
                    No requests yet — start using the Explorer or AI Chat
                  </td>
                </tr>
              ) : logs.map(log => (
                <tr key={log.id}>
                  <td>
                    <div className="flex items-center gap-3">
                      <div className="w-7 h-7 rounded-lg flex-shrink-0 bg-[var(--elevated)] border border-[var(--border)] flex items-center justify-center">
                        <RefreshCw size={12} className="text-[var(--muted-foreground)]" />
                      </div>
                      <div>
                        <div className="text-[13px] font-medium">
                          {log.source === 'mcp' ? 'MCP Request' : 'API Request'}
                        </div>
                        <div className="text-[11px] text-[var(--muted-foreground)] mt-0.5">
                          {timeAgo(log.created_at)}
                        </div>
                      </div>
                    </div>
                  </td>
                  <td>
                    <StatusBadge code={log.status_code} error={log.error} />
                  </td>
                  <td>
                    <div className="flex items-center gap-1.5">
                      <span className={cn('method-badge', `method-${(log.method ?? 'GET').toUpperCase()}`)}>
                        {(log.method ?? 'GET').toUpperCase()}
                      </span>
                      <span className="text-[12px] font-mono text-[var(--muted-foreground)] overflow-hidden text-ellipsis whitespace-nowrap">
                        {trunc(log.url, 30)}
                      </span>
                    </div>
                  </td>
                  <td className="text-right">
                    {log.latency_ms && (
                      <span className="text-[11px] text-[var(--placeholder-foreground)] font-mono">
                        {log.latency_ms}ms
                      </span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        {logs.length > 0 && (
          <div className="mt-3 text-center">
            <Link to="/logs" className="text-[12.5px] text-[var(--accent)] no-underline hover:underline">
              View all activity →
            </Link>
          </div>
        )}
      </div>
    </div>
  );
}
