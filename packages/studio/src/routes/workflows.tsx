import { useState, useEffect, useCallback, useRef } from 'react';
import { createFileRoute } from '@tanstack/react-router';
import {
  ReactFlow,
  Background,
  BackgroundVariant,
  Controls,
  Handle,
  Position,
  useNodesState,
  useEdgesState,
  type Node,
  type Edge,
  type NodeProps,
  type NodeChange,
  MarkerType,
  Panel,
} from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { CLI_BASE_URL, authHeaders } from '../lib/api';
import { cn } from '../lib/utils';
import { Button } from '../components/ui/button';
import {
  Workflow, Plus, Trash2, Play, Square, Sparkles, X,
  Check, Loader2, AlertCircle, Zap, Bot,
} from 'lucide-react';

export const Route = createFileRoute('/workflows')({ component: WorkflowsPage });

// ── Types ──────────────────────────────────────────────────────────────────────

interface Assertion {
  type: 'status' | 'json';
  statusCode?: number;
  path?: string;
  eq?: unknown;
  contains?: string;
}

interface ExtractVar {
  var: string;
  path: string;
}

interface WorkflowStep {
  id: string;
  label: string;
  method: string;
  path: string;
  operationId?: string;
  position?: { x: number; y: number };
  pathParams?: Record<string, string>;
  queryParams?: Record<string, string>;
  headers?: Record<string, string>;
  body?: unknown;
  extract?: ExtractVar[];
  assert?: Assertion[];
}

interface WfRecord {
  id: string;
  name: string;
  description: string;
  steps: WorkflowStep[];
  created_at: number;
  updated_at: number;
}

interface StepDone {
  status: 'done';
  pass: boolean;
  httpStatus: number;
  httpStatusText: string;
  latency: number;
  requestUrl: string;
  requestMethod: string;
  requestHeaders: Record<string, string>;
  requestBody?: string;
  responseHeaders: Record<string, string>;
  responseBody: string;
  assertions: { pass: boolean; message: string }[];
  extractedVars: Record<string, string>;
}

type StepStatus =
  | { status: 'idle' }
  | { status: 'running' }
  | StepDone
  | { status: 'error'; message: string };

interface RunState {
  active: boolean;
  steps: Record<string, StepStatus>;
  passedCount: number;
  totalCount: number;
  done: boolean;
}

interface NodeData extends Record<string, unknown> {
  step: WorkflowStep;
  runState?: StepStatus;
}

// ── Constants ──────────────────────────────────────────────────────────────────

const METHOD_COLORS: Record<string, string> = {
  GET: '#22c55e',
  POST: '#3b82f6',
  PUT: '#f59e0b',
  PATCH: '#8b5cf6',
  DELETE: '#ef4444',
};
function mc(method: string) { return METHOD_COLORS[method.toUpperCase()] ?? '#6b7280'; }

// ── Helpers ────────────────────────────────────────────────────────────────────

function newId() { return `step_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 6)}`; }

function blankStep(steps: WorkflowStep[]): WorkflowStep {
  const last = steps[steps.length - 1];
  const lastPos = last?.position ?? { x: 260, y: 80 + Math.max(0, steps.length - 1) * 185 };
  return {
    id: newId(),
    label: 'New Step',
    method: 'GET',
    path: '/',
    position: { x: lastPos.x, y: lastPos.y + 185 },
    extract: [],
    assert: [{ type: 'status', statusCode: 200 }],
  };
}

function buildNodes(
  steps: WorkflowStep[],
  runStates: Record<string, StepStatus>,
  posOverride: Record<string, { x: number; y: number }>,
): Node<NodeData>[] {
  return steps.map((step, i) => ({
    id: step.id,
    type: 'apiNode',
    position: posOverride[step.id] ?? step.position ?? { x: 260, y: 80 + i * 185 },
    data: { step, runState: runStates[step.id] },
  }));
}

function buildEdges(steps: WorkflowStep[], runActive: boolean): Edge[] {
  return steps.slice(0, -1).map((step, i) => {
    const next = steps[i + 1]!;
    return {
      id: `e_${step.id}`,
      source: step.id,
      target: next.id,
      type: 'smoothstep',
      animated: runActive,
      markerEnd: { type: MarkerType.ArrowClosed, width: 12, height: 12, color: '#374151' },
      style: { stroke: '#374151', strokeWidth: 1.5 },
    };
  });
}

// ── Shared form primitives ─────────────────────────────────────────────────────

const fieldCls = 'w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 font-sans text-[12.5px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--placeholder-foreground)] focus:border-[var(--border-focus)] hover:border-[var(--border-hover)]';
const monoCls = 'w-full rounded-md border border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-1.5 font-mono text-[11.5px] text-[var(--foreground)] outline-none transition-colors placeholder:text-[var(--placeholder-foreground)] focus:border-[var(--border-focus)] hover:border-[var(--border-hover)]';
const sectionLabel = 'mb-2 block text-[11px] font-semibold text-[var(--muted-foreground)]';

function FieldLabel({ children }: { children: React.ReactNode }) {
  return <label className={sectionLabel}>{children}</label>;
}

// ── KVEditor ───────────────────────────────────────────────────────────────────

function KVEditor({ data, onChange, vPlaceholder = 'value' }: {
  data: Record<string, string>;
  onChange: (d: Record<string, string>) => void;
  vPlaceholder?: string;
}) {
  const entries = Object.entries(data);
  return (
    <div className="flex flex-col gap-1.5">
      {entries.length > 0 && (
        <div className="rounded-md border border-[var(--border)] overflow-hidden">
          {entries.map(([k, v], idx) => (
            <div key={k || idx} className={cn('flex items-stretch min-w-0', idx > 0 && 'border-t border-[var(--border)]')}>
              <input
                className="w-[100px] shrink-0 border-r border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none focus:bg-[var(--elevated)] placeholder:text-[var(--placeholder-foreground)]"
                value={k} placeholder="key"
                onChange={e => {
                  const next = Object.fromEntries(entries.map(([ek, ev]) => [ek === k ? e.target.value : ek, ev]));
                  onChange(next);
                }}
              />
              <input
                className="flex-1 min-w-0 bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none focus:bg-[var(--elevated)] placeholder:text-[var(--placeholder-foreground)]"
                value={v} placeholder={vPlaceholder}
                onChange={e => onChange({ ...data, [k]: e.target.value })}
              />
              <button type="button"
                onClick={() => { const n = { ...data }; delete n[k]; onChange(n); }}
                className="shrink-0 px-2 text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--elevated)] transition-colors">
                <X size={11} />
              </button>
            </div>
          ))}
        </div>
      )}
      <button type="button" onClick={() => onChange({ ...data, '': '' })}
        className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)] hover:bg-[var(--elevated)] transition-colors w-fit">
        <Plus size={11} /> Add
      </button>
    </div>
  );
}

// ── ApiNode ────────────────────────────────────────────────────────────────────

function ApiNode({ data, selected }: NodeProps) {
  const { step, runState } = data as NodeData;
  const method = step.method.toUpperCase();
  const color = mc(method);
  const st = runState?.status ?? 'idle';
  const isDone = st === 'done';
  const isError = st === 'error';
  const isRunning = st === 'running';
  const isPass = isDone && (runState as { pass: boolean }).pass;
  const isFail = (isDone && !(runState as { pass: boolean }).pass) || isError;

  return (
    <div
      className={cn(
        'w-[270px] rounded-xl border bg-[var(--card)] shadow-lg overflow-hidden transition-all duration-150 cursor-pointer select-none',
        !isPass && !isFail && !isRunning && (selected
          ? 'border-[var(--accent)] shadow-[0_0_0_1px_var(--accent),0_4px_20px_rgba(0,0,0,0.3)]'
          : 'border-[var(--border)] hover:border-[var(--border-hover)]'),
        isRunning && 'border-[var(--accent)] shadow-[0_0_16px_rgba(99,102,241,0.2)]',
        isPass && !selected && 'border-[#22c55e44]',
        isFail && !selected && 'border-[#ef444444]',
      )}
    >
      <Handle
        type="target"
        position={Position.Top}
        style={{ background: '#4b5563', width: 8, height: 8, border: '2px solid var(--card)', top: -4 }}
      />

      {/* Top color stripe */}
      <div style={{ height: 3, background: isRunning ? 'var(--accent)' : isPass ? '#22c55e' : isFail ? '#ef4444' : color }} />

      {/* Header row */}
      <div className="flex items-center gap-2 px-3 py-2.5">
        <span
          className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold tracking-wider leading-none"
          style={{ color, background: `${color}22` }}
        >
          {method}
        </span>
        <span className="flex-1 truncate text-[12.5px] font-medium text-[var(--foreground)] leading-tight">
          {step.label}
        </span>
        <span className="shrink-0 ml-1 w-3 flex items-center justify-center">
          {isRunning && <Loader2 size={11} className="animate-spin text-[var(--accent)]" />}
          {isPass && <Check size={11} className="text-[#22c55e]" />}
          {isFail && <X size={11} className="text-[#ef4444]" />}
        </span>
      </div>

      {/* Path */}
      <div className="border-t border-[var(--border)] px-3 py-1.5">
        <span className="font-mono text-[10.5px] text-[var(--muted-foreground)] break-all leading-relaxed">
          {step.path}
        </span>
      </div>

      {/* Run result */}
      {isDone && (
        <div className="border-t border-[var(--border)] flex items-center gap-1.5 px-3 py-1.5">
          <span className={cn('font-mono text-[11px] font-semibold', isPass ? 'text-[#22c55e]' : 'text-[#ef4444]')}>
            {(runState as { httpStatus: number }).httpStatus}
          </span>
          <span className="text-[10px] text-[var(--muted-foreground)]">
            {(runState as { latency: number }).latency}ms
          </span>
          {Object.keys((runState as { extractedVars: Record<string, string> }).extractedVars ?? {}).length > 0 && (
            <span className="ml-auto flex items-center gap-0.5 text-[10px] text-[#8b5cf6]">
              <Zap size={9} />
              {Object.keys((runState as { extractedVars: Record<string, string> }).extractedVars).length}v
            </span>
          )}
        </div>
      )}
      {isError && (
        <div className="border-t border-[var(--border)] px-3 py-1.5">
          <span className="text-[10px] text-[#ef4444] line-clamp-2">
            {(runState as { message: string }).message}
          </span>
        </div>
      )}

      <Handle
        type="source"
        position={Position.Bottom}
        style={{ background: '#4b5563', width: 8, height: 8, border: '2px solid var(--card)', bottom: -4 }}
      />
    </div>
  );
}

const nodeTypes = { apiNode: ApiNode };

// ── ResultViewer ──────────────────────────────────────────────────────────────

function HeadersTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (!entries.length) return <p className="text-[11px] text-[var(--muted-foreground)] italic">No headers</p>;
  return (
    <div className="rounded-lg border border-[var(--border)] overflow-hidden">
      {entries.map(([k, v], i) => (
        <div key={k} className={cn('flex gap-0 min-w-0', i > 0 && 'border-t border-[var(--border)]')}>
          <span className="w-[130px] shrink-0 px-2.5 py-1.5 font-mono text-[10px] text-[var(--muted-foreground)] border-r border-[var(--border)] break-all">{k}</span>
          <span className="flex-1 px-2.5 py-1.5 font-mono text-[10px] text-[var(--foreground-secondary)] break-all">{v}</span>
        </div>
      ))}
    </div>
  );
}

function BodyBlock({ raw }: { raw: string | undefined }) {
  if (!raw) return <p className="text-[11px] text-[var(--muted-foreground)] italic">Empty</p>;
  let formatted = raw;
  try { formatted = JSON.stringify(JSON.parse(raw), null, 2); } catch { /* keep raw */ }
  return (
    <pre className="max-h-[400px] overflow-auto rounded-lg bg-[var(--elevated)] p-2.5 font-mono text-[10.5px] text-[var(--foreground-secondary)] leading-relaxed whitespace-pre-wrap break-all">
      {formatted}
    </pre>
  );
}

function ResultViewer({ r }: { r: StepDone }) {
  const [view, setView] = useState<'overview' | 'request' | 'response'>('overview');

  const tabs: { id: typeof view; label: string }[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'request',  label: 'Request'  },
    { id: 'response', label: 'Response' },
  ];

  return (
    <div className="flex flex-col min-h-0">
      {/* Sub-tab bar */}
      <div className="flex gap-2 border-b border-[var(--border)] px-3">
        {tabs.map(t => (
          <button key={t.id} type="button" onClick={() => setView(t.id)}
            className={cn('py-2 text-[10.5px] font-medium border-b-[1.5px] transition-colors',
              view === t.id
                ? 'border-[var(--foreground)] text-[var(--foreground)]'
                : 'border-transparent text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)]'
            )}>
            {t.label}
          </button>
        ))}
      </div>

      <div className="px-3 py-3 space-y-3 overflow-y-auto">

        {/* ── Overview ── */}
        {view === 'overview' && (
          <>
            {/* Status + timing */}
            <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2.5', r.pass ? 'bg-[#22c55e0d] border border-[#22c55e33]' : 'bg-[#ef44440d] border border-[#ef444433]')}>
              <span className={cn('font-mono text-[15px] font-bold', r.pass ? 'text-[#22c55e]' : 'text-[#ef4444]')}>{r.httpStatus}</span>
              <span className="text-[11.5px] text-[var(--muted-foreground)]">{r.httpStatusText}</span>
              <span className="ml-auto font-mono text-[11px] text-[var(--muted-foreground)]">{r.latency}ms</span>
              {r.pass ? <Check size={13} className="text-[#22c55e] shrink-0" /> : <X size={13} className="text-[#ef4444] shrink-0" />}
            </div>

            {/* Assertions */}
            {r.assertions.length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Assertions</p>
                <div className="flex flex-col gap-1">
                  {r.assertions.map((a, i) => (
                    <div key={i} className={cn('flex items-start gap-2 rounded-lg px-2.5 py-2', a.pass ? 'bg-[#22c55e0d]' : 'bg-[#ef44440d]')}>
                      {a.pass
                        ? <Check size={11} className="mt-0.5 shrink-0 text-[#22c55e]" />
                        : <X size={11} className="mt-0.5 shrink-0 text-[#ef4444]" />}
                      <span className={cn('font-mono text-[11px] break-all', a.pass ? 'text-[#22c55e]' : 'text-[#ef4444]')}>{a.message}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Extracted variables */}
            {Object.keys(r.extractedVars).length > 0 && (
              <div>
                <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Extracted Variables</p>
                <div className="flex flex-col gap-1">
                  {Object.entries(r.extractedVars).map(([k, v]) => (
                    <div key={k} className="flex items-start gap-1.5 rounded-lg px-2.5 py-2 bg-[#8b5cf60d] border border-[#8b5cf622]">
                      <Zap size={10} className="mt-0.5 shrink-0 text-[#8b5cf6]" />
                      <div className="min-w-0 flex-1">
                        <span className="font-mono text-[10.5px] font-semibold text-[#8b5cf6]">{k}</span>
                        <span className="text-[10px] text-[var(--muted-foreground)]"> = </span>
                        <span className="font-mono text-[10.5px] text-[var(--foreground-secondary)] break-all">
                          {String(v).length > 200 ? String(v).slice(0, 200) + '…' : String(v)}
                        </span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {r.assertions.length === 0 && Object.keys(r.extractedVars).length === 0 && (
              <p className="text-[11.5px] text-[var(--muted-foreground)]">No assertions or variables configured.</p>
            )}
          </>
        )}

        {/* ── Request ── */}
        {view === 'request' && (
          <>
            {/* Method + URL */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">URL</p>
              <div className="flex items-center gap-2 rounded-lg bg-[var(--elevated)] px-2.5 py-2">
                <span
                  className="shrink-0 rounded px-1.5 py-0.5 font-mono text-[10px] font-bold"
                  style={{ color: mc(r.requestMethod), background: `${mc(r.requestMethod)}22` }}
                >
                  {r.requestMethod}
                </span>
                <span className="font-mono text-[10.5px] text-[var(--foreground-secondary)] break-all">{r.requestUrl}</span>
              </div>
            </div>

            {/* Request headers */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Headers</p>
              <HeadersTable headers={r.requestHeaders} />
            </div>

            {/* Request body */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Body</p>
              <BodyBlock raw={r.requestBody} />
            </div>
          </>
        )}

        {/* ── Response ── */}
        {view === 'response' && (
          <>
            {/* Status line */}
            <div className={cn('flex items-center gap-2 rounded-lg px-3 py-2', r.pass ? 'bg-[#22c55e0d] border border-[#22c55e33]' : 'bg-[#ef44440d] border border-[#ef444433]')}>
              <span className={cn('font-mono text-[14px] font-bold', r.pass ? 'text-[#22c55e]' : 'text-[#ef4444]')}>{r.httpStatus}</span>
              <span className="text-[11px] text-[var(--muted-foreground)]">{r.httpStatusText}</span>
              <span className="ml-auto font-mono text-[11px] text-[var(--muted-foreground)]">{r.latency}ms</span>
            </div>

            {/* Response headers */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Headers</p>
              <HeadersTable headers={r.responseHeaders} />
            </div>

            {/* Response body */}
            <div>
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--muted-foreground)]">Body</p>
              <BodyBlock raw={r.responseBody} />
            </div>
          </>
        )}

      </div>
    </div>
  );
}

// ── NodeConfigPanel ────────────────────────────────────────────────────────────

function NodeConfigPanel({ step, runState, onClose, onChange, onDelete }: {
  step: WorkflowStep;
  runState?: StepStatus;
  onClose: () => void;
  onChange: (s: WorkflowStep) => void;
  onDelete: () => void;
}) {
  const hasResult = runState?.status === 'done' || runState?.status === 'error';
  const [tab, setTab] = useState<'config' | 'result'>(() => hasResult ? 'result' : 'config');

  const isDone = runState?.status === 'done';
  const isErr  = runState?.status === 'error';
  const isPass = isDone && (runState as StepDone).pass;
  const noBody = ['GET', 'HEAD', 'OPTIONS'].includes(step.method.toUpperCase());
  const bodyValue = step.body !== undefined && step.body !== null
    ? (typeof step.body === 'string' ? step.body : JSON.stringify(step.body, null, 2))
    : '';

  const color = mc(step.method);

  return (
    <div className="flex w-[340px] shrink-0 flex-col border-l border-[var(--border)] bg-[var(--sidebar)] overflow-hidden">

      {/* ── Header ── */}
      <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3">
        <span className="shrink-0 rounded-md px-2 py-1 font-mono text-[10.5px] font-bold tracking-wider"
          style={{ color, background: `${color}18` }}>
          {step.method.toUpperCase()}
        </span>
        <span className="flex-1 truncate text-[13px] font-semibold text-[var(--foreground)]">{step.label}</span>
        <button type="button" onClick={onClose}
          className="shrink-0 flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--elevated)] transition-colors">
          <X size={13} />
        </button>
      </div>

      {/* ── Tab bar ── */}
      <div className="flex shrink-0 border-b border-[var(--border)] px-4">
        {(['config', 'result'] as const).map(t => (
          <button key={t} type="button" onClick={() => setTab(t)}
            disabled={t === 'result' && !hasResult}
            className={cn(
              'relative mr-4 py-2.5 text-[12.5px] font-medium transition-colors capitalize',
              tab === t ? 'text-[var(--foreground)]' : 'text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)]',
              t === 'result' && !hasResult && 'opacity-35 cursor-not-allowed',
            )}>
            {t}
            {tab === t && <span className="absolute inset-x-0 -bottom-px h-[1.5px] bg-[var(--foreground)] rounded-t-full" />}
            {t === 'result' && isDone && (
              <span className={cn('ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold', isPass ? 'bg-[#22c55e1a] text-[#22c55e]' : 'bg-[#ef44441a] text-[#ef4444]')}>
                {(runState as StepDone).httpStatus}
              </span>
            )}
            {t === 'result' && isErr && (
              <span className="ml-1.5 rounded-full px-1.5 py-0.5 font-mono text-[9.5px] font-bold bg-[#ef44441a] text-[#ef4444]">ERR</span>
            )}
          </button>
        ))}
      </div>

      {/* ── Scrollable body ── */}
      <div className="flex-1 min-h-0 overflow-y-auto">

        {/* Result tab */}
        {tab === 'result' && hasResult && (
          isErr ? (
            <div className="p-4">
              <div className="rounded-xl border border-[#ef444430] bg-[#ef44440d] p-4">
                <p className="mb-2 text-[11px] font-semibold uppercase tracking-wider text-[#ef4444]">Error</p>
                <p className="font-mono text-[12px] text-[#ef4444] break-all leading-relaxed">
                  {(runState as { message: string }).message}
                </p>
              </div>
            </div>
          ) : (
            <ResultViewer r={runState as StepDone} />
          )
        )}

        {/* Config tab */}
        {tab === 'config' && (
          <div className="p-4 space-y-5">

            {/* Label */}
            <div>
              <FieldLabel>Label</FieldLabel>
              <input className={fieldCls} value={step.label}
                onChange={e => onChange({ ...step, label: e.target.value })} />
            </div>

            {/* Method + Path — merged border trick */}
            <div>
              <FieldLabel>Request</FieldLabel>
              <div className="flex rounded-md border border-[var(--border)] overflow-hidden focus-within:border-[var(--border-focus)] hover:border-[var(--border-hover)] transition-colors">
                <select
                  className="shrink-0 border-r border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11.5px] font-bold outline-none appearance-none cursor-pointer"
                  style={{ color, minWidth: 74 }}
                  value={step.method.toUpperCase()}
                  onChange={e => onChange({ ...step, method: e.target.value })}
                >
                  {['GET', 'POST', 'PUT', 'PATCH', 'DELETE'].map(m => (
                    <option key={m} value={m}>{m}</option>
                  ))}
                </select>
                <input
                  className="flex-1 min-w-0 bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11.5px] text-[var(--foreground)] outline-none placeholder:text-[var(--placeholder-foreground)]"
                  value={step.path} placeholder="/api/resource/{id}"
                  onChange={e => onChange({ ...step, path: e.target.value })}
                />
              </div>
              <p className="mt-1.5 text-[11px] text-[var(--muted-foreground)]">
                Use <code className="rounded bg-[var(--elevated)] px-1 py-0.5 font-mono text-[10.5px]">{'{{var}}'}</code> for extracted variables, <code className="rounded bg-[var(--elevated)] px-1 py-0.5 font-mono text-[10.5px]">{'{param}'}</code> for path params
              </p>
            </div>

            {/* Headers */}
            <div>
              <FieldLabel>Headers</FieldLabel>
              <KVEditor data={step.headers ?? {}} onChange={h => onChange({ ...step, headers: h })} vPlaceholder="value or {{token}}" />
            </div>

            {/* Body */}
            {!noBody && (
              <div>
                <FieldLabel>Body <span className="font-normal text-[var(--muted-foreground)]">(JSON)</span></FieldLabel>
                <textarea rows={5} className={cn(monoCls, 'resize-y leading-relaxed')}
                  placeholder={'{\n  "key": "{{variable}}"\n}'}
                  value={bodyValue}
                  onChange={e => {
                    const raw = e.target.value;
                    if (!raw.trim()) { onChange({ ...step, body: undefined }); return; }
                    try { onChange({ ...step, body: JSON.parse(raw) }); }
                    catch { onChange({ ...step, body: raw }); }
                  }}
                />
              </div>
            )}

            {/* Extract variables */}
            <div>
              <FieldLabel>Extract Variables</FieldLabel>
              <div className="space-y-2">
                {(step.extract ?? []).length > 0 && (
                  <div className="rounded-md border border-[var(--border)] overflow-hidden">
                    {(step.extract ?? []).map((ext, i) => (
                      <div key={i} className={cn('flex items-stretch', i > 0 && 'border-t border-[var(--border)]')}>
                        <input
                          className="w-[100px] shrink-0 border-r border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none focus:bg-[var(--elevated)] placeholder:text-[var(--placeholder-foreground)]"
                          value={ext.var} placeholder="varName"
                          onChange={e => { const x = [...(step.extract ?? [])]; x[i] = { ...ext, var: e.target.value }; onChange({ ...step, extract: x }); }}
                        />
                        <span className="flex items-center px-2 text-[11px] text-[var(--muted-foreground)] border-r border-[var(--border)] bg-[var(--elevated)] shrink-0">←</span>
                        <input
                          className="flex-1 min-w-0 bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none focus:bg-[var(--elevated)] placeholder:text-[var(--placeholder-foreground)]"
                          value={ext.path} placeholder="$.data.id"
                          onChange={e => { const x = [...(step.extract ?? [])]; x[i] = { ...ext, path: e.target.value }; onChange({ ...step, extract: x }); }}
                        />
                        <button type="button"
                          onClick={() => onChange({ ...step, extract: (step.extract ?? []).filter((_, j) => j !== i) })}
                          className="shrink-0 px-2.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--elevated)] transition-colors">
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button"
                  onClick={() => onChange({ ...step, extract: [...(step.extract ?? []), { var: '', path: '' }] })}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)] hover:bg-[var(--elevated)] transition-colors w-fit">
                  <Plus size={11} /> Add extraction
                </button>
              </div>
            </div>

            {/* Assertions */}
            <div>
              <FieldLabel>Assertions</FieldLabel>
              <div className="space-y-2">
                {(step.assert ?? []).length > 0 && (
                  <div className="rounded-md border border-[var(--border)] overflow-hidden">
                    {(step.assert ?? []).map((a, i) => (
                      <div key={i} className={cn('flex items-stretch', i > 0 && 'border-t border-[var(--border)]')}>
                        <select
                          className="shrink-0 border-r border-[var(--border)] bg-[var(--elevated)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none appearance-none cursor-pointer"
                          style={{ minWidth: 68 }}
                          value={a.type}
                          onChange={e => { const a2 = [...(step.assert ?? [])]; a2[i] = { type: e.target.value as 'status' | 'json' }; onChange({ ...step, assert: a2 }); }}
                        >
                          <option value="status">status</option>
                          <option value="json">json</option>
                        </select>

                        {a.type === 'status' && (
                          <input
                            className="w-20 bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11.5px] text-[var(--foreground)] outline-none [appearance:textfield] [&::-webkit-inner-spin-button]:appearance-none [&::-webkit-outer-spin-button]:appearance-none"
                            type="number" value={a.statusCode ?? 200}
                            onChange={e => { const a2 = [...(step.assert ?? [])]; a2[i] = { type: 'status', statusCode: parseInt(e.target.value) || 200 }; onChange({ ...step, assert: a2 }); }}
                          />
                        )}

                        {a.type === 'json' && (
                          <>
                            <input
                              className="w-[80px] border-r border-[var(--border)] bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none"
                              value={a.path ?? ''} placeholder="$.field"
                              onChange={e => { const a2 = [...(step.assert ?? [])]; a2[i] = { ...a, path: e.target.value }; onChange({ ...step, assert: a2 }); }}
                            />
                            <span className="flex items-center px-2 text-[10.5px] text-[var(--muted-foreground)] border-r border-[var(--border)] bg-[var(--elevated)] shrink-0">==</span>
                            <input
                              className="flex-1 min-w-0 bg-[var(--input-bg)] px-2.5 py-2 font-mono text-[11px] text-[var(--foreground)] outline-none"
                              value={typeof a.eq === 'string' ? a.eq : (a.eq !== undefined ? JSON.stringify(a.eq) : '')}
                              placeholder="expected"
                              onChange={e => { const a2 = [...(step.assert ?? [])]; a2[i] = { ...a, eq: e.target.value }; onChange({ ...step, assert: a2 }); }}
                            />
                          </>
                        )}

                        <button type="button"
                          onClick={() => onChange({ ...step, assert: (step.assert ?? []).filter((_, j) => j !== i) })}
                          className="shrink-0 px-2.5 text-[var(--muted-foreground)] hover:text-[var(--destructive)] hover:bg-[var(--elevated)] transition-colors">
                          <X size={11} />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <button type="button"
                  onClick={() => onChange({ ...step, assert: [...(step.assert ?? []), { type: 'status', statusCode: 200 }] })}
                  className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-[11.5px] text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)] hover:bg-[var(--elevated)] transition-colors w-fit">
                  <Plus size={11} /> Add assertion
                </button>
              </div>
            </div>

          </div>
        )}
      </div>

      {/* ── Footer ── */}
      <div className="shrink-0 border-t border-[var(--border)] px-4 py-3">
        <button type="button" onClick={onDelete}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-transparent py-2 text-[12.5px] text-[var(--destructive)] hover:border-[#ef444430] hover:bg-[#ef44440d] transition-colors">
          <Trash2 size={13} /> Delete Step
        </button>
      </div>
    </div>
  );
}

// ── GenerateModal ──────────────────────────────────────────────────────────────

function GenerateModal({ onGenerate, onClose }: { onGenerate: (p: string) => void; onClose: () => void }) {
  const [prompt, setPrompt] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);

  const suggestions = [
    'Test login then get user profile',
    'CRUD operations on main resource',
    'Auth flow then access protected endpoint',
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" onClick={onClose}>
      <div className="w-full max-w-[440px] rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl" onClick={e => e.stopPropagation()}>
        <div className="flex items-center gap-2.5 border-b border-[var(--border)] px-4 py-3.5">
          <Sparkles size={14} />
          <span className="text-[13px] font-semibold">Generate Workflow with AI</span>
          <button type="button" onClick={onClose} className="ml-auto text-[var(--muted-foreground)] hover:text-[var(--foreground)]"><X size={14} /></button>
        </div>
        <div className="p-4 space-y-3">
          <p className="text-[12px] text-[var(--muted-foreground)]">Describe what you want to test and AI will create a workflow from your loaded API spec.</p>
          <input
            ref={inputRef}
            className="w-full rounded-lg border border-[var(--border)] bg-[var(--input-bg)] px-3 py-2 text-[13px] text-[var(--foreground)] outline-none focus:border-[var(--border-hover)] placeholder:text-[var(--placeholder-foreground)]"
            placeholder="e.g. test login and create a product"
            value={prompt}
            onChange={e => setPrompt(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && prompt.trim()) { onGenerate(prompt); onClose(); } }}
          />
          <div className="flex flex-wrap gap-1.5">
            {suggestions.map(s => (
              <button key={s} type="button" onClick={() => setPrompt(s)}
                className="rounded-full border border-[var(--border)] px-2.5 py-1 text-[11px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border-hover)] transition-colors">
                {s}
              </button>
            ))}
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 border-t border-[var(--border)] px-4 py-3">
          <Button variant="ghost" size="sm" onClick={onClose}>Cancel</Button>
          <Button size="sm" onClick={() => { if (prompt.trim()) { onGenerate(prompt); onClose(); } }} disabled={!prompt.trim()}>
            <Sparkles size={11} className="mr-1.5" /> Generate
          </Button>
        </div>
      </div>
    </div>
  );
}

// ── WorkflowsPage ──────────────────────────────────────────────────────────────

function WorkflowsPage() {
  const [workflows, setWorkflows] = useState<WfRecord[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WfRecord | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState<string | null>(null);
  const [run, setRun] = useState<RunState>({ active: false, steps: {}, passedCount: 0, totalCount: 0, done: false });
  const [generating, setGenerating] = useState(false);
  const [showGenModal, setShowGenModal] = useState(false);
  const [genError, setGenError] = useState('');
  const [loading, setLoading] = useState(true);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const readerRef = useRef<ReadableStreamDefaultReader<Uint8Array> | null>(null);

  // React Flow state
  const [nodes, setNodes, onNodesChange] = useNodesState<Node<NodeData>>([]);
  const [edges, setEdges] = useEdgesState<Edge>([]);

  // Load workflows
  useEffect(() => {
    fetch(`${CLI_BASE_URL}/api/workflows`, { headers: authHeaders() })
      .then(r => r.ok ? r.json() : Promise.reject(r))
      .then((data: unknown) => {
        const list = Array.isArray(data) ? (data as WfRecord[]) : [];
        setWorkflows(list);
        if (list.length > 0) { setSelectedId(list[0]!.id); setDraft(list[0]!); }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  // Sync canvas when draft/run changes
  useEffect(() => {
    if (!draft) { setNodes([]); setEdges([]); return; }
    setNodes(prev => {
      const posMap: Record<string, { x: number; y: number }> = {};
      for (const n of prev) posMap[n.id] = n.position;
      return buildNodes(draft.steps, run.steps, posMap);
    });
    setEdges(buildEdges(draft.steps, run.active));
  }, [draft, run.steps, run.active]);

  // Load workflow when selectedId changes
  useEffect(() => {
    if (!selectedId) { setDraft(null); return; }
    const wf = workflows.find(w => w.id === selectedId) ?? null;
    setDraft(wf);
    setSelectedNodeId(null);
    setRun({ active: false, steps: {}, passedCount: 0, totalCount: 0, done: false });
  }, [selectedId]);

  const scheduleSave = useCallback((updated: WfRecord) => {
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      try {
        await fetch(`${CLI_BASE_URL}/api/workflows/${updated.id}`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ name: updated.name, description: updated.description, steps: updated.steps }),
        });
        setWorkflows(prev => prev.map(w => w.id === updated.id ? { ...w, name: updated.name } : w));
      } catch { /* silent */ }
    }, 700);
  }, []);

  function updateDraft(updates: Partial<WfRecord>) {
    setDraft(prev => {
      if (!prev) return prev;
      const next = { ...prev, ...updates };
      scheduleSave(next);
      return next;
    });
  }

  // Keep AI panel context in sync
  useEffect(() => {
    if (!draft) return;
    window.dispatchEvent(new CustomEvent('set-ai-context', {
      detail: {
        page: 'workflows',
        workflowName: draft.name,
        workflowSteps: JSON.stringify(draft.steps, null, 2),
      },
    }));
  }, [draft?.name, draft?.steps]);

  // Apply workflow steps from AI panel
  useEffect(() => {
    const handler = (e: Event) => {
      const json = (e as CustomEvent<string>).detail;
      try {
        const parsed = JSON.parse(json) as { name?: string; steps?: unknown[]; description?: string };
        const steps = Array.isArray(parsed.steps) ? parsed.steps : Array.isArray(JSON.parse(json)) ? JSON.parse(json) : null;
        if (steps) updateDraft({ steps: steps as WorkflowStep[], ...(parsed.name ? { name: parsed.name } : {}) });
      } catch { /* not valid workflow JSON */ }
    };
    window.addEventListener('ai-apply-workflow', handler);
    return () => window.removeEventListener('ai-apply-workflow', handler);
  }, []);

  // Handle node drag end — save positions back to steps
  const handleNodesChange = useCallback((changes: NodeChange<Node<NodeData>>[]) => {
    onNodesChange(changes);
    const dragEnds = changes.filter(
      (c): c is Extract<typeof c, { type: 'position' }> & { position: { x: number; y: number } } =>
        c.type === 'position' &&
        (c as { dragging?: boolean }).dragging === false &&
        !!(c as { position?: unknown }).position
    );
    if (dragEnds.length) {
      setDraft(prev => {
        if (!prev) return prev;
        const next = {
          ...prev,
          steps: prev.steps.map(s => {
            const drag = dragEnds.find(d => d.id === s.id);
            return drag?.position ? { ...s, position: drag.position } : s;
          }),
        };
        scheduleSave(next);
        return next;
      });
    }
  }, [onNodesChange, scheduleSave]);

  async function createWorkflow() {
    try {
      const res = await fetch(`${CLI_BASE_URL}/api/workflows`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ name: 'New Workflow', description: '', steps: [] }),
      });
      if (!res.ok) return;
      const wf = await res.json() as WfRecord;
      if (!wf?.id) return;
      setWorkflows(prev => [wf, ...prev]);
      setSelectedId(wf.id);
    } catch { /* silent */ }
  }

  async function deleteWorkflow(id: string) {
    try {
      await fetch(`${CLI_BASE_URL}/api/workflows/${id}`, { method: 'DELETE', headers: authHeaders() });
    } catch { /* silent */ }
    const remaining = workflows.filter(w => w.id !== id);
    setWorkflows(remaining);
    if (selectedId === id) setSelectedId(remaining[0]?.id ?? null);
  }

  function addStep() {
    if (!draft) return;
    const step = blankStep(draft.steps);
    updateDraft({ steps: [...draft.steps, step] });
    setTimeout(() => setSelectedNodeId(step.id), 60);
  }

  function updateStep(id: string, updated: WorkflowStep) {
    updateDraft({ steps: draft!.steps.map(s => s.id === id ? updated : s) });
  }

  function deleteStep(id: string) {
    if (!draft) return;
    updateDraft({ steps: draft.steps.filter(s => s.id !== id) });
    if (selectedNodeId === id) setSelectedNodeId(null);
  }

  async function runWorkflow() {
    if (!draft || !draft.steps.length) return;
    if (readerRef.current) { try { await readerRef.current.cancel(); } catch { /* */ } readerRef.current = null; }
    setSelectedNodeId(null);
    setRun({ active: true, steps: {}, passedCount: 0, totalCount: draft.steps.length, done: false });
    const workflowId = draft.id;

    try {
      const res = await fetch(`${CLI_BASE_URL}/api/workflows/${workflowId}/run`, {
        method: 'POST',
        headers: authHeaders(),
      });
      if (!res.body) { setRun(prev => ({ ...prev, active: false, done: true })); return; }

      const reader = res.body.getReader();
      readerRef.current = reader;
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
              const ev = JSON.parse(line.slice(6)) as Record<string, unknown>;
              if (ev.type === 'step_start') {
                const id = ev.stepId as string;
                setRun(prev => ({ ...prev, steps: { ...prev.steps, [id]: { status: 'running' } } }));
              } else if (ev.type === 'step_done') {
                const id = ev.stepId as string;
                setRun(prev => ({
                  ...prev,
                  passedCount: prev.passedCount + (ev.pass ? 1 : 0),
                  steps: {
                    ...prev.steps,
                    [id]: {
                      status: 'done',
                      pass: ev.pass as boolean,
                      httpStatus: ev.status as number,
                      httpStatusText: (ev.statusText as string) ?? '',
                      latency: ev.latency as number,
                      requestUrl: (ev.requestUrl as string) ?? '',
                      requestMethod: (ev.method as string) ?? '',
                      requestHeaders: (ev.requestHeaders as Record<string, string>) ?? {},
                      requestBody: ev.requestBody as string | undefined,
                      responseHeaders: (ev.responseHeaders as Record<string, string>) ?? {},
                      responseBody: (ev.responseBody as string) ?? '',
                      assertions: (ev.assertions as { pass: boolean; message: string }[]) ?? [],
                      extractedVars: (ev.extractedVars as Record<string, string>) ?? {},
                    } satisfies StepDone,
                  },
                }));
              } else if (ev.type === 'step_error') {
                const id = ev.stepId as string;
                setRun(prev => ({
                  ...prev,
                  steps: { ...prev.steps, [id]: { status: 'error', message: ev.error as string } },
                }));
              } else if (ev.type === 'run_done') {
                setRun(prev => ({ ...prev, active: false, done: true, passedCount: ev.passedSteps as number }));
              }
            } catch { /* skip */ }
          }
        }
      }
    } catch {
      setRun(prev => ({ ...prev, active: false, done: true }));
    } finally {
      readerRef.current = null;
    }
  }

  function stopRun() {
    if (readerRef.current) { try { readerRef.current.cancel(); } catch { /* */ } readerRef.current = null; }
    setRun(prev => ({ ...prev, active: false }));
  }

  async function generate(prompt: string) {
    setGenerating(true);
    setGenError('');
    try {
      const res = await fetch(`${CLI_BASE_URL}/api/workflows/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', ...authHeaders() },
        body: JSON.stringify({ prompt }),
      });
      const data = await res.json() as { name?: string; description?: string; steps?: WorkflowStep[]; error?: string };
      if (!res.ok || data.error) { setGenError(data.error ?? 'Generation failed'); return; }

      const newSteps = (data.steps ?? []).map((s, i) => ({
        ...s,
        position: s.position ?? { x: 260, y: 80 + i * 185 },
      }));

      if (!draft) {
        const cr = await fetch(`${CLI_BASE_URL}/api/workflows`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', ...authHeaders() },
          body: JSON.stringify({ name: data.name ?? 'Generated Workflow', description: data.description ?? '', steps: newSteps }),
        });
        const wf = await cr.json() as WfRecord;
        if (wf?.id) { setWorkflows(prev => [wf, ...prev]); setSelectedId(wf.id); }
      } else {
        const updated: WfRecord = {
          ...draft,
          name: data.name ?? draft.name,
          description: data.description ?? draft.description,
          steps: newSteps,
        };
        setDraft(updated);
        scheduleSave(updated);
        setWorkflows(prev => prev.map(w => w.id === updated.id ? { ...w, name: updated.name } : w));
        setRun({ active: false, steps: {}, passedCount: 0, totalCount: 0, done: false });
      }
    } catch (e) {
      setGenError(e instanceof Error ? e.message : String(e));
    } finally {
      setGenerating(false);
    }
  }

  const selectedStep = draft?.steps.find(s => s.id === selectedNodeId) ?? null;
  const allPass = run.done && run.totalCount > 0 && run.passedCount === run.totalCount;
  const anyFail = run.done && run.passedCount < run.totalCount;

  return (
    <div className="flex h-full flex-col overflow-hidden">
      {showGenModal && <GenerateModal onGenerate={generate} onClose={() => setShowGenModal(false)} />}

      <div className="flex flex-1 min-h-0 overflow-hidden">
        {/* ── Left panel ── */}
        <aside className="flex w-[210px] min-w-[210px] flex-col border-r border-[var(--border)] bg-[var(--sidebar)]">
          <div className="flex items-center justify-between border-b border-[var(--border)] px-3 py-2.5">
            <div className="flex items-center gap-2">
              <Workflow size={13} />
              <span className="text-[12.5px] font-semibold">Workflows</span>
            </div>
            <button type="button" onClick={createWorkflow}
              className="flex items-center justify-center w-6 h-6 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)] transition-colors"
              title="New workflow">
              <Plus size={13} />
            </button>
          </div>

          <div className="flex-1 overflow-y-auto py-1 min-h-0">
            {loading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 size={14} className="animate-spin text-[var(--muted-foreground)]" />
              </div>
            ) : workflows.length === 0 ? (
              <p className="px-3 py-6 text-center text-[11.5px] text-[var(--muted-foreground)]">No workflows yet</p>
            ) : (
              workflows.map(wf => (
                <div
                  key={wf.id}
                  className={cn(
                    'group flex cursor-pointer items-center gap-2 px-3 py-2 transition-colors hover:bg-[var(--elevated)]',
                    selectedId === wf.id && 'bg-[var(--elevated)]',
                  )}
                  onClick={() => setSelectedId(wf.id)}
                >
                  <Workflow size={11} className={cn('shrink-0', selectedId === wf.id ? 'text-[var(--accent)]' : 'text-[var(--muted-foreground)]')} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] text-[var(--foreground)]">{wf.name}</div>
                    <div className="text-[10.5px] text-[var(--muted-foreground)]">{wf.steps.length} step{wf.steps.length !== 1 ? 's' : ''}</div>
                  </div>
                  <button type="button"
                    onClick={e => { e.stopPropagation(); deleteWorkflow(wf.id); }}
                    className="shrink-0 opacity-0 text-[var(--muted-foreground)] hover:text-[var(--destructive)] group-hover:opacity-100 transition-opacity">
                    <Trash2 size={11} />
                  </button>
                </div>
              ))
            )}
          </div>

          <div className="border-t border-[var(--border)] p-2.5">
            <button type="button" onClick={() => setShowGenModal(true)} disabled={generating}
              className="flex w-full items-center justify-center gap-1.5 rounded-lg border border-[var(--border)] py-2 text-[12px] text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:border-[var(--border-hover)] transition-colors disabled:opacity-50">
              {generating ? <Loader2 size={11} className="animate-spin" /> : <Sparkles size={11} />}
              Generate with AI
            </button>
          </div>
        </aside>

        {/* ── Main ── */}
        {!draft ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-5">
            <div className="flex size-14 items-center justify-center rounded-2xl border border-[var(--border)] bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]">
              <Workflow size={22} className="text-[var(--foreground)]" />
            </div>
            <div className="text-center">
              <p className="mb-1.5 text-[14px] font-semibold">No workflow selected</p>
              <p className="text-[12.5px] text-[var(--muted-foreground)]">Create or generate a workflow to get started</p>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={createWorkflow}><Plus size={12} className="mr-1.5" /> New</Button>
              <Button size="sm" onClick={() => setShowGenModal(true)} disabled={generating}>
                <Sparkles size={12} className="mr-1.5" /> Generate with AI
              </Button>
            </div>
          </div>
        ) : (
          <div className="flex flex-1 min-w-0 flex-col overflow-hidden">
            {/* Toolbar */}
            <header className="flex shrink-0 items-center gap-3 border-b border-[var(--border)] px-4 py-2.5 bg-[var(--sidebar)]">
              <div className="flex-1 min-w-0">
                <input
                  className="w-full bg-transparent text-[13.5px] font-semibold text-[var(--foreground)] outline-none placeholder:text-[var(--placeholder-foreground)]"
                  value={draft.name}
                  placeholder="Workflow name"
                  onChange={e => updateDraft({ name: e.target.value })}
                />
                {draft.description && (
                  <div className="text-[11px] text-[var(--muted-foreground)] truncate">{draft.description}</div>
                )}
              </div>

              {genError && (
                <div className="flex items-center gap-1.5 rounded-lg border border-[#ef444433] bg-[#ef444411] px-2.5 py-1">
                  <AlertCircle size={11} className="text-[#ef4444] shrink-0" />
                  <span className="text-[11px] text-[#ef4444] max-w-[180px] truncate">{genError}</span>
                  <button type="button" onClick={() => setGenError('')}><X size={10} className="text-[#ef4444]" /></button>
                </div>
              )}

              {run.done && (
                <span className={cn('text-[12.5px] font-semibold tabular-nums', allPass ? 'text-[#22c55e]' : anyFail ? 'text-[#ef4444]' : 'text-[var(--muted-foreground)]')}>
                  {run.passedCount}/{run.totalCount} passed
                </span>
              )}

              <button
                type="button"
                onClick={() => window.dispatchEvent(new CustomEvent('open-ai-panel'))}
                title="Ask AI to build or refine this workflow"
                className="flex items-center gap-1.5 rounded-lg border border-[color-mix(in_srgb,var(--accent)_30%,transparent)] bg-[color-mix(in_srgb,var(--accent)_6%,transparent)] px-3 py-1.5 text-[12px] text-[var(--accent)] hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-colors"
              >
                <Sparkles size={11} /> Ask AI
              </button>
              {run.active ? (
                <button type="button" onClick={stopRun}
                  className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-1.5 text-[12px] text-[var(--foreground)] hover:bg-[var(--card)] transition-colors">
                  <Square size={10} fill="currentColor" /> Stop
                </button>
              ) : (
                <button type="button" onClick={runWorkflow} disabled={!draft.steps.length}
                  className="flex items-center gap-1.5 rounded-lg bg-[var(--accent)] px-3 py-1.5 text-[12px] font-medium text-white hover:opacity-90 transition-opacity disabled:opacity-40 disabled:cursor-not-allowed">
                  <Play size={10} fill="currentColor" /> {run.done ? 'Re-run' : 'Run'}
                </button>
              )}
            </header>

            {/* Canvas + config panel */}
            <div className="flex flex-1 min-h-0 overflow-hidden">
              {/* React Flow canvas */}
              <div className="flex-1 min-w-0 relative">
                <ReactFlow
                  nodes={nodes}
                  edges={edges}
                  onNodesChange={handleNodesChange}
                  onNodeClick={(_, node) => setSelectedNodeId(prev => prev === node.id ? null : node.id)}
                  onPaneClick={() => setSelectedNodeId(null)}
                  nodeTypes={nodeTypes}
                  fitView
                  fitViewOptions={{ padding: 0.4, maxZoom: 1 }}
                  minZoom={0.2}
                  maxZoom={2.5}
                  proOptions={{ hideAttribution: true }}
                  deleteKeyCode={null}
                  style={{ background: 'var(--background)' }}
                >
                  <Background
                    variant={BackgroundVariant.Dots}
                    color="var(--border)"
                    gap={22}
                    size={1.2}
                  />
                  <Controls
                    showInteractive={false}
                    style={{
                      background: 'var(--card)',
                      border: '1px solid var(--border)',
                      borderRadius: '10px',
                      overflow: 'hidden',
                      boxShadow: '0 2px 10px rgba(0,0,0,0.25)',
                    }}
                  />

                  {/* Add Step button at bottom */}
                  <Panel position="bottom-center">
                    <button
                      type="button"
                      onClick={addStep}
                      className="flex items-center gap-1.5 rounded-xl border border-dashed border-[var(--border)] bg-[var(--card)]/80 backdrop-blur px-3.5 py-2 text-[12px] text-[var(--muted-foreground)] shadow-md hover:border-[var(--border-hover)] hover:text-[var(--foreground-secondary)] transition-all"
                    >
                      <Plus size={13} /> Add Step
                    </button>
                  </Panel>

                  {/* Empty state overlay */}
                  {draft.steps.length === 0 && (
                    <Panel position="top-center" style={{ marginTop: '26%' }}>
                      <div className="flex flex-col items-center gap-3 text-center pointer-events-auto">
                        <div className="flex size-12 items-center justify-center rounded-2xl border border-dashed border-[var(--border)] text-[var(--muted-foreground)]">
                          <Workflow size={18} />
                        </div>
                        <div>
                          <p className="text-[13.5px] font-medium text-[var(--foreground)]">No steps yet</p>
                          <p className="text-[12px] text-[var(--muted-foreground)]">Add a step or generate with AI</p>
                        </div>
                        <div className="flex gap-2">
                          <button type="button" onClick={addStep}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[12px] text-[var(--foreground)] hover:border-[var(--border-hover)] transition-colors">
                            <Plus size={11} /> Add Step
                          </button>
                          <button type="button" onClick={() => setShowGenModal(true)} disabled={generating}
                            className="flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-1.5 text-[12px] text-[var(--foreground)] hover:border-[var(--border-hover)] transition-colors disabled:opacity-50">
                            <Sparkles size={11} /> Generate
                          </button>
                        </div>
                      </div>
                    </Panel>
                  )}
                </ReactFlow>
              </div>

              {/* Right panel: step config */}
              {selectedStep && (
                <NodeConfigPanel
                  step={selectedStep}
                  runState={run.steps[selectedStep.id]}
                  onClose={() => setSelectedNodeId(null)}
                  onChange={s => updateStep(s.id, s)}
                  onDelete={() => deleteStep(selectedStep.id)}
                />
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
