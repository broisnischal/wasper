import React, { useState, useEffect, useRef, useCallback } from 'react';
import { CLI_BASE_URL, authHeaders } from '../lib/api';
import { Markdown } from './Markdown';
import { cn } from '../lib/utils';
import {
  Bot, User, X, Sparkles, RotateCcw, Send,
  Zap, Check, ChevronDown, ChevronRight, Wrench,
  Search, FileCode, Terminal, Globe, Wifi, Plug,
  Activity, Shield, UserCheck, KeyRound, AlertTriangle,
  Copy, ClipboardPaste,
} from 'lucide-react';

// ── Types ──────────────────────────────────────────────────────────────────────

export interface AiPanelContext {
  page: 'explorer' | 'workflows' | 'overview' | string;
  label?: string;
  method?: string;
  url?: string;
  path?: string;
  operationId?: string;
  requestBody?: string;
  requestHeaders?: Record<string, string>;
  responseStatus?: number;
  responseBody?: string;
  responseContentType?: string;
  workflowName?: string;
  workflowSteps?: string;
}

interface ToolCall { tool: string; input: Record<string, unknown>; output: string; isError: boolean; }
interface LiveToolCall { tool: string; input: Record<string, unknown>; output?: string; isError?: boolean; done: boolean; }
interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolCalls?: ToolCall[];
}

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  search_endpoints:    { label: 'Search Endpoints',   icon: <Search size={10} />,       color: '#3b82f6' },
  get_endpoint_schema: { label: 'Get Schema',         icon: <FileCode size={10} />,     color: '#0ea5e9' },
  execute_api_request: { label: 'Execute Request',    icon: <Terminal size={10} />,     color: '#10b981' },
  fetch_url:           { label: 'Fetch URL',          icon: <Globe size={10} />,        color: '#f59e0b' },
  dns_lookup:          { label: 'DNS Lookup',         icon: <Wifi size={10} />,         color: '#a855f7' },
  ping_host:           { label: 'Ping / Reach',       icon: <Plug size={10} />,         color: '#22c55e' },
  get_recent_logs:     { label: 'Recent Logs',        icon: <Activity size={10} />,     color: '#3b82f6' },
  run_security_check:  { label: 'Security Check',     icon: <AlertTriangle size={10} />, color: '#ef4444' },
  list_auth_profiles:  { label: 'List Auth Profiles', icon: <Shield size={10} />,       color: '#8b5cf6' },
  set_active_auth:     { label: 'Switch Auth',        icon: <UserCheck size={10} />,    color: '#8b5cf6' },
  save_auth_token:     { label: 'Save Auth Token',    icon: <KeyRound size={10} />,     color: '#f59e0b' },
};

// ── Helpers ────────────────────────────────────────────────────────────────────

function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2); }

function extractJsonBlocks(content: string): string[] {
  const out: string[] = [];
  const re = /```(?:json)?\s*\n?([\s\S]+?)```/g;
  let m;
  while ((m = re.exec(content)) !== null) {
    const raw = m[1]!.trim();
    try { JSON.parse(raw); out.push(raw); } catch { /* skip non-JSON */ }
  }
  return out;
}

function buildExtraContext(ctx: AiPanelContext | null): string {
  if (!ctx) return '';
  const lines: string[] = [];
  lines.push(`Page: ${ctx.page}`);
  if (ctx.method && ctx.url)
    lines.push(`Active request: ${ctx.method} ${ctx.url}`);
  if (ctx.path) lines.push(`Path: ${ctx.path}`);
  if (ctx.operationId) lines.push(`Operation ID: ${ctx.operationId}`);
  if (ctx.requestBody) lines.push(`Request body:\n\`\`\`json\n${ctx.requestBody}\n\`\`\``);
  if (ctx.requestHeaders && Object.keys(ctx.requestHeaders).length) {
    const hdrs = Object.entries(ctx.requestHeaders).map(([k, v]) => `${k}: ${v}`).join('\n');
    lines.push(`Request headers:\n${hdrs}`);
  }
  if (ctx.responseStatus != null)
    lines.push(`Response status: ${ctx.responseStatus}`);
  if (ctx.responseBody) {
    const preview = ctx.responseBody.length > 2000
      ? ctx.responseBody.slice(0, 2000) + '\n... (truncated)'
      : ctx.responseBody;
    lines.push(`Response body:\n\`\`\`${ctx.responseContentType?.includes('json') ? 'json' : ''}\n${preview}\n\`\`\``);
  }
  if (ctx.workflowName) lines.push(`Workflow: "${ctx.workflowName}"`);
  if (ctx.workflowSteps) lines.push(`Current steps:\n\`\`\`json\n${ctx.workflowSteps}\n\`\`\``);
  return lines.join('\n\n');
}

// ── ToolCallsRow ───────────────────────────────────────────────────────────────

function ToolCallsRow({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [open, setOpen] = useState(false);
  if (!toolCalls.length) return null;
  return (
    <div className="mt-1.5">
      <button type="button" onClick={() => setOpen(o => !o)}
        className="flex items-center gap-1.5 rounded px-1.5 py-0.5 text-[10.5px] text-[var(--muted-foreground)] hover:bg-[var(--elevated)] transition-colors">
        <Wrench size={9} />
        {toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''} used
        {open ? <ChevronDown size={9} /> : <ChevronRight size={9} />}
      </button>
      {open && (
        <div className="mt-1 flex flex-col gap-0.5 pl-2">
          {toolCalls.map((tc, i) => {
            const meta = TOOL_META[tc.tool] ?? { label: tc.tool, icon: <Zap size={10} />, color: '#8b5cf6' };
            return (
              <div key={i} className={cn(
                'flex items-center gap-2 rounded-md border px-2 py-1 text-[10.5px]',
                tc.isError ? 'border-[rgba(239,68,68,0.2)] bg-[rgba(239,68,68,0.04)]' : 'border-[var(--border)] bg-[var(--card)]',
              )}>
                <span className="flex size-4 shrink-0 items-center justify-center rounded" style={{ background: `${meta.color}20`, color: meta.color }}>
                  {meta.icon}
                </span>
                <span className="flex-1 truncate text-[var(--foreground-secondary)]">{meta.label}</span>
                {tc.isError
                  ? <X size={9} className="text-[var(--destructive)]" />
                  : <Check size={9} className="text-[var(--success)]" />}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Starter prompts per page ───────────────────────────────────────────────────

function starterPrompts(ctx: AiPanelContext | null): string[] {
  if (!ctx) return ['What endpoints are available?', 'How does auth work?', 'Search for user endpoints'];
  if (ctx.page === 'explorer' && ctx.method && ctx.path) {
    return [
      `Generate a sample request body for ${ctx.method} ${ctx.path}`,
      `What does ${ctx.method} ${ctx.path} return?`,
      ctx.responseStatus != null
        ? `Explain this ${ctx.responseStatus} response`
        : 'What are the required parameters?',
      'Show me related endpoints',
    ];
  }
  if (ctx.page === 'workflows') {
    return [
      'Add a step to create a user then fetch it',
      'Add error handling to all steps',
      'Generate a full CRUD workflow',
      'What variables can I extract from the responses?',
    ];
  }
  return ['What can I do here?', 'List available endpoints', 'How does authentication work?'];
}

// ── AiPanel ────────────────────────────────────────────────────────────────────

export function AiPanel({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [context, setContext] = useState<AiPanelContext | null>(null);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [streamingContent, setStreamingContent] = useState('');
  const [liveToolCalls, setLiveToolCalls] = useState<LiveToolCall[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  // Listen for context updates from any page
  useEffect(() => {
    const onCtx = (e: Event) => setContext((e as CustomEvent<AiPanelContext>).detail);
    window.addEventListener('set-ai-context', onCtx);
    return () => window.removeEventListener('set-ai-context', onCtx);
  }, []);

  // Listen for panel-open with optional context
  useEffect(() => {
    const onOpen = (e: Event) => {
      const detail = (e as CustomEvent<AiPanelContext | undefined>).detail;
      if (detail) setContext(detail);
    };
    window.addEventListener('open-ai-panel', onOpen);
    return () => window.removeEventListener('open-ai-panel', onOpen);
  }, []);

  // Auto-scroll
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, streamingContent]);

  const clearChat = () => {
    abortRef.current?.abort();
    setMessages([]); setStreamingContent(''); setLiveToolCalls([]); setLoading(false);
  };

  const send = useCallback(async (text?: string) => {
    const msg = (text ?? input).trim();
    if (!msg || loading) return;

    const userMsg: Message = { id: uid(), role: 'user', content: msg };
    const next = [...messages, userMsg];
    setMessages(next);
    setInput('');
    setLoading(true);
    setStreamingContent('');
    setLiveToolCalls([]);

    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const extraContext = buildExtraContext(context);

    try {
      const res = await fetch(`${CLI_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({
          messages: next.map(m => ({ role: m.role, content: m.content })),
          ...(extraContext ? { extra_context: extraContext } : {}),
        }),
        signal: ctrl.signal,
      });

      if (!res.ok || !res.body) {
        const err = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(err);
      }

      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as { type: string; [k: string]: unknown };
              if (ev.type === 'text_delta') {
                setStreamingContent(p => p + (ev.text as string));
              } else if (ev.type === 'tool_start') {
                setLiveToolCalls(p => [...p, { tool: ev.tool as string, input: (ev.input ?? {}) as Record<string, unknown>, done: false }]);
              } else if (ev.type === 'tool_done') {
                setLiveToolCalls(p => {
                  const u = [...p];
                  const ri = [...u].reverse().findIndex(tc => tc.tool === ev.tool && !tc.done);
                  if (ri !== -1) u[u.length - 1 - ri] = { ...u[u.length - 1 - ri]!, output: ev.output as string, isError: !!ev.isError, done: true };
                  return u;
                });
              } else if (ev.type === 'done') {
                const final: Message = { id: uid(), role: 'assistant', content: ev.content as string, toolCalls: ev.toolCalls as ToolCall[] };
                setMessages([...next, final]);
                setStreamingContent('');
                setLiveToolCalls([]);
              } else if (ev.type === 'error') {
                setMessages([...next, { id: uid(), role: 'assistant', content: `**Error:** ${ev.message as string}` }]);
                setStreamingContent('');
                setLiveToolCalls([]);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e) {
      if ((e as Error).name !== 'AbortError') {
        setMessages([...next, { id: uid(), role: 'assistant', content: `**Error:** ${(e as Error).message}` }]);
        setStreamingContent('');
        setLiveToolCalls([]);
      }
    } finally {
      setLoading(false);
    }
  }, [input, loading, messages, context]);

  const applyBody = (json: string) => {
    window.dispatchEvent(new CustomEvent('ai-apply-body', { detail: json }));
    setCopied(json);
    setTimeout(() => setCopied(null), 1800);
  };

  const starters = starterPrompts(context);
  const isEmpty = messages.length === 0 && !streamingContent;

  const contextLabel = context
    ? context.method && context.url
      ? `${context.method} ${context.url.length > 40 ? context.url.slice(0, 40) + '…' : context.url}`
      : context.workflowName
        ? `Workflow: ${context.workflowName}`
        : context.page
    : null;

  return (
    <>
      {/* Backdrop for mobile / click-away */}
      {open && (
        <div className="fixed inset-0 z-[49]" onClick={onClose} />
      )}

      <div className={cn(
        'fixed right-0 top-0 h-screen z-50 flex flex-col',
        'border-l border-[var(--border)] bg-[var(--background)]',
        'transition-transform duration-200 ease-out',
        'w-[340px] shadow-[-8px_0_32px_rgba(0,0,0,0.4)]',
        open ? 'translate-x-0' : 'translate-x-full',
      )}>

        {/* ── Header ── */}
        <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 h-[36px] flex-shrink-0">
          <Sparkles size={12} className="text-[var(--accent)] flex-shrink-0" />
          <span className="text-[12.5px] font-semibold text-[var(--foreground)] flex-1">AI Assistant</span>
          <button
            onClick={clearChat}
            title="New conversation"
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] hover:bg-[var(--elevated)] transition-colors border-0 bg-transparent cursor-pointer"
          >
            <RotateCcw size={11} />
          </button>
          <button
            onClick={onClose}
            className="flex items-center justify-center w-6 h-6 rounded text-[var(--placeholder-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--elevated)] transition-colors border-0 bg-transparent cursor-pointer"
          >
            <X size={13} />
          </button>
        </div>

        {/* ── Context banner ── */}
        {contextLabel && (
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-1.5 bg-[var(--card)] flex-shrink-0">
            <div className="size-1.5 rounded-full bg-[var(--accent)] flex-shrink-0" />
            <span className="text-[10.5px] font-mono text-[var(--muted-foreground)] truncate flex-1" title={contextLabel}>
              {contextLabel}
            </span>
            {context?.responseStatus != null && (
              <span className={cn(
                'text-[10px] font-mono font-bold flex-shrink-0',
                context.responseStatus < 300 ? 'text-[var(--success)]' : context.responseStatus < 500 ? 'text-[var(--warning)]' : 'text-[var(--destructive)]',
              )}>
                {context.responseStatus}
              </span>
            )}
          </div>
        )}

        {/* ── Messages ── */}
        <div className="flex-1 overflow-y-auto px-3 py-3 flex flex-col gap-4">

          {isEmpty && (
            <div className="flex flex-col gap-3 mt-4">
              <div className="flex items-center gap-2.5">
                <div className="flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)]">
                  <Bot size={13} className="text-[var(--muted-foreground)]" />
                </div>
                <p className="text-[12.5px] text-[var(--muted-foreground)] leading-relaxed">
                  {context?.page === 'explorer' && context.method
                    ? `I can see you're working on ${context.method} ${context.path ?? ''}. What would you like help with?`
                    : context?.page === 'workflows'
                      ? "I can help you build and refine this workflow step by step."
                      : "Ask me anything about this API — I can explore endpoints, execute requests, and help you build."}
                </p>
              </div>

              {/* Starter prompts */}
              <div className="flex flex-col gap-1.5 mt-1">
                {starters.map((s, i) => (
                  <button
                    key={i}
                    onClick={() => send(s)}
                    className="text-left rounded-lg border border-[var(--border)] px-3 py-2 text-[12px] text-[var(--muted-foreground)] hover:border-[var(--border-hover)] hover:text-[var(--foreground)] hover:bg-[var(--elevated)] transition-colors bg-transparent cursor-pointer font-sans"
                  >
                    {s}
                  </button>
                ))}
              </div>
            </div>
          )}

          {messages.map(m => {
            const isUser = m.role === 'user';
            const jsonBlocks = !isUser && m.content ? extractJsonBlocks(m.content) : [];
            const canApply = jsonBlocks.length > 0 && context?.page === 'explorer';

            return (
              <div key={m.id} className={cn('flex gap-2.5', isUser && 'flex-row-reverse')}>
                {/* Avatar */}
                <div className={cn(
                  'flex size-6 shrink-0 items-center justify-center rounded-full mt-0.5',
                  isUser
                    ? 'bg-[var(--foreground)] text-[var(--background)]'
                    : 'border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] text-[var(--muted-foreground)]',
                )}>
                  {isUser ? <User size={11} /> : <Bot size={11} />}
                </div>

                <div className={cn('flex flex-col gap-1 min-w-0', isUser ? 'items-end' : 'items-start', 'flex-1')}>
                  {isUser ? (
                    <div className="rounded-xl rounded-tr-sm bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] px-3 py-2 text-[12.5px] text-[var(--foreground)] max-w-[90%]">
                      {m.content}
                    </div>
                  ) : (
                    <div className="text-[12.5px] leading-relaxed text-[var(--foreground)] w-full">
                      <Markdown content={m.content} />
                      {m.toolCalls && <ToolCallsRow toolCalls={m.toolCalls} />}
                    </div>
                  )}

                  {/* Apply to body button */}
                  {canApply && (
                    <div className="flex flex-wrap gap-1.5 mt-1">
                      {jsonBlocks.map((json, i) => (
                        <button
                          key={i}
                          onClick={() => applyBody(json)}
                          className={cn(
                            'flex items-center gap-1.5 rounded-md border px-2.5 py-1 text-[11px] font-medium transition-all cursor-pointer font-sans',
                            copied === json
                              ? 'border-[rgba(74,222,128,0.3)] bg-[rgba(74,222,128,0.08)] text-[var(--success)]'
                              : 'border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] hover:border-[var(--border-hover)] hover:text-[var(--foreground)]',
                          )}
                        >
                          {copied === json ? <Check size={10} /> : <ClipboardPaste size={10} />}
                          {copied === json ? 'Applied!' : jsonBlocks.length > 1 ? `Apply JSON ${i + 1}` : 'Apply to body'}
                        </button>
                      ))}
                    </div>
                  )}

                  {/* Apply to workflow button */}
                  {!isUser && context?.page === 'workflows' && extractJsonBlocks(m.content).length > 0 && (
                    <div className="flex gap-1.5 mt-1">
                      {extractJsonBlocks(m.content).map((json, i) => (
                        <button
                          key={i}
                          onClick={() => window.dispatchEvent(new CustomEvent('ai-apply-workflow', { detail: json }))}
                          className="flex items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--card)] px-2.5 py-1 text-[11px] font-medium text-[var(--muted-foreground)] hover:border-[var(--border-hover)] hover:text-[var(--foreground)] transition-colors cursor-pointer font-sans"
                        >
                          <ClipboardPaste size={10} />
                          Apply workflow
                        </button>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            );
          })}

          {/* Streaming / loading */}
          {loading && (
            <div className="flex gap-2.5">
              <div className="flex size-6 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] text-[var(--muted-foreground)] mt-0.5">
                <Bot size={11} />
              </div>
              <div className="flex-1 min-w-0">
                {/* Live tool calls */}
                {liveToolCalls.length > 0 && (
                  <div className="mb-1.5 flex flex-col gap-1">
                    {liveToolCalls.map((tc, i) => {
                      const meta = TOOL_META[tc.tool] ?? { label: tc.tool, icon: <Zap size={10} />, color: '#8b5cf6' };
                      return (
                        <div key={i} className={cn('flex items-center gap-2 rounded-md border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[10.5px]', tc.done ? 'opacity-40' : '')}>
                          <span className="flex size-4 shrink-0 items-center justify-center rounded" style={{ background: `${meta.color}20`, color: meta.color }}>{meta.icon}</span>
                          <span className="flex-1 text-[var(--foreground-secondary)] truncate">{meta.label}</span>
                          {tc.done ? <Check size={9} className="text-[var(--success)]" /> : <span className="spinner size-3" />}
                        </div>
                      );
                    })}
                  </div>
                )}
                {streamingContent ? (
                  <div className="text-[12.5px] leading-relaxed text-[var(--foreground)]">
                    <Markdown content={streamingContent} />
                    <span className="streaming-cursor" />
                  </div>
                ) : (
                  <div className="flex items-center gap-2 text-[11.5px] text-[var(--muted-foreground)]">
                    <span className="spinner size-3" /><span>Thinking…</span>
                  </div>
                )}
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* ── Input area ── */}
        <div className="border-t border-[var(--border)] p-2 flex-shrink-0">
          <div className={cn(
            'flex items-end gap-2 rounded-xl border bg-[var(--input-bg)] px-3 py-2 transition-colors',
            'border-[var(--border)] focus-within:border-[var(--border-focus)]',
          )}>
            <textarea
              ref={textareaRef}
              rows={1}
              className="flex-1 bg-transparent border-0 outline-none resize-none text-[12.5px] text-[var(--foreground)] placeholder:text-[var(--placeholder-foreground)] font-sans leading-relaxed"
              placeholder="Ask about this API…"
              value={input}
              onChange={e => setInput(e.target.value)}
              onKeyDown={e => {
                if (e.key === 'Enter' && !e.shiftKey) {
                  e.preventDefault();
                  send();
                }
              }}
              style={{ maxHeight: 120, overflowY: 'auto' }}
            />
            <button
              onClick={() => loading ? abortRef.current?.abort() : send()}
              disabled={!input.trim() && !loading}
              className={cn(
                'flex items-center justify-center size-7 rounded-lg flex-shrink-0 border-0 cursor-pointer transition-all',
                loading
                  ? 'bg-[var(--destructive)] text-white hover:opacity-80'
                  : input.trim()
                    ? 'bg-[var(--foreground)] text-[var(--background)] hover:opacity-85'
                    : 'bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)] text-[var(--placeholder-foreground)]',
              )}
              title={loading ? 'Stop' : 'Send (Enter)'}
            >
              {loading ? <X size={11} /> : <Send size={11} />}
            </button>
          </div>
          <p className="mt-1 px-1 text-[10px] text-[var(--placeholder-foreground)]">
            Enter to send · Shift+Enter for newline
          </p>
        </div>
      </div>
    </>
  );
}
