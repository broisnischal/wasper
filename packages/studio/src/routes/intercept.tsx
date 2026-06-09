import { createFileRoute } from '@tanstack/react-router';
import React, { useState, useEffect } from 'react';
import { apiClient } from '../lib/api';
import { cn } from '../lib/utils';
import { Plus, Trash2, Edit2, ArrowRightLeft, X, Check } from 'lucide-react';

export const Route = createFileRoute('/intercept')({ component: InterceptPage });

interface InterceptRule {
  id: string;
  enabled: number;
  name: string;
  sort_order: number;
  match_path: string;
  match_method: string;
  target_host: string;
  strip_prefix: string;
  add_prefix: string;
  add_headers: string;
  created_at: number;
}

interface HeaderPair { key: string; value: string; }

interface RuleForm {
  name: string;
  match_method: string;
  match_path: string;
  target_host: string;
  strip_prefix: string;
  add_prefix: string;
  headers: HeaderPair[];
}

const EMPTY_FORM: RuleForm = {
  name: '', match_method: '*', match_path: '',
  target_host: '', strip_prefix: '', add_prefix: '', headers: [],
};

const METHODS = ['*', 'GET', 'POST', 'PUT', 'PATCH', 'DELETE'];

const METHOD_COLORS: Record<string, string> = {
  '*': '#8b5cf6', GET: '#22c55e', POST: '#f59e0b',
  PUT: '#3b82f6', PATCH: '#06b6d4', DELETE: '#ef4444',
};

function MethodBadge({ m }: { m: string }) {
  const color = METHOD_COLORS[m] ?? '#8b5cf6';
  return (
    <span style={{ color, background: `${color}22` }}
      className="text-[10px] font-bold font-mono rounded px-1.5 py-0.5 flex-shrink-0">
      {m || '*'}
    </span>
  );
}

function formToBody(f: RuleForm) {
  const add_headers: Record<string, string> = {};
  for (const { key, value } of f.headers) { if (key.trim()) add_headers[key.trim()] = value; }
  return { name: f.name, match_method: f.match_method, match_path: f.match_path, target_host: f.target_host, strip_prefix: f.strip_prefix, add_prefix: f.add_prefix, add_headers };
}

function ruleToForm(r: InterceptRule): RuleForm {
  let headers: HeaderPair[] = [];
  try {
    const parsed = JSON.parse(r.add_headers) as Record<string, string>;
    headers = Object.entries(parsed).map(([key, value]) => ({ key, value }));
  } catch { /**/ }
  return { name: r.name, match_method: r.match_method || '*', match_path: r.match_path, target_host: r.target_host, strip_prefix: r.strip_prefix, add_prefix: r.add_prefix, headers };
}

function FieldGroup({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[11.5px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">
        {label} {required && <span className="text-[var(--destructive)] normal-case">*</span>}
      </label>
      {children}
      {hint && <p className="text-[11px] text-[var(--placeholder-foreground)] leading-snug">{hint}</p>}
    </div>
  );
}

function RuleFormPanel({ initial, onSave, onCancel, saving }: {
  initial: RuleForm; onSave: (f: RuleForm) => void; onCancel: () => void; saving: boolean;
}) {
  const [form, setForm] = useState<RuleForm>(initial);
  const set = (patch: Partial<RuleForm>) => setForm(f => ({ ...f, ...patch }));

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <h3 className="text-[13px] font-semibold text-[var(--foreground)]">
          {initial.name ? `Edit "${initial.name}"` : 'New Intercept Rule'}
        </h3>
      </div>
      <div className="p-5 flex flex-col gap-4">
        {/* Name + method */}
        <div className="grid grid-cols-[1fr_160px] gap-3">
          <FieldGroup label="Rule name">
            <input className="input w-full" placeholder="e.g. Forward to staging" value={form.name} onChange={e => set({ name: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="Method">
            <select className="select w-full" value={form.match_method} onChange={e => set({ match_method: e.target.value })}>
              {METHODS.map(m => <option key={m} value={m}>{m === '*' ? '* (any)' : m}</option>)}
            </select>
          </FieldGroup>
        </div>

        {/* Match path */}
        <FieldGroup label="Match path prefix">
          <input className="input w-full font-mono" placeholder="/api/v1  (leave empty to match all)" value={form.match_path} onChange={e => set({ match_path: e.target.value })} />
        </FieldGroup>

        {/* Target host */}
        <FieldGroup label="Target host" required hint="Requests are forwarded to this host instead of the spec server.">
          <input className="input w-full font-mono" placeholder="https://staging.example.com" value={form.target_host} onChange={e => set({ target_host: e.target.value })} />
        </FieldGroup>

        {/* Path rewrite */}
        <div className="grid grid-cols-2 gap-3">
          <FieldGroup label="Strip prefix">
            <input className="input w-full font-mono" placeholder="/api/v1" value={form.strip_prefix} onChange={e => set({ strip_prefix: e.target.value })} />
          </FieldGroup>
          <FieldGroup label="Add prefix">
            <input className="input w-full font-mono" placeholder="/v2" value={form.add_prefix} onChange={e => set({ add_prefix: e.target.value })} />
          </FieldGroup>
        </div>

        {/* Inject headers */}
        <div className="flex flex-col gap-2">
          <div className="flex items-center justify-between">
            <label className="text-[11.5px] font-semibold text-[var(--muted-foreground)] uppercase tracking-wider">Inject headers</label>
            <button
              type="button"
              onClick={() => set({ headers: [...form.headers, { key: '', value: '' }] })}
              className="text-[11.5px] text-[var(--primary)] bg-transparent border-0 cursor-pointer font-sans hover:opacity-80 transition-opacity"
            >
              + Add header
            </button>
          </div>
          {form.headers.length === 0 && (
            <p className="text-[11.5px] text-[var(--placeholder-foreground)]">No headers — click "Add header" to inject one on every proxied request.</p>
          )}
          {form.headers.map((h, i) => (
            <div key={i} className="flex gap-2">
              <input className="input font-mono" style={{ flex: '0 0 42%' }} placeholder="Header-Name" value={h.key}
                onChange={e => { const hs = [...form.headers]; hs[i] = { ...hs[i], key: e.target.value }; set({ headers: hs }); }} />
              <input className="input flex-1 font-mono" placeholder="value" value={h.value}
                onChange={e => { const hs = [...form.headers]; hs[i] = { ...hs[i], value: e.target.value }; set({ headers: hs }); }} />
              <button type="button"
                onClick={() => set({ headers: form.headers.filter((_, j) => j !== i) })}
                className="flex items-center justify-center w-8 h-8 border border-[var(--border)] rounded-md bg-transparent cursor-pointer text-[var(--placeholder-foreground)] hover:text-[var(--destructive)] hover:border-[var(--destructive)] transition-colors flex-shrink-0">
                <X size={12} />
              </button>
            </div>
          ))}
        </div>

        {/* Actions */}
        <div className="flex gap-2 justify-end pt-1">
          <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
          <button className="btn btn-primary btn-sm gap-1.5" onClick={() => onSave(form)} disabled={saving || !form.target_host.trim()}>
            {saving ? <span className="spinner" style={{ width: 11, height: 11 }} /> : <Check size={12} />}
            Save rule
          </button>
        </div>
      </div>
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={onChange}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 focus:outline-none',
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--elevated)]',
      )}
    >
      <span className={cn(
        'pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 translate-y-[3px]',
        checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
      )} />
    </button>
  );
}

function RuleCard({ rule, onEdit, onDelete, onToggle }: {
  rule: InterceptRule; onEdit: () => void; onDelete: () => void; onToggle: () => void;
}) {
  const enabled = Boolean(rule.enabled);
  let headerCount = 0;
  try { headerCount = Object.keys(JSON.parse(rule.add_headers)).length; } catch { /**/ }

  return (
    <div className={cn(
      'bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden transition-opacity duration-150',
      !enabled && 'opacity-50',
    )}>
      <div className="flex items-center gap-3 px-4 py-3">
        <Toggle checked={enabled} onChange={onToggle} />

        <span className="font-semibold text-[13.5px] text-[var(--foreground)] flex-1 min-w-0 truncate">
          {rule.name || <span className="text-[var(--muted-foreground)] italic font-normal">Unnamed rule</span>}
        </span>

        <div className="flex items-center gap-1.5 flex-shrink-0">
          <MethodBadge m={rule.match_method || '*'} />
          <span className="text-[12px] font-mono text-[var(--muted-foreground)]">
            {rule.match_path || '*'}
          </span>
        </div>

        <span className="text-[var(--muted-foreground)] text-[13px] flex-shrink-0">→</span>

        <span className="text-[12px] font-mono text-[var(--foreground)] flex-shrink-0 max-w-[200px] truncate">
          {rule.target_host || '—'}
        </span>

        <div className="flex items-center gap-1 ml-auto flex-shrink-0">
          <button className="btn btn-ghost btn-sm btn-icon" onClick={onEdit} title="Edit">
            <Edit2 size={12} />
          </button>
          <button className="btn btn-ghost btn-sm btn-icon text-[var(--destructive)]" onClick={onDelete} title="Delete">
            <Trash2 size={12} />
          </button>
        </div>
      </div>

      {(rule.strip_prefix || rule.add_prefix || headerCount > 0) && (
        <div className="flex items-center gap-2 flex-wrap px-4 pb-3">
          {rule.strip_prefix && (
            <span className="text-[10.5px] font-mono text-[var(--muted-foreground)] bg-[var(--elevated)] rounded px-2 py-0.5">
              strip: {rule.strip_prefix}
            </span>
          )}
          {rule.add_prefix && (
            <span className="text-[10.5px] font-mono text-[var(--muted-foreground)] bg-[var(--elevated)] rounded px-2 py-0.5">
              prefix: {rule.add_prefix}
            </span>
          )}
          {headerCount > 0 && (
            <span className="text-[10.5px] text-[var(--muted-foreground)] bg-[var(--elevated)] rounded px-2 py-0.5">
              +{headerCount} header{headerCount > 1 ? 's' : ''}
            </span>
          )}
        </div>
      )}
    </div>
  );
}

function InterceptPage() {
  const [rules, setRules] = useState<InterceptRule[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [showForm, setShowForm] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = async () => {
    try {
      setError(null);
      const data = await apiClient<InterceptRule[]>('/api/intercept');
      setRules(data);
    } catch (e) { setError(String(e)); }
    finally { setLoading(false); }
  };

  useEffect(() => { load(); }, []);

  const handleCreate = async (form: RuleForm) => {
    setSaving(true);
    try {
      await apiClient('/api/intercept', { method: 'POST', body: JSON.stringify(formToBody(form)) });
      setShowForm(false); await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const handleUpdate = async (id: string, form: RuleForm) => {
    setSaving(true);
    try {
      await apiClient(`/api/intercept/${id}`, { method: 'PUT', body: JSON.stringify(formToBody(form)) });
      setEditingId(null); await load();
    } catch (e) { setError(String(e)); }
    finally { setSaving(false); }
  };

  const handleToggle = async (rule: InterceptRule) => {
    try {
      await apiClient(`/api/intercept/${rule.id}`, { method: 'PUT', body: JSON.stringify({ enabled: rule.enabled === 0 }) });
      await load();
    } catch (e) { setError(String(e)); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this intercept rule?')) return;
    try {
      await apiClient(`/api/intercept/${id}`, { method: 'DELETE' });
      await load();
    } catch (e) { setError(String(e)); }
  };

  return (
    <div className="flex-1 overflow-auto bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center gap-4 px-8 pt-7 pb-6 border-b border-[var(--border)]">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-[var(--foreground)]">Request Intercept</h1>
          <p className="text-[13px] text-[var(--muted-foreground)] mt-1">
            Forward proxy requests to a different host, rewrite paths, and inject headers. First match wins.
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm gap-1.5 ml-auto flex-shrink-0"
          onClick={() => { setShowForm(true); setEditingId(null); }}
          disabled={showForm}
        >
          <Plus size={13} /> New rule
        </button>
      </div>

      <div className="px-8 py-6 max-w-[820px] flex flex-col gap-3">

        {error && (
          <div className="px-4 py-3 bg-[var(--error-dim)] border border-[rgba(239,68,68,0.2)] rounded-lg text-[13px] text-[var(--destructive)]">
            {error}
          </div>
        )}

        {/* New rule form */}
        {showForm && (
          <RuleFormPanel
            initial={EMPTY_FORM}
            onSave={handleCreate}
            onCancel={() => setShowForm(false)}
            saving={saving}
          />
        )}

        {/* Rules list */}
        {loading ? (
          <div className="flex justify-center py-12">
            <span className="spinner" style={{ width: 20, height: 20 }} />
          </div>
        ) : rules.length === 0 && !showForm ? (
          <div className="flex flex-col items-center text-center py-16 px-6 border border-dashed border-[var(--border)] rounded-xl">
            <ArrowRightLeft size={28} className="opacity-30 mb-3 text-[var(--muted-foreground)]" />
            <div className="text-[14px] font-semibold text-[var(--foreground)] mb-1.5">No intercept rules yet</div>
            <div className="text-[12.5px] text-[var(--muted-foreground)] mb-5 max-w-sm">
              Rules let you forward requests to a different host or rewrite paths and inject headers on the fly.
            </div>
            <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setShowForm(true)}>
              <Plus size={13} /> Add your first rule
            </button>
          </div>
        ) : (
          rules.map(rule => (
            editingId === rule.id ? (
              <RuleFormPanel
                key={rule.id}
                initial={ruleToForm(rule)}
                onSave={form => handleUpdate(rule.id, form)}
                onCancel={() => setEditingId(null)}
                saving={saving}
              />
            ) : (
              <RuleCard
                key={rule.id}
                rule={rule}
                onEdit={() => setEditingId(rule.id)}
                onDelete={() => handleDelete(rule.id)}
                onToggle={() => handleToggle(rule)}
              />
            )
          ))
        )}
      </div>
    </div>
  );
}
