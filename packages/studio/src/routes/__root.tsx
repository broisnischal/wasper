import { HeadContent, Outlet, Scripts, createRootRoute, useRouterState } from '@tanstack/react-router';
import { useEffect, useState, useRef } from 'react';
import { Sidebar } from '../components/Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { HotkeyHelp } from '../components/HotkeyHelp';
import { AiPanel } from '../components/AiPanel';
import { AppContext, DEFAULT_FEATURES, type Features, useApp } from '../context';
import { Sun, Moon } from 'lucide-react';
import { apiClient, getCliUrl, setCliUrl, clearCliUrl, getCliToken, setCliToken, clearCliToken, LOG_WS_URL } from '../lib/api';
import { injectFonts } from '../fonts';
import {
  listEnvironments, getActiveEnvId, setActiveEnvId as persistActiveEnv,
  type Environment,
} from '../lib/env';
import appCss from '../styles.css?url';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'Wasper Studio' },
    ],
    links: [{ rel: 'stylesheet', href: appCss }],
  }),
  shellComponent: RootDocument,
});

function RootDocument({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" data-theme="dark">
      <head>
        <HeadContent />
        {/* Prevent theme flash before React hydrates */}
        <script dangerouslySetInnerHTML={{ __html: `
          try {
            var t = localStorage.getItem('theme') || (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
            document.documentElement.setAttribute('data-theme', t);
          } catch(e) {}
        ` }} />
      </head>
      <body suppressHydrationWarning>
        {children}
        <Scripts />
      </body>
    </html>
  );
}

Route.update({ component: AppShell });

type InstallTab = 'curl' | 'npm' | 'bun';

// Shell syntax tokenizer
type ShToken = { text: string; color: string };
function tokenizeShell(line: string): ShToken[] {
  const out: ShToken[] = [];
  const parts = line.split(/(\s+|(?=\|))/);
  let first = true;
  for (const p of parts) {
    if (!p) continue;
    if (/^\s+$/.test(p)) { out.push({ text: p, color: 'inherit' }); continue; }
    if (p === '|') { out.push({ text: p, color: '#f472b6' }); continue; }
    if (/^https?:\/\//.test(p)) { out.push({ text: p, color: '#a3a3a3' }); continue; }
    if (/^--?[a-z]/.test(p)) { out.push({ text: p, color: '#60a5fa' }); continue; }
    if (/^<.+>$/.test(p)) { out.push({ text: p, color: '#525252' }); continue; }
    if (!first && /^(sh|bash|zsh)$/.test(p)) { out.push({ text: p, color: '#4ade80' }); continue; }
    if (first) { out.push({ text: p, color: '#e5e5e5' }); first = false; continue; }
    out.push({ text: p, color: '#a3a3a3' });
  }
  return out;
}

interface ShellTabDef { id: string; label: string; badge?: string }

function ShellBlock({ code, tabs, activeTab, onTabChange }: {
  code: string;
  tabs?: ShellTabDef[];
  activeTab?: string;
  onTabChange?: (id: string) => void;
}) {
  const [copied, setCopied] = useState(false);
  const copy = () => {
    navigator.clipboard.writeText(code).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    });
  };

  return (
    <div style={{
      marginTop: 10, borderRadius: 10, overflow: 'hidden',
      border: '1px solid rgba(255,255,255,0.08)',
      background: '#0a0a0a',
    }}>
      {/* Tab bar */}
      <div style={{
        display: 'flex', alignItems: 'center',
        borderBottom: '1px solid rgba(255,255,255,0.06)',
        paddingLeft: 4,
      }}>
        {tabs?.map(t => (
          <button
            key={t.id}
            onClick={() => onTabChange?.(t.id)}
            style={{
              background: 'none', border: 'none', cursor: 'pointer',
              padding: '9px 10px 8px',
              fontSize: 12.5, fontFamily: 'inherit',
              color: activeTab === t.id ? 'rgba(255,255,255,0.9)' : 'rgba(255,255,255,0.35)',
              fontWeight: activeTab === t.id ? 500 : 400,
              borderBottom: activeTab === t.id ? '1.5px solid rgba(255,255,255,0.7)' : '1.5px solid transparent',
              marginBottom: -1,
              display: 'flex', alignItems: 'center', gap: 6,
              transition: 'color 0.12s',
            }}
          >
            {t.label}
            {t.badge && (
              <span style={{
                fontSize: 10, padding: '1px 6px', borderRadius: 99,
                background: 'rgba(34,197,94,0.12)', color: '#22c55e',
                border: '1px solid rgba(34,197,94,0.2)',
              }}>
                {t.badge}
              </span>
            )}
          </button>
        ))}
        <div style={{ flex: 1 }} />
        <button
          onClick={copy}
          title={copied ? 'Copied!' : 'Copy'}
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            padding: '8px 12px', color: copied ? '#22c55e' : 'rgba(255,255,255,0.25)',
            display: 'flex', alignItems: 'center', transition: 'color 0.15s',
          }}
        >
          {copied
            ? <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            : <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2" /><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" /></svg>
          }
        </button>
      </div>
      {/* Code body */}
      <div style={{ padding: '14px 16px' }}>
        {code.split('\n').map((ln, i) => (
          <div key={i} style={{ fontFamily: '"JetBrains Mono","Fira Code","Cascadia Code",monospace', fontSize: 13, lineHeight: 1.75 }}>
            <span style={{ color: '#404040', userSelect: 'none' }}>$ </span>
            {tokenizeShell(ln).map((t, j) => (
              <span key={j} style={{ color: t.color }}>{t.text}</span>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}

const STEP_DOT_STYLE: React.CSSProperties = {
  position: 'absolute', left: -30, top: 4,
  width: 12, height: 12, borderRadius: '50%',
  border: '1.5px solid rgba(255,255,255,0.15)',
  background: '#111', display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function OfflineCard() {
  const { theme, toggleTheme } = useApp();
  const currentUrl = getCliUrl();
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [tokenInput, setTokenInput] = useState(getCliToken() ?? '');
  const [showConnect, setShowConnect] = useState(currentUrl !== 'http://localhost:3388');
  const [installTab, setInstallTab] = useState<InstallTab>('curl');
  const isUnsafeMix = typeof window !== 'undefined'
    && window.location.protocol === 'https:'
    && urlInput.startsWith('http:')
    && !urlInput.startsWith('http://localhost')
    && !urlInput.startsWith('http://127.0.0.1');

  const save = () => { setCliUrl(urlInput); setCliToken(tokenInput.trim()); window.location.reload(); };
  const reset = () => { clearCliUrl(); clearCliToken(); window.location.reload(); };

  const INSTALL_TABS: ShellTabDef[] = [
    { id: 'curl', label: 'curl', badge: 'recommended' },
    { id: 'npm', label: 'npm' },
    { id: 'bun', label: 'bun' },
  ];

  const INSTALL_CODE: Record<InstallTab, string> = {
    curl: 'curl -fsSL https://studio.stroke.click/install.sh | sh',
    npm: 'npm install -g wasper-cli',
    bun: 'bun add -g wasper-cli',
  };

  return (
    <div className="offline-overlay">
      <button
        onClick={toggleTheme}
        title={`${theme === 'dark' ? 'Light' : 'Dark'} mode`}
        style={{
          position: 'fixed', top: 16, right: 16,
          display: 'flex', alignItems: 'center', justifyContent: 'center',
          width: 32, height: 32, borderRadius: 8, border: 0,
          background: 'transparent', color: 'var(--muted-foreground)',
          cursor: 'pointer', transition: 'color 0.15s, background 0.15s',
        }}
        onMouseEnter={e => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--foreground)';
          (e.currentTarget as HTMLButtonElement).style.background = 'color-mix(in srgb, var(--foreground) 7%, transparent)';
        }}
        onMouseLeave={e => {
          (e.currentTarget as HTMLButtonElement).style.color = 'var(--muted-foreground)';
          (e.currentTarget as HTMLButtonElement).style.background = 'transparent';
        }}
      >
        {theme === 'dark' ? <Sun size={15} /> : <Moon size={15} />}
      </button>
      <div style={{ maxWidth: 600, width: '100%' }}>

        {/* Logo + Title */}
        <div style={{ marginBottom: 48 }}>
          <div style={{
            width: 44, height: 44, borderRadius: 12, marginBottom: 20,
            background: 'color-mix(in srgb, var(--foreground) 92%, transparent)',
            boxShadow: '0 0 0 1px color-mix(in srgb, var(--foreground) 12%, transparent), 0 8px 24px color-mix(in srgb, var(--foreground) 10%, transparent)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
          }}>
            <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--background)" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <h1 style={{ fontSize: 26, fontWeight: 700, lineHeight: 1.25, margin: 0, color: 'var(--foreground)' }}>
            Get started with Wasper Studio
          </h1>
          <p style={{ marginTop: 8, fontSize: 14, color: 'var(--muted-foreground)', lineHeight: 1.6, margin: '8px 0 0' }}>
            Follow the steps below to connect the studio to your OpenAPI spec.
          </p>
          <div style={{ marginTop: 14, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--muted-foreground)' }}>
            Connecting to{' '}
            <code style={{
              fontFamily: 'monospace', fontSize: 12,
              background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)',
              borderRadius: 5, padding: '2px 7px', color: 'rgba(255,255,255,0.8)',
            }}>
              {currentUrl}
            </code>
            <span className="connecting-dots"><span /><span /><span /></span>
          </div>
        </div>

        {/* Stepper */}
        <div style={{ position: 'relative', paddingLeft: 32 }}>
          {/* Vertical line */}
          <div style={{
            position: 'absolute', left: 5, top: 4, bottom: 4, width: 1,
            background: 'rgba(255,255,255,0.07)',
          }} />

          {/* ── Step 1: Install ── */}
          <div style={{ position: 'relative', marginBottom: 44 }}>
            <div style={STEP_DOT_STYLE} />
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>
              Install the CLI
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
              Choose your preferred install method
            </p>
            <ShellBlock
              tabs={INSTALL_TABS}
              activeTab={installTab}
              onTabChange={id => setInstallTab(id as InstallTab)}
              code={INSTALL_CODE[installTab]}
            />
            <p style={{ marginTop: 8, fontSize: 12, color: 'rgba(255,255,255,0.3)', lineHeight: 1.5 }}>
              {installTab === 'curl'
                ? 'Standalone binary — no bun or node required.'
                : <>Requires <strong style={{ color: 'rgba(255,255,255,0.5)' }}>bun</strong> to be installed.{' '}
                  <button onClick={() => window.open('https://bun.sh', '_blank')} style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary)', fontSize: 12, textDecoration: 'underline', fontFamily: 'inherit' }}>
                    Install bun →
                  </button>
                </>
              }
            </p>
          </div>

          {/* ── Step 2: Run ── */}
          <div style={{ position: 'relative', marginBottom: 44 }}>
            <div style={STEP_DOT_STYLE} />
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>
              Start the server
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.5 }}>
              Point the CLI at your OpenAPI spec URL
            </p>
            <ShellBlock code="wasper --url https://petstore3.swagger.io/api/v3/openapi.json" />
          </div>

          {/* ── Step 3: Connect ── */}
          <div style={{ position: 'relative' }}>
            <div style={STEP_DOT_STYLE} />
            <h2 style={{ fontSize: 16, fontWeight: 600, color: 'var(--foreground)', margin: '0 0 4px' }}>
              Connect the studio
            </h2>
            <p style={{ fontSize: 13.5, color: 'var(--muted-foreground)', margin: 0, lineHeight: 1.6 }}>
              By default connects to{' '}
              <code style={{ fontFamily: 'monospace', fontSize: 12, background: 'rgba(255,255,255,0.06)', border: '1px solid rgba(255,255,255,0.1)', borderRadius: 4, padding: '1px 5px' }}>
                localhost:3388
              </code>
              . Running on a different host?
            </p>

            {!showConnect ? (
              <button
                onClick={() => setShowConnect(true)}
                style={{
                  marginTop: 12, display: 'inline-flex', alignItems: 'center', gap: 6,
                  background: 'rgba(255,255,255,0.05)',
                  border: '1px solid rgba(255,255,255,0.1)',
                  borderRadius: 8, padding: '8px 16px', cursor: 'pointer',
                  fontSize: 13, color: 'rgba(255,255,255,0.75)', fontFamily: 'inherit',
                  transition: 'background 0.12s, border-color 0.12s',
                }}
              >
                Configure CLI URL
              </button>
            ) : (
              <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  className="input font-mono text-[12.5px]"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="http://localhost:3388"
                  onKeyDown={e => e.key === 'Enter' && save()}
                />
                <input
                  className="input font-mono text-[12.5px]"
                  type="password"
                  value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  placeholder="Access token (optional — for --token servers)"
                  onKeyDown={e => e.key === 'Enter' && save()}
                />
                {isUnsafeMix && (
                  <p style={{ margin: 0, fontSize: 12, color: 'var(--warning)' }}>
                    ⚠ Browsers block HTTP→non-localhost from HTTPS pages.
                  </p>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}>Connect</button>
                  {currentUrl !== 'http://localhost:3388' && (
                    <button className="btn btn-ghost" onClick={reset}>Reset</button>
                  )}
                </div>
              </div>
            )}

            <p style={{ marginTop: 16, fontSize: 13, color: 'var(--muted-foreground)', marginBottom: 6 }}>
              Self-hosted server with token auth:
            </p>
            <ShellBlock code="wasper --url <spec-url> --token my-secret" />
          </div>
        </div>

        {/* Footer */}
        <div style={{
          marginTop: 44, paddingTop: 20,
          borderTop: '1px solid rgba(255,255,255,0.06)',
          display: 'flex', gap: 16, fontSize: 13, color: 'rgba(255,255,255,0.35)',
        }}>
          <button
            onClick={() => window.open('https://github.com/broisnischal/wasper/issues', '_blank')}
            style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'rgba(255,255,255,0.35)', fontSize: 13, textDecoration: 'underline', fontFamily: 'inherit' }}
          >
            Open an issue
          </button>
          <a href="/docs" style={{ color: 'rgba(255,255,255,0.35)', textDecoration: 'underline', fontSize: 13 }}>
            Docs
          </a>
        </div>
      </div>
    </div>
  );
}

interface ParsedOp { operationId: string; method: string; path: string; summary?: string; tags: string[]; }

// Routes that render without a CLI connection
const PUBLIC_ROUTES = ['/docs'];

// ── App shell ──────────────────────────────────────────────────────────────
function AppShell() {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const isPublic = PUBLIC_ROUTES.some(r => pathname === r || pathname.startsWith(r + '/'));

  const [theme, setTheme] = useState<'dark' | 'light'>('dark');
  const [cmdOpen, setCmdOpen] = useState(false);
  const [connected, setConnected] = useState<boolean | null>(null);
  const [operations, setOperations] = useState<ParsedOp[]>([]);
  const pendingOpRef = useRef<ParsedOp | null>(null);
  const [helpOpen, setHelpOpen] = useState(false);
  const [aiPanelOpen, setAiPanelOpen] = useState(false);
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === '1'; } catch { return false; }
  });
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [activeEnvId, setActiveEnvIdState] = useState<string | null>(() => getActiveEnvId());
  const [HotkeysLayer, setHotkeysLayer] = useState<typeof import('../components/HotkeysLayer').HotkeysLayer | null>(null);
  const [features, setFeaturesState] = useState<Features>(DEFAULT_FEATURES);
  const [wsConnected, setWsConnected] = useState(false);
  const wsRef = useRef<WebSocket | null>(null);
  const wsRetryRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const toggleSidebar = () => setSidebarCollapsed(v => {
    const next = !v;
    try { localStorage.setItem('sidebar_collapsed', next ? '1' : '0'); } catch { /**/ }
    return next;
  });

  const setActiveEnvId = (id: string | null) => {
    persistActiveEnv(id);
    setActiveEnvIdState(id);
  };

  const reloadEnvs = () => { listEnvironments().then(setEnvs).catch(() => {}); };

  useEffect(() => { reloadEnvs(); }, []);

  useEffect(() => {
    import('../components/HotkeysLayer').then(m => setHotkeysLayer(() => m.HotkeysLayer));
  }, []);

  // Inject fonts + restore theme on mount
  useEffect(() => {
    injectFonts();
    const saved = localStorage.getItem('theme') as 'dark' | 'light' | null;
    const initial = saved ?? (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark');
    setTheme(initial);
  }, []);

  // Apply theme to <html>
  useEffect(() => {
    document.documentElement.setAttribute('data-theme', theme);
    localStorage.setItem('theme', theme);
  }, [theme]);

  const toggleTheme = () => setTheme(t => t === 'dark' ? 'light' : 'dark');

  // Poll for CLI connection
  useEffect(() => {
    let dead = false;
    const check = async () => {
      try {
        await apiClient<unknown>('/api/status');
        if (!dead) setConnected(true);
      } catch {
        if (!dead) setConnected(false);
      }
    };
    check();
    const t = setInterval(check, 4000);
    return () => { dead = true; clearInterval(t); };
  }, []);

  // Load operations for Cmd+K
  useEffect(() => {
    if (!connected) return;
    apiClient<ParsedOp[]>('/api/spec/endpoints').then(setOperations).catch(() => {});
  }, [connected]);

  // Global WebSocket — shared across pages for live features/logs
  useEffect(() => {
    if (!connected) {
      wsRef.current?.close();
      wsRef.current = null;
      setWsConnected(false);
      return;
    }

    // Fetch initial feature state
    apiClient<Features>('/api/features').then(setFeaturesState).catch(() => {});

    let dead = false;
    const connect = () => {
      if (dead) return;
      const ws = new WebSocket(LOG_WS_URL);
      wsRef.current = ws;
      ws.onopen = () => { if (!dead) setWsConnected(true); };
      ws.onclose = () => {
        if (!dead) {
          setWsConnected(false);
          wsRetryRef.current = setTimeout(connect, 3000);
        }
      };
      ws.onerror = () => { ws.close(); };
      ws.onmessage = (e) => {
        if (dead) return;
        try {
          const msg = JSON.parse(e.data as string) as Record<string, unknown>;
          if (msg.type === 'server_event' && msg.kind === 'features') {
            setFeaturesState(msg.data as Features);
            return;
          }
          // Forward log entries to any listening page
          if (msg.id && msg.method) {
            window.dispatchEvent(new CustomEvent('cli-log', { detail: msg }));
          }
        } catch { /**/ }
      };
    };
    connect();
    return () => {
      dead = true;
      if (wsRetryRef.current) clearTimeout(wsRetryRef.current);
      wsRef.current?.close();
    };
  }, [connected]);

  // Cmd+K is handled by GlobalHotkeys (inside HotkeysProvider) — no manual listener needed

  // Keyboard help button in sidebar fires this custom event
  useEffect(() => {
    const handler = () => setHelpOpen(v => !v);
    window.addEventListener('open-hotkey-help', handler);
    return () => window.removeEventListener('open-hotkey-help', handler);
  }, []);

  // AI panel open event
  useEffect(() => {
    const handler = () => setAiPanelOpen(true);
    window.addEventListener('open-ai-panel', handler);
    return () => window.removeEventListener('open-ai-panel', handler);
  }, []);

  const handleCmdSelect = (op: ParsedOp) => {
    pendingOpRef.current = op;
    window.dispatchEvent(new CustomEvent('cmd-open-endpoint', { detail: op }));
  };

  // Loading state: null = still checking (skip for public routes)
  if (connected === null && !isPublic) {
    return (
      <div className="flex h-screen flex-col items-center justify-center bg-[var(--background)]" style={{ animation: 'fade-in 0.2s ease' }}>
        <div className="flex flex-col items-center gap-5 text-center">
          <div className="flex size-12 items-center justify-center rounded-2xl bg-[var(--foreground)]">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--background)" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
            </svg>
          </div>
          <div>
            <div className="text-[18px] font-bold tracking-tight text-[var(--foreground)]">Wasper Studio</div>
            <div className="mt-2.5 flex items-center justify-center gap-2 text-[13px] text-[var(--muted-foreground)]">
              Connecting to CLI
              <span className="connecting-dots"><span /><span /><span /></span>
            </div>
          </div>
        </div>
      </div>
    );
  }

  const main = (
    <>
      {isPublic ? (
        // Public routes (e.g. /docs): full-screen, no app sidebar, no connection gate
        <div className="h-screen w-screen overflow-hidden bg-[var(--background)]">
          <Outlet />
        </div>
      ) : (
        <>
          {connected === false && <OfflineCard />}

          <div className={`flex h-screen overflow-hidden transition-opacity duration-200 ${connected ? 'opacity-100' : 'opacity-0'}`}>
            <Sidebar />
            <main className="flex-1 min-w-0 overflow-hidden bg-[var(--background)] flex flex-col">
              <Outlet />
            </main>
          </div>

          <CommandPalette
            open={cmdOpen}
            onClose={() => setCmdOpen(false)}
            operations={operations}
            onSelect={handleCmdSelect}
          />
          <HotkeyHelp open={helpOpen} onClose={() => setHelpOpen(false)} />
          <AiPanel open={aiPanelOpen} onClose={() => setAiPanelOpen(false)} />
        </>
      )}
    </>
  );

  return (
    <AppContext.Provider value={{
      theme, toggleTheme, cmdOpen, setCmdOpen, connected: connected ?? false,
      sidebarCollapsed, toggleSidebar,
      envs, activeEnvId, setActiveEnvId, reloadEnvs,
      features, setFeatures: setFeaturesState,
      wsConnected,
    }}>
      {HotkeysLayer ? (
        <HotkeysLayer
          onHelpToggle={() => setHelpOpen(v => !v)}
          onHelpClose={() => setHelpOpen(false)}
        >
          {main}
        </HotkeysLayer>
      ) : main}
    </AppContext.Provider>
  );
}
