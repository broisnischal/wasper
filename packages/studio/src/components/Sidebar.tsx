import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { useApp } from '../context';
import { cacheGet, cacheSet } from '../lib/cache';
import { cn } from '../lib/utils';
import {
  LayoutGrid, Terminal, Activity, Key, Settings, Bot,
  Sun, Moon, BookOpen, ExternalLink, Search, ArrowRightLeft,
  ChevronLeft, ChevronRight, Layers, Keyboard,
} from 'lucide-react';

interface Status { spec: { title: string; version: string }; endpointCount: number; }

const MAIN_NAV = [
  { to: '/',          icon: LayoutGrid,     label: 'Overview',       exact: true  },
  { to: '/explorer',  icon: Terminal,       label: 'Explorer',       exact: false },
  { to: '/ai',        icon: Bot,            label: 'AI Chat',        exact: false },
  { to: '/intercept', icon: ArrowRightLeft, label: 'Intercept',      exact: false },
  { to: '/logs',      icon: Activity,       label: 'Logs',           exact: false },
] as const;

const CONFIG_NAV = [
  { to: '/auth',         icon: Key,      label: 'Authentication', exact: false },
  { to: '/environments', icon: Layers,   label: 'Environments',   exact: false },
  { to: '/settings',     icon: Settings, label: 'Settings',       exact: false },
] as const;

type NavTo = typeof MAIN_NAV[number]['to'] | typeof CONFIG_NAV[number]['to'];

function NavItem({ to, icon: Icon, label, exact, collapsed }: {
  to: NavTo; icon: React.ElementType; label: string; exact: boolean; collapsed: boolean;
}) {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + '/');
  return (
    <Link
      to={to as '/'}
      title={collapsed ? label : undefined}
      className={cn(
        'flex items-center gap-2.5 px-2.5 h-8 rounded-md w-full text-[13.5px] tracking-tight transition-colors duration-100 no-underline',
        collapsed && 'justify-center px-0',
        active
          ? 'text-[var(--primary)] font-medium bg-[var(--primary-dim)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)] hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]',
      )}
    >
      <Icon size={15} strokeWidth={active ? 2.1 : 1.7} className="flex-shrink-0 text-inherit" />
      {!collapsed && label}
    </Link>
  );
}

export function Sidebar() {
  const [status, setStatus] = useState<Status | null>(null);
  const { theme, toggleTheme, setCmdOpen, connected, sidebarCollapsed, toggleSidebar, envs, activeEnvId, setActiveEnvId } = useApp();

  const activeEnv = envs.find(e => e.id === activeEnvId) ?? null;

  useEffect(() => {
    if (!connected) { setStatus(null); return; }
    let dead = false;
    const load = async () => {
      try {
        const cached = await cacheGet<Status>('spec_status');
        if (cached && !dead) setStatus(cached);
        const d = await apiClient<Status>('/api/status');
        if (!dead) { setStatus(d); if (d.spec) cacheSet('spec_status', d, 60_000); }
      } catch { /* ignore */ }
    };
    load();
    const t = setInterval(load, 10_000);
    return () => { dead = true; clearInterval(t); };
  }, [connected]);

  const collapsed = sidebarCollapsed;
  const w = collapsed ? 'w-[52px] min-w-[52px]' : 'w-[220px] min-w-[220px]';

  return (
    <aside className={cn('h-screen flex flex-col bg-[var(--sidebar)] border-r border-[var(--border)] select-none transition-all duration-200', w)}>

      {/* Header */}
      <div className={cn('flex items-center h-[42px] border-b border-[var(--border)] flex-shrink-0', collapsed ? 'justify-center px-0' : 'gap-2.5 px-4')}>
        <span
          className="w-2 h-2 rounded-full flex-shrink-0 transition-colors duration-300"
          style={{
            background: connected ? 'var(--primary)' : 'var(--muted-foreground)',
            boxShadow: connected ? '0 0 6px rgba(34,197,94,0.5)' : 'none',
          }}
        />
        {!collapsed && (
          <span className="text-[13.5px] font-semibold tracking-tight text-[var(--foreground)] truncate flex-1 leading-none">
            {status?.spec.title ?? 'OpenAPI Agent'}
          </span>
        )}
      </div>

      {/* Search */}
      {!collapsed && (
        <div className="px-3 pt-3 pb-1 flex-shrink-0">
          <button
            onClick={() => setCmdOpen(true)}
            className="w-full flex items-center gap-2 px-2.5 h-8 rounded-lg bg-transparent border border-[var(--border)] text-[var(--placeholder-foreground)] text-[12.5px] tracking-tight hover:border-[var(--border-hover)] hover:text-[var(--muted-foreground)] transition-colors cursor-pointer font-sans"
          >
            <Search size={12} className="flex-shrink-0" />
            <span className="flex-1 text-left">Search…</span>
            <kbd className="bg-[var(--elevated)] border border-[var(--border)] rounded px-1.5 text-[10px] font-mono leading-4">⌘K</kbd>
          </button>
        </div>
      )}
      {collapsed && (
        <div className="pt-2 px-1.5 flex-shrink-0">
          <button
            onClick={() => setCmdOpen(true)}
            title="Search (⌘K)"
            className="w-full flex items-center justify-center h-8 rounded-lg bg-transparent border border-[var(--border)] text-[var(--placeholder-foreground)] hover:border-[var(--border-hover)] hover:text-[var(--muted-foreground)] transition-colors cursor-pointer"
          >
            <Search size={13} />
          </button>
        </div>
      )}

      {/* Main nav */}
      <nav className={cn('pt-1 flex flex-col gap-0.5 flex-shrink-0', collapsed ? 'px-1.5' : 'px-2.5')}>
        {MAIN_NAV.map(item => <NavItem key={item.to} {...item} collapsed={collapsed} />)}
      </nav>

      {/* Config section */}
      <div className={cn('mt-2 flex-shrink-0', collapsed ? 'px-1.5' : 'px-2.5')}>
        {!collapsed && (
          <div className="px-1 py-1.5 text-[11px] font-semibold tracking-widest uppercase text-[var(--placeholder-foreground)]">
            Configuration
          </div>
        )}
        {collapsed && <div className="h-[1px] bg-[var(--border)] mx-1 mb-1" />}
        <div className="flex flex-col gap-0.5">
          {CONFIG_NAV.map(item => <NavItem key={item.to} {...item} collapsed={collapsed} />)}
        </div>
      </div>

      {/* Spacer */}
      <div className="flex-1 min-h-0" />

      {/* Environment picker */}
      {envs.length > 0 && (
        <div className={cn('border-t border-[var(--border)] flex-shrink-0', collapsed ? 'px-1.5 py-2' : 'px-2.5 py-2')}>
          {collapsed ? (
            <div
              title={activeEnv?.name ?? 'No env'}
              className="flex items-center justify-center h-7 w-full rounded-md"
            >
              <span
                className="w-2.5 h-2.5 rounded-full flex-shrink-0"
                style={{ background: activeEnv?.color ?? 'var(--muted-foreground)' }}
              />
            </div>
          ) : (
            <select
              className="w-full text-[11.5px] bg-transparent border-0 outline-none cursor-pointer text-[var(--muted-foreground)] font-sans py-1 pr-1"
              value={activeEnvId ?? ''}
              onChange={e => setActiveEnvId(e.target.value || null)}
            >
              <option value="">No environment</option>
              {envs.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
            </select>
          )}
        </div>
      )}

      {/* Docs link */}
      {!collapsed && (
        <div className="px-2.5 border-t border-[var(--border)]">
          <a
            href="https://modelcontextprotocol.io"
            target="_blank"
            rel="noopener noreferrer"
            className={cn(
              'flex items-center gap-2.5 px-2.5 h-8 rounded-md w-full text-[13.5px] tracking-tight transition-colors duration-100 no-underline',
              'text-[var(--muted-foreground)] hover:text-[var(--foreground-secondary)] hover:bg-[color-mix(in_srgb,var(--foreground)_6%,transparent)]',
            )}
          >
            <BookOpen size={15} strokeWidth={1.7} className="flex-shrink-0" />
            Documentation
            <ExternalLink size={11} className="ml-auto opacity-40" />
          </a>
        </div>
      )}

      {/* Footer */}
      <div className={cn('flex items-center gap-1.5 py-3 border-t border-[var(--border)] flex-shrink-0', collapsed ? 'px-1.5 flex-col gap-1.5' : 'px-4')}>
        {!collapsed && (
          <span className="text-[12px] text-[var(--muted-foreground)] flex-1 truncate">
            {connected
              ? (status ? `${status.endpointCount} endpoints` : 'Connected')
              : 'Disconnected'}
          </span>
        )}
        <button
          onClick={toggleTheme}
          title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode (Mod+Shift+D)`}
          className="flex items-center justify-center w-[26px] h-[26px] rounded-md bg-transparent border border-[var(--border)] text-[var(--muted-foreground)] cursor-pointer flex-shrink-0 hover:border-[var(--border-hover)] hover:text-[var(--foreground)] transition-colors"
        >
          {theme === 'dark' ? <Sun size={12} /> : <Moon size={12} />}
        </button>
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-hotkey-help'))}
          title="Keyboard shortcuts (?)"
          className="flex items-center justify-center w-[26px] h-[26px] rounded-md bg-transparent border border-[var(--border)] text-[var(--placeholder-foreground)] cursor-pointer flex-shrink-0 hover:border-[var(--border-hover)] hover:text-[var(--foreground)] transition-colors"
        >
          <Keyboard size={11} />
        </button>
        <button
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar (Mod+B)' : 'Collapse sidebar (Mod+B)'}
          className="flex items-center justify-center w-[26px] h-[26px] rounded-md bg-transparent border border-[var(--border)] text-[var(--muted-foreground)] cursor-pointer flex-shrink-0 hover:border-[var(--border-hover)] hover:text-[var(--foreground)] transition-colors"
        >
          {collapsed ? <ChevronRight size={12} /> : <ChevronLeft size={12} />}
        </button>
      </div>
    </aside>
  );
}
