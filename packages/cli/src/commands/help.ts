import { paint } from '../ui';
import { VERSION } from '../version';

export async function run() {
  const b = (s: string) => paint.bold(s);
  const d = (s: string) => paint.dim(s);
  const c = (s: string) => paint.cyan(s);

  console.log(`
  ${b('wasper')}  ${d('v' + VERSION)}

  ${b('Daemon')}
  ${c('wasper up')} ${d('[--url <spec>] [--port <port>]')}
                         Start daemon in background (default port: 3388)
  ${c('wasper up')} ${d('--url <spec2> --port 3389')}
                         Run a second instance on a different port
  ${c('wasper down')} ${d('[--port <port>]')}  Stop one instance
  ${c('wasper down --all')}         Stop all instances
  ${c('wasper ps')}                 List all running instances
  ${c('wasper status')} ${d('[--port <p>]')}   Status of one or all instances
  ${c('wasper logs')} ${d('[-f] [--port <p>]')}  Tail server logs

  ${b('Spec')}
  ${c('wasper spec')} ${d('<url> [--port <p>]')}   Load a new spec on the running daemon
  ${c('wasper reload')} ${d('[--port <p>]')}      Hot-reload current spec
  ${c('wasper ls')}                List saved spec history
  ${c('wasper use')} ${d('<n|url> [--port <p>]')}  Restart with a saved spec
  ${c('wasper rm')}  ${d('<n|url>')}              Remove spec from history

  ${b('Features')}  ${d('toggle on the running daemon')}
  ${c('wasper mcp')} ${d('[on|off] [--port <p>]')}
  ${c('wasper proxy')} ${d('[on|off] [--port <p>]')}
  ${c('wasper ai')} ${d('[on|off] [--port <p>]')}
  ${c('wasper readonly')} ${d('[on|off] [--port <p>]')}

  ${b('Auth')}
  ${c('wasper auth')}                List saved auth profiles
  ${c('wasper auth use')} ${d('<name>')}      Switch active profile
  ${c('wasper auth none')}           Disable auth

  ${b('Service')}  ${d('auto-start on login')}
  ${c('wasper service install')} ${d('[--port <p>] [--url <spec>]')}
  ${c('wasper service uninstall')}
  ${c('wasper service start')} ${d('|')} ${c('stop')} ${d('|')} ${c('status')} ${d('|')} ${c('logs')}

  ${b('Other')}
  ${c('wasper update')}      Update to latest version
  ${c('wasper --version')}   Print version

  ${d('Multi-instance example:')}
  ${d('  wasper up --url https://api1.com/openapi.json --port 3388')}
  ${d('  wasper up --url https://api2.com/openapi.json --port 3389')}
  ${d('  wasper ps')}
  ${d('  wasper mcp off --port 3389')}
  ${d('  wasper down --all')}
`);
  process.exit(0);
}
