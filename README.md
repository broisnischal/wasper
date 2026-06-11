# wasper

Host an MCP server + API proxy from any OpenAPI spec. Like Drizzle Studio, but for APIs.

## Installing

### macOS / Linux

```bash
curl -fsSL https://studio.stroke.click/install.sh | sh
```

### Windows (PowerShell)

```powershell
irm https://studio.stroke.click/install.ps1 | iex
```

No curl, no Node, no Bun required.

### Package manager (needs Node or Bun)

```bash
npm install -g wasper-cli
bun add -g wasper-cli
```

## Quick start

```bash
# Start daemon in background — returns to your shell immediately
wasper up --url https://petstore.swagger.io/v2/swagger.json

# Check status
wasper status

# Stop
wasper down
```

## Commands

### Daemon

| Command | Description |
|---|---|
| `wasper up [--url <spec>] [--port <port>]` | Start daemon in background (default port: 3388) |
| `wasper down [--port <port>]` | Stop one instance |
| `wasper down --all` | Stop all instances |
| `wasper ps` | List all running instances |
| `wasper status [--port <port>]` | Status of one or all instances |
| `wasper logs [-f] [--port <port>]` | Tail server logs |

### Multiple instances

Run multiple specs simultaneously on different ports:

```bash
wasper up --url https://api1.com/openapi.json --port 3388
wasper up --url https://api2.com/openapi.json --port 3389

wasper ps                          # list both
wasper status --port 3389          # check one
wasper mcp off --port 3389         # toggle feature on one
wasper down --all                  # stop both
```

### Spec

| Command | Description |
|---|---|
| `wasper spec <url> [--port <p>]` | Load a new spec on the running daemon |
| `wasper reload [--port <p>]` | Hot-reload current spec |
| `wasper ls` | List saved spec history |
| `wasper use <n\|url> [--port <p>]` | Restart with a saved spec |
| `wasper rm <n\|url>` | Remove spec from history |

### Features (toggle on the running daemon)

| Command | Description |
|---|---|
| `wasper mcp [on\|off] [--port <p>]` | MCP endpoint |
| `wasper proxy [on\|off] [--port <p>]` | HTTP proxy |
| `wasper ai [on\|off] [--port <p>]` | AI chat |
| `wasper readonly [on\|off] [--port <p>]` | Block non-GET upstream requests |

### Auth

| Command | Description |
|---|---|
| `wasper auth` | List saved auth profiles |
| `wasper auth use <name>` | Switch active profile |
| `wasper auth none` | Disable auth |

### System service (auto-start on login)

```bash
wasper service install              # install & enable (Linux: systemd, macOS: LaunchAgent)
wasper service install --port 3389 --url https://api.example.com/openapi.json

wasper service start | stop | status | logs
wasper service uninstall
```

### Other

```bash
wasper update       # update to latest version
wasper help         # full command reference
wasper --version    # print version
```

## Updating

```bash
wasper update
```

## Options (wasper up / wasper start)

| Flag | Env var | Purpose |
|---|---|---|
| `--url` | `WASPER_SPEC_URL` | OpenAPI spec URL or local path |
| `--port` | `WASPER_PORT` | Listen port (default `3388`) |
| `--host` | `WASPER_HOST` | Bind address (default `0.0.0.0`; use `127.0.0.1` to stay local-only) |
| `--origin` | `WASPER_ORIGIN` | Public URL, e.g. `https://agent.example.com` |
| `--token` | `WASPER_TOKEN` | Require bearer token on every request |
| `--no-mcp` | — | Start with MCP endpoint disabled |
| `--no-proxy` | — | Start with HTTP proxy disabled |
| `--no-ai` | — | Start with AI chat disabled |
| `--readonly` | — | Block non-GET upstream requests |

## Studio: workspaces, environments & auth

The explorer organizes requests into **workspaces** (Postman-style). Each
workspace carries shared defaults that every request in it can use:

- **Default auth** — bearer, basic, API key, OAuth2 client credentials, OIDC,
  custom headers, a saved CLI auth profile, or the CLI's active auth.
- **Default headers** — merged under each request's own headers (the request
  always wins on conflict).
- **Default environment** — which variable set (`{{var}}` substitution) the
  workspace uses; leave it empty to follow the globally active environment.

**Auth inheritance** resolves per request through a chain:

```
request auth → workspace default auth → CLI active auth
```

### Auth roles for AI agents

Save multiple auth profiles (roles) — e.g. `admin`, `readonly-bot` — in the
studio. Every MCP agent learns them on connect (the `initialize` response
lists each role and how to use it), and can either:

- pass `authProfile: "<role>"` to `execute_api_request` — per-request, so
  concurrent agents can act as different roles without interfering, or
- call `set_active_auth` to switch the global default.

Combine with `wasper readonly on` to let agents explore an API safely.

## Self-hosting

```bash
wasper up \
  --url https://petstore3.swagger.io/api/v3/openapi.json \
  --origin https://agent.example.com \
  --token "$(openssl rand -hex 24)"
```

Connect the studio: `https://studio.stroke.click/?server=https://agent.example.com&token=<secret>`

### Docker

```bash
cd packages/cli
docker build -t wasper .
docker run -d --name wasper \
  -p 3388:3388 \
  -v wasper-data:/app/data \
  -e WASPER_SPEC_URL=https://petstore3.swagger.io/api/v3/openapi.json \
  -e WASPER_ORIGIN=https://agent.example.com \
  -e WASPER_TOKEN=change-me \
  wasper
```

### Reverse proxy

```
agent.example.com {
    reverse_proxy localhost:3388
}
```

## Development

```bash
bun install
bun run dev          # in packages/cli — hot-reloading server
bun run dev          # in packages/studio — vite dev server
```
