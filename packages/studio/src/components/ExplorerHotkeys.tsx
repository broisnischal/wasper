import { useHotkey } from '@tanstack/react-hotkeys';
import { HK } from '../lib/hotkeys';

interface KVRow { key: string; value: string; enabled: boolean; }
interface ResponseResult {
  status: number; statusText: string; headers: Record<string, string>;
  body: string; latency: number; size: number; error?: string;
}
interface AuthConfig {
  type: 'none' | 'bearer' | 'basic' | 'apikey';
  bearer: string; basicUser: string; basicPass: string;
  apiKeyName: string; apiKeyValue: string; apiKeyIn: 'header' | 'query';
}
interface RequestTab {
  id: string; title: string; method: string; url: string;
  params: KVRow[]; pathParams: KVRow[]; headers: KVRow[];
  body: string; bodyType: 'none' | 'json' | 'form' | 'multipart' | 'raw';
  formRows: KVRow[]; auth: AuthConfig;
  response: ResponseResult | null; loading: boolean;
}

interface ExplorerHotkeysProps {
  sendRef: React.RefObject<(() => Promise<void>) | null>;
  addTabRef: React.RefObject<(() => void) | null>;
  updRef: React.RefObject<((id: string, patch: Partial<RequestTab>) => void) | null>;
  tabsRef: React.RefObject<RequestTab[]>;
  activeTabRef: React.RefObject<string>;
  urlInputRef: React.RefObject<HTMLInputElement | null>;
  setTabs: React.Dispatch<React.SetStateAction<RequestTab[]>>;
  setActiveTabId: React.Dispatch<React.SetStateAction<string>>;
  blankTab: () => RequestTab;
  defaultAuth: AuthConfig;
}

export function ExplorerHotkeys(props: ExplorerHotkeysProps) {
  const {
    sendRef, addTabRef, updRef, tabsRef, activeTabRef, urlInputRef,
    setTabs, setActiveTabId, blankTab, defaultAuth,
  } = props;

  useHotkey(HK.SEND, () => { void sendRef.current?.(); },
    { preventDefault: true, meta: { name: 'Send request', description: 'Fire the current request' } });
  useHotkey(HK.NEW_TAB, () => addTabRef.current?.(),
    { preventDefault: true, meta: { name: 'New tab', description: 'Open a new blank request tab' } });
  useHotkey(HK.CLOSE_TAB, () => {
    const ts = tabsRef.current;
    const id = activeTabRef.current;
    if (ts.length <= 1) return;
    setTabs(p => { const next = p.filter(t => t.id !== id); return next.length ? next : [blankTab()]; });
    const idx = ts.findIndex(t => t.id === id);
    const fallback = ts[Math.max(0, idx - 1)];
    if (fallback && fallback.id !== id) setActiveTabId(fallback.id);
  }, { preventDefault: true, meta: { name: 'Close tab', description: 'Close the active tab' } });
  useHotkey(HK.NEXT_TAB, () => {
    const ts = tabsRef.current;
    const idx = ts.findIndex(t => t.id === activeTabRef.current);
    setActiveTabId(ts[(idx + 1) % ts.length]!.id);
  }, { preventDefault: true, meta: { name: 'Next tab', description: 'Cycle to the next tab' } });
  useHotkey(HK.PREV_TAB, () => {
    const ts = tabsRef.current;
    const idx = ts.findIndex(t => t.id === activeTabRef.current);
    setActiveTabId(ts[(idx - 1 + ts.length) % ts.length]!.id);
  }, { preventDefault: true, meta: { name: 'Previous tab', description: 'Cycle to the previous tab' } });
  useHotkey(HK.FOCUS_URL, () => {
    urlInputRef.current?.focus();
    urlInputRef.current?.select();
  }, { preventDefault: true, meta: { name: 'Focus URL', description: 'Jump cursor to the URL input' } });
  useHotkey(HK.FORMAT_BODY, () => {
    const t = tabsRef.current.find(t => t.id === activeTabRef.current);
    if (t?.bodyType !== 'json') return;
    try { updRef.current?.(t.id, { body: JSON.stringify(JSON.parse(t.body), null, 2) }); } catch { /**/ }
  }, { preventDefault: true, meta: { name: 'Format JSON', description: 'Auto-indent request body' } });
  useHotkey(HK.RESET_TAB, () => {
    const id = activeTabRef.current;
    updRef.current?.(id, {
      response: null, url: '', title: 'New Request',
      params: [{ key: '', value: '', enabled: true }],
      pathParams: [],
      headers: [{ key: '', value: '', enabled: true }],
      body: '', bodyType: 'none',
      formRows: [{ key: '', value: '', enabled: true }],
      auth: { ...defaultAuth },
    });
  }, { ignoreInputs: true, meta: { name: 'Reset tab', description: 'Clear URL, params, body, response' } });
  useHotkey(HK.COPY_RESPONSE, () => {
    const t = tabsRef.current.find(x => x.id === activeTabRef.current);
    if (t?.response?.body) navigator.clipboard.writeText(t.response.body).catch(() => {});
  }, { ignoreInputs: true, meta: { name: 'Copy response', description: 'Copy response body to clipboard' } });

  return null;
}
