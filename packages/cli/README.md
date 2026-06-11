# wasper-cli

A local CLI daemon + MCP server + API proxy for your OpenAPI specs.

## Install

**macOS / Linux**
```bash
curl -fsSL https://studio.stroke.click/install.sh | sh
```

**Windows** — open PowerShell:
```powershell
irm https://studio.stroke.click/install.ps1 | iex
```

**npm / Bun**
```bash
npm install -g wasper-cli
bun add -g wasper-cli
```

## Quick start

```bash
# Start daemon in background (returns to your shell immediately)
wasper up --url https://petstore.swagger.io/v2/swagger.json

# Run a second instance on a different port
wasper up --url https://api2.example.com/openapi.json --port 3389

# List all running instances
wasper ps

# Check status
wasper status

# Stop all
wasper down --all
```

## Commands

### Daemon
```
wasper up [--url <spec>] [--port <port>]   Start daemon in background
wasper down [--port <port>]                Stop one instance
wasper down --all                          Stop all instances
wasper ps                                  List all running instances
wasper status [--port <port>]              Status of one or all
wasper logs [-f] [--port <port>]           Tail server logs
```

### Spec
```
wasper spec <url> [--port <port>]          Load new spec on running daemon
wasper reload [--port <port>]              Hot-reload current spec
wasper ls                                  List saved spec history
wasper use <n|url> [--port <port>]         Restart with a saved spec
wasper rm  <n|url>                         Remove spec from history
```

### Features (toggle on the running daemon)
```
wasper mcp      [on|off] [--port <port>]
wasper proxy    [on|off] [--port <port>]
wasper ai       [on|off] [--port <port>]
wasper readonly [on|off] [--port <port>]
```

### Auth
```
wasper auth                   List saved auth profiles
wasper auth use <name>        Switch active profile
wasper auth none              Disable auth
```

### System service
```
wasper service install [--port <port>] [--url <spec>]
wasper service uninstall
wasper service start | stop | status | logs
```

### Other
```
wasper update          Update to latest version
wasper help            Full command reference
wasper --version       Print version
```

## Options

| Flag | Env var | Default |
|---|---|---|
| `--url` | `WASPER_SPEC_URL` | — |
| `--port` | `WASPER_PORT` | `3388` |
| `--host` | `WASPER_HOST` | `0.0.0.0` |
| `--origin` | `WASPER_ORIGIN` | — |
| `--token` | `WASPER_TOKEN` | — |
| `--no-mcp` | — | MCP on |
| `--no-proxy` | — | proxy on |
| `--no-ai` | — | AI on |
| `--readonly` | — | off |

## Foreground / REPL mode

```bash
wasper start --url <spec>   # interactive REPL with slash commands
```

Press `/` and type: `/mcp on|off` · `/proxy on|off` · `/auth use <role>` · `/token new` · `/tail` · `/help`
