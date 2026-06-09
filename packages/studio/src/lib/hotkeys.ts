import type { Hotkey } from '@tanstack/hotkeys';

// ── Type-safe hotkey constants ─────────────────────────────────────────────
export const HK = {
  // Global
  HELP:           '?' as Hotkey,
  SEARCH:         'Mod+K' as Hotkey,
  SIDEBAR:        'Mod+B' as Hotkey,
  THEME:          'Mod+Shift+D' as Hotkey,
  CLOSE_MODAL:    'Escape' as Hotkey,
  // Navigation (Ctrl+digit)
  NAV_OVERVIEW:   'Ctrl+1' as Hotkey,
  NAV_EXPLORER:   'Ctrl+2' as Hotkey,
  NAV_AI:         'Ctrl+3' as Hotkey,
  NAV_INTERCEPT:  'Ctrl+4' as Hotkey,
  NAV_LOGS:       'Ctrl+5' as Hotkey,
  // Explorer
  SEND:           'Mod+Enter' as Hotkey,
  NEW_TAB:        'Mod+T' as Hotkey,
  CLOSE_TAB:      'Alt+W' as Hotkey,
  NEXT_TAB:       'Mod+]' as Hotkey,
  PREV_TAB:       'Mod+[' as Hotkey,
  FOCUS_URL:      'Mod+L' as Hotkey,
  FORMAT_BODY:    'Mod+Shift+F' as Hotkey,
  RESET_TAB:      'Alt+R' as Hotkey,
  COPY_RESPONSE:  'Mod+Shift+C' as Hotkey,
} as const;

// ── Static definitions for the help panel ─────────────────────────────────
export type HotkeySection = 'Global' | 'Navigation' | 'Explorer';

export interface HotkeyDef {
  id: string;
  hotkey: Hotkey;
  label: string;
  description: string;
  section: HotkeySection;
}

export const HOTKEY_DEFS: HotkeyDef[] = [
  // Global
  { id: 'help',          hotkey: HK.HELP,          label: 'Keyboard shortcuts', description: 'Open this help panel',           section: 'Global' },
  { id: 'search',        hotkey: HK.SEARCH,        label: 'Search endpoints',   description: 'Open command palette',           section: 'Global' },
  { id: 'sidebar',       hotkey: HK.SIDEBAR,       label: 'Toggle sidebar',     description: 'Collapse / expand the sidebar',  section: 'Global' },
  { id: 'theme',         hotkey: HK.THEME,         label: 'Toggle theme',       description: 'Switch dark / light mode',       section: 'Global' },
  { id: 'escape',        hotkey: HK.CLOSE_MODAL,   label: 'Dismiss',            description: 'Close any open panel or dialog', section: 'Global' },
  // Navigation
  { id: 'nav-1',         hotkey: HK.NAV_OVERVIEW,  label: 'Overview',           description: 'Navigate to Overview',           section: 'Navigation' },
  { id: 'nav-2',         hotkey: HK.NAV_EXPLORER,  label: 'Explorer',           description: 'Navigate to API Explorer',       section: 'Navigation' },
  { id: 'nav-3',         hotkey: HK.NAV_AI,        label: 'AI Chat',            description: 'Navigate to AI Chat',            section: 'Navigation' },
  { id: 'nav-4',         hotkey: HK.NAV_INTERCEPT, label: 'Intercept',          description: 'Navigate to Request Intercept',  section: 'Navigation' },
  { id: 'nav-5',         hotkey: HK.NAV_LOGS,      label: 'Logs',               description: 'Navigate to Logs',               section: 'Navigation' },
  // Explorer
  { id: 'send',          hotkey: HK.SEND,          label: 'Send request',       description: 'Fire the current request',       section: 'Explorer' },
  { id: 'new-tab',       hotkey: HK.NEW_TAB,       label: 'New tab',            description: 'Open a new blank request tab',   section: 'Explorer' },
  { id: 'close-tab',     hotkey: HK.CLOSE_TAB,     label: 'Close tab',          description: 'Close the active request tab',   section: 'Explorer' },
  { id: 'next-tab',      hotkey: HK.NEXT_TAB,      label: 'Next tab',           description: 'Cycle forward through tabs',     section: 'Explorer' },
  { id: 'prev-tab',      hotkey: HK.PREV_TAB,      label: 'Previous tab',       description: 'Cycle backward through tabs',    section: 'Explorer' },
  { id: 'focus-url',     hotkey: HK.FOCUS_URL,     label: 'Focus URL bar',      description: 'Jump cursor to the URL input',   section: 'Explorer' },
  { id: 'format-body',   hotkey: HK.FORMAT_BODY,   label: 'Format JSON body',   description: 'Auto-indent the request body',   section: 'Explorer' },
  { id: 'reset-tab',     hotkey: HK.RESET_TAB,     label: 'Reset tab',          description: 'Clear URL, params, body, response', section: 'Explorer' },
  { id: 'copy-response', hotkey: HK.COPY_RESPONSE, label: 'Copy response',      description: 'Copy response body to clipboard', section: 'Explorer' },
];
