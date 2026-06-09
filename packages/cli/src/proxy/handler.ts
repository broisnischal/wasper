import { dbQueries, randomUUID } from "../db/index";
import { applyAuth, type AuthConfig } from "../auth/engine";
import { logBus } from "../logs/bus";
import { getState } from "../state";

function applyInterceptRules(method: string, path: string, baseUrl: string): { targetBase: string; targetPath: string; extraHeaders: Record<string, string> } {
  const rules = dbQueries.getRules().filter(r => r.enabled === 1);
  let targetBase = baseUrl;
  let targetPath = path;
  const extraHeaders: Record<string, string> = {};

  for (const rule of rules) {
    const methodMatch = !rule.match_method || rule.match_method === '*' || rule.match_method.toUpperCase() === method.toUpperCase();
    const pathMatch = !rule.match_path || rule.match_path === '*' || path.startsWith(rule.match_path);
    if (!methodMatch || !pathMatch) continue;

    if (rule.target_host) targetBase = rule.target_host;
    if (rule.strip_prefix && targetPath.startsWith(rule.strip_prefix)) {
      targetPath = targetPath.slice(rule.strip_prefix.length) || '/';
    }
    if (rule.add_prefix) targetPath = rule.add_prefix + targetPath;
    try {
      const h = JSON.parse(rule.add_headers) as Record<string, string>;
      Object.assign(extraHeaders, h);
    } catch {}
    break; // first matching rule wins
  }

  return { targetBase: targetBase.replace(/\/$/, ''), targetPath, extraHeaders };
}

const CORS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

export async function proxyHandler(req: Request): Promise<Response> {
  if (req.method === "OPTIONS")
    return new Response(null, { status: 204, headers: CORS });

  const url = new URL(req.url);
  const apiPath = url.pathname.replace(/^\/proxy/, "") || "/";
  const { spec } = getState();

  let baseUrl = spec.baseUrl;
  if (!baseUrl?.startsWith('http') && spec.url) {
    try { baseUrl = new URL(spec.url).origin; } catch { /* keep */ }
  }

  const authRow = dbQueries.getAuthConfig();
  const authConfig: AuthConfig = authRow
    ? JSON.parse(authRow.config)
    : { type: "none" };
  const { targetBase, targetPath, extraHeaders } = applyInterceptRules(req.method, apiPath, baseUrl);
  const targetUrl = `${targetBase}${targetPath}${url.search}`;

  const proxyHeaders: Record<string, string> = {};
  for (const [k, v] of req.headers.entries()) {
    if (!["host", "connection", "transfer-encoding"].includes(k.toLowerCase()))
      proxyHeaders[k] = v;
  }
  Object.assign(proxyHeaders, extraHeaders);

  const { url: authedUrl, headers: authedHeaders } = await applyAuth(
    targetUrl,
    proxyHeaders,
    authConfig,
  );
  const requestBody =
    req.method !== "GET" && req.method !== "HEAD" ? await req.text() : null;
  const startTime = Date.now();
  const logId = randomUUID();

  try {
    const res = await fetch(authedUrl, {
      method: req.method,
      headers: authedHeaders,
      body: requestBody ?? undefined,
    });

    const responseBody = await res.text();
    const latency = Date.now() - startTime;
    const resHeaders = Object.fromEntries(res.headers.entries());

    dbQueries.insertLog({
      id: logId,
      source: "explorer",
      tool_name: null,
      method: req.method,
      url: authedUrl,
      request_headers: JSON.stringify(authedHeaders),
      request_body: requestBody,
      status_code: res.status,
      response_headers: JSON.stringify(resHeaders),
      response_body: responseBody.slice(0, 8192),
      latency_ms: latency,
      error: null,
    });
    logBus.emit({
      id: logId,
      source: "explorer",
      tool_name: null,
      method: req.method,
      url: authedUrl,
      request_headers: null,
      request_body: null,
      status_code: res.status,
      response_headers: null,
      response_body: responseBody.slice(0, 2048),
      latency_ms: latency,
      error: null,
      created_at: Date.now(),
    });

    const outHeaders: Record<string, string> = { ...CORS };
    const skip = new Set([
      "content-encoding",
      "transfer-encoding",
      "connection",
      "content-length",
    ]);
    for (const [k, v] of Object.entries(resHeaders)) {
      if (!skip.has(k.toLowerCase())) outHeaders[k] = v;
    }

    return new Response(responseBody, {
      status: res.status,
      headers: outHeaders,
    });
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    const latency = Date.now() - startTime;

    dbQueries.insertLog({
      id: logId,
      source: "explorer",
      tool_name: null,
      method: req.method,
      url: authedUrl,
      request_headers: JSON.stringify(authedHeaders),
      request_body: requestBody,
      status_code: null,
      response_headers: null,
      response_body: null,
      latency_ms: latency,
      error,
    });
    logBus.emit({
      id: logId,
      source: "explorer",
      tool_name: null,
      method: req.method,
      url: authedUrl,
      request_headers: null,
      request_body: null,
      status_code: null,
      response_headers: null,
      response_body: null,
      latency_ms: latency,
      error,
      created_at: Date.now(),
    });

    return new Response(JSON.stringify({ error: `Proxy error: ${error}` }), {
      status: 502,
      headers: { "Content-Type": "application/json", ...CORS },
    });
  }
}
