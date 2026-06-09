import { dbPut, dbGetAll, dbDel } from './storage';

export interface EnvVar { key: string; value: string; enabled: boolean; }
export interface Environment { id: string; name: string; color: string; vars: EnvVar[]; }

const STORE = 'environments';
const LS_ACTIVE = 'env_active_id';

export function getActiveEnvId(): string | null {
  try { return localStorage.getItem(LS_ACTIVE); } catch { return null; }
}
export function setActiveEnvId(id: string | null) {
  try { id ? localStorage.setItem(LS_ACTIVE, id) : localStorage.removeItem(LS_ACTIVE); } catch { /**/ }
}

export function listEnvironments(): Promise<Environment[]> { return dbGetAll<Environment>(STORE); }
export function saveEnvironment(e: Environment): Promise<void> { return dbPut(STORE, e); }
export function deleteEnvironment(id: string): Promise<void> { return dbDel(STORE, id); }

export function resolveVars(text: string, env: Environment | null): string {
  if (!env) return text;
  let out = text;
  for (const v of env.vars) {
    if (v.enabled && v.key) out = out.replaceAll(`{{${v.key}}}`, v.value);
  }
  return out;
}

export const ENV_COLORS = ['#22c55e', '#3b82f6', '#f59e0b', '#a855f7', '#ef4444', '#06b6d4', '#f97316'];
