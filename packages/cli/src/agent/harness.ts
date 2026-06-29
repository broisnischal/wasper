// ─── Agent Harness ────────────────────────────────────────────────────────────
//
// Unified, provider-agnostic agent execution engine.
//
// Key properties vs the old pair of loop functions:
//   • Single loop — one runAgentLoop() drives all providers through stream adapters
//   • Parallel tool execution — all tool calls in a turn run concurrently
//   • Timeout per LLM step — AbortSignal.timeout() on every request
//   • Cancellation — caller AbortSignal propagates through the whole run
//   • Token tracking — input/output/cache usage emitted after every turn
//   • Smart retry — 429/500/502/503/504 retry with backoff; 4xx are fatal
//   • Context trimming — oldest tool results dropped when message history bloats
//   • Thinking support — Anthropic extended-thinking blocks emitted as events
//   • Prompt caching — cache_control marks on system prompt for Anthropic
//   • Tool deduplication — identical calls within a turn skip the executor
// ─────────────────────────────────────────────────────────────────────────────

// ── Public types ──────────────────────────────────────────────────────────────

export type AgentEvent =
  | { type: 'thinking'; text: string }
  | { type: 'text_delta'; text: string }
  | { type: 'tool_start'; id: string; tool: string; input: Record<string, unknown>; cached: boolean }
  | { type: 'tool_done'; id: string; tool: string; output: string; isError: boolean; ms: number; cached: boolean }
  | { type: 'token_usage'; input: number; output: number; cacheRead: number; cacheWrite: number }
  | { type: 'info'; message: string }
  | { type: 'done'; content: string; toolCalls: ToolCallRecord[]; stopReason: StopReason; tokens: TokenUsage }
  | { type: 'error'; message: string; retryable: boolean };

export type StopReason =
  | 'end_turn'
  | 'max_tools'
  | 'max_errors'
  | 'max_endpoint_errors'
  | 'cancelled'
  | 'timeout'
  | 'context_limit'
  | 'max_iterations';

export interface ToolCallRecord {
  id: string;
  tool: string;
  input: Record<string, unknown>;
  output: string;
  isError: boolean;
  ms: number;
  cached: boolean;
}

export interface TokenUsage {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface HarnessConfig {
  provider: 'anthropic' | 'openai' | 'mistral' | 'groq' | 'gemini' | 'ollama' | 'custom' | 'github-copilot';
  apiKey?: string;
  model: string;
  baseUrl?: string;
  extraHeaders?: Record<string, string>;
  maxTokens?: number;
  temperature?: number;
  topK?: number;
  maxIterations?: number;
  maxTotalTools?: number;
  maxConsecutiveErrors?: number;
  maxEndpointErrors?: number;
  stepTimeoutMs?: number;
  parallelTools?: boolean;
  enablePromptCache?: boolean;
}

export type Emit = (event: AgentEvent) => void;
export type ToolExecutor = (name: string, args: Record<string, unknown>) => Promise<{ text: string; isError: boolean }>;
export type ToolCache = Map<string, { text: string; isError: boolean }>;

// Tool definitions for both wire formats
export interface ToolSchema {
  name: string;
  description: string;
  params: Record<string, unknown>;
  required: string[];
}

// ── Internal types ────────────────────────────────────────────────────────────

type Msg = { role: string; content: unknown; tool_call_id?: string };

interface TurnResult {
  text: string;
  thinking: string;
  stopReason: string;
  toolUses: { id: string; name: string; input: Record<string, unknown> }[];
  usage: TokenUsage;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function mergeSignals(a?: AbortSignal, b?: AbortSignal): AbortSignal {
  if (!a && !b) return new AbortController().signal;
  if (!a) return b!;
  if (!b) return a;
  const ctrl = new AbortController();
  const abort = () => ctrl.abort();
  a.addEventListener('abort', abort, { once: true });
  b.addEventListener('abort', abort, { once: true });
  return ctrl.signal;
}

const RETRYABLE_STATUS = new Set([429, 500, 502, 503, 504]);

async function fetchWithRetry(
  url: string,
  opts: RequestInit,
  emit: Emit,
  signal?: AbortSignal,
  maxRetries = 6,
): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const stepSignal = signal;
    let res: Response;
    try {
      res = await fetch(url, { ...opts, signal: stepSignal });
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      if (signal?.aborted) throw e;
      if (attempt === maxRetries) throw e;
      const isNetwork = msg.includes('ECONNREFUSED') || msg.includes('ENOTFOUND') || msg.includes('network') || msg.includes('fetch');
      if (!isNetwork) throw e;
      const delay = Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 15_000);
      emit({ type: 'info', message: `Network error, retrying in ${Math.round(delay / 1000)}s…` });
      await new Promise(r => setTimeout(r, delay));
      continue;
    }

    if (!RETRYABLE_STATUS.has(res.status) || attempt === maxRetries) return res;

    const retryAfter = parseInt(res.headers.get('retry-after') ?? '0', 10);
    const delay = retryAfter > 0
      ? retryAfter * 1000
      : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 300, 60_000);

    const label = res.status === 429 ? 'Rate limited' : `Server error ${res.status}`;
    emit({ type: 'info', message: `${label} — retrying in ${Math.round(delay / 1000)}s… (attempt ${attempt + 1}/${maxRetries})` });
    await new Promise(r => setTimeout(r, delay));
  }
  return fetch(url, opts);
}

// Drop oldest tool-result messages when the conversation gets large.
// ~300 000 chars ≈ 75 000 tokens — well under any provider's context window.
const MAX_CONTEXT_CHARS = 300_000;

function trimContext(messages: Msg[]): { messages: Msg[]; trimmed: boolean } {
  if (JSON.stringify(messages).length <= MAX_CONTEXT_CHARS) return { messages, trimmed: false };

  const result = [...messages];
  while (JSON.stringify(result).length > MAX_CONTEXT_CHARS && result.length > 2) {
    // Find the oldest tool result and remove it
    let removed = false;

    // OpenAI format: role='tool'
    const toolIdx = result.findIndex(m => m.role === 'tool');
    if (toolIdx !== -1) {
      result.splice(toolIdx, 1);
      // Also remove the preceding assistant message if it has no content
      if (toolIdx > 0) {
        const prev = result[toolIdx - 1];
        if (prev?.role === 'assistant') {
          const tc = (prev as Record<string, unknown>).tool_calls;
          if (Array.isArray(tc) && tc.length) result.splice(toolIdx - 1, 1);
        }
      }
      removed = true;
    }

    // Anthropic format: user message with tool_result blocks
    if (!removed) {
      const anthropicIdx = result.findIndex(m => {
        if (m.role !== 'user') return false;
        const c = m.content;
        return Array.isArray(c) && (c as Array<{ type: string }>).some(b => b.type === 'tool_result');
      });
      if (anthropicIdx !== -1) {
        result.splice(anthropicIdx, 1);
        // Remove preceding assistant message
        if (anthropicIdx > 0 && result[anthropicIdx - 1]?.role === 'assistant') {
          result.splice(anthropicIdx - 1, 1);
        }
        removed = true;
      }
    }

    if (!removed) break;
  }

  return { messages: result, trimmed: true };
}

// ── SSE line reader ───────────────────────────────────────────────────────────

async function* readSSE(body: ReadableStream<Uint8Array>): AsyncGenerator<Record<string, unknown>> {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let buf = '';

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';
      for (const part of parts) {
        let data = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) { data = line.slice(6); break; }
        }
        if (!data || data === '[DONE]') continue;
        try { yield JSON.parse(data) as Record<string, unknown>; } catch { /* malformed chunk */ }
      }
    }
  } finally {
    reader.releaseLock();
  }
}

// ── Provider: Anthropic ───────────────────────────────────────────────────────

function buildAnthropicTools(schemas: ToolSchema[], enableCache: boolean) {
  const tools: Array<Record<string, unknown>> = schemas.map(s => ({
    name: s.name,
    description: s.description,
    input_schema: { type: 'object', properties: s.params, required: s.required },
  }));
  // Cache the whole tools block (it's large and static for the run). The breakpoint
  // on the last tool covers every tool definition above it.
  if (enableCache && tools.length) {
    tools[tools.length - 1] = { ...tools[tools.length - 1], cache_control: { type: 'ephemeral' } };
  }
  return tools;
}

// Add an ephemeral cache breakpoint to a message's last content block without
// mutating the stored message (cache_control must not accumulate across turns).
function withCacheBreakpoint(msg: Msg): Msg {
  const content = (msg as { content: unknown }).content;
  if (typeof content === 'string') {
    return { ...msg, content: [{ type: 'text', text: content, cache_control: { type: 'ephemeral' } }] } as Msg;
  }
  if (Array.isArray(content) && content.length) {
    const blocks = content.map((b, i) =>
      i === content.length - 1 && b && typeof b === 'object'
        ? { ...(b as Record<string, unknown>), cache_control: { type: 'ephemeral' } }
        : b,
    );
    return { ...msg, content: blocks } as Msg;
  }
  return msg;
}

/**
 * Returns a copy of the conversation with a rolling cache breakpoint on the most
 * recent message. Anthropic matches the longest previously-cached prefix, so each
 * turn reads everything written on the prior turn — turning a growing history into
 * cheap cache reads instead of fresh input tokens (the fix for rate limits on long
 * tasks). System and tools carry their own breakpoints, so this stays within the
 * 4-breakpoint limit.
 */
function applyAnthropicCaching(messages: Msg[]): Msg[] {
  const last = messages[messages.length - 1];
  if (!last) return messages;
  const out = [...messages];
  out[out.length - 1] = withCacheBreakpoint(last);
  return out;
}

async function streamAnthropic(
  cfg: Required<HarnessConfig>,
  system: string,
  messages: Msg[],
  tools: unknown[],
  emit: Emit,
  signal: AbortSignal,
): Promise<TurnResult> {
  const base = (cfg.baseUrl || 'https://api.anthropic.com').replace(/\/$/, '');
  const systemContent = cfg.enablePromptCache
    ? [{ type: 'text', text: system, cache_control: { type: 'ephemeral' } }]
    : system;
  // Cache the conversation prefix so each turn reads (not re-bills) prior context.
  const outgoing = cfg.enablePromptCache ? applyAnthropicCaching(messages) : messages;

  const stepSignal = mergeSignals(signal, AbortSignal.timeout(cfg.stepTimeoutMs));
  const res = await fetchWithRetry(
    `${base}/v1/messages`,
    {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': cfg.apiKey,
        'anthropic-version': '2023-06-01',
        ...(cfg.enablePromptCache ? { 'anthropic-beta': 'prompt-caching-1-0' } : {}),
        ...cfg.extraHeaders,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        ...(cfg.topK > 0 ? { top_k: cfg.topK } : {}),
        system: systemContent,
        messages: outgoing,
        tools,
        stream: true,
      }),
    },
    emit,
    stepSignal,
  );

  if (!res.ok) {
    const body = await res.text();
    const retryable = RETRYABLE_STATUS.has(res.status);
    throw Object.assign(new Error(`Anthropic ${res.status}: ${body}`), { retryable });
  }

  const result: TurnResult = { text: '', thinking: '', stopReason: '', toolUses: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const blocks: Array<{ type: string; text?: string; thinking?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];
  const inputAccum: Record<number, string> = {};

  for await (const ev of readSSE(res.body!)) {
    if (signal.aborted) break;
    const evType = ev.type as string;

    if (evType === 'message_start') {
      const usage = (ev.message as Record<string, unknown>)?.usage as Record<string, number> | undefined;
      if (usage) {
        result.usage.input = usage.input_tokens ?? 0;
        result.usage.cacheRead = usage.cache_read_input_tokens ?? 0;
        result.usage.cacheWrite = usage.cache_creation_input_tokens ?? 0;
      }
    } else if (evType === 'content_block_start') {
      const idx = ev.index as number;
      const cb = ev.content_block as { type: string; id?: string; name?: string };
      blocks[idx] = { type: cb.type, id: cb.id, name: cb.name };
      if (cb.type === 'tool_use') inputAccum[idx] = '';
    } else if (evType === 'content_block_delta') {
      const idx = ev.index as number;
      const delta = ev.delta as { type: string; text?: string; thinking?: string; partial_json?: string };
      if (delta.type === 'text_delta' && delta.text) {
        result.text += delta.text;
        if (!blocks[idx]) blocks[idx] = { type: 'text' };
        blocks[idx].text = (blocks[idx].text ?? '') + delta.text;
        emit({ type: 'text_delta', text: delta.text });
      } else if (delta.type === 'thinking_delta' && delta.thinking) {
        result.thinking += delta.thinking;
        emit({ type: 'thinking', text: delta.thinking });
      } else if (delta.type === 'input_json_delta' && delta.partial_json) {
        inputAccum[idx] = (inputAccum[idx] ?? '') + delta.partial_json;
      }
    } else if (evType === 'content_block_stop') {
      const idx = ev.index as number;
      if (blocks[idx]?.type === 'tool_use') {
        try { blocks[idx].input = JSON.parse(inputAccum[idx] ?? '{}'); }
        catch { blocks[idx].input = {}; }
      }
    } else if (evType === 'message_delta') {
      const delta = ev.delta as { stop_reason?: string };
      const usage = ev.usage as Record<string, number> | undefined;
      if (delta.stop_reason) result.stopReason = delta.stop_reason;
      if (usage?.output_tokens) result.usage.output = usage.output_tokens;
    }
  }

  for (const b of blocks) {
    if (b.type === 'tool_use' && b.id && b.name) {
      result.toolUses.push({ id: b.id, name: b.name, input: b.input ?? {} });
    }
  }

  // Store full content blocks for the next message
  (result as TurnResult & { _anthropicBlocks: unknown[] })._anthropicBlocks = blocks;

  return result;
}

// ── Provider: OpenAI-compatible ───────────────────────────────────────────────

function buildOpenAITools(schemas: ToolSchema[]) {
  return schemas.map(s => ({
    type: 'function',
    function: { name: s.name, description: s.description, parameters: { type: 'object', properties: s.params, required: s.required } },
  }));
}

async function streamOpenAI(
  cfg: Required<HarnessConfig>,
  system: string,
  messages: Msg[],
  tools: unknown[],
  emit: Emit,
  signal: AbortSignal,
): Promise<TurnResult> {
  const providerBases: Record<string, string> = {
    openai: 'https://api.openai.com',
    mistral: 'https://api.mistral.ai',
    groq: 'https://api.groq.com/openai',
    'github-copilot': 'https://api.githubcopilot.com',
  };
  const base = (cfg.baseUrl || providerBases[cfg.provider] || 'https://api.openai.com').replace(/\/$/, '');
  const providerHeaders: Record<string, string> =
    cfg.provider === 'github-copilot'
      ? { 'Copilot-Integration-Id': 'vscode-chat', 'Editor-Version': 'vscode/1.85.0' }
      : {};

  const authHeaders: Record<string, string> = cfg.apiKey ? { Authorization: `Bearer ${cfg.apiKey}` } : {};

  const stepSignal = mergeSignals(signal, AbortSignal.timeout(cfg.stepTimeoutMs));
  const res = await fetchWithRetry(
    `${base}/v1/chat/completions`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...providerHeaders, ...cfg.extraHeaders },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: cfg.maxTokens,
        temperature: cfg.temperature,
        messages: [{ role: 'system', content: system }, ...messages],
        tools,
        tool_choice: 'auto',
        stream: true,
        stream_options: { include_usage: true },
      }),
    },
    emit,
    stepSignal,
  );

  if (!res.ok) {
    const body = await res.text();
    const retryable = RETRYABLE_STATUS.has(res.status);
    throw Object.assign(new Error(body), { retryable });
  }

  const result: TurnResult = { text: '', thinking: '', stopReason: '', toolUses: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
  const tcAccum: Record<number, { id: string; name: string; args: string }> = {};

  for await (const ev of readSSE(res.body!)) {
    if (signal.aborted) break;

    // Inline error object (e.g. Groq rate limit sent mid-stream)
    if (ev.object === 'error') {
      const retryable = (ev.code === '1300' || ev.raw_status_code === 429 || ev.raw_status_code === 503);
      throw Object.assign(new Error(JSON.stringify(ev)), { retryable });
    }

    // Token usage (sent in final chunk when stream_options.include_usage = true)
    if (ev.usage) {
      const u = ev.usage as Record<string, number>;
      result.usage.input = u.prompt_tokens ?? 0;
      result.usage.output = u.completion_tokens ?? 0;
    }

    const choices = ev.choices as Array<Record<string, unknown>> | undefined;
    const choice = choices?.[0];
    if (!choice) continue;

    const fr = choice.finish_reason as string | null;
    if (fr) result.stopReason = fr;

    const delta = choice.delta as Record<string, unknown> | undefined;
    if (!delta) continue;

    if (typeof delta.content === 'string' && delta.content) {
      result.text += delta.content;
      emit({ type: 'text_delta', text: delta.content });
    }

    const tcDeltas = delta.tool_calls as Array<{ index: number; id?: string; function?: { name?: string; arguments?: string } }> | undefined;
    if (tcDeltas) {
      for (const tc of tcDeltas) {
        if (!tcAccum[tc.index]) tcAccum[tc.index] = { id: '', name: '', args: '' };
        const e = tcAccum[tc.index]!;
        if (tc.id) e.id += tc.id;
        if (tc.function?.name) e.name += tc.function.name;
        if (tc.function?.arguments) e.args += tc.function.arguments;
      }
    }
  }

  for (const tc of Object.values(tcAccum)) {
    let input: Record<string, unknown> = {};
    try { input = JSON.parse(tc.args); } catch { /* malformed args */ }
    result.toolUses.push({ id: tc.id, name: tc.name, input });
  }

  (result as TurnResult & { _openaiTcAccum: typeof tcAccum })._openaiTcAccum = tcAccum;

  return result;
}

// ── Provider: Ollama (non-streaming, no tools) ────────────────────────────────

async function callOllama(
  cfg: Required<HarnessConfig>,
  system: string,
  messages: Msg[],
  emit: Emit,
  signal: AbortSignal,
): Promise<TurnResult> {
  const base = (cfg.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
  const stepSignal = mergeSignals(signal, AbortSignal.timeout(cfg.stepTimeoutMs));
  const res = await fetchWithRetry(
    `${base}/api/chat`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ model: cfg.model, messages: [{ role: 'system', content: system }, ...messages], stream: false }),
    },
    emit,
    stepSignal,
  );
  if (!res.ok) throw new Error(`Ollama ${res.status}: ${await res.text()}`);
  const d = await res.json() as { message?: { content?: string } };
  const text = d.message?.content ?? '';
  emit({ type: 'text_delta', text });
  return { text, thinking: '', stopReason: 'end_turn', toolUses: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

// ── Provider: Gemini (non-streaming, no tool loop) ────────────────────────────

async function callGemini(
  cfg: Required<HarnessConfig>,
  system: string,
  messages: Msg[],
  emit: Emit,
  signal: AbortSignal,
): Promise<TurnResult> {
  const base = (cfg.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
  const stepSignal = mergeSignals(signal, AbortSignal.timeout(cfg.stepTimeoutMs));
  const res = await fetchWithRetry(
    `${base}/v1beta/models/${cfg.model}:generateContent?key=${cfg.apiKey}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        systemInstruction: { parts: [{ text: system }] },
        contents: (messages as Array<{ role: string; content: string }>).map(m => ({
          role: m.role === 'assistant' ? 'model' : 'user',
          parts: [{ text: m.content }],
        })),
        generationConfig: { maxOutputTokens: cfg.maxTokens },
      }),
    },
    emit,
    stepSignal,
  );
  if (!res.ok) throw new Error(`Gemini ${res.status}: ${await res.text()}`);
  const d = await res.json() as { candidates?: Array<{ content?: { parts?: Array<{ text?: string }> } }> };
  const text = d.candidates?.[0]?.content?.parts?.[0]?.text ?? '';
  emit({ type: 'text_delta', text });
  return { text, thinking: '', stopReason: 'end_turn', toolUses: [], usage: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 } };
}

// ── Main loop ─────────────────────────────────────────────────────────────────

const DEFAULTS: Required<Omit<HarnessConfig, 'provider' | 'model'>> = {
  apiKey: '',
  baseUrl: '',
  extraHeaders: {},
  maxTokens: 4096,
  temperature: 1.0,
  topK: 0,
  maxIterations: 40,
  maxTotalTools: 40,
  maxConsecutiveErrors: 5,
  maxEndpointErrors: 3,
  stepTimeoutMs: 60_000,
  parallelTools: true,
  enablePromptCache: true,
};

export async function runAgentLoop(
  config: HarnessConfig,
  system: string,
  initialMessages: Msg[],
  toolSchemas: ToolSchema[],
  executeTool: ToolExecutor,
  emit: Emit,
  signal: AbortSignal = new AbortController().signal,
  toolCache: ToolCache = new Map(),
): Promise<{ content: string; toolCalls: ToolCallRecord[]; stopReason: StopReason; tokens: TokenUsage }> {
  const cfg = { ...DEFAULTS, ...config } as Required<HarnessConfig>;
  const isAnthropic = cfg.provider === 'anthropic';
  const isOllama = cfg.provider === 'ollama';
  const isGemini = cfg.provider === 'gemini';

  const anthropicTools = buildAnthropicTools(toolSchemas, cfg.enablePromptCache);
  const openaiTools = buildOpenAITools(toolSchemas);

  const messages: Msg[] = [...initialMessages];
  const allToolCalls: ToolCallRecord[] = [];
  const totalTokens: TokenUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };

  let totalToolsUsed = 0;
  let consecutiveErrors = 0;
  const endpointErrors: Record<string, number> = {};

  for (let iter = 0; iter < cfg.maxIterations; iter++) {
    if (signal.aborted) {
      return { content: '', toolCalls: allToolCalls, stopReason: 'cancelled', tokens: totalTokens };
    }

    // Trim context if needed
    const { messages: trimmed, trimmed: didTrim } = trimContext(messages);
    if (didTrim) {
      emit({ type: 'info', message: 'Context trimmed to fit within limits.' });
      messages.splice(0, messages.length, ...trimmed);
    }

    // Stream one LLM turn — retry rate-limit / transient errors with backoff.
    // Some providers return HTTP 200 then stream an error event (e.g. code 1300 /
    // raw_status_code 429), which fetchWithRetry can't catch, so we retry here.
    let turn!: TurnResult;
    const MAX_TURN_RETRIES = 6;
    for (let turnAttempt = 0; ; turnAttempt++) {
      try {
        if (isAnthropic) {
          turn = await streamAnthropic(cfg, system, messages, anthropicTools, emit, signal);
        } else if (isOllama) {
          turn = await callOllama(cfg, system, messages, emit, signal);
        } else if (isGemini) {
          turn = await callGemini(cfg, system, messages, emit, signal);
        } else {
          turn = await streamOpenAI(cfg, system, messages, openaiTools, emit, signal);
        }
        break;
      } catch (e) {
        if (signal.aborted) {
          return { content: '', toolCalls: allToolCalls, stopReason: 'cancelled', tokens: totalTokens };
        }
        const msg = e instanceof Error ? e.message : String(e);
        const retryAfterMatch = msg.match(/"retry_after"\s*:\s*(\d+)/);
        const retryable = (e as { retryable?: boolean }).retryable ?? false;
        if (retryable && turnAttempt < MAX_TURN_RETRIES) {
          const delay = retryAfterMatch
            ? Math.min(parseInt(retryAfterMatch[1]!, 10) * 1000, 60_000)
            : Math.min(2000 * Math.pow(2, turnAttempt) + Math.random() * 500, 60_000);
          emit({ type: 'info', message: `Rate limited — retrying in ${Math.round(delay / 1000)}s… (attempt ${turnAttempt + 1}/${MAX_TURN_RETRIES})` });
          await new Promise(r => setTimeout(r, delay));
          continue;
        }
        emit({ type: 'error', message: retryable ? `Rate limit exceeded after ${MAX_TURN_RETRIES} retries. Wait a moment and try again.` : msg, retryable });
        throw e;
      }
    }

    // Accumulate token usage
    totalTokens.input += turn.usage.input;
    totalTokens.output += turn.usage.output;
    totalTokens.cacheRead += turn.usage.cacheRead;
    totalTokens.cacheWrite += turn.usage.cacheWrite;
    if (turn.usage.input || turn.usage.output) {
      emit({ type: 'token_usage', ...turn.usage });
    }

    // No tool calls — we're done
    const wantsTools = isAnthropic ? turn.stopReason === 'tool_use' : turn.stopReason === 'tool_calls';
    if (!wantsTools || turn.toolUses.length === 0) {
      return { content: turn.text, toolCalls: allToolCalls, stopReason: 'end_turn', tokens: totalTokens };
    }

    // Guard: total tool budget
    if (totalToolsUsed >= cfg.maxTotalTools) {
      return {
        content: `Agent stopped: reached ${cfg.maxTotalTools} tool calls. Break your request into smaller steps.`,
        toolCalls: allToolCalls,
        stopReason: 'max_tools',
        tokens: totalTokens,
      };
    }

    // ── Execute all tool calls (optionally in parallel) ─────────────────────

    // Deduplicate: identical (name, args) pairs within a turn skip the executor
    const dedupeKey = (name: string, input: Record<string, unknown>) =>
      `${name}:${JSON.stringify(input)}`;

    const turnResults: Array<{ id: string; name: string; text: string; isError: boolean; ms: number; cached: boolean }> = [];

    const executeOne = async (use: { id: string; name: string; input: Record<string, unknown> }) => {
      totalToolsUsed++;
      const key = dedupeKey(use.name, use.input);
      const cachedResult = toolCache.get(key);
      const isCached = !!cachedResult;

      emit({ type: 'tool_start', id: use.id, tool: use.name, input: use.input, cached: isCached });

      let result: { text: string; isError: boolean };
      let ms = 0;

      if (isCached) {
        result = cachedResult;
      } else {
        const t0 = Date.now();
        result = await executeTool(use.name, use.input);
        ms = Date.now() - t0;
        // Cache pure read tools (not execute_api_request which has side effects)
        if (!result.isError && use.name !== 'execute_api_request' && use.name !== 'fetch_url') {
          toolCache.set(key, result);
        }
      }

      emit({ type: 'tool_done', id: use.id, tool: use.name, output: result.text, isError: result.isError, ms, cached: isCached });
      return { id: use.id, name: use.name, text: result.text, isError: result.isError, ms, cached: isCached };
    };

    const toolUses = turn.toolUses;

    if (cfg.parallelTools && toolUses.length > 1) {
      // Separate cacheable from side-effecting tools: run side-effecting ones serially,
      // pure ones in parallel with each other.
      const pure = toolUses.filter(u => u.name !== 'execute_api_request' && u.name !== 'fetch_url');
      const sideEffect = toolUses.filter(u => u.name === 'execute_api_request' || u.name === 'fetch_url');

      const pureResults = await Promise.all(pure.map(u => executeOne(u)));
      const sideEffectResults: typeof pureResults = [];
      for (const u of sideEffect) sideEffectResults.push(await executeOne(u));

      // Restore original order
      const resultMap = new Map([...pureResults, ...sideEffectResults].map(r => [r.id, r]));
      for (const u of toolUses) {
        const r = resultMap.get(u.id);
        if (r) turnResults.push(r);
      }
    } else {
      for (const u of toolUses) turnResults.push(await executeOne(u));
    }

    // Track errors
    for (const r of turnResults) {
      allToolCalls.push({ id: r.id, tool: r.name, input: turn.toolUses.find(u => u.id === r.id)?.input ?? {}, output: r.text, isError: r.isError, ms: r.ms, cached: r.cached });

      if (r.isError) {
        consecutiveErrors++;
        if (r.name === 'execute_api_request') {
          const eid = String(turn.toolUses.find(u => u.id === r.id)?.input?.operationId ?? r.id);
          endpointErrors[eid] = (endpointErrors[eid] ?? 0) + 1;
          if (endpointErrors[eid] >= cfg.maxEndpointErrors) {
            return {
              content: `Endpoint "${eid}" failed ${cfg.maxEndpointErrors} times. Last error: ${r.text}`,
              toolCalls: allToolCalls,
              stopReason: 'max_endpoint_errors',
              tokens: totalTokens,
            };
          }
        }
        if (consecutiveErrors >= cfg.maxConsecutiveErrors) {
          return {
            content: `Stopped after ${cfg.maxConsecutiveErrors} consecutive errors. Last: ${r.text}`,
            toolCalls: allToolCalls,
            stopReason: 'max_errors',
            tokens: totalTokens,
          };
        }
      } else {
        consecutiveErrors = 0;
      }
    }

    // Append assistant turn + tool results to message history
    if (isAnthropic) {
      const blocks = (turn as TurnResult & { _anthropicBlocks?: unknown[] })._anthropicBlocks ?? [];
      messages.push({ role: 'assistant', content: blocks });
      messages.push({
        role: 'user',
        content: turnResults.map(r => ({ type: 'tool_result', tool_use_id: r.id, content: r.text })),
      });
    } else {
      const tc = (turn as TurnResult & { _openaiTcAccum?: Record<number, { id: string; name: string; args: string }> })._openaiTcAccum ?? {};
      messages.push({
        role: 'assistant',
        content: turn.text || null,
        tool_calls: Object.values(tc).map(t => ({ id: t.id, type: 'function', function: { name: t.name, arguments: t.args } })),
      } as Msg);
      for (const r of turnResults) {
        messages.push({ role: 'tool', tool_call_id: r.id, content: r.text });
      }
    }
  }

  return { content: '(max iterations reached)', toolCalls: allToolCalls, stopReason: 'max_iterations', tokens: totalTokens };
}
