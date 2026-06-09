import { createContext, useContext } from 'react';
import type { Environment } from './lib/env';

interface AppCtx {
  theme: 'dark' | 'light';
  toggleTheme: () => void;
  cmdOpen: boolean;
  setCmdOpen: (v: boolean) => void;
  connected: boolean;
  sidebarCollapsed: boolean;
  toggleSidebar: () => void;
  envs: Environment[];
  activeEnvId: string | null;
  setActiveEnvId: (id: string | null) => void;
  reloadEnvs: () => void;
}

export const AppContext = createContext<AppCtx>({
  theme: 'dark', toggleTheme: () => {},
  cmdOpen: false, setCmdOpen: () => {},
  connected: false,
  sidebarCollapsed: false, toggleSidebar: () => {},
  envs: [], activeEnvId: null, setActiveEnvId: () => {}, reloadEnvs: () => {},
});

export function useApp() { return useContext(AppContext); }
