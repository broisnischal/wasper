import { createFileRoute } from '@tanstack/react-router';
import React, { useState, useRef, useEffect } from 'react';
import { CLI_BASE_URL, authHeaders } from '../lib/api';
import {
  Bot, User, Sparkles, Trash2, ChevronDown, ChevronRight,
  Zap, Globe, Search, FileCode, Terminal, Check, X,
  Plus, MessageSquare, Clock, Wrench, Shield, KeyRound, UserCheck,
  AlertTriangle, Wifi, Activity, Plug,
} from 'lucide-react';
import { Markdown } from '../components/Markdown';
import { ChatComposer } from '../components/ChatComposer';
import { cn } from '#/lib/utils';
import { Button } from '#/components/ui/button';
import { dbPut, dbGetAll, dbDel } from '../lib/storage';

export const Route = createFileRoute('/ai')({ component: AiPage });

// ─── Types ────────────────────────────────────────────────────────────────────

interface ToolCall { tool: string; input: Record<string, unknown>; output: string; isError: boolean; }
interface LiveToolCall { tool: string; input: Record<string, unknown>; output?: string; isError?: boolean; done: boolean; }
interface Message { id: string; role: 'user' | 'assistant'; content: string; toolCalls?: ToolCall[]; }
interface StoredChat { id: string; title: string; messages: Message[]; createdAt: number; updatedAt: number; }

// ─── Tool metadata ────────────────────────────────────────────────────────────

const TOOL_META: Record<string, { label: string; icon: React.ReactNode; color: string }> = {
  search_endpoints:    { label: 'Search Endpoints',  icon: <Search className="size-3" />,       color: '#3b82f6' },
  get_endpoint_schema: { label: 'Get Schema',        icon: <FileCode className="size-3" />,     color: '#0ea5e9' },
  execute_api_request: { label: 'Execute Request',   icon: <Terminal className="size-3" />,     color: '#10b981' },
  fetch_url:           { label: 'Fetch URL',         icon: <Globe className="size-3" />,        color: '#f59e0b' },
  dns_lookup:          { label: 'DNS Lookup',        icon: <Wifi className="size-3" />,         color: '#a855f7' },
  ping_host:           { label: 'Ping / Reach',      icon: <Plug className="size-3" />,         color: '#22c55e' },
  get_recent_logs:     { label: 'Recent Logs',       icon: <Activity className="size-3" />,     color: '#3b82f6' },
  run_security_check:  { label: 'Security Check',    icon: <AlertTriangle className="size-3" />, color: '#ef4444' },
  list_auth_profiles:  { label: 'List Auth Profiles', icon: <Shield className="size-3" />,      color: '#8b5cf6' },
  set_active_auth:     { label: 'Switch Auth',       icon: <UserCheck className="size-3" />,    color: '#8b5cf6' },
  save_auth_token:     { label: 'Save Auth Token',   icon: <KeyRound className="size-3" />,     color: '#f59e0b' },
};

// ─── IDB helpers ──────────────────────────────────────────────────────────────

async function saveChat(chat: StoredChat) { return dbPut('chats', chat); }
async function getAllChats(): Promise<StoredChat[]> {
  try { return await dbGetAll<StoredChat>('chats'); } catch { return []; }
}
async function removeChat(id: string) { return dbDel('chats', id); }

function newId(suffix = '') {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 6) + suffix;
}

function chatTitle(msgs: Message[]): string {
  const first = msgs.find(m => m.role === 'user');
  if (!first) return 'New Chat';
  return first.content.slice(0, 55) + (first.content.length > 55 ? '…' : '');
}

// ─── Tool input preview ───────────────────────────────────────────────────────

function inputPreview(tc: { tool: string; input: Record<string, unknown> }): React.ReactNode {
  if (tc.tool === 'fetch_url' && tc.input.url)
    return <span className="font-mono text-[10px] opacity-70">{String(tc.input.url).slice(0, 48)}</span>;
  if (tc.tool === 'search_endpoints' && tc.input.query)
    return <span className="opacity-70">&ldquo;{String(tc.input.query)}&rdquo;</span>;
  if ((tc.tool === 'execute_api_request' || tc.tool === 'get_endpoint_schema') && tc.input.operationId)
    return <span className="font-mono text-[10px] opacity-70">{String(tc.input.operationId)}</span>;
  if (tc.tool === 'set_active_auth' && tc.input.name)
    return <span className="opacity-70">{String(tc.input.name)}</span>;
  if (tc.tool === 'save_auth_token' && tc.input.name)
    return <span className="opacity-70">{String(tc.input.name)}</span>;
  if (tc.tool === 'dns_lookup' && tc.input.hostname)
    return <span className="font-mono text-[10px] opacity-70">{String(tc.input.hostname)}</span>;
  return null;
}

// ─── ToolCallsSummary ─────────────────────────────────────────────────────────

function ToolCallsSummary({ toolCalls }: { toolCalls: ToolCall[] }) {
  const [expanded, setExpanded] = useState(false);
  const [openSet, setOpenSet] = useState<Set<number>>(new Set());

  if (!toolCalls.length) return null;

  const toggle = (i: number) => setOpenSet(prev => {
    const next = new Set(prev);
    next.has(i) ? next.delete(i) : next.add(i);
    return next;
  });

  return (
    <div className="mt-2">
      <button
        type="button"
        onClick={() => setExpanded(p => !p)}
        className="flex items-center gap-1.5 rounded-md px-2 py-1 text-[11px] text-[var(--muted-foreground)] transition-colors hover:bg-[var(--elevated)] hover:text-[var(--foreground-secondary)]"
      >
        <Wrench className="size-3 shrink-0" />
        <span>{toolCalls.length} tool{toolCalls.length > 1 ? 's' : ''} used</span>
        {expanded
          ? <ChevronDown className="size-3 shrink-0" />
          : <ChevronRight className="size-3 shrink-0" />}
      </button>

      {expanded && (
        <div className="mt-1.5 flex flex-col gap-1 pl-1">
          {toolCalls.map((tc, i) => {
            const meta = TOOL_META[tc.tool] ?? { label: tc.tool, icon: <Zap className="size-3" />, color: '#8b5cf6' };
            const isOpen = openSet.has(i);
            return (
              <div key={i} className={cn(
                'overflow-hidden rounded-lg border',
                tc.isError ? 'border-[rgba(239,68,68,0.25)] bg-[rgba(239,68,68,0.03)]' : 'border-[var(--border)] bg-[var(--card)]',
              )}>
                <button
                  type="button"
                  onClick={() => toggle(i)}
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left"
                >
                  <span className="flex size-[18px] shrink-0 items-center justify-center rounded" style={{ background: `${meta.color}20`, color: meta.color }}>
                    {meta.icon}
                  </span>
                  <span className="flex-1 text-[11.5px] font-medium text-[var(--foreground)]">
                    {meta.label}
                    <span className="ml-1.5 font-normal">{inputPreview(tc)}</span>
                  </span>
                  {tc.isError && <span className="text-[10px] text-[var(--destructive)]">error</span>}
                  {isOpen
                    ? <ChevronDown className="size-3 text-[var(--muted-foreground)]" />
                    : <ChevronRight className="size-3 text-[var(--muted-foreground)]" />}
                </button>
                {isOpen && (
                  <div className="space-y-2 border-t border-[var(--border)] px-2.5 py-2">
                    {Object.keys(tc.input).length > 0 && (
                      <div>
                        <div className="mb-1 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Input</div>
                        <pre className="m-0 max-h-44 overflow-auto rounded-md bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] p-2 font-mono text-[11px] leading-relaxed">{JSON.stringify(tc.input, null, 2)}</pre>
                      </div>
                    )}
                    <div>
                      <div className={cn('mb-1 text-[10px] font-semibold uppercase tracking-wider', tc.isError ? 'text-[var(--destructive)]' : 'text-[var(--muted-foreground)]')}>
                        {tc.isError ? 'Error' : 'Output'}
                      </div>
                      <pre className={cn('m-0 max-h-60 overflow-auto rounded-md bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)] p-2 font-mono text-[11px] leading-relaxed', tc.isError ? 'text-[var(--destructive)]' : 'text-[var(--foreground)]')}>
                        {tc.output}
                      </pre>
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function MessageBubble({ msg }: { msg: Message }) {
  const isUser = msg.role === 'user';
  return (
    <div className={cn('group flex items-start gap-3', isUser && 'flex-row-reverse')}>
      {/* Avatar */}
      <div className={cn(
        'mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full',
        isUser
          ? 'bg-[var(--foreground)]'
          : 'border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)]',
      )}>
        {isUser
          ? <User className="size-3.5 text-[var(--background)]" />
          : <Bot className="size-3.5 text-[var(--muted-foreground)]" />}
      </div>

      {/* Content */}
      <div className={cn('min-w-0', isUser ? 'max-w-[76%]' : 'flex-1')}>
        {isUser ? (
          <div className="rounded-2xl rounded-tr-sm bg-[var(--foreground)] px-4 py-2.5 text-[13.5px] leading-relaxed text-[var(--background)]">
            {msg.content}
          </div>
        ) : (
          <div className="pt-0.5">
            <Markdown content={msg.content} />
            {msg.toolCalls && msg.toolCalls.length > 0 && (
              <ToolCallsSummary toolCalls={msg.toolCalls} />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── LoadingBubble ────────────────────────────────────────────────────────────

type LoadingPhase = 'thinking' | 'executing' | 'streaming' | null;

function LoadingBubble({
  liveToolCalls, streamingContent, phase, infoMsg,
}: { liveToolCalls: LiveToolCall[]; streamingContent: string; phase: LoadingPhase; infoMsg?: string }) {
  const activeTool = liveToolCalls.find(tc => !tc.done);

  return (
    <div className="flex items-start gap-3">
      <div className="mt-0.5 flex size-7 shrink-0 items-center justify-center rounded-full border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)]">
        <Bot className="size-3.5 text-[var(--muted-foreground)]" />
      </div>
      <div className="flex-1 min-w-0 pt-0.5">
        {/* Completed + active tool calls */}
        {liveToolCalls.length > 0 && (
          <div className="mb-2 flex flex-col gap-1">
            {liveToolCalls.map((tc, i) => {
              const meta = TOOL_META[tc.tool] ?? { label: tc.tool, icon: <Zap className="size-3" />, color: '#8b5cf6' };
              return (
                <div key={i} className={cn(
                  'flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-1.5 text-[11.5px] transition-all duration-200',
                  tc.done ? 'opacity-45' : 'opacity-100',
                )}>
                  <span className="flex size-[18px] shrink-0 items-center justify-center rounded" style={{ background: `${meta.color}20`, color: meta.color }}>
                    {meta.icon}
                  </span>
                  <span className="flex-1 font-medium text-[var(--foreground)]">
                    {meta.label}
                    <span className="ml-1.5 font-normal text-[var(--muted-foreground)]">{inputPreview(tc)}</span>
                  </span>
                  <span className="ml-auto shrink-0">
                    {tc.done
                      ? (tc.isError ? <X className="size-3 text-[var(--destructive)]" /> : <Check className="size-3 text-[var(--success)]" />)
                      : <span className="spinner size-3" />}
                  </span>
                </div>
              );
            })}
          </div>
        )}

        {/* Streaming text */}
        {streamingContent ? (
          <div>
            <Markdown content={streamingContent} />
            <span style={{ display: 'inline-block', width: 7, height: 13, background: 'var(--foreground)', borderRadius: 1, opacity: 0.65, verticalAlign: 'text-bottom', marginLeft: 2, animation: 'cursor-blink 1s ease-in-out infinite' }} />
          </div>
        ) : phase === 'thinking' ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
            <span className="spinner size-3" />
            <span>Thinking…</span>
          </div>
        ) : phase === 'executing' && !activeTool ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
            <span className="spinner size-3" />
            <span>Processing…</span>
          </div>
        ) : infoMsg ? (
          <div className="flex items-center gap-2 text-[12px] text-[var(--muted-foreground)]">
            <span className="spinner size-3" />
            <span>{infoMsg}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ─── HistoryPanel ─────────────────────────────────────────────────────────────

function HistoryPanel({
  chats, activeChatId, onSelect, onDelete, onClose,
}: {
  chats: StoredChat[];
  activeChatId: string | null;
  onSelect: (chat: StoredChat) => void;
  onDelete: (id: string) => void;
  onClose: () => void;
}) {
  const sorted = [...chats].sort((a, b) => b.updatedAt - a.updatedAt);
  return (
    <div className="absolute right-0 top-full z-50 mt-1.5 w-72 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--popover)] shadow-xl">
      <div className="border-b border-[var(--border)] px-3 py-2 text-[10.5px] font-semibold uppercase tracking-widest text-[var(--muted-foreground)]">
        Chat History
      </div>
      {sorted.length === 0 ? (
        <div className="px-3 py-8 text-center text-[12px] text-[var(--muted-foreground)]">No saved chats yet</div>
      ) : (
        <div className="max-h-80 overflow-auto py-1">
          {sorted.map(chat => (
            <div
              key={chat.id}
              className={cn(
                'group flex cursor-pointer items-start gap-2.5 px-3 py-2.5 transition-colors hover:bg-[var(--elevated)]',
                activeChatId === chat.id && 'bg-[var(--elevated)]',
              )}
              onClick={() => { onSelect(chat); onClose(); }}
            >
              <MessageSquare className="mt-0.5 size-3.5 shrink-0 text-[var(--muted-foreground)]" />
              <div className="min-w-0 flex-1">
                <div className="truncate text-[12.5px] text-[var(--foreground)]">{chat.title}</div>
                <div className="mt-0.5 text-[10.5px] text-[var(--muted-foreground)]">
                  {chat.messages.length} messages · {new Date(chat.updatedAt).toLocaleDateString()}
                </div>
              </div>
              <button
                type="button"
                onClick={(e) => { e.stopPropagation(); onDelete(chat.id); }}
                className="mt-0.5 shrink-0 rounded p-0.5 text-[var(--muted-foreground)] opacity-0 transition-opacity hover:text-[var(--destructive)] group-hover:opacity-100"
              >
                <X className="size-3.5" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Starter prompts ──────────────────────────────────────────────────────────

const STARTERS: { label: string; desc: string; icon: React.ReactNode; color: string }[] = [
  { label: 'List all endpoints',        desc: 'Browse every route in the spec',        icon: <Search className="size-3.5" />,       color: '#3b82f6' },
  { label: 'How do I authenticate?',    desc: 'Find auth flows and token endpoints',    icon: <Shield className="size-3.5" />,       color: '#a78bfa' },
  { label: 'Run a health check',        desc: 'Call the health / status endpoint',      icon: <Activity className="size-3.5" />,     color: '#34d399' },
  { label: 'Check for security issues', desc: 'Scan for common API vulnerabilities',   icon: <AlertTriangle className="size-3.5" />, color: '#fbbf24' },
  { label: 'Ping the API server',       desc: 'Test connectivity to the host',         icon: <Plug className="size-3.5" />,         color: '#4ade80' },
  { label: 'DNS lookup for API host',   desc: 'Resolve DNS records for the domain',    icon: <Wifi className="size-3.5" />,         color: '#38bdf8' },
  { label: 'Generate a code example',   desc: 'Get a working snippet for an endpoint', icon: <FileCode className="size-3.5" />,     color: '#818cf8' },
  { label: 'Show recent log errors',    desc: 'Tail the proxy logs for failures',      icon: <Terminal className="size-3.5" />,     color: '#f87171' },
];

// ─── StarterCard ─────────────────────────────────────────────────────────────

function StarterCard({
  s, onSend,
}: { s: typeof STARTERS[number]; onSend: (t: string) => void }) {
  const [hov, setHov] = useState(false);
  return (
    <button
      type="button"
      onClick={() => onSend(s.label)}
      onMouseEnter={() => setHov(true)}
      onMouseLeave={() => setHov(false)}
      className="group relative flex cursor-pointer items-center gap-3 rounded-2xl p-3.5 text-left transition-all duration-150 active:scale-[0.975]"
      style={{
        border: `1px solid ${hov ? `${s.color}40` : 'color-mix(in srgb, var(--foreground) 8%, transparent)'}`,
        background: hov
          ? `color-mix(in srgb, ${s.color} 6%, var(--background))`
          : 'color-mix(in srgb, var(--foreground) 3%, transparent)',
      }}
    >
      {/* icon */}
      <span
        className="flex size-8 shrink-0 items-center justify-center rounded-xl transition-all duration-150"
        style={{
          background: hov ? `${s.color}22` : 'color-mix(in srgb, var(--foreground) 7%, transparent)',
          color: hov ? s.color : 'var(--muted-foreground)',
        }}
      >
        {s.icon}
      </span>
      {/* text */}
      <div className="min-w-0 flex-1">
        <div
          className="text-[12.5px] font-medium leading-snug transition-colors duration-150"
          style={{ color: hov ? 'var(--foreground)' : 'color-mix(in srgb, var(--foreground) 80%, transparent)' }}
        >
          {s.label}
        </div>
        <div className="mt-0.5 text-[11px] leading-snug text-[var(--muted-foreground)] opacity-70">{s.desc}</div>
      </div>
      {/* arrow */}
      <ChevronRight
        className="size-3 shrink-0 transition-all duration-150"
        style={{
          opacity: hov ? 1 : 0,
          transform: hov ? 'translateX(0)' : 'translateX(-4px)',
          color: s.color,
        }}
      />
    </button>
  );
}

// ─── AiPage ───────────────────────────────────────────────────────────────────

function AiPage() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [chatId, setChatId] = useState<string | null>(null);
  const [chatList, setChatList] = useState<StoredChat[]>([]);
  const [streamingContent, setStreamingContent] = useState('');
  const [liveToolCalls, setLiveToolCalls] = useState<LiveToolCall[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [loadingPhase, setLoadingPhase] = useState<LoadingPhase>(null);
  const [infoMsg, setInfoMsg] = useState('');
  const [historyOpen, setHistoryOpen] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);
  const historyRef = useRef<HTMLDivElement>(null);
  const composerRef = useRef<HTMLTextAreaElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  // Whether the user is parked at the bottom — only then do we auto-follow streaming.
  const pinnedRef = useRef(true);

  useEffect(() => {
    getAllChats().then(chats => {
      setChatList(chats);
      const savedId = localStorage.getItem('active_chat_id');
      if (savedId) {
        const chat = chats.find(c => c.id === savedId);
        if (chat) { setMessages(chat.messages); setChatId(chat.id); }
      }
    }).catch(() => {});
  }, []);

  // While streaming, keep the viewport glued to the bottom with an instant jump
  // (no competing smooth-scroll animations — that was the source of the jank).
  // Only follow if the user hasn't scrolled up to read.
  useEffect(() => {
    if (!pinnedRef.current) return;
    const el = scrollContainerRef.current;
    if (!el) return;
    const id = requestAnimationFrame(() => { el.scrollTop = el.scrollHeight; });
    return () => cancelAnimationFrame(id);
  }, [streamingContent, liveToolCalls.length]);

  // A committed message (send / assistant turn done) gets one smooth scroll.
  useEffect(() => {
    pinnedRef.current = true;
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length]);

  // Focus composer when '/' is pressed globally (and no other input is focused)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== '/') return;
      const tag = (e.target as HTMLElement)?.tagName?.toLowerCase();
      if (tag === 'input' || tag === 'textarea' || (e.target as HTMLElement)?.isContentEditable) return;
      e.preventDefault();
      composerRef.current?.focus();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  useEffect(() => {
    if (!historyOpen) return;
    const handler = (e: MouseEvent) => {
      if (!historyRef.current?.contains(e.target as Node)) setHistoryOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [historyOpen]);

  const stop = () => {
    abortRef.current?.abort();
    abortRef.current = null;
  };

  const handleScroll = () => {
    const el = scrollContainerRef.current;
    if (!el) return;
    const dist = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedRef.current = dist < 80;
    setShowScrollBtn(dist > 120);
  };

  const startNewChat = () => {
    setMessages([]); setChatId(null);
    setStreamingContent(''); setLiveToolCalls([]); setInput('');
    localStorage.removeItem('active_chat_id');
  };

  const loadChat = (chat: StoredChat) => {
    setMessages(chat.messages); setChatId(chat.id);
    setStreamingContent(''); setLiveToolCalls([]);
    localStorage.setItem('active_chat_id', chat.id);
  };

  const deleteChatEntry = async (id: string) => {
    await removeChat(id).catch(() => {});
    setChatList(prev => prev.filter(c => c.id !== id));
    if (chatId === id) startNewChat();
  };

  const send = async (overrideText?: string) => {
    const text = (overrideText ?? input).trim();
    if (!text || loading) return;

    const activeChatId = chatId ?? newId();
    if (!chatId) {
      setChatId(activeChatId);
      localStorage.setItem('active_chat_id', activeChatId);
    }

    const next: Message[] = [...messages, { id: newId('u'), role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    setLoadingPhase('thinking');
    setLiveToolCalls([]);
    setStreamingContent('');

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const res = await fetch(`${CLI_BASE_URL}/api/ai/chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ messages: next.map(m => ({ role: m.role, content: m.content })) }),
        signal: controller.signal,
      });

      if (!res.ok || !res.body) {
        const errText = await res.text().catch(() => `HTTP ${res.status}`);
        throw new Error(errText);
      }

      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        const parts = buf.split('\n\n');
        buf = parts.pop() ?? '';

        for (const part of parts) {
          for (const line of part.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const ev = JSON.parse(line.slice(6)) as { type: string; [k: string]: unknown };
              if (ev.type === 'info') {
                setInfoMsg(ev.message as string);
              } else if (ev.type === 'text_delta') {
                setInfoMsg('');
                setStreamingContent(prev => prev + (ev.text as string));
                setLoadingPhase('streaming');
              } else if (ev.type === 'tool_start') {
                setInfoMsg('');
                setLoadingPhase('executing');
                setLiveToolCalls(prev => [...prev, {
                  tool: ev.tool as string,
                  input: (ev.input ?? {}) as Record<string, unknown>,
                  done: false,
                }]);
              } else if (ev.type === 'tool_done') {
                setLiveToolCalls(prev => {
                  const updated = [...prev];
                  const ri = [...updated].reverse().findIndex(tc => tc.tool === ev.tool && !tc.done);
                  if (ri !== -1) {
                    const idx = updated.length - 1 - ri;
                    updated[idx] = { ...updated[idx], output: ev.output as string, isError: ev.isError as boolean, done: true };
                  }
                  return updated;
                });
              } else if (ev.type === 'done') {
                setInfoMsg('');
                const finalMsg: Message = {
                  id: newId('a'),
                  role: 'assistant',
                  content: ev.content as string,
                  toolCalls: ev.toolCalls as ToolCall[],
                };
                const finalMsgs = [...next, finalMsg];
                setMessages(finalMsgs);
                setStreamingContent('');
                setLiveToolCalls([]);
                const chat: StoredChat = {
                  id: activeChatId,
                  title: chatTitle(finalMsgs),
                  messages: finalMsgs,
                  createdAt: Date.now(),
                  updatedAt: Date.now(),
                };
                await saveChat(chat);
                setChatList(prev => [chat, ...prev.filter(c => c.id !== activeChatId)]);
              } else if (ev.type === 'error') {
                setInfoMsg('');
                setMessages([...next, { id: newId('e'), role: 'assistant', content: `**Error:** ${ev.message as string}` }]);
                setStreamingContent('');
                setLiveToolCalls([]);
              }
            } catch { /* skip malformed */ }
          }
        }
      }
    } catch (e) {
      if (e instanceof Error && e.name === 'AbortError') {
        setStreamingContent(prev => {
          if (prev.trim()) {
            setMessages(msgs => [...msgs, { id: newId('a'), role: 'assistant', content: prev }]);
          }
          return '';
        });
        setLiveToolCalls([]);
      } else {
        setMessages(prev => [...prev, { id: newId('f'), role: 'assistant', content: `**Failed to reach AI:** ${String(e)}` }]);
        setStreamingContent('');
        setLiveToolCalls([]);
      }
    } finally {
      setLoading(false);
      setLoadingPhase(null);
      setInfoMsg('');
      abortRef.current = null;
      setTimeout(() => composerRef.current?.focus(), 50);
    }
  };

  const hasMessages = messages.length > 0 || loading;

  return (
    <div className="relative flex h-full flex-col overflow-hidden bg-[var(--background)]">
      {/* Header */}
      <header className="flex shrink-0 items-center gap-2.5 border-b border-[var(--border)] px-4 py-2.5">
        <div className="flex size-[26px] items-center justify-center rounded-lg border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]">
          <Sparkles className="size-3 text-[var(--foreground)]" />
        </div>
        <div>
          <div className="text-[12.5px] font-bold leading-tight">Quiry</div>
          <div className="text-[10px] text-[var(--muted-foreground)]">Your API intelligence layer</div>
        </div>

        <div className="ml-auto flex items-center gap-1">
          {/* History */}
          <div className="relative" ref={historyRef}>
            <Button variant="ghost" size="icon-sm" onClick={() => setHistoryOpen(p => !p)} title="Chat history">
              <Clock className="size-3.5" />
            </Button>
            {historyOpen && (
              <HistoryPanel
                chats={chatList}
                activeChatId={chatId}
                onSelect={loadChat}
                onDelete={deleteChatEntry}
                onClose={() => setHistoryOpen(false)}
              />
            )}
          </div>
          {/* New chat */}
          <Button variant="ghost" size="icon-sm" onClick={startNewChat} title="New chat">
            <Plus className="size-3.5" />
          </Button>
          {/* Clear current */}
          {hasMessages && !loading && (
            <Button
              variant="ghost"
              size="icon-sm"
              onClick={() => { setMessages([]); setChatId(null); setLiveToolCalls([]); setStreamingContent(''); localStorage.removeItem('active_chat_id'); }}
              title="Clear chat"
            >
              <Trash2 className="size-3.5" />
            </Button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div ref={scrollContainerRef} onScroll={handleScroll} className="hide-scrollbar flex flex-1 flex-col gap-5 overflow-auto px-5 py-5">
        {!hasMessages ? (
          <div className="flex flex-1 flex-col items-center justify-center">
            <div className="w-full max-w-[520px] px-4">

              {/* ── Hero ── */}
              <div className="mb-8 flex flex-col items-center gap-4 text-center">
                {/* App icon */}
                <div
                  style={{
                    width: 52, height: 52, borderRadius: 14,
                    background: 'color-mix(in srgb, var(--foreground) 92%, transparent)',
                    boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 12%, transparent), 0 8px 32px color-mix(in srgb, var(--foreground) 14%, transparent)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                  }}
                >
                  <Sparkles size={22} style={{ color: 'var(--background)' }} />
                </div>

                <div>
                  <h1 className="text-[22px] font-bold tracking-[-0.5px] text-[var(--foreground)]">
                    Quiry
                  </h1>
                  <p className="mt-1.5 text-[13px] text-[var(--muted-foreground)]">
                    Your API intelligence layer
                  </p>
                </div>
              </div>

              {/* ── Suggestion grid ── */}
              <div className="grid grid-cols-2 gap-1.5">
                {STARTERS.map(s => (
                  <StarterCard key={s.label} s={s} onSend={send} />
                ))}
              </div>

            </div>
          </div>
        ) : (
          messages.map(m => <MessageBubble key={m.id} msg={m} />)
        )}
        {loading && (
          <LoadingBubble
            liveToolCalls={liveToolCalls}
            streamingContent={streamingContent}
            phase={loadingPhase}
            infoMsg={infoMsg}
          />
        )}
        <div ref={bottomRef} />
      </div>

      {showScrollBtn && (
        <div className="absolute bottom-[90px] right-5 z-10">
          <button
            onClick={() => { pinnedRef.current = true; bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }}
            className="flex items-center justify-center w-8 h-8 rounded-full border border-[var(--border)] bg-[var(--card)] text-[var(--muted-foreground)] shadow-md hover:text-[var(--foreground)] hover:border-[var(--border-hover)] transition-colors"
            title="Scroll to bottom"
          >
            <ChevronDown className="size-3.5" />
          </button>
        </div>
      )}

      {/* Composer */}
      <footer className="shrink-0 border-t border-[var(--border)] bg-[var(--background)] px-4 py-3">
        <ChatComposer ref={composerRef} value={input} onChange={setInput} onSubmit={send} onStop={stop} loading={loading} />
      </footer>
    </div>
  );
}
