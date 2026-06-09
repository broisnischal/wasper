import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { cn } from '../lib/utils';
import { Save, Check, Eye, EyeOff } from 'lucide-react';

export const Route = createFileRoute('/settings')({ component: SettingsPage });

type AIProvider = 'anthropic' | 'openai' | 'ollama' | 'mistral' | 'github-copilot' | 'gemini' | 'groq' | 'custom';

interface Settings {
  proxy: { enabled: boolean; type: 'http' | 'https' | 'socks5'; host: string; port: number; username: string; password: string; };
  ai: { provider: AIProvider; apiKey: string; model: string; baseUrl: string; };
  request: { timeout: number; followRedirects: boolean; sslVerify: boolean; };
}

const PROVIDERS: Record<AIProvider, {
  label: string; defaultModel: string; modelHint: string;
  needsKey: boolean; keyPlaceholder: string;
  showBaseUrl: boolean; baseUrlLabel: string; baseUrlPlaceholder: string; baseUrlHint: string;
}> = {
  anthropic:        { label: 'Anthropic (Claude)',        defaultModel: 'claude-haiku-4-5-20251001', modelHint: 'e.g. claude-opus-4-8, claude-sonnet-4-6',          needsKey: true,  keyPlaceholder: 'sk-ant-…',             showBaseUrl: false, baseUrlLabel: '',                          baseUrlPlaceholder: '',                              baseUrlHint: '' },
  openai:           { label: 'OpenAI',                    defaultModel: 'gpt-4o-mini',               modelHint: 'e.g. gpt-4o, gpt-4o-mini, o1-mini',               needsKey: true,  keyPlaceholder: 'sk-…',                 showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.openai.com',         baseUrlHint: 'Leave empty to use api.openai.com' },
  ollama:           { label: 'Ollama (local)',             defaultModel: 'llama3',                    modelHint: 'e.g. llama3, mistral, codellama',                  needsKey: false, keyPlaceholder: '',                     showBaseUrl: true,  baseUrlLabel: 'Base URL',                  baseUrlPlaceholder: 'http://localhost:11434',         baseUrlHint: 'Ollama server address' },
  mistral:          { label: 'Mistral AI',                 defaultModel: 'mistral-small-latest',      modelHint: 'e.g. mistral-small-latest, mistral-large-latest', needsKey: true,  keyPlaceholder: '',                     showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.mistral.ai',         baseUrlHint: 'Leave empty to use api.mistral.ai' },
  'github-copilot': { label: 'GitHub Copilot',            defaultModel: 'gpt-4o',                    modelHint: 'e.g. gpt-4o, gpt-3.5-turbo',                      needsKey: true,  keyPlaceholder: 'github_pat_…',         showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.githubcopilot.com', baseUrlHint: 'Leave empty to use api.githubcopilot.com' },
  gemini:           { label: 'Google Gemini',              defaultModel: 'gemini-1.5-flash',          modelHint: 'e.g. gemini-1.5-flash, gemini-1.5-pro',           needsKey: true,  keyPlaceholder: 'AIza…',                showBaseUrl: false, baseUrlLabel: '',                          baseUrlPlaceholder: '',                              baseUrlHint: '' },
  groq:             { label: 'Groq',                       defaultModel: 'llama-3.1-70b-versatile',   modelHint: 'e.g. llama-3.1-70b-versatile, mixtral-8x7b-32768', needsKey: true, keyPlaceholder: 'gsk_…',               showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.groq.com/openai',   baseUrlHint: 'Leave empty to use api.groq.com/openai' },
  custom:           { label: 'Custom (OpenAI-compatible)', defaultModel: '',                          modelHint: 'Model name to pass to your API',                  needsKey: true,  keyPlaceholder: 'API key (optional)',   showBaseUrl: true,  baseUrlLabel: 'Base URL',                  baseUrlPlaceholder: 'https://your-endpoint.com',     baseUrlHint: 'Your OpenAI-compatible API endpoint' },
};

const DEF: Settings = {
  proxy: { enabled: false, type: 'http', host: '', port: 8080, username: '', password: '' },
  ai: { provider: 'anthropic', apiKey: '', model: 'claude-haiku-4-5-20251001', baseUrl: '' },
  request: { timeout: 30000, followRedirects: true, sslVerify: true },
};

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[12px] font-medium text-[var(--muted-foreground)]">{label}</label>
      {children}
      {hint && <p className="text-[11.5px] text-[var(--placeholder-foreground)] leading-snug">{hint}</p>}
    </div>
  );
}

function Toggle({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-0 transition-colors duration-200 focus:outline-none',
        checked ? 'bg-[var(--primary)]' : 'bg-[var(--elevated)]',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-3.5 w-3.5 rounded-full bg-white shadow-sm transition-transform duration-200 translate-y-[3px]',
          checked ? 'translate-x-[19px]' : 'translate-x-[3px]',
        )}
      />
    </button>
  );
}

function Section({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="bg-[var(--card)] border border-[var(--border)] rounded-xl overflow-hidden">
      <div className="px-5 py-4 border-b border-[var(--border)]">
        <h2 className="text-[13.5px] font-semibold text-[var(--foreground)]">{title}</h2>
        {desc && <p className="text-[12px] text-[var(--muted-foreground)] mt-0.5">{desc}</p>}
      </div>
      <div className="p-5 flex flex-col gap-4">
        {children}
      </div>
    </div>
  );
}

function PasswordInput({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder?: string }) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <input
        className="input w-full font-mono pr-9"
        type={show ? 'text' : 'password'}
        placeholder={placeholder}
        value={value}
        onChange={e => onChange(e.target.value)}
      />
      <button
        type="button"
        onClick={() => setShow(s => !s)}
        className="absolute right-2.5 top-1/2 -translate-y-1/2 text-[var(--placeholder-foreground)] hover:text-[var(--muted-foreground)] transition-colors bg-transparent border-0 cursor-pointer p-0"
      >
        {show ? <EyeOff size={13} /> : <Eye size={13} />}
      </button>
    </div>
  );
}

function SettingsPage() {
  const [s, setS] = useState<Settings>(DEF);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    apiClient<Settings>('/api/settings')
      .then(d => setS({ ...DEF, ...d, proxy: { ...DEF.proxy, ...d.proxy }, ai: { ...DEF.ai, ...d.ai }, request: { ...DEF.request, ...d.request } }))
      .catch(() => {});
  }, []);

  const set = <K extends keyof Settings>(k: K, patch: Partial<Settings[K]>) =>
    setS(prev => ({ ...prev, [k]: { ...prev[k], ...patch } }));

  const handleProviderChange = (p: AIProvider) =>
    set('ai', { provider: p, model: PROVIDERS[p].defaultModel, baseUrl: '' });

  const save = async () => {
    setSaving(true);
    try {
      await apiClient('/api/settings', { method: 'PUT', body: JSON.stringify(s) });
      setSaved(true); setTimeout(() => setSaved(false), 2000);
    } catch { /* ignore */ } finally { setSaving(false); }
  };

  const pc = PROVIDERS[s.ai.provider];

  return (
    <div className="flex-1 overflow-auto bg-[var(--background)]">
      {/* Header */}
      <div className="px-8 pt-7 pb-6 border-b border-[var(--border)]">
        <h1 className="text-[20px] font-bold tracking-tight text-[var(--foreground)]">Settings</h1>
        <p className="text-[13px] text-[var(--muted-foreground)] mt-1">Configure AI provider, proxy, and request defaults.</p>
      </div>

      <div className="px-8 py-6 max-w-[600px] flex flex-col gap-4">

        {/* AI Provider */}
        <Section title="AI Provider" desc="Powers the AI chat assistant.">
          <Field label="Provider">
            <select
              className="select w-full"
              value={s.ai.provider}
              onChange={e => handleProviderChange(e.target.value as AIProvider)}
            >
              {(Object.keys(PROVIDERS) as AIProvider[]).map(p => (
                <option key={p} value={p}>{PROVIDERS[p].label}</option>
              ))}
            </select>
          </Field>

          {pc.needsKey && (
            <Field label="API Key" hint="Stored locally, never sent to third parties.">
              <PasswordInput
                value={s.ai.apiKey}
                onChange={v => set('ai', { apiKey: v })}
                placeholder={pc.keyPlaceholder}
              />
            </Field>
          )}

          <Field label="Model" hint={pc.modelHint}>
            <input
              className="input w-full font-mono"
              placeholder={pc.defaultModel || 'model-name'}
              value={s.ai.model}
              onChange={e => set('ai', { model: e.target.value })}
            />
          </Field>

          {pc.showBaseUrl && (
            <Field label={pc.baseUrlLabel} hint={pc.baseUrlHint}>
              <input
                className="input w-full font-mono"
                placeholder={pc.baseUrlPlaceholder}
                value={s.ai.baseUrl}
                onChange={e => set('ai', { baseUrl: e.target.value })}
              />
            </Field>
          )}
        </Section>

        {/* Proxy */}
        <Section title="Proxy" desc="Route requests through an HTTP or SOCKS5 proxy.">
          <Field label="Enable proxy">
            <Toggle checked={s.proxy.enabled} onChange={v => set('proxy', { enabled: v })} />
          </Field>

          {s.proxy.enabled && (
            <>
              <Field label="Type">
                <select className="select w-full" value={s.proxy.type} onChange={e => set('proxy', { type: e.target.value as Settings['proxy']['type'] })}>
                  <option value="http">HTTP</option>
                  <option value="https">HTTPS</option>
                  <option value="socks5">SOCKS5</option>
                </select>
              </Field>

              <div className="grid grid-cols-[1fr_100px] gap-3">
                <Field label="Host">
                  <input className="input w-full font-mono" placeholder="localhost" value={s.proxy.host} onChange={e => set('proxy', { host: e.target.value })} />
                </Field>
                <Field label="Port">
                  <input className="input w-full font-mono" type="number" placeholder="8080" value={s.proxy.port} onChange={e => set('proxy', { port: +e.target.value })} />
                </Field>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <Field label="Username">
                  <input className="input w-full" placeholder="user" value={s.proxy.username} onChange={e => set('proxy', { username: e.target.value })} />
                </Field>
                <Field label="Password">
                  <PasswordInput value={s.proxy.password} onChange={v => set('proxy', { password: v })} placeholder="pass" />
                </Field>
              </div>
            </>
          )}
        </Section>

        {/* Request Defaults */}
        <Section title="Request Defaults" desc="Applied to all outgoing requests.">
          <Field label="Timeout (ms)">
            <input
              className="input font-mono"
              style={{ width: 130 }}
              type="number"
              value={s.request.timeout}
              onChange={e => set('request', { timeout: +e.target.value })}
            />
          </Field>

          <div className="flex gap-8">
            <Field label="Follow redirects">
              <Toggle checked={s.request.followRedirects} onChange={v => set('request', { followRedirects: v })} />
            </Field>
            <Field label="Verify SSL">
              <Toggle checked={s.request.sslVerify} onChange={v => set('request', { sslVerify: v })} />
            </Field>
          </div>
        </Section>

        {/* Save */}
        <div className="flex justify-end">
          <button
            className={cn('btn gap-2', saved ? 'btn-ghost text-[var(--primary)]' : 'btn-primary')}
            onClick={save}
            disabled={saving}
          >
            {saved ? <Check size={13} /> : <Save size={13} />}
            {saving ? 'Saving…' : saved ? 'Saved' : 'Save Settings'}
          </button>
        </div>
      </div>
    </div>
  );
}
