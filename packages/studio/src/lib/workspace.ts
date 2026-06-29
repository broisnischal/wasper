import { dbPut, dbGetAll, dbDel } from './storage';

// ── Workspaces — Postman-style grouping of requests with shared defaults ─────
// A workspace carries: a default auth config (requests "inherit" it), default
// headers merged under request headers, and a default environment.

export interface WsKV { key: string; value: string; enabled: boolean; }

/** Mirror of the explorer's AuthConfig minus 'inherit' (a workspace IS the parent). */
export interface WorkspaceAuth {
  type: 'cli' | 'none' | 'bearer' | 'basic' | 'apikey' | 'oauth2' | 'oidc' | 'custom' | 'profile';
  bearer: string;
  basicUser: string;
  basicPass: string;
  apiKeyName: string;
  apiKeyValue: string;
  apiKeyIn: 'header' | 'query' | 'cookie';
  oauthTokenUrl: string;
  oauthClientId: string;
  oauthClientSecret: string;
  oauthScope: string;
  oidcUrl: string;
  customRows: WsKV[];
  profileId: string;
  profileName: string;
}

export interface Workspace {
  id: string;
  name: string;
  color: string;
  auth: WorkspaceAuth;
  headers: WsKV[];
  /** Default environment for the workspace ('' = follow the globally active env). */
  envId: string;
  /**
   * Per-folder auth overrides, keyed by the endpoint tree's folder path
   * (e.g. "curated" or "curated/artworks"). A request set to "Inherit" picks the
   * nearest ancestor folder that defines auth before falling back to `auth`.
   */
  folderAuth?: Record<string, WorkspaceAuth>;
}

export const DEFAULT_WS_AUTH: WorkspaceAuth = {
  type: 'cli', bearer: '', basicUser: '', basicPass: '',
  apiKeyName: '', apiKeyValue: '', apiKeyIn: 'header',
  oauthTokenUrl: '', oauthClientId: '', oauthClientSecret: '', oauthScope: '',
  oidcUrl: '', customRows: [{ key: '', value: '', enabled: true }],
  profileId: '', profileName: '',
};

export const DEFAULT_WORKSPACE_ID = 'default';

export function defaultWorkspace(): Workspace {
  return {
    id: DEFAULT_WORKSPACE_ID,
    name: 'Personal',
    color: '#3b82f6',
    auth: { ...DEFAULT_WS_AUTH },
    headers: [{ key: '', value: '', enabled: true }],
    envId: '',
    folderAuth: {},
  };
}

const STORE = 'workspaces';
const LS_ACTIVE = 'workspace_active_id';

export async function listWorkspaces(): Promise<Workspace[]> {
  const all = await dbGetAll<Workspace>(STORE);
  if (!all.length) {
    const def = defaultWorkspace();
    await dbPut(STORE, def).catch(() => {});
    return [def];
  }
  // Normalize old records that may miss newer fields
  return all.map(w => ({ ...defaultWorkspace(), ...w, auth: { ...DEFAULT_WS_AUTH, ...w.auth }, folderAuth: w.folderAuth ?? {} }));
}

export function saveWorkspace(w: Workspace): Promise<void> { return dbPut(STORE, w); }
export function deleteWorkspace(id: string): Promise<void> { return dbDel(STORE, id); }

export function getActiveWorkspaceId(): string {
  try { return localStorage.getItem(LS_ACTIVE) || DEFAULT_WORKSPACE_ID; } catch { return DEFAULT_WORKSPACE_ID; }
}
export function setActiveWorkspaceId(id: string) {
  try { localStorage.setItem(LS_ACTIVE, id); } catch { /**/ }
}
