import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { useApp } from '../context';
import { cacheGet, cacheSet } from '../lib/cache';
import { cn } from '../lib/utils';
import {
  LayoutGrid, Terminal, Activity, Key, Settings, Bot,
  Sun, Moon, ArrowRightLeft,
  ChevronLeft, ChevronRight, Layers, Workflow, Sparkles, BookOpen, Gauge, Braces,
} from 'lucide-react';

interface Status { spec: { title: string; version: string }; endpointCount: number; }

const ALL_NAV = [
  { to: '/',           icon: LayoutGrid,     label: 'Overview',        exact: true  },
  { to: '/explorer',   icon: Terminal,       label: 'Explorer',        exact: false },
  { to: '/ai',         icon: Bot,            label: 'Quiry',           exact: false },
  { to: '/workflows',  icon: Workflow,       label: 'Workflows',       exact: false },
  { to: '/load-test',  icon: Gauge,          label: 'Load Test',       exact: false },
  { to: '/intercept',  icon: ArrowRightLeft, label: 'Intercept',       exact: false },
  { to: '/logs',       icon: Activity,       label: 'Logs',            exact: false },
  { to: '/auth',       icon: Key,            label: 'Authentication',  exact: false },
  { to: '/environments', icon: Layers,       label: 'Environments',    exact: false },
  { to: '/docs',       icon: BookOpen,       label: 'Docs',            exact: false },
  { to: '/settings',   icon: Settings,       label: 'Settings',        exact: false },
] as const;

type NavTo = typeof ALL_NAV[number]['to'];

function NavItem({ to, icon: Icon, label, exact, collapsed }: {
  to: NavTo; icon: React.ElementType; label: string; exact: boolean; collapsed: boolean;
}) {
  const pathname = useRouterState({ select: s => s.location.pathname });
  const active = exact ? pathname === to : pathname === to || pathname.startsWith(to + '/');

  if (collapsed) {
    return (
      <Link
        to={to as '/'}
        title={label}
        className={cn(
          'flex items-center justify-center w-8 h-8 mx-auto rounded-md transition-colors duration-100 no-underline',
          active
            ? 'text-[var(--foreground)] bg-[color-mix(in_srgb,var(--foreground)_9%,transparent)]'
            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]',
        )}
      >
        <Icon size={15} strokeWidth={active ? 2 : 1.75} className="flex-shrink-0" />
      </Link>
    );
  }

  return (
    <Link
      to={to as '/'}
      className={cn(
        'group relative flex items-center gap-2.5 pl-2.5 pr-3 h-[30px] rounded-[7px] w-full text-[12.5px] -tracking-[0.006em] transition-colors duration-100 no-underline',
        active
          ? 'text-[var(--foreground)] font-medium bg-[color-mix(in_srgb,var(--foreground)_8%,transparent)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_4.5%,transparent)]',
      )}
    >
      <Icon
        size={15}
        strokeWidth={active ? 2 : 1.75}
        className={cn('flex-shrink-0 transition-opacity', active ? 'opacity-100' : 'opacity-70 group-hover:opacity-100')}
      />
      {label}
    </Link>
  );
}

export function Sidebar() {
  const [status, setStatus] = useState<Status | null>(null);
  const { theme, toggleTheme, connected, sidebarCollapsed, toggleSidebar } = useApp();

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
  const w = collapsed ? 'w-[48px] min-w-[48px]' : 'w-[208px] min-w-[208px]';

  return (
    <aside className={cn(
      'h-screen flex flex-col bg-[var(--sidebar)] border-r border-[var(--border)] select-none transition-all duration-200 flex-shrink-0',
      w,
    )}>

      {/* ── Header ── */}
      <div className={cn(
        'flex items-center h-[46px] flex-shrink-0',
        collapsed ? 'justify-center px-2' : 'px-3.5',
      )}>
        {collapsed ? (
          <span
            className="w-2 h-2 rounded-full flex-shrink-0"
            style={{
              background: connected ? 'var(--success)' : 'var(--muted-foreground)',
              boxShadow: connected ? '0 0 5px color-mix(in srgb, var(--success) 60%, transparent)' : 'none',
            }}
            title={connected ? 'Connected' : 'Disconnected'}
          />
        ) : (
          <span className="text-[12.5px] font-semibold text-[var(--foreground)] truncate flex-1 leading-tight -tracking-[0.01em]">
            {status?.spec?.title ?? 'Wasper Studio'}
          </span>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className={cn(
        'flex flex-col gap-[3px] flex-1 overflow-y-auto',
        collapsed ? 'px-1.5 py-1' : 'px-2.5 py-1',
      )}>
        {ALL_NAV.map(item => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className={cn(
        'flex-shrink-0 border-t border-[color-mix(in_srgb,var(--border)_60%,transparent)]',
        collapsed ? 'flex flex-col items-center gap-1.5 px-1.5 py-2.5' : 'flex items-center gap-0.5 px-2.5 py-2',
      )}>
        {/* Connection status / spec info */}
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className="w-[7px] h-[7px] rounded-full flex-shrink-0"
              style={{
                background: connected ? 'var(--success)' : 'var(--muted-foreground)',
                boxShadow: connected ? '0 0 5px color-mix(in srgb, var(--success) 55%, transparent)' : 'none',
              }}
            />
            <span className="text-[11px] text-[var(--muted-foreground)] truncate -tracking-[0.005em]">
              {connected
                ? (status ? `${status.endpointCount.toLocaleString()} endpoints` : 'Connected')
                : 'Disconnected'}
            </span>
          </div>
        )}

        {/* AI button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-ai-panel'))}
          title="Quiry"
          className="flex items-center justify-center w-7 h-7 rounded-lg border-0 bg-transparent text-[var(--accent)] cursor-pointer hover:bg-[color-mix(in_srgb,var(--accent)_10%,transparent)] transition-colors flex-shrink-0"
        >
          <Sparkles size={13} />
        </button>

        {/* Decoder button */}
        <button
          onClick={() => window.dispatchEvent(new CustomEvent('open-decoder'))}
          title="Decoder / Encoder"
          className="flex items-center justify-center w-7 h-7 rounded-lg border-0 bg-transparent text-[var(--muted-foreground)] cursor-pointer hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors flex-shrink-0"
        >
          <Braces size={13} />
        </button>

        {/* Theme toggle */}
        <button
          onClick={toggleTheme}
          title={`${theme === 'dark' ? 'Light' : 'Dark'} mode`}
          className="flex items-center justify-center w-7 h-7 rounded-lg border-0 bg-transparent text-[var(--muted-foreground)] cursor-pointer hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors flex-shrink-0"
        >
          {theme === 'dark' ? <Sun size={13} /> : <Moon size={13} />}
        </button>

        {/* Collapse toggle */}
        <button
          onClick={toggleSidebar}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
          className="flex items-center justify-center w-7 h-7 rounded-lg border-0 bg-transparent text-[var(--muted-foreground)] cursor-pointer hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_7%,transparent)] transition-colors flex-shrink-0"
        >
          {collapsed ? <ChevronRight size={13} /> : <ChevronLeft size={13} />}
        </button>
      </div>
    </aside>
  );
}
