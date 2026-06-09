import { HeadContent, Outlet, Scripts, createRootRoute } from '@tanstack/react-router';
import { useEffect, useState, useRef } from 'react';
import { Sidebar } from '../components/Sidebar';
import { CommandPalette } from '../components/CommandPalette';
import { HotkeyHelp } from '../components/HotkeyHelp';
import { AppContext, useApp } from '../context';
import { apiClient, getCliUrl, setCliUrl, clearCliUrl } from '../lib/api';
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
      { title: 'OpenAPI Agent Studio' },
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
      <body>
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
  const [showUrlEdit, setShowUrlEdit] = useState(false);
  const isUnsafeMix = typeof window !== 'undefined'
    && window.location.protocol === 'https:'
    && urlInput.startsWith('http:')
    && !urlInput.startsWith('http://localhost')
    && !urlInput.startsWith('http://127.0.0.1');

  const save = () => { setCliUrl(urlInput); window.location.reload(); };
  const reset = () => { clearCliUrl(); window.location.reload(); };

  return (
    <div className="offline-overlay">
      <div style={{ width: '100%', maxWidth: 860, padding: '0 24px' }}>
        {/* Header */}
        <div style={{ marginBottom: 52 }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--foreground)', lineHeight: 1.25, margin: 0 }}>
            Hey 👋
            <br />
            Welcome to OpenAPI Agent Studio
          </h1>
          <div style={{ marginTop: 12, fontSize: 14, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 10 }}>
            Connecting to the CLI on{' '}
            <code style={{ fontFamily: 'GeistMono, monospace', fontSize: 12.5 }}>{currentUrl}</code>
            <span className="connecting-dots">
              <span /><span /><span />
            </span>
          </div>
        </div>

        {/* Two-column content */}
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '0 96px' }}>
          {/* Left: CLI instructions */}
          <div>
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: 'linear-gradient(135deg, #166534 0%, #15803d 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18, boxShadow: '0 2px 8px rgba(22,101,52,0.4)',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="4 17 10 11 4 5" />
                <line x1="12" y1="19" x2="20" y2="19" />
              </svg>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--foreground)', marginBottom: 12, letterSpacing: '-0.02em' }}>
              OpenAPI Agent CLI
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--muted-foreground)', marginBottom: 18, lineHeight: 1.6 }}>
              Make sure the CLI is up and running
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--muted-foreground)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>1. Install the CLI globally:</div>
              <code style={{
                fontSize: 12.5, fontFamily: 'GeistMono, monospace',
                background: 'var(--elevated)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '6px 11px', display: 'inline-block', color: 'var(--foreground)',
              }}>npm i -g openapi-agent</code>
              <div style={{ marginTop: 2 }}>2. Start the CLI with your spec:</div>
              <code style={{
                fontSize: 12.5, fontFamily: 'GeistMono, monospace',
                background: 'var(--elevated)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '6px 11px', display: 'inline-block', color: 'var(--foreground)',
              }}>openapi-agent --url &lt;spec-url&gt;</code>
            </div>
            <div style={{ marginTop: 22, fontSize: 13.5, color: 'var(--muted-foreground)', lineHeight: 1.7 }}>
              Still experiencing issues?<br />
              <button
                onClick={() => window.open('https://github.com/broisnischal/openapi-agent/issues', '_blank')}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: 'var(--primary)', fontSize: 13.5, fontFamily: 'inherit', textDecoration: 'underline', textUnderlineOffset: 2 }}
              >
                Open an issue on GitHub
              </button>
            </div>
          </div>

          {/* Right: Custom URL / remote CLI */}
          <div>
            <div style={{
              width: 46, height: 46, borderRadius: 12,
              background: 'linear-gradient(135deg, #1e3a5f 0%, #1d4ed8 100%)',
              display: 'flex', alignItems: 'center', justifyContent: 'center',
              marginBottom: 18, boxShadow: '0 2px 8px rgba(29,78,216,0.35)',
            }}>
              <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <circle cx="12" cy="12" r="10" />
                <line x1="2" y1="12" x2="22" y2="12" />
                <path d="M12 2a15.3 15.3 0 0 1 4 10 15.3 15.3 0 0 1-4 10 15.3 15.3 0 0 1-4-10 15.3 15.3 0 0 1 4-10z" />
              </svg>
            </div>
            <div style={{ fontSize: 15.5, fontWeight: 700, color: 'var(--foreground)', marginBottom: 12, letterSpacing: '-0.02em' }}>
              Using a remote or custom URL?
            </div>
            <div style={{ fontSize: 13.5, color: 'var(--muted-foreground)', marginBottom: 18, lineHeight: 1.6 }}>
              By default the studio connects to{' '}
              <code style={{ fontFamily: 'GeistMono, monospace', fontSize: 12, background: 'var(--elevated)', padding: '1px 6px', borderRadius: 4 }}>localhost:3388</code>.
              If your CLI is running elsewhere, update the URL below.
            </div>
            {!showUrlEdit ? (
              <button
                onClick={() => setShowUrlEdit(true)}
                style={{
                  fontSize: 13.5, color: 'var(--primary)', background: 'none', border: 'none',
                  cursor: 'pointer', padding: 0, fontFamily: 'inherit',
                  textDecoration: 'underline', textUnderlineOffset: 2,
                }}
              >
                Change CLI URL
              </button>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                <input
                  className="input"
                  value={urlInput}
                  onChange={e => setUrlInput(e.target.value)}
                  placeholder="http://localhost:3388"
                  onKeyDown={e => e.key === 'Enter' && save()}
                  style={{ fontFamily: 'GeistMono, monospace', fontSize: 12.5 }}
                />
                {isUnsafeMix && (
                  <div style={{ fontSize: 12, color: 'var(--warning)', lineHeight: 1.5 }}>
                    ⚠ Browsers block HTTP→non-localhost from HTTPS pages. Use <strong>https://</strong> or <strong>localhost</strong>.
                  </div>
                )}
                <div style={{ display: 'flex', gap: 8 }}>
                  <button className="btn btn-primary" style={{ flex: 1 }} onClick={save}>Connect</button>
                  {currentUrl !== 'http://localhost:3388' && (
                    <button className="btn btn-ghost" onClick={reset}>Reset</button>
                  )}
                </div>
              </div>
            )}
            <div style={{ marginTop: 24, fontSize: 13.5, color: 'var(--muted-foreground)', display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div>1. Start the CLI with a custom port:</div>
              <code style={{
                fontSize: 12.5, fontFamily: 'GeistMono, monospace',
                background: 'var(--elevated)', border: '1px solid var(--border)',
                borderRadius: 6, padding: '6px 11px', display: 'inline-block',
                color: 'var(--foreground)',
              }}>openapi-agent --port 4000</code>
              <div>2. Enter the URL above and click Connect</div>
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
  const [sidebarCollapsed, setSidebarCollapsed] = useState(() => {
    try { return localStorage.getItem('sidebar_collapsed') === '1'; } catch { return false; }
  });
  const [envs, setEnvs] = useState<Environment[]>([]);
  const [activeEnvId, setActiveEnvIdState] = useState<string | null>(() => getActiveEnvId());
  const [HotkeysLayer, setHotkeysLayer] = useState<typeof import('../components/HotkeysLayer').HotkeysLayer | null>(null);

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

  // Cmd+K is handled by GlobalHotkeys (inside HotkeysProvider) — no manual listener needed

  // Keyboard help button in sidebar fires this custom event
  useEffect(() => {
    const handler = () => setHelpOpen(v => !v);
    window.addEventListener('open-hotkey-help', handler);
    return () => window.removeEventListener('open-hotkey-help', handler);
  }, []);

  const handleCmdSelect = (op: ParsedOp) => {
    pendingOpRef.current = op;
    window.dispatchEvent(new CustomEvent('cmd-open-endpoint', { detail: op }));
  };

  // Loading state: null = still checking
  if (connected === null) {
    return (
      <div style={{
        height: '100vh', display: 'flex', flexDirection: 'column',
        alignItems: 'center', justifyContent: 'center',
        background: 'var(--background)', animation: 'fade-in 0.2s ease',
      }}>
        <div style={{ maxWidth: 860, width: '100%', padding: '0 24px' }}>
          <h1 style={{ fontSize: 28, fontWeight: 700, letterSpacing: '-0.04em', color: 'var(--foreground)', lineHeight: 1.25, margin: 0 }}>
            Hey 👋
            <br />
            Welcome to OpenAPI Agent Studio
          </h1>
          <div style={{ marginTop: 12, fontSize: 14, color: 'var(--muted-foreground)', display: 'flex', alignItems: 'center', gap: 10 }}>
            Connecting to the CLI…
            <span className="connecting-dots"><span /><span /><span /></span>
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
    </>
  );

  return (
    <AppContext.Provider value={{
      theme, toggleTheme, cmdOpen, setCmdOpen, connected: connected ?? false,
      sidebarCollapsed, toggleSidebar,
      envs, activeEnvId, setActiveEnvId, reloadEnvs,
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
