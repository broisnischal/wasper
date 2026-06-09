import { createFileRoute } from '@tanstack/react-router';
import { useState } from 'react';
import { cn } from '../lib/utils';
import { useApp } from '../context';
import {
  saveEnvironment, deleteEnvironment,
  ENV_COLORS, type Environment, type EnvVar,
} from '../lib/env';
import { Plus, Trash2, Check, X, Edit2 } from 'lucide-react';

export const Route = createFileRoute('/environments')({ component: EnvironmentsPage });

let _seq = 0;
const uid = () => `${Date.now()}-${++_seq}`;

const EMPTY_ENV: () => Environment = () => ({
  id: uid(), name: '', color: ENV_COLORS[0]!, vars: [],
});

function VarTable({ vars, onChange }: { vars: EnvVar[]; onChange: (v: EnvVar[]) => void }) {
  const upd = (i: number, patch: Partial<EnvVar>) => {
    const next = [...vars];
    next[i] = { ...next[i]!, ...patch };
    if (i === vars.length - 1 && (patch.key || patch.value)) {
      next.push({ key: '', value: '', enabled: true });
    }
    onChange(next);
  };
  const rows = vars.length === 0 ? [{ key: '', value: '', enabled: true }] : vars;

  return (
    <div className="flex flex-col">
      <div className="grid grid-cols-[1fr_1fr_28px] gap-1.5 px-4 pb-1">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--placeholder-foreground)]">Variable</span>
        <span className="text-[11px] font-semibold uppercase tracking-wider text-[var(--placeholder-foreground)]">Value</span>
        <span />
      </div>
      {rows.map((row, i) => (
        <div key={i} className="grid grid-cols-[1fr_1fr_28px] gap-1.5 px-4 py-0.5">
          <input
            className="input h-7 text-[12px] font-mono"
            placeholder="VARIABLE_NAME"
            value={row.key}
            onChange={e => upd(i, { key: e.target.value })}
          />
          <input
            className="input h-7 text-[12px] font-mono"
            placeholder="value"
            value={row.value}
            onChange={e => upd(i, { value: e.target.value })}
          />
          {vars.length > 0 ? (
            <button
              className="btn btn-ghost btn-icon btn-sm text-[var(--placeholder-foreground)] hover:text-[var(--destructive)]"
              onClick={() => onChange(vars.filter((_, j) => j !== i))}
            >
              <X size={11} />
            </button>
          ) : <span />}
        </div>
      ))}
    </div>
  );
}

function EnvEditor({ env, onSave, onCancel }: {
  env: Environment; onSave: (e: Environment) => void; onCancel: () => void;
}) {
  const [draft, setDraft] = useState<Environment>(() => JSON.parse(JSON.stringify(env)));
  const set = (patch: Partial<Environment>) => setDraft(d => ({ ...d, ...patch }));

  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="flex items-center gap-3 px-5 py-4 border-b border-[var(--border)]">
        <input
          className="input flex-1 font-semibold"
          placeholder="Environment name"
          value={draft.name}
          onChange={e => set({ name: e.target.value })}
          autoFocus
        />
        <div className="flex gap-1.5">
          {ENV_COLORS.map(c => (
            <button
              key={c}
              onClick={() => set({ color: c })}
              className="w-4 h-4 rounded-full border-2 transition-all cursor-pointer flex-shrink-0"
              style={{
                background: c,
                borderColor: draft.color === c ? 'var(--foreground)' : 'transparent',
              }}
            />
          ))}
        </div>
      </div>

      <div className="py-3">
        <VarTable vars={draft.vars} onChange={vars => set({ vars })} />
      </div>

      <div className="flex items-center justify-end gap-2 px-4 py-3 border-t border-[var(--border)]">
        <button className="btn btn-ghost btn-sm" onClick={onCancel}><X size={12} /> Cancel</button>
        <button
          className="btn btn-primary btn-sm gap-1.5"
          onClick={() => onSave(draft)}
          disabled={!draft.name.trim()}
        >
          <Check size={12} /> Save
        </button>
      </div>
    </div>
  );
}

function EnvironmentsPage() {
  const { envs, activeEnvId, setActiveEnvId, reloadEnvs } = useApp();
  const [editing, setEditing] = useState<Environment | null>(null);
  const [creating, setCreating] = useState(false);

  const handleSave = async (e: Environment) => {
    await saveEnvironment(e);
    reloadEnvs();
    setEditing(null);
    setCreating(false);
    if (!activeEnvId) setActiveEnvId(e.id);
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this environment?')) return;
    await deleteEnvironment(id);
    if (activeEnvId === id) setActiveEnvId(null);
    reloadEnvs();
  };

  return (
    <div className="flex-1 overflow-auto bg-[var(--background)]">
      {/* Header */}
      <div className="flex items-center gap-4 px-8 pt-7 pb-6 border-b border-[var(--border)]">
        <div>
          <h1 className="text-[20px] font-bold tracking-tight text-[var(--foreground)]">Environments</h1>
          <p className="text-[13px] text-[var(--muted-foreground)] mt-1">
            Define variables like <code className="font-mono text-[var(--primary)]">{'{{BASE_URL}}'}</code> and switch between them in the explorer.
          </p>
        </div>
        <button
          className="btn btn-primary btn-sm gap-1.5 ml-auto"
          onClick={() => setCreating(true)}
          disabled={creating}
        >
          <Plus size={13} /> New environment
        </button>
      </div>

      <div className="px-8 py-6 max-w-[700px] flex flex-col gap-3">
        {creating && (
          <EnvEditor
            env={EMPTY_ENV()}
            onSave={handleSave}
            onCancel={() => setCreating(false)}
          />
        )}

        {envs.length === 0 && !creating && (
          <div className="flex flex-col items-center text-center py-16 border border-dashed border-[var(--border)] rounded-xl">
            <div className="text-[14px] font-semibold text-[var(--foreground)] mb-1.5">No environments yet</div>
            <div className="text-[12.5px] text-[var(--muted-foreground)] mb-5 max-w-sm">
              Create environments to store variables like <code className="font-mono">{'{{API_KEY}}'}</code> and switch between dev/staging/prod.
            </div>
            <button className="btn btn-primary btn-sm gap-1.5" onClick={() => setCreating(true)}>
              <Plus size={13} /> Create your first environment
            </button>
          </div>
        )}

        {envs.map(env => (
          editing?.id === env.id ? (
            <EnvEditor key={env.id} env={editing} onSave={handleSave} onCancel={() => setEditing(null)} />
          ) : (
            <div
              key={env.id}
              className={cn(
                'bg-[var(--card)] border rounded-xl overflow-hidden transition-colors',
                activeEnvId === env.id ? 'border-[var(--primary)]' : 'border-[var(--border)]',
              )}
            >
              <div className="flex items-center gap-3 px-4 py-3">
                <span className="w-2.5 h-2.5 rounded-full flex-shrink-0" style={{ background: env.color }} />
                <button
                  className={cn(
                    'flex-1 text-left text-[13.5px] font-semibold bg-transparent border-0 cursor-pointer p-0 transition-colors',
                    activeEnvId === env.id ? 'text-[var(--primary)]' : 'text-[var(--foreground)]',
                  )}
                  onClick={() => setActiveEnvId(activeEnvId === env.id ? null : env.id)}
                >
                  {env.name}
                  {activeEnvId === env.id && (
                    <span className="ml-2 text-[10.5px] font-normal text-[var(--primary)] opacity-70">active</span>
                  )}
                </button>
                <span className="text-[12px] text-[var(--placeholder-foreground)]">
                  {env.vars.filter(v => v.key).length} var{env.vars.filter(v => v.key).length !== 1 ? 's' : ''}
                </span>
                <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEditing(env)}>
                  <Edit2 size={12} />
                </button>
                <button className="btn btn-ghost btn-sm btn-icon text-[var(--destructive)]" onClick={() => handleDelete(env.id)}>
                  <Trash2 size={12} />
                </button>
              </div>

              {env.vars.filter(v => v.key).length > 0 && (
                <div className="px-4 pb-3 flex flex-wrap gap-1.5">
                  {env.vars.filter(v => v.key).map((v, i) => (
                    <span key={i} className="text-[11px] font-mono bg-[var(--elevated)] text-[var(--muted-foreground)] rounded px-2 py-0.5">
                      {`{{${v.key}}}`}
                    </span>
                  ))}
                </div>
              )}
            </div>
          )
        ))}
      </div>
    </div>
  );
}
