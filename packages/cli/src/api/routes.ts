import { dbQueries, randomUUID, type InterceptRuleRow } from '../db/index';
import { applyAuth, type AuthConfig } from '../auth/engine';
import { logBus } from '../logs/bus';
import { getState, hasState, loadSpec, loadSpecFromText } from '../state';
import { extractSuggestedVars } from '../openapi/parser';
import { getFeatures, setFeatures, readonlyViolation, type Features } from '../config';
import { VERSION } from '../version';
import { runWorkflow, type WorkflowStep } from '../workflows/engine';
import dns from 'node:dns/promises';

const CORS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, PUT, PATCH, DELETE, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, Authorization',
};

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...CORS },
  });
}
function notFound(msg = 'Not found') { return json({ error: msg }, 404); }
function badRequest(msg: string) { return json({ error: msg }, 400); }

export async function apiRouter(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') return new Response(null, { status: 204, headers: CORS });

  const { pathname: path, searchParams } = new URL(req.url);
  const method = req.method;

  if (path === '/api/status' && method === 'GET') return handleStatus();
  if (path === '/api/logs' && method === 'GET') return handleGetLogs(searchParams);
  if (path === '/api/logs' && method === 'DELETE') return handleClearLogs();
  if (path === '/api/auth/profiles' && method === 'GET') return handleGetProfiles();
  if (path === '/api/auth/profiles' && method === 'POST') return handleCreateProfile(req);
  if (path.startsWith('/api/auth/profiles/') && method === 'PUT') return handleUpdateProfile(req, path);
  if (path.startsWith('/api/auth/profiles/') && method === 'DELETE') return handleDeleteProfile(path);
  if (path.match(/^\/api\/auth\/profiles\/[^/]+\/activate$/) && method === 'POST') return handleActivateProfile(path);
  if (path === '/api/auth' && method === 'GET') return handleGetAuth();
  if (path === '/api/auth' && method === 'PUT') return handleSetAuth(req);
  if (path === '/api/auth/test' && method === 'POST') return handleTestAuth();
  if (path === '/api/explorer/request' && method === 'POST') return handleExplorerRequest(req);
  if (path === '/api/spec/endpoints' && method === 'GET') return handleGetEndpoints();
  if (path === '/api/settings' && method === 'GET') return handleGetSettings();
  if (path === '/api/settings' && method === 'PUT') return handleSetSettings(req);
  if (path === '/api/spec/upload' && method === 'POST') return handleSpecUpload(req);
  if (path === '/api/spec/reload-url' && method === 'POST') return handleSpecReloadUrl(req);
  if (path === '/api/intercept' && method === 'GET') return handleGetRules();
  if (path === '/api/intercept' && method === 'POST') return handleCreateRule(req);
  if (path.startsWith('/api/intercept/') && method === 'PUT') return handleUpdateRule(req, path);
  if (path.startsWith('/api/intercept/') && method === 'DELETE') return handleDeleteRule(path);
  if (path === '/api/ai/chat' && method === 'POST') return handleAiChat(req);
  if (path === '/api/debug/dns' && method === 'GET') return handleDnsQuery(searchParams);
  if (path === '/api/debug/ping' && method === 'GET') return handlePing(searchParams);
  if (path === '/api/reload' && method === 'POST') return handleReload();
  if (path === '/api/server-info' && method === 'GET') return handleServerInfo();
  if (path === '/api/features' && method === 'GET') return json(getFeatures());
  if (path === '/api/features' && method === 'PUT') return handleSetFeatures(req);
  if (path === '/api/saved' && method === 'GET') return handleGetSaved();
  if (path === '/api/saved' && method === 'POST') return handleCreateSaved(req);
  if (path.startsWith('/api/saved/') && method === 'PUT') return handleUpdateSaved(req, path);
  if (path.startsWith('/api/saved/') && method === 'DELETE') return handleDeleteSaved(path);

  if (path === '/api/workflows' && method === 'GET') return handleGetWorkflows();
  if (path === '/api/workflows' && method === 'POST') return handleCreateWorkflow(req);
  if (path === '/api/workflows/generate' && method === 'POST') return handleGenerateWorkflow(req);
  if (path.startsWith('/api/workflows/') && path.endsWith('/run') && method === 'POST') return handleRunWorkflow(path);
  if (path.startsWith('/api/workflows/') && method === 'PUT') return handleUpdateWorkflow(req, path);
  if (path.startsWith('/api/workflows/') && method === 'DELETE') return handleDeleteWorkflow(path);

  if (path === '/api/capture/bins' && method === 'GET') return handleGetCaptureBins();
  if (path === '/api/capture/bins' && method === 'POST') return handleCreateCaptureBin(req);
  if (path.startsWith('/api/capture/bins/') && method === 'DELETE') return handleDeleteCaptureBin(path);

  return notFound('API route not found');
}

function handleStatus(): Response {
  if (!hasState()) {
    return json({ ok: true, version: VERSION, spec: null, endpointCount: 0, wsClients: logBus.clientCount });
  }
  const { spec, operations } = getState();
  return json({
    ok: true,
    version: VERSION,
    spec: { title: spec.title, version: spec.version, baseUrl: spec.baseUrl, url: spec.url },
    endpointCount: operations.length,
    wsClients: logBus.clientCount,
  });
}

async function handleReload(): Promise<Response> {
  if (!hasState()) return badRequest('No spec loaded');
  const { specUrl } = getState();
  if (!specUrl) return json({ error: 'Spec was uploaded manually — cannot reload from URL' }, 400);
  try {
    const s = await loadSpec(specUrl);
    return json({ ok: true, spec: s.spec.title, version: s.spec.version, endpoints: s.operations.length });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

async function handleSetFeatures(req: Request): Promise<Response> {
  let body: Partial<Features>;
  try { body = (await req.json()) as Partial<Features>; } catch { return badRequest('Invalid JSON'); }
  const patch: Partial<Features> = {};
  for (const key of ['mcp', 'proxy', 'ai', 'readonly'] as const) {
    if (typeof body[key] === 'boolean') patch[key] = body[key];
  }
  setFeatures(patch);
  persistAndBroadcastFeatures();
  return json(getFeatures());
}

export function persistAndBroadcastFeatures(): void {
  const f = getFeatures();
  // Persist mcp/proxy/ai (not readonly — it's a safety flag, should not survive restart)
  dbQueries.setSetting('features', JSON.stringify({ mcp: f.mcp, proxy: f.proxy, ai: f.ai }));
  logBus.broadcastServerEvent({ kind: 'features', data: f });
}

function handleServerInfo(): Response {
  const state = hasState() ? getState() : null;
  return json({
    pid: process.pid,
    port: parseInt(process.env._OA_PORT ?? '3388', 10),
    startedAt: parseInt(process.env._OA_STARTED ?? '0', 10),
    features: getFeatures(),
    spec: state ? {
      title: state.spec.title,
      version: state.spec.version,
      endpointCount: state.operations.length,
      specUrl: state.specUrl ?? null,
    } : null,
  });
}

async function handleSpecUpload(req: Request): Promise<Response> {
  let content: string;
  let filename = 'spec';

  const ct = req.headers.get('content-type') ?? '';
  if (ct.includes('multipart/form-data')) {
    let form: FormData;
    try { form = await req.formData() as unknown as FormData; } catch { return badRequest('Invalid form data'); }
    const file = form.get('file');
    if (!file || typeof file === 'string') return badRequest('No file in form data');
    filename = (file as File).name ?? 'spec';
    content = await (file as File).text();
  } else if (ct.includes('application/json') && !ct.includes('yaml')) {
    let body: { content?: string; filename?: string };
    try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }
    if (!body.content) return badRequest('Missing content field');
    content = body.content;
    filename = body.filename ?? 'spec';
  } else {
    content = await req.text();
  }

  if (!content.trim()) return badRequest('Empty spec content');

  try {
    const state = loadSpecFromText(content, filename);
    const suggestedVars = extractSuggestedVars(content, state.spec.baseUrl);
    return json({
      ok: true,
      spec: { title: state.spec.title, version: state.spec.version, baseUrl: state.spec.baseUrl },
      endpointCount: state.operations.length,
      suggestedVars,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

async function handleSpecReloadUrl(req: Request): Promise<Response> {
  let body: { url?: string };
  try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }
  if (!body.url) return badRequest('Missing url field');

  try {
    const state = await loadSpec(body.url);
    const suggestedVars = extractSuggestedVars(state.spec.raw, state.spec.baseUrl);
    return json({
      ok: true,
      spec: { title: state.spec.title, version: state.spec.version, baseUrl: state.spec.baseUrl },
      endpointCount: state.operations.length,
      suggestedVars,
    });
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 400);
  }
}

function handleGetLogs(searchParams: URLSearchParams): Response {
  const limit = Math.min(parseInt(searchParams.get('limit') ?? '500'), 2000);
  return json(dbQueries.getRecentLogs(limit));
}

function handleClearLogs(): Response {
  dbQueries.clearLogs();
  return json({ cleared: true });
}

function handleGetAuth(): Response {
  const auth = dbQueries.getAuthConfig();
  return json(auth ? { type: auth.type, config: JSON.parse(auth.config) } : { type: 'none', config: {} });
}

async function handleSetAuth(req: Request): Promise<Response> {
  let body: { type: string; config: object };
  try { body = (await req.json()) as { type: string; config: object }; } catch { return badRequest('Invalid JSON'); }
  dbQueries.setAuthConfig(body.type, body.config);
  return json({ type: body.type, config: body.config });
}

async function handleTestAuth(): Promise<Response> {
  const { spec } = getState();
  const authRow = dbQueries.getAuthConfig();
  const authConfig: AuthConfig = authRow ? JSON.parse(authRow.config) : { type: 'none' };
  const testUrl = `${spec.baseUrl.replace(/\/$/, '')}/`;

  try {
    const { url, headers } = await applyAuth(testUrl, {}, authConfig);
    const res = await fetch(url, { method: 'HEAD', headers }).catch(() => fetch(url, { method: 'GET', headers }));
    return json({ ok: res.ok, status: res.status, statusText: res.statusText });
  } catch (e) {
    return json({ ok: false, error: e instanceof Error ? e.message : String(e) });
  }
}

function handleGetEndpoints(): Response {
  return json(getState().operations);
}

function handleGetSettings(): Response {
  const row = dbQueries.getSettings();
  return json(row ? JSON.parse(row.value) : {
    proxy: { enabled: false, type: 'http', host: '', port: 8080, username: '', password: '' },
    ai: { provider: 'anthropic', apiKey: '', model: 'claude-opus-4-8', baseUrl: '' },
    request: { timeout: 30000, followRedirects: true, sslVerify: true },
  });
}

async function handleSetSettings(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return badRequest('Invalid JSON'); }
  dbQueries.setSettings(body);
  return json(body);
}

// ─── Tool definitions ────────────────────────────────────────────────────────

interface ToolCall { tool: string; input: Record<string, unknown>; output: string; isError: boolean; }

const TOOL_DEFS = {
  search_endpoints: {
    description: 'Search API endpoints by keyword, path, tag, or HTTP method.',
    params: { query: { type: 'string', description: 'Search term, e.g. "user", "GET /pets"' } },
    required: ['query'],
  },
  get_endpoint_schema: {
    description: 'Get full schema (parameters, request body, responses) for an endpoint by operationId.',
    params: { operationId: { type: 'string', description: 'operationId returned by search_endpoints' } },
    required: ['operationId'],
  },
  execute_api_request: {
    description: 'Execute an API request against the loaded spec server and return the response.',
    params: {
      operationId: { type: 'string' },
      pathParams: { type: 'object', additionalProperties: { type: 'string' }, description: 'Path parameter values' },
      queryParams: { type: 'object', additionalProperties: { type: 'string' }, description: 'Query parameter values' },
      headers: { type: 'object', additionalProperties: { type: 'string' }, description: 'Extra request headers' },
      body: { description: 'Request body for POST/PUT/PATCH' },
    },
    required: ['operationId'],
  },
  fetch_url: {
    description: 'Fetch a web page or API documentation URL and return its text content.',
    params: { url: { type: 'string', description: 'URL to fetch' } },
    required: ['url'],
  },
  dns_lookup: {
    description: 'Perform a DNS lookup for a hostname. Returns A, AAAA, MX, TXT, NS, and CNAME records. Useful for diagnosing connectivity, understanding API server topology, or checking DNS configuration.',
    params: {
      host: { type: 'string', description: 'Hostname to look up, e.g. "api.example.com"' },
      type: { type: 'string', enum: ['A', 'AAAA', 'MX', 'TXT', 'NS', 'CNAME', 'ALL'], description: 'DNS record type (default: ALL)' },
    },
    required: ['host'],
  },
  get_recent_logs: {
    description: 'Get recent HTTP request/response logs captured by the proxy. Use to analyze traffic patterns, find errors, understand API usage, or investigate specific requests.',
    params: {
      limit: { type: 'number', description: 'Max number of logs to return (default 20, max 50)' },
      filter: { type: 'string', description: 'Optional filter: URL substring, method (GET/POST), or status code' },
    },
    required: [],
  },
  run_security_check: {
    description: 'Run a security analysis on a specific API endpoint — checks for missing auth, insecure methods, exposed sensitive data patterns in the response, and common misconfigurations.',
    params: {
      operationId: { type: 'string', description: 'operationId of the endpoint to security-check' },
    },
    required: ['operationId'],
  },
  list_auth_profiles: {
    description: 'List all saved authentication profiles. Shows name, type, and which is currently active. Call this before executing authenticated requests to know what credentials are available.',
    params: {},
    required: [],
  },
  set_active_auth: {
    description: 'Switch to a different saved auth profile by name. Affects all subsequent execute_api_request calls in this session.',
    params: {
      name: { type: 'string', description: 'Exact profile name to activate (use list_auth_profiles to see options)' },
    },
    required: ['name'],
  },
  save_auth_token: {
    description: 'Save a bearer token or API key as a named auth profile and immediately activate it. Call this right after a successful login endpoint returns a token so all subsequent API requests are authenticated.',
    params: {
      name: { type: 'string', description: 'Profile name, e.g. "user session" or the username' },
      token: { type: 'string', description: 'The bearer token or API key value to save' },
      token_type: { type: 'string', enum: ['bearer', 'apikey_header', 'apikey_query'], description: 'Token type (default: bearer)' },
      header_name: { type: 'string', description: 'Header name for apikey_header type (default: X-Api-Key)' },
    },
    required: ['name', 'token'],
  },
};

const ANTHROPIC_TOOLS = Object.entries(TOOL_DEFS).map(([name, def]) => ({
  name,
  description: def.description,
  input_schema: { type: 'object', properties: def.params, required: def.required },
}));

const OPENAI_TOOLS = Object.entries(TOOL_DEFS).map(([name, def]) => ({
  type: 'function',
  function: { name, description: def.description, parameters: { type: 'object', properties: def.params, required: def.required } },
}));

// ─── Tool executor ────────────────────────────────────────────────────────────

async function executeTool(name: string, args: Record<string, unknown>): Promise<{ text: string; isError: boolean }> {
  const { operations, spec } = getState();

  if (name === 'search_endpoints') {
    const q = String(args.query ?? '').toLowerCase();
    const terms = q.split(/\s+/).filter(Boolean);
    const matches = operations
      .filter(op => {
        const hay = [op.operationId, op.path, op.method, ...(op.tags ?? []), op.summary ?? '', op.description ?? ''].join(' ').toLowerCase();
        return terms.every(t => hay.includes(t));
      })
      .slice(0, 30)
      .map(op => ({ operationId: op.operationId, method: op.method.toUpperCase(), path: op.path, summary: op.summary ?? null, tags: op.tags }));
    if (!matches.length) return { text: `No endpoints found matching "${args.query}". Total: ${operations.length}.`, isError: false };
    return { text: JSON.stringify({ count: matches.length, total: operations.length, endpoints: matches }, null, 2), isError: false };
  }

  if (name === 'get_endpoint_schema') {
    const op = operations.find(o => o.operationId === args.operationId);
    if (!op) return { text: `Endpoint not found: "${args.operationId}"`, isError: true };
    return {
      text: JSON.stringify({
        operationId: op.operationId, method: op.method.toUpperCase(), path: op.path,
        summary: op.summary ?? null, description: op.description ?? null, tags: op.tags,
        parameters: op.parameters, requestBody: op.requestBody ?? null, responses: op.responses,
      }, null, 2),
      isError: false,
    };
  }

  if (name === 'execute_api_request') {
    const op = operations.find(o => o.operationId === args.operationId);
    if (!op) return { text: `Endpoint not found: "${args.operationId}"`, isError: true };
    const blocked = readonlyViolation(op.method);
    if (blocked) return { text: blocked, isError: true };

    const pathParams = (args.pathParams as Record<string, string>) ?? {};
    const queryParams = (args.queryParams as Record<string, string>) ?? {};
    const extraHeaders = (args.headers as Record<string, string>) ?? {};
    const reqBody = args.body;

    let urlPath = op.path;
    for (const [k, v] of Object.entries(pathParams)) urlPath = urlPath.replace(`{${k}}`, encodeURIComponent(String(v)));

    let base = spec.baseUrl;
    if (!base?.startsWith('http') && spec.url) {
      try { base = new URL(spec.url).origin; } catch { /* */ }
    }
    if (!base?.startsWith('http')) return { text: 'Error: spec has no absolute server URL', isError: true };

    const urlObj = new URL(`${base.replace(/\/$/, '')}${urlPath.startsWith('/') ? urlPath : `/${urlPath}`}`);
    for (const [k, v] of Object.entries(queryParams)) urlObj.searchParams.set(k, String(v));

    const authRow = dbQueries.getAuthConfig();
    const authConfig = authRow ? JSON.parse(authRow.config) : { type: 'none' };
    const { url: authedUrl, headers: authedHeaders } = await applyAuth(urlObj.toString(), extraHeaders, authConfig);

    const bodyStr = reqBody !== undefined ? (typeof reqBody === 'string' ? reqBody : JSON.stringify(reqBody)) : null;
    if (bodyStr !== null && op.requestBody?.contentType) authedHeaders['Content-Type'] = op.requestBody.contentType;

    try {
      const start = Date.now();
      const res = await fetch(authedUrl, { method: op.method.toUpperCase(), headers: authedHeaders, body: bodyStr ?? undefined });
      const text = await res.text();
      const latency = Date.now() - start;
      let pretty = text;
      try { pretty = JSON.stringify(JSON.parse(text), null, 2); } catch { /* */ }
      return { text: `HTTP ${res.status} (${latency}ms)\n\n${pretty}`, isError: !res.ok };
    } catch (e) {
      return { text: `Network error: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  if (name === 'fetch_url') {
    const url = String(args.url ?? '');
    try {
      const res = await fetch(url, { headers: { 'User-Agent': 'wasper/0.1' }, signal: AbortSignal.timeout(10000) });
      const text = await res.text();
      const stripped = text
        .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '')
        .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '')
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim()
        .slice(0, 6000);
      return { text: `HTTP ${res.status} from ${url}\n\n${stripped}`, isError: !res.ok };
    } catch (e) {
      return { text: `Error fetching ${url}: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  if (name === 'dns_lookup') {
    const host = String(args.host ?? '').trim();
    if (!host) return { text: 'Error: host is required', isError: true };
    const type = String(args.type ?? 'ALL').toUpperCase();
    try {
      const results: Record<string, unknown> = { host, type };
      const t0 = performance.now();
      try {
        const addrs = await dns.lookup(host, { all: true });
        results.addresses = addrs.map(a => `${a.address} (IPv${a.family})`);
      } catch { results.addresses = []; }
      results.lookup_ms = Math.round(performance.now() - t0);
      if (type === 'A' || type === 'ALL') { try { results.A = await dns.resolve4(host); } catch { results.A = []; } }
      if (type === 'AAAA' || type === 'ALL') { try { results.AAAA = await dns.resolve6(host); } catch { results.AAAA = []; } }
      if (type === 'MX' || type === 'ALL') { try { results.MX = await dns.resolveMx(host); } catch { results.MX = []; } }
      if (type === 'TXT' || type === 'ALL') { try { results.TXT = await dns.resolveTxt(host); } catch { results.TXT = []; } }
      if (type === 'NS' || type === 'ALL') { try { results.NS = await dns.resolveNs(host); } catch { results.NS = []; } }
      if (type === 'CNAME' || type === 'ALL') { try { results.CNAME = await dns.resolveCname(host); } catch { results.CNAME = []; } }
      return { text: JSON.stringify(results, null, 2), isError: false };
    } catch (e) {
      return { text: `DNS lookup failed: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  if (name === 'get_recent_logs') {
    const limit = Math.min(Number(args.limit ?? 20), 50);
    const filter = String(args.filter ?? '').toLowerCase();
    const logs = dbQueries.getRecentLogs(100);
    const filtered = filter
      ? logs.filter(l =>
          l.url?.toLowerCase().includes(filter) ||
          l.method?.toLowerCase().includes(filter) ||
          String(l.status_code ?? '').includes(filter),
        )
      : logs;
    const sliced = filtered.slice(0, limit).map(l => ({
      method: l.method, url: l.url, status: l.status_code,
      latency_ms: l.latency_ms, error: l.error ?? null,
      time: new Date(l.created_at > 1e12 ? l.created_at : l.created_at * 1000).toISOString(),
    }));
    return { text: JSON.stringify({ count: sliced.length, total: logs.length, logs: sliced }, null, 2), isError: false };
  }

  if (name === 'run_security_check') {
    const opId = String(args.operationId ?? '');
    const op = operations.find(o => o.operationId === opId);
    if (!op) return { text: `Endpoint not found: "${opId}"`, isError: true };
    const issues: string[] = [];
    const warnings: string[] = [];
    // Check method safety
    if (['DELETE', 'PUT', 'PATCH'].includes(op.method.toUpperCase())) {
      if (!op.parameters?.some(p => p.in === 'header' && /auth/i.test(p.name))) {
        warnings.push(`${op.method.toUpperCase()} ${op.path}: No explicit auth parameter — ensure server enforces authentication`);
      }
    }
    // Check for sensitive data in path
    if (/password|secret|token|key/i.test(op.path)) {
      issues.push(`Path contains sensitive keyword: "${op.path}" — avoid passing secrets in URL paths`);
    }
    // Check for missing security schemes
    const hasAuth = op.parameters?.some(p => /auth|token|key|bearer/i.test(p.name));
    if (!hasAuth && op.method.toUpperCase() !== 'GET') {
      warnings.push(`No auth parameters found on ${op.method.toUpperCase()} ${op.path} — verify server requires authentication`);
    }
    // Check for overly permissive methods
    if (op.method.toUpperCase() === 'GET' && op.path.toLowerCase().includes('/admin')) {
      warnings.push(`Admin GET endpoint ${op.path} — ensure proper authorization checks`);
    }
    const result = {
      operationId: opId,
      method: op.method.toUpperCase(),
      path: op.path,
      issues: issues.length ? issues : ['No critical issues found'],
      warnings: warnings.length ? warnings : ['No warnings'],
      recommendations: [
        'Always validate JWT tokens server-side',
        'Rate-limit sensitive endpoints',
        'Use HTTPS in production',
        'Avoid returning stack traces in error responses',
      ],
    };
    return { text: JSON.stringify(result, null, 2), isError: false };
  }

  if (name === 'list_auth_profiles') {
    const profiles = dbQueries.getProfiles();
    if (!profiles.length) return { text: 'No auth profiles saved. Use save_auth_token to create one after a successful login.', isError: false };
    const list = profiles.map(p => ({ id: p.id, name: p.name, type: p.type, active: p.is_active === 1 }));
    return { text: JSON.stringify({ count: list.length, profiles: list }, null, 2), isError: false };
  }

  if (name === 'set_active_auth') {
    const target = String(args.name ?? '');
    const profiles = dbQueries.getProfiles();
    const match = profiles.find(p => p.name.toLowerCase() === target.toLowerCase()) ?? profiles.find(p => p.id === target);
    if (!match) {
      const names = profiles.map(p => p.name).join(', ') || 'none saved';
      return { text: `Profile not found: "${target}". Available: ${names}`, isError: true };
    }
    dbQueries.activateProfile(match.id);
    return { text: JSON.stringify({ success: true, message: `Switched to "${match.name}" (${match.type})` }), isError: false };
  }

  if (name === 'save_auth_token') {
    const profileName = String(args.name ?? 'AI Login').trim();
    const token = String(args.token ?? '').trim();
    if (!token) return { text: 'Error: token is required', isError: true };
    const tokenType = String(args.token_type ?? 'bearer');
    const headerName = String(args.header_name ?? 'X-Api-Key');

    let authConfig: Record<string, string>;
    let type: string;
    if (tokenType === 'apikey_header') {
      authConfig = { type: 'apikey_header', header: headerName, value: token };
      type = 'apikey_header';
    } else if (tokenType === 'apikey_query') {
      authConfig = { type: 'apikey_query', param: headerName, value: token };
      type = 'apikey_query';
    } else {
      authConfig = { type: 'bearer', token };
      type = 'bearer';
    }

    const profileId = randomUUID();
    try {
      dbQueries.insertProfile({ id: profileId, name: profileName, description: 'Saved by AI', type, config: JSON.stringify(authConfig), token_cache: null, is_active: 0 });
      dbQueries.activateProfile(profileId);
      return { text: JSON.stringify({ success: true, message: `Saved and activated profile "${profileName}" (${type})`, id: profileId }), isError: false };
    } catch (e) {
      return { text: `Error saving profile: ${e instanceof Error ? e.message : String(e)}`, isError: true };
    }
  }

  return { text: `Unknown tool: ${name}`, isError: true };
}

// ─── Agentic loops ────────────────────────────────────────────────────────────

type Msg = { role: string; content: unknown; tool_call_id?: string };
type Emit = (e: Record<string, unknown>) => void;

async function fetchWithRetry(url: string, opts: RequestInit, emit: Emit, maxRetries = 3): Promise<Response> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    const res = await fetch(url, opts);
    if (res.status !== 429 || attempt === maxRetries) return res;
    const retryAfter = parseInt(res.headers.get('retry-after') ?? '0', 10);
    const delay = retryAfter > 0 ? retryAfter * 1000 : Math.min(1000 * Math.pow(2, attempt) + Math.random() * 500, 30000);
    emit({ type: 'info', message: `Rate limited — retrying in ${Math.round(delay / 1000)}s… (attempt ${attempt + 1}/${maxRetries})` });
    await new Promise(r => setTimeout(r, delay));
  }
  // unreachable, but satisfies TS
  return fetch(url, opts);
}

const MAX_TOTAL_TOOLS = 40;
const MAX_CONSECUTIVE_ERRORS = 5;
const MAX_SAME_ENDPOINT_ERRORS = 3;

async function anthropicAgentLoop(
  apiKey: string, model: string, system: string, initialMessages: Msg[], emit: Emit,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const msgs: Msg[] = [...initialMessages];
  const toolCalls: ToolCall[] = [];
  let totalTools = 0;
  let consecutiveErrors = 0;
  const endpointErrors: Record<string, number> = {};

  for (let iter = 0; iter < 40; iter++) {
    const res = await fetchWithRetry('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-api-key': apiKey, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, max_tokens: 4096, system, messages: msgs, tools: ANTHROPIC_TOOLS, stream: true }),
    }, emit);
    if (!res.ok) throw new Error(`Anthropic error: ${await res.text()}`);

    // Parse streaming SSE response
    let fullText = '';
    let stopReason = '';
    const contentBlocks: Array<{ type: string; text?: string; id?: string; name?: string; input?: Record<string, unknown> }> = [];
    const inputAccum: Record<number, string> = {};

    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    let buf = '';

    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += decoder.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';

      for (const part of parts) {
        let dataLine = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) { dataLine = line.slice(6); break; }
        }
        if (!dataLine || dataLine === '[DONE]') continue;
        let ev: Record<string, unknown>;
        try { ev = JSON.parse(dataLine) as Record<string, unknown>; } catch { continue; }

        const type = ev.type as string;
        if (type === 'content_block_start') {
          const idx = ev.index as number;
          const cb = ev.content_block as { type: string; id?: string; name?: string };
          contentBlocks[idx] = { type: cb.type, id: cb.id, name: cb.name };
          if (cb.type === 'tool_use') inputAccum[idx] = '';
        } else if (type === 'content_block_delta') {
          const idx = ev.index as number;
          const delta = ev.delta as { type: string; text?: string; partial_json?: string };
          if (delta.type === 'text_delta' && delta.text) {
            fullText += delta.text;
            if (!contentBlocks[idx]) contentBlocks[idx] = { type: 'text', text: '' };
            contentBlocks[idx].text = (contentBlocks[idx].text ?? '') + delta.text;
            emit({ type: 'text_delta', text: delta.text });
          } else if (delta.type === 'input_json_delta' && delta.partial_json) {
            inputAccum[idx] = (inputAccum[idx] ?? '') + delta.partial_json;
          }
        } else if (type === 'content_block_stop') {
          const idx = ev.index as number;
          if (contentBlocks[idx]?.type === 'tool_use') {
            try { contentBlocks[idx].input = JSON.parse(inputAccum[idx] ?? '{}'); }
            catch { contentBlocks[idx].input = {}; }
          }
        } else if (type === 'message_delta') {
          const delta = ev.delta as { stop_reason?: string };
          if (delta.stop_reason) stopReason = delta.stop_reason;
        }
      }
    }

    if (stopReason !== 'tool_use') return { content: fullText, toolCalls };

    // Guard: stop if too many tools used
    if (totalTools >= MAX_TOTAL_TOOLS) {
      return { content: `Agent stopped: reached ${MAX_TOTAL_TOOLS} tool calls. Please break your request into smaller steps.`, toolCalls };
    }

    msgs.push({ role: 'assistant', content: contentBlocks });
    const toolResults: Array<{ type: string; tool_use_id: string; content: string }> = [];
    for (const block of contentBlocks) {
      if (block.type !== 'tool_use' || !block.id || !block.name) continue;
      totalTools++;
      emit({ type: 'tool_start', tool: block.name, input: block.input ?? {} });
      const result = await executeTool(block.name, block.input ?? {});
      emit({ type: 'tool_done', tool: block.name, input: block.input ?? {}, output: result.text, isError: result.isError });
      toolCalls.push({ tool: block.name, input: block.input ?? {}, output: result.text, isError: result.isError });

      if (result.isError) {
        consecutiveErrors++;
        // Track per-endpoint repeated failures
        if (block.name === 'execute_api_request' && block.input?.operationId) {
          const eid = String(block.input.operationId);
          endpointErrors[eid] = (endpointErrors[eid] ?? 0) + 1;
          if (endpointErrors[eid] >= MAX_SAME_ENDPOINT_ERRORS) {
            const stopContent = result.text + `\n\n[AGENT LOOP STOPPED: endpoint "${eid}" failed ${MAX_SAME_ENDPOINT_ERRORS} times — stopping to avoid loop]`;
            toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: stopContent });
            msgs.push({ role: 'user', content: toolResults });
            return { content: `Endpoint "${eid}" failed ${MAX_SAME_ENDPOINT_ERRORS} times. Last error: ${result.text}`, toolCalls };
          }
        }
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          const stopMsg = `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Last: ${result.text}`;
          const stopContent = result.text + `\n\n[AGENT LOOP STOPPED: ${stopMsg}]`;
          toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: stopContent });
          msgs.push({ role: 'user', content: toolResults });
          return { content: stopMsg, toolCalls };
        }
      } else {
        consecutiveErrors = 0;
      }
      toolResults.push({ type: 'tool_result', tool_use_id: block.id, content: result.text });
    }
    if (!toolResults.length) return { content: fullText, toolCalls };
    msgs.push({ role: 'user', content: toolResults });
  }
  return { content: '(max iterations reached)', toolCalls };
}

async function openaiCompatibleLoop(
  base: string, apiKey: string | undefined, model: string, extraHeaders: Record<string, string>,
  system: string, initialMessages: Msg[], emit: Emit,
): Promise<{ content: string; toolCalls: ToolCall[] }> {
  const msgs: Msg[] = [{ role: 'system', content: system }, ...initialMessages];
  const toolCalls: ToolCall[] = [];
  const authHeaders: Record<string, string> = {};
  if (apiKey) authHeaders['Authorization'] = `Bearer ${apiKey}`;
  let totalTools = 0;
  let consecutiveErrors = 0;
  const endpointErrors: Record<string, number> = {};

  for (let iter = 0; iter < 40; iter++) {
    const res = await fetchWithRetry(`${base}/v1/chat/completions`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', ...authHeaders, ...extraHeaders },
      body: JSON.stringify({ model, messages: msgs, tools: OPENAI_TOOLS, tool_choice: 'auto', stream: true }),
    }, emit);
    if (!res.ok) throw new Error(await res.text());

    // Parse streaming SSE response
    let fullContent = '';
    let finishReason = '';
    const tcAccum: Record<number, { id: string; name: string; args: string }> = {};

    const reader = res.body!.getReader();
    const dec = new TextDecoder();
    let buf = '';

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop() ?? '';

      for (const part of parts) {
        let data = '';
        for (const line of part.split('\n')) {
          if (line.startsWith('data: ')) { data = line.slice(6); break; }
        }
        if (!data) continue;
        if (data === '[DONE]') break outer;

        let ev: Record<string, unknown>;
        try { ev = JSON.parse(data) as Record<string, unknown>; } catch { continue; }

        // Provider error returned in stream body (e.g. Groq rate limit)
        if (ev.object === 'error') throw new Error(JSON.stringify(ev));

        const choices = ev.choices as Array<Record<string, unknown>> | undefined;
        const choice = choices?.[0];
        if (!choice) continue;

        const fr = choice.finish_reason as string | null;
        if (fr) finishReason = fr;

        const delta = choice.delta as Record<string, unknown> | undefined;
        if (!delta) continue;

        if (typeof delta.content === 'string' && delta.content) {
          fullContent += delta.content;
          emit({ type: 'text_delta', text: delta.content });
        }

        const tcDeltas = delta.tool_calls as Array<{
          index: number; id?: string;
          function?: { name?: string; arguments?: string };
        }> | undefined;
        if (tcDeltas) {
          for (const tc of tcDeltas) {
            if (!tcAccum[tc.index]) tcAccum[tc.index] = { id: '', name: '', args: '' };
            const entry = tcAccum[tc.index]!;
            if (tc.id) entry.id += tc.id;
            if (tc.function?.name) entry.name += tc.function.name;
            if (tc.function?.arguments) entry.args += tc.function.arguments;
          }
        }
      }
    }

    if (finishReason !== 'tool_calls') return { content: fullContent, toolCalls };

    // Guard: stop if too many tools used
    if (totalTools >= MAX_TOTAL_TOOLS) {
      return { content: `Agent stopped: reached ${MAX_TOTAL_TOOLS} tool calls. Please break your request into smaller steps.`, toolCalls };
    }

    // Build tool call message and execute
    const msgToolCalls = Object.values(tcAccum).map(tc => ({
      id: tc.id, type: 'function',
      function: { name: tc.name, arguments: tc.args },
    }));
    msgs.push({ role: 'assistant', content: fullContent || null, tool_calls: msgToolCalls } as Msg);

    for (const tc of Object.values(tcAccum)) {
      let args: Record<string, unknown> = {};
      try { args = JSON.parse(tc.args); } catch { /* */ }
      totalTools++;
      emit({ type: 'tool_start', tool: tc.name, input: args });
      const result = await executeTool(tc.name, args);
      emit({ type: 'tool_done', tool: tc.name, input: args, output: result.text, isError: result.isError });
      toolCalls.push({ tool: tc.name, input: args, output: result.text, isError: result.isError });
      msgs.push({ role: 'tool', tool_call_id: tc.id, content: result.text });
      if (result.isError) {
        consecutiveErrors++;
        if (tc.name === 'execute_api_request' && args.operationId) {
          const eid = String(args.operationId);
          endpointErrors[eid] = (endpointErrors[eid] ?? 0) + 1;
          if (endpointErrors[eid] >= MAX_SAME_ENDPOINT_ERRORS) {
            return { content: `Endpoint "${eid}" failed ${MAX_SAME_ENDPOINT_ERRORS} times. Last error: ${result.text}`, toolCalls };
          }
        }
        if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
          return { content: `Stopped after ${MAX_CONSECUTIVE_ERRORS} consecutive errors. Last: ${result.text}`, toolCalls };
        }
      } else {
        consecutiveErrors = 0;
      }
    }
  }
  return { content: '(max iterations reached)', toolCalls };
}

// ─── Handler ─────────────────────────────────────────────────────────────────

async function handleAiChat(req: Request): Promise<Response> {
  let body: { messages: { role: string; content: string }[]; extra_context?: string };
  try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }

  const settingsRow = dbQueries.getSettings();
  const settings = settingsRow ? JSON.parse(settingsRow.value) : {};
  const ai = (settings.ai ?? {}) as { provider?: string; apiKey?: string; model?: string; baseUrl?: string };

  const { spec, operations } = getState();
  const preview = operations.slice(0, 40).map(op => `- ${op.method.toUpperCase()} ${op.path}${op.summary ? `: ${op.summary}` : ''}`).join('\n');
  const activeAuth = dbQueries.getActiveProfile();
  const authLine = activeAuth
    ? `Active auth: "${activeAuth.name}" (${activeAuth.type})`
    : 'No active auth profile. If the API requires auth, call list_auth_profiles first, then set_active_auth, or login and call save_auth_token.';

  const system = `You are an AI assistant for the "${spec.title}" API (v${spec.version}). Base URL: ${spec.baseUrl}.
Total endpoints: ${operations.length}. Sample:
${preview}${operations.length > 40 ? `\n... and ${operations.length - 40} more` : ''}

${authLine}

Tools available:
- search_endpoints / get_endpoint_schema: explore API structure
- execute_api_request: call an endpoint
- list_auth_profiles: list all saved auth profiles (name, type, active)
- set_active_auth(name): switch to a saved profile before making requests
- save_auth_token(name, token): IMMEDIATELY call this after a successful login that returns a token — saves the token as a named profile and activates it so subsequent requests are authenticated
- fetch_url: fetch external docs
- dns_lookup: DNS resolution / connectivity
- get_recent_logs: recent request/response traffic
- run_security_check: security analysis on an endpoint

Authentication workflow: if requests return 401/403, call list_auth_profiles first. If a profile exists, call set_active_auth. If none, find and call the login endpoint, extract the token from the response, then call save_auth_token immediately. After saving, retry the original request.

IMPORTANT: if an endpoint returns an error, diagnose it (check the schema, check auth) and fix the root cause before retrying. If the same endpoint fails 3 times the agent will be forcibly stopped. Do not retry without changing something.

Be concise and practical. Format code and JSON in code blocks.${body.extra_context ? `\n\n---\n## Current context\n${body.extra_context}` : ''}`;

  const provider = ai.provider ?? 'anthropic';
  const requiresKey = provider !== 'ollama' && provider !== 'custom';
  if (requiresKey && !ai.apiKey) {
    return json({ error: 'No AI API key configured. Go to Settings → AI Provider to add one.' }, 400);
  }

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const emit: Emit = (e) => { writer.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`)).catch(() => {}); };

  const msgs = body.messages as Msg[];

  (async () => {
    try {
      let result: { content: string; toolCalls: ToolCall[] };

      if (provider === 'anthropic') {
        result = await anthropicAgentLoop(ai.apiKey!, ai.model || 'claude-haiku-4-5-20251001', system, msgs, emit);
      } else if (provider === 'openai') {
        const base = (ai.baseUrl || 'https://api.openai.com').replace(/\/$/, '');
        result = await openaiCompatibleLoop(base, ai.apiKey, ai.model || 'gpt-4o-mini', {}, system, msgs, emit);
      } else if (provider === 'mistral') {
        const base = (ai.baseUrl || 'https://api.mistral.ai').replace(/\/$/, '');
        result = await openaiCompatibleLoop(base, ai.apiKey, ai.model || 'mistral-small-latest', {}, system, msgs, emit);
      } else if (provider === 'github-copilot') {
        const base = (ai.baseUrl || 'https://api.githubcopilot.com').replace(/\/$/, '');
        result = await openaiCompatibleLoop(base, ai.apiKey, ai.model || 'gpt-4o', {
          'Copilot-Integration-Id': 'vscode-chat',
          'Editor-Version': 'vscode/1.85.0',
        }, system, msgs, emit);
      } else if (provider === 'groq') {
        const base = (ai.baseUrl || 'https://api.groq.com/openai').replace(/\/$/, '');
        result = await openaiCompatibleLoop(base, ai.apiKey, ai.model || 'llama-3.1-70b-versatile', {}, system, msgs, emit);
      } else if (provider === 'custom') {
        if (!ai.baseUrl) { emit({ type: 'error', message: 'Custom provider requires a Base URL.' }); await writer.close(); return; }
        result = await openaiCompatibleLoop(ai.baseUrl.replace(/\/$/, ''), ai.apiKey, ai.model || '', {}, system, msgs, emit);
      } else if (provider === 'ollama') {
        const base = (ai.baseUrl || 'http://localhost:11434').replace(/\/$/, '');
        const res = await fetch(`${base}/api/chat`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ model: ai.model || 'llama3', messages: [{ role: 'system', content: system }, ...msgs], stream: false }),
        });
        const d = await res.json() as { message: { content: string } };
        result = { content: d.message.content ?? '', toolCalls: [] };
      } else if (provider === 'gemini') {
        const model = ai.model || 'gemini-1.5-flash';
        const base = (ai.baseUrl || 'https://generativelanguage.googleapis.com').replace(/\/$/, '');
        const res = await fetch(`${base}/v1beta/models/${model}:generateContent?key=${ai.apiKey}`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: system }] },
            contents: msgs.map(m => ({ role: m.role === 'assistant' ? 'model' : 'user', parts: [{ text: m.content }] })),
            generationConfig: { maxOutputTokens: 4096 },
          }),
        });
        const d = await res.json() as { candidates: { content: { parts: { text: string }[] } }[] };
        result = { content: d.candidates[0]?.content.parts[0]?.text ?? '', toolCalls: [] };
      } else {
        emit({ type: 'error', message: `Unknown provider: ${provider}` });
        await writer.close();
        return;
      }

      emit({ type: 'done', content: result.content, toolCalls: result.toolCalls });
    } catch (e) {
      emit({ type: 'error', message: e instanceof Error ? e.message : String(e) });
    } finally {
      try { await writer.close(); } catch { /* stream already closed by timeout or client disconnect */ }
    }
  })();

  return new Response(readable, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      ...CORS,
    },
  });
}

// ─── Auth profiles ────────────────────────────────────────────────────────────

function handleGetProfiles(): Response {
  return json(dbQueries.getProfiles());
}

async function handleCreateProfile(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = await req.json() as typeof body; } catch { return badRequest('Invalid JSON'); }
  const profile = {
    id: randomUUID(),
    name: String(body.name ?? '').trim() || 'Unnamed',
    description: String(body.description ?? ''),
    type: String(body.type ?? 'none'),
    config: JSON.stringify(body.config ?? {}),
    token_cache: null as string | null,
    is_active: 0,
  };
  dbQueries.insertProfile(profile);
  return json({ ...profile, is_active: false });
}

async function handleUpdateProfile(req: Request, path: string): Promise<Response> {
  const id = path.replace('/api/auth/profiles/', '').replace(/\/.*/, '');
  let body: Record<string, unknown>;
  try { body = await req.json() as typeof body; } catch { return badRequest('Invalid JSON'); }
  const patch: Record<string, unknown> = {};
  if ('name' in body) patch.name = String(body.name);
  if ('description' in body) patch.description = String(body.description);
  if ('type' in body) patch.type = String(body.type);
  if ('config' in body) patch.config = JSON.stringify(body.config);
  dbQueries.updateProfile(id, patch as Parameters<typeof dbQueries.updateProfile>[1]);
  return json({ ok: true });
}

function handleDeleteProfile(path: string): Response {
  const id = path.replace('/api/auth/profiles/', '');
  dbQueries.deleteProfile(id);
  return json({ ok: true });
}

function handleActivateProfile(path: string): Response {
  const id = path.replace('/api/auth/profiles/', '').replace('/activate', '');
  dbQueries.activateProfile(id);
  const profile = dbQueries.getProfiles().find(p => p.id === id);
  return json({ ok: true, profile });
}

// ─── Intercept rules ──────────────────────────────────────────────────────────

function handleGetRules(): Response {
  return json(dbQueries.getRules());
}

async function handleCreateRule(req: Request): Promise<Response> {
  let body: Partial<Omit<InterceptRuleRow, 'id' | 'created_at'>>;
  try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }
  const rule: Omit<InterceptRuleRow, 'created_at'> = {
    id: randomUUID(),
    enabled: body.enabled ?? 1,
    name: body.name ?? '',
    sort_order: body.sort_order ?? 0,
    match_path: body.match_path ?? '',
    match_method: body.match_method ?? '',
    target_host: body.target_host ?? '',
    strip_prefix: body.strip_prefix ?? '',
    add_prefix: body.add_prefix ?? '',
    add_headers: typeof body.add_headers === 'string' ? body.add_headers : JSON.stringify(body.add_headers ?? {}),
  };
  dbQueries.insertRule(rule);
  return json(rule, 201);
}

async function handleUpdateRule(req: Request, path: string): Promise<Response> {
  const id = path.slice('/api/intercept/'.length);
  if (!id) return badRequest('Missing rule id');
  let body: Partial<Omit<InterceptRuleRow, 'id' | 'created_at'>>;
  try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }
  // Ensure add_headers is a JSON string, not a raw object
  if ('add_headers' in body && typeof body.add_headers !== 'string') {
    body = { ...body, add_headers: JSON.stringify(body.add_headers ?? {}) };
  }
  dbQueries.updateRule(id, body);
  return json({ ok: true });
}

function handleDeleteRule(path: string): Response {
  const id = path.slice('/api/intercept/'.length);
  if (!id) return badRequest('Missing rule id');
  dbQueries.deleteRule(id);
  return json({ ok: true });
}

interface MultipartPart {
  name: string;
  kind: 'text' | 'file';
  value?: string;
  filename?: string;
  contentType?: string;
  dataB64?: string;
}

async function handleExplorerRequest(req: Request): Promise<Response> {
  let body: {
    method: string; url: string; headers?: Record<string, string>; body?: string;
    bodyB64?: string;
    multipart?: MultipartPart[];
    authProfile?: string;
    auth?: AuthConfig;
    interceptRuleId?: string;
    /** Per-request timeout in ms (0 = no timeout). Falls back to global settings. */
    timeout?: number;
    /** Follow HTTP redirects (default true). */
    followRedirects?: boolean;
  };
  try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }

  const blocked = readonlyViolation(body.method ?? 'GET');
  if (blocked) return json({ error: blocked }, 403);

  let authConfig: AuthConfig;
  if (body.auth?.type) {
    authConfig = body.auth;
  } else if (body.authProfile === 'none') {
    authConfig = { type: 'none' };
  } else if (body.authProfile) {
    const profiles = dbQueries.getProfiles();
    const profile = profiles.find(p => p.id === body.authProfile)
      ?? profiles.find(p => p.name.toLowerCase() === body.authProfile!.toLowerCase());
    if (!profile) return json({ error: `Auth profile not found: "${body.authProfile}"` }, 404);
    authConfig = JSON.parse(profile.config) as AuthConfig;
  } else {
    const authRow = dbQueries.getAuthConfig();
    authConfig = authRow ? JSON.parse(authRow.config) : { type: 'none' };
  }

  // Resolve relative URLs against the spec base URL (or spec source origin as fallback)
  let reqUrl = body.url.trim();
  if (!reqUrl.startsWith('http')) {
    const { spec } = getState();
    let base = spec.baseUrl.startsWith('http') ? spec.baseUrl : '';
    if (!base && spec.url) {
      try { base = new URL(spec.url).origin; } catch { /* */ }
    }
    if (base) {
      reqUrl = new URL(reqUrl, base).href;
    } else {
      return json({ error: `Cannot resolve "${reqUrl}": spec has no absolute server URL. Configure it in the OpenAPI spec's servers array.` }, 400);
    }
  }

  // Apply a specific intercept rule when requested
  let mergedHeaders = body.headers ?? {};
  if (body.interceptRuleId) {
    const rule = dbQueries.getRules().find(r => r.id === body.interceptRuleId);
    if (rule) {
      try {
        const u = new URL(reqUrl);
        if (rule.target_host) {
          const targetOrigin = rule.target_host.startsWith('http') ? rule.target_host : `https://${rule.target_host}`;
          let path = u.pathname;
          if (rule.strip_prefix && path.startsWith(rule.strip_prefix)) path = path.slice(rule.strip_prefix.length) || '/';
          if (rule.add_prefix) path = rule.add_prefix + path;
          reqUrl = new URL(path + u.search + u.hash, targetOrigin).href;
        }
        if (rule.add_headers) {
          const extra = JSON.parse(rule.add_headers) as Record<string, string>;
          mergedHeaders = { ...mergedHeaders, ...extra };
        }
      } catch { /* malformed rule — ignore */ }
    }
  }

  const { url: authedUrl, headers: authedHeaders } = await applyAuth(reqUrl, mergedHeaders, authConfig);

  // Build the outgoing body — multipart and binary need real bytes
  let outBody: string | FormData | Buffer | undefined;
  if (body.multipart?.length) {
    const fd = new FormData();
    for (const part of body.multipart) {
      if (part.kind === 'file' && part.dataB64 != null) {
        const bytes = Buffer.from(part.dataB64, 'base64');
        fd.append(part.name, new Blob([bytes], { type: part.contentType || 'application/octet-stream' }), part.filename ?? 'file');
      } else {
        fd.append(part.name, part.value ?? '');
      }
    }
    outBody = fd;
    // fetch must set its own Content-Type with the boundary
    for (const k of Object.keys(authedHeaders)) {
      if (k.toLowerCase() === 'content-type') delete authedHeaders[k];
    }
  } else if (body.bodyB64) {
    outBody = Buffer.from(body.bodyB64, 'base64');
  } else {
    outBody = body.body ?? undefined;
  }

  const settingsRow = dbQueries.getSettings();
  const globalSettings = settingsRow ? (JSON.parse(settingsRow.value) as { request?: { timeout?: number; followRedirects?: boolean } }) : {};
  const globalTimeout = globalSettings.request?.timeout ?? 30000;
  const globalFollowRedirects = globalSettings.request?.followRedirects ?? true;

  const timeoutMs = body.timeout !== undefined ? body.timeout : globalTimeout;
  const followRedirects = body.followRedirects !== undefined ? body.followRedirects : globalFollowRedirects;

  const fetchOpts: RequestInit = {
    method: body.method.toUpperCase(),
    headers: authedHeaders,
    body: outBody,
    redirect: followRedirects ? 'follow' : 'manual',
  };
  if (timeoutMs > 0) (fetchOpts as RequestInit & { signal: AbortSignal }).signal = AbortSignal.timeout(timeoutMs);

  // DNS pre-resolution for timing measurement
  let dnsMs = 0;
  let resolvedAddr = '';
  try {
    const u = new URL(authedUrl);
    const h = u.hostname;
    const defaultPort = u.protocol === 'https:' ? 443 : 80;
    const port = u.port ? Number(u.port) : defaultPort;
    if (!/^[\d:.]+$/.test(h) && h !== 'localhost') {
      const t0 = performance.now();
      const r = await dns.lookup(h);
      dnsMs = Math.round(performance.now() - t0);
      resolvedAddr = `${r.address}:${port}`;
    } else {
      resolvedAddr = `${h}:${port}`;
    }
  } catch { /* ignore DNS pre-resolve errors */ }

  const fetchStart = performance.now();
  try {
    const res = await fetch(authedUrl, fetchOpts);
    const waitMs = Math.round(performance.now() - fetchStart);
    const resHeaders = Object.fromEntries(res.headers.entries());
    const ct = res.headers.get('content-type') ?? '';

    const u = new URL(authedUrl);
    const networkInfo = {
      scheme: u.protocol.replace(':', ''),
      host: u.host,
      filename: u.pathname + u.search,
      remoteAddr: resolvedAddr,
      httpVersion: 'HTTP/1.1',
      referrerPolicy: res.headers.get('referrer-policy') ?? '',
    };

    // Binary responses (images, pdf, …) can't survive .text() — ship base64
    if (/^(image|audio|video)\//.test(ct) || ct.includes('application/pdf') || ct.includes('application/octet-stream')) {
      const bufStart = performance.now();
      const buf = Buffer.from(await res.arrayBuffer());
      const receiveMs = Math.round(performance.now() - bufStart);
      const latency = dnsMs + waitMs + receiveMs;
      const timing = { dns: dnsMs, connect: 0, tls: 0, send: 0, wait: waitMs, receive: receiveMs, total: latency };
      return json({ status: res.status, statusText: res.statusText, headers: resHeaders, bodyB64: buf.toString('base64'), size: buf.byteLength, latency, timing, networkInfo });
    }

    const bodyStart = performance.now();
    const responseText = await res.text();
    const receiveMs = Math.round(performance.now() - bodyStart);
    const latency = dnsMs + waitMs + receiveMs;
    const timing = { dns: dnsMs, connect: 0, tls: 0, send: 0, wait: waitMs, receive: receiveMs || 1, total: latency };

    const redirectedTo = !followRedirects && res.status >= 300 && res.status < 400
      ? { redirectedTo: res.headers.get('location') }
      : {};
    return json({ status: res.status, statusText: res.statusText, headers: resHeaders, body: responseText, size: new TextEncoder().encode(responseText).length, latency, timing, networkInfo, ...redirectedTo });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const isTimeout = msg.toLowerCase().includes('timed out') || msg.toLowerCase().includes('timeout');
    return json({ error: isTimeout ? `Request timed out after ${timeoutMs}ms` : msg, latency: Math.round(performance.now() - fetchStart) + dnsMs }, 502);
  }
}

// ── DNS & Network debug ─────────────────────────────────────────────────────────

async function handleDnsQuery(params: URLSearchParams): Promise<Response> {
  const host = params.get('host')?.trim();
  if (!host) return badRequest('host is required');
  const type = params.get('type')?.toUpperCase() ?? 'ALL';

  try {
    const result: Record<string, unknown> = { host, type, timestamp: new Date().toISOString() };
    const t0 = performance.now();
    try {
      const addrs = await dns.lookup(host, { all: true });
      result.addresses = addrs.map(a => ({ address: a.address, family: `IPv${a.family}` }));
    } catch { result.addresses = []; }
    result.lookup_ms = Math.round(performance.now() - t0);

    if (type === 'A' || type === 'ALL') { try { result.A = await dns.resolve4(host); } catch { result.A = []; } }
    if (type === 'AAAA' || type === 'ALL') { try { result.AAAA = await dns.resolve6(host); } catch { result.AAAA = []; } }
    if (type === 'MX' || type === 'ALL') { try { result.MX = await dns.resolveMx(host); } catch { result.MX = []; } }
    if (type === 'TXT' || type === 'ALL') { try { result.TXT = await dns.resolveTxt(host); } catch { result.TXT = []; } }
    if (type === 'NS' || type === 'ALL') { try { result.NS = await dns.resolveNs(host); } catch { result.NS = []; } }
    if (type === 'CNAME' || type === 'ALL') { try { result.CNAME = await dns.resolveCname(host); } catch { result.CNAME = []; } }

    return json(result);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e), host }, 502);
  }
}

async function handlePing(params: URLSearchParams): Promise<Response> {
  const host = params.get('host')?.trim();
  if (!host) return badRequest('host is required');
  const port = parseInt(params.get('port') ?? '80', 10);

  const checks = [];
  // DNS resolution
  const dnsStart = performance.now();
  let resolvedIp = '';
  try {
    const r = await dns.lookup(host);
    resolvedIp = r.address;
    checks.push({ step: 'dns', success: true, ip: r.address, ms: Math.round(performance.now() - dnsStart) });
  } catch (e) {
    checks.push({ step: 'dns', success: false, error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - dnsStart) });
  }

  // HTTP reachability check
  if (resolvedIp) {
    const httpStart = performance.now();
    const scheme = port === 443 ? 'https' : 'http';
    try {
      const res = await fetch(`${scheme}://${host}:${port}/`, {
        method: 'HEAD',
        signal: AbortSignal.timeout(5000),
        redirect: 'manual',
      });
      checks.push({ step: 'http', success: true, status: res.status, ms: Math.round(performance.now() - httpStart) });
    } catch (e) {
      checks.push({ step: 'http', success: false, error: e instanceof Error ? e.message : String(e), ms: Math.round(performance.now() - httpStart) });
    }
  }

  return json({ host, port, resolvedIp, checks, timestamp: new Date().toISOString() });
}

// ── Saved requests ─────────────────────────────────────────────────────────────

function handleGetSaved(): Response {
  return json(dbQueries.getSavedRequests());
}

async function handleCreateSaved(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return badRequest('Invalid JSON'); }
  if (!body.name || typeof body.name !== 'string') return badRequest('name is required');
  const id = randomUUID();
  dbQueries.insertSavedRequest({
    id,
    name: String(body.name),
    folder: String(body.folder ?? ''),
    method: String(body.method ?? 'GET'),
    url: String(body.url ?? ''),
    headers: typeof body.headers === 'string' ? body.headers : JSON.stringify(body.headers ?? []),
    params: typeof body.params === 'string' ? body.params : JSON.stringify(body.params ?? []),
    body: String(body.body ?? ''),
    body_type: String(body.body_type ?? 'none'),
    raw_type: String(body.raw_type ?? 'text/plain'),
    form_rows: typeof body.form_rows === 'string' ? body.form_rows : JSON.stringify(body.form_rows ?? []),
    auth: typeof body.auth === 'string' ? body.auth : JSON.stringify(body.auth ?? {}),
    notes: String(body.notes ?? ''),
  });
  return json(dbQueries.getSavedRequest(id), 201);
}

async function handleUpdateSaved(req: Request, path: string): Promise<Response> {
  const id = path.replace('/api/saved/', '');
  if (!dbQueries.getSavedRequest(id)) return notFound();
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return badRequest('Invalid JSON'); }
  const patch: Record<string, string> = {};
  const allowed = ['name', 'folder', 'method', 'url', 'headers', 'params', 'body', 'body_type', 'raw_type', 'form_rows', 'auth', 'notes'] as const;
  for (const key of allowed) {
    if (key in body) patch[key] = typeof body[key] === 'string' ? String(body[key]) : JSON.stringify(body[key]);
  }
  if (Object.keys(patch).length) dbQueries.updateSavedRequest(id, patch);
  return json(dbQueries.getSavedRequest(id));
}

function handleDeleteSaved(path: string): Response {
  const id = path.replace('/api/saved/', '');
  if (!dbQueries.getSavedRequest(id)) return notFound();
  dbQueries.deleteSavedRequest(id);
  return json({ ok: true });
}

// ── Workflows ──────────────────────────────────────────────────────────────────

function workflowRow(row: ReturnType<typeof dbQueries.getWorkflow>) {
  if (!row) return null;
  let steps: WorkflowStep[] = [];
  try { steps = JSON.parse(row.steps) as WorkflowStep[]; } catch { /* malformed steps, default to [] */ }
  return { ...row, steps };
}

function handleGetWorkflows(): Response {
  const rows = dbQueries.getWorkflows().map(r => workflowRow(r)).filter(Boolean);
  return json(rows);
}

async function handleCreateWorkflow(req: Request): Promise<Response> {
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return badRequest('Invalid JSON'); }
  const id = randomUUID();
  dbQueries.insertWorkflow({
    id,
    name: String(body.name ?? 'Untitled Workflow'),
    description: String(body.description ?? ''),
    steps: typeof body.steps === 'string' ? body.steps : JSON.stringify(body.steps ?? []),
  });
  return json(workflowRow(dbQueries.getWorkflow(id)), 201);
}

async function handleUpdateWorkflow(req: Request, path: string): Promise<Response> {
  const id = path.slice('/api/workflows/'.length);
  if (!dbQueries.getWorkflow(id)) return notFound();
  let body: Record<string, unknown>;
  try { body = (await req.json()) as Record<string, unknown>; } catch { return badRequest('Invalid JSON'); }
  const patch: Partial<{ name: string; description: string; steps: string }> = {};
  if ('name' in body) patch.name = String(body.name);
  if ('description' in body) patch.description = String(body.description);
  if ('steps' in body) patch.steps = typeof body.steps === 'string' ? body.steps : JSON.stringify(body.steps);
  if (Object.keys(patch).length) dbQueries.updateWorkflow(id, patch);
  return json(workflowRow(dbQueries.getWorkflow(id)));
}

function handleDeleteWorkflow(path: string): Response {
  const id = path.slice('/api/workflows/'.length);
  if (!dbQueries.getWorkflow(id)) return notFound();
  dbQueries.deleteWorkflow(id);
  return json({ ok: true });
}

async function handleGenerateWorkflow(req: Request): Promise<Response> {
  if (!hasState()) return badRequest('No spec loaded');
  let body: { prompt?: string };
  try { body = (await req.json()) as typeof body; } catch { return badRequest('Invalid JSON'); }

  const settingsRow = dbQueries.getSettings();
  const settings = settingsRow ? JSON.parse(settingsRow.value) as Record<string, unknown> : {};
  const ai = (settings.ai ?? {}) as { provider?: string; apiKey?: string; model?: string; baseUrl?: string };
  const provider = ai.provider ?? 'anthropic';
  if (provider !== 'ollama' && !ai.apiKey) {
    return json({ error: 'No AI API key configured. Go to Settings → AI Provider to add one.' }, 400);
  }

  const { spec, operations } = getState();
  const endpointList = operations.slice(0, 80).map(op =>
    `${op.method.toUpperCase()} ${op.path}${op.operationId ? ` [${op.operationId}]` : ''}${op.summary ? ` — ${op.summary}` : ''}`
  ).join('\n');

  const userPrompt = body.prompt?.trim() || 'Generate a realistic end-to-end test workflow covering authentication and CRUD operations.';

  const systemMsg = `You generate API test workflows as JSON for the "${spec.title}" API (base: ${spec.baseUrl}).

Available endpoints:
${endpointList}

Return ONLY valid JSON (no markdown fences) matching this schema exactly:
{
  "name": "string",
  "description": "string",
  "steps": [
    {
      "id": "step_1",
      "label": "Human-readable name",
      "method": "GET|POST|PUT|PATCH|DELETE",
      "path": "/exact/path/from/spec",
      "operationId": "operationId or null",
      "pathParams": {},
      "queryParams": {},
      "headers": {},
      "body": null,
      "extract": [{"var": "varName", "path": "$.field.nested"}],
      "assert": [{"type": "status", "statusCode": 200}]
    }
  ]
}

Rules:
- Use {{varName}} in path/headers/body values to reference vars extracted in prior steps
- For auth: extract token after login, set headers: {"Authorization": "Bearer {{token}}"}
- Keep 3–8 steps covering a realistic user journey
- Only use paths that exist in the endpoint list above`;

  try {
    let text = '';
    if (provider === 'anthropic') {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-api-key': ai.apiKey!, 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: ai.model || 'claude-sonnet-4-6', max_tokens: 4096, system: systemMsg, messages: [{ role: 'user', content: userPrompt }] }),
      });
      if (!res.ok) throw new Error(`Anthropic: ${await res.text()}`);
      const d = await res.json() as { content: Array<{ type: string; text: string }> };
      text = d.content.find(b => b.type === 'text')?.text ?? '';
    } else {
      const base = (ai.baseUrl || (provider === 'openai' ? 'https://api.openai.com' : provider === 'groq' ? 'https://api.groq.com/openai' : provider === 'mistral' ? 'https://api.mistral.ai' : 'https://api.openai.com')).replace(/\/$/, '');
      const hdrs: Record<string, string> = { 'Content-Type': 'application/json' };
      if (ai.apiKey) hdrs['Authorization'] = `Bearer ${ai.apiKey}`;
      const res = await fetch(`${base}/v1/chat/completions`, {
        method: 'POST', headers: hdrs,
        body: JSON.stringify({ model: ai.model || 'gpt-4o-mini', max_tokens: 2048, response_format: { type: 'json_object' }, messages: [{ role: 'system', content: systemMsg }, { role: 'user', content: userPrompt }] }),
      });
      if (!res.ok) throw new Error(await res.text());
      const d = await res.json() as { choices: Array<{ message: { content: string } }> };
      text = d.choices[0]?.message.content ?? '';
    }

    let parsed: unknown;
    try { parsed = JSON.parse(text); }
    catch {
      const m = text.match(/```(?:json)?\s*\n?([\s\S]+?)\n?```/);
      if (m) parsed = JSON.parse(m[1]!);
      else throw new Error('AI response was not valid JSON');
    }
    return json(parsed);
  } catch (e) {
    return json({ error: e instanceof Error ? e.message : String(e) }, 500);
  }
}

function handleRunWorkflow(path: string): Response {
  const id = path.slice('/api/workflows/'.length, -'/run'.length);
  const row = dbQueries.getWorkflow(id);
  if (!row) return notFound();
  if (!hasState()) return badRequest('No spec loaded');

  let steps: WorkflowStep[];
  try { steps = JSON.parse(row.steps) as WorkflowStep[]; }
  catch { return badRequest('Invalid workflow steps JSON'); }

  if (!steps.length) return badRequest('Workflow has no steps');

  const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
  const writer = writable.getWriter();
  const enc = new TextEncoder();
  const emit = (e: Record<string, unknown>) => {
    writer.write(enc.encode(`data: ${JSON.stringify(e)}\n\n`)).catch(() => {});
  };

  (async () => {
    try { await runWorkflow(steps, emit); }
    catch (e) { emit({ type: 'error', message: e instanceof Error ? e.message : String(e) }); }
    finally { try { await writer.close(); } catch { /* closed */ } }
  })();

  return new Response(readable, {
    headers: { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache', ...CORS },
  });
}

// ── Capture bins ─────────────────────────────────────────────────────────────
function handleGetCaptureBins(): Response {
  return json(dbQueries.getCaptureBins());
}

async function handleCreateCaptureBin(req: Request): Promise<Response> {
  const body = await req.json().catch(() => ({})) as { name?: string };
  // Short 8-char hex ID — readable in a URL
  const id = randomUUID().replace(/-/g, '').slice(0, 8);
  const name = String(body.name ?? '').trim() || 'Untitled bin';
  dbQueries.insertCaptureBin(id, name);
  return json({ id, name, created_at: Math.floor(Date.now() / 1000) }, 201);
}

function handleDeleteCaptureBin(path: string): Response {
  const id = path.replace('/api/capture/bins/', '');
  dbQueries.deleteCaptureBin(id);
  return json({ ok: true });
}
