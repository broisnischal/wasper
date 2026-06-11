import { Link, useRouterState } from '@tanstack/react-router';
import { useEffect, useState } from 'react';
import { apiClient } from '../lib/api';
import { useApp } from '../context';
import { cacheGet, cacheSet } from '../lib/cache';
import { cn } from '../lib/utils';
import {
  LayoutGrid, Terminal, Activity, Key, Settings, Bot,
  Sun, Moon, ArrowRightLeft,
  ChevronLeft, ChevronRight, Layers, Workflow, Sparkles, BookOpen,
} from 'lucide-react';

interface Status { spec: { title: string; version: string }; endpointCount: number; }

const ALL_NAV = [
  { to: '/',           icon: LayoutGrid,     label: 'Overview',        exact: true  },
  { to: '/explorer',   icon: Terminal,       label: 'Explorer',        exact: false },
  { to: '/ai',         icon: Bot,            label: 'Quiry',           exact: false },
  { to: '/workflows',  icon: Workflow,       label: 'Workflows',       exact: false },
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
          'flex items-center justify-center w-9 h-9 mx-auto rounded-lg transition-colors duration-100 no-underline',
          active
            ? 'text-[var(--foreground)] bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]'
            : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]',
        )}
      >
        <Icon size={16} strokeWidth={active ? 2 : 1.6} className="flex-shrink-0" />
      </Link>
    );
  }

  return (
    <Link
      to={to as '/'}
      className={cn(
        'flex items-center gap-3 px-3 h-9 rounded-lg w-full text-[13.5px] tracking-tight transition-colors duration-100 no-underline',
        active
          ? 'text-[var(--foreground)] font-medium bg-[color-mix(in_srgb,var(--foreground)_10%,transparent)]'
          : 'text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[color-mix(in_srgb,var(--foreground)_5%,transparent)]',
      )}
    >
      <Icon size={16} strokeWidth={active ? 2 : 1.6} className="flex-shrink-0" />
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
  const w = collapsed ? 'w-[52px] min-w-[52px]' : 'w-[220px] min-w-[220px]';

  return (
    <aside className={cn(
      'h-screen flex flex-col bg-[var(--sidebar)] border-r border-[var(--border)] select-none transition-all duration-200 flex-shrink-0',
      w,
    )}>

      {/* ── Header ── */}
      <div className={cn(
        'flex items-center h-[52px] flex-shrink-0 px-3',
        collapsed && 'justify-center px-2',
      )}>
        <div
          className="w-7 h-7 rounded-lg flex-shrink-0 flex items-center justify-center text-[12px] font-bold text-white select-none"
          style={{ background: connected ? '#3b82f6' : '#52525b' }}
        >
          W
        </div>
        {!collapsed && (
          <span className="ml-2.5 text-[13.5px] font-semibold text-[var(--foreground)] truncate flex-1 leading-none">
            {status?.spec?.title ?? 'Wasper Studio'}
          </span>
        )}
      </div>

      {/* ── Nav ── */}
      <nav className={cn(
        'flex flex-col gap-0.5 flex-1 overflow-y-auto',
        collapsed ? 'px-1.5 py-1' : 'px-3 py-1',
      )}>
        {ALL_NAV.map(item => (
          <NavItem key={item.to} {...item} collapsed={collapsed} />
        ))}
      </nav>

      {/* ── Footer ── */}
      <div className={cn(
        'flex-shrink-0 px-3 py-3',
        collapsed ? 'flex flex-col items-center gap-1.5 px-1.5' : 'flex items-center gap-1',
      )}>
        {/* Connection status / spec info */}
        {!collapsed && (
          <div className="flex items-center gap-2 flex-1 min-w-0">
            <div
              className="w-1.5 h-1.5 rounded-full flex-shrink-0"
              style={{
                background: connected ? 'var(--success)' : 'var(--muted-foreground)',
                boxShadow: connected ? '0 0 4px rgba(74,222,128,0.5)' : 'none',
              }}
            />
            <span className="text-[11.5px] text-[var(--muted-foreground)] truncate">
              {connected
                ? (status ? `${status.endpointCount} endpoints` : 'Connected')
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
