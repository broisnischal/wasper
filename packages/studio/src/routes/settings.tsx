import { createFileRoute } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { useApp } from '../context';
import type { Features } from '../context';
import { cn } from '../lib/utils';
import { Switch } from '../components/ui/switch';
import { Check, Eye, EyeOff } from 'lucide-react';

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
  anthropic:        { label: 'Anthropic (Claude)',        defaultModel: 'claude-haiku-4-5-20251001', modelHint: 'e.g. claude-opus-4-8, claude-sonnet-4-6',           needsKey: true,  keyPlaceholder: 'sk-ant-…',             showBaseUrl: false, baseUrlLabel: '',                          baseUrlPlaceholder: '',                              baseUrlHint: '' },
  openai:           { label: 'OpenAI',                    defaultModel: 'gpt-4o-mini',               modelHint: 'e.g. gpt-4o, gpt-4o-mini, o1-mini',                needsKey: true,  keyPlaceholder: 'sk-…',                 showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.openai.com',         baseUrlHint: 'Leave empty to use api.openai.com' },
  ollama:           { label: 'Ollama (local)',             defaultModel: 'llama3',                    modelHint: 'e.g. llama3, mistral, codellama',                   needsKey: false, keyPlaceholder: '',                     showBaseUrl: true,  baseUrlLabel: 'Base URL',                  baseUrlPlaceholder: 'http://localhost:11434',         baseUrlHint: 'Ollama server address' },
  mistral:          { label: 'Mistral AI',                 defaultModel: 'mistral-small-latest',      modelHint: 'e.g. mistral-small-latest, mistral-large-latest',  needsKey: true,  keyPlaceholder: '',                     showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.mistral.ai',         baseUrlHint: 'Leave empty to use api.mistral.ai' },
  'github-copilot': { label: 'GitHub Copilot',            defaultModel: 'gpt-4o',                    modelHint: 'e.g. gpt-4o, gpt-3.5-turbo',                       needsKey: true,  keyPlaceholder: 'github_pat_…',         showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.githubcopilot.com', baseUrlHint: 'Leave empty to use api.githubcopilot.com' },
  gemini:           { label: 'Google Gemini',              defaultModel: 'gemini-1.5-flash',          modelHint: 'e.g. gemini-1.5-flash, gemini-1.5-pro',            needsKey: true,  keyPlaceholder: 'AIza…',                showBaseUrl: false, baseUrlLabel: '',                          baseUrlPlaceholder: '',                              baseUrlHint: '' },
  groq:             { label: 'Groq',                       defaultModel: 'llama-3.1-70b-versatile',   modelHint: 'e.g. llama-3.1-70b-versatile, mixtral-8x7b-32768', needsKey: true,  keyPlaceholder: 'gsk_…',               showBaseUrl: true,  baseUrlLabel: 'Custom endpoint (optional)', baseUrlPlaceholder: 'https://api.groq.com/openai',   baseUrlHint: 'Leave empty to use api.groq.com/openai' },
  custom:           { label: 'Custom (OpenAI-compatible)', defaultModel: '',                          modelHint: 'Model name to pass to your API',                   needsKey: true,  keyPlaceholder: 'API key (optional)',   showBaseUrl: true,  baseUrlLabel: 'Base URL',                  baseUrlPlaceholder: 'https://your-endpoint.com',     baseUrlHint: 'Your OpenAI-compatible API endpoint' },
};

const DEF: Settings = {
  proxy: { enabled: false, type: 'http', host: '', port: 8080, username: '', password: '' },
  ai: { provider: 'anthropic', apiKey: '', model: 'claude-haiku-4-5-20251001', baseUrl: '' },
  request: { timeout: 30000, followRedirects: true, sslVerify: true },
};

type Tab = 'general' | 'ai' | 'proxy' | 'request';
const TABS: { id: Tab; label: string }[] = [
  { id: 'general', label: 'General' },
  { id: 'ai', label: 'AI Provider' },
  { id: 'proxy', label: 'Proxy' },
  { id: 'request', label: 'Request' },
];

function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <label className="text-[13px] font-medium text-[var(--foreground)]">{label}</label>
      {children}
      {hint && <p className="text-[12px] text-[var(--muted-foreground)] leading-snug">{hint}</p>}
    </div>
  );
}

function Row({ title, desc, children }: { title: string; desc?: string; children: React.ReactNode }) {
  return (
    <div className="py-8 grid grid-cols-[220px_1fr] gap-12 border-b border-[var(--border)] last:border-0">
      <div>
        <h2 className="text-[14px] font-semibold text-[var(--foreground)]">{title}</h2>
        {desc && <p className="text-[12.5px] text-[var(--muted-foreground)] mt-1 leading-relaxed">{desc}</p>}
      </div>
      <div className="flex flex-col gap-4">
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
  const { features, setFeatures } = useApp();
  const [s, setS] = useState<Settings>(DEF);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [tab, setTab] = useState<Tab>('general');

  useEffect(() => {
    apiClient<Settings>('/api/settings')
      .then(d => setS({ ...DEF, ...d, proxy: { ...DEF.proxy, ...d.proxy }, ai: { ...DEF.ai, ...d.ai }, request: { ...DEF.request, ...d.request } }))
      .catch(() => {});
  }, []);

  const toggleFeature = async (key: keyof Features, value: boolean) => {
    const next = { ...features, [key]: value };
    setFeatures(next);
    try {
      const updated = await apiClient<Features>('/api/features', { method: 'PUT', body: JSON.stringify({ [key]: value }) });
      setFeatures(updated);
    } catch {
      setFeatures(features);
    }
  };

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
      {/* Page header */}
      <div className="px-10 pt-10 pb-0">
        <h1 className="text-[26px] font-bold tracking-tight text-[var(--foreground)]">Settings</h1>

        {/* Tab nav */}
        <div className="flex items-center gap-1 mt-6 border-b border-[var(--border)]">
          {TABS.map(t => (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                'px-3 h-8 mb-[-1px] text-[13px] font-medium rounded-t-md border-b-2 transition-colors',
                tab === t.id
                  ? 'text-[var(--foreground)] border-[var(--foreground)]'
                  : 'text-[var(--muted-foreground)] border-transparent hover:text-[var(--foreground-secondary)]',
              )}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>

      {/* Tab content */}
      <div className="px-10 pb-10 max-w-[780px]">

        {tab === 'general' && (
          <>
            <Row title="Server features" desc="Live feature toggles — changes apply instantly and survive restarts.">
              <div className="grid grid-cols-2 gap-x-8 gap-y-5">
                {([
                  ['mcp',      'MCP endpoint',   'Serve the /mcp JSON-RPC endpoint used by Claude and other agents.'],
                  ['proxy',    'HTTP proxy',      'Route upstream requests through the server proxy.'],
                  ['ai',       'AI chat',         'Enable the AI assistant in the studio.'],
                  ['readonly', 'Read-only mode',  'Block all non-GET upstream requests. Resets to off on server restart.'],
                ] as const).map(([key, label, hint]) => (
                  <div key={key} className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[13px] font-medium text-[var(--foreground)]">{label}</div>
                      <div className="text-[12px] text-[var(--muted-foreground)] mt-0.5 leading-snug">{hint}</div>
                    </div>
                    <Switch checked={features[key]} onChange={v => toggleFeature(key, v)} />
                  </div>
                ))}
              </div>
            </Row>
          </>
        )}

        {tab === 'ai' && (
          <>
            <Row title="AI Provider" desc="Powers the AI chat assistant.">
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
            </Row>

            <div className="pt-6 flex justify-end">
              <button className={cn('btn gap-2', saved ? 'btn-ghost text-[var(--success)]' : 'btn-primary')} onClick={save} disabled={saving}>
                {saved ? <Check size={13} /> : null}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
              </button>
            </div>
          </>
        )}

        {tab === 'proxy' && (
          <>
            <Row title="Proxy" desc="Route requests through an HTTP or SOCKS5 proxy.">
              <div className="flex items-center justify-between">
                <div>
                  <div className="text-[13px] font-medium text-[var(--foreground)]">Enable proxy</div>
                  <div className="text-[12px] text-[var(--muted-foreground)] mt-0.5">Route all outgoing requests through the proxy.</div>
                </div>
                <Switch checked={s.proxy.enabled} onChange={v => set('proxy', { enabled: v })} />
              </div>

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
            </Row>

            <div className="pt-6 flex justify-end">
              <button className={cn('btn gap-2', saved ? 'btn-ghost text-[var(--success)]' : 'btn-primary')} onClick={save} disabled={saving}>
                {saved ? <Check size={13} /> : null}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
              </button>
            </div>
          </>
        )}

        {tab === 'request' && (
          <>
            <Row title="Request Defaults" desc="Applied to all outgoing requests.">
              <Field label="Timeout (ms)">
                <input
                  className="input font-mono"
                  style={{ width: 140 }}
                  type="number"
                  value={s.request.timeout}
                  onChange={e => set('request', { timeout: +e.target.value })}
                />
              </Field>

              <div className="flex flex-col gap-4">
                {([
                  ['followRedirects', 'Follow redirects', 'Automatically follow HTTP redirects.'],
                  ['sslVerify',       'Verify SSL',        'Validate TLS certificates on outgoing requests.'],
                ] as const).map(([key, label, hint]) => (
                  <div key={key} className="flex items-start justify-between gap-4">
                    <div>
                      <div className="text-[13px] font-medium text-[var(--foreground)]">{label}</div>
                      <div className="text-[12px] text-[var(--muted-foreground)] mt-0.5">{hint}</div>
                    </div>
                    <Switch checked={s.request[key]} onChange={v => set('request', { [key]: v })} />
                  </div>
                ))}
              </div>
            </Row>

            <div className="pt-6 flex justify-end">
              <button className={cn('btn gap-2', saved ? 'btn-ghost text-[var(--success)]' : 'btn-primary')} onClick={save} disabled={saving}>
                {saved ? <Check size={13} /> : null}
                {saving ? 'Saving…' : saved ? 'Saved' : 'Save changes'}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
