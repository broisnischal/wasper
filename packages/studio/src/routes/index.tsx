import { createFileRoute, Link } from '@tanstack/react-router';
import { useEffect, useRef, useState } from 'react';
import { apiClient, CLI_BASE_URL, cliLink } from '../lib/api';
import { cacheInvalidateSpec } from '../lib/cache';
import { cn } from '../lib/utils';
import { saveEnvironment, listEnvironments, type Environment, type EnvVar, ENV_COLORS } from '../lib/env';
import {
  RefreshCw, Copy, Check, ExternalLink,
  Zap, Globe, ArrowUpRight, CheckCircle,
  Upload, Link2, FileJson, FileCode2, X,
  Bot, Activity, Layers, Eye, EyeOff, Terminal,
} from 'lucide-react';

export const Route = createFileRoute('/')({ component: OverviewPage });

interface Status {
  ok: boolean;
  spec: { title: string; version: string; baseUrl: string; url: string };
  endpointCount: number;
  wsClients: number;
}

// ─── Spec Loader ──────────────────────────────────────────────────────────────
type LoadState = 'idle' | 'loading' | 'success' | 'error';

interface SuggestedVar {
  key: string;
  value: string;
  description: string;
  source: 'server' | 'auth' | 'path';
}

interface LoadResult {
  spec?: { title: string; version: string; baseUrl: string };
  endpointCount?: number;
  error?: string;
  suggestedVars?: SuggestedVar[];
}

function EnvImportModal({
  specTitle,
  vars,
  onConfirm,
  onSkip,
}: {
  specTitle: string;
  vars: SuggestedVar[];
  onConfirm: (envName: string, editedVars: SuggestedVar[]) => Promise<void>;
  onSkip: () => void;
}) {
  const [envName, setEnvName] = useState(`${specTitle} – Default`);
  const [editedVars, setEditedVars] = useState<SuggestedVar[]>(vars);
  const [saving, setSaving] = useState(false);
  const [showSecret, setShowSecret] = useState<Record<number, boolean>>({});

  const updateVar = (i: number, value: string) => {
    setEditedVars(prev => prev.map((v, idx) => idx === i ? { ...v, value } : v));
  };

  const handleConfirm = async () => {
    setSaving(true);
    await onConfirm(envName, editedVars);
    setSaving(false);
  };

  const SOURCE_COLORS: Record<SuggestedVar['source'], string> = {
    server: 'var(--info)',
    auth:   'var(--warning)',
    path:   'var(--success)',
  };
  const SOURCE_LABELS: Record<SuggestedVar['source'], string> = {
    server: 'server',
    auth:   'auth',
    path:   'path',
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4" style={{ background: 'rgba(0,0,0,0.6)', backdropFilter: 'blur(8px)' }}>
      <div className="w-full max-w-[540px] rounded-xl border border-[var(--border)] bg-[var(--popover)] shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-start gap-3 p-5 border-b border-[var(--border)]">
          <div className="w-9 h-9 rounded-lg flex items-center justify-center flex-shrink-0" style={{ background: 'var(--accent-dim)' }}>
            <Layers className="size-4" style={{ color: 'var(--accent)' }} />
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[14px] font-semibold text-[var(--foreground)]">Import Environment Variables</div>
            <div className="text-[12px] text-[var(--muted-foreground)] mt-0.5">
              Found <strong className="text-[var(--foreground)]">{vars.length}</strong> variables in <strong className="text-[var(--foreground)]">{specTitle}</strong>. Review and create an environment.
            </div>
          </div>
          <button onClick={onSkip} className="flex-shrink-0 p-1 rounded hover:bg-[var(--elevated)] text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors border-0 bg-transparent cursor-pointer">
            <X className="size-4" />
          </button>
        </div>

        {/* Variable list */}
        <div className="flex-1 overflow-y-auto p-4 flex flex-col gap-2">
          {editedVars.map((v, i) => (
            <div key={i} className="flex items-center gap-2.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2.5">
              {/* Source badge */}
              <span
                className="flex-shrink-0 text-[9px] font-semibold uppercase tracking-wider px-1.5 py-0.5 rounded"
                style={{
                  color: SOURCE_COLORS[v.source],
                  background: `color-mix(in srgb, ${SOURCE_COLORS[v.source]} 12%, transparent)`,
                }}
              >
                {SOURCE_LABELS[v.source]}
              </span>
              {/* Key */}
              <span className="font-mono text-[12px] text-[var(--foreground)] flex-shrink-0 min-w-[120px] max-w-[180px] truncate" title={v.key}>
                {`{{${v.key}}}`}
              </span>
              {/* Value input */}
              <div className="flex-1 flex items-center gap-1 min-w-0">
                <input
                  type={v.source === 'auth' && !showSecret[i] ? 'password' : 'text'}
                  className="input h-6 text-[12px] flex-1 min-w-0 font-mono"
                  value={v.value}
                  onChange={e => updateVar(i, e.target.value)}
                  placeholder={v.source === 'auth' ? '••••••••' : v.value || 'empty'}
                />
                {v.source === 'auth' && (
                  <button
                    type="button"
                    onClick={() => setShowSecret(s => ({ ...s, [i]: !s[i] }))}
                    className="flex-shrink-0 p-0.5 text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] transition-colors border-0 bg-transparent cursor-pointer"
                  >
                    {showSecret[i] ? <EyeOff className="size-3" /> : <Eye className="size-3" />}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-[var(--border)] flex items-center gap-3">
          <input
            className="input flex-1 h-8 text-[13px]"
            value={envName}
            onChange={e => setEnvName(e.target.value)}
            placeholder="Environment name"
          />
          <button type="button" onClick={onSkip} className="btn btn-ghost btn-sm flex-shrink-0">
            Skip
          </button>
          <button
            type="button"
            onClick={handleConfirm}
            disabled={saving || !envName.trim()}
            className="btn btn-primary btn-sm flex-shrink-0"
          >
            {saving ? 'Creating…' : 'Create Environment'}
          </button>
        </div>
      </div>
    </div>
  );
}

function SpecLoader({ onLoaded }: { onLoaded: () => void }) {
  const [tab, setTab] = useState<'file' | 'url'>('file');
  const [drag, setDrag] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [url, setUrl] = useState('');
  const [state, setState] = useState<LoadState>('idle');
  const [result, setResult] = useState<LoadResult | null>(null);
  const [pendingVars, setPendingVars] = useState<SuggestedVar[] | null>(null);
  const [pendingTitle, setPendingTitle] = useState('');
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
      if (r.suggestedVars && r.suggestedVars.length > 0) {
        setPendingVars(r.suggestedVars);
        setPendingTitle(r.spec?.title ?? 'API');
      } else {
        setTimeout(() => onLoaded(), 600);
      }
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
      if (r.suggestedVars && r.suggestedVars.length > 0) {
        setPendingVars(r.suggestedVars);
        setPendingTitle(r.spec?.title ?? 'API');
      } else {
        setTimeout(() => onLoaded(), 600);
      }
    } catch (e) {
      setResult({ error: e instanceof Error ? e.message : String(e) });
      setState('error');
    }
  };

  const handleEnvConfirm = async (envName: string, editedVars: SuggestedVar[]) => {
    const existing = await listEnvironments();
    const existingEnv = existing.find(e => e.name.toLowerCase() === envName.toLowerCase());

    const envVars: EnvVar[] = editedVars.map(v => ({
      key: v.key,
      value: v.value,
      enabled: true,
    }));

    if (existingEnv) {
      const existingKeys = new Set(existingEnv.vars.map(v => v.key));
      const merged = [
        ...existingEnv.vars,
        ...envVars.filter(v => !existingKeys.has(v.key)),
      ];
      await saveEnvironment({ ...existingEnv, vars: merged });
    } else {
      const colorIdx = existing.length % ENV_COLORS.length;
      const newEnv: Environment = {
        id: crypto.randomUUID(),
        name: envName,
        color: ENV_COLORS[colorIdx],
        vars: envVars,
      };
      await saveEnvironment(newEnv);
    }

    setPendingVars(null);
    onLoaded();
  };

  const onDrop = (e: React.DragEvent) => {
    e.preventDefault(); setDrag(false);
    const f = e.dataTransfer.files[0];
    if (f) { setFile(f); doUpload(f); }
  };

  return (
    <>
      {pendingVars && (
        <EnvImportModal
          specTitle={pendingTitle}
          vars={pendingVars}
          onConfirm={handleEnvConfirm}
          onSkip={() => { setPendingVars(null); onLoaded(); }}
        />
      )}
    <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
      <div className="border-b border-[var(--border)] px-5 py-4">
        <div className="text-[14px] font-semibold text-[var(--foreground)]">Load Spec</div>
        <div className="mt-0.5 text-[12.5px] text-[var(--muted-foreground)]">
          Upload a YAML or JSON OpenAPI spec, or load from a URL
        </div>
      </div>

      <div className="p-5">
        <div className="mb-4 flex gap-0.5 rounded-lg bg-[var(--elevated)] p-1">
          {(['file', 'url'] as const).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={cn(
                'flex flex-1 items-center justify-center gap-1.5 rounded-md py-1.5 text-[13px] font-medium transition-all duration-100 border-0 cursor-pointer font-sans',
                tab === t
                  ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                  : 'bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)]',
              )}>
              {t === 'file' ? <FileCode2 size={12} /> : <Link2 size={12} />}
              {t === 'file' ? 'Upload File' : 'From URL'}
            </button>
          ))}
        </div>

        {tab === 'file' && (
          <>
            <input ref={fileRef} type="file" accept=".yaml,.yml,.json" className="hidden"
              onChange={e => { const f = e.target.files?.[0]; if (f) { setFile(f); doUpload(f); } }} />
            <div
              onDragOver={e => { e.preventDefault(); setDrag(true); }}
              onDragLeave={() => setDrag(false)}
              onDrop={onDrop}
              onClick={() => fileRef.current?.click()}
              className={cn(
                'cursor-pointer rounded-xl border-2 border-dashed px-5 py-10 text-center transition-all duration-150',
                drag ? 'border-[var(--accent)] bg-[var(--accent-dim)]' : 'border-[var(--border)] hover:border-[var(--border-hover)]',
              )}>
              {state === 'loading' ? (
                <div className="flex flex-col items-center gap-2">
                  <span className="spinner" style={{ width: 20, height: 20, borderWidth: 2 }} />
                  <span className="text-[13px] text-[var(--muted-foreground)]">Parsing spec…</span>
                </div>
              ) : (
                <>
                  <div className="mx-auto mb-3 flex size-10 items-center justify-center rounded-xl bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                    <Upload size={16} className="text-[var(--muted-foreground)]" />
                  </div>
                  {file && state !== 'error' ? (
                    <div className="flex items-center justify-center gap-2">
                      <FileJson size={14} className="text-[var(--accent)]" />
                      <span className="text-[13px] font-medium text-[var(--foreground)]">{file.name}</span>
                    </div>
                  ) : (
                    <>
                      <div className="mb-1 text-[13.5px] font-medium text-[var(--foreground)]">Drop your spec file here</div>
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
            <input className="input flex-1 h-9 font-mono text-[12.5px]"
              placeholder="https://api.example.com/openapi.yaml"
              value={url} onChange={e => setUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && doLoadUrl()} />
            <button className="btn btn-primary h-9 flex-shrink-0 gap-1.5" onClick={doLoadUrl}
              disabled={!url.trim() || state === 'loading'}>
              {state === 'loading' ? <span className="spinner" style={{ width: 12, height: 12 }} /> : <Globe size={13} />}
              Load
            </button>
          </div>
        )}

        {state === 'success' && result?.spec && (
          <div className="mt-3 flex items-center gap-2.5 rounded-lg border border-[rgba(34,197,94,0.25)] bg-[var(--accent-dim)] px-3 py-2.5">
            <CheckCircle size={14} className="shrink-0 text-[var(--accent)]" />
            <div className="min-w-0 flex-1">
              <span className="text-[13px] font-medium text-[var(--foreground)]">{result.spec.title}</span>
              <span className="ml-2 text-[12px] text-[var(--muted-foreground)]">
                v{result.spec.version} · {result.endpointCount} endpoints
              </span>
            </div>
          </div>
        )}
        {state === 'error' && result?.error && (
          <div className="mt-3 flex items-start gap-2.5 rounded-lg border border-[rgba(239,68,68,0.25)] bg-[var(--error-dim)] px-3 py-2.5">
            <X size={14} className="mt-0.5 shrink-0 text-[var(--destructive)]" />
            <span className="text-[12px] text-[var(--destructive)] break-words">{result.error}</span>
          </div>
        )}
      </div>
    </div>
    </>
  );
}

// ─── MCP client configs ───────────────────────────────────────────────────────
type McpClient = 'claude-desktop' | 'claude-code' | 'http';

const MCP_CLIENTS: { id: McpClient; label: string }[] = [
  { id: 'claude-desktop', label: 'Claude Desktop' },
  { id: 'claude-code',    label: 'Claude Code' },
  { id: 'http',           label: 'HTTP / Other' },
];

const MCP_FILE_LABELS: Record<McpClient, string> = {
  'claude-desktop': '~/Library/Application Support/Claude/claude_desktop_config.json',
  'claude-code':    'Terminal',
  'http':           'Endpoint URL',
};

const MCP_HINTS: Record<McpClient, string> = {
  'claude-desktop': 'Add to your Claude Desktop config file, then restart Claude Desktop.',
  'claude-code':    'Run this command in your terminal to register the MCP server.',
  'http':           'Use this Streamable HTTP endpoint with any MCP-compatible client.',
};

// ─── Overview page ────────────────────────────────────────────────────────────
function OverviewPage() {
  const [status, setStatus] = useState<Status | null>(null);
  const [copied, setCopied] = useState<string | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [mcpClient, setMcpClient] = useState<McpClient>('claude-desktop');

  const load = async () => {
    setRefreshing(true);
    try {
      const s = await apiClient<Status>('/api/status');
      setStatus(s);
    } catch { /* ignore */ } finally {
      setRefreshing(false);
    }
  };

  useEffect(() => { load(); }, []);

  const specLoaded = !!status?.spec;
  const mcpUrl = `${CLI_BASE_URL}/mcp`;

  const mcpSnippets: Record<McpClient, string> = {
    'claude-desktop': JSON.stringify(
      { mcpServers: { 'wasper': { type: 'streamable-http', url: mcpUrl } } },
      null, 2,
    ),
    'claude-code': `claude mcp add wasper ${mcpUrl} --transport http`,
    'http': mcpUrl,
  };

  const copy = (key: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopied(key);
    setTimeout(() => setCopied(null), 1600);
  };

  return (
    <div className="flex h-full flex-col overflow-hidden bg-[var(--background)]">

      {/* ── Page header ── */}
      <header className="flex shrink-0 items-center justify-between border-b border-[var(--border)] px-8 py-4">
        <div>
          <h1 className="text-[22px] font-bold tracking-tight text-[var(--foreground)] leading-none">Overview</h1>
          <p className="mt-1 text-[12.5px] text-[var(--muted-foreground)]">
            {specLoaded
              ? `${status!.spec.title} · v${status!.spec.version}`
              : 'Load an OpenAPI spec to get started'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={load} disabled={refreshing}
            className="flex items-center gap-1.5 h-8 rounded-lg border border-[var(--border)] bg-transparent px-3 text-[12px] text-[var(--muted-foreground)] transition-colors hover:border-[var(--border-hover)] hover:text-[var(--foreground)] disabled:opacity-40 cursor-pointer font-sans">
            <RefreshCw size={11} className={cn(refreshing && 'animate-spin')} />
            Refresh
          </button>
          {specLoaded && (
            <a href={cliLink('/openapi.json')} target="_blank" rel="noopener noreferrer"
              className="flex items-center gap-1.5 h-8 rounded-lg bg-[var(--foreground)] px-3 text-[12px] font-semibold text-[var(--background)] no-underline transition-opacity hover:opacity-85">
              View Spec
              <ArrowUpRight size={11} />
            </a>
          )}
        </div>
      </header>

      {/* ── Scrollable content ── */}
      <div className="flex-1 overflow-auto">
        {specLoaded ? (
          <div className="max-w-[960px] px-8 py-6 flex flex-col gap-6">

            {/* ── Stats strip ── */}
            <div className="grid grid-cols-3 divide-x divide-[var(--border)] border border-[var(--border)] rounded-xl overflow-hidden bg-[var(--card)]">
              <div className="px-6 py-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-3">Endpoints</div>
                <div className="text-[34px] font-bold leading-none tracking-tight text-[var(--foreground)]">{status!.endpointCount}</div>
                <div className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">API operations</div>
              </div>
              <div className="px-6 py-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-3">Base URL</div>
                <div className="font-mono text-[12px] text-[var(--foreground)] break-all leading-snug">
                  {status!.spec.baseUrl || status!.spec.url || <span className="text-[var(--muted-foreground)]">—</span>}
                </div>
                <div className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">Server origin</div>
              </div>
              <div className="px-6 py-5">
                <div className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)] mb-3">Version</div>
                <div className="inline-flex items-center font-mono text-[13px] font-semibold text-[var(--foreground)]">
                  v{status!.spec.version}
                </div>
                <div className="mt-2 text-[11.5px] text-[var(--muted-foreground)]">OpenAPI spec</div>
              </div>
            </div>

            {/* ── MCP + Actions ── */}
            <div className="grid grid-cols-[1fr_240px] gap-4">

              {/* MCP Configuration */}
              <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
                <div className="flex items-center justify-between border-b border-[var(--border)] px-5 py-4">
                  <div>
                    <div className="text-[14px] font-semibold text-[var(--foreground)]">MCP Configuration</div>
                    <div className="mt-0.5 text-[12px] text-[var(--muted-foreground)]">Connect your AI client to this server</div>
                  </div>
                  <a href={mcpUrl} target="_blank" rel="noopener noreferrer"
                    className="flex items-center gap-1.5 rounded-full border border-[rgba(34,197,94,0.28)] bg-[rgba(34,197,94,0.08)] px-2.5 py-1 text-[11px] font-medium text-[#22c55e] no-underline transition-colors hover:bg-[rgba(34,197,94,0.14)]">
                    <span className="size-1.5 rounded-full bg-[#22c55e]" style={{ boxShadow: '0 0 4px rgba(34,197,94,0.7)' }} />
                    Live
                    <ExternalLink size={9} className="opacity-70" />
                  </a>
                </div>

                <div className="p-5">
                  {/* Client selector */}
                  <div className="mb-4 flex gap-0.5 rounded-lg bg-[var(--elevated)] p-1">
                    {MCP_CLIENTS.map(c => (
                      <button key={c.id} onClick={() => setMcpClient(c.id)}
                        className={cn(
                          'flex-1 rounded-md py-1.5 text-[12px] font-medium transition-all duration-100 border-0 cursor-pointer font-sans',
                          mcpClient === c.id
                            ? 'bg-[var(--background)] text-[var(--foreground)] shadow-sm'
                            : 'bg-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)]',
                        )}>
                        {c.label}
                      </button>
                    ))}
                  </div>

                  {/* Code block */}
                  <div className="overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--elevated)]">
                    <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2">
                      <span className="truncate font-mono text-[10.5px] text-[var(--muted-foreground)]">
                        {MCP_FILE_LABELS[mcpClient]}
                      </span>
                      <button onClick={() => copy(mcpClient, mcpSnippets[mcpClient])}
                        className={cn(
                          'ml-3 flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] font-sans cursor-pointer transition-colors',
                          copied === mcpClient ? 'text-[#22c55e]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                        )}>
                        {copied === mcpClient ? <Check size={10} /> : <Copy size={10} />}
                        {copied === mcpClient ? 'Copied' : 'Copy'}
                      </button>
                    </div>
                    <pre className="m-0 overflow-auto px-4 py-3.5 font-mono text-[11.5px] leading-relaxed text-[var(--foreground)] whitespace-pre-wrap break-all">
                      {mcpSnippets[mcpClient]}
                    </pre>
                  </div>

                  <p className="mt-3 text-[11.5px] leading-relaxed text-[var(--muted-foreground)]">
                    {MCP_HINTS[mcpClient]}
                  </p>
                </div>
              </div>

              {/* Right column */}
              <div className="flex flex-col gap-3">

                {/* Quick Actions */}
                <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
                  <div className="border-b border-[var(--border)] px-4 py-3">
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">Quick Actions</span>
                  </div>
                  <div className="flex flex-col p-2 gap-0.5">
                    <Link to="/explorer"
                      className="flex items-center justify-between rounded-lg bg-[var(--foreground)] px-3 py-2.5 text-[12.5px] font-semibold text-[var(--background)] no-underline transition-opacity hover:opacity-85">
                      Open Explorer <ArrowUpRight size={11} />
                    </Link>
                    <Link to="/ai"
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-[12.5px] text-[var(--muted-foreground)] no-underline transition-colors hover:bg-[var(--elevated)] hover:text-[var(--foreground)]">
                      AI Chat <Bot size={11} />
                    </Link>
                    <Link to="/logs"
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-[12.5px] text-[var(--muted-foreground)] no-underline transition-colors hover:bg-[var(--elevated)] hover:text-[var(--foreground)]">
                      View Logs <Activity size={11} />
                    </Link>
                    <a href={cliLink('/openapi.json')} target="_blank" rel="noopener noreferrer"
                      className="flex items-center justify-between rounded-lg px-3 py-2.5 text-[12.5px] text-[var(--muted-foreground)] no-underline transition-colors hover:bg-[var(--elevated)] hover:text-[var(--foreground)]">
                      Raw Spec <ExternalLink size={11} />
                    </a>
                  </div>
                </div>

                {/* MCP Endpoint */}
                <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
                  <div className="flex items-center gap-2 mb-3">
                    <span className="size-1.5 shrink-0 rounded-full bg-[#22c55e]" style={{ boxShadow: '0 0 5px rgba(34,197,94,0.7)' }} />
                    <span className="text-[10px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">MCP Endpoint</span>
                    <a href={mcpUrl} target="_blank" rel="noopener noreferrer"
                      className="ml-auto text-[var(--placeholder-foreground)] no-underline transition-colors hover:text-[var(--foreground)]">
                      <ExternalLink size={10} />
                    </a>
                  </div>
                  <div className="overflow-hidden rounded-lg bg-[var(--elevated)] px-3 py-2">
                    <span className="break-all font-mono text-[10.5px] text-[var(--muted-foreground)]">{mcpUrl}</span>
                  </div>
                </div>
              </div>
            </div>

          </div>
        ) : (
          /* ── No spec loaded — centered ── */
          <div className="flex h-full items-center justify-center p-8">
            <div className="w-full max-w-[480px]">
              <h1 className="mb-1 text-[26px] font-bold tracking-tight text-[var(--foreground)] leading-tight">Welcome to Wasper</h1>
              <p className="mb-8 text-[13.5px] text-[var(--muted-foreground)]">Load an OpenAPI specification to get started.</p>
              <SpecLoader onLoaded={load} />
              <div className="mt-5 flex flex-col gap-2.5">
                {[
                  { icon: FileCode2, text: 'Supports OpenAPI 3.x YAML and JSON' },
                  { icon: Link2, text: 'Load from URL — Swagger Hub, GitHub, or any public endpoint' },
                  { icon: Zap, text: 'Explore endpoints, run requests, and chat with AI' },
                ].map(({ icon: Icon, text }, i) => (
                  <div key={i} className="flex items-center gap-3">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] text-[var(--muted-foreground)]">
                      <Icon size={11} />
                    </span>
                    <span className="text-[12.5px] text-[var(--muted-foreground)]">{text}</span>
                  </div>
                ))}
              </div>

              {/* ── Install command ── */}
              <div className="mt-7">
                <div className="flex items-center gap-2 mb-2">
                  <Terminal size={11} className="text-[var(--muted-foreground)]" />
                  <span className="text-[11px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">Install the CLI</span>
                </div>
                <div className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--elevated)]">
                  {/* curl */}
                  <div className="flex items-center justify-between border-b border-[var(--border)] px-3.5 py-2.5">
                    <code className="font-mono text-[12px] text-[var(--foreground)] select-all">
                      curl -fsSL https://studio.stroke.click/install.sh | sh
                    </code>
                    <button
                      onClick={() => copy('install-curl', 'curl -fsSL https://studio.stroke.click/install.sh | sh')}
                      className={cn(
                        'ml-3 flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] font-sans cursor-pointer transition-colors',
                        copied === 'install-curl' ? 'text-[#22c55e]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                      )}
                    >
                      {copied === 'install-curl' ? <Check size={10} /> : <Copy size={10} />}
                    </button>
                  </div>
                  {/* bun */}
                  <div className="flex items-center justify-between px-3.5 py-2.5">
                    <code className="font-mono text-[12px] text-[var(--muted-foreground)] select-all">
                      bun add -g wasper-cli
                    </code>
                    <button
                      onClick={() => copy('install-bun', 'bun add -g wasper-cli')}
                      className={cn(
                        'ml-3 flex shrink-0 items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] font-sans cursor-pointer transition-colors',
                        copied === 'install-bun' ? 'text-[#22c55e]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                      )}
                    >
                      {copied === 'install-bun' ? <Check size={10} /> : <Copy size={10} />}
                    </button>
                  </div>
                </div>
                <p className="mt-2 text-[11px] text-[var(--placeholder-foreground)]">
                  Then run <code className="font-mono">wasper --url &lt;spec-url&gt;</code> to launch the studio.
                </p>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
