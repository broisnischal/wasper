import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { useEffect, useState, useRef } from 'react';
import { Sidebar } from '../components/Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { HotkeyHelp } from '../components/HotkeyHelp';
import { AiPanel } from '../components/AiPanel';
import { AppContext, DEFAULT_FEATURES, type Features } from '../context';
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

function OfflineCard() {
  const currentUrl = getCliUrl();
  const [urlInput, setUrlInput] = useState(currentUrl);
  const [tokenInput, setTokenInput] = useState(getCliToken() ?? '');
  const [showUrlEdit, setShowUrlEdit] = useState(false);
  const isUnsafeMix = typeof window !== 'undefined'
    && window.location.protocol === 'https:'
    && urlInput.startsWith('http:')
    && !urlInput.startsWith('http://localhost')
    && !urlInput.startsWith('http://127.0.0.1');

  const save = () => { setCliUrl(urlInput); setCliToken(tokenInput.trim()); window.location.reload(); };
  const reset = () => { clearCliUrl(); clearCliToken(); window.location.reload(); };

  return (
    <div className="offline-overlay">
      <div className="w-full max-w-[800px] px-6">

        {/* Header */}
        <div className="mb-10">
          <h1 className="text-[26px] font-bold leading-snug tracking-tight text-[var(--foreground)]">
            Hey 👋<br />Welcome to Wasper Studio
          </h1>
          <div className="mt-3 flex items-center gap-2.5 text-[13.5px] text-[var(--muted-foreground)]">
            Connecting to the CLI on{' '}
            <code className="rounded-md border border-[var(--border)] bg-[var(--elevated)] px-2 py-0.5 font-mono text-[12px] text-[var(--foreground)]">
              {currentUrl}
            </code>
            <span className="connecting-dots"><span /><span /><span /></span>
          </div>
        </div>

        {/* Two-column */}
        <div className="grid grid-cols-2 gap-16">

          {/* Left: CLI instructions */}
          <div>
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #166534 0%, #15803d 100%)', boxShadow: '0 2px 8px rgba(22,101,52,0.4)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" /><line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <h2 className="mb-2 text-[15px] font-bold tracking-tight text-[var(--foreground)]">wasper-cli</h2>
            <p className="mb-4 text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
              Make sure the CLI is up and running
            </p>
            <div className="flex flex-col gap-2 text-[13px] text-[var(--muted-foreground)]">
              <span>1. Install the CLI globally:</span>
              <code className="inline-block rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 font-mono text-[12.5px] text-[var(--foreground)]">
                npm i -g wasper-cli
              </code>
              <span className="mt-1">2. Start the CLI with your spec:</span>
              <code className="inline-block rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 font-mono text-[12.5px] text-[var(--foreground)]">
                wasper --url &lt;spec-url&gt;
              </code>
            </div>
            <p className="mt-5 text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
              Still experiencing issues?{' '}
              <button
                onClick={() => window.open('https://github.com/broisnischal/wasper/issues', '_blank')}
                className="border-0 bg-transparent p-0 font-sans text-[13.5px] cursor-pointer text-[var(--primary)] underline underline-offset-2"
              >
                Open an issue on GitHub
              </button>
            </p>
          </div>

          {/* Right: Custom URL */}
          <div>
            <div className="mb-4 flex size-11 items-center justify-center rounded-xl"
              style={{ background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)', boxShadow: '0 2px 8px rgba(29,78,216,0.35)' }}>
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" /><line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <h2 className="mb-2 text-[15px] font-bold tracking-tight text-[var(--foreground)]">Using a remote or custom URL?</h2>
            <p className="mb-4 text-[13.5px] leading-relaxed text-[var(--muted-foreground)]">
              By default the studio connects to{' '}
              <code className="rounded bg-[var(--elevated)] px-1.5 py-0.5 font-mono text-[12px]">localhost:3388</code>.
              If your CLI is running elsewhere, update the URL below.
            </p>
            {!showUrlEdit ? (
              <button onClick={() => setShowUrlEdit(true)}
                className="border-0 bg-transparent p-0 font-sans text-[13.5px] cursor-pointer text-[var(--primary)] underline underline-offset-2">
                Change CLI URL
              </button>
            ) : (
              <div className="flex flex-col gap-2">
                <input className="input font-mono text-[12.5px]" value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="http://localhost:3388"
                  onKeyDown={e => e.key === 'Enter' && save()} />
                <input className="input font-mono text-[12.5px]" type="password" value={tokenInput}
                  onChange={e => setTokenInput(e.target.value)}
                  placeholder="Access token (optional — for --token servers)"
                  onKeyDown={e => e.key === 'Enter' && save()} />
                {isUnsafeMix && (
                  <div className="text-[12px] leading-relaxed text-[var(--warning)]">
                    ⚠ Browsers block HTTP→non-localhost from HTTPS pages. Use <strong>https://</strong> or <strong>localhost</strong>.
                  </div>
                )}
                <div className="flex gap-2">
                  <button className="btn btn-primary flex-1" onClick={save}>Connect</button>
                  {currentUrl !== 'http://localhost:3388' && (
                    <button className="btn btn-ghost" onClick={reset}>Reset</button>
                  )}
                </div>
              </div>
            )}
            <div className="mt-5 flex flex-col gap-2 text-[13px] text-[var(--muted-foreground)]">
              <span>1. Start the CLI with a custom port:</span>
              <code className="inline-block rounded-lg border border-[var(--border)] bg-[var(--elevated)] px-3 py-2 font-mono text-[12.5px] text-[var(--foreground)]">
                wasper --port 4000
              </code>
              <span>2. Enter the URL above and click Connect</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

interface ParsedOp { operationId: string; method: string; path: string; summary?: string; tags: string[]; }

// ── App shell ──────────────────────────────────────────────────────────────
function AppShell() {
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

  // Loading state: null = still checking
  if (connected === null) {
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
