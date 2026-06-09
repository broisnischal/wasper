/**
 * Client-only hotkey shell — loaded via dynamic import so SSR never touches
 * @tanstack/react-hotkeys / use-sync-external-store CJS shims.
 */
import { useEffect, useRef } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { HotkeysProvider, useHotkey } from '@tanstack/react-hotkeys';
import { useApp } from '../context';
import { HK } from '../lib/hotkeys';

interface GlobalHotkeysProps {
  onHelpToggle: () => void;
  onHelpClose: () => void;
}

function GlobalHotkeys({ onHelpToggle, onHelpClose }: GlobalHotkeysProps) {
  const { setCmdOpen, toggleSidebar, toggleTheme, cmdOpen } = useApp();
  const navigate = useNavigate();

  const cmdOpenRef = useRef(cmdOpen);
  useEffect(() => { cmdOpenRef.current = cmdOpen; }, [cmdOpen]);

  useHotkey(HK.SEARCH, () => setCmdOpen(!cmdOpenRef.current),
    { preventDefault: true, meta: { name: 'Search', description: 'Open command palette' } });
  useHotkey(HK.HELP, onHelpToggle,
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Help', description: 'Show keyboard shortcuts' } });
  useHotkey(HK.SIDEBAR, toggleSidebar,
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Sidebar', description: 'Toggle sidebar' } });
  useHotkey(HK.THEME, toggleTheme,
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Theme', description: 'Toggle dark / light mode' } });
  useHotkey(HK.CLOSE_MODAL, () => {
    if (cmdOpenRef.current) setCmdOpen(false);
    else onHelpClose();
  }, { meta: { name: 'Dismiss', description: 'Close any open panel' } });
  useHotkey(HK.NAV_OVERVIEW,  () => navigate({ to: '/' }),
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Overview',  description: 'Go to Overview' } });
  useHotkey(HK.NAV_EXPLORER,  () => navigate({ to: '/explorer' }),
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Explorer',  description: 'Go to API Explorer' } });
  useHotkey(HK.NAV_AI,        () => navigate({ to: '/ai' }),
    { ignoreInputs: true, preventDefault: true, meta: { name: 'AI Chat',   description: 'Go to AI Chat' } });
  useHotkey(HK.NAV_INTERCEPT, () => navigate({ to: '/intercept' }),
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Intercept', description: 'Go to Intercept' } });
  useHotkey(HK.NAV_LOGS,      () => navigate({ to: '/logs' }),
    { ignoreInputs: true, preventDefault: true, meta: { name: 'Logs',      description: 'Go to Logs' } });

  return null;
}

export function HotkeysLayer({
  children,
  onHelpToggle,
  onHelpClose,
}: GlobalHotkeysProps & { children: React.ReactNode }) {
  return (
    <HotkeysProvider>
      <GlobalHotkeys onHelpToggle={onHelpToggle} onHelpClose={onHelpClose} />
      {children}
    </HotkeysProvider>
  );
}
